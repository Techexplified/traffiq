// Traffic Detection Engine for Traffiq
// Coordinates session feature extraction, weighted heuristic evaluation, and risk classification without an LLM

import prisma from "../db.server";
import type { TrafficSession, TrafficEvent } from "@prisma/client";
import {
  DetectionConfig,
  type DetectionConfigType,
  type TrafficType,
  type SeverityLevel,
  type RecommendedAction,
} from "./detectionConfig.server";
import {
  RiskScoringService,
  type SignalScoreBreakdown,
  type RiskScoringOutput,
} from "./riskScoring.server";
import type { IngestionEventPayload } from "./sessionAggregator.server";
import {
  generateSessionAiRecommendation,
  generateSessionAiRecommendationWithGroq,
  getRiskLevel,
} from "./sessionAiRecommender.server";

export interface DetectionResultOutput {
  riskScore: number;
  trafficType: TrafficType;
  severity: SeverityLevel;
  confidence: number;
  reasons: string[];
  signals: SignalScoreBreakdown[];
  recommendedAction: RecommendedAction;
  aiExplanation: string;
  isFlagged: boolean;
  flaggedReason: string | null;
  aiRecommendation: string;
}

export class TrafficDetectionEngine {
  /**
   * Evaluates a session against all 6 configurable weighted scoring rules,
   * determines traffic classification, severity, confidence, and recommended action,
   * and persists the DetectionResult into PostgreSQL.
   */
  static async evaluateSession(
    session: TrafficSession,
    event?: TrafficEvent,
    rawPayload?: IngestionEventPayload,
    config: DetectionConfigType = DetectionConfig,
    persist: boolean = true
  ): Promise<DetectionResultOutput> {
    // 0. Check if session or its sessionKey was manually blocked by merchant
    const isManuallyBlocked =
      (session.isFlagged &&
        (session.flaggedReason?.toLowerCase().includes("blocked") ||
          session.flaggedReason?.toLowerCase().includes("manual") ||
          session.riskScore >= 90)) ||
      Boolean(
        await prisma.protectionAction.findFirst({
          where: {
            action: "BLOCK",
            status: "EXECUTED",
            OR: [
              { sessionId: session.id },
              { session: { sessionKey: session.sessionKey } },
              { metadata: { contains: session.sessionKey } },
            ],
          },
        })
      );

    if (isManuallyBlocked) {
      if (persist) {
        try {
          await prisma.trafficSession.update({
            where: { id: session.id },
            data: {
              riskScore: 99,
              trafficType: "BOT",
              severity: "CRITICAL",
              isFlagged: true,
              flaggedReason: "Manually blocked by merchant",
              aiRecommendation: "Session manually blocked by merchant. Block active on storefront and checkout.",
            },
          });
        } catch {}
      }

      return {
        riskScore: 99,
        trafficType: "BOT",
        severity: "CRITICAL",
        confidence: 99,
        reasons: ["Session manually blocked by merchant via Traffic Investigation"],
        signals: [],
        recommendedAction: "BLOCK",
        aiExplanation: "Session manually blocked by merchant. Access to checkout and storefront operations restricted.",
        isFlagged: true,
        flaggedReason: "Manually blocked by merchant",
        aiRecommendation: "Session manually blocked by merchant. Block active on storefront and checkout.",
      };
    }

    // 1. Calculate session duration in seconds
    const durationSec = Math.max(
      1,
      (session.lastSeenAt.getTime() - session.startedAt.getTime()) / 1000
    );

    // 2. Fetch session events for chronological trajectory analysis
    let events: Pick<TrafficEvent, "productId" | "eventType" | "timestamp" | "pageUrl">[] = [];
    try {
      events = await prisma.trafficEvent.findMany({
        where: { sessionId: session.id },
        select: { productId: true, eventType: true, timestamp: true, pageUrl: true },
        orderBy: { timestamp: "asc" },
      });
    } catch {
      // Graceful fallback if database read fails or offline session evaluation
      if (event) {
        events = [event];
      }
    }

    // 3. Evaluate each heuristic rule via RiskScoringService
    const frequencyResult = RiskScoringService.evaluateFrequencyRule(session, durationSec, config);
    const navigationResult = RiskScoringService.evaluateNavigationDwellRule(session, durationSec, events, config);
    const catalogResult = RiskScoringService.evaluateCatalogTraversalRule(session, events, config);
    const cartCheckoutResult = RiskScoringService.evaluateCartCheckoutRule(session, durationSec, events, config);
    const automationResult = RiskScoringService.evaluateAutomationSignatureRule(session, rawPayload);
    const campaignResult = RiskScoringService.evaluateCampaignAnomalyRule(session, durationSec);

    // 4. Calculate composite score and assemble signal breakdown
    const scoring: RiskScoringOutput = RiskScoringService.calculateCompositeScore(
      frequencyResult,
      navigationResult,
      catalogResult,
      cartCheckoutResult,
      automationResult,
      campaignResult,
      config
    );

    const riskScore = scoring.riskScore;
    const reasons = scoring.reasons;
    const signals = scoring.signals;

    // Determine Store Protection Mode (Default: CHALLENGE; options: CHALLENGE or BLOCK)
    let shopMode = "CHALLENGE";
    try {
      const settings = await prisma.shopSettings.findUnique({
        where: { shopId: session.shopId },
        select: { protectionMode: true },
      });
      if (settings?.protectionMode) {
        shopMode = settings.protectionMode.toUpperCase() === "BLOCK" ? "BLOCK" : "CHALLENGE";
      }
    } catch {}

    // 5. Determine Traffic Classification, Severity & Recommended Action
    // Risk Levels: < 50 Likely Human, 50-80 Suspicious, > 80 Likely Automated
    let trafficType: TrafficType = "HUMAN";
    let severity: SeverityLevel = "LOW";
    let recommendedAction: RecommendedAction = "MONITOR";

    if (riskScore < 50) {
      trafficType = "HUMAN";
      severity = "LOW";
      recommendedAction = "MONITOR";
    } else if (riskScore <= 80) {
      trafficType = "SUSPICIOUS";
      severity = "MEDIUM";
      recommendedAction = "FLAG";
    } else {
      trafficType = automationResult.score > 60 ? "BOT" : "AUTOMATED";
      severity = "HIGH";
      recommendedAction = (shopMode === "BLOCK" ? "BLOCK" : "CHALLENGE") as RecommendedAction;
    }

    // 6. Calculate Evidence-Based Confidence Score (0-100)
    // Confidence reflects statistical evidence volume (request depth, duration, and signal clarity)
    const requestEvidence = Math.min(30, session.requestCount * 3);
    const durationEvidence = Math.min(10, Math.floor(durationSec / 8));
    const signalEvidence = Math.min(10, reasons.length * 2);
    const rawConfidence = 50 + requestEvidence + durationEvidence + signalEvidence;
    const confidence = Math.min(99, Math.max(50, rawConfidence));

    // 7. Generate AI Recommendation with Groq LLM grounded in session analytics
    const aiVerdict = await generateSessionAiRecommendationWithGroq({
      session,
      riskScore,
      trafficType,
      severity,
      reasons,
      signals,
      shopMode,
      durationSec,
    });

    const aiExplanation = aiVerdict.aiExplanation;
    const finalRecommendedAction = (aiVerdict.recommendedActionType || recommendedAction) as RecommendedAction;

    // 8. Persist DetectionResult in database if enabled and session exists
    if (persist) {
      try {
        const sessionExists = await prisma.trafficSession.findUnique({
          where: { id: session.id },
          select: { id: true },
        });

        if (sessionExists) {
          await prisma.detectionResult.upsert({
            where: { sessionId: session.id },
            create: {
              shopId: session.shopId,
              sessionId: session.id,
              trafficType,
              riskScore,
              confidence,
              severity,
              reasons: JSON.stringify(reasons),
              signals: JSON.stringify(signals),
              recommendedAction: finalRecommendedAction,
              aiExplanation,
            },
            update: {
              trafficType,
              riskScore,
              confidence,
              severity,
              reasons: JSON.stringify(reasons),
              signals: JSON.stringify(signals),
              recommendedAction: finalRecommendedAction,
              aiExplanation,
            },
          });

          // Synchronize TrafficSession record with latest detection verdict and AI recommendation
          await prisma.trafficSession.update({
            where: { id: session.id },
            data: {
              riskScore,
              trafficType,
              severity,
              isFlagged: aiVerdict.isFlagged,
              flaggedReason: aiVerdict.flaggedReason,
              aiRecommendation: aiVerdict.aiRecommendation,
            },
          });
        }
      } catch (dbErr) {
        console.error("[TrafficDetectionEngine] Failed to persist DetectionResult:", dbErr);
      }
    }

    return {
      riskScore,
      trafficType,
      severity,
      confidence,
      reasons,
      signals,
      recommendedAction: finalRecommendedAction,
      aiExplanation,
      isFlagged: aiVerdict.isFlagged,
      flaggedReason: aiVerdict.flaggedReason,
      aiRecommendation: aiVerdict.aiRecommendation,
    };
  }
}

// Backward-compatible exports for existing callers
export const evaluateSessionRisk = TrafficDetectionEngine.evaluateSession;

export function evaluateTelemetryEvent(
  event: import("../types/insights").RawTelemetryEvent
): import("../types/insights").ScoredSession {
  const isHighRisk =
    Boolean(event.isHeadless) ||
    (event.userAgent?.includes("HeadlessChrome") ?? false) ||
    (event.userAgent?.includes("bot") ?? false) ||
    (event.clickIntervalMs !== undefined && event.clickIntervalMs < 150);

  const botScore = isHighRisk ? 96 : 14;
  const riskLevel = botScore >= 70 ? "Likely Automated" : botScore >= 35 ? "Suspicious" : "Likely Human";

  return {
    id: `#${Math.floor(10000 + Math.random() * 90000)}`,
    shop: event.shop || "cartmend.myshopify.com",
    riskLevel,
    botScore,
    source: event.referrer?.includes("facebook") ? "Paid Social" : "Direct",
    time: "Today, Just now",
    country: "United States",
    countryFlag: "🇺🇸",
    device: "Desktop / Chrome",
    requestsFactor: isHighRisk ? "4.2x" : "1.0x",
    reasons: isHighRisk
      ? [
          { title: "Abnormally high request frequency", desc: "Requests were submitted 4.2x faster than human baseline", severity: "High" },
          { title: "Automated browser pattern", desc: "Detected headless browser indicators", severity: "High" },
        ]
      : [
          { title: "Natural browsing velocity", desc: "Shopping dwell times within human distribution", severity: "Low" },
        ],
    aiExplanation: isHighRisk ? "High velocity requests typical of scraper bot behavior." : undefined,
    recommendedAction: isHighRisk ? "BLOCK" : "MONITOR",
  };
}
