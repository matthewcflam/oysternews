"""Phase 1 completion probe — the measurements HANDOFF.md section 5 still lists as open.

Subcommands:
  fetch [n]            download the n most recent GKG bundles (default 4 = 1 hour)
  audit                emit audit_sample.jsonl: 50 random placements + 30 containers
  tier1                tier-1 crawl coverage check
  density              per-country pin density, extrapolated to 24h
  blocklist            top domains in the zero-tier-1 group population
  maturity snapshot    record the current group population to maturity_t0.json
  maturity compare     re-pull and diff against maturity_t0.json (run >=6h later)

Usage:  python phase1_probe.py fetch 4 && python phase1_probe.py audit
Notes:  data.gdeltproject.org fails HTTPS cert verification. HTTP only. See FINDINGS.
"""
import collections
import csv
import datetime as dt
import glob
import html
import io
import json
import math
import os
import random
import re
import sys
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SAMPLES = os.path.join(HERE, "samples")
UA = "sonder-spike/0.1 (portfolio project; contact matthewcflam@gmail.com)"
BASE = "http://data.gdeltproject.org/gdeltv2"  # HTTP: HTTPS cert fails, see FINDINGS
csv.field_size_limit(10_000_000)

# GKG 2.1 column indices. Never materialize V2GCAM (col 17, 69.4% of bytes).
C_DATE, C_SOURCE, C_DOCID, C_THEMES, C_LOC, C_EXTRAS = 1, 3, 4, 8, 10, 26
MIN_COLS = 27  # schema canary: >= 27, indexed from the left (HANDOFF section 5, Phase 3)

TITLE_RE = re.compile(r"<PAGE_TITLE>(.*?)</PAGE_TITLE>", re.S)
TYPE_NAME = {1: "COUNTRY", 2: "US-STATE", 3: "US-CITY", 4: "WORLD-CITY", 5: "ADM1"}

# Tier-1 outlets: wire services and national papers of record. Matched against
# GDELT's SourceCommonName, which is a bare domain.
TIER1 = {
    "nytimes.com", "washingtonpost.com", "wsj.com", "reuters.com", "apnews.com",
    "bbc.com", "bbc.co.uk", "theguardian.com", "ft.com", "economist.com",
    "cnn.com", "nbcnews.com", "cbsnews.com", "abcnews.go.com", "npr.org",
    "bloomberg.com", "aljazeera.com", "afp.com", "politico.com", "latimes.com",
    "usatoday.com", "time.com", "newsweek.com", "telegraph.co.uk",
    "independent.co.uk", "dw.com", "france24.com", "scmp.com",
}


def load_demonyms():
    out = set()
    # Moved to data/ in Phase 2.5, which is the first thing to consume it outside
    # the spike. One copy, two readers.
    path = os.path.join(HERE, "..", "..", "data", "demonyms.txt")
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.split("#")[0].strip()
            if not line:
                continue
            for tok in line.split(","):
                tok = tok.strip().lower()
                if tok:
                    out.add(tok)
    return out


DEMONYMS = load_demonyms()


# ------------------------------------------------------------------ fetching
def fetch(n=4, start=None):
    """Download n bundles working backwards from `start` (YYYYMMDDHHMMSS) or from
    the newest bundle if start is omitted. Volume swings ~2x by time of day, so
    a fair sample needs more than one hour of the clock."""
    os.makedirs(SAMPLES, exist_ok=True)
    if start:
        t = dt.datetime.strptime(start, "%Y%m%d%H%M%S")
    else:
        req = urllib.request.Request(BASE + "/lastupdate.txt", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            last = r.read().decode()
        url = [l.split()[-1] for l in last.strip().split("\n") if "gkg" in l][0]
        stamp = re.search(r"(\d{14})", url).group(1)
        t = dt.datetime.strptime(stamp, "%Y%m%d%H%M%S")
    got = []
    for i in range(n):
        s = (t - dt.timedelta(minutes=15 * i)).strftime("%Y%m%d%H%M%S")
        name = f"{s}.gkg.csv.zip"
        path = os.path.join(SAMPLES, name)
        if os.path.exists(path):
            print(f"  have  {name}")
            got.append(path)
            continue
        req = urllib.request.Request(f"{BASE}/{name}", headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                body = r.read()
        except Exception as e:
            print(f"  MISS  {name}  {e}")
            continue
        with open(path, "wb") as fh:
            fh.write(body)
        print(f"  got   {name}  {len(body)/1e6:.2f} MB")
        got.append(path)
    return got


# ------------------------------------------------------------------- parsing
def parse_locs(field):
    """V2EnhancedLocations -> list of dicts. Format:
    Type#FullName#CountryCode#ADM1Code#ADM2Code#Lat#Long#FeatureID#CharOffset"""
    out = []
    for chunk in field.split(";"):
        p = chunk.split("#")
        if len(p) < 9:
            continue
        try:
            typ = int(p[0])
            lat, lon = float(p[5]), float(p[6])
        except ValueError:
            continue
        try:
            off = int(p[8])
        except ValueError:
            off = None
        out.append({
            "type": typ, "name": p[1], "cc": p[2], "adm1": p[3], "adm2": p[4],
            "lat": lat, "lon": lon, "fid": p[7], "off": off,
        })
    return out


def records(paths=None, limit_cols=True):
    """Yield parsed records from every downloaded bundle."""
    paths = paths or sorted(glob.glob(os.path.join(SAMPLES, "*.gkg.csv.zip")))
    for path in paths:
        with zipfile.ZipFile(path) as z:
            with z.open(z.namelist()[0]) as fh:
                text = io.TextIOWrapper(fh, encoding="utf-8", errors="replace", newline="")
                for row in csv.reader(text, delimiter="\t", quoting=csv.QUOTE_NONE):
                    if len(row) < MIN_COLS:
                        continue
                    m = TITLE_RE.search(row[C_EXTRAS])
                    title = html.unescape(m.group(1).strip()) if m else ""
                    yield {
                        "date": row[C_DATE],
                        "domain": row[C_SOURCE].strip().lower(),
                        "url": row[C_DOCID],
                        "title": title,
                        "themes": [t.split(",")[0] for t in row[C_THEMES].split(";") if t],
                        "locs": parse_locs(row[C_LOC]),
                        "bundle": os.path.basename(path)[:14],
                    }


# ------------------------------------------------------- placement (2.1/2.5)
def is_demonym(name):
    """GDELT FullName is 'Name, ADM1, Country' for cities and states but a bare
    name for countries — so 'Texans, United States' and 'Americans' both need to
    match. Compare the FIRST comma segment only. Matching the whole string, which
    is the obvious implementation, silently misses every US-state demonym."""
    return name.split(",")[0].strip().lower() in DEMONYMS


def place(rec):
    """placeStory() as specified in HANDOFF section 2.1, with the demonym filter
    of FINDINGS section 5 running first. Returns (kind, loc) where kind is
    PIN | CONTAINER | DROP."""
    locs = [l for l in rec["locs"] if not is_demonym(l["name"])]
    if not locs:
        return ("DROP", None)

    def most_repeated(cands):
        # highest specificity already applied by the caller; then most repeated,
        # tie-broken by earliest character offset
        counts = collections.Counter(l["fid"] for l in cands)
        best = max(cands, key=lambda l: (counts[l["fid"]], -(l["off"] if l["off"] is not None else 10**9)))
        return best

    city = [l for l in locs if l["type"] in (3, 4)]
    if city:
        return ("PIN", most_repeated(city))
    adm1 = [l for l in locs if l["type"] in (2, 5)]
    if adm1:
        return ("CONTAINER", most_repeated(adm1))
    country = [l for l in locs if l["type"] == 1]
    if country:
        return ("CONTAINER", most_repeated(country))
    return ("DROP", None)


def place_dominance(rec):
    """Rule D — dominance first, specificity second. The audit showed the spec's
    specificity-first rule repeatedly picks a city mentioned once over a state or
    country mentioned four or more times (Chicago x1 over Minnesota x4; Dogwood TN
    x1 over Kentucky x4; London x4 over United Kingdom x14). Rule D picks the most
    mentioned location and lets its own type decide pin vs container."""
    locs = [l for l in rec["locs"] if not is_demonym(l["name"])]
    if not locs:
        return ("DROP", None)
    counts = collections.Counter(l["name"] for l in locs)
    best = max(locs, key=lambda l: (counts[l["name"]],
                                    -(l["off"] if l["off"] is not None else 10**9)))
    return ("PIN" if best["type"] in (3, 4) else "CONTAINER", best)


def place_hybrid(rec):
    """Rule H — specificity wins unless it is dominated.

    Rule S (the spec's) pins a city mentioned once over a state mentioned four
    times. Rule D fixes that but collapses 75% of stories to country containers,
    because a domestic article names its own country constantly. Rule H keeps the
    city pin unless a broader region out-mentions it by a margin, and the margins
    differ by level because countries are structurally over-mentioned:

        ADM1 >= 2x the best city  -> the story is about the region, not the city
        country >= 3x             -> the story is national

    Every constant here is fitted to the 110 hand-judged records in
    audit_judged.jsonl and is therefore in-sample. It needs the fresh out-of-sample
    draw to mean anything."""
    locs = [l for l in rec["locs"] if not is_demonym(l["name"])]
    if not locs:
        return ("DROP", None)
    counts = collections.Counter(l["name"] for l in locs)

    def best(types):
        c = [l for l in locs if l["type"] in types]
        if not c:
            return None
        return max(c, key=lambda l: (counts[l["name"]],
                                     -(l["off"] if l["off"] is not None else 10**9)))

    city, adm, country = best((3, 4)), best((2, 5)), best((1,))
    if city:
        if adm and counts[adm["name"]] >= 2 * counts[city["name"]]:
            return ("CONTAINER", adm)
        if country and counts[country["name"]] >= 3 * counts[city["name"]]:
            return ("CONTAINER", country)
        return ("PIN", city)
    if adm:
        return ("CONTAINER", adm)
    if country:
        return ("CONTAINER", country)
    return ("DROP", None)


def norm_title(t):
    t = re.sub(r"\s+", " ", t.lower()).strip()
    return re.sub(r"[^a-z0-9 ]", "", t)


def placed_records():
    """Everything the pipeline would publish: has a title, has a placement."""
    seen = set()
    for rec in records():
        if not rec["title"]:
            continue
        kind, loc = place(rec)
        if kind == "DROP":
            continue
        key = norm_title(rec["title"])
        if key in seen:  # title dedup, per section 2.5
            continue
        seen.add(key)
        rec["kind"], rec["loc"] = kind, loc
        yield rec


# ------------------------------------------------------------------- reports
def wilson(k, n, z=1.96):
    if n == 0:
        return (0.0, 0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (p, max(0.0, c - h), min(1.0, c + h))


def cmd_audit():
    pool = list(placed_records())
    pins = [r for r in pool if r["kind"] == "PIN"]
    cons = [r for r in pool if r["kind"] == "CONTAINER"]
    print(f"  publishable population: {len(pool):,}  ({len(pins):,} pin / {len(cons):,} container)")
    rnd = random.Random(20260808)  # fixed seed: the sample is reproducible evidence
    main = rnd.sample(pool, min(50, len(pool)))
    extra_pool = [r for r in cons if r not in main]
    extra = rnd.sample(extra_pool, min(30, len(extra_pool)))

    def row(r, stratum):
        l = r["loc"]
        return {
            "stratum": stratum,
            "kind": r["kind"],
            "title": r["title"],
            "domain": r["domain"],
            "url": r["url"],
            "placed_at": l["name"],
            "loc_type": TYPE_NAME.get(l["type"], l["type"]),
            "cc": l["cc"],
            "adm1": l["adm1"],
            "coords": [round(l["lat"], 4), round(l["lon"], 4)],
            "all_locs": [f'{TYPE_NAME.get(x["type"], x["type"])}:{x["name"]}' for x in r["locs"][:8]],
            "verdict": None,  # CORRECT | WRONG | UNJUDGEABLE — filled in by hand
        }

    out = os.path.join(HERE, "audit_sample.jsonl")
    with open(out, "w", encoding="utf-8") as fh:
        for r in main:
            fh.write(json.dumps(row(r, "main50"), ensure_ascii=False) + "\n")
        for r in extra:
            fh.write(json.dumps(row(r, "container30"), ensure_ascii=False) + "\n")
    print(f"  wrote {out}: {len(main)} main + {len(extra)} supplementary containers")


def cmd_audit_more(kind="PIN", n=30):
    """Draw an additional disjoint sample of one placement kind. Used because the
    unstratified 50 yielded only 32 judgeable PINs — too few for the interval the
    abort criterion in HANDOFF section 5.1 assumes. Thresholds are NOT changed;
    only the sample size is."""
    already = set()
    for name in ("audit_sample.jsonl", "audit_judged.jsonl"):
        p = os.path.join(HERE, name)
        if os.path.exists(p):
            already |= {json.loads(l)["url"] for l in open(p, encoding="utf-8") if l.strip()}
    pool = [r for r in placed_records() if r["kind"] == kind and r["url"] not in already]
    rnd = random.Random(20260809)
    draw = rnd.sample(pool, min(n, len(pool)))
    out = os.path.join(HERE, f"audit_sample_{kind.lower()}2.jsonl")
    with open(out, "w", encoding="utf-8") as fh:
        for r in draw:
            l = r["loc"]
            fh.write(json.dumps({
                "stratum": f"{kind.lower()}2", "kind": kind, "title": r["title"],
                "domain": r["domain"], "url": r["url"], "placed_at": l["name"],
                "loc_type": TYPE_NAME.get(l["type"], l["type"]), "cc": l["cc"],
                "adm1": l["adm1"], "coords": [round(l["lat"], 4), round(l["lon"], 4)],
                "all_locs": [f'{TYPE_NAME.get(x["type"], x["type"])}:{x["name"]}' for x in r["locs"][:8]],
                "verdict": None, "failure": None,
            }, ensure_ascii=False) + "\n")
    print(f"  wrote {out}: {len(draw)} additional {kind} placements")


def cmd_score():
    """Score audit_judged.jsonl once the verdict field is filled in."""
    path = os.path.join(HERE, "audit_judged.jsonl")
    rows = [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]
    groups = {
        "main50 — PIN": [r for r in rows if r["stratum"] == "main50" and r["kind"] == "PIN"],
        "main50 — CONTAINER": [r for r in rows if r["stratum"] == "main50" and r["kind"] == "CONTAINER"],
        "all CONTAINER (stratified)": [r for r in rows if r["kind"] == "CONTAINER"],
        "main50 — overall": [r for r in rows if r["stratum"] == "main50"],
    }
    for label, g in groups.items():
        judged = [r for r in g if r["verdict"] in ("CORRECT", "WRONG")]
        unj = len(g) - len(judged)
        k = sum(1 for r in judged if r["verdict"] == "CORRECT")
        p, lo, hi = wilson(k, len(judged))
        print(f"  {label:<28} {k}/{len(judged)} = {p*100:5.1f}%  "
              f"95% CI [{lo*100:.1f}%, {hi*100:.1f}%]   unjudgeable {unj}")


def cmd_tier1():
    per_domain = collections.Counter()
    total = 0
    for rec in records():
        total += 1
        per_domain[rec["domain"]] += 1
    t1 = {d: per_domain.get(d, 0) for d in sorted(TIER1)}
    hits = sum(t1.values())
    print(f"  records {total:,}   distinct domains {len(per_domain):,}")
    print(f"  tier-1 records {hits:,} = {100*hits/max(1,total):.2f}% of the feed")
    print("  per outlet (records in window / extrapolated per 24h):")
    for d, c in sorted(t1.items(), key=lambda x: -x[1]):
        hours = len(glob.glob(os.path.join(SAMPLES, "*.zip"))) / 4
        print(f"    {c:>5}  {c/max(hours,0.01)*24:>7.0f}/day  {d}")
    print("  top 15 domains overall, for contrast:")
    for d, c in per_domain.most_common(15):
        mark = " *tier1" if d in TIER1 else ""
        print(f"    {c:>5}  {100*c/total:5.2f}%  {d}{mark}")


def cmd_density():
    hours = max(len(glob.glob(os.path.join(SAMPLES, "*.zip"))) / 4, 0.01)
    per_cc = collections.Counter()
    kinds = collections.Counter()
    for rec in placed_records():
        kinds[rec["kind"]] += 1
        per_cc[rec["loc"]["cc"] or "??"] += 1
    tot = sum(per_cc.values())
    print(f"  placed stories in window: {tot:,}  {dict(kinds)}")
    print(f"  extrapolated to 24h: {tot/hours*24:,.0f}")
    print("  top 25 countries (FIPS code, window count, per-24h):")
    for cc, c in per_cc.most_common(25):
        print(f"    {cc:<3} {c:>5}  {c/hours*24:>8.0f}/day  {100*c/tot:5.2f}%")
    buckets = collections.Counter()
    for cc, c in per_cc.items():
        d = c / hours * 24
        b = ("1000+" if d >= 1000 else "100-999" if d >= 100 else
             "10-99" if d >= 10 else "1-9" if d >= 1 else "<1")
        buckets[b] += 1
    print("  countries by daily story count:")
    for b in ("1000+", "100-999", "10-99", "1-9", "<1"):
        print(f"    {b:<8} {buckets[b]:>4} countries")


def group_key(rec):
    """Cheap stand-in for the section 2.5 grouping rule: normalized title.
    Good enough to find the zero-tier-1 population; real grouping is Phase 3."""
    return norm_title(rec["title"])


def cmd_blocklist():
    groups = collections.defaultdict(list)
    for rec in records():
        if rec["title"]:
            groups[group_key(rec)].append(rec)
    zero = {k: v for k, v in groups.items() if not any(r["domain"] in TIER1 for r in v)}
    print(f"  title-groups {len(groups):,}   zero-tier-1 groups {len(zero):,} "
          f"({100*len(zero)/max(1,len(groups)):.1f}%)")
    dom = collections.Counter()
    for v in zero.values():
        for r in v:
            dom[r["domain"]] += 1
    print("  top 30 domains in the zero-tier-1 population:")
    for d, c in dom.most_common(30):
        print(f"    {c:>5}  {d}")


def cmd_maturity(mode):
    path = os.path.join(HERE, "maturity_t0.json")
    if mode == "snapshot":
        groups = collections.defaultdict(list)
        for rec in records():
            if rec["title"]:
                groups[group_key(rec)].append(rec)
        snap = {
            "taken": dt.datetime.utcnow().isoformat() + "Z",
            "bundles": sorted({r["bundle"] for v in groups.values() for r in v}),
            "groups": {k: {"n": len(v), "tier1": sum(1 for r in v if r["domain"] in TIER1),
                           "domains": sorted({r["domain"] for r in v}),
                           "title": v[0]["title"]}
                       for k, v in groups.items()},
        }
        json.dump(snap, open(path, "w", encoding="utf-8"), ensure_ascii=False)
        z = sum(1 for g in snap["groups"].values() if g["tier1"] == 0)
        print(f"  snapshot written: {len(snap['groups']):,} groups, {z:,} with zero tier-1")
        print(f"  re-run 'maturity compare' at least 6h from now ({snap['taken']})")
        return
    snap = json.load(open(path, encoding="utf-8"))
    print(f"  t0 = {snap['taken']}   now = {dt.datetime.utcnow().isoformat()}Z")
    now = collections.defaultdict(list)
    for rec in records():
        if rec["title"]:
            now[group_key(rec)].append(rec)
    old_zero = {k: g for k, g in snap["groups"].items() if g["tier1"] == 0}
    matured = rejoined = still = 0
    for k, g in old_zero.items():
        if k in now:
            rejoined += 1
            if any(r["domain"] in TIER1 for r in now[k]):
                matured += 1
            else:
                still += 1
    print(f"  t0 groups {len(snap['groups']):,}   zero-tier-1 at t0 {len(old_zero):,}")
    print(f"  of those, reappearing in the later window: {rejoined:,}")
    print(f"    picked up a tier-1 outlet since: {matured:,}")
    print(f"    still zero-tier-1:               {still:,}")
    print("  NOTE: only groups republished in the later window are observable this way;")
    print("        a group that matured but stopped being republished is invisible.")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"
    if cmd == "fetch":
        fetch(int(sys.argv[2]) if len(sys.argv) > 2 else 4,
              sys.argv[3] if len(sys.argv) > 3 else None)
    elif cmd == "audit":
        cmd_audit()
    elif cmd == "score":
        cmd_score()
    elif cmd == "tier1":
        cmd_tier1()
    elif cmd == "density":
        cmd_density()
    elif cmd == "blocklist":
        cmd_blocklist()
    elif cmd == "maturity":
        cmd_maturity(sys.argv[2] if len(sys.argv) > 2 else "snapshot")
    else:
        print(__doc__)
