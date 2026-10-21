import express from "express";
import Stripe from "stripe";
import { Resend } from "resend";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const {
  STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, ADMIN_PASSWORD,
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
    .replace("__CATALOG__", () => JSON.stringify(liveBeats().map(publicBeat)).replace(/</g, "\\u003c"));
}

/* ---------- signed download links (valid 30 days) ---------- */
const sign = (slug, order, exp) =>
  crypto.createHmac("sha256", STRIPE_WEBHOOK_SECRET || "dev").update(`${slug}.${order}.${exp}`).digest("hex");
const safeName = n => n.replace(/[^\w\- ().,&]+/g, "").replace(/\s+/g, " ").trim() || "beat";
const producers = b => ["montemadethis", ...String(b.coprod || "").split(/\s*(?:,|\sx\s|&)\s*/).map(s => s.trim()).filter(Boolean)];
const fileName = b => safeName(`${b.name} (prod. ${producers(b).join(" x ")})`) + ".mp3"; // credits travel with the file

/* ---------- fulfillment: email the buyer their mp3s ---------- */
async function fulfill(session) {
  const beats = (session.metadata?.slugs || "").split(",").map(getBeat).filter(Boolean);
  const to = session.customer_details?.email || session.customer_email;
  if (!beats.length || !to) throw new Error("order " + session.id + " has no beats or no email");
  const first = esc((session.metadata?.buyer || "").split(" ")[0] || "");
  const exp = Date.now() + 30 * 24 * 3600 * 1000;

  const files = beats.map(b => ({ b, file: fullPath(b.slug) }));
  const totalBytes = files.reduce((n, f) => n + (fs.existsSync(f.file) ? fs.statSync(f.file).size : 0), 0);
  const attach = totalBytes <= 25 * 1024 * 1024; // email providers cap around 40MB
  const attachments = attach
    ? files.filter(f => fs.existsSync(f.file)).map(f => ({ filename: fileName(f.b), content: fs.readFileSync(f.file) }))
    : [];

  const links = beats.map(b =>
    `<li><a href="${BASE_URL}/download/${b.slug}?o=${encodeURIComponent(session.id)}&e=${exp}&sig=${sign(b.slug, session.id, exp)}">download ${esc(fileName(b))}</a></li>`).join("");
  const names = beats.map(b => esc(b.name)).join(", ");
  const one = beats.length === 1;

  const titles = beats.map(b => `"${b.name}" (${b.bpm} bpm)`).join(", ");
  const { error } = await resend.emails.send({
    from: FROM_EMAIL, to, replyTo: OWNER_EMAIL,
    subject: `Thank you for your purchase: ${titles} ${one ? "is" : "are"} available for download`,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#111">
      <p>${first ? `hey ${first},` : "hey,"}</p>
      <p>thank you for purchasing. ${attach ? `attached below ${one ? "is your beat" : "are your beats"}` : `${one ? "your beat is" : "your beats are"} ready to download below`}: <b>${names}</b></p>
      <p>must credit <b>(prod. montemadethis)</b> &amp; any producers listed in the file name, and add proper splits when uploading for profit on any streaming service.</p>
      <p>${attach ? `your mp3${one ? " is" : "s are"} attached. ` : "the files were too large to attach, so use the links below. "}you can also re-download any time in the next 30 days:</p>
      <ul>${links}</ul>
      <p>questions? just reply to this email.</p>
      <p>— montemadethis</p></div>`,
    attachments,
  }, { idempotencyKey: "order-" + session.id });
  if (error) throw new Error("email failed: " + JSON.stringify(error));

  resend.emails.send({
    from: FROM_EMAIL, to: OWNER_EMAIL,
    subject: `sale: ${beats.map(b => b.name).join(", ")} ($${(session.amount_total / 100).toFixed(2)})`,
    text: `${to} bought ${beats.map(b => b.name).join(", ")}. stripe order ${session.id}`,
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
    if (!Array.isArray(body.peaks) || body.peaks.length !== 48 || !body.peaks.every(v => typeof v === "number" && v >= 0 && v <= 1)) throw new Error("bad waveform data");
    out.peaks = body.peaks.map(v => Math.round(v * 100) / 100);
  }
  return out;
}

app.get("/api/admin/beats", requireAdmin, (_req, res) => res.json(allBeats()));
app.post("/api/admin/beats", requireAdmin, (req, res) => {
  try {
    const f = cleanFields(req.body || {}, false);
    const base = slugify(f.name) || "beat";
    let slug = base, i = 2;
    while (DB.some(b => b.slug === slug)) slug = `${base}-${i++}`;
    DB.unshift({ slug, ...f, added: Date.now() }); // newest first
    saveDB();
    res.json(getBeat(slug));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.patch("/api/admin/beats/:slug", requireAdmin, (req, res) => {
  const b = DB.find(x => x.slug === req.params.slug);
  if (!b) return res.status(404).json({ error: "beat not found" });
  try { Object.assign(b, cleanFields(req.body || {}, true)); saveDB(); res.json(getBeat(b.slug)); }
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
    if (!Array.isArray(slugs) || !slugs.length || slugs.length > 20) return res.status(400).json({ error: "your cart is empty" });
    if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "enter a valid email" });
    const beats = [...new Set(slugs)].map(getBeat);
    if (beats.some(b => !b)) return res.status(400).json({ error: "a beat in your cart no longer exists. refresh and try again" });
    const gone = beats.filter(b => !b.hasFull);
    if (gone.length) return res.status(400).json({ error: `not available right now: ${gone.map(b => b.name).join(", ")}` });

    const bundle = beats.length >= 2; // 2+ beats = 25% off every beat in the order
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: beats.map(b => ({
        quantity: 1,
        price_data: { currency: "usd", unit_amount: Math.round(b.price * 100 * (bundle ? 0.75 : 1)),
          product_data: { name: b.name, description: `${b.bpm} bpm · mp3 download${bundle ? " · 25% off (2+ beats)" : ""}` } },
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
app.get("/health", (_req, res) => res.send("ok"));

app.listen(PORT, () => console.log(`montemadethis running on ${BASE_URL} (data: ${DATA_DIR})`));
