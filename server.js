import express from "express";
import Stripe from "stripe";
import { Resend } from "resend";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const {
  STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, ADMIN_PASSWORD, STRIPE_PUBLISHABLE_KEY = "", PRINTFUL_API_KEY = "",
  FROM_EMAIL = "montemadethis <onboarding@resend.dev>",
  OWNER_EMAIL = "montemadeahit@gmail.com",
  PORT = 3000,
} = process.env;
const BASE_URL = (process.env.BASE_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN : `http://localhost:${PORT}`)
).replace(/\/$/, "");

/* ---------- storage: beats + audio live in DATA_DIR (a Railway Volume keeps them forever) ---------- */
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(ROOT, "data");
const PERSISTENT = !process.env.RAILWAY_ENVIRONMENT || !!(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH);
const FULL_DIR = path.join(DATA_DIR, "full");        // the mp3s
const CATALOG = path.join(DATA_DIR, "beats.json");
fs.mkdirSync(FULL_DIR, { recursive: true });
if (!PERSISTENT) console.warn("[warn] no Railway Volume attached: uploads will be lost on redeploy");

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;
for (const [k, v] of Object.entries({ STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, ADMIN_PASSWORD }))
  if (!v) console.warn(`[warn] ${k} is not set yet`);

/* ---------- catalog ---------- */
const slugify = s => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
let DB = [];
try { DB = JSON.parse(fs.readFileSync(CATALOG, "utf8")); } catch { DB = []; }
const saveDB = () => { fs.writeFileSync(CATALOG + ".tmp", JSON.stringify(DB, null, 2)); fs.renameSync(CATALOG + ".tmp", CATALOG); };
const fullPath = slug => path.join(FULL_DIR, slug + ".mp3");
const decorate = b => ({ ...b, hasFull: fs.existsSync(fullPath(b.slug)) });
const getBeat = slug => { const b = DB.find(x => x.slug === slug); return b && decorate(b); };
const allBeats = () => DB.map(decorate);
const liveBeats = () => allBeats().filter(b => b.hasFull); // visible + sellable only when the full mp3 exists
const publicBeat = b => ({
  slug: b.slug, name: b.name, genre: b.genre || "", prod: producers(b).join(" x "), bpm: b.bpm, price: b.price, featured: !!b.featured,
  peaks: Array.isArray(b.peaks) ? b.peaks : [],
  src: b.hasFull ? `/audio/${b.slug}.mp3?v=${Math.round(fs.statSync(fullPath(b.slug)).mtimeMs)}` : "",
});

/* ---------- graphic tees: print-on-demand through Printful ----------
   TEE_SHOP below is the whole tee setup. "enabled": false keeps the tee shop hidden.
   Each size maps to a Printful sync variant id; a size with no id can't be bought yet. */
const TEE_SHOP = {
  "enabled": false,
  "shipping_usd": 5,
  "ship_countries": [
    "US"
  ],
  "tees": [
    {
      "id": "tee001",
      "name": "test product tee 001",
      "sub": "white · heavyweight cotton",
      "price": 35,
      "image": "tee-eye.jpg",
      "sizes": {
        "S": "",
        "M": "",
        "L": "",
        "XL": "",
        "2XL": ""
      }
    },
    {
      "id": "tee002",
      "name": "test product tee 002",
      "sub": "white · heavyweight cotton",
      "price": 35,
      "image": "tee-bigben.jpg",
      "sizes": {
        "S": "",
        "M": "",
        "L": "",
        "XL": "",
        "2XL": ""
      }
    },
    {
      "id": "tee003",
      "name": "test product tee 003",
      "sub": "white · heavyweight cotton",
      "price": 35,
      "image": "tee-eye.jpg",
      "sizes": {
        "S": "",
        "M": "",
        "L": "",
        "XL": "",
        "2XL": ""
      }
    }
  ]
};
function teesConfig() { return { ...TEE_SHOP, tees: Array.isArray(TEE_SHOP.tees) ? TEE_SHOP.tees : [] }; }
const teesOn = () => { const env = process.env.TEES_ENABLED; return env !== undefined && env !== "" ? /^(1|true|on|yes)$/i.test(env) : !!teesConfig().enabled; };
const buyable = t => Object.entries(t.sizes || {}).filter(([, v]) => String(v ?? "").trim()).map(([k]) => k);
const shipUsd = () => Math.max(0, Number(teesConfig().shipping_usd) || 0);
const publicShop = () => !teesOn() ? { tees: [], shipping: 0 } : {
  shipping: shipUsd(),
  tees: teesConfig().tees.map(t => ({ id: String(t.id), name: t.name, sub: t.sub || "", price: Number(t.price), img: t.image ? `/img/${t.image}` : "", sizes: Object.keys(t.sizes || {}), buyable: buyable(t) })),
};
const parseTeeMeta = m => String(m || "").split(",").filter(Boolean).map(x => { const [id, size, qty] = x.split(":"); return { id, size, qty: Math.max(1, Number(qty) || 1) }; });

/* ---------- page rendering (adds per-beat share preview tags) ---------- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const TEMPLATE = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const ADMIN_PAGE = fs.readFileSync(path.join(ROOT, "admin.html"), "utf8");
function render(beat) {
  const title = beat ? `${beat.name} – montemadethis` : "montemadethis";
  const desc = beat ? `${beat.name} · ${beat.genre ? beat.genre + " · " : ""}${beat.bpm} bpm · $${beat.price}. preview and buy.` : "beats by montemadethis";
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
    .replace("__CATALOG__", () => JSON.stringify(liveBeats().map(publicBeat)).replace(/</g, "\\u003c"))
    .replace("__SHOP__", () => JSON.stringify(publicShop()).replace(/</g, "\\u003c"));
}

/* ---------- signed download links (valid 30 days) ---------- */
const sign = (slug, order, exp) =>
  crypto.createHmac("sha256", STRIPE_WEBHOOK_SECRET || "dev").update(`${slug}.${order}.${exp}`).digest("hex");
const safeName = n => n.replace(/[^\w\- ().,&]+/g, "").replace(/\s+/g, " ").trim() || "beat";
const producers = b => ["montemadethis", ...String(b.coprod || "").split(/\s*(?:,|\sx\s|&)\s*/).map(s => s.trim()).filter(Boolean)];
const fileName = b => safeName(`${b.name} (prod. ${producers(b).join(" x ")})`) + ".mp3"; // credits travel with the file

/* ---------- branded purchase email (black, like the site) ---------- */
const LOGO_FILE = path.join(ROOT, "email-logo.png"); // white wordmark, transparent background
const HAS_LOGO = fs.existsSync(LOGO_FILE);
function purchaseEmail({ first, beats, link, attach, one, teeLines = [] }) {
  const F = "font-family:Helvetica,Arial,sans-serif;", G = "#8f8f8f", H = "#2a2a2a";
  const logo = HAS_LOGO
    ? `<img src="${BASE_URL}/email-logo.png" width="220" alt="montemadethis." style="display:block;width:220px;max-width:100%;height:auto;border:0">`
    : `<div style="${F}font-size:28px;font-weight:900;letter-spacing:-1px;color:#fff">montemadethis.</div>`;
  const cards = beats.map(b => `
    <tr><td style="padding:0 0 12px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${H};border-radius:14px;border-collapse:separate">
        <tr><td style="padding:20px 22px">
          <div style="${F}font-size:22px;font-weight:700;color:#fff;line-height:1.2">${esc(b.name)}</div>
          <div style="${F}font-size:13px;color:${G};line-height:1.5;padding-top:4px">prod. ${esc(producers(b).join(" x "))}</div>
          <div style="${F}font-size:13px;color:${G};line-height:1.5">${[b.genre, b.bpm + " bpm", "mp3"].filter(Boolean).map(esc).join(" · ")}</div>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px"><tr>
            <td bgcolor="#ffffff" style="border-radius:999px">
              <a href="${link(b)}" style="${F}display:inline-block;padding:12px 26px;font-size:15px;font-weight:900;color:#000;text-decoration:none;border-radius:999px">download</a>
            </td></tr></table>
        </td></tr>
      </table>
    </td></tr>`).join("") + teeLines.map(l => `
    <tr><td style="padding:0 0 12px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${H};border-radius:14px;border-collapse:separate">
        <tr><td style="padding:20px 22px">
          <div style="${F}font-size:22px;font-weight:700;color:#fff;line-height:1.2">${esc(l.t.name)}</div>
          <div style="${F}font-size:13px;color:${G};line-height:1.5;padding-top:4px">size ${esc(l.size)} · qty ${l.qty}</div>
          <div style="${F}font-size:13px;color:${G};line-height:1.5">made to order · you'll get a tracking email when it ships</div>
        </td></tr>
      </table>
    </td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head>
<body style="margin:0;padding:0;background:#000" bgcolor="#000000">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#000000" style="background:#000">
<tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td style="padding:0 0 36px">${logo}</td></tr>
    <tr><td style="${F}font-size:40px;font-weight:900;letter-spacing:-1.5px;line-height:1;color:#fff;padding:0 0 14px">thank you${first ? `, ${first}` : ""}.</td></tr>
    <tr><td style="${F}font-size:16px;line-height:1.6;color:${G};padding:0 0 28px">${beats.length ? (attach
      ? `your ${one ? "beat is" : "beats are"} attached to this email. you can also download ${one ? "it" : "them"} below any time in the next 30 days.`
      : `your ${one ? "beat is" : "beats are"} ready. download below any time in the next 30 days.`) : ""}${teeLines.length
      ? `${beats.length ? " " : ""}your ${teeLines.reduce((n, l) => n + l.qty, 0) > 1 ? "tees are" : "tee is"} being made to order. you'll get a separate email with tracking when ${teeLines.reduce((n, l) => n + l.qty, 0) > 1 ? "they ship" : "it ships"}.` : ""}</td></tr>
    ${cards}
    <tr><td style="padding:16px 0 0;border-top:1px solid ${H}"></td></tr>
    ${beats.length ? `<tr><td style="${F}font-size:13px;line-height:1.7;color:${G};padding:4px 0 24px">
      must credit (prod. montemadethis) &amp; any producers listed in the file name<br>
      must provide proper splits when uploading for profit on any streaming service</td></tr>` : `<tr><td style="padding:4px 0 8px"></td></tr>`}
    <tr><td style="${F}font-size:13px;line-height:1.7;color:${G}">questions? just reply to this email.<br>
      <a href="${BASE_URL}" style="color:#fff;text-decoration:underline">${BASE_URL.replace(/^https?:\/\//, "")}</a></td></tr>
  </table>
</td></tr></table></body></html>`;
}

/* ---------- printful: send paid tee orders to be printed + shipped ---------- */
const PF_BASE = (process.env.PRINTFUL_API_BASE || "https://api.printful.com").replace(/\/$/, "");
async function pfApi(method, p, body) {
  const headers = { Authorization: `Bearer ${PRINTFUL_API_KEY}`, "Content-Type": "application/json" };
  if (process.env.PRINTFUL_STORE_ID) headers["X-PF-Store-Id"] = process.env.PRINTFUL_STORE_ID;
  const r = await fetch(PF_BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) };
}
function shipTo(session) {
  const sd = session.collected_information?.shipping_details || session.shipping_details || {}, a = sd.address || {};
  return { name: sd.name || session.customer_details?.name || session.metadata?.buyer || "customer", address1: a.line1, address2: a.line2 || undefined,
    city: a.city, state_code: a.state || undefined, country_code: a.country, zip: a.postal_code,
    email: session.customer_details?.email || session.customer_email, phone: session.customer_details?.phone || undefined };
}
async function sendToPrintful(session, lines) {
  const recipient = shipTo(session), manual = reason => ({ status: "manual", reason, recipient });
  if (!PRINTFUL_API_KEY) return manual("PRINTFUL_API_KEY isn't set in Railway");
  if (!recipient.address1 || !recipient.country_code) return manual("no shipping address on the order");
  const items = [];
  for (const l of lines) {
    const v = String(l.t?.sizes?.[l.size] ?? "").trim();
    if (!v) return manual(`no printful variant id for ${l.t?.name || l.id} size ${l.size} in TEE_SHOP (server.js)`);
    items.push({ ...(/^\d+$/.test(v) ? { sync_variant_id: Number(v) } : { external_variant_id: v }), quantity: l.qty, retail_price: Number(l.t.price).toFixed(2) });
  }
  const external_id = "mmt" + crypto.createHash("sha256").update(session.id).digest("hex").slice(0, 24); // printful allows max 32 chars; same id on retries = no duplicates
  const confirm = process.env.PRINTFUL_AUTOCONFIRM !== "0";
  let r;
  try { r = await pfApi("POST", `/orders${confirm ? "?confirm=true" : ""}`, { external_id, shipping: "STANDARD", recipient, items }); }
  catch (e) { throw new Error("printful unreachable: " + e.message); }
  if (r.ok) return { status: "sent", id: r.j?.result?.id, confirm, recipient };
  const msg = JSON.stringify(r.j?.error || r.j?.result || r.j).slice(0, 300);
  if (/already exists|external.?id.*(used|taken|exist)/i.test(msg)) return { status: "sent", id: "@" + external_id, confirm, recipient }; // retry of an order printful already has
  if (r.status >= 500 || r.status === 429) throw new Error(`printful temporary error ${r.status}: ${msg}`);
  return manual(`printful said ${r.status}: ${msg}`);
}

/* ---------- fulfillment: email the buyer their mp3s ---------- */
async function fulfill(session) {
  const beats = (session.metadata?.slugs || "").split(",").filter(Boolean).map(getBeat).filter(Boolean);
  const teeLines = parseTeeMeta(session.metadata?.tees).map(l => ({ ...l, t: teesConfig().tees.find(t => String(t.id) === l.id) || { name: l.id } }));
  const to = session.customer_details?.email || session.customer_email;
  if ((!beats.length && !teeLines.length) || !to) throw new Error("order " + session.id + " has no items or no email");
  const first = esc((session.metadata?.buyer || "").split(" ")[0] || "");
  const exp = ((session.created ? session.created * 1000 : Date.now())) + 30 * 24 * 3600 * 1000; // same on every retry

  const files = beats.map(b => ({ b, file: fullPath(b.slug) }));
  const totalBytes = files.reduce((n, f) => n + (fs.existsSync(f.file) ? fs.statSync(f.file).size : 0), 0);
  const attach = totalBytes <= 25 * 1024 * 1024; // email providers cap around 40MB
  const attachments = attach
    ? files.filter(f => fs.existsSync(f.file)).map(f => ({ filename: fileName(f.b), content: fs.readFileSync(f.file) }))
    : [];

  const one = beats.length === 1;
  const link = b => `${BASE_URL}/download/${b.slug}?o=${encodeURIComponent(session.id)}&e=${exp}&sig=${sign(b.slug, session.id, exp)}`;
  const titles = beats.map(b => `"${b.name}" (${b.bpm} bpm)`).join(", ");
  const teeCount = teeLines.reduce((n, l) => n + l.qty, 0);
  const subject = beats.length
    ? `Thank you for your purchase: ${titles} ${one ? "is" : "are"} available for download`
    : `Thank you for your purchase: your montemadethis tee${teeCount > 1 ? "s are" : " is"} being made`;
  const { error } = await resend.emails.send({
    from: FROM_EMAIL, to, replyTo: OWNER_EMAIL, subject,
    html: purchaseEmail({ first, beats, link, attach, one, teeLines }),
    text: [`${first ? `hey ${first},` : "hey,"}`, "", "thank you for purchasing.",
      ...(beats.length ? ["", one ? "your beat:" : "your beats:", ...beats.map(b => `- ${b.name} (prod. ${producers(b).join(" x ")}) · ${b.bpm} bpm\n  ${link(b)}`), "",
        "must credit (prod. montemadethis) & any producers listed in the file name",
        "must provide proper splits when uploading for profit on any streaming service", "download links work for 30 days."] : []),
      ...(teeLines.length ? ["", "your tees (made to order, you'll get a tracking email when they ship):", ...teeLines.map(l => `- ${l.t.name} · size ${l.size} · qty ${l.qty}`)] : []),
      "", "questions? just reply to this email.", "", "— montemadethis"].join("\n"),
    attachments,
  }, { idempotencyKey: "order-" + session.id });
  if (error && !/idempot/i.test(JSON.stringify(error))) throw new Error("email failed: " + JSON.stringify(error)); // idempotency conflict = already sent

  const pf = teeLines.length ? await sendToPrintful(session, teeLines) : null; // throws only on temporary errors, so Stripe retries

  const items = [...beats.map(b => b.name), ...teeLines.map(l => `${l.t.name} (${l.size}) x${l.qty}`)].join(", ");
  const manual = pf && pf.status !== "sent";
  const r = pf?.recipient || {};
  resend.emails.send({
    from: FROM_EMAIL, to: OWNER_EMAIL,
    subject: `${manual ? "ACTION NEEDED: tee order not sent to printful · " : ""}sale: ${items} ($${(session.amount_total / 100).toFixed(2)})`,
    text: [`${to} bought ${items}. stripe order ${session.id}`,
      ...(pf ? ["", pf.status === "sent" ? `printful order ${pf.id} ${pf.confirm === false ? "created as a DRAFT (confirm it in printful)" : "submitted for printing"}.` : `printful: NOT sent (${pf.reason}). place this order in printful by hand.`,
        `ship to: ${[r.name, r.address1, r.address2, r.city, r.state_code, r.zip, r.country_code].filter(Boolean).join(", ")}`] : [])].join("\n"),
  }, { idempotencyKey: "notify-" + session.id }).catch(e => console.error("notify failed", e));
  console.log("fulfilled", session.id, to, beats.map(b => b.slug).join(","));
}

const app = express();
app.set("trust proxy", 1);

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

/* ---------- admin: login + beat management ---------- */
const adminTok = exp => crypto.createHmac("sha256", ADMIN_PASSWORD || "x").update("admin." + exp).digest("hex");
function isAdmin(req) {
  if (!ADMIN_PASSWORD) return false;
  const m = (req.headers.cookie || "").match(/(?:^|; )mmt_admin=([^;]+)/);
  if (!m) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split(".");
  if (!exp || !sig || Date.now() > Number(exp)) return false;
  const good = adminTok(exp);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}
const requireAdmin = (req, res, next) =>
  isAdmin(req) ? next() : res.status(401).json({ error: "please log in" });
const sha = s => crypto.createHash("sha256").update(String(s)).digest();
const tries = new Map(); // ip -> {n, reset}  (stops password guessing)

app.get("/admin", (_req, res) => {
  res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }).type("html").send(ADMIN_PAGE);
});
app.get("/api/admin/me", (req, res) => res.json({ authed: isAdmin(req), configured: !!ADMIN_PASSWORD, persistent: PERSISTENT }));
app.post("/api/admin/login", (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(500).json({ error: "ADMIN_PASSWORD isn't set in Railway yet" });
  const t = tries.get(req.ip) || { n: 0, reset: Date.now() + 15 * 60 * 1000 };
  if (Date.now() > t.reset) { t.n = 0; t.reset = Date.now() + 15 * 60 * 1000; }
  if (t.n >= 10) return res.status(429).json({ error: "too many tries, wait 15 minutes" });
  t.n++; tries.set(req.ip, t);
  if (!crypto.timingSafeEqual(sha(req.body?.password ?? ""), sha(ADMIN_PASSWORD))) return res.status(401).json({ error: "wrong password" });
  tries.delete(req.ip);
  const exp = Date.now() + 30 * 24 * 3600 * 1000;
  res.setHeader("Set-Cookie", `mmt_admin=${exp}.${adminTok(exp)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${30 * 24 * 3600}${BASE_URL.startsWith("https") ? "; Secure" : ""}`);
  res.json({ ok: true });
});
app.post("/api/admin/logout", (_req, res) => {
  res.setHeader("Set-Cookie", "mmt_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
  res.json({ ok: true });
});

function cleanFields(body, partial) {
  const out = {};
  if (!partial || body.name !== undefined) {
    const name = String(body.name ?? "").trim().slice(0, 80);
    if (!name) throw new Error("enter a beat name");
    out.name = name;
  }
  if (!partial || body.bpm !== undefined) {
    const bpm = Math.round(Number(body.bpm));
    if (!(bpm >= 1 && bpm <= 400)) throw new Error("enter a bpm between 1 and 400");
    out.bpm = bpm;
  }
  if (!partial || body.price !== undefined) {
    const price = Math.round(Number(body.price));
    if (!(price >= 1 && price <= 10000)) throw new Error("price must be a whole dollar amount, $1 or more");
    out.price = price;
  }
  if (!partial || body.featured !== undefined) out.featured = !!body.featured;
  if (!partial || body.coprod !== undefined) out.coprod = String(body.coprod ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (!partial || body.genre !== undefined) out.genre = String(body.genre ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
  if (body.peaks !== undefined) {
    if (!Array.isArray(body.peaks) || ![48, 120].includes(body.peaks.length) || !body.peaks.every(v => typeof v === "number" && v >= 0 && v <= 1)) throw new Error("bad waveform data");
    out.peaks = body.peaks.map(v => Math.round(v * 100) / 100);
  }
  return out;
}

/* max 5 featured: featuring a 6th bumps the one featured longest ago */
const MAX_FEATURED = 5;
function applyFeatured(b, wasFeatured) {
  if (b.featured && !wasFeatured) b.featuredAt = Date.now();
  if (!b.featured) delete b.featuredAt;
  const on = DB.filter(x => x.featured).sort((x, y) => (x.featuredAt || x.added || 0) - (y.featuredAt || y.added || 0));
  const bumped = [];
  while (on.length > MAX_FEATURED) { const old = on.shift(); if (old === b) { on.push(old); continue; } old.featured = false; delete old.featuredAt; bumped.push(old.name); }
  return bumped;
}
/* admin helper: lists your printful products + variant ids (to copy into TEE_SHOP in server.js) */
app.get("/api/admin/printful/variants", requireAdmin, async (_req, res) => {
  if (!PRINTFUL_API_KEY) return res.status(400).json({ error: "PRINTFUL_API_KEY isn't set" });
  try {
    const list = await pfApi("GET", "/store/products?limit=100");
    if (!list.ok) return res.status(502).json({ error: "printful said " + list.status, detail: list.j });
    const out = [];
    for (const p of list.j.result || []) {
      const one = await pfApi("GET", `/store/products/${p.id}`);
      for (const v of one.j?.result?.sync_variants || []) out.push({ product: p.name, variant: v.name, size: v.size, color: v.color, sync_variant_id: v.id });
    }
    res.json(out);
  } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get("/api/admin/beats", requireAdmin, (_req, res) => res.json(allBeats()));
app.post("/api/admin/beats", requireAdmin, (req, res) => {
  try {
    const f = cleanFields(req.body || {}, false);
    const base = slugify(f.name) || "beat";
    let slug = base, i = 2;
    while (DB.some(b => b.slug === slug)) slug = `${base}-${i++}`;
    const nb = { slug, ...f, added: Date.now() };
    DB.unshift(nb); // newest first
    const bumped = applyFeatured(nb, false);
    saveDB();
    res.json({ ...getBeat(slug), bumped });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.patch("/api/admin/beats/:slug", requireAdmin, (req, res) => {
  const b = DB.find(x => x.slug === req.params.slug);
  if (!b) return res.status(404).json({ error: "beat not found" });
  try { const was = !!b.featured; Object.assign(b, cleanFields(req.body || {}, true)); const bumped = applyFeatured(b, was); saveDB(); res.json({ ...getBeat(b.slug), bumped }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete("/api/admin/beats/:slug", requireAdmin, (req, res) => {
  const i = DB.findIndex(x => x.slug === req.params.slug);
  if (i < 0) return res.status(404).json({ error: "beat not found" });
  const [b] = DB.splice(i, 1); saveDB();
  for (const p of [fullPath(b.slug)]) fs.rm(p, { force: true }, () => {});
  res.json({ ok: true });
});

/* upload an mp3 (raw file body, streamed straight to disk) */
const MAX_BYTES = 300 * 1024 * 1024;
app.put("/api/admin/beats/:slug/:kind", requireAdmin, (req, res) => {
  const { slug, kind } = req.params;
  if (!DB.some(b => b.slug === slug)) return res.status(404).json({ error: "beat not found" });
  if (kind !== "full") return res.status(400).json({ error: "bad file type" });
  if (Number(req.headers["content-length"] || 0) > MAX_BYTES) return res.status(413).json({ error: "file is over 300MB" });
  const dest = fullPath(slug), tmp = dest + ".tmp";
  const out = fs.createWriteStream(tmp);
  let n = 0, head = Buffer.alloc(0), dead = false;
  const fail = (code, msg) => { if (dead) return; dead = true; req.unpipe(out); out.destroy(); fs.rm(tmp, { force: true }, () => {}); res.status(code).set("Connection", "close").json({ error: msg }); req.resume(); };
  req.on("data", c => { if (head.length < 4) head = Buffer.concat([head, c]).subarray(0, 4); n += c.length; if (n > MAX_BYTES) fail(413, "file is over 300MB"); });
  req.on("aborted", () => { dead = true; out.destroy(); fs.rm(tmp, { force: true }, () => {}); });
  out.on("error", e => { console.error("upload write error", e); fail(500, "couldn't save the file"); });
  out.on("finish", () => {
    if (dead) return;
    const isMp3 = head.length >= 3 && (head.subarray(0, 3).toString() === "ID3" || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0));
    if (!isMp3) return fail(400, "that doesn't look like an mp3 file");
    fs.renameSync(tmp, dest);
    const entry = DB.find(x => x.slug === slug); if (entry) { delete entry.peaks; saveDB(); } // new audio = old waveform is stale
    res.json({ ok: true, beat: getBeat(slug) });
  });
  req.pipe(out);
});

/* ---------- checkout (prices come from the catalog, never from the browser) ---------- */
app.post("/api/checkout", async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: "payments aren't set up yet" });
    const { slugs, email, name } = req.body || {};
    if (!Array.isArray(slugs) || !slugs.length || slugs.length > 40) return res.status(400).json({ error: "your cart is empty" });
    if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "enter a valid email" });
    const beats = [...new Set(slugs.map(String).filter(x => !x.startsWith("tee:")))].map(getBeat);
    const teeLines = []; // cart entries look like "tee:<id>:<size>", one entry per shirt
    for (const x of slugs.map(String).filter(x => x.startsWith("tee:"))) {
      const [, id, size] = x.split(":"), l = teeLines.find(l => l.id === id && l.size === size);
      l ? (l.qty = Math.min(10, l.qty + 1)) : teeLines.push({ id, size, qty: 1 });
    }
    if (teeLines.length) {
      if (!teesOn()) return res.status(400).json({ error: "shirts aren't available right now. remove them from your cart and try again" });
      const cfg = teesConfig();
      for (const l of teeLines) {
        l.t = cfg.tees.find(t => String(t.id) === l.id);
        if (!l.t || !buyable(l.t).includes(l.size)) return res.status(400).json({ error: "a shirt size in your cart isn't available. refresh and try again" });
      }
    }
    if (!beats.length && !teeLines.length) return res.status(400).json({ error: "your cart is empty" });
    if (beats.some(b => !b)) return res.status(400).json({ error: "a beat in your cart no longer exists. refresh and try again" });
    const gone = beats.filter(b => !b.hasFull);
    if (gone.length) return res.status(400).json({ error: `not available right now: ${gone.map(b => b.name).join(", ")}` });

    const MULTI_DISCOUNT = 0; // multi-beat discount is OFF (set to 0.25 for 25% off 2+ beats)
    const bundle = MULTI_DISCOUNT > 0 && beats.length >= 2;
    const params = {
      mode: "payment",
      payment_method_types: ["card", "us_bank_account"], // cards (incl. Apple/Google Pay) + US bank only
      customer_email: email,
      line_items: [...beats.map(b => ({
        quantity: 1,
        price_data: { currency: "usd", unit_amount: Math.round(b.price * 100 * (bundle ? 1 - MULTI_DISCOUNT : 1)),
          product_data: { name: b.name, description: `${b.bpm} bpm · mp3 download${bundle ? " · multi-beat discount: 25% off" : ""}` } },
      })), ...teeLines.map(l => ({
        quantity: l.qty,
        price_data: { currency: "usd", unit_amount: Math.round(Number(l.t.price) * 100),
          product_data: { name: `${l.t.name} (${l.size})`, description: "graphic tee · made to order" } },
      }))],
      payment_intent_data: { receipt_email: email },
      metadata: { slugs: beats.map(b => b.slug).join(","), tees: teeLines.map(l => `${l.id}:${l.size}:${l.qty}`).join(","), buyer: String(name || "").slice(0, 100) },
    };
    if (teeLines.length) { // physical items: collect a shipping address and charge flat shipping
      params.shipping_address_collection = { allowed_countries: teesConfig().ship_countries || ["US"] };
      params.shipping_options = [{ shipping_rate_data: { type: "fixed_amount", display_name: shipUsd() ? "standard shipping" : "free shipping",
        fixed_amount: { amount: Math.round(shipUsd() * 100), currency: "usd" } } }];
    }
    if (process.env.STRIPE_AUTOMATIC_TAX === "1") params.automatic_tax = { enabled: true }; // needs Stripe Tax set up first
    if (STRIPE_PUBLISHABLE_KEY) { // payment form shown inside the site (embedded checkout)
      const emb = { ...params, return_url: `${BASE_URL}/?paid=1` };
      let session;
      try { session = await stripe.checkout.sessions.create({ ...emb, ui_mode: "embedded_page" }); }
      catch (e) { if (!/ui_mode/i.test(String(e?.message))) throw e; session = await stripe.checkout.sessions.create({ ...emb, ui_mode: "embedded" }); } // older Stripe API name
      return res.json({ clientSecret: session.client_secret, publishableKey: STRIPE_PUBLISHABLE_KEY });
    }
    const session = await stripe.checkout.sessions.create({ ...params, success_url: `${BASE_URL}/?paid=1`, cancel_url: `${BASE_URL}/` });
    res.json({ url: session.url });
  } catch (e) {
    console.error("checkout error", e);
    res.status(500).json({ error: "couldn't start checkout, please try again" });
  }
});

/* private download (only works with the signed link from the email) */
app.get("/download/:slug", (req, res) => {
  const b = getBeat(req.params.slug), { o, e, sig } = req.query;
  const bad = () => res.status(404).send("this link is invalid or expired. reply to your email and i'll resend it.");
  if (!b || !b.hasFull || !o || !e || !sig || Date.now() > Number(e)) return bad();
  const good = sign(b.slug, String(o), String(e)), got = String(sig);
  if (got.length !== good.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(good))) return bad();
  res.download(fullPath(b.slug), fileName(b));
});

/* ---------- pages + preview audio ---------- */
/* the player streams the mp3 from here (supports seeking) */
app.get("/audio/:file", (req, res) => {
  const b = getBeat(req.params.file.replace(/\.mp3$/, ""));
  if (!b || !b.hasFull) return res.sendStatus(404);
  res.sendFile(fullPath(b.slug), { headers: { "Cache-Control": "public, max-age=3600" } });
});
app.get("/", (_req, res) => res.set("Cache-Control", "no-cache").type("html").send(render(null)));
app.get("/beat/:slug", (req, res) => {
  const b = getBeat(req.params.slug);
  b && b.hasFull ? res.set("Cache-Control", "no-cache").type("html").send(render(b)) : res.redirect("/");
});
/* product photos: built into this file (TEE_PHOTOS at the bottom), served at /img/<name> */
app.get("/img/:file", (req, res) => {
  const f = req.params.file;
  if (TEE_PHOTOS[f]) return res.set({ "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" }).send(Buffer.from(TEE_PHOTOS[f], "base64"));
  if (!/^[\w-]+\.(png|jpe?g|webp)$/i.test(f) || !fs.existsSync(path.join(ROOT, f))) return res.sendStatus(404);
  res.sendFile(path.join(ROOT, f), { headers: { "Cache-Control": "public, max-age=86400" } });
});
app.get("/email-logo.png", (_req, res) => HAS_LOGO ? res.sendFile(LOGO_FILE, { headers: { "Cache-Control": "public, max-age=86400", "Content-Type": "image/png" } }) : res.sendStatus(404));
app.get("/health", (_req, res) => res.send("ok"));

app.listen(PORT, () => console.log(`montemadethis running on ${BASE_URL} (data: ${DATA_DIR})`));

/* tee photos (jpg, base64). keep this at the very bottom */
var TEE_PHOTOS = {
  "tee-eye.jpg": [
    "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",
    "iFknRjwNxr+PVkXorfRCFwG5m8eqqhGHA/oE16/LIEQX0SFo9Dc/B6siMOB/VzyCFwLyP6nZjLRYMOXH0bII40Lgch4Lb1WCMPQI",
    "41rIkhYDEsPUs+ouUXBt9LBBBF6LVsuhIFSx+pZjLRCxyVwbcqeShaVq+GBI0b4nqWYy0RtouXtyWSSTxRrJJJei0nTYyMkfE9Sz",
    "Cab6rkTrtynrJJPInViR0qTHFExiPieq5LVcvblvgkkTE+F4GSyWXwniPieqbfVczbmQNEabkiZJJOmw9WZCD6cJ8T1PZvquZtzI",
    "1ggjSSSRaNEMhkmQiErTjMHqmm+dPPngaRBGiesIojSUNOBIgxeTb1LIc3F9ZBGkEDI1kkkWdSbFel8r1Q96I4FxwQQR9UkbGQll",
    "BQJKfU2zQQY9F9DHGySSSeQhE0POgkYxfU5tGMeBPMkknlPmLVCETD5HqeaIswE0YmxY5EkjZJJImSiUQJ1knnyTYnqvn+p/gMha",
    "HQ4nojhnkzrJJPNfFBAvqmPxmYhB4LhuWggggggj6daJkU8L1PJratGdOPHBGiXBBBGpH0e4hGA0N9TZhVpVE2yx06SjFJDJEiXE",
    "EaJSRqr0MQ5JcAkSJEyGS0wxMkSgkIrUp2mLC9SyDDKHhDKZE0yMioX4E0Fl6WWWWQbDEYojR40QIy5FguRlwS5JZLkuCyyxLMsl",
    "ySyxSLAxDgYj4XqSToNQJOsonRKMEjEqI0ohELqeSPIldSuo0upXUTU5RKe5XUeCHUhdSu5FvIqZKHpBBGkEaGwTwT6cGgbDC4Hl",
    "lUKkXqbM4GYkedJsUVCcWEZ590X/AEBIf5s/9IN+1ohNnSE7IdgO0HaBMyj3F/2D+hnZfJ23ydl8kGz5GzPyH8TO2+TsvkjwTTki",
    "3Pui0klb6iksLf0yfACHeEKfRDoJFheqrYQay0CU6DN2JCSiTuFMo8OXZfCF/wD1Q//aAAwDAQACAAMAAAAQ8888888888888888",
    "8888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888",
    "8888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888",
    "8888888888888888888888888888888888888888888888888888884888888808888888888888888888888888888888888888",
    "84wkgk04044Aw04888888888888888888888888888888888800sOg4WqOOK2SOCCC68888888888888888888888888888884EE",
    "ssyyG0I0MckU8k0oc2a088888888888888888888888884kkkCSmkISKm60kAQgM0wIUoGQ888888888888888888888888sMeqY",
    "woE6SyqOSeuc0884AEs4Ow88888888888888888888842wWqaCss+ya6aCySi8AAAQA8E0kuQ88888888888888888880OEUUWya",
    "2aqaaCCmGO6KCCCAA8Eg80Yy8888888888888888o06s8U8KSW+WuSGjz3TL/oAAAQksco40IMa088888888888888kMQgUc+eGC",
    "ieyyqqDXDr/oAAAAkUagY8AkAa0888888888888gM2oMosWiC6GOiWmDDTDp8oAAwwAgcskE0kIkO88888888888cw0eqC2++SCa",
    "GeCvTTznrB+oAAAA+G+ecgUQY8gEw888888888Q0c+qCOuGKK+CGf7j/AM81xuKAAJADtvmOLJPLKKMmHPPPPPPPPPFPPqqnhgiu",
    "jpsg0833N4zzqhgAAAqqpIBDOKDDKlPPPPPPPPPPOMInqjkvtij9igy840PJBDGGNCAAAgipACBJDFiPPPPPPPPPPPPGCFnstmrm",
    "lnwx31AAKIDMHLKEhALAiuNBLCOLnPPPPPPPPPPPPLJmvgmGpAPzw4zACNPPLEKnLFCjFhJihkBCLvPPPPPPPPPPPPPPPMjOtsJh",
    "Pww2DSex6OFNsNmnmkLtviAPtOPPPPPPPPPPPPPPPPPKJnlKuhuT82/ZfZSOJfqNJKDGPnviXCiJPPPPPPPPPPPPPPPPPPLDPPrJ",
    "5w7+/baXbhuSJDKqDKLvuFdvLHPPPPPPPPPPPPPPPPPPPPPPrV+z+/7SzzwBIZmkoPluKHLkN/PPPPPPPPPPPPPPPPPPPPPPPPij",
    "W/8A/wDhDnJwV8W2+ESqcUpOk/8APPPPPPPPPPPPPPPPPPPPPPPLtBZ/3/8A8PO0AhwDRyRgyxSnxr/zzzzzzzzzzzzzzzzzzzzz",
    "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"
  ].join(""),
  "tee-bigben.jpg": [
    "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",
    "CHfNdyPaEGoJD0OJp0tvurF3CG4anHXEwHiE8QXiH6EQSJB6wKxnBlAt4x1Iqxj4HRq6TDc0RW3HhguJRxDN9AMD0LlzSKVn7rwd",
    "9CHpqMIeILxFcR7E8UOxPFPBPBPFPFAuJ4p4p4p4p4p4p4ugHtKdpTtAdoCVldT0Hok+61HfQ+iqUSnaU7SjtKJRKJRKJRKJRKJR",
    "KJRKJRKJX0yGvQBuL7pA9CH86/pB0ddM3Hf3QD0Nw+lUr+JUD6B0ddE3M0+5jTobnP2g6rN0IWfuTZ1G4Tj6PHof4tSpXU6LiXDa",
    "6Hmfct3Sw+m49D9G/pkxMeiujcqZswpNn3Lf0sP5S5fqrpcuXLmfTzNs3TZ7fctvWPqL+tcuXLl+vMvoJpHoKZ03zf7fctnSJUCV",
    "9V+lXpuXB9D1MtlvQhqazdN3t9ydulgfXfqVKldbgy5foPTE5gxOIpum/wBvuTt0sOnP1X6ldUlSuq5fUJTKdQkKJxATb9zB26Hq",
    "fSvrcv6V+tIkOh0omIAypipZL2m77nzqbxelfr5/hV1rrXW5fUuOgMTObJ+l90XmD6lSpUr+Dj0V1Oh0Oekcpvgwvb7nswMwYj/D",
    "qV67ly5fqepLjAzAgym37ot2HM4j1Pp30uX9J+oegpRBy5+z90DmcR30UWfo3Lly5cuUlkpLPRf1HoS5cIGLLo/Y+5OpvBOIkXEW",
    "LMJXpv6ly5f8IhDlGP3PuWz2m80h1F56DiPpfRUplSpUr+QCGRTmh5PuW/26DU1HiXPTOHrqVKgdKlSpUrqV/EEx6ZYPt9zFZ6vF",
    "S0L6aS25TKZaW9IVKjMdFdMIHQkplupaWlpaW6jUgKS8tLdGWFJt6bx9z7lkiUMGOukBKTxixqX4S2ZmZmZmZmVKjGVaBr0TUphe",
    "8tOOnMtLZbBY3C4OZaompbBZbC4dHULObvua2NI6l8uamGWNEdQhUrpiV5mO5PdL7pZ3jTzMEY7kRW413lnee6ArcrzHncrMTHSp",
    "UqBKldFsHFQfSRaVMQnCRWHH3TE1c3Yyvi45A2UZkC1mVrLOJr/9p/xZy0+UWg7kC/SA8KPEjwI8SBNh8wD/ANJ/2M8b9zxv3PG/",
    "c/6GX7/dP+Rn/YwPX7JTpJRy/MJpy9FjuicmTnm8X79B5p5J5ITv05NQA+6h5IDaAoo2kt2Vc8kw8z2y/H08zPoGf/k6/wD5/f/a",
    "AAwDAQACAAMAAAAQ888888888888888888888888888888888888888888888888888888888888888888888888888888888888",
    "8888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888",
    "8888888888888888888888888888888888888888888888888888888888888888888888888888888888888408888888088888",
    "8888888888888888888888888888888840EEU0ww4wswkcw8888888888888888888888888888888888w00o4CmWmmSqGiiiq68",
    "888888888888888888888888888888cwASWWqUIAoQo4MkQ84y+88888888888888888888888888444euGq8GeO688UssogIUQA",
    "UqU888888888888888888888884+wmqQQ08uCi2iGykyYU84s0gEUU8888888888888888888888WAUiGyI8O2y6yWq6CYAQEwA8",
    "U4EeY88888888888888888884WE0wqa26u2aG+qye+CuCCCgA8U4MMY+8888888888888888MkW4ocIayS22uiCqzTPe98AAAQIM",
    "YkgwAke888888888888888swQgEc+SWmq+yyCrDD/wC/PAAAAONMBBGBDKLvPPPPPPPPPPPPKLPMBAIFgkljrqkgqwx1/vPABMJM",
    "CMLKGFMMGGtPPPPPPPPPOPCDPDkuvvkpmt8sww084+/PvAEgBLkqrvLNHPNIIMPPPPPPPPLEDPFKgrhlqopg+l2v96OogiuAhMki",
    "nmlHIPPLJAHlNPPPPPPPPPPPFOrsgksiosmR3JXAPB7RGIjGqlqtgKLGNPNBuNPPPPPPPPPPCMHFmriikmrxnAEPGLOJKO94HEvl",
    "IqgkBPIGCOIvPPPPPPPPPPPLoqokvvjm3k3CXPz8FH0rz/HAGHMMEsuJFCPPnPPPPPPPPPPPPPNOsjvLDKe//J1x0Gxz5g/FILPK",
    "CFLovlBOhvPPPPPPPPPPPPPPLGFMNhhA8w6NC87+488xnFPKMDCLIIqIgvPPPPPPPPPPPPPPPPPHKlnJpQxR4G1147lzl3vMGLDN",
    "KKIv/IrPvPPPPPPPPPPPPPPPPPPPPA7Vl297yJ6F2yqwuEMJEGMLmAvPLPPPPPPPPPPPPPPPPPPPPPPFkfl682P0M7Drp5jIOGEL",
    "OIJCPPPPPPPPPPPPPPPPPPPPPPPPPDgqT/wuOGCf26LCLOKJOAoF3n/PPPPPPPPPPPPPPPPPPPPPPPPB8HX+xNJOCvelimmFCDND",
    "gHKXfPPPPPPPPPPPPPPPPPPPPPPPPApEX985Y/w0SKvlvMJDGNmCOW/PPPPPPPPPPPPPPPPPPPPPPPPPWwfwwB5LHEGADGqDADKF",
    "sAAdHvPPPPPPPPPPPPPPPPPPPPPPPJf6eqBgGCOLNKCPDNBMGPFjZOvvPPPPPPPPPPPPPPPPPPPPPPPEdHKgGJMDBIHBFNHGFDEA",
    "BvANVPPPPPPPPPPPPPPPPPPPPPPPPAZlCkGhHDLMKMJCKDFJCuEKPF3vPPPPPPPPPPPPPPPPPPPPPPPFXtNHAFNjIDOCIEINKIPE",
    "NFFJlvPPPPPPPPPPPPPPPPPPPPPPPAarXOAABDAAFABAAACCFJAHAPvvPPPPPPPPPPPPPPPPPPPPPPPEYFWCAAIECABDDICFENLH",
    "HBBCFvPPPPPPPPPPPPPPPPPPPPPPPPSCQHAAAAKAAAFOCFBIBPFAIHvPPPPPPPPPPPPPPPPPPPPPPPPHWtUBAAAAIAAAPMHIMKNO",
    "KICBtvPPPPPPPPPPPPPPPPPPPPPPPKbuDEAAAAAAAAAMFEHOJOHGNJlvPPPPPPPPPPPPPPPPPPPPPPPIXtVAAAEIHPLCHPLDKFAA",
    "EPDDl/PPPPPPPPPPPPPPPPPPPPPPPOUDCACAOJHPPNPPOMKPGIMKKLPPPPPPPPPPPPPPPPPPPPPPPPPK6/FeWIDGKANFFPLFLAPO",
    "HKADlvPPPPPPPPPPPPPPPPPPPPPPPCa/XeAAOMDLPFMHNPPPPLPBACHvPPPPPPPPPPPPPPPPPPPPPPPCYQUVZSeeRZYSZQcdeeaX",
    "ddVZPvPPPPPPPPPPPPPPPPPPPPPPPNI3aGcMHDV6aAJEeVGUEZJYLR+PPPPPPPPPPPPPPPPPPPPPPPPLGN9R+VbfbUWZSeQbbTbf",
    "LTXLHPPPPPPPPPPPPPPPPPPPPPPPPPPPPPHPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP",
    "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP",
    "PPPPPPPPPPPPPPPPPP/EAB8RAAMAAgMBAQEBAAAAAAAAAAABESFAECBQMDFwkP/aAAgBAwEBPxD/ACfSIQnnrzoQhCdH5K/R/B+S",
    "hlLxSlKPyUP95XM4fkQhSlKXil5a8VdMGDBgwYKUo34q5b6VFKUpR58VcsqKXi+UuWUpSlf2m0hoWOWUpnnJkfzWVtIhOWUrMl4y",
    "Z8YQ+j4yZMlZn5pUgvybS/R9GZM8Z+q3F1pTJkyP7Ji7S6Pm6K4m0uaN6ScLtrh+gheiQvRIXokL0SF6JC1y2kIestpC1yHsrh6y",
    "2lwyD1FtLo9RbS6whCEIQhCEIQhCEIQk2l8WX5XpdtMwMpWUpSlKUpSlKUvFL/WP/8QAIBEAAwABBQEAAwAAAAAAAAAAAAERECAh",
    "MEBQMWBwgP/aAAgBAgEBPxD+coQhCEIQhCEJ40ITjngQmVofjTM4oTyIQnFCE/IUPlnRhCEJzofdXUQ9MIQnVXTWH3Vy3FKUuEx9",
    "G8i5ktKEP4Pnf0XIuS4pcUpcG8rkbFvvyrk2NjY2NjYpbi87V57ouLoeLiopSl4m8LLF0bhvCwWWVFLi8r0Nn3p3KGLLKUpSspvx",
    "vKGJdZD+6aU3zubm/G3H2kP7ppXi4d5frtIm9Ll43zXywTftLSzc31bkfE12rq3IyPTNa0N+Dei+9S9Qu6+qXmTUXosXosXosXos",
    "+PRYvnosXosXz0X6TF6LF89Fi9FvY+O3WJsul78u/wC2P//EAC0QAQACAgICAQMDBQEBAQEBAAEAESExQVEQYXEggaFQkbEwQMHR",
    "8OFg8ZCg/9oACAEBAAE/EP8A/DmJYHzEmAWlYuoCAmRGx/ri7TtlYQdI3/8AHgZQmOu/iVhp+ZYNrfcwAgSnNWQ7n2bWvtKCMmX/",
    "AEnDj04gjpv4/ogWqJ3z4ij/AHIouXt5i3YGHEQt/SXwf5S//iVAy1MXduicde4pWtwBFRlqlqEAVBi8kZWY/wAQQtai5vkhwD8k",
    "FrfjEVofmD8z7TaL9oHYj/6IvVEzSMW3LJTG2CyAxeCIGX2ip+UTFGWqt/aAwh6f/hzk30JdXiUDQ7ZZsL1LAuYdopQDA3KRfumB",
    "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",
    "Nt+Aesp5qZ7PGfpolH/xNLupR1//AD9//9k="
  ].join(""),
};
