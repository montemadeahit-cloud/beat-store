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
  .mv-tabs{display:flex;gap:20px;margin:6px 0 14px;border-bottom:1px solid #1e1e1e}
  .mv-tab{background:none;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;padding:8px 0;color:#8f8f8f;font:700 15px/1 Helvetica,Arial,sans-serif;cursor:pointer}
  .mv-tab:hover{color:#fff}.mv-tab.on{color:#fff;border-bottom-color:#fff}
  .mv-in{width:100%;box-sizing:border-box;background:#151515;border:1px solid #2a2a2a;border-radius:10px;padding:11px 12px;color:#fff;font:15px Helvetica,Arial,sans-serif;outline:none;margin-bottom:10px}
  .mv-in:focus{border-color:#555}
  .mv-zones{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
  @media(max-width:520px){.mv-zones{grid-template-columns:1fr}}
  .mv-zone{border:1.5px dashed #333;border-radius:12px;padding:14px;cursor:pointer;min-height:64px;transition:border-color .15s}
  .mv-zone:hover{border-color:#777}.mv-zone.ok{border-style:solid;border-color:#3a3a3a}
  .mv-zone b{display:block;font-size:14px;margin-bottom:3px}.mv-zone span{color:#8f8f8f;font-size:12px;word-break:break-all}
  .mv-zone.ok>span{color:#9be89b}
  .mv-rh{margin:22px 0 4px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.mv-rh .mv-sub{margin:0}
  .mv-store{color:#8f8f8f;font-size:12px;margin:-6px 0 12px}
  .mv-a.mv-warn{background:#3a1212;border-color:#7a2a2a;color:#ffb3b3}
  .mv-a[disabled]{opacity:.35;pointer-events:none}
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

  /* a delete button that asks "sure?" on the first click */
  const confirmBtn = (text, onYes) => {
    const b = el("button", "mv-a", text); let t;
    b.onclick = async () => {
      if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "sure?"; b.classList.add("mv-warn"); t = setTimeout(() => { b.dataset.sure = ""; b.textContent = text; b.classList.remove("mv-warn"); }, 3000); return; }
      clearTimeout(t); b.disabled = true;
      try { await onYes(); } catch (e) { b.textContent = "failed"; }
      b.dataset.sure = ""; b.disabled = false; b.classList.remove("mv-warn"); if (b.textContent === "sure?") b.textContent = text;
    };
    return b;
  };
  let refreshStorage = () => {};

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
    const delVid = confirmBtn("delete video", async () => { paint(await getJSON(`${API}/${encodeURIComponent(b.slug)}/video`, { method: "DELETE" })); refreshStorage(); });
    const paint = info => {
      b = { ...b, ...info };
      thumbImg.style.backgroundImage = b.hasCover ? `url("${API}/${encodeURIComponent(b.slug)}/cover?t=${b.video?.at || Date.now()}")` : "";
      const [txt, cls] = label(b.video || { status: "none" });
      s.textContent = txt; s.className = "mv-s " + cls;
      photoBtn.textContent = b.hasCover ? "change photo" : "add photo";
      const ready = b.video?.status === "ready" && b.video.url;
      dl.style.display = ready ? "" : "none";
      if (ready) { dl.href = b.video.url; dl.setAttribute("download", ""); }
      redo.style.display = b.hasCover && ["error", "missing", "none"].includes(b.video?.status) && b.hasFull !== false ? "" : "none";
      delVid.style.display = ready && !big ? "" : "none";
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
      const acts = el("div", "mv-acts"); acts.append(delVid, redo, pasteBtn, photoBtn, dl);
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
  /* the videos panel: two tabs */
  let lastTab = "quick";
  function openList(tab) {
    const { card, close } = modal(true);
    const h = el("div", "mv-h", "<b>type beat videos</b>"); const x = el("button", "mv-x", "×"); x.onclick = close; h.appendChild(x);
    const tabs = el("div", "mv-tabs");
    const tq = el("button", "mv-tab", "quick video"), tb = el("button", "mv-tab", "store beats");
    tabs.append(tq, tb);
    const body = el("div");
    const store = el("div", "mv-store");
    card.append(h, tabs, store, body);
    refreshStorage = () => getJSON("/api/admin/videos/storage").then(r => {
      const mb = r.bytes / 1048576;
      store.textContent = `videos + photos are using ${mb < 1 ? mb.toFixed(2) : mb < 1024 ? mb.toFixed(0) : (mb / 1024).toFixed(1)} ${mb < 1024 ? "MB" : "GB"} on your server (${r.beatVideos} store beat video${r.beatVideos === 1 ? "" : "s"}, ${r.quickVideos} quick video${r.quickVideos === 1 ? "" : "s"})`;
    }).catch(() => { store.textContent = ""; });
    refreshStorage();
    const show = t => {
      lastTab = t; tq.classList.toggle("on", t === "quick"); tb.classList.toggle("on", t === "beats");
      body.innerHTML = ""; body.appendChild(t === "quick" ? quickPanel() : beatsPanel());
    };
    tq.onclick = () => show("quick"); tb.onclick = () => show("beats");
    show(tab || lastTab);
  }

  function beatsPanel() {
    const box = el("div");
    box.append(el("p", "mv-sub", "videos for beats in your store. to paste a photo, point at a beat and press <span class='mv-k'>ctrl</span> + <span class='mv-k'>v</span>. photos are only used for videos, never shown on the site."));
    const list = el("div", null, "<p class='mv-sub'>loading…</p>"); box.appendChild(list);
    getJSON(API).then(beats => {
      list.innerHTML = "";
      if (!beats.length) list.innerHTML = "<p class='mv-sub'>no beats yet.</p>";
      for (const b of beats) {
        const row = beatControls(b);
        if (!b.hasFull) { row.querySelector(".mv-s").textContent = (b.hasCover ? "photo added · " : "") + "upload the mp3 first"; }
        list.appendChild(row);
      }
    }).catch(e => { list.innerHTML = `<p class="mv-sub" style="color:#ff7a7a">${esc(e.message)}</p>`; });
    return box;
  }

  /* quick video: any audio + any photo, nothing added to the store */
  const QAPI = "/api/admin/quick";
  const SHOW_RECENT_QUICK = false; // flip to true to bring back the "recent quick videos" list (they still auto-delete after 7 days either way)
  function quickPanel() {
    const box = el("div", "mv-quick");
    box.append(el("p", "mv-sub", "make a video from any audio file. nothing gets added to the store. 1920×1080, black background, photo cropped to a 1000px square."));
    let audio = null, photo = null, photoUrl = "", busy = false;
    const name = el("input", "mv-in"); name.placeholder = "video name (used for the file name)"; name.maxLength = 120;
    const zones = el("div", "mv-zones");
    const za = el("div", "mv-zone", "<b>audio</b><span>mp3, wav, m4a… click or drop</span>");
    const zp = el("div", "mv-zone", "<b>photo</b><span>paste with <span class='mv-k'>ctrl</span> + <span class='mv-k'>v</span>, drop, or click</span>");
    zones.append(za, zp);
    const prev = el("div", "mv-big", "<i></i>"); const prevImg = prev.firstChild;
    const s = el("div", "mv-s");
    const pasteBtn = el("button", "mv-a", "paste photo");
    const go = el("button", "mv-a pri", "make video");
    const dl = el("a", "mv-a pri", "download video"); dl.style.display = "none";
    const again = el("button", "mv-a", "make another"); again.style.display = "none";
    const acts = el("div", "mv-foot"); acts.append(pasteBtn, again, go, dl);
    const recentH = el("div", "mv-rh"), recent = el("div");
    const clearOld = confirmBtn("delete older than 1 day", async () => { await getJSON(`${QAPI}?olderThan=1`, { method: "DELETE" }); loadRecent(); refreshStorage(); });
    const clearAll = confirmBtn("delete all", async () => { await getJSON(QAPI, { method: "DELETE" }); loadRecent(); refreshStorage(); });
    recentH.append(el("span", "mv-sub", "recent quick videos (deleted automatically after 7 days)"), el("span", "mv-acts")); recentH.lastChild.append(clearOld, clearAll);
    box.append(name, zones, prev, s, acts, recentH, recent);

    const msg = (t, cls = "") => { s.textContent = t; s.className = "mv-s " + cls; };
    const ready = () => { go.disabled = busy || !(audio && photo); go.toggleAttribute("disabled", go.disabled); };
    const setAudio = f => {
      if (!f || busy) return; audio = f;
      za.classList.add("ok"); za.querySelector("span").textContent = f.name;
      if (!name.value.trim() || name.dataset.auto === "1") { name.value = f.name.replace(/\.[^.]+$/, ""); name.dataset.auto = "1"; }
      reset(); ready();
    };
    const setPhoto = f => {
      if (!f || busy) return; photo = f;
      if (photoUrl) URL.revokeObjectURL(photoUrl); photoUrl = URL.createObjectURL(f);
      prevImg.style.backgroundImage = `url("${photoUrl}")`;
      zp.classList.add("ok"); zp.querySelector("span").textContent = f.name && f.name !== "image.png" ? f.name : "pasted photo";
      reset(); ready();
    };
    const reset = () => { dl.style.display = "none"; again.style.display = "none"; go.style.display = ""; msg(""); };
    name.oninput = () => { name.dataset.auto = "0"; };
    box._paste = setPhoto;
    const pickFile = (accept, cb) => { const i = el("input"); i.type = "file"; i.accept = accept; i.onchange = () => i.files[0] && cb(i.files[0]); i.click(); };
    za.onclick = () => pickFile("audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.aif,.aiff", setAudio);
    zp.onclick = () => pickFile("image/jpeg,image/png,image/webp", setPhoto);
    for (const [z, fn, isImg] of [[za, setAudio, false], [zp, setPhoto, true]]) {
      z.addEventListener("dragover", e => { e.preventDefault(); z.classList.add("mv-over"); });
      z.addEventListener("dragleave", () => z.classList.remove("mv-over"));
      z.addEventListener("drop", e => { e.preventDefault(); e.stopPropagation(); z.classList.remove("mv-over"); const f = isImg ? imageFrom(e.dataTransfer) : [...(e.dataTransfer.files || [])][0]; if (f) fn(f); });
    }
    box.addEventListener("dragover", e => e.preventDefault());
    box.addEventListener("drop", e => { e.preventDefault(); for (const f of e.dataTransfer.files || []) (/^image\//.test(f.type) ? setPhoto : setAudio)(f); });
    pasteBtn.onclick = async () => { try { setPhoto(await clipboardImage()); } catch (e) { msg(e.message, "err"); } };
    again.onclick = () => { audio = null; za.classList.remove("ok"); za.querySelector("span").textContent = "mp3, wav, m4a… click or drop"; name.value = ""; name.dataset.auto = "1"; reset(); ready(); };

    const sendFile = (url, f, onProg) => new Promise((res, rej) => {
      const x = new XMLHttpRequest(); x.open("PUT", url); x.withCredentials = true;
      x.setRequestHeader("Content-Type", f.type || "application/octet-stream");
      x.upload.onprogress = e => e.lengthComputable && onProg && onProg(e.loaded / e.total);
      x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch {} x.status < 300 ? res(j) : rej(new Error(j.error || "upload failed")); };
      x.onerror = () => rej(new Error("upload failed, check your connection"));
      x.send(f);
    });
    go.onclick = async () => {
      if (!audio || !photo || busy) return;
      busy = true; ready();
      try {
        const job = await getJSON(QAPI, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.value.trim() || audio.name.replace(/\.[^.]+$/, "") }) });
        await sendFile(`${QAPI}/${job.id}/audio`, audio, p => msg(`uploading audio… ${Math.round(p * 100)}%`));
        msg("uploading photo…");
        await sendFile(`${QAPI}/${job.id}/cover`, photo);
        msg("making video…");
        let info;
        for (;;) { await new Promise(r => setTimeout(r, 1500)); info = await getJSON(`${QAPI}/${job.id}`); if (info.status !== "rendering") break; }
        if (info.status !== "ready") throw new Error("video failed: " + (info.error || "unknown"));
        msg("video ready", "ok");
        dl.href = info.url; dl.setAttribute("download", ""); dl.style.display = ""; go.style.display = "none"; again.style.display = "";
        loadRecent(); refreshStorage();
      } catch (e) { msg(e.message, "err"); }
      busy = false; ready();
    };

    function loadRecent() {
      if (!SHOW_RECENT_QUICK) { recentH.style.display = "none"; recent.innerHTML = ""; return; }
      getJSON(QAPI).then(list => {
        recent.innerHTML = ""; recentH.style.display = list.length ? "" : "none";
        for (const q of list) {
          const row = el("div", "mv-row");
          const th = el("div", "mv-th"); if (q.hasCover) th.style.backgroundImage = `url("${QAPI}/${q.id}/cover")`;
          const meta = el("div", "mv-meta"); meta.append(el("div", "mv-n", esc(q.name)));
          const [t, c] = q.status === "ready" ? ["made " + new Date(q.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }), ""] : q.status === "rendering" ? ["making video…", ""] : q.status === "error" ? ["failed: " + q.error, "err"] : ["unfinished", ""];
          meta.append(el("div", "mv-s " + c, esc(t)));
          const a2 = el("div", "mv-acts");
          if (q.url) { const d = el("a", "mv-a pri", "download"); d.href = q.url; d.setAttribute("download", ""); a2.appendChild(d); }
          const del = confirmBtn("delete", async () => { await getJSON(`${QAPI}/${q.id}`, { method: "DELETE" }); row.remove(); if (!recent.children.length) recentH.style.display = "none"; refreshStorage(); });
          a2.appendChild(del);
          row.append(th, meta, a2); recent.appendChild(row);
        }
      }).catch(() => { recentH.style.display = "none"; });
    }
    loadRecent(); ready();
    setTimeout(() => name.focus(), 50);
    return box;
  }

  /* ctrl+v while the popup or list is open: the copied picture becomes the photo */
  document.addEventListener("paste", e => {
    const card = document.querySelector(".mv-bd .mv-card"); if (!card) return;
    const f = imageFrom(e.clipboardData);
    const quick = card.querySelector(".mv-quick");
    if (quick) { if (f) { e.preventDefault(); quick._paste(f); } return; } // quick video tab: the pasted picture is its photo (text pastes into the name box as normal)
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

  /* the "videos" button, only while logged in: next to "view site" in your admin header if it's there, otherwise bottom right */
  let btn = null, top = null;
  const findViewSite = () => [...document.querySelectorAll("a,button")].find(e => !e.closest(".mv-bd") && e !== top && /^view site\b/i.test((e.textContent || "").trim()) && (e.textContent || "").trim().length < 24 && e.offsetParent !== null);
  function placeButtons(authed) {
    if (!authed) { btn?.remove(); top?.remove(); btn = top = null; return; }
    const vs = findViewSite();
    if (vs) {
      if (!top || !top.isConnected || top.previousElementSibling !== vs) {
        top?.remove();
        top = document.createElement(vs.tagName === "A" ? "a" : "button");
        top.className = vs.className; top.textContent = "videos"; top.dataset.mvTop = "1";
        top.style.cssText = vs.style.cssText; // look exactly like "view site"
        const cs = getComputedStyle(vs);
        for (const k of ["color", "fontFamily", "fontSize", "fontWeight", "letterSpacing", "textTransform", "textDecoration", "lineHeight", "background", "border", "padding", "cursor"]) top.style[k] = cs[k];
        if (top.tagName === "A") top.href = "#videos"; else top.type = "button";
        top.onclick = e => { e.preventDefault(); openList(); };
        const ps = getComputedStyle(vs.parentElement);
        if (!/flex|grid/.test(ps.display) || ps.columnGap === "normal" || ps.columnGap === "0px") top.style.marginLeft = "18px";
        vs.after(top);
      }
      btn?.remove(); btn = null;
    } else if (!btn || !btn.isConnected) {
      top?.remove(); top = null;
      btn = el("button", "mv-btn", "videos"); btn.onclick = () => openList(); document.body.appendChild(btn);
    }
  }
  let authed = false;
  async function checkAuth() {
    try { authed = !!(await getJSON("/api/admin/me")).authed; } catch {}
    placeButtons(authed);
  }
  new MutationObserver(() => { if (authed && ((top && !top.isConnected) || (!top && findViewSite()))) placeButtons(true); }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", checkAuth); else checkAuth();
  setInterval(checkAuth, 5000);
})();
