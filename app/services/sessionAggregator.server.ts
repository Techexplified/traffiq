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

export function getCountryFlagEmoji(countryName: string): string {
  const flags: Record<string, string> = {
    "United States": "🇺🇸",
    "Canada": "🇨🇦",
    "United Kingdom": "🇬🇧",
    "Germany": "🇩🇪",
    "France": "🇫🇷",
    "India": "🇮🇳",
    "Australia": "🇦🇺",
    "Japan": "🇯🇵",
    "Brazil": "🇧🇷",
    "Netherlands": "🇳🇱",
  };
  return flags[countryName] || "🌐";
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
  const country = payload.country || "United States";
  const countryFlag = getCountryFlagEmoji(country);
  const utmSource = payload.utm?.source || (payload.referrer && !payload.referrer.includes(payload.shopDomain || "") ? "Referral" : "Direct");
  const cost = payload.totalCost ? Number(payload.totalCost) : 0;

  if (!session) {
    // Check if this visitor/sessionKey was previously manually blocked by merchant
    const wasManuallyBlocked = await prisma.protectionAction.findFirst({
      where: {
        shopId,
        action: "BLOCK",
        status: "EXECUTED",
        OR: [
          { session: { sessionKey } },
          { metadata: { contains: sessionKey } },
        ],
      },
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
        pageViews: payload.eventType === "page_viewed" ? 1 : 0,
        requestCount: 1,
        productViews: payload.eventType === "product_viewed" ? 1 : 0,
        searches: payload.eventType === "search_submitted" ? 1 : 0,
        addToCartCount: payload.eventType === "product_added_to_cart" ? 1 : 0,
        checkoutStarted: payload.eventType === "checkout_started",
        purchaseCompleted: payload.eventType === "purchase",
        totalSpend: cost,
        riskScore: wasManuallyBlocked ? 99 : 0,
        trafficType: wasManuallyBlocked ? "BOT" : "HUMAN",
        severity: wasManuallyBlocked ? "CRITICAL" : "LOW",
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
    // Update existing TrafficSession
    session = await prisma.trafficSession.update({
      where: { id: session.id },
      data: {
        lastSeenAt: eventTime,
        exitPage: payload.page || session.exitPage,
        requestCount: { increment: 1 },
        pageViews: payload.eventType === "page_viewed" ? { increment: 1 } : undefined,
        productViews: payload.eventType === "product_viewed" ? { increment: 1 } : undefined,
        searches: payload.eventType === "search_submitted" ? { increment: 1 } : undefined,
        addToCartCount: payload.eventType === "product_added_to_cart" ? { increment: 1 } : undefined,
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

  return { event, session };
}

export class SessionAggregator {
  static processIngestionEvent = processIngestionEvent;
  static parseDeviceFromUserAgent = parseDeviceFromUserAgent;
  static getCountryFlagEmoji = getCountryFlagEmoji;
}
