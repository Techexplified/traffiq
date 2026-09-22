// Traffiq Web Pixel Extension
// Runs inside Shopify's isolated storefront sandbox to capture behavioral customer events

import { register } from "@shopify/web-pixels-extension";

register(({ analytics, browser, init, settings, customerPrivacy }) => {
  const baseAppUrl = ((settings && (settings.appUrl as string)) || "").replace(/\/+$/, "");
  const endpoint = baseAppUrl ? `${baseAppUrl}/api/events` : "/api/events";

  const shopDomain =
    init?.data?.shop?.myshopifyDomain ||
    init?.context?.document?.location?.hostname ||
    "";

  // Check and subscribe to customer privacy compliance
  let analyticsAllowed = init?.customerPrivacy?.analyticsProcessingAllowed ?? true;
  if (customerPrivacy && customerPrivacy.subscribe) {
    try {
      customerPrivacy.subscribe("visitorConsentCollected", (event) => {
        if (event?.customerPrivacy) {
          analyticsAllowed = event.customerPrivacy.analyticsProcessingAllowed;
        }
      });
    } catch {
      // Graceful fallback if consent bus is not supported
    }
  }

  const parseUtm = (urlString?: string) => {
    if (!urlString) return {};
    try {
      const url = new URL(urlString);
      return {
        source: url.searchParams.get("utm_source") || undefined,
        medium: url.searchParams.get("utm_medium") || undefined,
        campaign: url.searchParams.get("utm_campaign") || undefined,
      };
    } catch {
      return {};
    }
  };

  const sendEvent = (
    eventType: string,
    event: { id?: string; timestamp?: string | number; clientId?: string },
    extraData: Record<string, unknown> = {}
  ) => {
    try {
      const pageUrl =
        (extraData.url as string) ||
        init?.context?.document?.location?.href ||
        "";
      const utm = parseUtm(pageUrl);

      const targetUrl = endpoint.includes("?")
        ? `${endpoint}&shop=${encodeURIComponent(shopDomain)}`
        : `${endpoint}?shop=${encodeURIComponent(shopDomain)}`;

      const payload = {
        eventId: event.id || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        eventType,
        timestamp: event.timestamp ? String(event.timestamp) : new Date().toISOString(),
        clientId: event.clientId || "",
        shopDomain,
        page: pageUrl,
        referrer: (extraData.referrer as string) || init?.context?.document?.referrer || "",
        productId: extraData.productId || undefined,
        variantId: extraData.variantId || undefined,
        totalCost: extraData.totalCost || undefined,
        utm,
        metadata: {
          ...extraData,
          customerPrivacy: {
            analyticsAllowed,
          },
        },
      };

      const body = JSON.stringify(payload);

      // Primary transport: fetch with keepalive & CORS
      if (typeof fetch === "function") {
        fetch(targetUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
          mode: "cors",
        }).catch(() => {
          // Secondary fallback to sendBeacon if fetch fails
          if (browser && browser.sendBeacon) {
            browser.sendBeacon(targetUrl, body);
          }
        });
      } else if (browser && browser.sendBeacon) {
        browser.sendBeacon(targetUrl, body);
      }
    } catch (err) {
      // Non-blocking fail-safe: storefront performance is always protected
    }
  };

  // 1. Page Viewed
  analytics.subscribe("page_viewed", (event) => {
    sendEvent("page_viewed", event, {
      url: event.context?.document?.location?.href,
      referrer: event.context?.document?.referrer,
    });
  });

  // 2. Product Viewed
  analytics.subscribe("product_viewed", (event) => {
    sendEvent("product_viewed", event, {
      url: event.context?.document?.location?.href,
      referrer: event.context?.document?.referrer,
      productId: event.data?.productVariant?.product?.id,
      variantId: event.data?.productVariant?.id,
    });
  });

  // 3. Collection Viewed
  analytics.subscribe("collection_viewed", (event) => {
    sendEvent("collection_viewed", event, {
      url: event.context?.document?.location?.href,
      collectionId: event.data?.collection?.id,
    });
  });

  // 4. Search Submitted
  analytics.subscribe("search_submitted", (event) => {
    sendEvent("search_submitted", event, {
      url: event.context?.document?.location?.href,
      query: event.data?.searchResult?.query,
    });
  });

  // 5. Product Added to Cart
  analytics.subscribe("product_added_to_cart", (event) => {
    sendEvent("product_added_to_cart", event, {
      url: event.context?.document?.location?.href,
      productId: event.data?.cartLine?.merchandise?.product?.id,
      variantId: event.data?.cartLine?.merchandise?.id,
      quantity: event.data?.cartLine?.quantity,
    });
  });

  // 6. Product Removed from Cart
  analytics.subscribe("product_removed_from_cart", (event) => {
    sendEvent("product_removed_from_cart", event, {
      url: event.context?.document?.location?.href,
      variantId: event.data?.cartLine?.merchandise?.id,
    });
  });

  // 7. Cart Viewed
  analytics.subscribe("cart_viewed", (event) => {
    sendEvent("cart_viewed", event, {
      url: event.context?.document?.location?.href,
      totalCost: event.data?.cart?.cost?.totalAmount?.amount,
    });
  });

  // 8. Checkout Started
  analytics.subscribe("checkout_started", (event) => {
    sendEvent("checkout_started", event, {
      url: event.context?.document?.location?.href,
      token: event.data?.checkout?.token,
    });
  });

  // 9. Checkout Completed (Purchase)
  analytics.subscribe("checkout_completed", (event) => {
    sendEvent("purchase", event, {
      url: event.context?.document?.location?.href,
      orderId: event.data?.checkout?.order?.id,
      totalCost: event.data?.checkout?.totalPrice?.amount,
    });
  });
});
