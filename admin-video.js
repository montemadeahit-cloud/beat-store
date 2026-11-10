/* type beat videos for the admin page.
   after an mp3 upload finishes, it offers to add a cover photo; the server makes the video
   (black 1920x1080, photo cropped to a 1000px square) and you get a "download video" button.
   the "videos" button (bottom right) lists every beat so you can do older beats too. */
(() => {
  if (window.__mmtVideo) return; window.__mmtVideo = true;
  const API = "/api/admin/beats";
  const css = `
  .mv-btn{position:fixed;right:18px;bottom:18px;z-index:99998;background:#fff;color:#000;border:0;border-radius:999px;padding:11px 18px;font:900 14px/1 Helvetica,Arial,sans-serif;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,.5)}
  .mv-bd{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:16px}
  .mv-card{background:#0b0b0b;color:#fff;border:1px solid #2a2a2a;border-radius:16px;width:100%;max-width:460px;max-height:86vh;overflow:auto;padding:22px;font:15px/1.45 Helvetica,Arial,sans-serif}
  .mv-card.wide{max-width:640px}
  .mv-h{display:flex;justify-content:space-between;align-items:center;margin:0 0 4px}
  .mv-h b{font-size:20px;font-weight:900;letter-spacing:-.5px}
  .mv-x{background:none;border:0;color:#8f8f8f;font-size:26px;line-height:1;cursor:pointer;padding:0 4px}
  .mv-sub{color:#8f8f8f;font-size:13px;margin:0 0 16px}
  .mv-row{display:flex;gap:12px;align-items:center;padding:12px 0;border-top:1px solid #1e1e1e}
  .mv-th{width:56px;height:56px;flex:none;border-radius:8px;background:#151515 center/cover no-repeat;border:1px solid #222}
  .mv-big{width:100%;aspect-ratio:16/9;border-radius:10px;background:#000;border:1px solid #222;display:flex;align-items:center;justify-content:center;margin:4px 0 14px}
  .mv-big i{width:52%;aspect-ratio:1;background:#151515 center/cover no-repeat;display:block}
  .mv-meta{flex:1;min-width:0}
  .mv-n{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mv-s{color:#8f8f8f;font-size:12px}
  .mv-s.ok{color:#9be89b}.mv-s.err{color:#ff7a7a}
  .mv-acts{display:flex;gap:8px;flex:none;flex-wrap:wrap;justify-content:flex-end}
  .mv-a{display:inline-block;border:1px solid #333;background:#151515;color:#fff;border-radius:999px;padding:8px 14px;font:700 13px/1 Helvetica,Arial,sans-serif;cursor:pointer;text-decoration:none;white-space:nowrap}
  .mv-a.pri{background:#fff;color:#000;border-color:#fff}
  .mv-a[disabled]{opacity:.4;pointer-events:none}
  .mv-foot{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:6px}
  .mv-over{outline:2px dashed #fff;outline-offset:4px;border-radius:10px}
  .mv-row.mv-sel{background:#121212;margin:0 -10px;padding-left:10px;padding-right:10px;border-radius:10px}
  .mv-k{display:inline-block;border:1px solid #333;border-radius:5px;padding:0 5px;font-size:11px;color:#ccc}
  `;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const realFetch = window.fetch.bind(window);
  const getJSON = async (u, o) => { const r = await realFetch(u, { credentials: "same-origin", ...o }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "something went wrong"); return j; };

  const label = v => ({
    none: ["no video yet", ""], waiting: ["photo added, waiting for the mp3", ""], rendering: ["making video\u2026", ""],
    ready: ["video ready", "ok"], error: ["video failed: " + (v.error || "unknown"), "err"], missing: ["video file missing, make it again", "err"], replaced: ["making video\u2026", ""],
  }[v.status] || [v.status, ""]);

  /* pick a photo file */
  function pickPhoto(cb) {
    const inp = el("input"); inp.type = "file"; inp.accept = "image/jpeg,image/png,image/webp";
    inp.onchange = () => { if (inp.files[0]) cb(inp.files[0]); };
    inp.click();
  }
  /* the image in a paste (ctrl+v) or drop, if there is one */
  const imageFrom = dt => {
    if (!dt) return null;
    for (const f of dt.files || []) if (/^image\//.test(f.type)) return f;
    for (const it of dt.items || []) if (it.kind === "file" && /^image\//.test(it.type)) { const f = it.getAsFile(); if (f) return f; }
    return null;
  };
  /* "paste photo" button: reads the clipboard directly (the browser may ask permission once) */
  async function clipboardImage() {
    if (!navigator.clipboard?.read) throw new Error("press ctrl+v to paste instead");
    let items;
    try { items = await navigator.clipboard.read(); } catch { throw new Error("press ctrl+v to paste instead"); }
    for (const it of items) { const t = it.types.find(x => /^image\//.test(x)); if (t) { const blob = await it.getType(t); return new File([blob], "pasted." + (t.split("/")[1] || "png"), { type: t }); } }
    throw new Error("no picture on your clipboard. copy one first (snipping tool, right click > copy image)");
  }

  /* poll until the video is done */
  const polls = new Map();
  function watch(slug, onUpdate) {
    clearInterval(polls.get(slug));
    const t = setInterval(async () => {
      try { const j = await getJSON(`${API}/${encodeURIComponent(slug)}/video/status`); onUpdate(j); if (!["rendering", "waiting", "replaced"].includes(j.video.status) || !document.body.contains(document.querySelector(`[data-mv="${CSS.escape(slug)}"]`))) { clearInterval(t); polls.delete(slug); } }
      catch { clearInterval(t); polls.delete(slug); }
    }, 2000);
    polls.set(slug, t);
  }

  /* one beat's controls (used in both the popup and the list) */
  function beatControls(b, { big = false } = {}) {
    const wrap = el("div"); wrap.dataset.mv = b.slug;
    const thumb = big ? el("div", "mv-big", "<i></i>") : el("div", "mv-th");
    const thumbImg = big ? thumb.firstChild : thumb;
    const s = el("div", "mv-s");
    const photoBtn = el("button", "mv-a");
    const pasteBtn = el("button", "mv-a", "paste photo");
    const dl = el("a", "mv-a pri", "download video");
    const redo = el("button", "mv-a", "make again");
    const paint = info => {
      b = { ...b, ...info };
      thumbImg.style.backgroundImage = b.hasCover ? `url("${API}/${encodeURIComponent(b.slug)}/cover?t=${b.video?.at || Date.now()}")` : "";
      const [txt, cls] = label(b.video || { status: "none" });
      s.textContent = txt; s.className = "mv-s " + cls;
      photoBtn.textContent = b.hasCover ? "change photo" : "add photo";
      const ready = b.video?.status === "ready" && b.video.url;
      dl.style.display = ready ? "" : "none";
      if (ready) { dl.href = b.video.url; dl.setAttribute("download", ""); }
      redo.style.display = b.hasCover && ["error", "missing"].includes(b.video?.status) ? "" : "none";
      if (["rendering", "replaced"].includes(b.video?.status) || (b.video?.status === "waiting" && b.hasFull)) watch(b.slug, paint);
    };
    const upload = async f => {
      s.textContent = "uploading photo\u2026"; s.className = "mv-s";
      try { paint(await getJSON(`${API}/${encodeURIComponent(b.slug)}/cover`, { method: "PUT", headers: { "Content-Type": f.type || "application/octet-stream" }, body: f })); }
      catch (e) { s.textContent = e.message; s.className = "mv-s err"; }
    };
    wrap._upload = upload;
    photoBtn.onclick = () => pickPhoto(upload);
    pasteBtn.onclick = async () => { try { upload(await clipboardImage()); } catch (e) { s.textContent = e.message; s.className = "mv-s err"; } };
    /* drag a photo onto it */
    wrap.addEventListener("dragover", e => { e.preventDefault(); wrap.classList.add("mv-over"); });
    wrap.addEventListener("dragleave", () => wrap.classList.remove("mv-over"));
    wrap.addEventListener("drop", e => { e.preventDefault(); wrap.classList.remove("mv-over"); const f = imageFrom(e.dataTransfer); if (f) upload(f); });
    /* in the list, the row under your mouse is the one ctrl+v goes to */
    if (!big) { const pick = () => { document.querySelectorAll(".mv-row.mv-sel").forEach(r => r.classList.remove("mv-sel")); wrap.classList.add("mv-sel"); }; wrap.addEventListener("mouseenter", pick); wrap.addEventListener("click", pick); }
    redo.onclick = async () => { try { paint(await getJSON(`${API}/${encodeURIComponent(b.slug)}/video`, { method: "POST" })); } catch (e) { s.textContent = e.message; s.className = "mv-s err"; } };
    if (big) {
      const acts = el("div", "mv-foot"); acts.append(redo, pasteBtn, photoBtn, dl);
      wrap.append(thumb, s, acts);
    } else {
      wrap.className = "mv-row";
      const meta = el("div", "mv-meta"); meta.append(el("div", "mv-n", esc(b.name)), s);
      const acts = el("div", "mv-acts"); acts.append(redo, pasteBtn, photoBtn, dl);
      wrap.append(thumb, meta, acts);
    }
    paint(b);
    return wrap;
  }

  function modal(wide) {
    const bd = el("div", "mv-bd"), card = el("div", "mv-card" + (wide ? " wide" : ""));
    bd.appendChild(card); document.body.appendChild(bd);
    const close = () => bd.remove();
    bd.addEventListener("click", e => { if (e.target === bd) close(); });
    document.addEventListener("keydown", function k(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", k); } });
    return { card, close };
  }

  /* popup right after an mp3 upload */
  async function offer(slug) {
    let b;
    try { b = (await getJSON(API)).find(x => x.slug === slug); } catch { return; }
    if (!b || document.querySelector(".mv-bd")) return;
    const { card, close } = modal(false);
    const h = el("div", "mv-h", `<b>video for ${esc(b.name)}</b>`); const x = el("button", "mv-x", "\u00d7"); x.onclick = close; h.appendChild(x);
    card.append(h, el("p", "mv-sub", b.hasCover ? "this beat already has a photo, so the video is being remade with the new audio." : "add a photo to make a type beat video: paste one with <span class='mv-k'>ctrl</span> + <span class='mv-k'>v</span>, drag one in, or pick a file. the photo is only used for the video, it isn't shown on the site."));
    card.append(beatControls(b, { big: true }));
    const skip = el("button", "mv-a", "skip"); skip.onclick = close;
    const f = el("div", "mv-foot"); f.style.marginTop = "10px"; f.appendChild(skip); card.appendChild(f);
  }

  /* list of every beat */
  async function openList() {
    const { card, close } = modal(true);
    const h = el("div", "mv-h", "<b>type beat videos</b>"); const x = el("button", "mv-x", "\u00d7"); x.onclick = close; h.appendChild(x);
    card.append(h, el("p", "mv-sub", "1920\u00d71080, black background, photo cropped to a 1000px square. to paste a photo, point at a beat and press <span class='mv-k'>ctrl</span> + <span class='mv-k'>v</span>. photos are only used for videos, never shown on the site."));
    const list = el("div", null, "<p class='mv-sub'>loading\u2026</p>"); card.appendChild(list);
    try {
      const beats = await getJSON(API);
      list.innerHTML = "";
      if (!beats.length) list.innerHTML = "<p class='mv-sub'>no beats yet.</p>";
      for (const b of beats) {
        const row = beatControls(b);
        if (!b.hasFull) { row.querySelector(".mv-s").textContent = (b.hasCover ? "photo added · " : "") + "upload the mp3 first"; }
        list.appendChild(row);
      }
    } catch (e) { list.innerHTML = `<p class="mv-sub" style="color:#ff7a7a">${esc(e.message)}</p>`; }
  }

  /* ctrl+v while the popup or list is open: the copied picture becomes the photo */
  document.addEventListener("paste", e => {
    const card = document.querySelector(".mv-bd .mv-card"); if (!card) return;
    const f = imageFrom(e.clipboardData);
    const target = card.querySelector(".mv-sel") || (card.querySelectorAll("[data-mv]").length === 1 ? card.querySelector("[data-mv]") : null);
    if (!f) { if (target) { const st = target.querySelector(".mv-s"); st.textContent = "no picture on your clipboard. copy one first"; st.className = "mv-s err"; } return; }
    e.preventDefault();
    if (target && target._upload) target._upload(f);
  });

  /* notice when an mp3 upload finishes (fetch or XMLHttpRequest) */
  const MP3 = /\/api\/admin\/beats\/([^/?#]+)\/full(?:[?#]|$)/;
  const LOGIN = /\/api\/admin\/login(?:[?#]|$)/;
  const seen = (url, method, ok) => {
    if (!ok) return;
    const u = String(url), m = String(method || "GET").toUpperCase();
    const hit = u.match(MP3);
    if (hit && m === "PUT") setTimeout(() => offer(decodeURIComponent(hit[1])), 300);
    if (LOGIN.test(u)) setTimeout(checkAuth, 300);
  };
  window.fetch = async function (input, init) {
    const res = await realFetch(input, init);
    try { seen(typeof input === "string" ? input : input.url, (init && init.method) || (input && input.method), res.ok); } catch {}
    return res;
  };
  const xo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.addEventListener("loadend", () => { try { seen(url, method, this.status >= 200 && this.status < 300); } catch {} });
    return xo.apply(this, arguments);
  };

  /* the "videos" button shows only while logged in */
  let btn = null;
  async function checkAuth() {
    try {
      const me = await getJSON("/api/admin/me");
      if (me.authed && !btn) { btn = el("button", "mv-btn", "videos"); btn.onclick = openList; document.body.appendChild(btn); }
      if (!me.authed && btn) { btn.remove(); btn = null; }
    } catch {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", checkAuth); else checkAuth();
  setInterval(checkAuth, 15000);
})();
