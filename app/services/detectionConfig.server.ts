// Centralized Configuration for Traffic Detection Engine & Weighted Scoring Rules

export type TrafficType =
  | "HUMAN"
  | "AUTOMATED"
  | "BOT"
  | "SUSPICIOUS"
  | "HIGH_RISK"
  | "UNKNOWN";

export type SeverityLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type RecommendedAction =
  | "MONITOR"
  | "FLAG"
  | "ALERT"
  | "CHALLENGE"
  | "BLOCK"
  | "REDIRECT";

export interface RuleWeights {
  frequencyWeight: number; // 0.20
  navigationDwellWeight: number; // 0.15
  catalogTraversalWeight: number; // 0.15
  cartCheckoutWeight: number; // 0.20
  automationSignatureWeight: number; // 0.15
  campaignAnomalyWeight: number; // 0.15
}

export interface DetectionThresholdConfig {
  humanMaxScore: number; // < 25
  suspiciousMaxScore: number; // < 55
  automatedMaxScore: number; // < 75
  botMaxScore: number; // < 90
  // >= 90 is HIGH_RISK
}

export interface HeuristicThresholds {
  humanMaxRPM: number; // 25 requests/min
  extremeRPM: number; // 60 requests/min
  rapidClickIntervalMs: number; // 300 ms
  scraperMinDwellSeconds: number; // 2.0 s per product page
  normalDwellSeconds: number; // 15.0 s per page
  rapidCartIntervalSeconds: number; // 2.5 s between cart additions
  cartStuffingMinItems: number; // 4 items
  minShortSessionSeconds: number; // 5 seconds
  highCatalogViewCount: number; // 10 products
}

export interface DetectionConfigType {
  weights: RuleWeights;
  thresholds: DetectionThresholdConfig;
  heuristics: HeuristicThresholds;
}

export const DetectionConfig: DetectionConfigType = {
  weights: {
    frequencyWeight: 0.20,
    navigationDwellWeight: 0.15,
    catalogTraversalWeight: 0.15,
    cartCheckoutWeight: 0.20,
    automationSignatureWeight: 0.15,
    campaignAnomalyWeight: 0.15,
  },
  thresholds: {
    humanMaxScore: 50, // < 50 is Likely Human
    suspiciousMaxScore: 81, // 50 to 80 is Suspicious
    automatedMaxScore: 81, // > 80 is Likely Automated
    botMaxScore: 90,
  },
  heuristics: {
    humanMaxRPM: 25,
    extremeRPM: 60,
    rapidClickIntervalMs: 300,
    scraperMinDwellSeconds: 2.0,
    normalDwellSeconds: 15.0,
    rapidCartIntervalSeconds: 2.5,
    cartStuffingMinItems: 4,
    minShortSessionSeconds: 5,
    highCatalogViewCount: 10,
  },
};
