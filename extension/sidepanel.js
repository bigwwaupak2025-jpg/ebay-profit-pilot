/* eBay Profit Pilot – side panel */
const $ = id => document.getElementById(id);
const money = v => (v < 0 ? "−" : "") + "$" + Math.abs(v).toFixed(2);
const pct = v => isFinite(v) ? (v * 100).toFixed(1) + "%" : "–";
const n = v => { const x = parseFloat(v); return isFinite(x) ? x : 0; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function status(id, t, c) { const e = $(id); e.className = "st " + (c || ""); e.innerHTML = t; }
function note(id, t, c = "info") { $(id).innerHTML = t ? `<p class="note ${c}">${esc(t)}</p>` : ""; }

/* ---------- Official eBay.com.au rates (incl. GST), checked 26 Nov 2026 ---------- */
const PLANS = {
  free: { name: "Free selling", fvf: { t1: 0, t2: 0, t3: 0, t4: 0 }, fixed: 0, over: 0, bpf: true },
  starter: { name: "Pro Starter", fvf: { t1: 13.4, t2: 13.4, t3: 13.4, t4: 13.4 }, fixed: .30, over: 2.5 },
  basic: { name: "Pro Basic", fvf: { t1: 8.03, t2: 11.44, t3: 12.43, t4: 13.09 }, fixed: .33, over: 2.75 },
  featured: { name: "Pro Featured", fvf: { t1: 7.26, t2: 10.34, t3: 11.22, t4: 11.77 }, fixed: .33, over: 2.75 },
  anchor: { name: "Pro Anchor", fvf: { t1: 6.82, t2: 9.68, t3: 10.56, t4: 11.11 }, fixed: .33, over: 2.75 }
};
const bpf = p => p > 0 ? Math.min(p, 20) * .08 + Math.max(0, Math.min(p, 500) - 20) * .06 + Math.max(0, p - 500) * .04 + .30 : 0;

const state = { sup: null, comps: [], kwUsed: "" };

/* ---------- storage ---------- */
const store = {
  async get(k) { try { return (await chrome.storage.local.get(k))[k]; } catch (_) { return undefined; } },
  async set(k, v) { try { await chrome.storage.local.set({ [k]: v }); } catch (_) {} }
};

/* ---------- STEP 1: supplier ---------- */
async function activeTab() { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); return t; }
function waitForLoad(tabId, timeout = 25000) {
  return new Promise(resolve => {
    const done = () => { chrome.tabs.onUpdated.removeListener(fn); clearTimeout(to); resolve(); };
    const fn = (id, info) => { if (id === tabId && info.status === "complete") done(); };
    const to = setTimeout(done, timeout);
    chrome.tabs.onUpdated.addListener(fn);
    chrome.tabs.get(tabId).then(t => { if (t.status === "complete") done(); }).catch(done);
  });
}
async function runIn(tabId, func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return r && r.result;
}

async function readSupplier() {
  status("st1", '<span class="spin"></span> Reading…', "run"); note("msg1", "");
  let url = $("url").value.trim(), tab = await activeTab();
  if (url && (!tab || !tab.url || tab.url.split("#")[0] !== url.split("#")[0])) {
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    tab = await chrome.tabs.create({ url, active: true });
    await waitForLoad(tab.id); await sleep(3500);
  } else if (!url && tab) { $("url").value = tab.url; }
  if (!tab || !/^https?:/i.test(tab.url || url)) throw new Error("Open a supplier product page first, or paste its link.");
  let data;
  for (let i = 0; i < 3; i++) {   // pages render prices with JavaScript — retry a few times
    try { data = await runIn(tab.id, extractSupplier); } catch (e) { throw new Error("Chrome couldn't read this page. Reload the page, then press Run again."); }
    if (data && parseMoney(data.price) !== null) break;
    await sleep(2000);
  }
  if (!data) throw new Error("Nothing was read from this page.");
  if (data.blocked) { status("st1", "⚠ Check page", "warn"); note("msg1", "The supplier is showing a security check (captcha). Solve it in the tab, then press Run again.", "warn"); return null; }
  if (parseMoney(data.price) === null) { const ai = await aiExtract(data).catch(() => null); if (ai) Object.assign(data, ai); }
  state.sup = data; fillSupplier(data); await store.set("sup", data);
  return data;
}

function fillSupplier(d) {
  $("sup").classList.remove("hidden");
  $("supTitle").textContent = d.title || "(title not found)";
  $("supLink").href = d.url; $("url").value = d.url;
  if (d.image && /^https?:/.test(d.image)) { $("supImg").src = d.image; $("supImg").style.display = ""; } else $("supImg").style.display = "none";
  const price = parseMoney(d.price), orig = parseMoney(d.orig), sh = parseShipping(d.ship);
  $("supPrice").value = price ?? ""; $("supOrig").value = orig ?? ""; $("supShip").value = sh.cost ?? "";
  $("supShipTxt").textContent = sh.text;
  const issues = [];
  if (price === null) issues.push("price not found — type it from the page");
  if (sh.cost === null) issues.push("shipping not found — type it (0 if free)");
  if (d.currency && d.currency !== "AUD") issues.push(`prices are in ${d.currency} — set the supplier site to ship to Australia in AUD, then Run again`);
  if (issues.length) { status("st1", "⚠ Check", "warn"); note("msg1", "Please check: " + issues.join("; ") + ".", "warn"); }
  else { status("st1", "✓ Read", "ok"); note("msg1", `Read from the page${d.source && d.source.price && d.source.price !== "page" ? " (" + d.source.price + ")" : ""}. Confirm the numbers match what you see.`, "good"); }
  if (!$("kw").value || $("kw").dataset.auto === "1") { $("kw").value = keywordsFromTitle(d.title); $("kw").dataset.auto = "1"; }
  updateSupplierTotals();
}
function supplierCost() {
  const p = n($("supPrice").value), s = n($("supShip").value);
  return +((p + s) * ($("addGst").checked ? 1.1 : 1)).toFixed(2);
}
function updateSupplierTotals() {
  const p = n($("supPrice").value), o = n($("supOrig").value);
  $("supDisc").textContent = o > p && p > 0 ? `${Math.round((1 - p / o) * 100)}% off (was ${money(o)})` : "No discount shown";
  if ($("supShip").value !== "") $("supShipTxt").textContent = n($("supShip").value) === 0 ? "Free shipping" : money(n($("supShip").value));
  $("supTotal").textContent = money(supplierCost());
  render();
}
["supPrice", "supShip", "supOrig", "addGst"].forEach(id => $(id).addEventListener("input", updateSupplierTotals));

/* ---------- STEP 2: eBay AU competitors ---------- */
function ebayURL(kw, sold) {
  return "https://www.ebay.com.au/sch/i.html?_nkw=" + encodeURIComponent(kw) + "&LH_PrefLoc=1&LH_BIN=1&_ipg=60" + (sold ? "&LH_Sold=1&LH_Complete=1" : "");
}
async function fetchEbay(kw, sold) {
  // 1) direct fetch with your eBay cookies
  try {
    const res = await fetch(ebayURL(kw, sold), { credentials: "include" });
    if (res.ok) {
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      const r = parseEbay(doc);
      if (!r.blocked && r.items.length) { if (sold) r.items.forEach(i => i.sold = true); return r.items; }
    }
  } catch (_) {}
  // 2) fallback: open the search in a background tab and read the rendered page
  const tab = await chrome.tabs.create({ url: ebayURL(kw, sold), active: false });
  try {
    await waitForLoad(tab.id); await sleep(1500);
    const r = await runIn(tab.id, parseEbay);
    if (r && r.blocked) throw new Error("eBay is showing a security check. Open eBay.com.au in a tab, complete it, then press Find again.");
    const items = (r && r.items) || []; if (sold) items.forEach(i => i.sold = true); return items;
  } finally { chrome.tabs.remove(tab.id).catch(() => {}); }
}
async function findCompetitors() {
  const kw = $("kw").value.trim();
  if (!kw) throw new Error("Type eBay search keywords (or read the supplier page first).");
  status("st2", '<span class="spin"></span> Searching…', "run"); note("msg2", ""); state.kwUsed = kw;
  $("ebayOpen").href = ebayURL(kw, true);
  const [sold, active] = await Promise.all([fetchEbay(kw, true).catch(e => ({ err: e })), fetchEbay(kw, false).catch(e => ({ err: e }))]);
  if (sold.err && active.err) throw sold.err;
  const all = [...(Array.isArray(sold) ? sold : []), ...(Array.isArray(active) ? active : [])];
  const seen = new Set();
  state.comps = all.filter(i => !seen.has(i.url) && seen.add(i.url)).map(i => ({ ...i, score: matchScore(kw, i.title) }))
    .map(i => ({ ...i, on: i.score >= 0.6 && i.postKnown }))
    .sort((a, b) => (b.on - a.on) || (b.sold - a.sold) || a.total - b.total).slice(0, 40);
  renderComps();
  const on = state.comps.filter(c => c.on).length;
  if (!state.comps.length) { status("st2", "⚠ None", "warn"); note("msg2", "No eBay AU listings found. Try shorter keywords (2–4 main words).", "warn"); }
  else if (on < 3) { status("st2", "⚠ Few matches", "warn"); note("msg2", `Only ${on} close match(es). Tick the listings that are the same product, or shorten the keywords.`, "warn"); }
  else { status("st2", `✓ ${on} matched`, "ok"); note("msg2", `Found ${state.comps.length} listings; ${on} look like the same product. Untick any that aren't.`, "good"); }
  await store.set("kw", kw);
}
function renderComps() {
  const box = $("compList"); box.innerHTML = "";
  state.comps.forEach((c, i) => {
    const row = document.createElement("div"); row.className = "comp" + (c.on ? "" : " off");
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = c.on;
    cb.onchange = () => { c.on = cb.checked; row.classList.toggle("off", !c.on); renderStats(); render(); };
    const mid = document.createElement("div");
    const tag = document.createElement("span"); tag.className = "tag" + (c.sold ? " sold" : ""); tag.textContent = c.sold ? "SOLD" : "ACTIVE";
    const a = document.createElement("a"); a.href = c.url; a.target = "_blank"; a.rel = "noopener"; a.textContent = c.title;
    mid.append(tag, a);
    const pr = document.createElement("div"); pr.className = "pr"; pr.textContent = money(c.total);
    const sm = document.createElement("small"); sm.textContent = c.postKnown ? (c.post ? `${money(c.price)} + ${money(c.post)} post` : "free postage") : "postage ?"; pr.appendChild(sm);
    row.append(cb, mid, pr); box.appendChild(row);
  });
  renderStats();
}
const median = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function compTotals() {
  const on = state.comps.filter(c => c.on), sold = on.filter(c => c.sold).map(c => c.total);
  const use = sold.length >= 3 ? sold : on.map(c => c.total);   // prefer real sold prices
  return { all: use.sort((a, b) => a - b), basis: sold.length >= 3 ? "sold" : "listed" };
}
function renderStats() {
  const { all, basis } = compTotals(), el = $("compStats");
  if (!all.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="stats"><div class="stat"><div class="k">Lowest</div><div class="v">${money(all[0])}</div></div>
  <div class="stat"><div class="k">Median</div><div class="v">${money(median(all))}</div></div>
  <div class="stat"><div class="k">Highest</div><div class="v">${money(all[all.length - 1])}</div></div>
  <div class="stat"><div class="k">${basis === "sold" ? "Sold" : "Listed"}</div><div class="v">${all.length}</div></div></div>`;
}

/* ---------- STEP 3: price ---------- */
function settings() {
  const plan = PLANS[$("plan").value];
  return { plan, fee: plan.fvf[$("tier").value] / 100, fixed: plan.fixed, postage: n($("parcel").value), minP: n($("minProfit").value), cost: supplierCost() };
}
function calc(d, price, cost = d.cost) {
  const fvf = Math.min(price, 4000) * d.fee + Math.max(0, price - 4000) * d.plan.over / 100;
  const fees = fvf + d.fixed, profit = price - fees - cost - d.postage;
  return { fvf, fees, profit, buyer: price + (d.plan.bpf ? bpf(price) : 0), margin: price ? profit / price : NaN };
}
function solve(fn, goal) { let lo = 0, hi = 100000; for (let i = 0; i < 70; i++) { const m = (lo + hi) / 2; if (fn(m) < goal) lo = m; else hi = m; } return hi > 99999 ? Infinity : hi; }
function charmUp(p) { const b = Math.floor(p); for (const x of [b - .01, b + .49, b + .99]) if (x >= p - 1e-9) return +x.toFixed(2); return b + 1.49; }
function charmDown(p) { const b = Math.floor(p); for (const x of [b + .99, b + .49, b - .01]) if (x <= p + 1e-9) return +x.toFixed(2); return p; }
let rec = null;
function render() {
  const d = settings(), A = $("answer");
  const priceFor = g => solve(x => calc(d, x).profit, g), forBuyer = b => solve(x => calc(d, x).buyer, b);
  const need = priceFor(d.minP), needL = isFinite(need) ? charmUp(need) : Infinity;
  const { all } = compTotals();
  let tone, k, p, s;
  if (!d.cost) { rec = null; tone = ""; k = "Waiting"; p = "—"; s = "Read the supplier page (step 1) to get your price."; }
  else if (!isFinite(need)) { rec = null; tone = "bad"; k = "Can't reach target"; p = "—"; s = "Fees are too high for this profit target."; }
  else if (!all.length) { rec = needL; tone = "good"; k = "List it at"; p = money(needL); s = `Keeps ${money(calc(d, needL).profit)} profit. Find eBay competitors (step 2) to check the market.`; }
  else {
    const lo = all[0], med = median(all), hi = all[all.length - 1], nb = calc(d, needL).buyer;
    const under = charmDown(forBuyer(lo - 0.01)), medL = charmDown(forBuyer(med));
    if (nb < lo && calc(d, under).profit >= d.minP) { rec = under; tone = "good"; k = "List it at"; p = money(under); s = `Cheapest on eBay AU (lowest competitor ${money(lo)}) and you still keep ${money(calc(d, under).profit)}. Expect fast sales.`; }
    else if (nb <= med) { rec = calc(d, medL).profit >= d.minP && medL >= needL ? medL : needL; tone = "good"; k = "List it at"; p = money(rec); s = `At or below the market median (${money(med)}). You keep ${money(calc(d, rec).profit)} per sale.`; }
    else if (nb <= hi) { rec = needL; tone = "warn"; k = "List it at (slower sales)"; p = money(needL); s = `Above the median (${money(med)}) but under the highest (${money(hi)}). You keep ${money(calc(d, needL).profit)}; expect slower sales.`; }
    else { rec = null; tone = "bad"; k = "Not worth listing"; p = "Skip"; const mc = d.cost + calc(d, medL).profit - d.minP;
      s = `You'd need ${money(needL)} but competitors top out at ${money(hi)}. At the median you'd make ${money(calc(d, medL).profit)}. Buy it for under ${money(Math.max(mc, 0))} to earn ${money(d.minP)}.`; }
  }
  A.className = "answer " + tone; A.innerHTML = `<div class="k">${esc(k)}</div><div class="p">${esc(p)}</div><div class="s">${esc(s)}</div>`;
  const price = rec ?? (isFinite(needL) ? needL : 0), r = calc(d, price), tb = $("breakdown"); tb.innerHTML = "";
  if (d.cost && price) {
    [["Sale price" + (d.plan.bpf ? ` (buyer sees ${money(r.buyer)})` : ""), price, ""], [`eBay final value fee (${(d.fee * 100).toFixed(2)}%)`, -r.fvf, "m"], ["eBay fee per order", -d.fixed, "m"],
     ["Supplier cost (item + shipping" + ($("addGst").checked ? " + GST" : "") + ")", -d.cost, "m"], ["Postage to buyer", -d.postage, "m"]]
      .forEach(([a, v, c]) => { const tr = tb.insertRow(); tr.className = c; tr.insertCell().textContent = a; tr.insertCell().textContent = money(v); });
    const tr = tb.insertRow(); tr.className = "t"; tr.insertCell().textContent = "Your profit"; const c = tr.insertCell(); c.textContent = `${money(r.profit)} (${pct(r.margin)})`; c.className = r.profit >= 0 ? "pos" : "neg";
  }
  $("oMin").textContent = d.cost && isFinite(needL) ? money(needL) : "–";
  if (d.cost && all.length) { const medL = charmDown(solve(x => calc(d, x).buyer, median(all))); const mc = d.cost + calc(d, medL).profit - d.minP; $("oMaxCost").textContent = mc > 0 ? money(mc) : "$0 — unprofitable"; }
  else $("oMaxCost").textContent = "–";
  status("st3", rec !== null ? "✓ Ready" : (d.cost ? "⚠ See note" : ""), rec !== null ? "ok" : "warn");
}
["minProfit", "parcel", "plan", "tier"].forEach(id => $(id).addEventListener("input", () => { render(); saveSettings(); }));
async function saveSettings() { await store.set("settings", { minProfit: $("minProfit").value, parcel: $("parcel").value, plan: $("plan").value, tier: $("tier").value, gst: $("addGst").checked }); }

$("copySum").onclick = async e => {
  const d = settings(), price = rec ?? 0, r = calc(d, price), { all } = compTotals();
  const t = `eBay Profit Pilot — ${state.sup ? state.sup.title : "Product"}\nSupplier: ${state.sup ? state.sup.url : ""}\nSupplier cost (all in): ${money(d.cost)}\n` +
    (all.length ? `eBay AU competitors: lowest ${money(all[0])}, median ${money(median(all))}, highest ${money(all[all.length - 1])}\n` : "") +
    (rec !== null ? `LIST AT: ${money(price)}  →  profit ${money(r.profit)} after eBay fees ${money(r.fees)} and postage ${money(d.postage)}` : "Not worth listing at your profit target.");
  try { await navigator.clipboard.writeText(t); e.target.textContent = "Copied ✓"; } catch (_) { e.target.textContent = "Copy failed"; }
  setTimeout(() => e.target.textContent = "Copy summary", 1500);
};

/* ---------- AI (your Anthropic API key) ---------- */
async function callClaude(content, maxTokens = 2500) {
  const key = await store.get("apiKey"); if (!key) throw Object.assign(new Error("Add your Anthropic API key in step 4."), { code: "nokey" });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({ model: (await store.get("model")) || "claude-sonnet-5-5", max_tokens: maxTokens, messages: [{ role: "user", content }] })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((j.error && j.error.message) || "HTTP " + res.status), { status: res.status });
  const t = (j.content || []).filter(x => x.type === "text").map(x => x.text).join("\n"); const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0) throw new Error("AI reply had no data"); return JSON.parse(t.slice(a, b + 1));
}
async function aiExtract(d) {
  if (!(await store.get("apiKey"))) return null;
  const o = await callClaude([{ type: "text", text: `From this supplier product page text, return ONLY JSON {"title":"","price":"current price with currency","orig":"original price or empty","ship":"shipping text e.g. Free shipping or AU $3.20","currency":"AUD|USD|..."}.\nPAGE TEXT:\n${d.text}` }], 400);
  return { title: o.title || d.title, price: o.price || "", orig: o.orig || "", ship: o.ship || d.ship, currency: o.currency || d.currency, source: { price: "AI read" } };
}
$("saveKey").onclick = async () => { const k = $("apiKey").value.trim(); if (k) { await store.set("apiKey", k); $("apiKey").value = ""; } keyState(); };
async function keyState() { const k = await store.get("apiKey"); $("keyState").textContent = k ? "API key saved ✓" : "No API key yet"; }

$("seoBtn").onclick = async () => {
  if (!state.sup) { note("msg4", "Read the supplier page first (step 1).", "warn"); return; }
  $("seoBtn").disabled = true; status("st4", '<span class="spin"></span> Writing…', "run"); note("msg4", "");
  try {
    const content = [];
    if (state.sup.image && /^https:\/\//.test(state.sup.image)) content.push({ type: "image", source: { type: "url", url: state.sup.image } });
    content.push({ type: "text", text: `You are an expert eBay Australia (ebay.com.au) seller and SEO specialist. Using the supplier product below${content.length ? " and its photo" : ""}, return ONLY JSON:
{"title":"eBay title max 80 characters, main keyword first, key attributes, Australian spelling, no ALL CAPS or symbols","title_alt":"second title max 80 characters",
"primary_keywords":["5-7 high-intent terms Australians search"],"long_tail_keywords":["8-12 long-tail phrases"],
"item_specifics":[{"name":"Brand","value":"Unbranded"}, 6-10 relevant specifics],
"description":"plain text 150-250 words: one-line hook, 5 benefit lines starting with '• ', key specs, What's in the box, fast dispatch within Australia + easy returns. No HTML, links or contact details. Do not invent certifications or specs not in the source.",
"category":"best eBay AU category path"}
SUPPLIER TITLE: ${state.sup.title}
SUPPLIER PAGE TEXT (for specs): ${state.sup.text.slice(0, 3500)}` });
    let o; try { o = await callClaude(content); } catch (e) { if (content.length > 1 && e.status === 400) { o = await callClaude(content.slice(1)); } else throw e; }
    showSEO(o); status("st4", "✓ Done", "ok");
  } catch (e) {
    status("st4", "⚠", "err");
    note("msg4", e.code === "nokey" ? e.message : e.status === 401 ? "Your API key was rejected — check it and save again." : "AI error: " + e.message, e.code === "nokey" ? "warn" : "bad");
  } finally { $("seoBtn").disabled = false; }
};
function copyBtn(get) { const b = document.createElement("button"); b.textContent = "Copy"; b.onclick = async () => { try { await navigator.clipboard.writeText(get()); b.textContent = "Copied ✓"; } catch (_) { b.textContent = "Failed"; } setTimeout(() => b.textContent = "Copy", 1400); }; return b; }
function box(title, count, get) { const w = document.createElement("div"); w.className = "seo-out"; const h = document.createElement("div"); h.className = "hd"; const b = document.createElement("b"); b.textContent = title; const r = document.createElement("span"); if (count) { const c = document.createElement("span"); c.className = "cnt"; c.textContent = count + " "; r.appendChild(c); } r.appendChild(copyBtn(get)); h.append(b, r); w.appendChild(h); return w; }
function showSEO(o) {
  const str = v => typeof v === "string" ? v : "", arr = v => Array.isArray(v) ? v : [], g = $("seo"); g.innerHTML = "";
  if (str(o.category)) { const p = document.createElement("p"); p.className = "tiny"; p.textContent = "Category: " + o.category; g.appendChild(p); }
  [["SEO title", str(o.title)], ["Alternative title", str(o.title_alt)]].forEach(([t, v]) => { if (!v) return; const w = box(t, v.length + "/80" + (v.length > 80 ? " ⚠" : ""), () => v); const d = document.createElement("div"); d.style.fontWeight = "600"; d.textContent = v; w.appendChild(d); g.appendChild(w); });
  const kw = [...arr(o.primary_keywords).map(k => [k, 1]), ...arr(o.long_tail_keywords).map(k => [k, 0])].filter(k => typeof k[0] === "string");
  if (kw.length) { const w = box("Keywords", "", () => kw.map(k => k[0]).join(", ")); const c = document.createElement("div"); c.className = "chips"; kw.forEach(([k, p]) => { const s = document.createElement("span"); s.className = "chip" + (p ? " p" : ""); s.textContent = k; c.appendChild(s); }); w.appendChild(c); g.appendChild(w); }
  const sp = arr(o.item_specifics).filter(x => x && x.name);
  if (sp.length) { const w = box("Item specifics", "", () => sp.map(x => x.name + ": " + x.value).join("\n")); const t = document.createElement("table"); t.className = "ref"; sp.forEach(x => { const tr = t.insertRow(); tr.insertCell().textContent = x.name; tr.insertCell().textContent = x.value; }); w.appendChild(t); g.appendChild(w); }
  if (str(o.description)) { const w = box("Description", o.description.split(/\s+/).length + " words", () => o.description); const d = document.createElement("div"); d.style.whiteSpace = "pre-wrap"; d.style.fontSize = "12.5px"; d.textContent = o.description; w.appendChild(d); g.appendChild(w); }
}

/* ---------- reference: fees by price ---------- */
(function feeTable() {
  const t = $("feeByPrice"); t.innerHTML = "<tr><th>Sale price</th><th>eBay fee</th><th>You get</th></tr>";
  [10, 20, 30, 50, 100, 200, 500, 1000, 5000].forEach(p => {
    const fee = Math.min(p, 4000) * .134 + Math.max(0, p - 4000) * .025 + .30, tr = t.insertRow();
    tr.insertCell().textContent = money(p); tr.insertCell().textContent = `${money(fee)} (${pct(fee / p)})`; tr.insertCell().textContent = money(p - fee);
  });
})();

/* ---------- buttons & start-up ---------- */
async function guard(fn, stId, msgId) {
  try { return await fn(); } catch (e) { status(stId, "⚠ Error", "err"); note(msgId, e.message || String(e), "bad"); return null; }
}
$("read1").onclick = () => guard(readSupplier, "st1", "msg1");
$("find2").onclick = () => guard(findCompetitors, "st2", "msg2").then(render);
$("kw").addEventListener("input", () => $("kw").dataset.auto = "0");
$("runAll").onclick = async () => {
  $("runAll").disabled = true;
  try {
    const sup = await guard(readSupplier, "st1", "msg1");
    if (sup && n($("supPrice").value) > 0) { await guard(findCompetitors, "st2", "msg2"); }
    render(); document.getElementById("s3").scrollIntoView({ behavior: "smooth" });
  } finally { $("runAll").disabled = false; }
};
(async function init() {
  const s = await store.get("settings");
  if (s) { ["minProfit", "parcel", "plan", "tier"].forEach(k => { if (s[k] !== undefined) $(k).value = s[k]; }); if (s.gst !== undefined) $("addGst").checked = s.gst; }
  $("addGst").addEventListener("change", saveSettings);
  keyState();
  try { const t = await activeTab(); if (t && /^https?:/.test(t.url) && !/ebay\./.test(t.url)) $("url").value = t.url; } catch (_) {}
  render();
})();
