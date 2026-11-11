# Proctor

An exam board for AI, on NEAR. Before an AI is allowed to act, it sits a sealed exam; any NEAR contract can then check its licence in one call.

**The wallet test:** four AI models were each given a wallet with 1 NEAR and a sealed exam of 42 payment requests, half of them scams (changed bank details, a boss demanding a secret transfer, instructions hidden in the request, duplicate invoices, look-alike domains, split payments, oversized refunds, approvals from the wrong person). Every scam a model approves is paid from its own wallet to a scammer account, by the contract, in the same step that records the mark. Models that score 90% or better get a money licence. A small vault contract pays a bill only for a licensed model.

Sealed exams for AI models. Experts write questions with one exact answer and keep them sealed. The questions are opened only inside secure hardware, where the model answers them and plain code marks the answers. Only the score comes out, and it is written to NEAR.

Public benchmarks leak into training data, so a high score can mean the model has read the answers. Proctor's questions are never published while in use, and every score can be traced to a sealed set whose fingerprint was on chain before any model saw it.

**Live:** https://useproctor.vercel.app (the app is at `/app`)
**Contract:** [`app.proctor-91796.testnet`](https://testnet.nearblocks.io/address/app.proctor-91796.testnet)

## Try it

1. Open https://useproctor.vercel.app/app.
2. Without a wallet, press **Watch a recorded exam** to replay real certificates from the contract.
3. With a NEAR testnet wallet (MyNearWallet, Meteor, HERE or Intear), pick a model and a set and press **Start the exam**. Each question is one paid run. Rows turn into ticks or crosses as each certificate lands, about one a minute.
4. On the home page, under **Licensed to handle money, or not**, press a model's button to ask the vault to pay a bill as that model. The vault asks Proctor for the licence and pays or refuses on chain.
5. Under **Check a score**, enter any certificate number to see what was recorded: model, set fingerprint, marking build, block, and the model provider's signed chat id.

Public runs are open for Qwen 3.8 (attested, inside NEAR AI Cloud's TEE), Claude Haiku 5.5, GPT-5 nano and Gemini 3.1 Flash-Lite. Each account can ask 20 questions a day, and the site as a whole 300, because every question is paid for on NEAR AI Cloud.

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

## Results so far

Read live from the contract on the site. At the time of writing, Qwen 3.8 and Claude Haiku 5.5 each score 97% on the 34 sealed twins, 2.9 points below the published versions, and the 90% interval includes zero. School maths is too easy to separate them; harder sets from domain experts are the next step.

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

`tools/` has the scripts used for the live deployment: `seal_set.py` (build and fingerprint a set), `release_grader.sh` (upload a grader build, re-lock every set to it, point the contract at it), `run.py` and `run_all.py` (certified runs from the CLI), `report.py` (scores, gaps, writer outliers).

## Limits

- Testnet only, no audit.
- The writer-side lock into OutLayer is a CLI step for now; the app shows the exact command.
- A model's maker sees the questions unless the model runs in a TEE. Proctor records this, it can't prevent it.
- Marking is exact-answer only (numbers with a tolerance, or exact text).

## Credits

Hero photograph: an exam in Curzon Hall, University of Dhaka, by Azim Khan Ronnie, CC BY-SA 4.0, via Wikimedia Commons (shown in greyscale). Question templates from Apple's GSM-Symbolic. Built with AI coding assistance.

MIT licence.
