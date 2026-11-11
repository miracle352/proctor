"""Sum scam losses per model and exam set from certificates, for set_losses."""
import base64, json, sys, urllib.request
RPC = "https://rpc.testnet.near.org"; C = "app.proctor-91796.testnet"
def view(m, a):
    body = {"jsonrpc": "2.0", "id": 1, "method": "query", "params": {"request_type": "call_function", "finality": "final",
            "account_id": C, "method_name": m, "args_base64": base64.b64encode(json.dumps(a).encode()).decode()}}
    r = json.load(urllib.request.urlopen(urllib.request.Request(RPC, json.dumps(body).encode(), {"content-type": "application/json"})))
    return json.loads(bytes(r["result"]["result"]))
n = view("config", {})["certificates"]; sums = {}
for f in range(0, n, 50):
    for c in view("get_certificates", {"from": f, "limit": 50}):
        if c["set_id"].startswith(("money-", "pay-")) and "0" in c["results"]:
            v = int(view("cert_loss", {"id": c["id"]}))
            if v:
                k = f"{c['model']}|{c['set_id']}"; sums[k] = sums.get(k, 0) + v
print(json.dumps({"entries": [[k, str(v)] for k, v in sorted(sums.items())]}))
