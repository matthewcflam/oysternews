#!/usr/bin/env bash
# Phase C / E CDN probe. Usage: probe-cdn.sh <public-base-url> [host:port:ip]
# Proves the hazards that fail silently in a browser: Cloudflare compressing
# a ranged PMTiles response, and CORS missing on the 404 path.
#
# The optional second argument pins the host to an IP, bypassing the local
# resolver. Needed when verifying a hostname whose delegation your own network
# has not caught up with: this machine's ISP resolver kept serving a deleted
# wildcard for half an hour after the cutover, so every request landed on the
# old registrar's parking IP and failed TLS. That looks identical to a broken
# custom domain, and it cost a needless rollback. Get the real address from a
# public resolver first: nslookup <host> 1.1.1.1
set -u
BASE="${1:?usage: probe-cdn.sh <public-base-url> [host:port:ip]}"
RESOLVE="${2:-}"
if [ -n "$RESOLVE" ]; then
  set -- --resolve "$RESOLVE"
  printf 'pinned: %s\n\n' "$RESOLVE"
else
  set --
fi
fail=0
say() { printf '%s\n' "$*"; }
# An empty value never passes. Comparing "" to "" reads as equal, which once
# reported PASS against a host whose TLS handshake was failing outright - the
# exact silent success this script exists to catch.
chk() {
  if [ -z "$2" ]; then say "  FAIL  $1: empty (no response)"; fail=1
  elif [ "$2" = "$3" ]; then say "  PASS  $1: $2"
  else say "  FAIL  $1: got '$2' want '$3'"; fail=1; fi
}

say "== manifest =="
if ! man=$(curl -sS "$@" --fail-with-body --max-time 20 "$BASE/manifest.json" 2>&1); then
  say "  FAIL  cannot fetch $BASE/manifest.json"
  say "        $man"
  say ""
  say "ABORTED against $BASE - the host did not answer, so nothing below was tested."
  exit 1
fi
archive=$(printf '%s' "$man" | grep -o '"archive"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"\([^"]*\)"$/\1/')
if [ -z "$archive" ]; then
  say "  FAIL  manifest has no archive key; got: $(printf '%s' "$man" | head -c 200)"
  exit 1
fi
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
h=$(curl -s "$@" -D- -o /dev/null --max-time 30 "$BASE/$archive")
total=$(printf '%s' "$h" | grep -i '^content-length:' | tr -d '\r' | awk '{print $2}')
if [ -z "$total" ]; then
  say "  FAIL  no content-length on HEAD $BASE/$archive"
  exit 1
fi
say "  real size: $total bytes"

say "== range request (the one that matters) =="
r=$(curl -s "$@" -D- -o /dev/null --max-time 30 -H 'Range: bytes=0-16383' "$BASE/$archive")
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
p=$(curl -s "$@" -D- -o /dev/null --max-time 20 -X OPTIONS \
  -H 'Origin: https://oysternews.xyz' -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: range,if-match' "$BASE/$archive")
if printf '%s' "$p" | grep -qi '^access-control-allow-origin:'; then say "  PASS  preflight allows origin"; else say "  FAIL  preflight has no allow-origin"; fail=1; fi

say "== CORS on the 404 path (lib/cities.ts:23 depends on this) =="
n=$(curl -s "$@" -D- -o /dev/null --max-time 20 -H 'Origin: https://oysternews.xyz' "$BASE/archives/definitely-missing.json")
ncode=$(printf '%s' "$n" | head -1 | awk '{print $2}')
chk "404 status" "$ncode" "404"
if printf '%s' "$n" | grep -qi '^access-control-allow-origin:'; then say "  PASS  404 carries allow-origin"; else say "  FAIL  404 lacks allow-origin - fetch rejects before the 404 branch runs"; fail=1; fi

say ""
if [ "$fail" = 0 ]; then say "ALL PASS against $BASE"; else say "FAILURES against $BASE"; fi
exit "$fail"
