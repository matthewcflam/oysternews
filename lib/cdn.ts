/**
 * The public R2 host, shared by the worker (which writes URLs into the
 * manifest) and the browser (which reads the manifest from the same host).
 * One literal in one repo beats two env vars in two dashboards (GitHub
 * Actions and Vercel), which is a silent-drift generator — see
 * docs/DESIGN.md#blob-traps (now R2 traps).
 *
 * Imports nothing, so it is safe to pull into both the Next bundle and
 * `node worker/run.ts`. Env-overridable via `R2_PUBLIC_BASE` for scratch
 * buckets and the `r2.dev` probes in the migration plan's Phase C.
 */
export const CDN_BASE = process.env.R2_PUBLIC_BASE ?? "https://cdn.oysternews.xyz";
