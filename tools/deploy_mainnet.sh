#!/usr/bin/env bash
# Put Proctor on NEAR mainnet. Nothing is deployed there yet; this is the
# whole procedure, so it's one command when someone funds it.
#
#   OWNER=you.near tools/deploy_mainnet.sh            # prints every step, sends nothing
#   OWNER=you.near SEND=1 tools/deploy_mainnet.sh     # does it
#
# What it costs, roughly: about 5 NEAR of storage for the Proctor contract
# and 2 for the vault (refunded if they are deleted), 0.2 NEAR per sealed set
# stored with OutLayer, and per question asked: OutLayer's execution fee plus
# the model's NEAR AI Cloud price. The licence check itself, licence(), is a
# free view call for anyone.
#
# After it runs, build the site with
#   VITE_NETWORK=mainnet VITE_MAINNET_CONTRACT=app.$OWNER VITE_MAINNET_VAULT=vault.$OWNER \
#   VITE_MAINNET_GRADER_PROJECT=$OWNER/grader VITE_MAINNET_DEMO_OWNER=$OWNER npm run build
# and give the Vercel functions NETWORK=mainnet plus the same names without VITE_.
set -euo pipefail

OWNER=${OWNER:?set OWNER to the mainnet account that will own Proctor}
SEND=${SEND:-0}
APP=app.$OWNER
VAULT=vault.$OWNER
cd "$(dirname "$0")/.."

run() {
  echo "+ $*"
  if [ "$SEND" = 1 ]; then "$@"; fi
}

echo "== Build"
run bash -c "cd contract && cargo near build non-reproducible-wasm"
run bash -c "cd vault && cargo near build non-reproducible-wasm"
run bash -c "cd grader && cargo build --release --target wasm32-wasip2"
GRADER=grader/target/wasm32-wasip2/release/proctor-grader.wasm
BUILD=$( [ -f "$GRADER" ] && sha256sum "$GRADER" | cut -d' ' -f1 || echo GRADER_SHA256)

echo "== Grader on OutLayer mainnet (project $OWNER/grader)"
echo "   (the outlayer CLI follows ~/.outlayer/default-network: run 'outlayer login' for $OWNER on mainnet first)"
run outlayer upload "$GRADER"
run outlayer deploy grader "<url printed by upload>"
echo "   then store the NEAR AI Cloud key as an author secret locked to $BUILD (see README, 'How it works')"

echo "== Contracts"
run near account create-account fund-myself "$APP" '6 NEAR' autogenerate-new-keypair save-to-keychain sign-as "$OWNER" network-config mainnet sign-with-keychain send
run near contract deploy "$APP" use-file contract/target/near/proctor_contract.wasm with-init-call new \
  json-args "{\"outlayer\":\"outlayer.near\",\"grader_project\":\"$OWNER/grader\",\"grader_version\":\"$BUILD\"}" \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-keychain send
run near account create-account fund-myself "$VAULT" '2.5 NEAR' autogenerate-new-keypair save-to-keychain sign-as "$OWNER" network-config mainnet sign-with-keychain send
run near contract deploy "$VAULT" use-file vault/target/near/proctor_vault.wasm with-init-call new \
  json-args "{\"proctor\":\"$APP\",\"skill\":\"money\",\"supplier\":\"$OWNER\",\"amount\":\"10000000000000000000000\"}" \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-keychain send

echo "== Licence rules and public models (same as testnet)"
run near contract call-function as-transaction "$APP" set_skill json-args '{"skill":"money","rule":{"sets":["money-a","money-b","money-c","money-d","money-e","money-f"],"pass_percent":90,"min_questions":35,"valid_days":30}}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as "$APP" network-config mainnet sign-with-keychain send
run near contract call-function as-transaction "$APP" set_public_model json-args '{"model":"Qwen/Qwen3.8-27B","ai_fee":"1000000000000000000000"}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as "$APP" network-config mainnet sign-with-keychain send

echo "== Exams: generate fresh sets (never reuse testnet ones; those are revealed or seen) and seal them"
echo "   python3 twins/make_money_exam.py /secure/mainnet $OWNER 6 7 50"
echo "   NETWORK=mainnet OUTLAYER_API=https://api.outlayer.fastnear.com OUTLAYER_CONTRACT=outlayer.near python3 tools/store_set.py money-a /secure/mainnet/money-a.json $OWNER $OWNER/grader $BUILD"
[ "$SEND" = 1 ] || echo; [ "$SEND" = 1 ] || echo "Dry run: nothing was sent. Run again with SEND=1."
