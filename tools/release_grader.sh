#!/usr/bin/env bash
# Publish a new grader build and move everything that depends on its hash.
#
# Sealed sets are locked to one build, and the contract pins one version.
# A new build can't take over at once: the owner proposes it, it waits 24
# hours in public (config().pending_grader), and only then can it be applied.
#
#   step 1, propose:   OWNER=... CONTRACT=app.proctor-91796.testnet tools/release_grader.sh
#   step 2, 24h later: OWNER=... CONTRACT=... APPLY=1 tools/release_grader.sh money-a money-b ...
#
# Step 2 re-locks each set to the new hash, applies it on the contract and
# removes the old version so nobody can pin it.
set -euo pipefail

OWNER=${OWNER:?set OWNER}
CONTRACT=${CONTRACT:?set CONTRACT}
cd "$(dirname "$0")/../grader"

old=$(near contract call-function as-read-only "$CONTRACT" config json-args '{}' network-config testnet now 2>/dev/null \
  | python3 -I -c 'import sys,json,re; t=sys.stdin.read(); print(json.loads(t[t.index("{"):t.rindex("}")+1])["grader_version"])')

cargo build --release --target wasm32-wasip2 -q
wasm=target/wasm32-wasip2/release/proctor-grader.wasm
new=$(sha256sum "$wasm" | cut -d' ' -f1)
if [ "$new" = "$old" ]; then echo "build unchanged ($new)"; exit 0; fi
echo "old $old"
echo "new $new"

if [ -z "${APPLY:-}" ]; then
  url=$(outlayer upload "$wasm" 2>&1 | grep -o "https://test.fastfs.io[^ ]*\.wasm" | head -1)
  # FastFS can take a moment to serve a fresh upload.
  for _ in 1 2 3 4 5; do outlayer deploy grader "$url" >/dev/null 2>&1 && break; sleep 10; done
  near contract call-function as-transaction "$CONTRACT" propose_grader json-args "{\"grader_version\":\"$new\",\"same_marking\":${SAME_MARKING:-false}}" \
    prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as "$CONTRACT" network-config testnet sign-with-legacy-keychain send >/dev/null
  echo "proposed $new; run again with APPLY=1 and the set names after 24 hours"
  exit 0
fi

for profile in "$@"; do
  outlayer secrets access --profile "$profile" --build "$new" >/dev/null && echo "moved $profile"
done
near contract call-function as-transaction "$CONTRACT" apply_grader json-args '{}' \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as "$OWNER" network-config testnet sign-with-legacy-keychain send >/dev/null
outlayer versions remove "$old" >/dev/null && echo "removed $old"
echo "$new"
