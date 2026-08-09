"""Retry all three GDELT access paths (HANDOFF.md 4.1 A/B/C).

Path A: DOC 2.0 API      api.gdeltproject.org/api/v2/doc/doc
Path B: GEO 2.0 API      api.gdeltproject.org/api/v2/geo/geo
Path C: raw GKG files    data.gdeltproject.org/gdeltv2/*.gkg.csv.zip

For GEO, scrape the official announcement post for real example URLs instead of
guessing parameters.
"""
import json, re, sys, time, urllib.request, urllib.parse, html
from datetime import datetime, timezone

UA = "sonder-spike/0.1 (portfolio project; contact matthewcflam@gmail.com)"
BAR = "=" * 72


def get(url, timeout=60, headers=None):
    h = {"User-Agent": UA}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), time.time() - t0, dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), time.time() - t0, dict(e.headers or {})
    except Exception as e:
        return -1, str(e).encode(), time.time() - t0, {}


def show(label, st, body, dt, note=""):
    snip = body[:110].decode("ascii", "replace").replace("\n", " ").replace("\r", " ")
    snip = "".join(c if 32 <= ord(c) < 127 else "." for c in snip)
    print(f"  {label:<34} HTTP {st:<5} {dt:6.2f}s {len(body):>8}B  {snip[:60]}")
    if note:
        print(f"      {note}")


print(f"# Retry run: {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
print()

# ─────────────────────────────────────────────────────────── PATH C: raw GKG
print(BAR)
print("PATH C — RAW GKG FILES  (data.gdeltproject.org)")
print(BAR)

st, body, dt, hdr = get("http://data.gdeltproject.org/gdeltv2/lastupdate.txt", 30)
show("lastupdate.txt", st, body, dt)
gkg_url = None
if st == 200:
    for line in body.decode().strip().splitlines():
        parts = line.split()
        if len(parts) == 3 and parts[2].endswith(".gkg.csv.zip"):
            gkg_url = parts[2]
            print(f"      latest GKG bundle: {gkg_url}")
            print(f"      declared size: {int(parts[0]):,} bytes")

# HTTPS variant
st2, b2, dt2, _ = get("https://data.gdeltproject.org/gdeltv2/lastupdate.txt", 30)
show("lastupdate.txt (https)", st2, b2, dt2)

# translation stream (the one we deliberately do NOT consume)
st3, b3, dt3, _ = get("http://data.gdeltproject.org/gdeltv2/lastupdate-translation.txt", 30)
show("lastupdate-translation.txt", st3, b3, dt3,
     "confirms the English/translingual split exists" if st3 == 200 else "")

# actually pull the bundle header to prove it downloads
if gkg_url:
    st4, b4, dt4, hdr4 = get(gkg_url, 180)
    ok = b4[:2] == b"PK"
    show("GKG bundle download", st4, b4, dt4,
         f"valid ZIP magic: {ok}   throughput: {len(b4)/max(dt4,0.01)/1e6:.1f} MB/s")

# rate-limit probe: 6 back-to-back
print("\n  rate-limit probe, 6 back-to-back lastupdate.txt requests:")
codes = []
for i in range(6):
    s, b, d, _ = get("http://data.gdeltproject.org/gdeltv2/lastupdate.txt", 20)
    codes.append(s)
    print(f"    req {i+1}: HTTP {s}  {d:.3f}s")
print(f"  -> all 200: {all(c == 200 for c in codes)}")
print()

# ─────────────────────────────────────────────────────────── PATH A: DOC 2.0
print(BAR)
print("PATH A — DOC 2.0 API  (api.gdeltproject.org/api/v2/doc/doc)")
print(BAR)

q = urllib.parse.quote('"climate change"')
doc_variants = [
    ("artlist json 1h", f"query={q}&mode=artlist&format=json&maxrecords=20&timespan=1h"),
    ("timelinevol json", f"query={q}&mode=timelinevol&format=json&timespan=1d"),
    ("no mode (default)", f"query={q}&format=json&timespan=1h"),
]
doc_ok = None
for label, qs in doc_variants:
    url = f"https://api.gdeltproject.org/api/v2/doc/doc?{qs}"
    st, body, dt, _ = get(url, 90)
    show(label, st, body, dt)
    if st == 200 and body[:1] in (b"{", b"["):
        doc_ok = (label, body)
    time.sleep(6)   # documented: 1 request / 5 seconds

if doc_ok:
    label, body = doc_ok
    try:
        j = json.loads(body)
        arts = j.get("articles", [])
        print(f"\n  parsed OK ({label}): {len(arts)} articles")
        if arts:
            print(f"  response keys: {sorted(arts[0].keys())}")
            a = arts[0]
            print(f"  sample: {a.get('title','')[:66]}")
            print(f"          {a.get('domain','')}  lang={a.get('language','')}  "
                  f"country={a.get('sourcecountry','')}")
            print(f"  themes present?      {'YES' if any('theme' in k.lower() for k in a) else 'NO'}")
            print(f"  coordinates present? {'YES' if any(k.lower() in ('lat','lon','latitude','longitude') for k in a) else 'NO'}")
    except Exception as e:
        print(f"  parse failed: {e}")
print()

# ─────────────────────────────────────────────────────────── PATH B: GEO 2.0
print(BAR)
print("PATH B — GEO 2.0 API  (api.gdeltproject.org/api/v2/geo/geo)")
print(BAR)

# 1. Scrape the official announcement for real example URLs.
print("  [1] scraping the official announcement post for example URLs...")
st, body, dt, _ = get("https://blog.gdeltproject.org/gdelt-geo-2-0-api-debuts/", 60)
print(f"      doc page: HTTP {st}  {len(body)}B")
found = []
if st == 200:
    txt = html.unescape(body.decode("utf-8", "replace"))
    for m in re.finditer(r"https?://api\.gdeltproject\.org/api/v2/geo/geo\?[^\s\"'<>\)]+", txt):
        u = m.group(0).rstrip(".,;")
        if u not in found:
            found.append(u)
    print(f"      example GEO URLs found in the docs: {len(found)}")
    for u in found[:6]:
        print(f"        {u[:118]}")
print()

# 2. Try the documented examples verbatim.
if found:
    print("  [2] calling the documented examples verbatim:")
    for u in found[:5]:
        st, body, dt, _ = get(u, 60)
        show(u[48:82], st, body, dt)
        time.sleep(6)
else:
    print("  [2] no example URLs recoverable from the docs page")
print()

# 3. Structural probes: is the endpoint there at all?
print("  [3] structural probes:")
probes = [
    ("bare /api/v2/geo/geo", "https://api.gdeltproject.org/api/v2/geo/geo"),
    ("trailing slash",       "https://api.gdeltproject.org/api/v2/geo/geo/"),
    ("http not https",       "http://api.gdeltproject.org/api/v2/geo/geo?query=flood&format=geojson&mode=pointdata"),
    ("query only",           "https://api.gdeltproject.org/api/v2/geo/geo?query=flood"),
    ("pointdata+geojson",    "https://api.gdeltproject.org/api/v2/geo/geo?query=flood&format=geojson&mode=pointdata&timespan=1h"),
    ("sourcelang filter",    "https://api.gdeltproject.org/api/v2/geo/geo?query=" + urllib.parse.quote("flood sourcelang:english") + "&format=geojson&mode=pointdata&timespan=24h"),
    ("html format",          "https://api.gdeltproject.org/api/v2/geo/geo?query=flood&format=html&mode=pointdata&timespan=1h"),
    ("/api/v2/geo/ parent",  "https://api.gdeltproject.org/api/v2/geo/"),
    ("/api/v2/ parent",      "https://api.gdeltproject.org/api/v2/"),
    ("DOC sibling control",  "https://api.gdeltproject.org/api/v2/doc/doc?query=flood&mode=artlist&format=json&maxrecords=1&timespan=1h"),
]
geo_alive = False
for label, u in probes:
    st, body, dt, _ = get(u, 60)
    show(label, st, body, dt)
    if "geo" in u and st == 200 and body[:1] in (b"{", b"["):
        geo_alive = True
        try:
            j = json.loads(body)
            feats = j.get("features", [])
            print(f"      -> {len(feats)} features")
            if feats:
                p = feats[0].get("properties", {})
                print(f"      -> keys: {sorted(p.keys())}")
                print(f"      -> themes?  {'YES' if any('theme' in k.lower() for k in p) else 'NO'}")
                print(f"      -> offsets? {'YES' if any('offset' in k.lower() for k in p) else 'NO'}")
        except Exception:
            pass
    time.sleep(6)

print()
print(BAR)
print("SUMMARY")
print(BAR)
print(f"  Path A  DOC 2.0   {'ALIVE' if doc_ok else 'FAILED'}")
print(f"  Path B  GEO 2.0   {'ALIVE' if geo_alive else 'DEAD (no variant returned parseable data)'}")
print(f"  Path C  raw GKG   {'ALIVE' if gkg_url else 'FAILED'}")
