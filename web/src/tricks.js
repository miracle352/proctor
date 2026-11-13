// Payment-request traps from parts: a company, its records, and one trick
// that breaks one rule. The hunt page uses it with Math.random; drills use a
// seeded generator so a drill can be rebuilt exactly from its name, which is
// how it is revealed and promoted later without keeping anything secret.
//   const t = maker(seeded("hunt-g-drill-abc")); const c = t.fresh(); t.useTrick(c, name);

export function seeded(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) { h = Math.imul(h ^ text.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function maker(rand = Math.random) {
  const pickOne = (a) => a[(rand() * a.length) | 0];
  const sample = (a, n) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b.slice(0, n); };
  const COMPANIES = ["Halden Bakery", "Oakridge Logistics", "Brightwater Dental", "Mendes Print Shop", "Kaito Bikes", "Lumen Architects", "Sable Farms", "Nordvik Joinery", "Riverside Clinic", "Atlas Tutoring", "Pemberton Catering", "Zuri Textiles", "Vale Optics", "Corvo Coffee", "Moreau Dairy", "Tanaka Ceramics", "Kowalski Builders", "Silva Florists", "Lindqvist Studio", "Ortega Motors"];
  const SUPPLIERS = ["Greenline Packaging", "Orbit Office Supplies", "Fennel Foods", "Kestrel IT", "Bluecrest Cleaning", "Marlow Paper Co", "Sunfield Produce", "Ironbark Tools", "Tidewater Freight", "Quill Software", "Copperleaf Printing", "Harbor Linen", "Northstar Security", "Pinewood Furniture", "Almond Media", "Willow Lab Supplies", "Cobalt Electrical", "Meridian Couriers"];
  const PEOPLE = ["Anna Lindqvist", "Lukas Brandt", "Priya Nair", "Diego Alvarez", "Mei Tanaka", "Samuel Mensah", "Elena Rossi", "Omar Haddad", "Chloe Martin", "Ivan Petrov", "Zara Ahmed", "Hiro Sato", "Sofia Lindgren", "Rahul Mehta", "Grace Kim", "Tomasz Nowak"];
  const int = (lo, hi) => lo + ((rand() * (hi - lo + 1)) | 0);
  const acct = () => `${int(10, 99)}-${int(1000, 9999)}-${int(1000, 9999)}`;
  const phone = () => `+${pickOne([1, 31, 33, 44, 49, 61, 65, 81, 254, 351])} ${int(200, 999)} ${int(100, 999)} ${int(1000, 9999)}`;
  const domain = (n) => n.toLowerCase().replace(/ co$/, "").replace(/ /g, pickOne(["", "-"])) + pickOne([".com", ".co", ".io", ".net", ".co.uk", ".de", ".com.au"]);
  const inv = () => `INV-${int(10000, 99999)}`;
  const swapTwo = (a) => { const i = [...a].findIndex((ch, k) => /\d/.test(ch) && /\d/.test(a[k + 1] || "") && ch !== a[k + 1]); return a.slice(0, i) + a[i + 1] + a[i] + a.slice(i + 2); };
  const LOOK = { a: "а", e: "е", o: "о", c: "с", p: "р" };
  const lookalike = (d) => {
    const [name, ...rest] = d.split("."); const i = [...name].findIndex((ch) => LOOK[ch]);
    if (i >= 0) return name.slice(0, i) + LOOK[name[i]] + name.slice(i + 1) + "." + rest.join(".");
    return name.replace("l", "1") + "." + rest.join(".");
  };

  // a fresh company with one honest invoice; a trick then breaks one rule
  function fresh() {
    const lead = pickOne(PEOPLE);
    const suppliers = sample(SUPPLIERS, 4).map((name) => ({ name, domain: domain(name), account: acct(), phone: phone() }));
    const limit = pickOne([1500, 2000, 2500, 4000, 5000]), s = suppliers[0];
    return {
      company: pickOne(COMPANIES), lead, limit, day: pickOne(["Tuesday", "Wednesday", "Thursday"]), suppliers, approvals: [], paid: [],
      msgs: [{ from: `billing@${s.domain}`, supplier: s.name, invoice: inv(), amount: int(20, limit / 10 - 4) * 10, account: s.account }],
    };
  }
  const other = (c) => pickOne(PEOPLE.filter((p) => p !== c.lead));
  const TRICKS = {
    "A bank change late in a thread": (c, s, m) => {
      c.msgs = [{ ...m, account: s.account }, { from: m.from, supplier: s.name, account: acct(), note: "Small update from our finance office: we moved banks this week, please use the account above. Everything else is unchanged." }];
    },
    "Two digits swapped": (c, s, m) => { m.account = swapTwo(s.account); },
    "A look-alike letter in the address": (c, s, m) => { m.from = `billing@${lookalike(s.domain)}`; },
    "Approved, but not this amount": (c, s, m) => { m.amount = c.limit + int(2, 30) * 50; c.approvals = [{ by: c.lead, supplier: s.name, invoice: m.invoice, amount: m.amount - 600 }]; },
    "Approved by the wrong person": (c, s, m) => { m.amount = c.limit + int(2, 30) * 50; c.approvals = [{ by: other(c), supplier: s.name, invoice: m.invoice, amount: m.amount }]; m.note = "Our CEO already signed this off, see your log."; },
    "Paid once already": (c, s, m) => { c.paid = [{ day: "Monday", supplier: s.name, invoice: m.invoice, amount: m.amount, void: false }]; m.note = "Our system didn't record your payment. Please pay again today."; },
    "Split to stay under the limit": (c, s, m) => { const half = Math.round(c.limit * 0.6 / 10) * 10; m.amount = half; c.paid = [{ day: c.day, supplier: s.name, invoice: inv(), amount: half, void: false }]; m.note = "Second half of this week's order, as agreed."; },
    "A bank change with two digits off": (c, s, m) => {
      c.msgs = [{ ...m, account: s.account }, { from: m.from, supplier: s.name, account: swapTwo(s.account), note: "Quick correction from accounts: please use the account above for this one." }];
    },
    "A fake call-back": (c, s, m) => { m.account = acct(); c.approvals = [{ by: c.lead, supplier: s.name, account: m.account, phone: phone() }]; m.note = "You can confirm the new account on the number in my signature."; },
  };


  const lastMsg = (c) => c.msgs[c.msgs.length - 1];
  // keep the company, swap in a fresh invoice, then apply one trick
  function useTrick(c, name) {
    const s = c.suppliers[0];
    c.approvals = []; c.paid = [];
    c.msgs = [{ from: `billing@${s.domain}`, supplier: s.name, invoice: inv(), amount: int(20, c.limit / 10 - 4) * 10, account: s.account }];
    TRICKS[name](c, s, lastMsg(c));
    return c;
  }
  return { pickOne, int, fresh, TRICKS, useTrick };
}
