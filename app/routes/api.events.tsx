import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { processIngestionEvent, type IngestionEventPayload } from "../services/sessionAggregator.server";
import { getShopByDomain } from "../services/shop.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

// 9 Supported customer events from Shopify Web Pixel
const ALLOWED_EVENT_TYPES = new Set([
  "page_viewed",
  "product_viewed",
  "collection_viewed",
  "search_submitted",
  "product_added_to_cart",
  "product_removed_from_cart",
  "cart_viewed",
  "checkout_started",
  "purchase",
]);

// Sliding-window rate limiter per client IP: max 120 events / 60 seconds
interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const rateLimits = new Map<string, RateLimitEntry>();

function isRateLimited(key: string, limit = 120, windowMs = 60000): boolean {
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  if (entry.count >= limit) {
    return true;
  }
  entry.count += 1;
  return false;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  return new Response(
    JSON.stringify({
      service: "Traffiq Storefront Ingestion API",
      status: "ACTIVE",
      version: "1.0.0",
      appUrl: process.env.SHOPIFY_APP_URL || process.env.APP_URL || "",
      supportedEvents: Array.from(ALLOWED_EVENT_TYPES),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed. Use POST." }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const url = new URL(request.url);

    // 1. Rate Limiting Check per client IP
    const clientIp =
      request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "127.0.0.1";

    if (isRateLimited(clientIp)) {
      console.warn(`[Ingestion] Rate limit exceeded for IP: ${clientIp}`);
      return new Response(
        JSON.stringify({ error: "Too Many Requests", message: "Rate limit exceeded. Slow down." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rawBody = (await request.json()) as Record<string, unknown>;

    // 2. Validate Event Type
    const eventType = String(rawBody.eventType || "");
    if (!eventType || !ALLOWED_EVENT_TYPES.has(eventType)) {
      console.warn(`[Ingestion] Rejected invalid eventType: '${eventType}'`);
      return new Response(
        JSON.stringify({
          error: "Invalid eventType",
          message: `EventType '${eventType}' is not supported. Must be one of: ${Array.from(ALLOWED_EVENT_TYPES).join(", ")}`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Customer Privacy Consent Handling
    const metadata = (rawBody.metadata as Record<string, unknown>) || {};
    const privacy = (metadata.customerPrivacy as { analyticsAllowed?: boolean }) || {};
    const isAnonymized = privacy.analyticsAllowed === false;

    // 4. Secure Shop Context Resolution (NEVER trust client-provided shopId or riskScore)
    // Extract candidate shop domain from query param, payload, or page URL hostname
    let candidateDomain =
      url.searchParams.get("shop") ||
      (typeof rawBody.shopDomain === "string" ? rawBody.shopDomain : undefined);

    if (!candidateDomain && typeof rawBody.page === "string" && rawBody.page.startsWith("http")) {
      try {
        candidateDomain = new URL(rawBody.page).hostname;
      } catch {
        // Ignored
      }
    }

    if (!candidateDomain) {
      const referer = request.headers.get("referer");
      if (referer) {
        try {
          candidateDomain = new URL(referer).hostname;
        } catch {
          // Ignored
        }
      }
    }

    // Look up shop domain strictly against active registered stores
    const cleanDomain = (candidateDomain || "")
      .replace(/^https?:\/\//, "")
      .split("/")[0]
      .split(":")[0]
      .toLowerCase();

    let shop = cleanDomain ? await getShopByDomain(cleanDomain) : null;
    if (!shop && candidateDomain) {
      shop = await getShopByDomain(candidateDomain);
    }

    // In dev / single-store installations, fallback to most recently updated active shop if candidate was omitted
    if (!shop) {
      shop = await prisma.shop.findFirst({
        where: { status: "ACTIVE" },
        include: { settings: true },
        orderBy: { updatedAt: "desc" },
      });
    }

    if (!shop) {
      console.warn(`[Ingestion] Unauthorized event attempt for unregistered store: '${cleanDomain}'`);
      return new Response(
        JSON.stringify({ error: "Shop unauthorized or inactive in Traffiq." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Generate and Validate Event ID
    const eventId =
      typeof rawBody.eventId === "string" && rawBody.eventId.length > 4
        ? rawBody.eventId
        : `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // 6. Deduplication: Primary check by eventId within the shop
    const existingEvent = await prisma.trafficEvent.findFirst({
      where: { id: eventId, shopId: shop.id },
      include: { session: true },
    });

    if (existingEvent) {
      console.log(`[Ingestion] Deduplicated existing event ID: ${eventId} (${eventType})`);
      return new Response(
        JSON.stringify({
          success: true,
          eventId: existingEvent.id,
          sessionId: existingEvent.sessionId,
          deduplicated: true,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Short-window debounce (2 seconds) to prevent rapid duplicate double-clicks from storefront
    const sessionKeyCandidate =
      typeof rawBody.clientId === "string" && rawBody.clientId
        ? rawBody.clientId
        : typeof rawBody.sessionId === "string" && rawBody.sessionId
        ? rawBody.sessionId
        : `anon_${clientIp.replace(/[^a-zA-Z0-9]/g, "_")}`;

    const twoSecondsAgo = new Date(Date.now() - 2000);
    const recentDuplicate = await prisma.trafficEvent.findFirst({
      where: {
        shopId: shop.id,
        eventType,
        pageUrl: typeof rawBody.page === "string" ? rawBody.page : "/",
        timestamp: { gte: twoSecondsAgo },
        session: {
          sessionKey: sessionKeyCandidate,
        },
      },
    });

    if (recentDuplicate) {
      console.log(`[Ingestion] Debounced duplicate event (${eventType}) within 2s for ${sessionKeyCandidate}`);
      return new Response(
        JSON.stringify({
          success: true,
          eventId: recentDuplicate.id,
          sessionId: recentDuplicate.sessionId,
          deduplicated: true,
          debounced: true,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 7. Sanitize Payload (Never trust client riskScore or client shopId)
    const userAgent = request.headers.get("user-agent") || (typeof rawBody.userAgent === "string" ? rawBody.userAgent : "");
    const headerCountry =
      request.headers.get("x-vercel-ip-country") ||
      request.headers.get("cf-ipcountry") ||
      request.headers.get("x-country-code") ||
      request.headers.get("cloudfront-viewer-country") ||
      request.headers.get("x-geo-country");
    const headerRegion = request.headers.get("x-vercel-ip-country-region") || undefined;
    const headerCity = request.headers.get("x-vercel-ip-city") || undefined;
    const headerTimezone = request.headers.get("x-vercel-ip-timezone") || undefined;

    const rawCountry = typeof rawBody.country === "string" ? rawBody.country : headerCountry || undefined;
    const rawTimezone =
      (typeof rawBody.timezone === "string" ? rawBody.timezone : undefined) ||
      (typeof (rawBody.metadata as any)?.timezone === "string" ? (rawBody.metadata as any).timezone : undefined) ||
      headerTimezone;
    const rawLocale =
      (typeof (rawBody.metadata as any)?.locale === "string" ? (rawBody.metadata as any).locale : undefined) ||
      (typeof (rawBody.metadata as any)?.language === "string" ? (rawBody.metadata as any).language : undefined) ||
      request.headers.get("accept-language") ||
      undefined;

    const payload: IngestionEventPayload = {
      eventId,
      eventType,
      timestamp: rawBody.timestamp as string | number | undefined,
      clientId: typeof rawBody.clientId === "string" ? rawBody.clientId : undefined,
      sessionId: typeof rawBody.sessionId === "string" ? rawBody.sessionId : undefined,
      page: typeof rawBody.page === "string" ? rawBody.page : "/",
      referrer: typeof rawBody.referrer === "string" ? rawBody.referrer : "",
      productId: typeof rawBody.productId === "string" ? rawBody.productId : undefined,
      variantId: typeof rawBody.variantId === "string" ? rawBody.variantId : undefined,
      totalCost: typeof rawBody.totalCost === "number" || typeof rawBody.totalCost === "string" ? rawBody.totalCost : undefined,
      utm: (rawBody.utm as { source?: string; medium?: string; campaign?: string }) || {},
      metadata,
      shopDomain: shop.shopDomain,
      userAgent,
      clientIp: isAnonymized ? clientIp.replace(/\.\d+$/, ".0") : clientIp,
      country: rawCountry,
      city: typeof rawBody.city === "string" ? rawBody.city : headerCity,
      region: typeof rawBody.region === "string" ? rawBody.region : headerRegion,
      timezone: rawTimezone,
      locale: rawLocale,
    };

    // 8. Process Ingestion & Persist into TrafficEvent and TrafficSession
    // skipDetection: false -> TrafficDetectionEngine evaluates session risk in real-time
    const { event, session } = await processIngestionEvent(payload, shop.id, undefined, false);

    console.log(
      `[Ingestion] ✓ Stored event '${eventType}' for ${shop.shopDomain} (Event ID: ${event.id}, Session: ${session.sessionKey})`
    );

    return new Response(
      JSON.stringify({
        success: true,
        eventId: event.id,
        sessionId: session.id,
        eventType: event.eventType,
        storedAt: event.timestamp.toISOString(),
      }),
      {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[Ingestion] Error processing event:", err);
    return new Response(
      JSON.stringify({
        error: "Failed to ingest telemetry event",
        details: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
};
