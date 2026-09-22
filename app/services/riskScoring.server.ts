// Deterministic Risk Scoring Service for Traffiq
// Evaluates 6 configurable weighted heuristic rules without an LLM

import type { TrafficSession, TrafficEvent } from "@prisma/client";
import { DetectionConfig, type DetectionConfigType } from "./detectionConfig.server";
import type { IngestionEventPayload } from "./sessionAggregator.server";

export interface SignalScoreBreakdown {
  name: string;
  value: number; // 0 - 100
  weight: number; // e.g. 0.20
  contribution: number; // value * weight
  description: string;
}

export interface RuleEvaluationResult {
  score: number;
  reasons: string[];
  description: string;
}

export interface RiskScoringOutput {
  riskScore: number; // 0 - 100
  reasons: string[];
  signals: SignalScoreBreakdown[];
}

export class RiskScoringService {
  /**
   * 1. Request / Event Frequency Rule (Weight: 0.20)
   * Analyzes request velocity, requests per minute (RPM), and short-window burst rates.
   */
  static evaluateFrequencyRule(
    session: Pick<TrafficSession, "requestCount">,
    durationSec: number,
    config: DetectionConfigType = DetectionConfig
  ): RuleEvaluationResult {
    const reasons: string[] = [];
    const effectiveSec = Math.max(1, durationSec);
    const rpm = (session.requestCount / effectiveSec) * 60;

    // Extreme burst detection (10+ requests in 2 seconds or less)
    if (session.requestCount >= 10 && effectiveSec <= 2.5) {
      reasons.push("Extreme request burst: 10+ actions executed within 2 seconds");
      return { score: 98, reasons, description: "Extreme burst velocity (> 240 RPM)" };
    }

    // High velocity rules
    if (rpm >= config.heuristics.extremeRPM) {
      reasons.push(`Abnormally high request frequency (${Math.round(rpm)} RPM; 3x faster than human baseline)`);
      return { score: 90, reasons, description: `Extreme velocity (${Math.round(rpm)} RPM)` };
    }

    if (rpm > config.heuristics.humanMaxRPM) {
      reasons.push(`Elevated request velocity (${Math.round(rpm)} RPM; exceeds typical ecommerce browsing pace)`);
      return { score: 65, reasons, description: `Elevated velocity (${Math.round(rpm)} RPM)` };
    }

    if (rpm > 12) {
      return { score: 30, reasons, description: `Moderate browsing velocity (${Math.round(rpm)} RPM)` };
    }

    return { score: 5, reasons, description: `Natural human browsing pace (${Math.round(rpm)} RPM)` };
  }

  /**
   * 2. Navigation & Dwell Time Rule (Weight: 0.15)
   * Analyzes average reading dwell time per page and rapid page-hopping.
   */
  static evaluateNavigationDwellRule(
    session: Pick<TrafficSession, "pageViews">,
    durationSec: number,
    events?: Pick<TrafficEvent, "eventType" | "timestamp" | "pageUrl">[],
    config: DetectionConfigType = DetectionConfig
  ): RuleEvaluationResult {
    const reasons: string[] = [];
    const effectiveSec = Math.max(1, durationSec);
    const pageViews = Math.max(1, session.pageViews);
    const avgDwellSec = effectiveSec / pageViews;

    // Sub-second multi-page hopping
    if (pageViews >= 4 && avgDwellSec < 1.5) {
      reasons.push("Rapid-fire page navigation with sub-1.5s reader dwell times");
      return { score: 92, reasons, description: `Sub-1.5s average dwell time (${avgDwellSec.toFixed(1)}s/page)` };
    }

    if (pageViews >= 3 && avgDwellSec < config.heuristics.scraperMinDwellSeconds) {
      reasons.push(`Abnormally low page dwell time (${avgDwellSec.toFixed(1)}s per page across ${pageViews} pages)`);
      return { score: 75, reasons, description: `Low dwell time (${avgDwellSec.toFixed(1)}s/page)` };
    }

    // Single-page instant bounce
    if (pageViews === 1 && effectiveSec <= config.heuristics.minShortSessionSeconds) {
      reasons.push(`Instant bounce session lasting < ${config.heuristics.minShortSessionSeconds} seconds`);
      return { score: 45, reasons, description: `Instant bounce (< ${config.heuristics.minShortSessionSeconds}s duration)` };
    }

    if (avgDwellSec >= config.heuristics.normalDwellSeconds) {
      return { score: 5, reasons, description: `Healthy reading dwell time (${avgDwellSec.toFixed(1)}s/page)` };
    }

    return { score: 15, reasons, description: `Standard navigation dwell time (${avgDwellSec.toFixed(1)}s/page)` };
  }

  /**
   * 3. Catalog Traversal & Repetition Rule (Weight: 0.15)
   * Analyzes catalog scraping patterns, sequential product crawling, and search floods.
   */
  static evaluateCatalogTraversalRule(
    session: Pick<TrafficSession, "productViews" | "pageViews" | "searches">,
    events?: Pick<TrafficEvent, "productId" | "eventType">[],
    config: DetectionConfigType = DetectionConfig
  ): RuleEvaluationResult {
    const reasons: string[] = [];

    // Search query flood
    if (session.searches >= 8) {
      reasons.push(`Automated search query flood (${session.searches} searches submitted in one session)`);
      return { score: 88, reasons, description: `Search flood (${session.searches} queries)` };
    }

    // Heavy catalog scraping without purchase engagement
    if (session.productViews >= config.heuristics.highCatalogViewCount) {
      reasons.push(`Sequential catalog traversal: ${session.productViews} product pages crawled`);
      return { score: 85, reasons, description: `High-volume catalog scraping (${session.productViews} products)` };
    }

    if (session.productViews >= 5 && session.productViews / Math.max(1, session.pageViews) >= 0.8) {
      reasons.push("Disproportionate product page crawling ratio (> 80% catalog focus)");
      return { score: 65, reasons, description: "Elevated catalog crawling focus" };
    }

    // Repetitive identical product polling
    if (events && events.length >= 4) {
      const productIds = events.filter((e) => e.productId).map((e) => e.productId);
      const uniqueIds = new Set(productIds);
      if (productIds.length >= 6 && uniqueIds.size <= 2) {
        reasons.push("Repetitive robotic polling of identical product resources");
        return { score: 70, reasons, description: "Robotic polling on limited product set" };
      }
    }

    return { score: 8, reasons, description: "Normal ecommerce browsing distribution" };
  }

  /**
   * 4. Cart & Checkout Velocity Rule (Weight: 0.20)
   * Identifies cart stuffing, rapid automated additions, and rewards verified purchases.
   */
  static evaluateCartCheckoutRule(
    session: Pick<TrafficSession, "addToCartCount" | "checkoutStarted" | "purchaseCompleted" | "totalSpend">,
    durationSec: number,
    events?: Pick<TrafficEvent, "eventType" | "timestamp">[],
    config: DetectionConfigType = DetectionConfig
  ): RuleEvaluationResult {
    const reasons: string[] = [];
    const effectiveSec = Math.max(1, durationSec);

    // Verified completed purchase is strong human signal
    if (session.purchaseCompleted && session.totalSpend > 0) {
      return { score: 0, reasons: [], description: `Verified purchase completed ($${session.totalSpend.toFixed(2)})` };
    }

    // Cart stuffing anomaly: multiple items added in rapid succession
    if (session.addToCartCount >= config.heuristics.cartStuffingMinItems && effectiveSec <= 8) {
      reasons.push(`Cart stuffing anomaly: ${session.addToCartCount} items added to cart in ${effectiveSec.toFixed(1)}s`);
      return { score: 96, reasons, description: `Cart stuffing (${session.addToCartCount} items in ${effectiveSec.toFixed(1)}s)` };
    }

    if (session.addToCartCount >= 3 && effectiveSec <= 12) {
      reasons.push(`Accelerated cart additions (${session.addToCartCount} items in under 12 seconds)`);
      return { score: 80, reasons, description: "Accelerated cart velocity" };
    }

    // Normal checkout progression
    if (session.checkoutStarted) {
      return { score: 5, reasons, description: "Legitimate checkout initiation" };
    }

    // Standard organic cart addition
    if (session.addToCartCount > 0) {
      return { score: 10, reasons, description: "Standard human cart addition" };
    }

    return { score: 10, reasons, description: "Zero cart anomalies detected" };
  }

  /**
   * 5. Automation & Client Signatures Rule (Weight: 0.15)
   * Detects headless browser markers, webdriver flags, zero mouse jitter, and automated user agents.
   */
  static evaluateAutomationSignatureRule(
    session: Pick<TrafficSession, "browser" | "os">,
    rawPayload?: IngestionEventPayload
  ): RuleEvaluationResult {
    const reasons: string[] = [];
    const meta = (rawPayload?.metadata as Record<string, unknown>) || {};
    const userAgent = (rawPayload?.userAgent || "").toLowerCase();

    // 1. Headless or Bot User-Agent signatures
    const isBotUA =
      /headlesschrome|phantomjs|selenium|puppeteer|playwright|bot|crawl|spider|wget|python-requests/i.test(userAgent);
    const isHeadlessMeta = Boolean(meta.isHeadless);

    if (isBotUA || isHeadlessMeta) {
      reasons.push("Automated headless browser signature detected (HeadlessChrome / automation runtime)");
      return { score: 98, reasons, description: "Headless browser or scraper user agent detected" };
    }

    // 2. Navigator webdriver flag
    if (Boolean(meta.navigatorWebdriver)) {
      reasons.push("Automated browser control marker detected (navigator.webdriver = true)");
      return { score: 95, reasons, description: "navigator.webdriver active" };
    }

    // 3. Sub-human click cadence
    const clickIntervalMs = Number(meta.clickIntervalMs || 1000);
    if (clickIntervalMs > 0 && clickIntervalMs < DetectionConfig.heuristics.rapidClickIntervalMs) {
      reasons.push(`Sub-300ms interaction cadence (${clickIntervalMs}ms; physically impossible for humans)`);
      return { score: 85, reasons, description: `Sub-human click cadence (${clickIntervalMs}ms)` };
    }

    // 4. Synthetic cursor trajectory (zero mouse movement entropy)
    if (meta.mouseMovementEntropy === 0) {
      reasons.push("Deterministic linear cursor trajectory without natural human jitter");
      return { score: 75, reasons, description: "Synthetic linear mouse trajectory (zero entropy)" };
    }

    return { score: 5, reasons, description: "Standard human browser environment & natural input" };
  }

  /**
   * 6. Source & Campaign Anomaly Rule (Weight: 0.15)
   * Detects invalid ad traffic, budget exhaustion clicks, and suspicious landing probes.
   */
  static evaluateCampaignAnomalyRule(
    session: Pick<TrafficSession, "utmSource" | "utmCampaign" | "landingPage" | "pageViews">,
    durationSec: number = 60
  ): RuleEvaluationResult {
    const reasons: string[] = [];
    const isPaid =
      session.utmSource === "Paid Social" ||
      session.utmSource === "Paid Search" ||
      Boolean(session.utmCampaign);

    // Paid ad immediate abandonment (invalid click bounce)
    if (isPaid && session.pageViews === 1 && durationSec <= 4) {
      reasons.push(`Paid ad bounce anomaly: instant abandonment (${durationSec.toFixed(1)}s) exhausting ad budget`);
      return { score: 75, reasons, description: "Paid ad invalid click bounce" };
    }

    // Direct deep-link probe without organic referral context
    if (
      session.utmSource === "Direct" &&
      session.landingPage.includes("/checkout") &&
      session.pageViews === 1
    ) {
      reasons.push("Direct deep-link probe to checkout without browsing history");
      return { score: 65, reasons, description: "Suspicious direct checkout deep-link" };
    }

    if (isPaid) {
      return { score: 15, reasons, description: "Standard paid campaign referral engagement" };
    }

    return { score: 5, reasons, description: "Organic or direct ecommerce traffic" };
  }

  /**
   * Calculates the final weighted composite score and assembles signal breakdowns.
   */
  static calculateCompositeScore(
    frequency: RuleEvaluationResult,
    navigation: RuleEvaluationResult,
    catalog: RuleEvaluationResult,
    cartCheckout: RuleEvaluationResult,
    automation: RuleEvaluationResult,
    campaign: RuleEvaluationResult,
    config: DetectionConfigType = DetectionConfig
  ): RiskScoringOutput {
    const weights = config.weights;

    const signals: SignalScoreBreakdown[] = [
      {
        name: "request_frequency",
        value: frequency.score,
        weight: weights.frequencyWeight,
        contribution: Math.round(frequency.score * weights.frequencyWeight),
        description: frequency.description,
      },
      {
        name: "navigation_dwell",
        value: navigation.score,
        weight: weights.navigationDwellWeight,
        contribution: Math.round(navigation.score * weights.navigationDwellWeight),
        description: navigation.description,
      },
      {
        name: "catalog_traversal",
        value: catalog.score,
        weight: weights.catalogTraversalWeight,
        contribution: Math.round(catalog.score * weights.catalogTraversalWeight),
        description: catalog.description,
      },
      {
        name: "cart_checkout_velocity",
        value: cartCheckout.score,
        weight: weights.cartCheckoutWeight,
        contribution: Math.round(cartCheckout.score * weights.cartCheckoutWeight),
        description: cartCheckout.description,
      },
      {
        name: "automation_signatures",
        value: automation.score,
        weight: weights.automationSignatureWeight,
        contribution: Math.round(automation.score * weights.automationSignatureWeight),
        description: automation.description,
      },
      {
        name: "campaign_attribution",
        value: campaign.score,
        weight: weights.campaignAnomalyWeight,
        contribution: Math.round(campaign.score * weights.campaignAnomalyWeight),
        description: campaign.description,
      },
    ];

    const rawComposite = signals.reduce((sum, s) => sum + s.value * s.weight, 0);
    
    // Critical signal amplification:
    // In ecommerce bot defense, if multiple distinct attack vectors are severe (>= 75),
    // non-applicable vectors (e.g. a scraper not touching the cart) must not dilute the risk verdict.
    const highRiskSignals = signals.filter((s) => s.value >= 75);
    let riskScore = rawComposite;
    if (highRiskSignals.length >= 3) {
      // 3 or more severe vectors -> High-Risk Bot
      const highRiskAvg = highRiskSignals.reduce((sum, s) => sum + s.value, 0) / highRiskSignals.length;
      riskScore = Math.max(riskScore, highRiskAvg);
    } else if (highRiskSignals.length >= 2) {
      // 2 severe vectors -> Confirmed Bot / Automated
      const highRiskAvg = highRiskSignals.reduce((sum, s) => sum + s.value, 0) / highRiskSignals.length;
      riskScore = Math.max(riskScore, highRiskAvg * 0.9);
    } else if (highRiskSignals.length === 1 && highRiskSignals[0].value >= 95) {
      // Single extreme vector (e.g. cart stuffing 96, headless 98) -> elevated
      riskScore = Math.max(riskScore, highRiskSignals[0].value * 0.85);
    }

    const finalRiskScore = Math.min(100, Math.max(0, Math.round(riskScore)));

    // Aggregate deduplicated reasons
    const allReasons = [
      ...frequency.reasons,
      ...navigation.reasons,
      ...catalog.reasons,
      ...cartCheckout.reasons,
      ...automation.reasons,
      ...campaign.reasons,
    ];
    const uniqueReasons = Array.from(new Set(allReasons));

    return {
      riskScore: finalRiskScore,
      reasons: uniqueReasons,
      signals,
    };
  }
}
