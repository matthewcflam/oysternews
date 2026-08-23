# Migrate object storage from Vercel Blob to Cloudflare R2

## Context

Vercel Blob's Hobby tier allows **2,000 advanced operations per month**. Advanced operations are `put`, `copy`, and `list`; `del` is free and reads bill on a separate, much larger meter.

The pipeline spends ~134 of them per run:

| Call site | Ops |
|---|---|
| `state.ts:119` `readPool` — 2 × `list` | 2 |
| `state.ts:150-151` `appendShards` — run + tier1 shard | 2 |
| `state.ts:159` `pruneShards` — 2 × `list` | 2 |
| `publish.ts:390` `assertStoreReachable` — `list` | 1 |
| `publish.ts:449` archive `putBinary` | 1 |
| `publish.ts:455` regions `putText` | 1 |
| `publish.ts:478` **city shards — one `putText` per country** | **~121** |
| `publish.ts:499` manifest flip | 1 |
| `publish.ts:513` history | 1 |
| `publish.ts:519` retention `list` | 1 |

At `cron: "20 */4 * * *"` (6 runs/day) that is **~24,000 operations/month against a 2,000 cap** — the allowance is gone in about two and a half days.

Note the pre-cities number: 13 ops/run → 2,340/month. The budget was **already at ~117% of the cap** before city shards landed on Aug 21. The 121-shard fan-out did not tip a healthy budget over; it detonated one that was already failing.

**The store is currently blocked.** `GET https://wkx9bwwjpf2tzdsl.public.blob.vercel-storage.com/manifest.json` returns `403 Your store is blocked`. Vercel does not bill Hobby overage — it cuts access until 30 days have passed. `loadManifest` (`lib/manifest.ts:48`) throws on any non-OK response, so the map renders nothing right now. The Vercel-served app shell still returns 200. Creating a second Blob store does not help; the quota is account-level.

R2's free tier is **1M Class A operations/month** (`PutObject`, `ListObjectsV2`), 10M Class B (`GetObject`, `HeadObject`), 10 GB storage, and **zero egress**. The current unoptimised 24,000 writes/month is 2.4% of that allowance. Migrating is what gets the site back online before the 30-day reset; it is not merely a cost optimisation.

**Deliberately out of scope:** the write-reduction work (collapsing 121 city-shard puts into one range-addressed pack, trimming the `list` calls). R2's headroom makes it non-urgent, and keeping it out keeps the cutover diff small. It stays worth doing afterward.

## Recommended approach

Add an `r2Store` implementing the existing `ArchiveStore` interface and swap it in at the one place the credential enters the process (`worker/run.ts:342-345`). The seam already exists: `run()` takes an injected store (`run.ts:135`), so `run()`, `publish()`, and `state.ts` are all store-agnostic and do not change.

### Storage-side design decisions

**Reads go to the S3 endpoint, not the public URL.** The Vercel implementation's `get()` fetched `urlOf(key)` — a public CDN URL — because the Blob REST API offered no authenticated GET. That caused a measured bug recorded in `docs/DESIGN.md:1117-1121`: an overwrite of `state/publish-history.json` read back as the *previous* body with `X-Vercel-Cache: HIT, Age: 6`. R2's S3 `GetObject` is authenticated and hits the origin directly, so routing `get()` and `remove()` through the S3 endpoint **eliminates that entire stale-read class**. `urlOf()` still returns the public custom-domain URL, because that value is what goes into the manifest for the browser.

**`Cache-Control: no-transform` on the archive.** Cloudflare's CDN compresses objects and thereby corrupts HTTP Range responses — wrong total in `Content-Range`, weak ETags, truncated bodies. This is the documented cause of maplibre/demotiles#35, where PMTiles broke behind Cloudflare. The fix Cloudflare documents is `no-transform` from the origin, which that project could not use (GitHub Pages cannot set headers) but we can, on `PutObject`. This is the single highest-risk item in the migration and it is directly mitigable.

JSON artefacts do **not** get `no-transform` — they are fetched whole, never by range, and compression is a win there. Leave a comment saying so, because if the city shards later become a range-addressed pack they must move to `no-transform` too.

**CORS must be configured explicitly.** Vercel Blob sent `Access-Control-Allow-Origin: *` for free; R2 does not. The browser fetches the manifest (`lib/manifest.ts:48`), the PMTiles archive (`components/MapView.tsx:472-478`), the regions index (`lib/regions.ts:20-36`), and the city shards (`lib/cities.ts:23`) cross-origin from `oysternews.xyz` to `cdn.oysternews.xyz`. PMTiles additionally needs `range` and `if-match` in `AllowedHeaders` and `etag` in `ExposeHeaders`.

**`AllowedOrigins` is `["*"]` — decided, not left open.** The field controls only which *websites' JavaScript* may read a response. It is not access control: `curl`, scrapers, and server-side fetches ignore CORS entirely, so the bucket's contents are equally reachable either way. It is not a bandwidth control either, since R2 egress is free. What a narrow list would actually prevent is another website's JS reading the map data directly — a hotlinking concern, and a negligible one for public news headlines on a free-egress bucket.

The cost of narrowing is concrete by comparison. The app is served from production (`oysternews.xyz`), the still-live default Vercel domain (`sonder-drab-eta.vercel.app`, `README.md:7`), `localhost:3000`, and **per-branch Vercel preview URLs** — which are generated fresh per deploy, so a fixed allowlist either breaks previews or depends on a wildcard entry like `https://*.vercel.app` whose support in R2 I have not confirmed. Step 15 deliberately dogfoods the migration on a preview deploy before any DNS change, so this is a live constraint, not a hypothetical.

`["*"]` is also not a loosening: it is exactly what the live Vercel Blob store returns today (`Access-Control-Allow-Origin: *`, confirmed by response headers pulled during planning). Parity, on data that is public by design.

**The 404 path needs CORS headers, not just the right status.** `lib/cities.ts:25` treats 404 as "this country publishes no shard" and resolves to `[]`. R2 does return 404 for a missing object. But if that 404 response lacks `Access-Control-Allow-Origin`, the fetch at `lib/cities.ts:23` rejects with a CORS `TypeError` before line 25 is ever reached, and `:29-32` rethrows into the label-click handler. The status code is the easy half; the header on the error response is the half that actually breaks.

**`remove()` must tolerate 404.** S3 `DELETE` of a missing key returns 204, but a raced double-delete must not throw: retention (`publish.ts:521`) and `pruneShards` (`state.ts:161`) both loop deletes, and retention runs *after* the manifest flip — a throw there fails a run that has already successfully published.

**Guard the `ListObjectsV2` parse against `<Prefix>`.** The response body contains a top-level `<Prefix>archives/</Prefix>` alongside the `<Key>` elements. A parse that matches both injects `archives/` into the key list, where `archivesToPrune` (`publish.ts:203-206`) passes it straight to `store.remove`. Match `<Key>` only, and test it. Also guard that the body is a `ListBucketResult` at all — an `<Error>` document or an HTML proxy page returned with a 200 would otherwise parse as "zero keys stored", meaning `assertStoreReachable` passes while retention silently prunes nothing forever. That is the same shape of invisible failure as the regions leak at `docs/DESIGN.md:1088-1095`.

**aws4fetch needs `service: "s3"` and `region: "auto"` set explicitly.** It infers both from the hostname, and `*.r2.cloudflarestorage.com` is not an AWS host, so the inferred scope is rejected as `SignatureDoesNotMatch` — which reads like a bad secret rather than a config error.

**Signing.** Add `aws4fetch` (~7 KB, zero deps, fetch-based, what Cloudflare's own R2 examples use). `worker/` runs via `node worker/run.ts` and is never imported by the Next app, so this does not reach the browser bundle. Hand-rolling SigV4 is the kind of thing that fails subtly; `@aws-sdk/client-s3` is far too heavy for five calls.

**`ListObjectsV2` returns XML.** Parse it with a narrow extraction of `<Key>` and `<NextContinuationToken>` in an exported pure function (`parseListPage`), rather than adding an XML dependency — that keeps the whole parse under fixture tests with no mocking, which is the pattern `worker/state.ts`'s header already sets for expiry and dedupe. Skip `<IsTruncated>` entirely: S3 emits `NextContinuationToken` if and only if the page is truncated, so looping on a non-empty token is equivalent, one regex shorter, and cannot wedge on a truncated page that omits the token. That is also the shape the current code already uses at `publish.ts:299`. Unescape the five XML entities anyway — our key namespace happens to be `[A-Za-z0-9/_.-]`, but nothing in code enforces that, and unescaping stops the invariant being load-bearing.

Against `@aws-sdk/client-s3`: ~100 transitive packages and its own credential-resolution chain, in a repo with six runtime dependencies, to call four verbs. Against `fast-xml-parser`: a config surface of its own, including array-coercion of a single `<Contents>` element — a one-key page would parse to an object and a two-key page to an array.

### Files to change

- **`worker/store.ts` (new)** — `r2Store()`, the SigV4 wiring, and the XML key parse. `publish.ts` is already ~540 lines mixing invariants, hashing, retention, the store, and the publish routine; the store is the cleanest thing to lift out. Move `ArchiveStore` (currently `publish.ts:223-228`) here with it and re-export from `publish.ts` so existing imports keep working.
- **`worker/publish.ts`** — delete `vercelBlobStore` (`:256-349`), `BLOB_API`/`BLOB_API_VERSION` (`:230-231`), `publicBase` (`:237-241`). Rewrite the module header (`:10-11`) and the `assertStoreReachable` error message (`:393-398`), which currently explains Vercel token-format traps that no longer exist.
- **`worker/run.ts:28, 343-345`** — import `r2Store`, read the R2 credentials instead of `BLOB_READ_WRITE_TOKEN`.
- **`scripts/theme-audit.ts:35, 88-95`** — same import and env swap.
- **`lib/cdn.ts` (new)** — a single `CDN_BASE` constant, importing nothing so it is safe from both the Next bundle and `node worker/run.ts`. The worker writes these URLs into the manifest and the browser reads the manifest from the same host, so the two halves must not be allowed to disagree; one literal in one repo beats two env vars in two different dashboards (GitHub Actions and Vercel), which is a silent-drift generator. Env-overridable via `R2_PUBLIC_BASE` for scratch buckets and the `r2.dev` probes.
- **`lib/manifest.ts:30-32`** — `MANIFEST_URL` becomes `` process.env.NEXT_PUBLIC_MANIFEST_URL ?? `${CDN_BASE}/manifest.json` ``. Keep the `NEXT_PUBLIC_MANIFEST_URL` override — step 15 depends on it — and the comment at `:22-29` explaining why this is hardcoded rather than build-time-inlined.
- **`.github/workflows/worker.yml:104-109`** — replace the `BLOB_READ_WRITE_TOKEN` env line with the three R2 secrets.
- **`package.json`** — add `aws4fetch`.
- **`next.config.mjs:8-9`** — comment-only: the `/boundaries.pmtiles` header rule's comment says the story archive "moved to Vercel Blob in Phase 3". There is no CSP anywhere in the app, so nothing here blocks the new host; only the sentence needs correcting.
- **`docs/DESIGN.md:1097-1130`** — rewrite `### Blob traps` as R2 traps. Traps 1 and 2 (public-or-nothing, the REST/SDK overwrite split) become obsolete; trap 3 (stale CDN reads) is *solved* by authenticated reads and should be recorded as such rather than deleted. Add the Cloudflare range-compression hazard and the CORS requirement. Also update `:39`, `:155`, `:185`, `:211` and `README.md:9, 19, 73`.

### Env vars

Three secrets: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. The bucket name and public base URL are hardcoded constants in `worker/store.ts` — they are not secret (the public base is literally public), and `lib/manifest.ts:22-29` sets the precedent that a constant in the repo cannot drift from the deploy.

### Tests

`worker/publish.test.ts`'s `memoryStore` (`:78-122`) is already provider-agnostic — it returns `https://blob.example/${key}` — so every publish test passes unchanged. Only the two `vercelBlobStore` URL-derivation tests at `:676-690` are deleted, replaced by `r2Store` equivalents.

New `worker/store.test.ts` against a mocked `fetch`, covering the contracts that are load-bearing elsewhere:
- `get()` **throws** on 404 — `readHistory` (`publish.ts:404-413`) and `lastWatermark` (`run.ts:142-152`) both depend on the throw meaning "first run".
- `list()` follows `NextContinuationToken` across pages and returns keys, not URLs.
- `list()` throws on 401/403 — it is the reachability probe.
- `putBinary()` sends `Cache-Control` containing `no-transform`; `putText()` does not.
- `putBinary`/`putText` return the **public** URL, not the S3 endpoint URL.
- `urlOf()` composes the public base with no network call.

Consolidating the two in-memory fakes (`publish.test.ts:78-122` and the simpler `state.test.ts:50-67`, whose `get` returns `""` instead of throwing) into one shared exported helper is worth doing, but as a follow-up — it touches test files unrelated to this cutover.

## Tradeoffs

**You must move DNS to Cloudflare.** R2 custom domains require the zone to be in your Cloudflare account, and partial (CNAME-only) setup is Business/Enterprise-plan only. So the nameservers move from Porkbun to Cloudflare. Porkbun stays your registrar — only the NS delegation changes, nothing is transferred and nothing is re-billed.

**Vercel records must stay DNS-only (grey cloud).** Vercel explicitly recommends against a reverse proxy in front of it; proxying causes cert-generation failures and redirect loops. The R2 hostname `cdn.oysternews.xyz` is necessarily proxied (orange), but that is a different hostname and the two coexist in one zone without interacting.

**Cloudflare requires a payment method on file to enable R2**, even for the $0 free tier. You will not be charged inside the allowances, but expect to be asked for a card.

**Range requests behind Cloudflare are the real risk.** Mitigated by `no-transform` as above, and — because `r2.dev` is proxied identically to a custom domain — provable in Phase C before any nameserver is touched and before the browser is pointed anywhere new.

**You lose the 24h rolling window once.** The new bucket starts empty, and the blocked Vercel store cannot be read to copy anything out. This is fine and does not need solving: `lastWatermark` returns `""` on a missing manifest (`run.ts:142-152`), `stampsToFetch` then runs to the cap (`fetch.ts:112-121`), and a cold run fetches the full `MAX_BUNDLES = 12`. At the steady-state marginal rate of ~424 groups/bundle that is ~5,100 groups — comfortably inside `[2000, 60000]`. The window refills to 24h over the following day.

**The count band is fully armed on run one.** `publish.ts:438-444` gates the relax valve on `history.length > 0` specifically so a fresh store cannot publish garbage, and there is a regression test for it (`publish.test.ts:570-592`). So the first run **must not** have `bundle_cap` lowered — the measured 1-bundle run produced 1,467 groups, below the 2,000 floor, and would publish nothing.

## Sequencing

The key insight, and the reason this is ordered the way it is: **`r2.dev` development URLs are Cloudflare-proxied, exactly like a custom domain.** The CDN behaviour carrying all the risk — compression, range handling, ETag weakening, CORS on both 200s and 404s — is identical on both. So everything can be proven over `r2.dev` first, and the nameserver move at the end becomes a rename rather than a leap. `r2.dev` is rate-limited and unfit for production, so it is a probe target only, never a value left in a published manifest.

### Phase A — you, in the Cloudflare dashboard (nothing live changes)

**1. Enable R2 and create the bucket.** dash.cloudflare.com → **R2** → enable (expect a payment-method prompt; the free tier still bills $0). Create a bucket named `sonder`, location hint **ENAM**. Like Vercel Blob's region, treat this as permanent.

**2. Create an API token.** R2 → **Manage API Tokens** → *Create API Token*. Permission **Object Read & Write** — not Read only. A read-only token is a silent trap: `assertStoreReachable` passes on its `list`, and the run then dies several steps later inside `appendShards`. Scope it to the `sonder` bucket. Save the **Access Key ID** and **Secret Access Key** (shown once), plus your **Account ID**.

**3. Enable the `r2.dev` development URL** temporarily. Bucket → **Settings** → *Public access* → enable the r2.dev subdomain. This is what Phase C probes against. It gets disabled again in Phase E.

**4. Set the CORS policy.** Dashboard-only — R2 does not expose the S3 `PutBucketCors` API, so I cannot do this from the pipeline. Bucket → **Settings** → *CORS Policy* → Add:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["range", "if-match"],
    "ExposeHeaders": ["etag", "content-range", "content-length", "accept-ranges"],
    "MaxAgeSeconds": 3600
  }
]
```

`AllowedOrigins: ["*"]` is deliberate — see the design note above. Short version: it matches what Vercel Blob returns today, CORS is not access control for public data, and a narrow list would break per-branch Vercel preview deploys, which step 15 relies on. `range` and `if-match` are the headers PMTiles sends; the exposed headers are what it needs to read back.

**5. Give me the credentials.** Best: add them yourself as GitHub Actions secrets (repo → Settings → Secrets and variables → Actions) named `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, plus an Actions *variable* `R2_BUCKET=sonder`, and put the same values in `.env.local`. Then just tell me they are set — I never need to see the secret. Paste with **no surrounding quotes**: `node --env-file` strips them locally but GitHub stores them literally, which is the exact trap recorded at `docs/DESIGN.md:1123-1126`.

### Phase B — me, code only

6. Add `aws4fetch`. Write `lib/cdn.ts` (one shared `CDN_BASE` constant, imported by both the worker and `lib/manifest.ts`, so the two halves cannot drift), `worker/store.ts`, and `worker/store.test.ts`.
7. Strip `vercelBlobStore`, `BLOB_API`, and `publicBase` from `worker/publish.ts`; rewrite its header and the `assertStoreReachable` message. Rewire `worker/run.ts`, `scripts/theme-audit.ts`, `lib/manifest.ts`, `next.config.mjs`'s stale comment.
8. Rewrite `docs/DESIGN.md`'s `Blob traps` section and the `README.md` references.
9. `npx tsc --noEmit && npx vitest run` — green before anything touches the network.

### Phase C — me, verification against the real bucket over `r2.dev`

This is where the migration is actually de-risked, and it all happens before any DNS change.

10. **Read path**: `node --env-file=.env.local scripts/theme-audit.ts`. Against an empty bucket it reports zero shards — that *is* a pass. It proves credentials, endpoint, signing and `list` pagination, and it cannot write anything.
11. **Write path, cheap**: `BUNDLE_CAP=1 node --env-file=.env.local worker/run.ts`. Expect `PUBLISHED NOTHING — group count ~1467 outside [2000, 60000]` and exit 1. That is also a pass — it proves `assertStoreReachable`, both shard `put`s, and the pool round-trip. Note what it does *not* prove: `publish()` returns at the invariant check (`publish.ts:444-445`) before `readFile`, so `putBinary`, `putText`, and retention are all untouched on this run.
12. **The range probe — the one that matters.** Upload a throwaway object under `probe/` (not `archives/`, which retention would prune) and, over the **`r2.dev` URL**:
    ```
    curl -s -D- -o /dev/null -H 'Range: bytes=0-16383' "$BASE/probe/x.pmtiles"
    ```
    Required: `206 Partial Content`; `Content-Length: 16384`; the total in `Content-Range: bytes 0-16383/<total>` **equal to the object's real byte size**; a **strong** ETag (no `W/`); `Cache-Control` containing `no-transform`; and **no** `Content-Encoding`. A total matching a compressed size is precisely the maplibre/demotiles#35 failure and means `no-transform` is not landing — stop there, do not proceed.

    This must go over `r2.dev`, never the S3 endpoint. A signed S3 GET bypasses the CDN transform layer entirely and will always look correct, proving nothing about the hazard.
13. **CORS, including the error path**:
    ```
    curl -s -D- -o /dev/null -X OPTIONS -H 'Origin: https://oysternews.xyz' \
      -H 'Access-Control-Request-Method: GET' \
      -H 'Access-Control-Request-Headers: range,if-match' "$BASE/probe/x.pmtiles"
    curl -s -D- -o /dev/null -H 'Origin: https://oysternews.xyz' "$BASE/probe/missing.json"
    ```
    The second must be **404 carrying `access-control-allow-origin`**. Without that header `lib/cities.ts:23` rejects with a CORS error and the 404 branch never runs. Delete `probe/` afterwards.
14. **First real publish**: full 12-bundle `node --env-file=.env.local worker/run.ts`. Then read the published `manifest.json` by eye — `url`, `regionsUrl`, and `citiesBase` must all start with the public base, never `r2.cloudflarestorage.com`. Publishing S3-endpoint URLs would 403 for every visitor.
15. **End-to-end, still no DNS change**: a Vercel *preview* deploy with `NEXT_PUBLIC_MANIFEST_URL` pointed at the r2.dev manifest (`lib/manifest.ts:29` exists for exactly this). Load it and confirm tiles render, a region panel opens, and a city click loads a shard in two different countries. Production is untouched throughout.

At this point every risk in the migration has been retired.

### Phase D — you, the DNS move

**16. Add the domain to Cloudflare.** Websites → *Add a site* → `oysternews.xyz` → Free plan. Cloudflare scans and imports the existing records. Verify the imported set matches what is live now:

| Type | Name | Value | Proxy |
|---|---|---|---|
| A | `oysternews.xyz` | `216.198.79.1` | **DNS only (grey)** |
| CNAME | `www` | `pixie.porkbun.com` | **DNS only (grey)** |

Measured today — there are no MX or TXT records on the apex, so no email to break. Both must be grey-cloud: Vercel recommends against a proxy in front of it, and orange-clouding causes cert failures and redirect loops. Tell me if Cloudflare imported anything beyond these two.

**17. Switch nameservers at Porkbun.** Cloudflare shows two nameservers on the site overview. Porkbun → Domain Management → `oysternews.xyz` → **Authoritative Nameservers** → Edit → replace all four Porkbun entries with Cloudflare's two. Porkbun remains your registrar; only the delegation changes. Usually minutes, allow up to 24h. The apex keeps resolving to the same Vercel IP, so the site should not blink.

**18. Once Cloudflare reports the zone Active**, confirm nothing moved:
```
nslookup -type=NS oysternews.xyz 8.8.8.8
nslookup -type=A oysternews.xyz 8.8.8.8      # must still be 216.198.79.1
curl -sSI https://oysternews.xyz/ | head -3  # must still be 200, Server: Vercel
```

**19. Attach the custom domain.** R2 → `sonder` → **Settings** → *Public access* → **Connect Domain** → `cdn.oysternews.xyz`. Cloudflare creates the proxied CNAME itself. Tell me when it reports connected.

### Phase E — cutover

20. I re-run the step 12 range probe against the real archive at `cdn.oysternews.xyz`, then ship `lib/cdn.ts` pointing at it. Vercel redeploys; the browser follows the new manifest.
21. Disable the `r2.dev` development URL.
22. You add nothing further — the Actions secrets from step 5 are already in place. I update `.github/workflows/worker.yml` and trigger a `workflow_dispatch` with `bundle_cap: 1`. It will fail the count band and exit 1, which is expected; it proves the CI credential, the last untested thing.
23. Let one scheduled run pass green.
24. **Only then delete the Vercel Blob store.**

## Verification summary

- `npx tsc --noEmit` and `npx vitest run` (432 currently green) — Phase B.
- Range/CORS/404 probes over `r2.dev` — Phase C, steps 12-13. These are the ones that would otherwise fail silently in a browser.
- Preview-deploy dogfood before any DNS change — step 15.
- **The second scheduled run, 4h after the first**, is the one to actually watch: it is the first to exercise the warm path — state shards read back, window grown, retention pruning run 1's archive, manifest flipping to a new hash. A stale-read or pagination bug shows up here and nowhere earlier.
- R2 metrics after a day: Class A operations should read ~800/day against the 1M allowance.

## Follow-ups (not this change)

- Collapse the 121 city-shard puts into a single range-addressed pack with a byte-offset table in the manifest, and trim the six `list` calls per run to one. Takes ~134 ops/run to ~5. Worth doing on its own merits; no longer urgent.
- Consolidate the two in-memory store fakes into one shared test helper.
- `www.oysternews.xyz` currently CNAMEs to Porkbun parking and fails TLS. Either point it at Vercel and add it to the project, or drop the record.
- The bucket is public bucket-wide, so `state/run-*.jsonl` and `state/publish-history.json` are readable by anyone who guesses the path. This is **already true on Vercel Blob**, so the migration is not a regression, and it is unrelated to the `AllowedOrigins` decision above — CORS would not hide them from a `curl` either way. If it should be fixed, the lever is bucket layout (a second private bucket for `state/`) or a Worker gating `/state/*`, not the CORS policy. Deliberately out of the cutover.
