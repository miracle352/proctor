// Seal a hunt with the same code the browser runs (web/src/seal.js).
//   node tools/seal_hunt.mjs items.jsonl OWNER SET_ID BUILD OUT_DIR
import { readFileSync, writeFileSync } from "node:fs";
import { sealHunt } from "../web/src/seal.js";
const [src, owner, setId, build, out] = process.argv.slice(2);
const items = readFileSync(src, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const s = await sealHunt({ owner, setId, items, build });
writeFileSync(`${out}/${setId}.json`, s.text);
writeFileSync(`${out}/${setId}.store.json`, JSON.stringify(s.store));
console.log(JSON.stringify({ set_id: setId, sha256: s.sha256, size: items.length, storage_yocto: s.storage.toString(), pubkey: s.pubkey }));
