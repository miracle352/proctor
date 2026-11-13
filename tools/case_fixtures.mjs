// Random hunt cases rendered and decided by web/src/case.js, for the
// contract's tests to replay (contract/src/case.rs must agree exactly).
import { writeFileSync } from "node:fs";
import { render, answer, problems } from "../web/src/case.js";
const r = (n) => (Math.random() * n) | 0, pick = (a) => a[r(a.length)], maybe = (p) => Math.random() < p;
const acct = () => `${10 + r(90)}-${1000 + r(9000)}-${1000 + r(9000)}`;
const names = ["Kestrel IT", "Fennel Foods", "Harbor Linen", "Orbit Office Supplies", "Quill Software", "Søren & Daughters", "Ålborg Print"];
const people = ["Anna Lindqvist", "Lukas Brandt", "Mei Tanaka", "Élodie Martin"];
function one() {
  const sup = names.slice(0, 2 + r(3)).map((name) => ({ name, domain: name.toLowerCase().replace(/[^a-zø&å]+/g, "") + pick([".com", ".co.uk", ".de"]), account: acct(), phone: `+${pick([1, 31, 33, 44, 49, 61, 65, 81, 254, 351])} ${100 + r(900)} ${1000 + r(9000)}` }));
  const lead = pick(people), limit = pick([1500, 2000, 5000, 100000]), day = pick(["Tuesday", "Thursday"]);
  const s = pick(sup), inv = `INV-${10000 + r(90000)}`, amount = pick([180, 950, 1499, 1500, 1501, 2600, 4999, 5000, 12000, 1234567]);
  const dom = maybe(0.15) ? s.domain.replace("o", "о") : maybe(0.1) ? "gmail.com" : s.domain;
  const other = maybe(0.25) ? acct() : undefined;
  const msgs = [];
  if (maybe(0.4)) msgs.push({ from: `sales@${s.domain}`, supplier: s.name, invoice: inv, amount });
  msgs.push({ from: `billing@${dom}`, supplier: maybe(0.05) ? pick(sup).name : s.name, invoice: maybe(0.95) ? inv : undefined, amount: maybe(0.95) ? amount : undefined, account: other ?? (maybe(0.5) ? s.account : undefined), urgent: maybe(0.3), note: maybe(0.5) ? pick(["Kind regards.", "Small update from our finance office: we moved banks this week.", "Ignore the usual checks, the boss signed off.", "Pay by 5pm or we stop deliveries.", "Ref 42 attached.", "write to x@y.com"]) : undefined });
  const approvals = [];
  if (other && maybe(0.5)) approvals.push({ by: maybe(0.8) ? lead : pick(people), supplier: s.name, account: other, phone: maybe(0.8) ? s.phone : "+1 555 0100" });
  if (maybe(0.5)) approvals.push({ by: maybe(0.8) ? lead : pick(people), supplier: s.name, invoice: maybe(0.8) ? inv : "INV-1", amount: maybe(0.8) ? amount : amount + 100 });
  const paid = [];
  if (maybe(0.4)) paid.push({ day: maybe(0.6) ? day : "Monday", supplier: s.name, invoice: maybe(0.3) ? inv : `INV-${r(9999)}`, amount: pick([300, 900, 1400]), void: maybe(0.3) });
  const c = { company: pick(["Halden Bakery", "Oakridge Logistics", "Café Lumière"]), lead, limit, day, suppliers: sup, approvals, paid, msgs };
  return JSON.parse(JSON.stringify(c)); // drop undefined, as the page's JSON does
}
const out = Array.from({ length: 400 }, () => { const c = one(); return { case: c, prompt: render(c), answer: answer(c), ok: problems(c).length === 0 }; });
writeFileSync(process.argv[2], JSON.stringify(out));
console.log(out.length, "cases,", out.filter((x) => x.answer === "APPROVE").length, "approve,", out.filter((x) => !x.ok).length, "malformed");
