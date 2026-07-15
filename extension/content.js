(async function () {
  const OVERLAY_ID = "btv-overlay-root";
  const ZIP_CODE = "60605";
  const PRICE_CHECKER_PATH = "/price-checker/";

  if (!/\.?boattrader\.com$/i.test(location.hostname)) {
    alert("Boat Trader Values only runs on boattrader.com pages.");
    return;
  }

  const existing = document.getElementById(OVERLAY_ID);
  if (existing) {
    existing.dispatchEvent(new CustomEvent("btv:focus"));
    return;
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = s => (s || "").replace(/\s+/g, " ").trim();

  function fromTitle(text) {
    const m = clean(text).match(/^(\d{4})\s+(.+)$/);
    if (!m) return { year: "", titleRest: "" };

    return {
      year: m[1],
      titleRest: m[2]
    };
  }

  function textAfterLabel(labelText) {
    const bodyText = document.body.innerText;
    const re = new RegExp(`${labelText}\\s*\\n\\s*([^\\n]+)`, "i");
    const m = bodyText.match(re);
    return m ? clean(m[1]) : "";
  }

  function findPrice() {
    const bodyText = document.body.innerText;

    const schemaPrice = findSchemaPrice();
    if (schemaPrice) return schemaPrice;

    const labeledPrice = textAfterLabel("Price");
    if (isLikelyListingPrice(labeledPrice)) return normalizePrice(labeledPrice);

    const domPrice = findVisibleListingPrice();
    if (domPrice) return domPrice;

    const dollarMatches = [...bodyText.matchAll(/(?:US\s*)?\$[\d,]+(?:\.\d{2})?/gi)]
      .map(m => normalizePrice(m[0]))
      .filter(isLikelyListingPrice);

    if (dollarMatches.length) return dollarMatches[0];

    if (/request price/i.test(bodyText)) return "Request Price";
    if (/call for price/i.test(bodyText)) return "Call for Price";

    return "";
  }

  function findSchemaPrice() {
    const values = [];

    function visit(value, parentKey = "") {
      if (!value || typeof value !== "object") return;

      if (Array.isArray(value)) {
        value.forEach(item => visit(item, parentKey));
        return;
      }

      const type = String(value["@type"] || "").toLowerCase();
      const context = `${parentKey} ${type}`.toLowerCase();

      if (value.price && /offer|product|boat|vehicle|listing/.test(context)) {
        values.push(value.price);
      }

      if (value.offers) visit(value.offers, "offers");

      Object.entries(value).forEach(([key, child]) => {
        if (key !== "offers") visit(child, key);
      });
    }

    [...document.querySelectorAll("script[type='application/ld+json']")]
      .forEach(script => {
        try {
          visit(JSON.parse(script.textContent));
        } catch {
          const m = script.textContent.match(/"price"\s*:\s*"?([\d,.]+)"?/i);
          if (m) values.push(m[1]);
        }
      });

    return values.map(normalizePrice).find(isLikelyListingPrice) || "";
  }

  function findVisibleListingPrice() {
    const pricePattern = /(?:US\s*)?\$[\d,]+(?:\.\d{2})?/i;
    const badContext = /\b(month|monthly|mo\.?|payment|finance|financing|estimate|estimated|down|tax|fee|shipping|insurance|save)\b/i;

    const candidates = [...document.querySelectorAll("body *")]
      .filter(visible)
      .map(el => {
        const text = clean(el.innerText);
        if (!text || text.length > 140 || badContext.test(text)) return null;

        const match = text.match(pricePattern);
        if (!match) return null;

        const price = normalizePrice(match[0]);
        if (!isLikelyListingPrice(price)) return null;

        const rect = el.getBoundingClientRect();
        const top = rect.top + window.scrollY;
        const attr = [
          el.id,
          el.className,
          el.getAttribute("aria-label"),
          el.getAttribute("data-testid")
        ].filter(Boolean).join(" ");

        let score = 0;
        if (/price/i.test(attr)) score += 30;
        if (text === match[0] || text === price) score += 25;
        if (top < 1400) score += 20;
        if (top < 800) score += 10;
        if (/\bprice\b/i.test(text)) score += 8;
        score -= Math.max(0, Math.floor(text.length / 20));

        return { price, score, top };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.top - b.top);

    return candidates[0]?.price || "";
  }

  function normalizePrice(value) {
    const raw = clean(String(value || ""));
    const match = raw.match(/(?:US\s*)?\$?\s*([\d,]+(?:\.\d{2})?)/i);
    if (!match) return raw;
    return `$${match[1]}`;
  }

  function isLikelyListingPrice(value) {
    const text = clean(String(value || ""));
    const amount = Number((text.match(/[\d,]+(?:\.\d{2})?/)?.[0] || "").replace(/,/g, ""));
    return amount >= 1000 && amount < 10000000;
  }

  function extractBoat() {
    const h1 = clean(document.querySelector("h1")?.innerText);
    const parsed = fromTitle(h1);
    const year = textAfterLabel("Year") || parsed.year;
    const model = textAfterLabel("Model");

    let make = "";

    if (model && parsed.titleRest) {
      make = clean(parsed.titleRest.replace(model, ""));
    }

    if (!make && parsed.titleRest) {
      const links = [...document.querySelectorAll("a")]
        .map(a => clean(a.innerText))
        .filter(Boolean);

      const possibleMake = links.find(t =>
        parsed.titleRest.includes(t) &&
        t !== model &&
        !/boats?|power|used|new|sale/i.test(t)
      );

      make = possibleMake || "";
    }

    return {
      year,
      make,
      model,
      price: findPrice(),
      zip: ZIP_CODE,
      title: h1
    };
  }

  function createOverlay(boat) {
    const root = document.createElement("div");
    root.id = OVERLAY_ID;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Boat Trader value");

    const shadow = root.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          color: #111827;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          pointer-events: none;
        }

        .backdrop {
          position: absolute;
          inset: 0;
          background: rgba(12, 20, 28, 0.48);
          pointer-events: auto;
        }

        :host([data-minimized="true"]) .backdrop,
        :host([data-minimized="true"]) .panel {
          display: none;
        }

        .panel {
          position: absolute;
          top: max(18px, env(safe-area-inset-top));
          right: 18px;
          bottom: max(18px, env(safe-area-inset-bottom));
          width: min(720px, calc(100vw - 36px));
          min-height: 520px;
          background: #f8fafc;
          border: 1px solid rgba(15, 23, 42, 0.18);
          border-radius: 10px;
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.32);
          display: grid;
          grid-template-rows: auto auto 1fr;
          overflow: hidden;
          pointer-events: auto;
        }

        .restore {
          display: none;
          position: fixed;
          right: 18px;
          bottom: max(18px, env(safe-area-inset-bottom));
          height: 38px;
          padding: 0 14px;
          border: 1px solid rgba(15, 23, 42, 0.24);
          border-radius: 19px;
          background: #ffffff;
          color: #111827;
          box-shadow: 0 10px 32px rgba(0, 0, 0, 0.2);
          font-size: 13px;
          font-weight: 700;
          pointer-events: auto;
        }

        :host([data-minimized="true"]) .restore {
          display: block;
        }

        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 14px;
          background: #ffffff;
          border-bottom: 1px solid rgba(15, 23, 42, 0.12);
        }

        .title {
          min-width: 0;
        }

        .title strong {
          display: block;
          font-size: 14px;
          line-height: 1.25;
        }

        .title span {
          display: block;
          margin-top: 2px;
          color: #4b5563;
          font-size: 12px;
          line-height: 1.35;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .actions {
          display: flex;
          gap: 8px;
          flex: 0 0 auto;
        }

        button {
          height: 32px;
          border: 1px solid rgba(15, 23, 42, 0.2);
          border-radius: 7px;
          background: #ffffff;
          color: #111827;
          font: inherit;
          font-size: 13px;
          cursor: pointer;
        }

        button:hover {
          background: #f1f5f9;
        }

        .close {
          width: 32px;
          font-size: 20px;
          line-height: 28px;
        }

        .meta {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 1px;
          background: rgba(15, 23, 42, 0.1);
          border-bottom: 1px solid rgba(15, 23, 42, 0.12);
        }

        .meta div {
          min-width: 0;
          padding: 8px 10px;
          background: #f8fafc;
        }

        .meta dt {
          margin: 0 0 2px;
          color: #64748b;
          font-size: 11px;
          line-height: 1.2;
        }

        .meta dd {
          margin: 0;
          font-size: 13px;
          font-weight: 600;
          line-height: 1.25;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .frame-wrap {
          position: relative;
          min-height: 0;
          background: #e5edf5;
        }

        iframe {
          display: block;
          width: 100%;
          height: 100%;
          border: 0;
          background: #ffffff;
        }

        .status {
          position: absolute;
          left: 12px;
          right: 12px;
          bottom: 12px;
          min-height: 34px;
          padding: 9px 11px;
          border-radius: 8px;
          background: rgba(17, 24, 39, 0.88);
          color: #ffffff;
          font-size: 12px;
          line-height: 1.35;
          pointer-events: none;
          transition: opacity 160ms ease;
        }

        .status[data-hidden="true"] {
          opacity: 0;
        }

        .fallback {
          display: none;
          position: absolute;
          inset: 0;
          padding: 24px;
          place-items: center;
          background: #f8fafc;
          text-align: center;
        }

        .fallback[data-visible="true"] {
          display: grid;
        }

        .fallback-box {
          max-width: 430px;
        }

        .fallback h2 {
          margin: 0 0 8px;
          font-size: 18px;
        }

        .fallback p {
          margin: 0 0 14px;
          color: #4b5563;
          font-size: 14px;
          line-height: 1.45;
        }

        @media (max-width: 760px) {
          .panel {
            inset: 8px;
            width: auto;
            min-height: 0;
          }

          .meta {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
      </style>
      <div class="backdrop"></div>
      <section class="panel" tabindex="-1">
        <div class="header">
          <div class="title">
            <strong>Boat Trader value</strong>
            <span title="${escapeHtml(boat.title || "")}">${escapeHtml(boat.title || "Listing details extracted")}</span>
          </div>
          <div class="actions">
            <button class="open" type="button">Open page</button>
            <button class="minimize" type="button">Minimize</button>
            <button class="close" type="button" aria-label="Close">&times;</button>
          </div>
        </div>
        <dl class="meta">
          <div><dt>Year</dt><dd>${escapeHtml(boat.year || "-")}</dd></div>
          <div><dt>Make</dt><dd>${escapeHtml(boat.make || "-")}</dd></div>
          <div><dt>Model</dt><dd>${escapeHtml(boat.model || "-")}</dd></div>
          <div><dt>Listing price</dt><dd>${escapeHtml(boat.price || "-")}</dd></div>
          <div><dt>ZIP</dt><dd>${escapeHtml(boat.zip)}</dd></div>
        </dl>
        <div class="frame-wrap">
          <iframe title="Boat Trader price checker"></iframe>
          <div class="fallback">
            <div class="fallback-box">
              <h2>Price checker could not load in the overlay</h2>
              <p>Boat Trader may have blocked iframe display. Open the price checker in a new tab, then use the toolbar button there to fill the form.</p>
              <button class="open-fallback" type="button">Open price checker</button>
            </div>
          </div>
          <div class="status">Loading Boat Trader price checker...</div>
        </div>
      </section>
      <button class="restore" type="button">Boat value</button>
    `;

    document.documentElement.appendChild(root);

    const panel = shadow.querySelector(".panel");
    const iframe = shadow.querySelector("iframe");
    const status = shadow.querySelector(".status");
    const fallback = shadow.querySelector(".fallback");
    const priceCheckerUrl = new URL(PRICE_CHECKER_PATH, location.origin).toString();
    const priceCheckerUrlWithData = `${priceCheckerUrl}#btv=${encodeURIComponent(JSON.stringify(boat))}`;
    let didFill = false;

    const onKeyDown = event => {
      if (event.key === "Escape" && document.getElementById(OVERLAY_ID)) close();
    };

    const close = () => {
      document.documentElement.style.overflow = "";
      document.removeEventListener("keydown", onKeyDown);
      root.remove();
    };

    const minimize = () => {
      root.dataset.minimized = "true";
      document.documentElement.style.overflow = "";
    };

    const restore = () => {
      root.dataset.minimized = "false";
      panel.focus({ preventScroll: true });
    };

    const openPriceChecker = () => {
      window.open(priceCheckerUrlWithData, "_blank", "noopener");
    };

    shadow.querySelector(".backdrop").addEventListener("click", minimize);
    shadow.querySelector(".close").addEventListener("click", close);
    shadow.querySelector(".minimize").addEventListener("click", minimize);
    shadow.querySelector(".restore").addEventListener("click", restore);
    shadow.querySelector(".open").addEventListener("click", openPriceChecker);
    shadow.querySelector(".open-fallback").addEventListener("click", openPriceChecker);
    root.addEventListener("btv:focus", restore);

    document.addEventListener("keydown", onKeyDown);

    function setStatus(message, hideAfterMs) {
      status.textContent = message;
      status.dataset.hidden = "false";
      if (hideAfterMs) {
        window.setTimeout(() => {
          status.dataset.hidden = "true";
        }, hideAfterMs);
      }
    }

    const fallbackTimer = window.setTimeout(() => {
      fallback.dataset.visible = "true";
      setStatus("The embedded page did not become available. Boat Trader may be blocking iframe display.");
    }, 20000);

    iframe.addEventListener("load", async () => {
      window.clearTimeout(fallbackTimer);
      if (didFill) {
        setStatus("Boat Trader value loaded.", 3500);
        return;
      }

      try {
        setStatus("Filling price checker form...");
        didFill = true;
        const result = await fillPriceChecker(iframe, boat);
        if (!result.clicked.ok) {
          setStatus(`Form filled, but the submit button was not found: ${result.clicked.reason}`);
          return;
        }
        setStatus("Submitted. Waiting for Boat Trader value...", 4500);
      } catch (error) {
        fallback.dataset.visible = "true";
        setStatus(`Could not control the embedded price checker: ${error.message}`);
      }
    });

    iframe.src = priceCheckerUrlWithData;
    panel.focus({ preventScroll: true });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function nativeSet(el, value) {
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(el),
      "value"
    )?.set;

    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function fillPriceChecker(iframe, boat) {
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;

    if (!doc || !win) {
      throw new Error("iframe document is not accessible");
    }

    function findField(labelText) {
      const wanted = labelText.toLowerCase();

      return [...doc.querySelectorAll("input")]
        .filter(visible)
        .find(el => {
          const hay = [
            el.name,
            el.id,
            el.placeholder,
            el.getAttribute("aria-label"),
            el.closest("div")?.innerText
          ].filter(Boolean).join(" ").toLowerCase();

          return hay.includes(wanted);
        });
    }

    async function waitForField(labelText) {
      const started = Date.now();
      while (Date.now() - started < 15000) {
        const el = findField(labelText);
        if (el) return el;
        await sleep(250);
      }
      return null;
    }

    async function fillAutocomplete(label, value) {
      const el = await waitForField(label);
      if (!el) throw new Error(`${label} field not found`);

      el.scrollIntoView({ block: "center" });
      el.focus();
      nativeSet(el, "");
      await sleep(50);
      nativeSet(el, value);
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      await sleep(650);

      const options = [...doc.querySelectorAll("[role='option'], li, div")]
        .filter(visible)
        .filter(o => clean(o.innerText).toLowerCase().includes(value.toLowerCase()));

      if (options.length) {
        options[0].click();
        await sleep(250);
      } else {
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await sleep(250);
      }

      return { label, ok: true, value, clickedOption: options.length > 0 };
    }

    async function fillPlain(label, value) {
      const el = await waitForField(label);
      if (!el) throw new Error(`${label} field not found`);

      el.scrollIntoView({ block: "center" });
      el.focus();
      nativeSet(el, value);
      await sleep(200);

      return { label, ok: true, value };
    }

    async function clickCheckPrice() {
      const started = Date.now();
      while (Date.now() - started < 10000) {
        const btn = [...doc.querySelectorAll("button")]
          .filter(visible)
          .find(b => /check price/i.test(clean(b.innerText)));

        if (btn) {
          btn.scrollIntoView({ block: "center" });
          await sleep(200);
          btn.click();
          return { ok: true };
        }

        await sleep(250);
      }

      return { ok: false, reason: "button not found" };
    }

    const results = [];
    results.push(await fillAutocomplete("year", boat.year));
    results.push(await fillAutocomplete("make", boat.make));
    results.push(await fillAutocomplete("model", boat.model));
    results.push(await fillPlain("zip", boat.zip));
    await sleep(500);

    const clicked = await clickCheckPrice();
    return { boat, results, clicked };
  }

  function boatFromHash() {
    const match = location.hash.match(/(?:^|&)#?btv=([^&]+)/);
    if (!match) return null;

    try {
      return JSON.parse(decodeURIComponent(match[1]));
    } catch {
      return null;
    }
  }

  const boat = boatFromHash() || extractBoat();

  if (!boat.year || !boat.make || !boat.model) {
    const details = [
      boat.year ? null : "year",
      boat.make ? null : "make",
      boat.model ? null : "model"
    ].filter(Boolean).join(", ");

    if (!confirm(`Boat Trader Values could not find: ${details}. Open the price checker overlay anyway?`)) {
      return;
    }
  }

  createOverlay(boat);
})();
