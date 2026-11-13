// Is the code deployed on a NEAR account exactly what this repo builds?
//   node tools/verify_build.mjs <account>          prints the commit and path the account says it was built from
//   node tools/verify_build.mjs <account> <wasm>   compares a wasm you built with the code on chain
// Every contract here is built with `cargo near build reproducible-wasm` (NEP-330): the
// build runs in a pinned Docker image, so the same commit gives the same bytes anywhere.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const RPC = process.env.RPC || "https://rpc.testnet.fastnear.com";
const [account, wasm] = process.argv.slice(2);
if (!account) { console.error("usage: node tools/verify_build.mjs <account> [wasm]"); process.exit(2); }

async function rpc(params) {
  for (let i = 0; ; i++) {
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { finality: "final", ...params } }) }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
    if (!r.error && !r.result?.error) return r.result;
    if (i >= 4) throw new Error(JSON.stringify(r.error || r.result.error));
    await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
  }
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const base58 = (bytes) => {
  let n = BigInt("0x" + Buffer.from(bytes).toString("hex")), s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = "1" + s; else break; }
  return s;
};

const meta = await rpc({ request_type: "call_function", account_id: account, method_name: "contract_source_metadata", args_base64: "" })
  .then((r) => JSON.parse(Buffer.from(r.result).toString())).catch(() => null);
const info = meta?.build_info;
const rev = info?.source_code_snapshot?.match(/rev=([0-9a-f]{40})/)?.[1];

if (!wasm) {
  if (!rev) { console.error(`${account}: no NEP-330 build info on chain, so there is nothing to rebuild from`); process.exit(1); }
  console.log(JSON.stringify({ account, rev, path: info.contract_path, image: info.build_environment, command: info.build_command }));
  process.exit(0);
}

const { code_hash } = await rpc({ request_type: "view_account", account_id: account });
const built = base58(createHash("sha256").update(readFileSync(wasm)).digest());
const same = built === code_hash;
console.log(`${account}\n  on chain: ${code_hash}\n  built:    ${built}  (${wasm}${rev ? `, commit ${rev.slice(0, 10)}, ${info.contract_path}/` : ""})\n  ${same ? "same bytes: the deployed code is this repo's code" : "DIFFERENT"}`);
process.exit(same ? 0 : 1);
