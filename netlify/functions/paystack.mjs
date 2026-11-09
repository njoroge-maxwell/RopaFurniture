// Card + M-Pesa payments through Paystack, tied to an order.
//   Netlify settings: PAYSTACK_SECRET_KEY (sk_test_… or sk_live_…), SITE_URL (e.g. https://ropa-furniture.netlify.app)
import crypto from "node:crypto";
import { store, json, readBody, updateJSON, getOrderByToken, totalOf, paidOf, MIN_PAYMENT, DEPOSIT_RATE, clean } from "./lib/db.mjs";

const API = "https://api.paystack.co";
const secret = () => (process.env.PAYSTACK_SECRET_KEY || "").trim();
const siteUrl = (req) => (process.env.SITE_URL || new URL(req.url).origin).replace(/\/$/, "");

async function ps(path, { method = "GET", body } = {}) {
  if (!secret()) throw new Error("PAYSTACK_SECRET_KEY is not set in Netlify");
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${secret()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false) throw new Error(`Paystack error ${res.status}: ${data.message || "unknown"}`);
  return data;
}

// Adds a confirmed Paystack payment to its order (safe to call twice for the same payment).
async function record(s, tx) {
  const m = /^ROPA-(\d+)-/.exec(tx.reference || "");
  if (!m || String(tx.status).toLowerCase() !== "success" || tx.currency !== "KES") return false;
  const number = Number(m[1]);
  if (String(tx.metadata?.order_number) !== String(number)) return false;
  const amount = Number(tx.amount) / 100;
  const o = await updateJSON(s, `order:${number}`, (o) => {
    if ((o.payments || []).some((p) => p.id === tx.reference)) return undefined;
    o.payments = [...(o.payments || []), { id: tx.reference, ref: tx.reference, amount, method: "paystack", channel: tx.channel || "", date: tx.paid_at || new Date().toISOString(), note: "" }];
    return o;
  });
  return !!o;
}

export default async (req) => {
  try {
    const s = store();
    const url = new URL(req.url);

    // 1) The customer comes back from Paystack: confirm with Paystack and record the payment
    if (req.method === "GET") {
      const reference = url.searchParams.get("reference") || "";
      if (!/^[A-Za-z0-9._=-]{5,100}$/.test(reference)) return json({ error: "Bad reference" }, 400);
      const { data } = await ps(`/transaction/verify/${encodeURIComponent(reference)}`);
      const st = String(data.status || "").toLowerCase();
      if (st === "success") await record(s, data);
      const status = st === "success" ? "success" : ["ongoing", "pending", "processing", "queued"].includes(st) ? "pending" : "failed";
      return json({ status, amount: Number(data.amount) / 100 });
    }
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    // 2) Paystack's own notification: so a payment is recorded even if the customer never returns to the site
    const sig = req.headers.get("x-paystack-signature");
    if (sig) {
      const raw = await req.text();
      if (crypto.createHmac("sha512", secret()).update(raw).digest("hex") === sig) {
        const ev = JSON.parse(raw);
        if (ev.event === "charge.success" && ev.data?.reference) {
          const { data } = await ps(`/transaction/verify/${encodeURIComponent(ev.data.reference)}`);
          await record(s, data);
        }
      } else console.warn("Paystack webhook with a bad signature ignored");
      return json({ received: true });
    }

    // 3) Start a payment for an order
    const b = await readBody(req);
    const order = await getOrderByToken(s, b.token);
    if (!order) return json({ error: "Order not found." }, 404);
    const total = totalOf(order), paid = paidOf(order), balance = total - paid;
    if (balance <= 0) return json({ error: "This order is already fully paid." }, 400);

    let amount;
    if (b.mode === "deposit") {
      if (paid > 0) return json({ error: "The 50% deposit is only available before the first payment." }, 400);
      amount = Math.min(Math.ceil(total * DEPOSIT_RATE), balance);
    } else if (b.mode === "custom") {
      const c = Number(b.customAmount), min = Math.min(MIN_PAYMENT, balance);
      if (!Number.isInteger(c) || c < min) return json({ error: `The smallest amount you can pay online is KSh ${min.toLocaleString("en-KE")}.` }, 400);
      if (c > balance) return json({ error: `That's more than the balance of KSh ${balance.toLocaleString("en-KE")}.` }, 400);
      amount = c;
    } else amount = balance;

    let email = clean(b.email, 100) || order.customer.email;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "")) return json({ error: "Please enter a valid email address to pay online." }, 400);
    if (email !== order.customer.email) await updateJSON(s, `order:${order.number}`, (o) => { o.customer.email = email; return o; });

    const reference = ("ROPA-" + order.number + "-" + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 90 + 10)).slice(0, 60);
    const kind = b.mode === "deposit" ? "50% deposit" : b.mode === "custom" ? "Part payment" : "Payment";
    const { data } = await ps("/transaction/initialize", {
      method: "POST",
      body: {
        email, amount: Math.round(amount * 100), currency: "KES", reference,
        channels: ["mobile_money", "card"],
        callback_url: `${siteUrl(req)}/?o=${order.token}`,
        metadata: {
          order_number: order.number, payment_type: b.mode || "full",
          custom_fields: [
            { display_name: "Order", variable_name: "order", value: "#" + order.number },
            { display_name: "Customer", variable_name: "customer", value: order.customer.name },
            { display_name: "Phone", variable_name: "phone", value: order.customer.phone },
            { display_name: "Payment", variable_name: "payment", value: kind },
            { display_name: "Order total", variable_name: "order_total", value: "KSh " + total.toLocaleString("en-KE") },
            { display_name: "Balance after this payment", variable_name: "balance", value: "KSh " + (balance - amount).toLocaleString("en-KE") },
          ],
        },
      },
    });
    if (!data.authorization_url) throw new Error("Paystack did not return a payment link");
    return json({ redirect_url: data.authorization_url, reference, amount });
  } catch (e) {
    console.error(e);
    return json({ error: "Could not start the payment. Please try again later." }, 502);
  }
};
