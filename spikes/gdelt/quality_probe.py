"""Sonder spike part 2: geotag quality eyeball, syndication check, API probes."""
import json, os, re, time, urllib.request, urllib.parse, collections, zipfile, io, csv, html

HERE = os.path.dirname(os.path.abspath(__file__))
UA = "sonder-spike/0.1 (portfolio project; contact matthewcflam@gmail.com)"
D = json.load(open(os.path.join(HERE, "samples_all.json"), encoding="utf-8"))
TN = {1: "COUNTRY", 2: "US-STATE", 3: "US-CITY", 4: "WORLD-CITY", 5: "ADM1"}

print("=" * 70)
print("A.  GEOTAG EYEBALL — 20 city-pinned records, primary loc by two rules")
print("=" * 70)
print("   rule L = lowest char offset (first mentioned)  <- doc says this is the dateline trap")
print("   rule S = highest specificity, then most repeated  <- doc's chosen default")
print()
for r in D["city"][:20]:
    locs = r["locs"]
    city = [l for l in locs if l[0] in (3, 4)]
    withoff = [l for l in locs if l[2] is not None]
    ruleL = min(withoff, key=lambda l: l[2])[1] if withoff else "?"
    ruleS = city[0][1] if city else "?"
    flag = "  <-- DIFFER" if ruleL != ruleS else ""
    print(f"  {r['title'][:72]}")
    print(f"     {r['domain']}")
    print(f"     L={ruleL[:34]:<34} S={ruleS[:34]}{flag}")
    print(f"     all: {', '.join(f'{TN.get(t,t)[:5]}:{n[:22]}' for t,n,o in locs[:4])}")
    print()

print("=" * 70)
print("B.  RULE DISAGREEMENT RATE across all city samples")
print("=" * 70)
diff = same = 0
datelineish = collections.Counter()
for r in D["city"]:
    locs = r["locs"]
    city = [l for l in locs if l[0] in (3, 4)]
    withoff = [l for l in locs if l[2] is not None]
    if not city or not withoff:
        continue
    L = min(withoff, key=lambda l: l[2])
    S = city[0]
    if L[1] == S[1]:
        same += 1
    else:
        diff += 1
        datelineish[L[1]] += 1
tot = same + diff
print(f"  agree {same}/{tot} ({100*same/max(1,tot):.1f}%)   disagree {diff}/{tot} ({100*diff/max(1,tot):.1f}%)")
print("  most common 'first mentioned' location when the two rules disagree:")
for n, c in datelineish.most_common(12):
    print(f"    {c:>3}  {n}")
print()

print("=" * 70)
print("C.  GOVERNANCE SAMPLES — country/state-only records the rule would rescue")
print("=" * 70)
for r in D["gov"][:12]:
    print(f"  [{'country' if r['best']==1 else 'adm1'}] {r['title'][:66]}")
    print(f"      {r['domain']}  ::  {', '.join(f'{TN.get(t,t)[:7]}:{n[:20]}' for t,n,o in r['locs'][:3])}")
print()

print("=" * 70)
print("D.  SYNDICATION / JUNK — iheart.com dominance check")
print("=" * 70)
ih = [r for r in D["samples"] if "iheart" in r["domain"]]
print(f"  iheart records in sample: {len(ih)}/{len(D['samples'])}")
titles = collections.Counter(r["title"] for r in ih)
print(f"  distinct titles among them: {len(titles)}")
print("  most repeated titles:")
for t, c in titles.most_common(6):
    print(f"    {c:>3}x  {t[:64]}")
print()
alltitles = collections.Counter(r["title"] for r in D["samples"] if r["title"])
dupes = [(t, c) for t, c in alltitles.items() if c > 1]
print(f"  ALL sources: {len(dupes)} titles appear more than once "
      f"({sum(c for _,c in dupes)} records = "
      f"{100*sum(c for _,c in dupes)/max(1,len(D['samples'])):.1f}% of sample)")
for t, c in sorted(dupes, key=lambda x: -x[1])[:8]:
    print(f"    {c:>3}x  {t[:64]}")
print()

print("=" * 70)
print("E.  LANGUAGE SPOT-CHECK — non-ASCII titles in the 'English' stream")
print("=" * 70)
nonascii = [r for r in D["samples"] if r["title"] and any(ord(c) > 127 for c in r["title"])]
print(f"  titles with non-ASCII chars: {len(nonascii)}/{len(D['samples'])} "
      f"({100*len(nonascii)/max(1,len(D['samples'])):.1f}%)")
for r in nonascii[:10]:
    print(f"    {r['domain'][:26]:<26} {r['title'][:56]}")
print()

# ---------------------------------------------------------------- API probes
def get(url, timeout=45):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            return r.status, body, time.time() - t0
    except urllib.error.HTTPError as e:
        return e.code, e.read(), time.time() - t0
    except Exception as e:
        return -1, str(e).encode(), time.time() - t0


print("=" * 70)
print("F.  DOC 2.0 API — is it usable at all?")
print("=" * 70)
q = urllib.parse.quote('sourcelang:english "climate"')
url = (f"https://api.gdeltproject.org/api/v2/doc/doc?query={q}"
       f"&mode=artlist&format=json&maxrecords=50&timespan=1h")
for i in range(3):
    st, body, dt = get(url)
    head = body[:180].decode("utf-8", "replace").replace("\n", " ")
    print(f"  attempt {i+1}: HTTP {st}  {dt:.2f}s  {len(body)}B  :: {head[:150]}")
    if st == 200:
        try:
            j = json.loads(body)
            arts = j.get("articles", [])
            print(f"    -> {len(arts)} articles; keys = {sorted(arts[0].keys()) if arts else 'none'}")
            if arts:
                print(f"    -> sample title: {arts[0].get('title','')[:70]}")
                print(f"    -> has theme codes? {'YES' if any('theme' in k.lower() for k in arts[0]) else 'NO'}")
        except Exception as e:
            print(f"    -> parse failed: {e}")
        break
    time.sleep(6)
print()

print("=" * 70)
print("G.  GEO 2.0 API — does pointdata carry themes / offsets?")
print("=" * 70)
q2 = urllib.parse.quote('sourcelang:english "flood"')
url2 = (f"https://api.gdeltproject.org/api/v2/geo/geo?query={q2}"
        f"&format=geojson&mode=pointdata&timespan=1h")
st, body, dt = get(url2)
print(f"  HTTP {st}  {dt:.2f}s  {len(body)}B")
if st == 200:
    try:
        j = json.loads(body)
        feats = j.get("features", [])
        print(f"  -> {len(feats)} features")
        if feats:
            p = feats[0].get("properties", {})
            print(f"  -> property keys: {sorted(p.keys())}")
            for k, v in p.items():
                print(f"       {k}: {str(v)[:110]}")
            print(f"  -> THEME CODES PRESENT? "
                  f"{'YES' if any('theme' in k.lower() for k in p) else 'NO  <-- forces raw GKG'}")
            print(f"  -> CHAR OFFSETS PRESENT? "
                  f"{'YES' if any('offset' in k.lower() for k in p) else 'NO  <-- forces raw GKG'}")
    except Exception as e:
        print(f"  -> parse failed: {e}  :: {body[:200]}")
else:
    print(f"  body: {body[:250].decode('utf-8','replace')}")
print()

print("=" * 70)
print("H.  RATE LIMIT PROBE — 5 rapid GKG-adjacent requests")
print("=" * 70)
for i in range(5):
    st, body, dt = get("http://data.gdeltproject.org/gdeltv2/lastupdate.txt", timeout=20)
    print(f"  req {i+1}: HTTP {st}  {dt:.2f}s  {len(body)}B")
