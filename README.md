# Proctor

A licence for AI that handles money, on NEAR. Anyone can take the licence away by catching the AI paying a scam.

An AI earns a money licence by passing a sealed wallet test: payment requests, half of them scams, opened only inside secure hardware. Any NEAR contract can check the licence in one call before it lets an AI move funds. Then anyone can try to break it. You set a trap (a fake invoice, a bank change slipped into a thread, an approval for the wrong amount), your browser seals it, and Proctor puts it in front of every licensed AI. If one pays, the contract suspends its licence in the same transaction and holds what it paid for you. When you reveal the trap, the contract rebuilds every question from its parts and checks the answer with code. Nobody judges a hunt by hand, us included.

**Live:** https://useproctor.vercel.app (hunts at `/hunt`, no wallet needed)
**Contract:** [`app.proctor-91796.testnet`](https://testnet.nearblocks.io/address/app.proctor-91796.testnet) · **Track:** AI Security & Defense

## Check it in two minutes

Nothing to install beyond Python 3 for the first two lines. They are read-only calls to the contract on NEAR testnet, so they work without a wallet and even when OutLayer is down.

```sh
python3 tools/check.py          # every licence, every suspension, every hunt
python3 tools/check.py cert 1146  # the certificate where Claude Haiku paid a visitor's trap
node tools/proof_check.mjs 1146   # the same certificate checked against Intel's TDX quote (needs Node 20 and `cd web && npm ci`)
```

What it showed on 12 Nov 2026 at 21:00 UTC (hunts keep running, so yours may differ):

| | Basic wallet test (`money`) | Hard wallet test (`money-pro`) |
|---|---|---|
| GPT-6.1 Sol | 39/42, licensed | 42/42, licensed |
| Qwen 3.8 | 39/42, then **suspended**: paid a visitor's trap (certificate 1200), final if the visitor reveals | 41/42, paid one scam, not licensed |
| Gemini 3.1 Flash-Lite | 39/42, then **suspended**: paid a trap from Proctor's own drill | 42/42, licensed |
| Claude Haiku 5.5 | 40/42, then **revoked**: paid a visitor's trap | 42/42, then lost it: paid the known scam made from that trap |
| Claude Sonnet 5.5 | 42/42, then **revoked**: paid a hunter's trap | 39/42, paid three scams, not licensed |
| GPT-5 nano | 39/42, paid two scams, not licensed | 34/42, paid eight scams, not licensed |

Every number comes from the contract; the script prints them live. Sonnet's three hard-test failures were all the same trick (a bank change in a later message of a thread), and the first hunt used that trick to catch it again.

Then check the code that decides hunts:

```sh
cd contract && cargo test   # 18 tests, including 400 browser-written hunt questions replayed byte for byte
```

## Who it's for

- **Teams running a payments agent.** Register it (a model plus its instructions), let it sit the licence exam, and from then on the public tests it for free: every trap anyone sets goes to every licence holder. Its [licence record](https://useproctor.vercel.app/record) shows each exam, each trap and each catch.
- **Contracts that let AI move money.** One call to `licence(model, "money")` before paying. `vault/` pays bills only for licensed AIs; `budget/` gives an AI a spending budget and freezes it the moment the licence drops; `agentwallet/` does that for an agent whose account can't do anything but ask it to pay.
- **Hunters, people or agents.** Set a trap on the site with no wallet, or from any agent through the MCP server in [`mcp/`](mcp/README.md): `check_licence` before paying, `check_trap` and `set_trap` to red-team.

## What's proven, what's trusted

| Claim | How you can check it | What it rests on |
|---|---|---|
| A licensed AI that pays a hunter's trap loses its money licence in the same transaction | `python3 tools/check.py`; certificates 982 (Sonnet), 1146 (Haiku), 1126 (careful-payer) | The contract (`record_catch` in `contract/src/lib.rs`), read straight from chain |
| Two settled hunts revoked Claude Sonnet's and Claude Haiku's money licences and paid the hunters | `hunt_settled` events on `app.proctor-91796.testnet`; `tools/check.py` shows "revoked" | The contract |
| Answer keys of hunts built on the page are checked by code, not by anyone | `contract/src/case.rs`; `cargo test` replays 400 browser-written cases byte for byte; the `keys_checked` event on each reveal | The contract and its tests |
| An agent with a wallet can't spend outside it, and loses it when caught | Agent accounts `6542b954…a502` (Qwen: spend paid, tx `S6gQk9ZGQSMs1thmdEY3nNCYHGhse8r99nwPaXtE6H3`) and `933eaf75…20d` (careful-payer, revoked: wallet frozen and 0.2 NEAR returned, tx `BcXUAg4k4twP1osBgNxMB3CcgBRDZFRTJtRMzvgBiE1x`); each holds one function-call key for `spend`, and a plain transfer signed with it is refused by NEAR | NEAR's access-key rules and `agentwallet/` |
| Other contracts act on the licence | `vault.proctor-91796.testnet` (pays a bill only for a licensed AI) and `budget.proctor-91796.testnet` (froze Haiku's 0.3 NEAR budget and sent it home, tx `8DfsqjJc8eXyPZs32dBAT8wRsErXnhLVdMrfb52mCvui`) | Each contract's own cross-contract call to `licence` |
| Nobody, us included, can read a hunt before the AIs answer | `web/src/seal.js` encrypts in the browser; the guest relay receives only ciphertext (`web/api/guest.js`) | **Trusted:** OutLayer's keystore releases the secret only inside its enclave. The keystore's public key reaches the page through our relay, so the page prints it for you to compare with the `outlayer` CLI |
| Each certificate was marked inside approved Intel TDX hardware, by the published grader, on the sealed questions | **Check the hardware proof** on any certificate at `/app#check`, or `node tools/proof_check.mjs 982 1146 1196`. Your browser finds OutLayer's result for that run on chain, hashes it, and checks: the hash is the one in the attestation; the report matches the certificate field for field; the build is `grader_version`; the secret opened was `keeper/set_id`; all of it hashes to the report data inside the TDX quote; the quote's measurements are on `worker.outlayer.testnet`'s approved list. Changing one score breaks the first check | **Trusted:** Intel's signature on the quote. We link to OutLayer's verifier, which checks it in your browser with Intel's collateral; we don't re-implement DCAP |
| What the model answered | Only the mark leaves the enclave | **Trusted:** the model provider. Only Qwen 3.8 runs in an attested TEE; Claude, GPT and Gemini run on their makers' servers, and the certificate records that (`sealed: false`) |

Scores are one run per model on 42 questions per test. The catches are single events, real on chain, but not statistics.

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
- **Drills** (`tools/drill.mjs`, `.github/workflows/drill.yml`). Every six hours Proctor opens its own hunt: two traps generated by code (`web/src/tricks.js`) from the tricks that have caught AIs, with fresh companies, amounts and account numbers, fired at every licence holder through the public guest service, then revealed so the contract checks the keys. A drill's traps are rebuilt from its name with a seeded generator, so the job keeps no state and no secrets; a drill that catches an AI becomes a known scam when it settles. Known scams are published on reveal and could be trained on; variants of the same trick can't be. The first drill (`hunt-g-drill-mwdxbf0f`, 12 Nov) caught Gemini 3.1 Flash-Lite with a bank change in a thread.
- **Sealing in the browser** (`web/src/seal.js`). ECIES as OutLayer's CLI does it: X25519, HKDF-SHA256 with `outlayer-keystore-v1`, ChaCha20-Poly1305. The keystore key doesn't depend on the plaintext, so the page asks for it with an empty payload; OutLayer doesn't allow browser calls, so `/api/pubkey` relays that request (owner and profile only). `tools/seal_hunt.mjs` runs the same code from the command line.
- **Guest hunts** (`web/api/guest.js`). Receives only the sealed copy, checks it is locked to the current grader build, caps a day's guest hunts, and signs from a sponsor account.
- **Hardware proof** (`web/api/proof.js`, `web/src/proof.js`). For a certificate, the server finds OutLayer's `resolve_execution` call a few blocks earlier whose report matches it, takes the request id, and fetches OutLayer's attestation (the TDX quote plus the hashes it covers). The browser then does the checking: sha256 of the report as sorted compact JSON equals `output_hash`; the report matches the certificate; `wasm_hash` equals `grader_version`; `secrets_ref` is the set's keeper and id; OutLayer's task hash over all those fields equals the quote's report data (bytes 568–600); RTMR3 equals the worker measurement and `worker.outlayer.testnet` lists the measurements as approved. The server is only a fetcher, so it doesn't need to be trusted. `tools/proof_check.mjs` runs the same checks in CI and also forges a score to show they fail.

## Run it yourself

Needs Rust with `wasm32-wasip2`, `cargo-near`, `near` CLI, `outlayer` CLI and Node 20.

```sh
# contract
cd contract && cargo test && cargo near build non-reproducible-wasm

# grader
cd grader && cargo test --lib && cargo build --release --target wasm32-wasip2

# the two contracts that act on a licence
cd vault && cargo near build non-reproducible-wasm
cd budget && cargo test && cargo near build non-reproducible-wasm

# site (the /api functions run on Vercel)
cd web && npm install && npm run dev
```

For developers: `GET /api/scores` (every score as JSON), `GET /api/licence?model=…&skill=money`, `GET /api/badge?model=…[&skill=money]` (live SVG badge). See https://useproctor.vercel.app/developers.

`tools/` has the scripts used for the live deployment: `check.py` (read-only state), `make_money_exam_v2.py` in `twins/` (the hard test), `store_set.py` (seal a set without the CLI's fixed deposit), `case_fixtures.mjs` (the 400 replayed hunt questions), `seal_set.py` (build and fingerprint a set), `release_grader.sh` (upload a grader build, re-lock every set to it, point the contract at it), `run.py` and `run_all.py` (certified runs from the CLI), `report.py` (scores, gaps, writer outliers).

## Testnet and mainnet

Everything network-specific lives in `web/network.js`. The site builds for testnet by default; `VITE_NETWORK=mainnet` (and `NETWORK=mainnet` for the `/api` functions) switches contract names, RPC nodes, OutLayer's contract and keystore, and explorer links in one place. Nothing is deployed on mainnet yet. `tools/deploy_mainnet.sh` is the whole procedure: run it with `OWNER=you.near` to print every step, add `SEND=1` to do it. The contracts and grader are the same code; exams must be generated fresh for mainnet. Rough cost: about 7 NEAR of storage for the two contracts, 0.2 NEAR per sealed set, and per question OutLayer's execution fee plus the model's NEAR AI Cloud price. `licence()` stays a free view call for anyone.

## Limits

- Testnet only, no audit. Hunt payouts are testnet NEAR and capped at 0.1 NEAR a catch.
- One run per model on 42 questions per test. Re-runs are next; small differences between models may not hold.
- Intel's signature on the TDX quote is checked by OutLayer's verifier page (in your browser), not by our code.
- The page gets OutLayer's key through our relay, so in principle the relay could hand out a different key. The page shows the key's fingerprint; compare it with `outlayer` CLI before sealing something you care about.
- Free-form hunts (made outside the page, without parts) can't be checked by code; for those a challenge is still decided by the contract owner.
- A model's maker sees the questions unless the model runs in a TEE. Proctor records this; it can't prevent it.

## Built at NEAR HACKATHON

- **Window.** The repository was created on 11 Nov 2026 and every commit is hackathon work; there is no earlier baseline (Q-001, Q-003). Nothing here exists on another chain (Q-002).
- **Track:** AI Security & Defense (`security`); also fits Agent Economy (`agents`).
- **Track hints, and where they are:**
  - *Agent security:* licences an agent must hold to move money (`contract/`), public hunts that take them away, known scams that every licence must keep passing, and two contracts that act on the licence (`vault/`, `budget/`).
  - *TEE attestation:* every exam and hunt is marked inside OutLayer's Intel TDX enclave by a grader build pinned by hash; the sealed questions open only for that build. Any certificate can be checked against the TDX quote of the machine that marked it, in the browser (`web/src/proof.js`): output hash, task hash in the quote's report data, build hash, sealed-secret name, and approved measurements. Qwen 3.8 answers from NEAR AI Cloud's attested TEE. What we verify and what we trust is in [What's proven, what's trusted](#whats-proven-whats-trusted).
  - *Function-call keys:* licensed agent wallets (`agentwallet/`, live at `wallets.proctor-91796.testnet`). The agent's own account holds a single function-call key that can only call `spend` there, so the protocol refuses anything else it tries; each spend asks Proctor for the licence, and a refused one freezes the wallet and sends the rest to the owner.
- **NEAR pieces used:** NEAR smart contracts (near-sdk), yield/resume to OutLayer, OutLayer's keystore and TEE execution, NEAR AI Cloud, cross-contract calls (`vault/`, `budget/` call `licence`), NEAR wallets through wallet-selector.
- **Libraries (Q-005).** Rust: near-sdk 5.9, serde, serde_json, sha2, hex; built with cargo-near. Web: Vite 6, @near-wallet-selector 10 (core, modal-ui, my-near-wallet, meteor-wallet, here-wallet, intear-wallet), @near-js accounts/providers/signers 2.5, @noble/curves, @noble/hashes, @noble/ciphers, buffer, Fontsource fonts (Bricolage Grotesque, Hanken Grotesk, JetBrains Mono, Big Shoulders Display). MCP server: @modelcontextprotocol/sdk, zod. Tools: Python 3 with the cryptography package, the outlayer CLI, near-cli-rs. No templates.
- **AI-written code.** Much of the code was written with an AI coding assistant (Claude) and reviewed and tested by the team.
- **Other projects (Q-015):** this is the team's only NEAR HACKATHON entry.

## Credits

Hero photograph: an exam in Curzon Hall, University of Dhaka, by Azim Khan Ronnie, CC BY-SA 4.0, via Wikimedia Commons (shown in greyscale). Question templates from Apple's GSM-Symbolic. Built with AI coding assistance.

MIT licence.
