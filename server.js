import express from "express";
import Stripe from "stripe";
import { Resend } from "resend";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PREVIEW_DIR = path.join(ROOT, "previews"); // public 30s previews
const FULL_DIR = path.join(ROOT, "full");        // private full mp3s (never served directly)

const {
  STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY,
  FROM_EMAIL = "montemadethis <onboarding@resend.dev>",
  OWNER_EMAIL = "montemadeahit@gmail.com",
  PORT = 3000,
} = process.env;
const BASE_URL = (process.env.BASE_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN : `http://localhost:${PORT}`)
).replace(/\/$/, "");

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;
for (const [k, v] of Object.entries({ STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY }))
  if (!v) console.warn(`[warn] ${k} is not set yet`);

/* ---------- catalog (edit beats.json to add/change beats) ---------- */
const slugify = s => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const BEATS = JSON.parse(fs.readFileSync(path.join(ROOT, "beats.json"), "utf8")).map(b => {
  const slug = b.slug || slugify(b.name);
  return {
    slug, name: b.name, bpm: b.bpm, price: b.price, featured: !!b.featured,
    hasPreview: fs.existsSync(path.join(PREVIEW_DIR, slug + ".mp3")),
    hasFull: fs.existsSync(path.join(FULL_DIR, slug + ".mp3")),
  };
});
const BY_SLUG = new Map(BEATS.map(b => [b.slug, b]));
BEATS.forEach(b => {
  if (!b.hasPreview) console.warn(`[warn] missing previews/${b.slug}.mp3`);
  if (!b.hasFull) console.warn(`[warn] missing full/${b.slug}.mp3 (beat can't be sold until it exists)`);
});
const publicBeats = BEATS.map(b => ({
  slug: b.slug, name: b.name, bpm: b.bpm, price: b.price, featured: b.featured,
  src: b.hasPreview ? `/previews/${b.slug}.mp3` : "",
}));

/* ---------- page rendering (adds per-beat share preview tags) ---------- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const TEMPLATE = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
function render(beat) {
  const title = beat ? `${beat.name} – montemadethis` : "montemadethis";
  const desc = beat ? `${beat.name} · ${beat.bpm} bpm · $${beat.price}. preview and buy.` : "beats by montemadethis";
  const url = BASE_URL + (beat ? `/beat/${beat.slug}` : "/");
  const og = [
    `<meta name="description" content="${esc(desc)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="montemadethis">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta name="twitter:card" content="summary">`,
  ].join("\n");
  return TEMPLATE
    .replace("__TITLE__", () => esc(title))
    .replace("__OG__", () => og)
    .replace("__CATALOG__", () => JSON.stringify(publicBeats).replace(/</g, "\\u003c"));
}

/* ---------- signed download links (valid 30 days) ---------- */
const sign = (slug, order, exp) =>
  crypto.createHmac("sha256", STRIPE_WEBHOOK_SECRET || "dev").update(`${slug}.${order}.${exp}`).digest("hex");
const safeName = n => n.replace(/[^\w\- ]+/g, "").trim() || "beat";

/* ---------- fulfillment: email the buyer their mp3s ---------- */
async function fulfill(session) {
  const beats = (session.metadata?.slugs || "").split(",").map(s => BY_SLUG.get(s)).filter(Boolean);
  const to = session.customer_details?.email || session.customer_email;
  if (!beats.length || !to) throw new Error("order " + session.id + " has no beats or no email");
  const first = esc((session.metadata?.buyer || "").split(" ")[0] || "");
  const exp = Date.now() + 30 * 24 * 3600 * 1000;

  const files = beats.map(b => ({ b, file: path.join(FULL_DIR, b.slug + ".mp3") }));
  const totalBytes = files.reduce((n, f) => n + (fs.existsSync(f.file) ? fs.statSync(f.file).size : 0), 0);
  const attach = totalBytes <= 25 * 1024 * 1024; // email providers cap around 40MB
  const attachments = attach
    ? files.filter(f => fs.existsSync(f.file)).map(f => ({ filename: safeName(f.b.name) + ".mp3", content: fs.readFileSync(f.file) }))
    : [];

  const links = beats.map(b =>
    `<li><a href="${BASE_URL}/download/${b.slug}?o=${encodeURIComponent(session.id)}&e=${exp}&sig=${sign(b.slug, session.id, exp)}">download ${esc(b.name)}.mp3</a></li>`).join("");
  const names = beats.map(b => esc(b.name)).join(", ");
  const one = beats.length === 1;

  const { error } = await resend.emails.send({
    from: FROM_EMAIL, to, replyTo: OWNER_EMAIL,
    subject: one ? `here is your beat: ${beats[0].name}` : `here are your beats: ${beats.map(b => b.name).join(", ")}`,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#111">
      <p>${first ? `hey ${first},` : "hey,"}</p>
      <p>here ${one ? "is your beat" : "are your beats"}: <b>${names}</b></p>
      <p>thank you for purchasing.</p>
      <p>${attach ? `your mp3${one ? " is" : "s are"} attached. ` : "the files were too large to attach, so use the links below. "}you can also re-download any time in the next 30 days:</p>
      <ul>${links}</ul>
      <p>questions? just reply to this email.</p>
      <p>— montemadethis</p></div>`,
    attachments,
  }, { idempotencyKey: "order-" + session.id });
  if (error) throw new Error("email failed: " + JSON.stringify(error));

  // heads-up to you (never blocks the customer's email)
  resend.emails.send({
    from: FROM_EMAIL, to: OWNER_EMAIL,
    subject: `sale: ${beats.map(b => b.name).join(", ")} ($${(session.amount_total / 100).toFixed(2)})`,
    text: `${to} bought ${beats.map(b => b.name).join(", ")}. stripe order ${session.id}`,
  }, { idempotencyKey: "notify-" + session.id }).catch(e => console.error("notify failed", e));
  console.log("fulfilled", session.id, to, beats.map(b => b.slug).join(","));
}

const app = express();

/* Stripe webhook (needs the raw body, so it goes before express.json) */
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error("bad webhook signature", e.message);
    return res.status(400).send("bad signature");
  }
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object;
    if (session.payment_status === "paid") {
      try { await fulfill(session); }
      catch (e) { console.error("fulfill failed", e); return res.status(500).send("retry"); } // Stripe retries automatically
    }
  }
  res.json({ received: true });
});

app.use(express.json());

/* create a Stripe Checkout session (prices come from beats.json, never from the browser) */
app.post("/api/checkout", async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: "payments aren't set up yet" });
    const { slugs, email, name } = req.body || {};
    if (!Array.isArray(slugs) || !slugs.length || slugs.length > 20) return res.status(400).json({ error: "your cart is empty" });
    if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "enter a valid email" });
    const beats = [...new Set(slugs)].map(s => BY_SLUG.get(s));
    if (beats.some(b => !b)) return res.status(400).json({ error: "a beat in your cart no longer exists. refresh and try again" });
    const gone = beats.filter(b => !b.hasFull);
    if (gone.length) return res.status(400).json({ error: `not available right now: ${gone.map(b => b.name).join(", ")}` });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: beats.map(b => ({
        quantity: 1,
        price_data: { currency: "usd", unit_amount: Math.round(b.price * 100),
          product_data: { name: b.name, description: `${b.bpm} bpm · mp3 download` } },
      })),
      payment_intent_data: { receipt_email: email },
      metadata: { slugs: beats.map(b => b.slug).join(","), buyer: String(name || "").slice(0, 100) },
      success_url: `${BASE_URL}/?paid=1`,
      cancel_url: `${BASE_URL}/`,
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error("checkout error", e);
    res.status(500).json({ error: "couldn't start checkout, please try again" });
  }
});

/* private download (only works with the signed link from the email) */
app.get("/download/:slug", (req, res) => {
  const b = BY_SLUG.get(req.params.slug), { o, e, sig } = req.query;
  const bad = () => res.status(404).send("this link is invalid or expired. reply to your email and i'll resend it.");
  if (!b || !b.hasFull || !o || !e || !sig || Date.now() > Number(e)) return bad();
  const good = sign(b.slug, String(o), String(e)), got = String(sig);
  if (got.length !== good.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(good))) return bad();
  res.download(path.join(FULL_DIR, b.slug + ".mp3"), safeName(b.name) + ".mp3");
});

/* pages + preview audio */
app.use("/previews", express.static(PREVIEW_DIR, { maxAge: "1d" }));
app.get("/", (_req, res) => res.type("html").send(render(null)));
app.get("/beat/:slug", (req, res) => {
  const b = BY_SLUG.get(req.params.slug);
  b ? res.type("html").send(render(b)) : res.redirect("/");
});
app.get("/health", (_req, res) => res.send("ok"));

app.listen(PORT, () => console.log(`montemadethis running on ${BASE_URL}`));
