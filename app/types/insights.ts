// Data contracts and TypeScript interfaces for Traffiq Telemetry, Detection Engine, and AI Insights

export type RiskLevel = "Likely Human" | "Suspicious" | "Likely Automated";

export interface DetectionReason {
  title: string;
  desc: string;
  severity: "High" | "Medium" | "Low";
}

export interface RawTelemetryEvent {
  shop: string;
  sessionId: string;
  clientId?: string;
  eventType: "page_viewed" | "product_added_to_cart" | "checkout_started";
  url: string;
  referrer?: string;
  userAgent?: string;
  clientIp?: string;
  isHeadless?: boolean;
  mouseMovementEntropy?: number;
  clickIntervalMs?: number;
  timestamp: number;
}

export interface SessionTimelineEvent {
  id: string;
  eventType: string;
  pageUrl: string;
  timestamp: string;
  formattedTime: string;
  elapsedSeconds?: number;
  metadata?: any;
}

export interface DetectionSignalItem {
  name: string;
  value: string | number;
  weight: number;
  description: string;
  severity?: "High" | "Medium" | "Low";
}

export interface ScoredSession {
  id: string;
  displayId?: string;
  shop: string;
  riskLevel: RiskLevel;
  botScore: number;
  riskScore?: number;
  trafficClassification?: string;
  confidence?: number;
  source: string;
  time: string;
  timestamp?: string;
  country: string;
  countryFlag: string;
  city?: string;
  region?: string;
  location?: string;
  device: string;
  browser?: string;
  operatingSystem?: string;
  requestsFactor: string;
  reasons: DetectionReason[];
  detectionSignals?: DetectionSignalItem[];
  sessionTimeline?: SessionTimelineEvent[];
  aiExplanation?: string;
  recommendedAction?: string;
  isFlagged?: boolean;
  flaggedReason?: string;
  aiRecommendation?: string;
  trafficType?: string;
  severity?: string;
  campaign?: string;
  startedAt?: string;
  lastSeenAt?: string;
  pageViews?: number;
  addToCartCount?: number;
  checkoutStarted?: boolean;
  landingPage?: string;
  isBlocked?: boolean;
  isManuallyBlocked?: boolean;
}

export interface ChannelMetrics {
  label: string;
  count: number;
  percent: number;
  color: string;
}

export interface BusinessImpactRow {
  name: string;
  reported: string;
  adjusted: string;
  impact: string;
  isPositive: boolean;
}

export interface BusinessImpactData {
  sessions: BusinessImpactRow;
  conversionRate: BusinessImpactRow;
  addToCartRate: BusinessImpactRow;
  checkoutRate: BusinessImpactRow;
  completedOrders: BusinessImpactRow;
  revenue: BusinessImpactRow;
  rows: BusinessImpactRow[];
}

export interface CampaignMetrics {
  name: string;
  sessions: string;
  suspiciousSessions?: number;
  totalSessions?: number;
  suspiciousPercent?: number;
  percent: string;
  conversionRate?: number;
}

export interface TrendDayScore {
  date: string;
  score: number;
  x: number;
  y: number;
}

export interface SuspiciousCharacteristic {
  id: string;
  title: string;
  desc: string;
  metricValue: string;
  metricSublabel: string;
}

export interface AggregatedTrafficMetrics {
  dateRange: string;
  compareRange: string;
  trafficQualityScore: number;
  scoreTrendVsPrevious: number; // e.g. -14
  realTrafficPercent: number; // 62%
  realTrafficSessions: number; // 15,362
  realTrafficTrend: number; // +8
  suspiciousPercent: number; // 38%
  suspiciousSessions: number; // 8,420
  suspiciousTrend: number; // +26%
  totalSessions: number; // 23,782
  totalSessionsTrend: number; // +12
  conversionRate: number; // 1.4%
  conversionRateTrend: number; // -9%
  topSuspiciousChannel: string; // "Paid Social"
  topChannelShareOfInvalid: string; // "59%"
  blockedCount: number; // 214
  dailyTrend: TrendDayScore[];
  hasTrendData?: boolean;
  trafficSources: ChannelMetrics[];
  campaigns: CampaignMetrics[];
  businessImpact?: BusinessImpactData;
  topHeuristics: string[];
  detectedAt: string;
  characteristics: SuspiciousCharacteristic[];
  suspiciousTrafficPercent?: number;
  trend?: TrendDayScore[];
  anomaly?: {
    title: string;
    affectedSessions: number;
    likelySource: string;
    botLikelihood: string;
    detectedAt: string;
  };
  protection?: {
    mode: string;
    blockedCount: number;
    status: string;
  };
}

export interface RecommendedActionItem {
  priority: "HIGH" | "MEDIUM" | "LOW";
  action: string;
  reason: string;
}

export interface AggregatedDetectionContext {
  period: string;
  totalSessions: number;
  suspiciousSessions: number;
  realSessions: number;
  trafficTypes: {
    realTrafficPercent: number;
    suspiciousPercent: number;
  };
  riskScores: {
    trafficQualityScore: number;
    scoreTrendVsPrevious: number;
  };
  signals: string[];
  anomalies: {
    title: string;
    affectedSessions: number;
    likelySource: string;
    botLikelihood: string;
    detectedAt: string;
  } | null;
  sources: {
    source: string;
    suspiciousCount: number;
    percentOfInvalid: string;
  }[];
  campaigns: {
    campaignName: string;
    suspiciousSessions: string;
    suspiciousPercent: string;
  }[];
  conversionRates: {
    reportedRate: number;
    reportedRateTrend: number;
  };
  alerts: {
    type: string;
    severity: string;
    title: string;
    description: string;
  }[];
  businessImpact: {
    metric: string;
    reported: string;
    adjusted: string;
    impact: string;
  }[];
}

export interface RawAiInsightOutput {
  summary: string | { headline: string; subheadline?: string };
  keyFindings: string[];
  businessImpact: string[] | string;
  keyPatterns: string[];
  whyItMatters: string;
  recommendedActions: RecommendedActionItem[];
}

export interface StructuredAiInsightsResponse {
  summary: {
    headline: string;
    subheadline: string;
    lastUpdated: string;
  };
  analysisPeriod: string;
  generatedTimestamp: string;
  dataSources: string[];
  keyFindings: string[];
  patterns: string[];
  keyPatterns?: string[];
  businessImpact: string[];
  whyItMatters: string;
  mythsAndMisinterpretations?: string[];
  recommendedActions: RecommendedActionItem[];
  whatsHappening: string;
  recommendedAction: string;
  channelInsights?: {
    channel: string;
    riskShare: string;
    insight: string;
  }[];
}
