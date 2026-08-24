#!/usr/bin/env bash
# Phase C / E CDN probe. Usage: probe-cdn.sh <public-base-url>
# Proves the hazards that fail silently in a browser: Cloudflare compressing
# a ranged PMTiles response, and CORS missing on the 404 path.
set -u
BASE="${1:?usage: probe-cdn.sh <public-base-url>}"
fail=0
say() { printf '%s\n' "$*"; }
chk() { if [ "$2" = "$3" ]; then say "  PASS  $1: $2"; else say "  FAIL  $1: got '$2' want '$3'"; fail=1; fi; }

say "== manifest =="
man=$(curl -s --max-time 20 "$BASE/manifest.json")
archive=$(printf '%s' "$man" | grep -o '"archive"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"\([^"]*\)"$/\1/')
say "  archive key: $archive"
for f in url regionsUrl citiesBase; do
  v=$(printf '%s' "$man" | grep -o "\"$f\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | sed 's/.*"\(https[^"]*\)"$/\1/')
  case "$v" in
    "$BASE"/*) say "  PASS  $f on public base" ;;
    *cloudflarestorage.com*) say "  FAIL  $f points at the S3 endpoint: $v"; fail=1 ;;
    *) say "  FAIL  $f not on $BASE: $v"; fail=1 ;;
  esac
done

say "== HEAD archive =="
h=$(curl -s -D- -o /dev/null --max-time 30 "$BASE/$archive")
total=$(printf '%s' "$h" | grep -i '^content-length:' | tr -d '\r' | awk '{print $2}')
say "  real size: $total bytes"

say "== range request (the one that matters) =="
r=$(curl -s -D- -o /dev/null --max-time 30 -H 'Range: bytes=0-16383' "$BASE/$archive")
code=$(printf '%s' "$r" | head -1 | awk '{print $2}')
clen=$(printf '%s' "$r" | grep -i '^content-length:' | tr -d '\r' | awk '{print $2}')
crange=$(printf '%s' "$r" | grep -i '^content-range:' | tr -d '\r' | awk '{print $2, $3}')
rtotal=$(printf '%s' "$crange" | sed 's|.*/||')
etag=$(printf '%s' "$r" | grep -i '^etag:' | tr -d '\r' | awk '{print $2}')
cc=$(printf '%s' "$r" | grep -i '^cache-control:' | tr -d '\r' | cut -d' ' -f2-)
cenc=$(printf '%s' "$r" | grep -ic '^content-encoding:')
chk "status" "$code" "206"
chk "content-length" "$clen" "16384"
chk "content-range total == real size" "$rtotal" "$total"
chk "no content-encoding" "$cenc" "0"
case "$etag" in W/*) say "  FAIL  weak ETag: $etag"; fail=1 ;; "") say "  FAIL  no ETag"; fail=1 ;; *) say "  PASS  strong ETag: $etag" ;; esac
case "$cc" in *no-transform*) say "  PASS  cache-control has no-transform: $cc" ;; *) say "  FAIL  cache-control lacks no-transform: $cc"; fail=1 ;; esac

say "== CORS preflight =="
p=$(curl -s -D- -o /dev/null --max-time 20 -X OPTIONS \
  -H 'Origin: https://oysternews.xyz' -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: range,if-match' "$BASE/$archive")
if printf '%s' "$p" | grep -qi '^access-control-allow-origin:'; then say "  PASS  preflight allows origin"; else say "  FAIL  preflight has no allow-origin"; fail=1; fi

say "== CORS on the 404 path (lib/cities.ts:23 depends on this) =="
n=$(curl -s -D- -o /dev/null --max-time 20 -H 'Origin: https://oysternews.xyz' "$BASE/archives/definitely-missing.json")
ncode=$(printf '%s' "$n" | head -1 | awk '{print $2}')
chk "404 status" "$ncode" "404"
if printf '%s' "$n" | grep -qi '^access-control-allow-origin:'; then say "  PASS  404 carries allow-origin"; else say "  FAIL  404 lacks allow-origin - fetch rejects before the 404 branch runs"; fail=1; fi

say ""
if [ "$fail" = 0 ]; then say "ALL PASS against $BASE"; else say "FAILURES against $BASE"; fi
exit "$fail"
