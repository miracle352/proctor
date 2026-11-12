// Checks a certificate against the Intel TDX quote of the machine that marked it.
// Everything is recomputed here, in the visitor's browser, from public data:
// /api/proof only fetches. The one thing left to Intel's own verifier is the
// quote's signature chain, which OutLayer's page checks in the browser too.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { NET } from "../network.js";
import { view } from "./chain.js";

// JSON with keys sorted and no spaces: the form OutLayer hashes the output in
const canon = (v) => Array.isArray(v) ? `[${v.map(canon).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`
  : JSON.stringify(v);

const le = (n, bytes) => { const b = new Uint8Array(bytes); let x = BigInt(n); for (let i = 0; i < bytes; i++) { b[i] = Number(x & 255n); x >>= 8n; } return b; };
const join = (parts) => { const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// OutLayer's task hash, field for field as its own dashboard computes it
export function taskHash(a) {
  const p = [utf8ToBytes(a.task_type), le(a.task_id, 8)];
  for (const k of ["repo_url", "commit_hash", "build_target", "wasm_hash", "input_hash"]) if (a[k]) p.push(utf8ToBytes(a[k]));
  p.push(utf8ToBytes(a.output_hash));
  if (a.block_height != null) p.push(le(a.block_height, 8));
  if (a.timestamp >= 1769784939) {
    for (const k of ["caller_account_id", "project_id", "secrets_ref"]) if (a[k]) p.push(utf8ToBytes(a[k]));
    p.push(le(a.timestamp, 8));
    if (a.attached_usd) p.push(utf8ToBytes(String(a.attached_usd)));
  }
  return bytesToHex(sha256(join(p)));
}

// TDX quote v4: 48-byte header, then the TD report
export function readQuote(q) {
  const hex = (o, n) => bytesToHex(q.slice(o, o + n));
  const body = 48;
  return {
    mrtd: hex(body + 136, 48),
    rtmr: [0, 1, 2, 3].map((i) => hex(body + 328 + 48 * i, 48)),
    reportData: hex(body + 520, 32),
  };
}

export async function check(p) {
  const c = p.certificate, a = p.attestation, out = p.output;
  const rows = [];
  const add = (ok, title, detail) => rows.push({ ok, title, detail });
  if (!a) { add(false, "OutLayer has no attestation for this run", `Request ${p.request_id}`); return rows; }

  const outHash = bytesToHex(sha256(utf8ToBytes(canon(out))));
  add(outHash === a.output_hash, "The hardware signed this exact marking",
    `The report the contract received hashes to ${outHash.slice(0, 16)}…, the output hash in the attestation.`);

  const fields = ["model", "set_id", "start", "asked", "correct", "results"];
  const same = fields.every((k) => JSON.stringify(out[k]) === JSON.stringify(c[k])) && JSON.stringify(out.chat_ids || []) === JSON.stringify(c.chat_ids || []);
  add(same, "The certificate says what the hardware marked", `Model, questions, score and the AI's receipts match field for field.`);

  add(a.wasm_hash === c.grader_version, "It ran the published marking program",
    `Build ${a.wasm_hash.slice(0, 16)}…, the same hash the certificate records. Anyone can rebuild it from the repo.`);

  const ref = `${p.set.keeper}/${c.set_id}`;
  add(a.secrets_ref === ref, "It opened the sealed questions inside the enclave", `Secret ${ref}, readable only by that hardware.`);

  const quote = b64(a.tdx_quote), q = readQuote(quote);
  const th = taskHash(a);
  add(th === q.reportData, "The quote is bound to this run",
    `All of the above hashes to ${th.slice(0, 16)}…, which sits inside Intel's signed quote.`);

  let approved = false;
  try {
    approved = q.rtmr[3] === a.worker_measurement &&
      await view("is_measurements_approved", { measurements: { mrtd: q.mrtd, rtmr0: q.rtmr[0], rtmr1: q.rtmr[1], rtmr2: q.rtmr[2], rtmr3: q.rtmr[3] } }, NET.worker);
  } catch {}
  add(approved, "The machine is one NEAR has approved", `Its measurements are on the approved list in ${NET.worker}.`);
  return rows;
}

export async function prove(certId) {
  const r = await fetch(`/api/proof?cert=${certId}`);
  const p = await r.json().catch(() => ({ error: "Bad reply" }));
  if (!r.ok) throw new Error(p.error || `HTTP ${r.status}`);
  return { proof: p, rows: await check(p) };
}
