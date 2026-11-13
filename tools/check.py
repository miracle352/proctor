"""Read Revoke's state from NEAR testnet with only Python's standard library.

No wallet, no keys, no OutLayer: these are free view calls to the contract,
so they work even when OutLayer's testnet is down.

    python3 tools/check.py            licences, suspensions, hunts
    python3 tools/check.py cert 1146  one certificate
"""
import base64
import json
import os
import sys
import urllib.request

CONTRACT = os.environ.get("CONTRACT", "app.proctor-91796.testnet")
NODES = [os.environ.get("RPC", "https://rpc.testnet.fastnear.com"), "https://rpc.testnet.near.org"]
MODELS = ["Qwen/Qwen3.8-27B", "anthropic/claude-haiku-5-5", "anthropic/claude-sonnet-5-5", "openai/gpt-6.1-sol",
          "openai/gpt-5-nano", "google/gemini-3.1-flash-lite",
          "agent:builder.proctor-91796.testnet/careful-payer", "agent:builder.proctor-91796.testnet/fast-payer"]


def view(method, args=None):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "query", "params": {
        "request_type": "call_function", "finality": "final", "account_id": CONTRACT, "method_name": method,
        "args_base64": base64.b64encode(json.dumps(args or {}).encode()).decode()}}).encode()
    last = None
    for url in NODES:
        try:
            req = urllib.request.Request(url, body, {"content-type": "application/json", "user-agent": "revoke-check"})
            r = json.load(urllib.request.urlopen(req, timeout=20))["result"]
            if "error" in r:
                raise RuntimeError(r["error"])
            return json.loads(bytes(r["result"]))
        except Exception as e:  # try the next node
            last = e
    raise SystemExit(f"NEAR testnet didn't answer: {last}")


def main():
    if sys.argv[1:2] == ["cert"]:
        n = int(sys.argv[2])
        print(json.dumps(view("get_certificates", {"from": n, "limit": 1})[0], indent=2))
        return
    print('Money licences ("money" is the basic wallet test, "money-pro" the hard one)')
    for m in MODELS:
        for skill in ("money", "money-pro"):
            r = view("licence", {"model": m, "skill": skill})
            mark = "LICENSED" if r["licensed"] else "no"
            print(f"  {m:<52} {skill:<10} {r['right']:>2}/{r['asked']:<3} {mark:<9} {r['reason']}")
    print("\nSuspended or revoked by hunters")
    for key, s in view("list_suspensions"):
        print(f"  {key:<60} {'revoked' if s['confirmed'] else 'suspended'} by {s['hunter']} in {s['set_id']} (certificate {s['cert_id']})")
    print("\nHunts")
    for h in view("list_hunts"):
        state = ("settled, void" if h["void"] else "settled, hunter paid") if h["settled"] else ("revealed" if h["revealed_ms"] else "sealed")
        caught = ", ".join(c["model"] for c in h["catches"]) or "nobody yet"
        print(f"  {h['set_id']:<34} by {h['hunter']:<26} {state:<21} caught: {caught}")


if __name__ == "__main__":
    main()
