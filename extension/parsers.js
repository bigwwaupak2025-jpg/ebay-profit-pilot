/* Page readers. extractSupplier and parseEbay are self-contained so Chrome can
   run them inside a tab with chrome.scripting.executeScript. */

function extractSupplier() {
  const clean = s => (s || "").replace(/\s+/g, " ").trim();
  const txt = el => (el ? clean(el.textContent) : "");
  const first = sels => { for (const s of sels) { try { const e = document.querySelector(s); if (e && txt(e)) return txt(e); } catch (_) {} } return ""; };
  const meta = n => { const m = document.querySelector(`meta[property="${n}"],meta[name="${n}"],meta[itemprop="${n}"]`); return m ? (m.getAttribute("content") || "") : ""; };
  const body = (document.body && document.body.innerText) || "";
  const out = { url: location.href, host: location.hostname, title: "", price: "", orig: "", disc: "", ship: "", image: "", currency: "", source: {} };

  // JSON-LD Product (many shops)
  try {
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      let j; try { j = JSON.parse(s.textContent); } catch (_) { return; }
      const arr = Array.isArray(j) ? j : (j["@graph"] || [j]);
      arr.forEach(o => {
        if (!o || !/Product/i.test(o["@type"] || "")) return;
        if (!out.title && o.name) { out.title = clean(o.name); out.source.title = "page data"; }
        if (!out.image && o.image) out.image = Array.isArray(o.image) ? o.image[0] : (o.image.url || o.image);
        const of = Array.isArray(o.offers) ? o.offers[0] : o.offers;
        if (of && !out.price && (of.price || of.lowPrice)) { out.price = String(of.price || of.lowPrice); out.currency = of.priceCurrency || ""; out.source.price = "page data"; }
      });
    });
  } catch (_) {}

  // AliExpress / common shop selectors
  if (!out.title) { out.title = first(['h1[data-pl="product-title"]', '[data-pl="product-title"]', 'h1']) || meta("og:title") || document.title; out.source.title = "page"; }
  const p = first(['[class*="price--currentPriceText"]', '[class*="price-default--current"]', '[class*="product-price-current"]', '.product-price-value',
    '[class*="currentPrice"]', '[class*="current-price"]', '[data-pl="product-price"]', '[class*="price_current"]', '[class*="goods-price"]']);
  if (p) { out.price = p; out.source.price = "page"; }
  out.orig = first(['[class*="price--originalText"]', '[class*="price-default--original"]', '[class*="product-price-original"]', '[class*="price--original"]',
    '[class*="originalPrice"]', '[class*="original-price"]', '[class*="price_origin"]', 's', 'del']);
  out.disc = first(['[class*="price--discount"]', '[class*="price-default--discount"]', '[class*="product-price-mark"]', '[class*="discount"]']);
  out.ship = first(['[class*="dynamic-shipping-line"]', '[class*="dynamic-shipping"]', '[class*="shipping--wrap"]', '[class*="shipping-info"]', '[class*="delivery--wrap"]']);
  if (!out.image) out.image = meta("og:image");
  if (!out.price) { out.price = meta("product:price:amount") || meta("og:price:amount") || meta("price"); if (out.price) { out.currency = meta("product:price:currency") || meta("og:price:currency"); out.source.price = "page meta"; } }

  // Text fallback (first price on the page)
  const top = body.slice(0, 8000);
  if (!out.price) { const m = top.match(/(AU\s?\$|A\$|US\s?\$|\$)\s?(\d[\d,]*\.?\d{0,2})/); if (m) { out.price = m[0]; out.source.price = "page text"; } }
  if (!out.ship) { const m = top.match(/(free (shipping|delivery|postage)[^\n]{0,40})|(shipping[:\s]+(AU\s?\$|A\$|\$)\s?\d[\d,]*\.?\d{0,2})/i); if (m) out.ship = m[0]; }
  if (!out.currency) { const all = [out.price, out.orig, top.slice(0, 3000)].join(" "); out.currency = /AU\s?\$|A\$|AUD/.test(all) ? "AUD" : (/US\s?\$|USD/.test(all) ? "USD" : (/€|EUR/.test(all) ? "EUR" : (/£|GBP/.test(all) ? "GBP" : ""))); }
  out.blocked = /captcha|slide to verify|unusual traffic|verify you are human|access denied/i.test(top) && !out.source.price;
  out.text = top.slice(0, 5000);
  return out;
}

function parseEbay(doc) {
  doc = doc || document;
  const clean = s => (s || "").replace(/\s+/g, " ").trim();
  const num = s => { const m = String(s || "").replace(/,/g, "").match(/\$\s?(\d+(?:\.\d{1,2})?)/); return m ? parseFloat(m[1]) : null; };
  const bodyText = (doc.body && doc.body.textContent) || "";
  const blocked = /Pardon Our Interruption|Security Measure|captcha|verify yourself/i.test(bodyText.slice(0, 4000));
  const sold = /LH_Sold=1/.test((doc.location && doc.location.href) || "");
  const seen = new Set(), items = [];
  doc.querySelectorAll("li.s-item, li.s-card, div.s-item, ul.srp-results > li, li[data-viewport]").forEach(li => {
    const a = li.querySelector('a[href*="/itm/"]'); if (!a) return;
    const url = a.href.split("?")[0]; if (seen.has(url)) return;
    let title = clean((li.querySelector(".s-item__title, .s-card__title, [role=heading]") || a).textContent)
      .replace(/^New listing\s*/i, "").replace(/Opens in a new window or tab/ig, "").trim();
    if (!title || /^shop on ebay$/i.test(title)) return;
    const pEl = li.querySelector(".s-item__price, .s-card__price, [class*='price']");
    const price = num(pEl && pEl.textContent); if (!price) return;
    let post = null;
    const cands = [...li.querySelectorAll(".s-item__shipping, .s-item__logisticsCost, .s-item__freeXDays, .s-card__attribute-row, span, div")]
      .map(e => clean(e.textContent)).filter(x => x && x.length < 70 && /postage|delivery|shipping/i.test(x));
    if (cands.length) { const c = cands[0]; post = /free/i.test(c) ? 0 : num(c); }
    const isSold = sold || /\bSold\s+\d{1,2}\s+\w{3}/i.test(clean(li.textContent));
    seen.add(url);
    items.push({ title, price, post, total: +(price + (post || 0)).toFixed(2), url, sold: isSold, postKnown: post !== null });
  });
  return { blocked, items };
}

/* Panel helpers */
function parseMoney(s) {
  if (s === null || s === undefined) return null;
  const m = String(s).replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  return m ? parseFloat(m[1]) : null;
}
function parseShipping(s) {
  if (!s) return { cost: null, text: "Not found — type it" };
  if (/free/i.test(s)) return { cost: 0, text: "Free shipping" };
  const v = parseMoney(s.replace(/\d+\s*(days?|business)/ig, ""));
  return v === null ? { cost: null, text: s.slice(0, 60) } : { cost: v, text: s.slice(0, 60) };
}
const STOP = new Set("new hot sale free shipping for with and the a an of to in on by from 1pc 2pcs pcs pc set lot 2023 2024 2025 2026 high quality original genuine latest best top fashion style styles women men womens mens universal portable mini multi function multifunction premium professional upgraded upgrade dropshipping wholesale".split(" "));
function keywordsFromTitle(t) {
  const words = String(t || "").toLowerCase().replace(/\[.*?\]|\(.*?\)|【.*?】/g, " ").replace(/[^a-z0-9\s-]/g, " ").split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
  const out = []; for (const w of words) { if (!out.includes(w)) out.push(w); if (out.length >= 6) break; }
  return out.join(" ");
}
function matchScore(keywords, title) {
  const k = keywords.toLowerCase().split(/\s+/).filter(Boolean); if (!k.length) return 1;
  const t = title.toLowerCase(); return k.filter(w => t.includes(w.replace(/s$/, ""))).length / k.length;
}
if (typeof module !== "undefined") module.exports = { extractSupplier, parseEbay, parseMoney, parseShipping, keywordsFromTitle, matchScore };
