// Privacy-friendly visit counter: counts visits, page views, product views and where visitors are (country / city).
// It stores only totals per day. No cookies, no IP addresses, no personal data.
import { store, json, readBody, updateJSON, dayKey } from "./lib/db.mjs";

const BOT = /bot|crawl|spider|slurp|preview|monitor|headless|lighthouse|facebookexternalhit|whatsapp|curl|wget/i;
const TYPES = ["home", "cat", "product", "add"];
const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

export default async (req, context) => {
  try {
    if (req.method !== "POST" || BOT.test(req.headers.get("user-agent") || "")) return json({ ok: true });
    const b = await readBody(req);
    if (!TYPES.includes(b.type)) return json({ ok: true });
    const id = b.type === "home" ? "" : String(b.id ?? "").slice(0, 60);
    if (b.type !== "home" && !/^[\w-]{1,60}$/.test(id)) return json({ ok: true });

    const s = store(), key = `stats:${dayKey()}`;
    await s.set(key, JSON.stringify({ v: 0, u: 0, pv: 0, products: {}, adds: {}, cats: {}, countries: {}, cn: {}, cities: {}, refs: {} }), { onlyIfNew: true });

    const code = String(context?.geo?.country?.code || "??").slice(0, 3), cname = String(context?.geo?.country?.name || "Unknown").slice(0, 60);
    const city = String(context?.geo?.city || "").slice(0, 60);
    const ref = String(b.ref || "").toLowerCase().replace(/[^a-z0-9.-]/g, "").slice(0, 60);

    await updateJSON(s, key, (d) => {
      if (b.visit) {
        d.v++; bump(d.countries, code); d.cn[code] = cname;
        if (city) bump(d.cities, `${city}, ${code}`);
        if (ref) bump(d.refs, ref);
        if (b.newVisitor) d.u++;
      }
      if (b.type === "home" || b.type === "cat" || b.type === "product") d.pv++;
      if (b.type === "product") bump(d.products, id);
      if (b.type === "cat") bump(d.cats, id);
      if (b.type === "add") bump(d.adds, id);
      return d;
    }, 12, 80);
    return json({ ok: true });
  } catch (e) { console.error(e); return json({ ok: true }); }   // never get in the customer's way
};
