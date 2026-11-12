// Gathers the hardware proof for some certificates and runs the same checks
// the site runs in the browser. Also tampers with one to show the checks bite.
// node tools/proof_check.mjs [cert ...]
globalThis.matchMedia ??= () => ({ matches: false });
const handler = (await import("../web/api/proof.js")).default;
const { check } = await import("../web/src/proof.js");

const gather = (cert) => new Promise((resolve) =>
  handler({ url: `/api/proof?cert=${cert}` }, { setHeader() {}, status() { return this; }, json: resolve }));

const certs = process.argv.slice(2).map(Number);
let bad = 0;
for (const cert of certs.length ? certs : [982, 1146, 1196]) {
  const p = await gather(cert);
  if (p.error) { console.log(`#${cert}  ${p.error}`); bad++; continue; }
  const rows = await check(p);
  const ok = rows.every((r) => r.ok);
  if (!ok) bad++;
  console.log(`#${cert}  ${ok ? "holds" : "FAILS"}  request ${p.request_id}, task ${p.attestation?.task_id}`);
  for (const r of rows) console.log(`   ${r.ok ? "ok " : "NO "} ${r.title}`);
  const forged = structuredClone(p); forged.certificate.correct += 1;
  if ((await check(forged)).every((r) => r.ok)) { console.log("   a forged score passed"); bad++; }
}
process.exit(bad ? 1 : 0);
