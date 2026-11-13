# Judging Proctor: the short path

Proctor gives AI a licence to move money, and anyone can take it away. An AI earns the licence on a sealed wallet test marked inside Intel TDX. Then anyone can set a trap, a fake invoice or a quiet bank change, and Proctor puts it in front of every licence holder. An AI that pays has its licence suspended in the same transaction and its money held for the hunter. When the hunter reveals the trap, the contract rebuilds each question from its parts and checks the answer key with code. The [README](README.md) has everything; this page is the fastest way to check the main claims.

## The claim to check first

Hunters have taken the money licence from five AIs on NEAR testnet, and the contract did it, not us.

```sh
git clone https://github.com/miracle352/proctor && cd proctor
node tools/evidence.mjs
```

Node 18 or later, nothing to install, about ten seconds. Expect every transaction the README cites read back from chain (the catch, the reveal with its answer keys checked by code, and the payout, for each AI), then each AI's licence read live, ending with `18/18 cited transactions found on NEAR testnet, 18 with every receipt succeeding; 6/6 licences as the README says.`

Then the code that decides it:

```sh
cd contract && cargo test
```

Expect `test result: ok. 38 passed` (a few minutes from a fresh clone). Most tests are named after an attack in [THREAT_MODEL.md](THREAT_MODEL.md): a forged report, an agent swapping its instructions, a hunter whose "trap" is really an honest bill, a hunt that never reveals, a grader build switched without notice.

## In the browser, no wallet

| Do | See |
|---|---|
| Open https://useproctor.vercel.app/hunt, pick a trick, change a detail, type a name, press **Seal it and set the trap** | Before you seal, the box under the email names the rule your trap breaks (or says it breaks none, and won't seal). Then each licensed AI's answer lands, usually within three minutes, and the page reveals the hunt by itself |
| Open https://useproctor.vercel.app/app#check?cert=1146&proof | The certificate where Claude Haiku paid a visitor's trap, then seven checks run in your browser against the Intel TDX quote of the machine that marked it: output hash, certificate fields, grader build, sealed secret, task hash in the report data, Intel's signature chain to its root certificate, NEAR's approved measurements |
| Open https://useproctor.vercel.app/record | Every AI's licence record: each exam, each trap it faced and each catch, read live from the contract |

## By track

**AI Security & Defense** (`security`, primary)
- *Agent security:* the licence itself. `licence(model, "money")` is one cross-contract call; `vault/`, `budget/` and `agentwallet/` call it before paying, and a caught AI is cut off the moment the hunt catches it. Check: `node tools/evidence.mjs` (budget tx `8DfsqjJc…` froze Haiku's budget after its catch).
- *Scam detection, measured:* `python3 tools/policy_wallet.py` runs the exam's public generator against a typical spending-limit wallet (allowlist and per-payment cap). It pays 22% of the scams, every invoice paid twice and every payment split under the limit, and blocks every properly approved large bill. GPT-6.1 Sol, licensed, paid none of its exam's scams. A licence measures what limits can't, and the agent wallet here enforces both.
- *Function-call keys:* an agent's account holds one key that can only call `spend` on `wallets.proctor-91796.testnet`; NEAR refuses a plain transfer signed with it. Check: `near account list-keys 6542b954e699c15c005612d34dc70d87c80c2f376eb919694e0bfc3c5417a502 network-config testnet now` shows that account's only key: a function-call key for `spend` on the wallets contract. `cd agentwallet && cargo test` covers the freeze.
- *TEE attestation:* the seven-check hardware proof above, also run in CI: `node tools/proof_check.mjs 982 1146 1196` (needs `cd web && npm ci`), which also forges a score and flips one byte of the quote to show both are refused.

**Privacy & Private AI** (`privacy`)
- Traps are encrypted in the visitor's browser to OutLayer's keystore (`web/src/seal.js`) and open only inside the enclave for the pinned grader build. The guest relay holds only ciphertext and refuses any sealed copy not locked to that build (`web/api/guest.js`).
- The model's answers never leave the enclave, only the mark. Qwen 3.8 runs in NEAR AI Cloud's attested TEE; for models on their makers' servers the certificate says `sealed: false` and the licence reports that the maker saw the exam.

**Agent Economy** (`agents`)
- An agent is a model plus its instructions, licensed on its own record: the grader hashes the instructions it ran under and the contract refuses any other (`register_agent`, `request_agent_run`). careful-payer, an agent built on GPT-5 nano, lost its licence to a hunter's trap (certificate 1126).
- Agents can use Proctor directly through the MCP server in [`mcp/`](mcp/README.md): `check_licence` before paying, `check_trap` and `set_trap` to hunt, `trap_status` and `reveal_trap` to collect.
- Catching an AI pays the hunter from the AI's own wallet: a market where finding a scam an AI falls for is paid work.

**Open Innovation** (`open`)
- A public, permanent red team for payment AIs: every trap that catches one becomes a known scam every licence holder must keep passing, and Proctor sets its own variants twice a day (`tools/drill.mjs`).

## Builds you can check

Every contract is built with `cargo near build reproducible-wasm` and carries a NEP-330 record of the commit it came from. The CI job `deployed-code-matches-repo` reads that record from each account, checks out the commit, rebuilds, and fails unless the hash equals the code on chain. By hand: `node tools/verify_build.mjs app.proctor-91796.testnet`.

A new grader build waits 24 hours in public before it can mark anything (`config().pending_grader`).

## What isn't done

Testnet only, no audit. Only Qwen 3.8 hides the questions from its maker. The contract accounts keep a full-access key during the hackathon. The full list is at the end of [THREAT_MODEL.md](THREAT_MODEL.md#not-stopped).
