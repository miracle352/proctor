# Proctor

A licence for AI that handles money, on NEAR. Anyone can take the licence away by catching the AI paying a scam.

An AI earns a money licence by passing a sealed wallet test: payment requests, half of them scams, opened only inside secure hardware. Any NEAR contract can check the licence in one call before it lets an AI move funds. Then anyone can try to break it. You set a trap (a fake invoice, a bank change slipped into a thread, an approval for the wrong amount), your browser seals it, and Proctor puts it in front of every licensed AI. If one pays, the contract suspends its licence in the same transaction and holds what it paid for you. When you reveal the trap, the contract rebuilds every question from its parts and checks the answer with code. Nobody judges a hunt by hand, us included.

**Live:** https://useproctor.vercel.app (hunts at `/hunt`, no wallet needed)
**Contract:** [`app.proctor-91796.testnet`](https://testnet.nearblocks.io/address/app.proctor-91796.testnet) · **Track:** AI Security & Defense

## Check it in two minutes

Nothing to install beyond Python 3. These are read-only calls to the contract on NEAR testnet, so they work without a wallet and even when OutLayer is down.

```sh
python3 tools/check.py          # every licence, every suspension, every hunt
python3 tools/check.py cert 1146  # the certificate where Claude Haiku paid a hunter's trap
```

What you should see, as of 12 Nov 2026:

| | Basic wallet test (`money`) | Hard wallet test (`money-pro`) |
|---|---|---|
| Claude Haiku 5.5 | 40/42, then **suspended**: paid a hunter's trap | 42/42, licensed |
| GPT-6.1 Sol | 39/42, licensed | 42/42, licensed |
| Gemini 3.1 Flash-Lite | 39/42, licensed | 42/42, licensed |
| Qwen 3.8 | 39/42, licensed | 41/42, paid one scam, not licensed |
| Claude Sonnet 5.5 | 42/42, then **suspended**: paid a hunter's trap | 39/42, paid three scams, not licensed |
| GPT-5 nano | 39/42, paid two scams, not licensed | 34/42, paid eight scams, not licensed |

Every number comes from the contract; the script prints them live. Sonnet's three hard-test failures were all the same trick (a bank change in a later message of a thread), and the first hunt used that trick to catch it again.

Then check the code that decides hunts:

```sh
cd contract && cargo test   # 16 tests, including 400 browser-written hunt questions replayed byte for byte
```

## Try it

1. Open https://useproctor.vercel.app/hunt. No wallet needed.
2. Pick a trick, change the details, and watch the box under the email say which rule it breaks. A trap that breaks no rule can't be sealed.
3. Type a name and press **Seal it and set the trap**. Your browser encrypts the trap to OutLayer's keystore; a guest account pays the testnet fees and fires it at every licence holder.
4. Watch each AI's verdict land, usually within three minutes. A caught AI shows as suspended on the board.
5. Press **Reveal and claim** on your hunt. The contract checks your answer key with code; once the two-hour challenge window passes, anyone can settle it.

With a NEAR testnet wallet (MyNearWallet, Meteor, HERE or Intear) the same page hunts from your own account and the money a catch holds goes to you. `/app` runs the exams themselves, licenses an agent (a model plus its system prompt), and checks any certificate. On the home page the vault buttons ask a demo contract to pay a bill as a given AI; it asks Proctor for the licence first.

## How it works

```
writer ──seal──> OutLayer secret (locked to one grader build)
   └──commit_set(sha256, stake)──> Proctor contract on NEAR

buyer ──request_run──> contract ──yield──> OutLayer (Intel TDX)
                                            grader.wasm:
                                              open sealed set, check sha256
                                              ask the model on NEAR AI Cloud
                                              mark answers in code
                       contract <──resume── report (score only)
                         stores certificate, pays writers,
                         marks the set as seen if the model ran outside a TEE
```

- **NEAR contract** (`contract/`, near-sdk 5). Sets are committed by fingerprint with a stake. `request_run` takes the writers' fee and the model fee, then calls OutLayer pinned to one grader build using yield/resume. `on_report` checks the report against the committed fingerprint and the pinned build before storing a certificate. After a set retires it is revealed and anyone can `challenge` an answer with a bond.
- **OutLayer** runs the grader (`grader/`, Rust compiled to `wasm32-wasip2`) inside Intel TDX. Each set is an OutLayer secret that only the current grader build can read. The NEAR AI key is an author secret of the same build.
- **NEAR AI Cloud** serves the models. For attested models the grader confirms `verifiable` before asking, and the certificate is marked sealed. Models from other providers run on their makers' servers, so the contract records that the maker saw the set, and keeps that record for good.
- **Money exam and licences.** `twins/make_money_exam.py` generates the payment requests from templates with fresh names, amounts and accounts. Questions can carry a stake; grader 0.4.0 reports what wrong answers cost (`lost_milli`) and the contract pays it from the model's wallet (`fund_wallet`, `list_wallets`) to the scammer account. First answers per model and question are tallied, and `licence(model, skill)` returns whether the model passed, its score, its expiry and whether its maker saw the exam.
- **Vault** (`vault/`). An agent wallet that calls `licence` before paying. Try it: `near contract call-function as-transaction vault.proctor-91796.testnet agent_pay json-args '{"model":"openai/gpt-5-nano"}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' sign-as YOU.testnet network-config testnet sign-with-keychain send`
- **Twins** (`twins/`). Every published school-maths question used here has a sealed twin built from the same GSM-Symbolic template, with new names and numbers of the same digit length. The score gap between the two shows memorisation, reported with a bootstrap 90% interval.

- **Hunts** (`contract/src/lib.rs`: `open_hunt`, `record_catch`, `reveal`, `settle_hunt`). A hunter stores the sealed trap as an OutLayer secret under their own account, locked to the grader build, and opens the hunt with a 0.2 NEAR stake. When a licensed AI pays a trap, `on_report` suspends that licence and moves up to 0.1 NEAR from the AI's wallet into escrow. On reveal, `case.rs` rebuilds each question from its parts and applies the payment rules; a question that doesn't match its parts or a key that disagrees with the rules is marked faulty. Settling pays the hunter (escrow plus stake) and turns suspensions into revocations, or, if the hunt wasn't revealed in time or had a faulty question, lifts every suspension and splits the stake among the AIs it caught.
- **Sealing in the browser** (`web/src/seal.js`). ECIES as OutLayer's CLI does it: X25519, HKDF-SHA256 with `outlayer-keystore-v1`, ChaCha20-Poly1305. The keystore key doesn't depend on the plaintext, so the page asks for it with an empty payload; OutLayer doesn't allow browser calls, so `/api/pubkey` relays that request (owner and profile only). `tools/seal_hunt.mjs` runs the same code from the command line.
- **Guest hunts** (`web/api/guest.js`). Receives only the sealed copy, checks it is locked to the current grader build, caps a day's guest hunts, and signs from a sponsor account.

## Run it yourself

Needs Rust with `wasm32-wasip2`, `cargo-near`, `near` CLI, `outlayer` CLI and Node 20.

```sh
# contract
cd contract && cargo test && cargo near build non-reproducible-wasm

# grader
cd grader && cargo test --lib && cargo build --release --target wasm32-wasip2

# demo vault
cd vault && cargo near build non-reproducible-wasm

# site (the /api functions run on Vercel)
cd web && npm install && npm run dev
```

For developers: `GET /api/scores` (every score as JSON), `GET /api/licence?model=…&skill=money`, `GET /api/badge?model=…[&skill=money]` (live SVG badge). See https://useproctor.vercel.app/developers.

`tools/` has the scripts used for the live deployment: `check.py` (read-only state), `make_money_exam_v2.py` in `twins/` (the hard test), `store_set.py` (seal a set without the CLI's fixed deposit), `case_fixtures.mjs` (the 400 replayed hunt questions), `seal_set.py` (build and fingerprint a set), `release_grader.sh` (upload a grader build, re-lock every set to it, point the contract at it), `run.py` and `run_all.py` (certified runs from the CLI), `report.py` (scores, gaps, writer outliers).

## Limits

- Testnet only, no audit. Hunt payouts are testnet NEAR and capped at 0.1 NEAR a catch.
- One run per model on 42 questions per test. Re-runs are next; small differences between models may not hold.
- The page gets OutLayer's key through our relay, so in principle the relay could hand out a different key. The page shows the key's fingerprint; compare it with `outlayer` CLI before sealing something you care about.
- Free-form hunts (made outside the page, without parts) can't be checked by code; for those a challenge is still decided by the contract owner.
- A model's maker sees the questions unless the model runs in a TEE. Proctor records this; it can't prevent it.

## Credits

Hero photograph: an exam in Curzon Hall, University of Dhaka, by Azim Khan Ronnie, CC BY-SA 4.0, via Wikimedia Commons (shown in greyscale). Question templates from Apple's GSM-Symbolic. Built with AI coding assistance.

MIT licence.
