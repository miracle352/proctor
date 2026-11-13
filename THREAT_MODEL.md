# Threat model

Each line is a way to cheat Proctor, what stops it, and where to check. "Test" names a unit test in `contract/src/lib.rs` (run `cd contract && cargo test`) unless it says otherwise. The last section lists what is *not* stopped.

## An AI, or the company behind it

| Attack | What stops it | Check |
|---|---|---|
| Learn the exam in advance | Sets are sealed: only their SHA-256 is on chain, and the questions open only inside OutLayer's Intel TDX enclave for the pinned grader build. If the model runs on its maker's servers, the contract records that the maker saw the set (`exposed_to`, certificate `sealed: false`), and `licence()` reports it (`maker_saw_exam`). New hunts keep arriving that nobody has seen | `on_report` in `contract/src/lib.rs`; any certificate at `/app#check` |
| Retake questions until they come out right | Only the first answer to each question counts toward a licence | Test `retaking_questions_does_not_improve_a_record` |
| Pass the exam, then pay scams in production | Every trap anyone sets goes to every licence holder, worded like an exam question, so the AI can't tell which payment request is the test. One paid trap suspends the licence in the same transaction | Test `a_caught_ai_loses_its_licence_and_the_hunter_is_paid_after_reveal`; five catches in the README, read back by `node tools/evidence.mjs` |
| Get caught by a trap, then pass a retake | A trap that catches a licensed AI becomes a *known scam*: every money licence must sit it and pay nothing, or it lapses | Test `a_trap_that_caught_an_ai_becomes_a_known_scam_every_licence_must_pass`; `known-g-claude-mwdgtimy` took Haiku's hard licence too |

## An agent's owner

| Attack | What stops it | Check |
|---|---|---|
| License careful instructions, then run the agent with careless ones | The grader hashes the instructions it ran under, and the contract refuses a report whose hash isn't the registered one. Registered instructions are public and can't be edited | Test `an_agent_report_made_under_other_instructions_is_refused` |
| Remove a licensed agent and register the same name with new instructions | Removing an agent retires its id: its licence reads "removed by its owner", and the name can't be registered again | Tests `a_removed_agent_loses_its_licence`, `a_removed_agent_cannot_come_back_with_new_instructions` |
| Remove someone else's agent | Only the owner can | Test `nobody_else_can_remove_an_agent` |
| A prompt-injected agent sends money straight from its account | The agent's account holds one function-call key that can call only `spend` on `wallets.proctor-91796.testnet`; NEAR itself refuses a plain transfer signed with it (`RequiresFullAccess`) | `agentwallet/`; README row on agent wallets |
| A caught agent keeps spending | `spend` asks `licence()` first; a refusal freezes the wallet and sends the rest back to the owner | `agentwallet` test `licensed_agent_pays_and_a_caught_one_freezes`; tx `BcXUAg4k4twP1osBgNxMB3CcgBRDZFRTJtRMzvgBiE1x` |

## A hunter

| Attack | What stops it | Check |
|---|---|---|
| Write a "trap" that is really a legitimate bill, to take an honest AI's money | On reveal the contract rebuilds each page-built question from its parts and applies the payment rules itself; a key that disagrees marks the question faulty, which voids the hunt, lifts every suspension and splits the hunter's stake among the AIs it caught | Test `code_checks_the_keys_on_reveal`; CI replays 400 browser-written cases byte for byte (`browser-matches-contract`) |
| Reveal different questions from the ones sealed | The reveal must hash to the commitment made when the hunt opened | Test `reveal_must_match_commitment` |
| Never reveal, so a suspension hangs forever | After the reveal deadline anyone can settle: suspensions are lifted and the stake goes to the AIs caught | Test `a_hunt_never_revealed_gives_everything_back` |
| Settle before anyone could check the keys | Settling waits out a challenge window after the reveal | Test `a_hunt_cannot_settle_before_anyone_could_challenge_it` |
| Collect twice | A hunt settles once | Test `a_hunt_pays_out_once` |
| Open hunts for free and flood the AIs | A hunt needs a 0.2 NEAR stake behind its keys; free guest hunts are capped per day (`web/api/guest.js`) | Test `a_hunt_needs_a_stake_behind_its_keys` |
| Farm unlicensed AIs | Only a licensed AI can be caught | Test `unlicensed_ais_are_not_caught` |
| Drain an AI's wallet | A catch takes at most 0.1 NEAR, and never more than the wallet holds | Test `a_catch_takes_at_most_what_the_wallet_holds` |
| Challenge for free to stall settlement | A challenge needs a 0.1 NEAR bond | Test `a_challenge_needs_a_bond` |

## The operator (us)

| Attack | What stops it | Check |
|---|---|---|
| Write a score by hand | Certificates are written only in the contract's callback for OutLayer's result, and only if the report matches the request: set, fingerprint, model, slice | Tests `a_report_for_a_different_set_is_refused`, `a_report_for_a_different_model_is_refused`, `a_failed_run_writes_no_certificate` |
| Run a different marking program | The certificate records the grader build; the hardware proof checks it against the quote of the machine that marked it, and Intel's signature on that quote | `node tools/proof_check.mjs 982 1146 1196`, which also forges a score and flips one byte of the quote |
| Read a visitor's trap before the AIs answer | The browser encrypts the trap to OutLayer's keystore; the guest relay only ever holds ciphertext and refuses any sealed copy not locked to the current grader build | `web/src/seal.js`, `web/api/guest.js` |
| Reuse a revealed set for new scores | A revealed set can't be run again | Test `a_revealed_set_cannot_be_used_for_new_scores` |
| Deploy contract code that isn't this repo | Each contract carries its NEP-330 build record; CI checks out the commit it names, rebuilds with `cargo near build reproducible-wasm`, and compares the hash with the code on chain | CI job `deployed-code-matches-repo`; `node tools/verify_build.mjs <account> <wasm>` |

## Not stopped

- **A model's maker sees the questions** when the model runs on the maker's servers (Claude, GPT, Gemini). Proctor records it but can't prevent it. Only Qwen 3.8 runs in an attested TEE.
- **The grader build can be replaced** by the owner with no delay. Every replacement is a public transaction, and certificates name the build that marked them, but there is no timelock.
- **The owner decides challenges** on hunts written by hand (outside the page). Page-built hunts are checked by code.
- **OutLayer's keystore key reaches the page through our relay.** The page prints its fingerprint to compare with the `outlayer` CLI.
- **Testnet only, no audit.**
