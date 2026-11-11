# Ropa Furniture website

## What's in the folder
- index.html — the website customers see (categories, products, orders, reviews)
- admin.html — YOUR private page for orders, payments, products and reviews (open https://your-site/admin.html)
- images/ — product photos and the logo
- netlify/functions/ — the small programs that save orders, take payments and power the admin page
- data/seed.json — the starting product list (after you save anything in the admin page, the admin page is the master copy)
- package.json, netlify.toml — Netlify setup

Upload everything, keeping the folders exactly as they are.

## Settings in Netlify (Project configuration -> Environment variables)
| Name | What to put |
|---|---|
| ADMIN_PASSWORD | A long password of your choice. You use it to log in to /admin.html. Tick "Contains secret values". |
| PAYSTACK_SECRET_KEY | Your Paystack secret key (sk_test_... for practice, sk_live_... for real money). Tick "Contains secret values". |
| SITE_URL | https://ropa-furniture.netlify.app  (no slash at the end) |

After changing settings: Deploys -> Trigger deploy -> Deploy project.
Optional: in Paystack (Settings -> API Keys & Webhooks) set the Webhook URL to
https://ropa-furniture.netlify.app/.netlify/functions/paystack so payments are recorded even if a customer closes the page.

## How orders work
1. A customer chooses a piece (and wood / cord colour where offered), adds it to their order and places it.
2. They land on their own private order page with a downloadable PROFORMA INVOICE and options to pay: in full, 50% deposit or any custom amount, by card or M-Pesa (Paystack). They can pay the balance later from the same page.
3. Every order appears in your admin page with its payment status: Awaiting payment / Part paid / Paid.
4. After a payment, the customer can download a RECEIPT from their order page.

## Using the admin page (/admin.html)
- Orders: see every order, search, filter by payment status, export to CSV. Open an order to record cash / M-Pesa / bank payments you received directly, add a delivery fee or discount, change the order status (New, In production, Ready, Delivered, Cancelled) and keep private notes.
- "Send invoice on WhatsApp" / "Send receipt on WhatsApp" open a chat with the customer with the message already written; you tap send. (Sending automatically needs the WhatsApp Business API, which requires a verified business.)
- Insights: visits, visitors, pages viewed, most viewed products (with how many were added to an order and actually ordered), most viewed collections, visitors by country and city, and which websites sent them (e.g. Instagram). Choose the last 7, 30 or 90 days. Counting is private: no cookies, no IP addresses, no personal details; it respects a browser's "Do Not Track" setting, ignores search-engine robots, and does not count your own visits once you have logged in to the admin page on that browser. Numbers are approximate and start from the day this version goes live.
- Products: add a product (name, category, price, description, photos, choices, specifications). Type a new category name to create a new category. Choices are one per line, e.g.  Wood: Mango wood, Mahogany  and  Cord colour: Tan, Black. Leave the price empty to show "Price on request" (customers can't order it online until you set a price).
  A choice can also set or change the price. Write the amount after it: `Heater: Wood burner = 400000, Electric burner = 300000` makes the price depend on the heater (this is how the sauna works: leave the main price empty), and `Wood: Mango wood, Mahogany + 5000` adds KSh 5,000 when Mahogany is chosen (use `- 2000` to take money off). "Hide" removes a product from the website without deleting it.
- Reviews: customers' reviews wait for your approval. You can also add a genuine review yourself.
- Delete any test orders you made.

## Notes
- Orders, products, photos you upload and reviews are stored in Netlify (Blobs, store "ropa-data").
- The smallest custom online payment is KSh 100: change MIN_PAYMENT in index.html and netlify/functions/lib/db.mjs together.
- Order numbers run 1001, 1002, ... (START in netlify/functions/lib/db.mjs).

## Removing the "Powered by Netlify" badge
Netlify -> your project -> Project configuration -> General -> "Powered by Netlify badge" -> switch it off -> Save.
No redeploy is needed. This is free.
