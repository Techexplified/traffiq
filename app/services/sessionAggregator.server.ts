import prisma from "../db.server";
import type { TrafficSession, TrafficEvent } from "@prisma/client";
import { evaluateSessionRisk } from "./detectionEngine.server";
import { ProtectionEngine } from "./protectionEngine.server";
import { AnalyticsService } from "./analytics.server";

// Throttled background retention cleanup (at most once every 6 hours per shop)
const lastRetentionPruneMap = new Map<string, number>();
const RETENTION_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export function triggerBackgroundRetentionCleanup(shopId: string) {
  const now = Date.now();
  const lastPrune = lastRetentionPruneMap.get(shopId) || 0;
  if (now - lastPrune > RETENTION_PRUNE_INTERVAL_MS) {
    lastRetentionPruneMap.set(shopId, now);
    // Execute asynchronously in background, non-blocking
    AnalyticsService.enforceDataRetention(shopId).catch((err) => {
      console.error(`[RetentionPrune] Background cleanup failed for shop ${shopId}:`, err);
    });
  }
}

export const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes inactivity timeout

export interface IngestionEventPayload {
  eventId: string;
  eventType: string;
  timestamp?: string | number;
  clientId?: string;
  sessionId?: string;
  page?: string;
  referrer?: string;
  productId?: string;
  variantId?: string;
  quantity?: number | string;
  totalCost?: number | string;
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
  };
  metadata?: Record<string, unknown>;
  shopDomain?: string;
  userAgent?: string;
  clientIp?: string;
  country?: string;
  city?: string;
  region?: string;
  timezone?: string;
  locale?: string;
}

export function parseDeviceFromUserAgent(ua: string): {
  deviceType: string;
  browser: string;
  os: string;
} {
  if (!ua) {
    return { deviceType: "Desktop", browser: "Chrome", os: "Unknown" };
  }

  const uaLower = ua.toLowerCase();

  // Device Type
  let deviceType = "Desktop";
  if (uaLower.includes("mobile") || uaLower.includes("iphone") || uaLower.includes("android")) {
    deviceType = "Mobile";
  } else if (uaLower.includes("ipad") || uaLower.includes("tablet")) {
    deviceType = "Tablet";
  }

  // Browser
  let browser = "Chrome";
  if (uaLower.includes("firefox")) {
    browser = "Firefox";
  } else if (uaLower.includes("safari") && !uaLower.includes("chrome")) {
    browser = "Safari";
  } else if (uaLower.includes("edg")) {
    browser = "Edge";
  } else if (uaLower.includes("opera") || uaLower.includes("opr")) {
    browser = "Opera";
  }

  // OS
  let os = "Unknown";
  if (uaLower.includes("windows")) {
    os = "Windows";
  } else if (uaLower.includes("mac os") || uaLower.includes("macintosh")) {
    os = "macOS";
  } else if (uaLower.includes("android")) {
    os = "Android";
  } else if (uaLower.includes("iphone") || uaLower.includes("ipad") || uaLower.includes("ios")) {
    os = "iOS";
  } else if (uaLower.includes("linux")) {
    os = "Linux";
  }

  return { deviceType, browser, os };
}

export interface ResolvedCountry {
  country: string;
  countryFlag: string;
  countryCode: string;
}

export const ISO_COUNTRY_MAP: Record<string, { name: string; flag: string }> = {
  IN: { name: "India", flag: "🇮🇳" },
  US: { name: "United States", flag: "🇺🇸" },
  GB: { name: "United Kingdom", flag: "🇬🇧" },
  UK: { name: "United Kingdom", flag: "🇬🇧" },
  CA: { name: "Canada", flag: "🇨🇦" },
  AU: { name: "Australia", flag: "🇦🇺" },
  DE: { name: "Germany", flag: "🇩🇪" },
  FR: { name: "France", flag: "🇫🇷" },
  NL: { name: "Netherlands", flag: "🇳🇱" },
  JP: { name: "Japan", flag: "🇯🇵" },
  SG: { name: "Singapore", flag: "🇸🇬" },
  BR: { name: "Brazil", flag: "🇧🇷" },
  AE: { name: "United Arab Emirates", flag: "🇦🇪" },
  SA: { name: "Saudi Arabia", flag: "🇸🇦" },
  PK: { name: "Pakistan", flag: "🇵🇰" },
  BD: { name: "Bangladesh", flag: "🇧🇩" },
  ID: { name: "Indonesia", flag: "🇮🇩" },
  MY: { name: "Malaysia", flag: "🇲🇾" },
  PH: { name: "Philippines", flag: "🇵🇭" },
  VN: { name: "Vietnam", flag: "🇻🇳" },
  TH: { name: "Thailand", flag: "🇹🇭" },
  NZ: { name: "New Zealand", flag: "🇳🇿" },
  IT: { name: "Italy", flag: "🇮🇹" },
  ES: { name: "Spain", flag: "🇪🇸" },
  CH: { name: "Switzerland", flag: "🇨🇭" },
  SE: { name: "Sweden", flag: "🇸🇪" },
  NO: { name: "Norway", flag: "🇳🇴" },
  DK: { name: "Denmark", flag: "🇩🇰" },
  FI: { name: "Finland", flag: "🇫🇮" },
  IE: { name: "Ireland", flag: "🇮🇪" },
  PL: { name: "Poland", flag: "🇵🇱" },
  ZA: { name: "South Africa", flag: "🇿🇦" },
  MX: { name: "Mexico", flag: "🇲🇽" },
  RU: { name: "Russia", flag: "🇷🇺" },
  CN: { name: "China", flag: "🇨🇳" },
  HK: { name: "Hong Kong", flag: "🇭🇰" },
  KR: { name: "South Korea", flag: "🇰🇷" },
  TW: { name: "Taiwan", flag: "🇹🇼" },
  TR: { name: "Turkey", flag: "🇹🇷" },
  IL: { name: "Israel", flag: "🇮🇱" },
  EG: { name: "Egypt", flag: "🇪🇬" },
  NG: { name: "Nigeria", flag: "🇳🇬" },
  KE: { name: "Kenya", flag: "🇰🇪" },
  AR: { name: "Argentina", flag: "🇦🇷" },
  CL: { name: "Chile", flag: "🇨🇱" },
  CO: { name: "Colombia", flag: "🇨🇴" },
};

const TIMEZONE_COUNTRY_MAP: Record<string, string> = {
  "Asia/Kolkata": "IN",
  "Asia/Calcutta": "IN",
  "Asia/Delhi": "IN",
  "Asia/Karachi": "PK",
  "Asia/Dhaka": "BD",
  "Asia/Dubai": "AE",
  "Asia/Riyadh": "SA",
  "Asia/Singapore": "SG",
  "Asia/Tokyo": "JP",
  "Asia/Seoul": "KR",
  "Asia/Shanghai": "CN",
  "Asia/Hong_Kong": "HK",
  "Asia/Taipei": "TW",
  "Asia/Bangkok": "TH",
  "Asia/Jakarta": "ID",
  "Asia/Kuala_Lumpur": "MY",
  "Asia/Manila": "PH",
  "Europe/London": "GB",
  "Europe/Dublin": "IE",
  "Europe/Paris": "FR",
  "Europe/Berlin": "DE",
  "Europe/Rome": "IT",
  "Europe/Madrid": "ES",
  "Europe/Amsterdam": "NL",
  "Europe/Brussels": "BE",
  "Europe/Stockholm": "SE",
  "Europe/Oslo": "NO",
  "Europe/Copenhagen": "DK",
  "Europe/Helsinki": "FI",
  "Europe/Warsaw": "PL",
  "Europe/Zurich": "CH",
  "Europe/Vienna": "AT",
  "Australia/Sydney": "AU",
  "Australia/Melbourne": "AU",
  "Australia/Brisbane": "AU",
  "Australia/Perth": "AU",
  "Pacific/Auckland": "NZ",
  "America/New_York": "US",
  "America/Chicago": "US",
  "America/Denver": "US",
  "America/Los_Angeles": "US",
  "America/Phoenix": "US",
  "America/Detroit": "US",
  "America/Indiana/Indianapolis": "US",
  "America/Toronto": "CA",
  "America/Vancouver": "CA",
  "America/Montreal": "CA",
  "America/Sao_Paulo": "BR",
  "America/Mexico_City": "MX",
  "America/Bogota": "CO",
  "America/Buenos_Aires": "AR",
  "America/Santiago": "CL",
  "Africa/Johannesburg": "ZA",
  "Africa/Cairo": "EG",
  "Africa/Lagos": "NG",
  "Africa/Nairobi": "KE",
};

export function resolveCountryAndFlag(options?: {
  rawCountry?: string;
  timezone?: string;
  locale?: string;
}): ResolvedCountry {
  const raw = (options?.rawCountry || "").trim();
  const upper = raw.toUpperCase();

  // 1. Direct match on 2-letter ISO code
  if (upper && ISO_COUNTRY_MAP[upper]) {
    const entry = ISO_COUNTRY_MAP[upper];
    return { country: entry.name, countryFlag: entry.flag, countryCode: upper };
  }

  // 2. Check if raw string matches any country full name
  if (raw) {
    for (const [code, entry] of Object.entries(ISO_COUNTRY_MAP)) {
      if (entry.name.toLowerCase() === raw.toLowerCase()) {
        return { country: entry.name, countryFlag: entry.flag, countryCode: code };
      }
    }
  }

  // 3. Fallback: check timezone
  if (options?.timezone && typeof options.timezone === "string") {
    const tzKey = options.timezone.trim();
    if (tzKey.startsWith("Asia/Kolkata") || tzKey.startsWith("Asia/Calcutta")) {
      return { country: "India", countryFlag: "🇮🇳", countryCode: "IN" };
    }
    const tzCode = TIMEZONE_COUNTRY_MAP[tzKey];
    if (tzCode && ISO_COUNTRY_MAP[tzCode]) {
      const entry = ISO_COUNTRY_MAP[tzCode];
      return { country: entry.name, countryFlag: entry.flag, countryCode: tzCode };
    }
  }

  // 4. Fallback: check locale (e.g. "en-IN", "hi-IN", "en-US")
  if (options?.locale && typeof options.locale === "string") {
    const match = options.locale.match(/[-_]([A-Za-z]{2})\b/);
    if (match && match[1]) {
      const locCode = match[1].toUpperCase();
      if (ISO_COUNTRY_MAP[locCode]) {
        const entry = ISO_COUNTRY_MAP[locCode];
        return { country: entry.name, countryFlag: entry.flag, countryCode: locCode };
      }
    }
  }

  // 5. If raw was provided but not in map, return it cleanly
  if (raw && raw !== "Unknown" && raw !== "United States") {
    return { country: raw, countryFlag: "🌐", countryCode: upper.slice(0, 2) || "XX" };
  }

  return { country: "Unknown", countryFlag: "🌐", countryCode: "XX" };
}

export function getCountryFlagEmoji(countryName: string): string {
  const resolved = resolveCountryAndFlag({ rawCountry: countryName });
  return resolved.countryFlag;
}

export async function processIngestionEvent(
  payload: IngestionEventPayload,
  shopId: string,
  timeoutMs: number = DEFAULT_SESSION_TIMEOUT_MS,
  skipDetection: boolean = false
): Promise<{ event: TrafficEvent; session: TrafficSession }> {
  const eventTime = payload.timestamp
    ? new Date(typeof payload.timestamp === "number" ? payload.timestamp : Date.parse(String(payload.timestamp)))
    : new Date();

  // 1. Deduplicate by eventId if provided
  if (payload.eventId) {
    const existing = await prisma.trafficEvent.findUnique({
      where: { id: payload.eventId },
      include: { session: true },
    });
    if (existing) {
      return { event: existing, session: existing.session };
    }
  }

  // 2. Identify sessionKey (client ID or IP+UA fingerprint fallback)
  const sessionKey =
    payload.clientId ||
    payload.sessionId ||
    `anon_${(payload.clientIp || "127.0.0.1").replace(/[^a-zA-Z0-9]/g, "_")}`;

  // 3. Locate active session within configurable inactivity window
  const cutoff = new Date(eventTime.getTime() - timeoutMs);
  let session = await prisma.trafficSession.findFirst({
    where: {
      shopId,
      sessionKey,
      lastSeenAt: { gte: cutoff },
    },
    orderBy: { lastSeenAt: "desc" },
  });

  const parsedUa = parseDeviceFromUserAgent(payload.userAgent || "");
  const resolvedCountry = resolveCountryAndFlag({
    rawCountry: payload.country,
    timezone: payload.timezone || (payload.metadata as any)?.timezone,
    locale: payload.locale || (payload.metadata as any)?.locale || (payload.metadata as any)?.language,
  });
  const country = resolvedCountry.country;
  const countryFlag = resolvedCountry.countryFlag;
  const utmSource = payload.utm?.source || (payload.referrer && !payload.referrer.includes(payload.shopDomain || "") ? "Referral" : "Direct");
  const cost = payload.totalCost ? Number(payload.totalCost) : 0;

  const isAddToCart = payload.eventType === "product_added_to_cart";
  const addedQuantity = isAddToCart ? Math.max(1, Number(payload.quantity || (payload.metadata as any)?.quantity || 1)) : 0;

  const isPageViewCandidate =
    payload.eventType === "page_viewed" ||
    payload.eventType === "collection_viewed" ||
    payload.eventType === "product_viewed" ||
    payload.eventType === "cart_viewed";

  if (!session) {
    // Check if this visitor/sessionKey was previously manually blocked by merchant
    const wasManuallyBlocked = await prisma.protectionAction.findFirst({
      where: {
        action: "BLOCK",
        status: "EXECUTED",
        OR: [
          { session: { sessionKey } },
          { metadata: { contains: sessionKey } },
        ],
      },
      orderBy: { createdAt: "desc" },
    });

    // Start new TrafficSession
    session = await prisma.trafficSession.create({
      data: {
        shopId,
        sessionKey,
        startedAt: eventTime,
        lastSeenAt: eventTime,
        country,
        countryFlag,
        region: payload.region,
        city: payload.city,
        deviceType: parsedUa.deviceType,
        browser: parsedUa.browser,
        os: parsedUa.os,
        landingPage: payload.page || "/",
        exitPage: payload.page || "/",
        referrer: payload.referrer || "",
        utmSource,
        utmMedium: payload.utm?.medium,
        utmCampaign: payload.utm?.campaign,
        pageViews: isPageViewCandidate ? 1 : 0,
        requestCount: 1,
        productViews: payload.eventType === "product_viewed" ? 1 : 0,
        searches: payload.eventType === "search_submitted" ? 1 : 0,
        addToCartCount: addedQuantity,
        checkoutStarted: payload.eventType === "checkout_started",
        purchaseCompleted: payload.eventType === "purchase",
        totalSpend: cost,
        riskScore: 0,
        trafficType: "HUMAN",
        severity: "LOW",
        isFlagged: Boolean(wasManuallyBlocked),
        flaggedReason: wasManuallyBlocked ? "Manually blocked by merchant" : null,
        aiRecommendation: wasManuallyBlocked
          ? "Session manually blocked by merchant. Block active on storefront and checkout."
          : null,
      },
    });

    // Run debounced background retention cleanup check
    triggerBackgroundRetentionCleanup(shopId);
  } else {
    // Determine whether this page view should increment pageViews
    // (avoid double-counting when page_viewed and product_viewed or collection_viewed fire simultaneously on the same page)
    let shouldIncrementPageView = false;
    if (isPageViewCandidate) {
      const threeSecondsAgo = new Date(eventTime.getTime() - 3000);
      const recentPageEvent = await prisma.trafficEvent.findFirst({
        where: {
          sessionId: session.id,
          eventType: { in: ["page_viewed", "collection_viewed", "product_viewed", "cart_viewed"] },
          pageUrl: payload.page || "/",
          timestamp: { gte: threeSecondsAgo },
        },
      });
      if (!recentPageEvent) {
        shouldIncrementPageView = true;
      }
    }

    // Update existing TrafficSession
    session = await prisma.trafficSession.update({
      where: { id: session.id },
      data: {
        lastSeenAt: eventTime,
        exitPage: payload.page || session.exitPage,
        requestCount: { increment: 1 },
        pageViews: shouldIncrementPageView ? { increment: 1 } : undefined,
        productViews: payload.eventType === "product_viewed" ? { increment: 1 } : undefined,
        searches: payload.eventType === "search_submitted" ? { increment: 1 } : undefined,
        addToCartCount: isAddToCart ? { increment: addedQuantity } : undefined,
        checkoutStarted: payload.eventType === "checkout_started" ? true : session.checkoutStarted,
        purchaseCompleted: payload.eventType === "purchase" ? true : session.purchaseCompleted,
        totalSpend: cost > 0 ? { increment: cost } : undefined,
      },
    });
  }

  // 4. Record raw TrafficEvent in database
  const event = await prisma.trafficEvent.create({
    data: {
      id: payload.eventId || undefined,
      shopId,
      sessionId: session.id,
      eventType: payload.eventType,
      timestamp: eventTime,
      pageUrl: payload.page || "/",
      productId: payload.productId,
      variantId: payload.variantId,
      referrer: payload.referrer,
      utmSource: payload.utm?.source,
      utmMedium: payload.utm?.medium,
      utmCampaign: payload.utm?.campaign,
      metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
    },
  });

  // 5. Evaluate risk & AI recommendations with Detection Engine
  if (!skipDetection) {
    try {
      const scored = await evaluateSessionRisk(session, event, payload);
      const reloadedSession = await prisma.trafficSession.findUnique({
        where: { id: session.id },
      });
      if (reloadedSession) {
        session = reloadedSession;
      }

      await ProtectionEngine.evaluateAndEnforceProtection(session, scored.riskScore);
    } catch (err) {
      console.error("Detection/Protection engine error:", err);
    }
  }

  // 6. Invalidate analytics & investigation session caches so live visits appear immediately
  try {
    AnalyticsService.invalidateSessionCache(shopId, session.id);
  } catch (err) {
    console.error("[SessionAggregator] Cache invalidation error:", err);
  }

  return { event, session };
}

export class SessionAggregator {
  static processIngestionEvent = processIngestionEvent;
  static parseDeviceFromUserAgent = parseDeviceFromUserAgent;
  static getCountryFlagEmoji = getCountryFlagEmoji;
}
