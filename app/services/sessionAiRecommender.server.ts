// Session AI Recommendation Engine
// Generates contextual, actionable AI recommendations and flagging verdicts for traffic sessions using Groq LLM with heuristic resilience.

import type { TrafficSession } from "@prisma/client";

export type RiskLevel = "Likely Human" | "Suspicious" | "Likely Automated";

export function getRiskLevel(score: number): RiskLevel {
  if (score > 80) return "Likely Automated";
  if (score >= 50) return "Suspicious";
  return "Likely Human";
}

export interface SessionAiRecommendationOutput {
  isFlagged: boolean;
  flaggedReason: string | null;
  aiRecommendation: string;
  recommendedActionType: "FLAG" | "MONITOR" | "CHALLENGE" | "BLOCK" | "ALLOW";
  aiExplanation: string;
  riskLevel: RiskLevel;
}

export interface SessionAnalyticsInput {
  session: Pick<
    TrafficSession,
    | "id"
    | "requestCount"
    | "pageViews"
    | "addToCartCount"
    | "checkoutStarted"
    | "browser"
    | "deviceType"
    | "os"
    | "country"
    | "utmSource"
    | "utmCampaign"
    | "landingPage"
    | "exitPage"
  >;
  riskScore: number;
  trafficType: string;
  severity: string;
  reasons?: string[];
  signals?: Array<{ name: string; value: number | string; weight?: number; severity?: string }>;
  shopMode?: string;
  durationSec?: number;
}

/**
 * Calls Groq API to generate an intelligent, context-aware merchant recommendation grounded in session analytics.
 */
export async function fetchGroqRecommendation(
  input: SessionAnalyticsInput
): Promise<{ recommendation: string; explanation?: string } | null> {
  const apiKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const {
    session,
    riskScore,
    trafficType,
    severity,
    reasons = [],
    signals = [],
    shopMode = "CHALLENGE",
    durationSec = 15,
  } = input;

  const riskLevel = getRiskLevel(riskScore);
  const normalizedMode = (shopMode || "CHALLENGE").toUpperCase() === "BLOCK" ? "BLOCK" : "CHALLENGE";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);

  const models = [
    process.env.GROQ_MODEL || "openai/gpt-oss-20b",
    "openai/gpt-oss-120b",
  ];

  for (const model of models) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          response_format: { type: "json_object" },
          temperature: 0.15,
          messages: [
            {
              role: "system",
              content: `You are Traffiq's AI Traffic Intelligence & Fraud Security Analyst for Shopify merchants.
Analyze the provided storefront visitor analytics and return a JSON object with:
{
  "recommendation": "A concise, highly actionable 2-3 sentence recommendation for the merchant on what action to take (e.g. observe, exclude traffic source from ad campaigns, arm checkout validation, or block).",
  "explanation": "A 1-2 sentence factual explanation of the browsing pattern based strictly on the provided analytics."
}

CRITICAL RULES:
1. Ground every sentence strictly in the provided metrics. Never invent metrics.
2. Mode configuration: Store is in ${normalizedMode} mode. Continuous AI Monitoring is ALWAYS active in both modes.
3. Risk Levels:
   - "Likely Human" (Risk < 50): Validate normal shopper interaction and recommend standard observation with zero friction.
   - "Suspicious" (Risk 50-80): Note that Traffiq flags this traffic for monitoring without blocking, allowing checkout to preserve genuine sales while recommending observation and ad audience audit.
   - "Likely Automated" (Risk > 80): Recommend the active enforcement (${normalizedMode === "BLOCK" ? "Block at checkout validation" : "Verification challenge at checkout"}), protecting inventory and blocking bot checkouts.
4. Keep the recommendation concise, professional, and directly actionable for a store owner.`,
            },
            {
              role: "user",
              content: JSON.stringify({
                sessionId: session.id,
                riskScore,
                riskLevel,
                trafficType,
                severity,
                activeMode: normalizedMode,
                metrics: {
                  requestCount: session.requestCount,
                  pageViews: session.pageViews,
                  addToCartCount: session.addToCartCount,
                  checkoutStarted: session.checkoutStarted,
                  durationSec,
                  browser: session.browser || "Unknown",
                  deviceType: session.deviceType || "Desktop",
                  operatingSystem: session.os || "Unknown",
                  country: session.country || "Unknown",
                  trafficSource: session.utmSource || "Direct",
                  campaign: session.utmCampaign || "None",
                  landingPage: session.landingPage || "/",
                  exitPage: session.exitPage || "/",
                },
                detectionReasons: reasons,
                detectionSignals: signals.slice(0, 5),
              }),
            },
          ],
        }),
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const json = await response.json();
        const content = json.choices?.[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content);
          if (parsed.recommendation && typeof parsed.recommendation === "string") {
            return {
              recommendation: parsed.recommendation.trim(),
              explanation: parsed.explanation?.trim(),
            };
          }
        }
      }
    } catch {
      // Try next model or fall back to heuristic generator
    }
  }

  clearTimeout(timeoutId);
  return null;
}

/**
 * Generates an instant, highly detailed analytics-based recommendation when Groq is unavailable or for fast synchronous execution.
 */
export function generateHeuristicRecommendation(
  input: SessionAnalyticsInput
): SessionAiRecommendationOutput {
  const { session, riskScore, trafficType, severity, reasons = [], shopMode = "CHALLENGE" } = input;
  const normalizedMode = (shopMode || "CHALLENGE").toUpperCase() === "BLOCK" ? "BLOCK" : "CHALLENGE";
  const riskLevel = getRiskLevel(riskScore);

  // 1. Likely Human (Risk < 50)
  if (riskLevel === "Likely Human") {
    return {
      isFlagged: false,
      flaggedReason: null,
      recommendedActionType: "ALLOW",
      riskLevel,
      aiRecommendation:
        `Verified genuine shopper pattern (Risk ${riskScore}/100, ${session.pageViews} page views over standard dwell time). Allow full storefront access with ongoing background monitoring.`,
      aiExplanation:
        "Browsing trajectory exhibits natural human dwell intervals, legitimate client environment characteristics, and valid storefront navigation.",
    };
  }

  // 2. Extract behavioral characteristics
  const reasonText = reasons.join(" ").toLowerCase();
  const isBurst =
    reasonText.includes("frequency") ||
    reasonText.includes("burst") ||
    reasonText.includes("velocity") ||
    session.requestCount > 10;
  const isHeadlessOrBot =
    reasonText.includes("headless") ||
    reasonText.includes("automation") ||
    reasonText.includes("webdriver") ||
    (session.browser || "").toLowerCase().includes("headless") ||
    trafficType.toUpperCase() === "BOT";
  const isCatalogScrape =
    reasonText.includes("catalog") ||
    reasonText.includes("traversal") ||
    reasonText.includes("crawler");
  const isCheckoutAbuse =
    session.addToCartCount > 0 &&
    (reasonText.includes("cart") || reasonText.includes("checkout") || reasonText.includes("dwell"));
  const isAdClickFraud =
    Boolean(session.utmSource && session.utmSource !== "Direct") &&
    (reasonText.includes("campaign") || reasonText.includes("bounce") || reasonText.includes("dwell"));

  const primaryFlagReason =
    reasons[0] ||
    (isBurst
      ? "Abnormally high request frequency exceeding human baseline."
      : isHeadlessOrBot
      ? "Automated headless browser environment signature detected."
      : isCatalogScrape
      ? "Rapid sequential product catalog indexing pattern."
      : isCheckoutAbuse
      ? "Rapid-fire cart manipulation without product dwell."
      : isAdClickFraud
      ? `Anomalous ad click traffic pattern from ${session.utmSource}.`
      : "Anomalous browsing behavior and low dwell time detected.");

  // 3. Suspicious Traffic (Risk 50 - 80) -> ALWAYS FLAGGED, NEVER BLOCKED
  if (riskLevel === "Suspicious") {
    let aiRecommendation: string;
    if (isAdClickFraud) {
      aiRecommendation =
        `Flagged suspicious visit from ${session.utmSource || "ad source"} (Risk ${riskScore}/100). In ${normalizedMode} mode, visitor is allowed without blocking to safeguard conversions; recommend auditing campaign spend and excluding non-converting audience segments.`;
    } else if (isBurst) {
      aiRecommendation =
        `Flagged for elevated request velocity (${session.requestCount} requests, Risk ${riskScore}/100). Session is observed under continuous monitoring without blocking; keep under observation for potential automated cart activity.`;
    } else if (isHeadlessOrBot) {
      aiRecommendation =
        `Flagged automated browser fingerprint (Risk ${riskScore}/100). Monitored without blocking storefront access; recommend tracking session conversion and auditing referral source.`;
    } else if (isCatalogScrape) {
      aiRecommendation =
        `Flagged for rapid catalog browsing (Risk ${riskScore}/100). Monitored safely without blocking customers; recommend checking if traffic originates from a verified search crawler.`;
    } else {
      aiRecommendation =
        `Flagged as suspicious activity (Risk ${riskScore}/100, ${severity} severity). Monitored continuously under active ${normalizedMode} mode; visitor is allowed without disruption while behavioral telemetry is recorded.`;
    }

    return {
      isFlagged: true,
      flaggedReason: primaryFlagReason,
      recommendedActionType: "FLAG",
      riskLevel,
      aiRecommendation,
      aiExplanation: `Session flagged for ${primaryFlagReason.toLowerCase()} Monitored continuously; storefront visitor is allowed without blocking to protect genuine sales.`,
    };
  }

  // 4. Likely Automated (Risk > 80) -> Enforce Active Mode (BLOCK or CHALLENGE)
  if (normalizedMode === "BLOCK") {
    return {
      isFlagged: true,
      flaggedReason: primaryFlagReason,
      recommendedActionType: "BLOCK",
      riskLevel,
      aiRecommendation:
        `High-confidence automated threat (Risk ${riskScore}/100, ${trafficType}). Armed for checkout blocking via Shopify Functions to protect store inventory and eliminate spam checkouts.`,
      aiExplanation: `Active BLOCK mode: Session flagged for ${primaryFlagReason.toLowerCase()} High-risk automated bot targeted for checkout blocking.`,
    };
  }

  return {
    isFlagged: true,
    flaggedReason: primaryFlagReason,
    recommendedActionType: "CHALLENGE",
    riskLevel,
    aiRecommendation:
      `High-confidence automated bot activity (Risk ${riskScore}/100). Present verification challenge at checkout to verify human intent before order completion.`,
    aiExplanation: `Active CHALLENGE mode: Session flagged for ${primaryFlagReason.toLowerCase()} Verification challenge required at checkout.`,
  };
}

/**
 * Unified generation entry point: tries Groq LLM first, falling back smoothly to the rich heuristic recommendation.
 */
export async function generateSessionAiRecommendationWithGroq(
  input: SessionAnalyticsInput
): Promise<SessionAiRecommendationOutput> {
  const heuristic = generateHeuristicRecommendation(input);

  try {
    const groq = await fetchGroqRecommendation(input);
    if (groq?.recommendation) {
      return {
        ...heuristic,
        aiRecommendation: groq.recommendation,
        aiExplanation: groq.explanation || heuristic.aiExplanation,
      };
    }
  } catch (err) {
    console.warn("[sessionAiRecommender] Groq generation fallback to heuristic:", err);
  }

  return heuristic;
}

export function generateSessionAiRecommendation(
  input: SessionAnalyticsInput
): SessionAiRecommendationOutput {
  return generateHeuristicRecommendation(input);
}
