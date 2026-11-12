# make verify: every test, a fresh browser-vs-contract cross-check, and a
# read-only look at the live contract. Needs Rust, Node 20+ and Python 3.
.PHONY: verify test crosscheck chain

verify: test crosscheck chain

test:
	cd contract && cargo test --quiet
	cd budget && cargo test --quiet
	cd grader && cargo test --quiet --lib

# 400 new random hunt questions from the browser code; the contract must
# render and decide every one exactly the same way
crosscheck:
	cd web && npm ci --silent
	node tools/case_fixtures.mjs contract/tests/fixtures/cases.json
	cd contract && cargo test --quiet case
	git checkout -- contract/tests/fixtures/cases.json 2>/dev/null || true

chain:
	python3 tools/check.py
