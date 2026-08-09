"""Part 3: GEO 2.0 endpoint variants, governance theme tightening, dedup math."""
import json, os, time, urllib.request, urllib.parse, collections, zipfile, io, csv, re, html, glob

HERE = os.path.dirname(os.path.abspath(__file__))
UA = "sonder-spike/0.1 (portfolio project; contact matthewcflam@gmail.com)"
csv.field_size_limit(10_000_000)


def get(url, timeout=45):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), time.time() - t0
    except urllib.error.HTTPError as e:
        return e.code, e.read(), time.time() - t0
    except Exception as e:
        return -1, str(e).encode(), time.time() - t0


print("=" * 70)
print("G2.  GEO 2.0 API — endpoint variants (first probe returned 404)")
print("=" * 70)
variants = [
    ("pointdata + geojson", "query={q}&format=geojson&mode=pointdata&timespan=1h"),
    ("PointData caps",      "query={q}&format=GeoJSON&mode=PointData&timespan=1h"),
    ("no timespan",         "query={q}&format=geojson&mode=pointdata"),
    ("html mode default",   "query={q}&format=geojson"),
    ("imagepointdata",      "query={q}&format=geojson&mode=imagepointdata&timespan=1h"),
]
q = urllib.parse.quote("flood")
for label, tmpl in variants:
    url = "https://api.gdeltproject.org/api/v2/geo/geo?" + tmpl.format(q=q)
    st, body, dt = get(url)
    snippet = body[:100].decode("utf-8", "replace").replace("\n", " ")
    print(f"  {label:<22} HTTP {st:<4} {dt:5.2f}s {len(body):>7}B  {snippet[:70]}")
    if st == 200 and body[:1] == b"{":
        try:
            j = json.loads(body)
            feats = j.get("features", [])
            print(f"      -> {len(feats)} features")
            if feats:
                p = feats[0].get("properties", {})
                print(f"      -> keys: {sorted(p.keys())}")
                for k, v in list(p.items())[:8]:
                    print(f"           {k}: {str(v)[:100]}")
                print(f"      -> themes?  {'YES' if any('theme' in k.lower() for k in p) else 'NO'}")
                print(f"      -> offsets? {'YES' if any('offset' in k.lower() for k in p) else 'NO'}")
                print(f"      -> domain?  {'YES' if any('domain' in k.lower() or 'source' in k.lower() for k in p) else 'NO'}")
            break
        except Exception as e:
            print(f"      -> parse fail {e}")
    time.sleep(6)
print()

# ------------------------------------------------------ governance tightening
print("=" * 70)
print("GOV.  Governance theme breadth — first list caught 47.7% of everything")
print("=" * 70)

BROAD = ("EPU_POLICY", "GENERAL_GOVERNMENT", "LEGISLATION", "ELECTION",
         "DEMOCRACY", "CONSTITUTIONAL", "TAX_FNCACT_MINISTER",
         "TAX_FNCACT_PRESIDENT", "TAX_FNCACT_SENATOR", "TAX_FNCACT_GOVERNOR",
         "TAX_FNCACT_LAWMAKER", "TAX_FNCACT_LEGISLATOR", "GOV_")

TIGHT = ("LEGISLATION", "ELECTION", "CONSTITUTIONAL",
         "TAX_FNCACT_LAWMAKER", "TAX_FNCACT_LEGISLATOR",
         "EPU_POLICY_GOVERNMENT", "WB_831_GOVERNANCE")

C_SOURCE, C_DOCID, C_V2THEMES, C_V2LOC, C_EXTRAS = 3, 4, 8, 10, 26
TITLE_RE = re.compile(r"<PAGE_TITLE>(.*?)</PAGE_TITLE>", re.S)

files = sorted(glob.glob(os.path.join(HERE, "samples", "*.gkg.csv.zip")))
total = 0
broad_hit = tight_hit = 0
broad_country = tight_country = 0
theme_df = collections.Counter()
titles_all = []
city_titles = []

for path in files:
    with zipfile.ZipFile(path) as z:
        with z.open(z.namelist()[0]) as fh:
            text = io.TextIOWrapper(fh, encoding="utf-8", errors="replace", newline="")
            for r in csv.reader(text, delimiter="\t", quoting=csv.QUOTE_NONE):
                if len(r) < 27:
                    continue
                total += 1
                themes = set(t.split(",")[0] for t in r[C_V2THEMES].split(";") if t)
                for t in themes:
                    theme_df[t] += 1
                b = any(t.startswith(BROAD) for t in themes)
                g = any(t.startswith(TIGHT) for t in themes)
                if b: broad_hit += 1
                if g: tight_hit += 1
                types = set()
                for chunk in r[C_V2LOC].split(";"):
                    p = chunk.split("#")
                    if len(p) >= 8:
                        try: types.add(int(p[0]))
                        except ValueError: pass
                if types and not (types & {3, 4}):
                    if b: broad_country += 1
                    if g: tight_country += 1
                m = TITLE_RE.search(r[C_EXTRAS])
                t_ = html.unescape(m.group(1).strip()) if m else ""
                if t_:
                    titles_all.append((t_, r[C_SOURCE].strip().lower()))
                    if types & {3, 4}:
                        city_titles.append((t_, r[C_SOURCE].strip().lower()))

pct = lambda a, b: 100.0 * a / b if b else 0
print(f"  records                    {total:,}")
print(f"  BROAD gov list             {broad_hit:,}  ({pct(broad_hit,total):.1f}%)  <- too loose")
print(f"  TIGHT gov list             {tight_hit:,}  ({pct(tight_hit,total):.1f}%)")
print(f"  BROAD + no city location   {broad_country:,}")
print(f"  TIGHT + no city location   {tight_country:,}   <- records the rule rescues")
print()
print("  individual theme doc-frequency (candidates for the gov list):")
for t in ["GENERAL_GOVERNMENT", "USPEC_POLICY1", "LEADER", "WB_831_GOVERNANCE",
          "LEGISLATION", "ELECTION", "DEMOCRACY", "CONSTITUTIONAL",
          "EPU_POLICY", "TAX_FNCACT_PRESIDENT", "TAX_FNCACT_MINISTER",
          "TAX_FNCACT_LAWMAKER", "TAX_FNCACT_LEGISLATOR", "TRIAL"]:
    c = sum(v for k, v in theme_df.items() if k == t or k.startswith(t + "_"))
    print(f"    {pct(c,total):5.1f}%  {t}")
print()

# ------------------------------------------------------------- dedup math
print("=" * 70)
print("DEDUP.  Syndication load — how many DISTINCT stories are actually there?")
print("=" * 70)


def norm(t):
    t = re.sub(r"\s+", " ", t.lower()).strip()
    t = re.sub(r"[^a-z0-9 ]", "", t)
    return t


for label, coll in (("all records", titles_all), ("city-pinned only", city_titles)):
    n = len(coll)
    exact = len(set(t for t, _ in coll))
    normed = len(set(norm(t) for t, _ in coll))
    dom_title = len(set((norm(t), d) for t, d in coll))
    print(f"  {label}:")
    print(f"    records with a title     {n:,}")
    print(f"    distinct exact titles    {exact:,}  ({pct(exact,n):.1f}%)")
    print(f"    distinct normalized      {normed:,}  ({pct(normed,n):.1f}%)")
    print(f"    syndication multiplier   {n/max(1,normed):.2f}x")
    print()

print("  => per-24h projection from this hour:")
per_h_city = len(city_titles)
per_h_city_distinct = len(set(norm(t) for t, _ in city_titles))
print(f"     city-pinned records / 24h    {per_h_city*24:,.0f}")
print(f"     distinct city stories / 24h  {per_h_city_distinct*24:,.0f}   <- real map feature count")
