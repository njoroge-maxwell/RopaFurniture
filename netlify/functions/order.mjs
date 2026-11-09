// Public: place an order (POST) and look an order up by its private link token (GET).
import { store, getCatalog, createOrder, getOrderByToken, publicOrder, json, readBody, rid, clean } from "./lib/db.mjs";

export default async (req) => {
  try {
    const s = store();
    if (req.method === "GET") {
      const o = await getOrderByToken(s, new URL(req.url).searchParams.get("token"));
      return o ? json({ order: publicOrder(o) }) : json({ error: "Order not found" }, 404);
    }
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const b = await readBody(req);
    if (b.website) return json({ error: "Rejected" }, 400);                       // hidden "honeypot" field: only bots fill it in
    const name = clean(b.customer?.name, 80), phone = clean(b.customer?.phone, 30);
    const email = clean(b.customer?.email, 100), area = clean(b.customer?.area, 120), note = clean(b.customer?.note, 400);
    if (!name || phone.replace(/\D/g, "").length < 9) return json({ error: "Please enter your name and a valid phone number." }, 400);
    if (!area) return json({ error: "Please tell us where to deliver." }, 400);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "That email address doesn't look right." }, 400);
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 30) return json({ error: "Your order is empty." }, 400);

    const catalog = await getCatalog(s);
    const items = [];
    for (const it of b.items) {
      const p = catalog.products.find((x) => x.id === Number(it.id) && !x.hidden);
      const qty = Number(it.qty);
      if (!p || !Number.isInteger(p.price) || p.price <= 0) return json({ error: "One of the items can't be ordered online. Please remove it and try again." }, 400);
      if (!Number.isInteger(qty) || qty < 1 || qty > 20) return json({ error: "Invalid quantity." }, 400);
      const options = {};
      for (const g of p.options || []) {                                           // only accept values the product really offers
        const want = it.options && it.options[g.name];
        options[g.name] = g.values.includes(want) ? want : g.values[0];
      }
      items.push({ id: p.id, name: p.name, price: p.price, qty, options, image: p.images?.[0] || "" });
    }
    const rec = await createOrder(s, {
      token: rid(12), createdAt: new Date().toISOString(),
      customer: { name, phone, email, area, note },
      items, adjustments: [], payments: [], fulfilment: "new", notes: "",
    });
    return json({ number: rec.number, token: rec.token }, 201);
  } catch (e) {
    console.error(e);
    return json({ error: "We couldn't place your order. Please try again." }, 500);
  }
};
