"""Read certificates from the contract and print what they say.

    python3 tools/report.py app.proctor-91796.testnet

Three things, all computed from what is on chain:

1. Score per model per set, after dropping questions whose answer key was
   successfully challenged.
2. The contamination gap: score on public originals minus score on their
   sealed twins, paired by question, with a bootstrap 90% interval.
3. Writer outliers: for each model and set, any writer whose questions that
   model gets right far more often than the rest of the set (one-sided
   binomial tail below 1%). That is what a leaked batch of questions
   looks like from the outside.
"""

import base64
import json
import math
import random
import sys
import urllib.request
from collections import defaultdict

RPC = "https://rpc.testnet.fastnear.com"


def view(contract, method, args):
    body = json.dumps({
        "jsonrpc": "2.0", "id": 1, "method": "query",
        "params": {
            "request_type": "call_function", "finality": "final", "account_id": contract,
            "method_name": method, "args_base64": base64.b64encode(json.dumps(args).encode()).decode(),
        },
    }).encode()
    req = urllib.request.Request(RPC, body, {"content-type": "application/json"})
    res = json.load(urllib.request.urlopen(req, timeout=30))
    if "error" in res or "error" in res.get("result", {}):
        raise SystemExit(f"{method}: {res}")
    return json.loads(bytes(res["result"]["result"]).decode())


def paged(contract, method, page=50):
    out, start = [], 0
    while True:
        batch = view(contract, method, {"from": start, "limit": page})
        out += batch
        if len(batch) < page:
            return out
        start += page


def per_question(certs, faulty_by_set):
    """{(model, set_id): {index: 0/1}}; later runs of the same question win."""
    grid = defaultdict(dict)
    for c in certs:
        for i, ch in enumerate(c["results"]):
            idx = c["start"] + i
            if ch in "01" and idx not in faulty_by_set.get(c["set_id"], ()):
                grid[(c["model"], c["set_id"])][idx] = int(ch)
    return grid


def binom_tail(k, n, p):
    """P(X >= k) for X ~ Binomial(n, p)."""
    return sum(math.comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(k, n + 1))


def gap(orig, twin, reps=5000, seed=1):
    keys = sorted(set(orig) & set(twin))
    if len(keys) < 5:
        return None
    diffs = [orig[k] - twin[k] for k in keys]
    rng = random.Random(seed)
    boots = sorted(sum(rng.choice(diffs) for _ in diffs) / len(diffs) for _ in range(reps))
    return sum(diffs) / len(diffs), boots[int(0.05 * reps)], boots[int(0.95 * reps)], len(keys)


def main(contract):
    sets = {sid: info for sid, info in view(contract, "list_sets", {"from": 0, "limit": 200})}
    current = view(contract, "config", {})["grader_version"]
    every = paged(contract, "get_certificates")
    # Only the grader the contract points at now counts. Older versions stay
    # on chain with their version recorded, so the history is still there.
    certs = [c for c in every if c["grader_version"] == current]
    faulty = {sid: set(info["faulty"]) for sid, info in sets.items()}
    grid = per_question(certs, faulty)

    print(f"grader {current[:12]}: {len(certs)} certificates over {len(sets)} sets "
          f"({len(every) - len(certs)} from older grader versions not counted)\n")
    print("SCORES (faulty questions dropped)")
    for (model, sid), res in sorted(grid.items()):
        n, k = len(res), sum(res.values())
        exp = ",".join(sets[sid]["exposed_to"]) or "-"
        print(f"  {model:40s} {sid:16s} {k:3d}/{n:<3d} {100*k/max(n,1):5.1f}%   seen by: {exp}")

    # Twins share a template id with their original; sets are named
    # <family>-original-<part> and <family>-twin-<part>.
    print("\nCONTAMINATION GAP (original minus matched twin, 90% interval)")
    by_model = defaultdict(lambda: ({}, {}))
    for (model, sid), res in grid.items():
        if "-original-" in sid or "-twin-" in sid:
            side = 0 if "-original-" in sid else 1
            part = sid.split("-")[-1]
            for idx, v in res.items():
                by_model[model][side][(part, idx)] = v
    for model, (o, t) in sorted(by_model.items()):
        g = gap(o, t)
        if g:
            mean, lo, hi, n = g
            print(f"  {model:40s} {100*mean:+6.1f} pts  [{100*lo:+.1f}, {100*hi:+.1f}]  n={n} pairs")

    print("\nWRITER OUTLIERS (p < 0.01)")
    found = False
    for c_key in {(c["model"], c["set_id"]) for c in certs}:
        model, sid = c_key
        tallies = defaultdict(lambda: [0, 0])
        for c in certs:
            if (c["model"], c["set_id"]) == c_key:
                for t in c["by_author"]:
                    tallies[t["author"]][0] += t["asked"]
                    tallies[t["author"]][1] += t["correct"]
        if len(tallies) < 2:
            continue
        for author, (n, k) in tallies.items():
            rest_n = sum(v[0] for a, v in tallies.items() if a != author)
            rest_k = sum(v[1] for a, v in tallies.items() if a != author)
            if rest_n == 0 or n == 0:
                continue
            p = min(max(rest_k / rest_n, 0.01), 0.99)
            tail = binom_tail(k, n, p)
            if tail < 0.01:
                found = True
                print(f"  {model} on {sid}: {author} {k}/{n} vs rest {rest_k}/{rest_n}  p={tail:.4f}")
    if not found:
        print("  none")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "app.proctor-91796.testnet")
