"""Request one certified run and print what came back.

    python3 tools/run.py SET_ID MODEL START COUNT [--as ACCOUNT]

Signs with the near CLI's legacy keychain. The deposit covers the writers'
fee plus OutLayer's execution cost; OutLayer refunds what it does not use.
"""

import base64
import json
import re
import subprocess
import sys
import urllib.request

CONTRACT = "app.proctor-91796.testnet"
RPC = "https://rpc.testnet.fastnear.com"


def tx_outcome(tx, sender):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "EXPERIMENTAL_tx_status",
                       "params": {"tx_hash": tx, "sender_account_id": sender, "wait_until": "FINAL"}}).encode()
    r = json.load(urllib.request.urlopen(urllib.request.Request(RPC, body, {"content-type": "application/json"}), timeout=120))
    events, raw = [], None
    for o in r["result"]["receipts_outcome"]:
        oc = o["outcome"]
        events += [l for l in oc["logs"] if l.startswith("EVENT proctor")]
        if oc["executor_id"] == "outlayer.testnet":
            events += [l for l in oc["logs"] if "failed" in l.lower()]
            sv = oc["status"].get("SuccessValue")
            if sv:
                raw = base64.b64decode(sv).decode(errors="replace")
    return events, raw


def main():
    args = sys.argv[1:]
    signer = "proctor-91796.testnet"
    if "--as" in args:
        i = args.index("--as")
        signer = args[i + 1]
        del args[i:i + 2]
    set_id, model, start, count = args[0], args[1], int(args[2]), int(args[3])
    payload = json.dumps({"set_id": set_id, "model": model, "start": start, "count": count})
    out = subprocess.run(
        ["near", "contract", "call-function", "as-transaction", CONTRACT, "request_run", "json-args", payload,
         "prepaid-gas", "300 Tgas", "attached-deposit", "0.5 NEAR", "sign-as", signer,
         "network-config", "testnet", "sign-with-legacy-keychain", "send"],
        capture_output=True, text=True)
    text = out.stdout + out.stderr
    m = re.search(r"Transaction ID: (\w+)", text)
    if not m:
        print(text[-1500:])
        sys.exit(1)
    events, raw = tx_outcome(m.group(1), signer)
    print("tx", m.group(1))
    for e in events:
        print(" ", e)
    if raw and raw != "null":
        print("  grader:", raw[:600])


if __name__ == "__main__":
    main()
