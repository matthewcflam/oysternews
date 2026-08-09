"""Sonder spike: GDELT GKG 2.0 reality check.

Downloads N consecutive 15-minute GKG bundles, parses them, and reports the
numbers the design doc depends on. Saves raw bundles to disk so re-running the
analysis never re-hits GDELT.
"""
import csv, io, json, os, re, sys, time, zipfile, urllib.request, html
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

UA = "sonder-spike/0.1 (portfolio project; contact matthewcflam@gmail.com)"
RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "samples")
os.makedirs(RAW, exist_ok=True)
csv.field_size_limit(10_000_000)

# GKG 2.1 column indices (0-based)
C_ID, C_DATE, C_COLL, C_SOURCE, C_DOCID = 0, 1, 2, 3, 4
C_V1THEMES, C_V2THEMES = 7, 8
C_V1LOC, C_V2LOC = 9, 10
C_TONE = 15
C_SHAREIMG = 18
C_TRANSINFO = 25
C_EXTRAS = 26

GOV_PREFIXES = (
    "EPU_POLICY", "GENERAL_GOVERNMENT", "LEGISLATION", "ELECTION",
    "DEMOCRACY", "CONSTITUTIONAL", "TAX_FNCACT_MINISTER",
    "TAX_FNCACT_PRESIDENT", "TAX_FNCACT_SENATOR", "TAX_FNCACT_GOVERNOR",
    "TAX_FNCACT_LAWMAKER", "TAX_FNCACT_LEGISLATOR", "GOV_",
)


def bundle_urls(n):
    """The n most recent completed 15-minute slots, oldest first."""
    now = datetime.now(timezone.utc)
    slot = now.replace(minute=(now.minute // 15) * 15, second=0, microsecond=0)
    slot -= timedelta(minutes=15)  # last completed
    out = []
    for i in range(n - 1, -1, -1):
        t = slot - timedelta(minutes=15 * i)
        out.append(t.strftime("%Y%m%d%H%M%S"))
    return out


def fetch(stamp):
    path = os.path.join(RAW, f"{stamp}.gkg.csv.zip")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path, 0.0, True
    url = f"http://data.gdeltproject.org/gdeltv2/{stamp}.gkg.csv.zip"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    dt = time.time() - t0
    with open(path, "wb") as f:
        f.write(data)
    return path, dt, False


def rows(path):
    with zipfile.ZipFile(path) as z:
        name = z.namelist()[0]
        with z.open(name) as fh:
            text = io.TextIOWrapper(fh, encoding="utf-8", errors="replace", newline="")
            for r in csv.reader(text, delimiter="\t", quoting=csv.QUOTE_NONE):
                if len(r) >= 27:
                    yield r


TITLE_RE = re.compile(r"<PAGE_TITLE>(.*?)</PAGE_TITLE>", re.S)


def parse_locs(field):
    """V2EnhancedLocations: type#name#cc#adm1#adm2#lat#lon#featureid#offset"""
    out = []
    for chunk in field.split(";"):
        if not chunk:
            continue
        p = chunk.split("#")
        if len(p) < 8:
            continue
        try:
            t = int(p[0])
            lat = float(p[5]); lon = float(p[6])
        except ValueError:
            continue
        off = None
        if len(p) >= 9:
            try:
                off = int(p[8])
            except ValueError:
                pass
        out.append({"type": t, "name": p[1], "cc": p[2], "adm1": p[3],
                    "lat": lat, "lon": lon, "fid": p[7], "off": off})
    return out


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 4
    stamps = bundle_urls(n)
    print(f"# Fetching {n} bundles: {stamps[0]} .. {stamps[-1]}\n")

    paths, timings, zipbytes = [], [], 0
    for s in stamps:
        try:
            p, dt, cached = fetch(s)
            paths.append(p)
            zipbytes += os.path.getsize(p)
            if not cached:
                timings.append(dt)
            print(f"  {s}  {os.path.getsize(p)/1e6:6.2f} MB  "
                  f"{'cached' if cached else f'{dt:5.2f}s'}")
        except Exception as e:
            print(f"  {s}  FAILED: {e}")
    print()

    total = 0
    title_present = title_nonempty = 0
    trans_info = 0
    has_v2loc = has_v1loc = 0
    loctype = Counter()
    best_type = Counter()          # most specific location type per record
    city_records = 0
    gov_records = 0
    gov_and_country_only = 0
    domains = Counter()
    theme_docfreq = Counter()
    has_image = 0
    offsets_present = 0
    multi_loc = Counter()
    samples = []
    city_samples = []
    gov_samples = []

    for p in paths:
        for r in rows(p):
            total += 1
            extras = r[C_EXTRAS]
            m = TITLE_RE.search(extras)
            if m is not None:
                title_present += 1
                if m.group(1).strip():
                    title_nonempty += 1
            if r[C_TRANSINFO].strip():
                trans_info += 1
            if r[C_SHAREIMG].strip():
                has_image += 1
            dom = r[C_SOURCE].strip().lower()
            if dom:
                domains[dom] += 1

            themes = set(t.split(",")[0] for t in r[C_V2THEMES].split(";") if t)
            for t in themes:
                if t:
                    theme_docfreq[t] += 1
            is_gov = any(t.startswith(GOV_PREFIXES) for t in themes)
            if is_gov:
                gov_records += 1

            if r[C_V1LOC].strip():
                has_v1loc += 1
            locs = parse_locs(r[C_V2LOC])
            if locs:
                has_v2loc += 1
                multi_loc[min(len(locs), 6)] += 1
                types = set()
                for L in locs:
                    loctype[L["type"]] += 1
                    types.add(L["type"])
                    if L["off"] is not None:
                        offsets_present += 1
                # specificity: city (3,4) > adm1 (2,5) > country (1)
                if types & {3, 4}:
                    b = 3
                    city_records += 1
                elif types & {2, 5}:
                    b = 2
                else:
                    b = 1
                best_type[b] += 1
                if is_gov and b == 1:
                    gov_and_country_only += 1

                title = html.unescape(m.group(1).strip()) if m else ""
                rec = {"title": title, "domain": dom, "url": r[C_DOCID],
                       "locs": [(L["type"], L["name"], L["off"]) for L in locs[:5]],
                       "gov": is_gov, "best": b}
                if len(samples) < 400:
                    samples.append(rec)
                if b == 3 and len(city_samples) < 200:
                    city_samples.append(rec)
                if is_gov and b in (1, 2) and len(gov_samples) < 100:
                    gov_samples.append(rec)

    pct = lambda a, b: (100.0 * a / b) if b else 0.0

    print("=" * 62)
    print("VOLUME")
    print("=" * 62)
    mins = 15 * len(paths)
    print(f"  bundles parsed            {len(paths)}  ({mins} min of coverage)")
    print(f"  zipped bytes              {zipbytes/1e6:.1f} MB")
    if timings:
        print(f"  download p50 / max        {sorted(timings)[len(timings)//2]:.2f}s / {max(timings):.2f}s")
    print(f"  total GKG records         {total:,}")
    print(f"  per 15 min                {total/max(1,len(paths)):,.0f}")
    print(f"  extrapolated per day      {total/max(1,len(paths))*96:,.0f}")
    print()
    print(f"  has V2EnhancedLocations   {has_v2loc:,}  ({pct(has_v2loc,total):.1f}%)")
    print(f"  has V1Locations           {has_v1loc:,}  ({pct(has_v1loc,total):.1f}%)")
    print(f"  CITY-level (type 3 or 4)  {city_records:,}  ({pct(city_records,total):.1f}%)")
    print(f"  -> city records per day   {city_records/max(1,len(paths))*96:,.0f}")
    print(f"  -> per 24h window         {city_records/max(1,len(paths))*96:,.0f}")
    print()

    print("=" * 62)
    print("TITLES  (design doc claims 99.8%)")
    print("=" * 62)
    print(f"  <PAGE_TITLE> tag present  {title_present:,}  ({pct(title_present,total):.1f}%)")
    print(f"  non-empty title           {title_nonempty:,}  ({pct(title_nonempty,total):.1f}%)")
    print()

    print("=" * 62)
    print("LANGUAGE  (English filter = this stream, not -translation)")
    print("=" * 62)
    print(f"  V2.1TranslationInfo set   {trans_info:,}  ({pct(trans_info,total):.1f}%)")
    print("  (non-empty => translated from another language)")
    print()

    print("=" * 62)
    print("LOCATION QUALITY")
    print("=" * 62)
    names = {1: "1 country", 2: "2 US state", 3: "3 US city",
             4: "4 world city", 5: "5 world state/ADM1"}
    print("  location mentions by type:")
    for t, c in sorted(loctype.items()):
        print(f"    {names.get(t, t):<20} {c:>8,}  ({pct(c,sum(loctype.values())):5.1f}%)")
    print("\n  MOST SPECIFIC type per record (this is what pins the story):")
    bn = {3: "city  -> pin at city", 2: "adm1  -> pin at state capital",
          1: "country -> pin at national capital"}
    for b in (3, 2, 1):
        print(f"    {bn[b]:<34} {best_type[b]:>7,}  ({pct(best_type[b],has_v2loc):5.1f}% of geo records)")
    print(f"\n  char offsets present      {offsets_present:,} mentions")
    print("  locations per record:")
    for k in sorted(multi_loc):
        lbl = f"{k}" if k < 6 else "6+"
        print(f"    {lbl:>3} location(s)          {multi_loc[k]:>7,}  ({pct(multi_loc[k],has_v2loc):5.1f}%)")
    print()

    print("=" * 62)
    print("GOVERNANCE PINNING  (feature 2)")
    print("=" * 62)
    print(f"  governance-themed records {gov_records:,}  ({pct(gov_records,total):.1f}%)")
    print(f"  gov + country-level only  {gov_and_country_only:,}")
    print("    ^ these are the records the governance rule RESCUES")
    print("      (previously discarded as 'unusable centroid')")
    print(f"    as % of all geo records  {pct(gov_and_country_only,has_v2loc):.1f}%")
    print()

    print("=" * 62)
    print("SOURCES")
    print("=" * 62)
    print(f"  distinct domains          {len(domains):,}")
    print(f"  top 25 by volume:")
    for d, c in domains.most_common(25):
        print(f"    {c:>5}  {d}")
    top50 = sum(c for _, c in domains.most_common(50))
    print(f"\n  top-50 domains = {pct(top50,total):.1f}% of all records")
    singles = sum(1 for d, c in domains.items() if c == 1)
    print(f"  domains with 1 record     {singles:,}  ({pct(singles,len(domains)):.1f}% of domains)")
    print()

    print("=" * 62)
    print("THEMES  (frequency ceiling for blindspot grouping)")
    print("=" * 62)
    print(f"  distinct themes           {len(theme_docfreq):,}")
    print("  top 20 by document frequency:")
    for t, c in theme_docfreq.most_common(20):
        print(f"    {pct(c,total):5.1f}%  {t}")
    over20 = sum(1 for t, c in theme_docfreq.items() if pct(c, total) > 20)
    over5 = sum(1 for t, c in theme_docfreq.items() if pct(c, total) > 5)
    print(f"\n  themes above 20% doc freq {over20}   <- excluded by grouping rule")
    print(f"  themes above  5% doc freq {over5}")
    print()

    print(f"  V2.1SharingImage present  {has_image:,}  ({pct(has_image,total):.1f}%)")
    print()

    with open(os.path.join(RAW, "..", "samples_all.json"), "w", encoding="utf-8") as f:
        json.dump({"samples": samples, "city": city_samples, "gov": gov_samples},
                  f, ensure_ascii=False, indent=1)
    print(f"[saved {len(samples)} samples / {len(city_samples)} city / "
          f"{len(gov_samples)} gov to samples_all.json]")


if __name__ == "__main__":
    main()
