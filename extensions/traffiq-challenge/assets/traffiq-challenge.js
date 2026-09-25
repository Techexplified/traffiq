(function () {
  if (window.__TRAFFIQ_CHALLENGE_INITIALIZED__) return;
  window.__TRAFFIQ_CHALLENGE_INITIALIZED__ = true;

  var KEY = "tq_challenge_verified";
  var BLOCKED_KEY = "tq_session_blocked";
  var PROD_URL = "https://traffiq-smoky.vercel.app";
  var TUNNEL = PROD_URL;

  try {
    if (window.location.search.indexOf("test_challenge") !== -1 || window.location.search.indexOf("simulate_high_severity") !== -1) {
      sessionStorage.removeItem(KEY);
      sessionStorage.removeItem(BLOCKED_KEY);
      localStorage.removeItem(BLOCKED_KEY);
      console.log("[Traffiq Challenge] Test mode: session verification reset.");
    }
  } catch (e) {}

  // Check persistent block flags immediately upon execution
  var isBlockedStored = false;
  try {
    isBlockedStored =
      sessionStorage.getItem(BLOCKED_KEY) === "true" ||
      localStorage.getItem(BLOCKED_KEY) === "true";
  } catch (e) {}

  var cfg = window.TRAFFIQ_CONFIG || {};
  var shop = cfg.shopDomain || window.location.hostname;
  var appUrl = (cfg.appUrl || "").replace(/\/+$/, "");

  // Detect and override any stale tunnel endpoints with Vercel production URL
  if (
    !appUrl ||
    appUrl.indexOf("trycloudflare.com") !== -1 ||
    appUrl.indexOf("example.com") !== -1 ||
    appUrl.indexOf("graduates-compatibility") !== -1 ||
    appUrl.indexOf("talk-raise-trivia") !== -1 ||
    appUrl.indexOf("individual-runs") !== -1 ||
    appUrl.indexOf("cafe-eugene") !== -1 ||
    appUrl.indexOf("polymer-plots") !== -1 ||
    appUrl.indexOf("america-england") !== -1
  ) {
    appUrl = PROD_URL;
  }

  var isArmed = isBlockedStored;
  var pending = null;
  var activeProtectionMode = isBlockedStored ? "BLOCK" : "CHECKING";
  var currentStatusPromise = null;
  var lastSafeCheckTime = 0;

  window.TraffiqChallenge = {
    reset: function () {
      try {
        sessionStorage.removeItem(KEY);
        sessionStorage.removeItem(BLOCKED_KEY);
        localStorage.removeItem(BLOCKED_KEY);
      } catch (e) {}
      activeProtectionMode = "ALLOW";
      isArmed = false;
      console.log("[Traffiq Challenge] Verification cleared.");
    },
    trigger: function () { showModal(); },
    check: function () { return initProtection(appUrl); },
    isBlocked: function () { return isCurrentlyBlocked(); }
  };

  function isCurrentlyBlocked() {
    if (activeProtectionMode === "BLOCK") return true;
    try {
      if (sessionStorage.getItem(BLOCKED_KEY) === "true" || localStorage.getItem(BLOCKED_KEY) === "true") {
        activeProtectionMode = "BLOCK";
        isArmed = true;
        return true;
      }
    } catch (e) {}
    return false;
  }

  function getAllCandidateIds() {
    var ids = [];
    function add(val) {
      if (!val) return;
      var clean = String(val).replace(/^["']+|["']+$/g, "").trim();
      if (clean && clean.length >= 6 && ids.indexOf(clean) === -1) {
        ids.push(clean);
      }
    }

    try {
      if (window.Shopify && window.Shopify.clientId) add(window.Shopify.clientId);
    } catch (e) {}
    try {
      if (window.ShopifyAnalytics && window.ShopifyAnalytics.lib && typeof window.ShopifyAnalytics.lib.user === "function") {
        var u = window.ShopifyAnalytics.lib.user();
        if (u) {
          if (typeof u.anonymousId === "function") add(u.anonymousId());
          if (typeof u.id === "function") add(u.id());
        }
      }
    } catch (e) {}

    try {
      var metaY = document.querySelector('meta[name="shopify-y"]');
      if (metaY) add(metaY.getAttribute("content"));
      var metaS = document.querySelector('meta[name="shopify-s"]');
      if (metaS) add(metaS.getAttribute("content"));
      var metaFeatures = document.getElementById("shopify-features");
      if (metaFeatures) {
        var featText = metaFeatures.getAttribute("content") || metaFeatures.innerText || "";
        var yMatch = featText.match(/_shopify_y\s*[:=]\s*["']?([^"',\s]+)/i);
        if (yMatch) add(yMatch[1]);
      }
    } catch (e) {}

    try {
      var c = document.cookie.split(";");
      for (var i = 0; i < c.length; i++) {
        var s = c[i].trim();
        if (s.indexOf("_shopify_y=") === 0) add(decodeURIComponent(s.substring(11)));
        else if (s.indexOf("_shopify_s=") === 0) add(decodeURIComponent(s.substring(11)));
        else if (s.indexOf("_y=") === 0) add(decodeURIComponent(s.substring(3)));
        else if (s.indexOf("_s=") === 0) add(decodeURIComponent(s.substring(3)));
        else if (s.indexOf("traffiq_client_id=") === 0) add(decodeURIComponent(s.substring(18)));
        else if (s.indexOf("cart=") === 0) add(decodeURIComponent(s.substring(5)));
      }
    } catch (e) {}

    try {
      if (window.localStorage) {
        add(window.localStorage.getItem("_shopify_y"));
        add(window.localStorage.getItem("_shopify_s"));
        add(window.localStorage.getItem("traffiq_client_id"));
      }
    } catch (e) {}
    try {
      if (window.sessionStorage) {
        add(window.sessionStorage.getItem("_shopify_y"));
        add(window.sessionStorage.getItem("_shopify_s"));
        add(window.sessionStorage.getItem("traffiq_client_id"));
      }
    } catch (e) {}

    return ids;
  }

  function getCid() {
    try {
      var all = getAllCandidateIds();
      if (all && all.length > 0) return all[0];
      var genId = "tqc_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try {
        if (window.localStorage) window.localStorage.setItem("traffiq_client_id", genId);
        document.cookie = "traffiq_client_id=" + genId + ";path=/;max-age=31536000;SameSite=Lax";
      } catch (e) {}
      return genId;
    } catch (e) {}
    return "";
  }

  function getSid() {
    try {
      var metaS = document.querySelector('meta[name="shopify-s"]');
      if (metaS && metaS.getAttribute("content")) return metaS.getAttribute("content").trim();
      var c = document.cookie.split(";");
      for (var j = 0; j < c.length; j++) {
        var s2 = c[j].trim();
        if (s2.indexOf("_shopify_s=") === 0) {
          return decodeURIComponent(s2.substring(11)).replace(/^["']+|["']+$/g, "").trim();
        }
      }
    } catch (e) {}
    return "";
  }

  function initProtection(endpoint) {
    var candidates = getAllCandidateIds();
    var cid = candidates[0] || getCid();
    var sid = getSid();
    var isTest = window.location.search.indexOf("test_challenge") !== -1 || window.location.search.indexOf("simulate_high_severity") !== -1;
    var q = endpoint + "/api/protection/status?shop=" + encodeURIComponent(shop) +
      (cid ? "&clientId=" + encodeURIComponent(cid) : "") +
      (sid ? "&sessionKey=" + encodeURIComponent(sid) : "") +
      (candidates.length ? "&candidates=" + encodeURIComponent(candidates.join(",")) : "") +
      (isTest ? "&test_challenge=1" : "") +
      "&_t=" + Date.now();

    currentStatusPromise = fetch(q, {
      method: "GET",
      mode: "cors"
    })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (d) {
        if (d && (d.blockRequired || d.isManuallyBlocked)) {
          appUrl = endpoint;
          activeProtectionMode = "BLOCK";
          isArmed = true;
          try {
            sessionStorage.setItem(BLOCKED_KEY, "true");
            localStorage.setItem(BLOCKED_KEY, "true");
            sessionStorage.removeItem(KEY);
          } catch (e) {}
          console.log("[Traffiq Protection] 🛑 Hard Block Active (" + (d.reason || d.severity) + "). Restricted modal active.");
          showModal();
        } else if (d && d.challengeRequired) {
          try {
            sessionStorage.removeItem(BLOCKED_KEY);
            localStorage.removeItem(BLOCKED_KEY);
          } catch (e) {}
          var verified = false;
          try { verified = sessionStorage.getItem(KEY) === "true"; } catch (e) {}
          appUrl = endpoint;
          activeProtectionMode = "CHALLENGE";
          isArmed = !verified;
          if (verified) {
            console.log("[Traffiq Protection] ✓ Session challenge-verified.");
          } else {
            console.log("[Traffiq Protection] ⚠️ Challenge Required (" + (d.reason || d.severity) + "). Challenge armed.");
          }
        } else {
          try {
            sessionStorage.removeItem(BLOCKED_KEY);
            localStorage.removeItem(BLOCKED_KEY);
          } catch (e) {}
          activeProtectionMode = "ALLOW";
          isArmed = false;
          lastSafeCheckTime = Date.now();
          console.log("[Traffiq Protection] ✓ Safe Shopper (Severity: " + (d ? d.severity : "LOW") + "). Traffic allowed.");
        }
        return d;
      })
      .catch(function (err) {
        console.warn("[Traffiq Protection] Status check error on " + endpoint + ":", err.message);
        if (endpoint !== TUNNEL) {
          return initProtection(TUNNEL);
        }
        if (!isBlockedStored) {
          activeProtectionMode = "ALLOW";
          isArmed = false;
        }
        return null;
      });

    return currentStatusPromise;
  }

  // ==========================================
  // STOREFRONT TELEMETRY INGESTION (Dual-Layer)
  // ==========================================
  var lastReportedEvents = {};

  function extractCartProductDetails(elOrForm) {
    var details = {};
    try {
      var root = elOrForm ? (elOrForm.closest ? (elOrForm.closest("form") || elOrForm) : elOrForm) : null;
      if (root) {
        var idInput = root.querySelector ? root.querySelector('input[name="id"], select[name="id"]') : null;
        if (idInput && idInput.value) details.variantId = idInput.value;
        var qtyInput = root.querySelector ? root.querySelector('input[name="quantity"]') : null;
        if (qtyInput && qtyInput.value) details.quantity = parseInt(qtyInput.value, 10) || 1;
        if (root.dataset && root.dataset.productId) details.productId = root.dataset.productId;
        if (root.dataset && root.dataset.variantId) details.variantId = root.dataset.variantId;
      }
      if (window.meta && window.meta.product && window.meta.product.id) {
        details.productId = details.productId || String(window.meta.product.id);
      }
    } catch (e) {}
    return details;
  }

  function reportStorefrontEvent(eventType, extraData) {
    try {
      var now = Date.now();
      var extra = extraData || {};
      var dedupeKey = eventType + "_" + (extra.variantId || extra.productId || window.location.pathname);
      if (lastReportedEvents[dedupeKey] && now - lastReportedEvents[dedupeKey] < 1800) {
        return; // Client-side 1.8s debounce
      }
      lastReportedEvents[dedupeKey] = now;

      var cid = getCid();
      var sid = getSid();
      var pageUrl = window.location.href;
      var targetUrl = (appUrl || PROD_URL) + "/api/events?shop=" + encodeURIComponent(shop);

      var utm = {};
      try {
        var parsedUrl = new URL(pageUrl);
        utm = {
          source: parsedUrl.searchParams.get("utm_source") || undefined,
          medium: parsedUrl.searchParams.get("utm_medium") || undefined,
          campaign: parsedUrl.searchParams.get("utm_campaign") || undefined,
        };
      } catch (e) {}

      var clientTz = "";
      try { clientTz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
      var clientLang = navigator.language || (navigator.languages && navigator.languages[0]) || "";

      var payload = {
        eventId: "tq_sf_" + now + "_" + Math.random().toString(36).slice(2, 8),
        eventType: eventType,
        timestamp: new Date(now).toISOString(),
        clientId: cid || "",
        sessionId: sid || "",
        shopDomain: shop,
        page: pageUrl,
        referrer: document.referrer || "",
        utm: utm,
        productId: extra.productId || undefined,
        variantId: extra.variantId || undefined,
        quantity: extra.quantity || 1,
        totalCost: extra.totalCost || undefined,
        timezone: clientTz,
        locale: clientLang,
        metadata: {
          ...extra,
          source: "traffiq_theme_embed",
          userAgent: navigator.userAgent || "",
          timezone: clientTz,
          language: clientLang,
        },
      };

      var body = JSON.stringify(payload);

      if (navigator.sendBeacon) {
        navigator.sendBeacon(targetUrl, new Blob([body], { type: "application/json" }));
      } else if (typeof fetch === "function") {
        fetch(targetUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body,
          keepalive: true,
          mode: "cors",
        }).catch(function () {});
      }
    } catch (e) {
      // Non-blocking fail-safe
    }
  }

  function onDomReady(fn) {
    if (document.readyState === "complete" || document.readyState === "interactive") {
      setTimeout(fn, 1);
    } else {
      document.addEventListener("DOMContentLoaded", fn);
    }
  }

  // If already flagged blocked in storage, show restricted overlay as soon as DOM is ready
  if (isBlockedStored) {
    onDomReady(function () {
      showModal();
    });
  }

  // Initial protection status check
  initProtection(appUrl);

  // Report initial storefront telemetry
  reportStorefrontEvent("page_viewed");
  if (window.location.pathname.indexOf("/products/") !== -1) {
    reportStorefrontEvent("product_viewed", extractCartProductDetails(document));
  } else if (window.location.pathname.indexOf("/collections/") !== -1) {
    reportStorefrontEvent("collection_viewed");
  }

  // Auto-refresh protection status when tab regains focus (e.g. merchant blocked session in Admin tab)
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      initProtection(appUrl);
    }
  });
  window.addEventListener("focus", function () {
    initProtection(appUrl);
  });

  // Periodic status poll every 8 seconds if not currently blocked
  setInterval(function () {
    if (activeProtectionMode !== "BLOCK") {
      initProtection(appUrl);
    }
  }, 8000);

  // ==========================================
  // CART & CHECKOUT ACTION INTERCEPTION
  // ==========================================
  var CART_SELECTORS = [
    'button[name="add"]',
    'input[name="add"]',
    '[data-add-to-cart]',
    '.add-to-cart',
    '.product-form__submit',
    '.add-to-cart-button',
    '[data-testid*="add-to-cart"]',
    'button[id*="add-to-cart"]',
    'button[id*="ProductSubmitButton"]',
    'button[name="checkout"]',
    'input[name="checkout"]',
    'a[href*="/checkout"]',
    '[href*="/checkout"]',
    '.cart__checkout-button',
    '.checkout-btn',
    '.shopify-payment-button',
    '.shopify-payment-button__button',
    '[data-testid*="checkout"]',
    'product-form button[type="submit"]',
    'product-form button',
    'quick-add-modal button[type="submit"]',
    '.quick-add__submit',
    '#CartDrawer-Checkout',
    '#checkout',
    '[name="checkout"]',
    'form[action*="/checkout"] button',
    'form[action*="/cart"] button[type="submit"]'
  ].join(",");

  function isCartOrCheckoutElement(el) {
    if (!el) return null;
    var cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      if (cur.matches && cur.matches(CART_SELECTORS)) return cur;
      if (cur.tagName === "BUTTON" || (cur.tagName === "INPUT" && (cur.type === "submit" || cur.type === "button"))) {
        var f = cur.form || (cur.closest && cur.closest("form"));
        var act = f ? (f.getAttribute("action") || "") : "";
        if (act.indexOf("/cart") !== -1 || act.indexOf("/checkout") !== -1) return cur;
        var fId = f ? (f.id || "") : "";
        if (fId.indexOf("product-form") !== -1 || fId.indexOf("cart") !== -1) return cur;
      }
      if (cur.tagName === "A") {
        var href = cur.getAttribute("href") || "";
        if (href.indexOf("/checkout") !== -1 || href.indexOf("/cart") !== -1) return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  // Intercept Click events in Capture Phase
  document.addEventListener("click", function (e) {
    var btn = isCartOrCheckoutElement(e.target);
    if (!btn) return;

    if (isCurrentlyBlocked()) {
      console.log("[Traffiq Protection] 🛑 Blocked Add to Cart / Checkout click for restricted session.");
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      pending = null;
      showModal();
      return false;
    }

    // Verify protection status before allowing action
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    pending = { type: "click", el: btn };

    initProtection(appUrl).then(function (d) {
      if (d && (d.blockRequired || d.isManuallyBlocked)) {
        pending = null;
        activeProtectionMode = "BLOCK";
        isArmed = true;
        try {
          sessionStorage.setItem(BLOCKED_KEY, "true");
          localStorage.setItem(BLOCKED_KEY, "true");
          sessionStorage.removeItem(KEY);
        } catch (e) {}
        showModal();
      } else if (d && d.challengeRequired) {
        var verified = false;
        try { verified = sessionStorage.getItem(KEY) === "true"; } catch (err) {}
        if (!verified) {
          showModal();
        } else {
          lastSafeCheckTime = Date.now();
          resume();
        }
      } else {
        lastSafeCheckTime = Date.now();
        resume();
      }
    }).catch(function () {
      resume();
    });
    return false;

    if (activeProtectionMode === "CHALLENGE" && isArmed) {
      var verified = false;
      try { verified = sessionStorage.getItem(KEY) === "true"; } catch (err) {}
      if (!verified) {
        console.log("[Traffiq Protection] Challenge required before Add to Cart.");
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        pending = { type: "click", el: btn };
        showModal();
        return false;
      }
    }

    // Telemetry: report add-to-cart on valid button click
    var isAddBtn = (btn.name === "add") ||
      (btn.getAttribute && btn.getAttribute("name") === "add") ||
      (btn.classList && (btn.classList.contains("add-to-cart") || btn.classList.contains("product-form__submit"))) ||
      (btn.closest && (btn.closest('[data-add-to-cart]') || btn.closest('form[action*="/cart/add"]')));

    if (isAddBtn && !isCurrentlyBlocked()) {
      reportStorefrontEvent("product_added_to_cart", extractCartProductDetails(btn));
    }
  }, true);

  // Intercept Form Submit events in Capture Phase
  document.addEventListener("submit", function (e) {
    var form = e.target;
    var act = (form && form.getAttribute ? form.getAttribute("action") : "") || "";
    var isCartSubmit = act.indexOf("/cart/add") !== -1 || act.indexOf("/cart") !== -1 || act.indexOf("/checkout") !== -1;
    if (!isCartSubmit) return;

    if (act.indexOf("/cart/add") !== -1 && !isCurrentlyBlocked()) {
      reportStorefrontEvent("product_added_to_cart", extractCartProductDetails(form));
    }

    if (isCurrentlyBlocked()) {
      console.log("[Traffiq Protection] 🛑 Blocked form submit for restricted session.");
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      pending = null;
      showModal();
      return false;
    }

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    pending = { type: "submit", form: form };

    initProtection(appUrl).then(function (d) {
      if (d && (d.blockRequired || d.isManuallyBlocked)) {
        pending = null;
        activeProtectionMode = "BLOCK";
        isArmed = true;
        try {
          sessionStorage.setItem(BLOCKED_KEY, "true");
          localStorage.setItem(BLOCKED_KEY, "true");
          sessionStorage.removeItem(KEY);
        } catch (e) {}
        showModal();
      } else if (d && d.challengeRequired) {
        var verified = false;
        try { verified = sessionStorage.getItem(KEY) === "true"; } catch (err) {}
        if (!verified) {
          showModal();
        } else {
          lastSafeCheckTime = Date.now();
          resume();
        }
      } else {
        lastSafeCheckTime = Date.now();
        resume();
      }
    }).catch(function () {
      resume();
    });
    return false;

    if (activeProtectionMode === "CHALLENGE" && isArmed) {
      var verified = false;
      try { verified = sessionStorage.getItem(KEY) === "true"; } catch (err) {}
      if (!verified) {
        console.log("[Traffiq Protection] Challenge required before form submission.");
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        pending = { type: "submit", form: form };
        showModal();
        return false;
      }
    }
  }, true);

  // Intercept fetch API calls (Shopify Ajax Cart: /cart/add, /cart/add.js, /cart/update.js, /checkout)
  var origFetch = window.fetch;
  window.fetch = function () {
    var args = arguments, raw = args[0];
    var url = typeof raw === "string" ? raw : (raw && typeof raw.url === "string" ? raw.url : "");
    var isCartUrl = url && (
      url.indexOf("/cart/add") !== -1 ||
      url.indexOf("/cart/update") !== -1 ||
      url.indexOf("/cart/change") !== -1 ||
      url.indexOf("/checkout") !== -1
    );

    if (url && (url.indexOf("/cart/add") !== -1 || url.indexOf("/cart/add.js") !== -1) && !isCurrentlyBlocked()) {
      reportStorefrontEvent("product_added_to_cart", extractCartProductDetails(document));
    }

    if (isCartUrl) {
      if (isCurrentlyBlocked()) {
        console.log("[Traffiq Protection] 🛑 Blocked fetch request for restricted session:", url);
        showModal();
        return Promise.reject(new Error("Traffiq: Action blocked by security policy"));
      }

      // Check protection status before allowing cart/checkout action
      return initProtection(appUrl).then(function (d) {
        if (d && (d.blockRequired || d.isManuallyBlocked)) {
          console.log("[Traffiq Protection] 🛑 Fetch cart blocked after server status check:", url);
          activeProtectionMode = "BLOCK";
          isArmed = true;
          try {
            sessionStorage.setItem(BLOCKED_KEY, "true");
            localStorage.setItem(BLOCKED_KEY, "true");
            sessionStorage.removeItem(KEY);
          } catch (e) {}
          showModal();
          return Promise.reject(new Error("Traffiq: Action blocked by security policy"));
        }

        if (d && d.challengeRequired) {
          var verified = false;
          try { verified = sessionStorage.getItem(KEY) === "true"; } catch (e) {}
          if (!verified) {
            console.log("[Traffiq Protection] Intercepted fetch for challenge verification:", url);
            return new Promise(function (res, rej) {
              pending = { type: "fetch", args: args, res: res, rej: rej, orig: origFetch };
              showModal();
            });
          }
        }

        return origFetch.apply(window, args);
      }).catch(function () {
        if (isCurrentlyBlocked()) {
          showModal();
          return Promise.reject(new Error("Traffiq: Action blocked by security policy"));
        }
        return origFetch.apply(window, args);
      });
    }

    return origFetch.apply(this, args);
  };

  // Intercept XMLHttpRequest calls (jQuery / $.ajax cart operations)
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this._tq_url = typeof url === "string" ? url : "";
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this._tq_url && (this._tq_url.indexOf("/cart/add") !== -1 || this._tq_url.indexOf("/cart/add.js") !== -1) && !isCurrentlyBlocked()) {
      reportStorefrontEvent("product_added_to_cart", extractCartProductDetails(document));
    }

    if (this._tq_url && (this._tq_url.indexOf("/cart/add") !== -1 || this._tq_url.indexOf("/checkout") !== -1)) {
      if (isCurrentlyBlocked()) {
        console.log("[Traffiq Protection] 🛑 Blocked XHR request for restricted session:", this._tq_url);
        showModal();
        return;
      }
      if (activeProtectionMode === "CHALLENGE" && isArmed) {
        var verified = false;
        try { verified = sessionStorage.getItem(KEY) === "true"; } catch (e) {}
        if (!verified) {
          showModal();
          return;
        }
      }
    }
    return origSend.apply(this, arguments);
  };

  // ==========================================
  // MODAL RENDERING & CONTROLS
  // ==========================================
  function getModal() {
    var m = document.getElementById("traffiq-challenge-modal");
    if (m) {
      if (m.dataset.mode !== activeProtectionMode) {
        m.remove();
        m = null;
      } else {
        return m;
      }
    }

    m = document.createElement("div");
    m.id = "traffiq-challenge-modal";
    m.dataset.mode = activeProtectionMode;
    m.className = "tq-modal-overlay";

    var target = document.body || document.documentElement;

    if (activeProtectionMode === "BLOCK") {
      var incidentId = "TQ-" + Math.floor(100000 + Math.random() * 900000);
      m.innerHTML =
        '<div class="tq-modal-card tq-blocked" role="dialog" aria-modal="true">' +
        '<button class="tq-modal-close" id="tq-c-btn" aria-label="Close">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>' +
        '</svg>' +
        '</button>' +
        '<div class="tq-blocked-header">' +
        '<div class="tq-emblem-wrap">' +
        '<div class="tq-emblem-glow"></div>' +
        '<div class="tq-emblem-icon">' +
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' +
        '<line x1="9" y1="12" x2="15" y2="12"/>' +
        '</svg>' +
        '</div>' +
        '</div>' +
        '<div class="tq-blocked-titles">' +
        '<div class="tq-badge-row">' +
        '<span class="tq-defense-pill"><span class="tq-live-dot"></span>Traffiq Defense</span>' +
        '<span class="tq-code-ref">Rule #' + incidentId + '</span>' +
        '</div>' +
        '<h3 class="tq-blocked-title">Checkout Access Restricted</h3>' +
        '</div>' +
        '</div>' +
        '<div class="tq-reason-box">' +
        '<div class="tq-reason-heading">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">' +
        '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>' +
        '</svg>' +
        '<span>Automated Activity Signature Detected</span>' +
        '</div>' +
        '<p class="tq-reason-text">' +
        'High-velocity browsing or automated signals were detected on this session. Access to checkout and cart operations has been restricted to safeguard store inventory and prevent card testing.' +
        '</p>' +
        '</div>' +
        '<div class="tq-audit-strip">' +
        '<div class="tq-audit-item"><span class="tq-audit-label">Session Status</span><span class="tq-audit-val warning">Restricted</span></div>' +
        '<div class="tq-audit-item"><span class="tq-audit-label">Enforcement</span><span class="tq-audit-val">Shopify Engine</span></div>' +
        '<div class="tq-audit-item"><span class="tq-audit-label">Protected Store</span><span class="tq-audit-val text-truncate">' + shop + '</span></div>' +
        '</div>' +
        '<p class="tq-help-note">If you are a genuine customer, please disable automated extensions, VPN/proxies, or verify your browser below.</p>' +
        '<div class="tq-actions-row">' +
        '<button class="tq-btn-refresh" id="tq-reload-btn">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>' +
        '</svg>' +
        '<span>Refresh &amp; Re-verify Session</span>' +
        '</button>' +
        '<button class="tq-btn-dismiss" id="tq-dismiss-btn">Dismiss</button>' +
        '</div>' +
        '<div class="tq-modal-footer">' +
        '<div class="tq-footer-brand">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' +
        '<span>Secured by Traffiq AI Defense</span>' +
        '</div>' +
        '<span class="tq-verified-pill">Shopify Verified</span>' +
        '</div>' +
        '</div>';
      target.appendChild(m);
      m.querySelector("#tq-c-btn").addEventListener("click", hideModal);
      var dismissBtn = m.querySelector("#tq-dismiss-btn");
      if (dismissBtn) dismissBtn.addEventListener("click", hideModal);
      var reloadBtn = m.querySelector("#tq-reload-btn");
      if (reloadBtn) {
        reloadBtn.addEventListener("click", function () {
          reloadBtn.disabled = true;
          reloadBtn.innerHTML = '<span class="tq-spinner"></span> Checking...';
          try {
            sessionStorage.removeItem(BLOCKED_KEY);
            localStorage.removeItem(BLOCKED_KEY);
            sessionStorage.removeItem(KEY);
          } catch (e) {}
          initProtection(appUrl).then(function (d) {
            if (d && !d.blockRequired && !d.isManuallyBlocked) {
              hideModal();
              window.location.reload();
            } else {
              setTimeout(function () { window.location.reload(); }, 400);
            }
          });
        });
      }
      m.addEventListener("click", function (e) { if (e.target === m) hideModal(); });
      return m;
    }

    m.innerHTML =
      '<div class="tq-modal-card" role="dialog" aria-modal="true">' +
      '<button class="tq-modal-close" id="tq-c-btn" aria-label="Close">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>' +
      '</svg>' +
      '</button>' +
      '<div class="tq-modal-header">' +
      '<div class="tq-shield-icon-badge"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>' +
      '<div><h3 class="tq-modal-title">Security Verification</h3><span class="tq-modal-badge">Traffiq Defense</span></div>' +
      '</div>' +
      '<p class="tq-modal-desc">Please complete this quick human check to continue.</p>' +
      '<div class="tq-captcha-box" id="tq-box">' +
      '<div class="tq-slider-track" id="tq-trk">' +
      '<div class="tq-slider-fill" id="tq-fil"></div>' +
      '<span class="tq-slider-text" id="tq-txt">Slide to verify human ➔</span>' +
      '<div class="tq-slider-handle" id="tq-hdl"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg></div>' +
      '</div></div>' +
      '<div class="tq-modal-footer">' +
      '<div class="tq-footer-brand"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg><span>Secured by Traffiq AI Protection</span></div>' +
      '<span class="tq-verified-pill">Protected Store</span>' +
      '</div>' +
      '</div>';
    target.appendChild(m);
    m.querySelector("#tq-c-btn").addEventListener("click", hideModal);
    m.addEventListener("click", function (e) { if (e.target === m) hideModal(); });
    setupSlider(m);
    return m;
  }

  function setupSlider(m) {
    var trk = m.querySelector("#tq-trk"), hdl = m.querySelector("#tq-hdl"), fil = m.querySelector("#tq-fil"), txt = m.querySelector("#tq-txt"), box = m.querySelector("#tq-box");
    var isDrag = false, startX = 0, max = 0;

    m._reset = function () {
      isDrag = false;
      hdl.style.transform = "translateX(0px)";
      fil.style.width = "0px";
      txt.style.opacity = "1";
      txt.innerHTML = "Slide to verify human ➔";
      box.className = "tq-captcha-box";
      hdl.style.display = "flex";
    };

    function start(e) {
      if (box.classList.contains("tq-verifying") || box.classList.contains("tq-success")) return;
      isDrag = true;
      startX = e.touches ? e.touches[0].clientX : e.clientX;
      max = trk.getBoundingClientRect().width - hdl.getBoundingClientRect().width - 8;
    }

    function move(e) {
      if (!isDrag) return;
      var cx = e.touches ? e.touches[0].clientX : e.clientX;
      var d = Math.max(0, Math.min(cx - startX, max));
      hdl.style.transform = "translateX(" + d + "px)";
      fil.style.width = (d + 22) + "px";
      txt.style.opacity = String(Math.max(0, 1 - (d / max) * 1.5));
      if (d >= max * 0.92) {
        isDrag = false;
        success();
      }
    }

    function end() {
      if (!isDrag) return;
      isDrag = false;
      hdl.style.transition = "transform 0.2s";
      fil.style.transition = "width 0.2s";
      hdl.style.transform = "translateX(0px)";
      fil.style.width = "0px";
      txt.style.opacity = "1";
      setTimeout(function () {
        hdl.style.transition = "";
        fil.style.transition = "";
      }, 200);
    }

    function success() {
      box.className = "tq-captcha-box tq-verifying";
      txt.innerHTML = '<span class="tq-spinner"></span> Verifying...';
      txt.style.opacity = "1";
      var cid = getCid();
      var sid = getSid();
      fetch(appUrl + "/api/protection/verify-challenge?shop=" + encodeURIComponent(shop), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopDomain: shop,
          clientId: cid,
          sessionKey: sid || cid,
          answer: "slider_verified",
          timestamp: Date.now()
        }),
      })
        .finally(function () {
          box.className = "tq-captcha-box tq-success";
          txt.innerHTML = "✓ Human Verified!";
          try { sessionStorage.setItem(KEY, "true"); } catch (e) {}
          isArmed = false;
          setTimeout(function () {
            hideModal();
            resume();
          }, 600);
        });
    }

    hdl.addEventListener("mousedown", start);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    hdl.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end);
  }

  function showModal() {
    var m = getModal();
    if (!m) return;
    if (!m.parentNode) {
      (document.body || document.documentElement).appendChild(m);
    }
    if (m._reset) m._reset();
    m.classList.add("tq-active");
    m.style.setProperty("display", "flex", "important");
    m.style.setProperty("opacity", "1", "important");
    m.style.setProperty("visibility", "visible", "important");
    m.style.setProperty("pointer-events", "auto", "important");
    m.style.setProperty("z-index", "2147483647", "important");
    try {
      document.documentElement.style.setProperty("overflow", "hidden", "important");
      if (document.body) document.body.style.setProperty("overflow", "hidden", "important");
    } catch (e) {}
  }

  function hideModal() {
    var m = document.getElementById("traffiq-challenge-modal");
    if (m) {
      m.classList.remove("tq-active");
      m.style.setProperty("display", "none", "important");
      m.style.setProperty("opacity", "0", "important");
      m.style.setProperty("visibility", "hidden", "important");
      m.style.setProperty("pointer-events", "none", "important");
    }
    try {
      document.documentElement.style.removeProperty("overflow");
      if (document.body) document.body.style.removeProperty("overflow");
    } catch (e) {}
  }

  function resume() {
    if (!pending) return;
    var p = pending;
    pending = null;
    if (p.type === "click" && p.el) {
      if (p.el.tagName === "A" && p.el.href) window.location.href = p.el.href;
      else if (p.el.click) p.el.click();
    } else if (p.type === "submit" && p.form) {
      p.form.submit();
    } else if (p.type === "fetch") {
      p.orig.apply(window, p.args).then(p.res).catch(p.rej);
    }
  }
})();