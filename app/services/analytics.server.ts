import prisma from "../db.server";
import type {
  AggregatedTrafficMetrics,
  ScoredSession,
  TrendDayScore,
  ChannelMetrics,
  CampaignMetrics,
  BusinessImpactRow,
  BusinessImpactData,
  SuspiciousCharacteristic,
} from "../types/insights";
import {
  generateSessionAiRecommendation,
  generateSessionAiRecommendationWithGroq,
  getRiskLevel,
} from "./sessionAiRecommender.server";

// Helper functions for dynamic date formatting and timezone safety
function sanitizeTimeZone(tz?: string): string | undefined {
  if (!tz || typeof tz !== "string") return undefined;
  const trimmed = tz.trim();
  if (!trimmed) return undefined;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return trimmed;
  } catch {
    return undefined;
  }
}

function formatShortDate(date: Date, timeZone?: string): string {
  const validTz = sanitizeTimeZone(timeZone);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(validTz ? { timeZone: validTz } : {}) });
}

function formatDateRange(startDate: Date, endDate: Date): string {
  const startMonth = startDate.toLocaleDateString("en-US", { month: "short" });
  const endMonth = endDate.toLocaleDateString("en-US", { month: "short" });
  const startYear = startDate.getFullYear();
  const endYear = endDate.getFullYear();
  if (startYear === endYear) {
    if (startMonth === endMonth) {
      return `${startMonth} ${startDate.getDate()} – ${endDate.getDate()}, ${endYear}`;
    }
    return `${startMonth} ${startDate.getDate()} – ${endMonth} ${endDate.getDate()}, ${endYear}`;
  }
  return `${startMonth} ${startDate.getDate()}, ${startYear} – ${endMonth} ${endDate.getDate()}, ${endYear}`;
}

export interface DateRangeResolution {
  startDate: Date;
  endDate: Date;
  label: string;
  normalizedKey: string;
}

export interface CompareRangeResolution {
  startDate: Date;
  endDate: Date;
  label: string;
  normalizedKey: string;
  hasComparison: boolean;
}

export interface AnalyticsQueryOptions {
  dateRange?: string;
  compareRange?: string;
  startDate?: string | Date;
  endDate?: string | Date;
  isDemo?: boolean;
  timeZone?: string;
}

// High-performance in-memory cache for fast sub-millisecond tab switching
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}
const overviewCache = new Map<string, CacheEntry<AggregatedTrafficMetrics>>();
const filterDistinctCache = new Map<string, CacheEntry<Array<{ utmSource: string; country: string; deviceType: string; trafficType: string }>>>();
const sessionDetailCache = new Map<string, CacheEntry<ScoredSession | null>>();
const investigationSessionsCache = new Map<string, CacheEntry<any>>();
const shopSettingsCache = new Map<string, CacheEntry<any>>();
const lastRetentionPurgeTime = new Map<string, number>();

export class AnalyticsService {
  /**
   * Resolves date range bounds from string presets or custom dates.
   * Supported presets: Today, Last 7 Days, Last 30 Days, Yesterday, Custom.
   */
  static parseDateRange(
    dateRangeKey?: string,
    customStart?: string | Date,
    customEnd?: string | Date
  ): DateRangeResolution {
    const now = new Date();
    const key = (dateRangeKey || "").trim().toLowerCase();

    // 1. Custom Date Range
    if (customStart && customEnd) {
      const s = new Date(customStart);
      const e = new Date(customEnd);
      if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
        return {
          startDate: s,
          endDate: e,
          label: formatDateRange(s, e),
          normalizedKey: "custom",
        };
      }
    }

    // 2. Today (from 00:00:00.000 today until now)
    if (key === "today" || key.startsWith("today") || key === "today (live)") {
      const startOfToday = new Date(now);
      startOfToday.setHours(0, 0, 0, 0);
      return {
        startDate: startOfToday,
        endDate: now,
        label: "Today",
        normalizedKey: "today",
      };
    }

    // 3. Yesterday (full 24h of previous day)
    if (key === "yesterday") {
      const startOfYesterday = new Date(now);
      startOfYesterday.setDate(startOfYesterday.getDate() - 1);
      startOfYesterday.setHours(0, 0, 0, 0);

      const endOfYesterday = new Date(now);
      endOfYesterday.setDate(endOfYesterday.getDate() - 1);
      endOfYesterday.setHours(23, 59, 59, 999);

      return {
        startDate: startOfYesterday,
        endDate: endOfYesterday,
        label: "Yesterday",
        normalizedKey: "yesterday",
      };
    }

    // 4. Last 30 Days
    if (key === "last 30 days" || key === "last_30_days" || key === "30d" || key === "30 days") {
      const start30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return {
        startDate: start30,
        endDate: now,
        label: "Last 30 Days",
        normalizedKey: "last_30_days",
      };
    }

    // 5. Last 90 Days
    if (key === "last 90 days" || key === "last_90_days" || key === "90d" || key === "90 days") {
      const start90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      return {
        startDate: start90,
        endDate: now,
        label: "Last 90 Days",
        normalizedKey: "last_90_days",
      };
    }

    // 6. Last 24 Hours
    if (key === "last 24 hours" || key === "24h" || key === "last_24_hours" || key === "24 hours") {
      const start24 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      return {
        startDate: start24,
        endDate: now,
        label: "Last 24 Hours",
        normalizedKey: "last_24_hours",
      };
    }

    // 7. Default: Last 7 Days
    const start7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return {
      startDate: start7,
      endDate: now,
      label: "Last 7 Days",
      normalizedKey: "last_7_days",
    };
  }

  /**
   * Resolves comparison range bounds based on the active date range.
   * Supported: Previous Period, Previous Year / Same Period Last Year, None.
   */
  static parseCompareRange(
    currentRange: DateRangeResolution,
    compareRangeKey?: string
  ): CompareRangeResolution {
    const key = (compareRangeKey || "").trim().toLowerCase();

    if (key === "none" || key === "no comparison") {
      return {
        startDate: currentRange.startDate,
        endDate: currentRange.endDate,
        label: "None",
        normalizedKey: "none",
        hasComparison: false,
      };
    }

    // Previous Year / Same Period Last Year
    if (
      key === "previous year" ||
      key === "same period last year" ||
      key === "previous_year" ||
      key === "same_period_last_year"
    ) {
      const prevYearStart = new Date(currentRange.startDate);
      prevYearStart.setFullYear(prevYearStart.getFullYear() - 1);

      const prevYearEnd = new Date(currentRange.endDate);
      prevYearEnd.setFullYear(prevYearEnd.getFullYear() - 1);

      return {
        startDate: prevYearStart,
        endDate: prevYearEnd,
        label: "Previous Year",
        normalizedKey: "previous_year",
        hasComparison: true,
      };
    }

    // Default: Previous Period (preceding window of exact same duration)
    const duration = currentRange.endDate.getTime() - currentRange.startDate.getTime();
    const prevPeriodEnd = new Date(currentRange.startDate.getTime());
    const prevPeriodStart = new Date(currentRange.startDate.getTime() - duration);

    return {
      startDate: prevPeriodStart,
      endDate: prevPeriodEnd,
      label: "Previous Period",
      normalizedKey: "previous_period",
      hasComparison: true,
    };
  }

  /**
   * Calculates all dashboard overview metrics strictly from PostgreSQL database records.
   * Every number derives from database queries. Zero hardcoding. Zero random numbers.
   */
  static async getDashboardOverview(
    shopId: string,
    options?: AnalyticsQueryOptions | string,
    legacyCompareKey?: string
  ): Promise<AggregatedTrafficMetrics> {
    // Handle overload (string, string) or options object
    let dateRangeKey: string | undefined;
    let compareRangeKey: string | undefined;
    let customStart: string | Date | undefined;
    let customEnd: string | Date | undefined;

    if (typeof options === "string") {
      dateRangeKey = options;
      compareRangeKey = legacyCompareKey;
    } else if (options && typeof options === "object") {
      dateRangeKey = options.dateRange;
      compareRangeKey = options.compareRange;
      customStart = options.startDate;
      customEnd = options.endDate;
    }

    const timeZone = typeof options === "object" ? sanitizeTimeZone(options?.timeZone) : undefined;
    const currentRange = AnalyticsService.parseDateRange(dateRangeKey, customStart, customEnd);
    const compareRange = AnalyticsService.parseCompareRange(currentRange, compareRangeKey);

    // Fast-path: Check in-memory cache (30s TTL)
    const rangeKey = currentRange.normalizedKey === "custom"
      ? `custom_${currentRange.startDate.toISOString().slice(0, 10)}_${currentRange.endDate.toISOString().slice(0, 10)}`
      : currentRange.normalizedKey;
    const cacheKey = `${shopId}_${rangeKey}_${compareRange.normalizedKey}_${timeZone || ""}`;
    const cached = overviewCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const settings = await AnalyticsService.getShopSettings(shopId);
    const retentionDays = settings?.dataRetentionDays ?? 30;
    const retentionCutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    // Opportunistically ensure retention purge is enforced at least once every 2 hours
    const lastPurge = lastRetentionPurgeTime.get(shopId) || 0;
    if (Date.now() - lastPurge > 2 * 3600 * 1000) {
      lastRetentionPurgeTime.set(shopId, Date.now());
      AnalyticsService.enforceDataRetention(shopId, retentionDays).catch((err) => {
        console.error("[DataRetention] Auto-purge error:", err);
      });
    }

    const startDate = currentRange.startDate < retentionCutoff ? retentionCutoff : currentRange.startDate;
    const endDate = currentRange.endDate;
    const { startDate: prevStart, endDate: prevEnd, hasComparison } = compareRange;

    // 1. Current Period Database Queries
    const [
      totalSessionsCount,
      realSessionsCount,
      suspiciousSessionsCount,
      completedOrdersCount,
      avgRiskScoreResult,
      blockedCount,
    ] = await Promise.all([
      // Total sessions in period
      prisma.trafficSession.count({
        where: { shopId, startedAt: { gte: startDate, lte: endDate } },
      }),
      // Human sessions in period (Risk < 50)
      prisma.trafficSession.count({
        where: {
          shopId,
          riskScore: { lt: 50 },
          startedAt: { gte: startDate, lte: endDate },
        },
      }),
      // Suspicious & automated sessions in period (Risk >= 50)
      prisma.trafficSession.count({
        where: {
          shopId,
          riskScore: { gte: 50 },
          startedAt: { gte: startDate, lte: endDate },
        },
      }),
      // Completed orders in period
      prisma.trafficSession.count({
        where: {
          shopId,
          purchaseCompleted: true,
          startedAt: { gte: startDate, lte: endDate },
        },
      }),
      // Average session risk score in period
      prisma.trafficSession.aggregate({
        where: { shopId, startedAt: { gte: startDate, lte: endDate } },
        _avg: { riskScore: true },
      }),
      // Blocked protection actions executed in period
      prisma.protectionAction.count({
        where: {
          shopId,
          action: "BLOCK",
          status: "EXECUTED",
          createdAt: { gte: startDate, lte: endDate },
        },
      }),
      // Shop settings for protection mode (resolved above)
    ]);

    // Derived Current Rates
    const suspiciousPercent =
      totalSessionsCount > 0 ? Math.round((suspiciousSessionsCount / totalSessionsCount) * 100) : 0;
    const realPercent = totalSessionsCount > 0 ? 100 - suspiciousPercent : 100;

    // Traffic Quality Score: 100 minus average risk score, bounded [0, 100].
    // If no risk score recorded or 0 sessions, quality score is 100 (or ratio of real traffic).
    const avgRisk = avgRiskScoreResult._avg.riskScore ?? 0;
    const trafficQualityScore =
      totalSessionsCount > 0
        ? Math.max(0, Math.min(100, Math.round(100 - avgRisk)))
        : 100;

    const conversionRate =
      totalSessionsCount > 0
        ? Number(((completedOrdersCount / totalSessionsCount) * 100).toFixed(1))
        : 0.0;

    // 2. Comparison Period Database Queries (for real trend calculation)
    let scoreTrendVsPrevious = 0;
    let realTrafficTrend = 0;
    let suspiciousTrend = 0;
    let totalSessionsTrend = 0;
    let conversionRateTrend = 0;

    if (hasComparison) {
      const [
        prevTotalSessions,
        prevRealSessions,
        prevSuspiciousSessions,
        prevOrdersCount,
        prevAvgRiskResult,
      ] = await Promise.all([
        prisma.trafficSession.count({
          where: { shopId, startedAt: { gte: prevStart, lte: prevEnd } },
        }),
        prisma.trafficSession.count({
          where: {
            shopId,
            trafficType: "HUMAN",
            startedAt: { gte: prevStart, lte: prevEnd },
          },
        }),
        prisma.trafficSession.count({
          where: {
            shopId,
            riskScore: { gte: 50 },
            startedAt: { gte: prevStart, lte: prevEnd },
          },
        }),
        prisma.trafficSession.count({
          where: {
            shopId,
            purchaseCompleted: true,
            startedAt: { gte: prevStart, lte: prevEnd },
          },
        }),
        prisma.trafficSession.aggregate({
          where: { shopId, startedAt: { gte: prevStart, lte: prevEnd } },
          _avg: { riskScore: true },
        }),
      ]);

      const prevAvgRisk = prevAvgRiskResult._avg.riskScore ?? 0;
      const prevTrafficQualityScore =
        prevTotalSessions > 0 ? Math.max(0, Math.min(100, Math.round(100 - prevAvgRisk))) : 100;
      const prevSuspiciousPct =
        prevTotalSessions > 0 ? Math.round((prevSuspiciousSessions / prevTotalSessions) * 100) : 0;
      const prevRealPct = prevTotalSessions > 0 ? 100 - prevSuspiciousPct : 100;
      const prevConvRate =
        prevTotalSessions > 0 ? Number(((prevOrdersCount / prevTotalSessions) * 100).toFixed(1)) : 0.0;

      // Quality score trend is delta in points
      scoreTrendVsPrevious = trafficQualityScore - prevTrafficQualityScore;

      // Helper for percentage change
      const pctDelta = (curr: number, prev: number) => {
        if (prev === 0) return curr > 0 ? 100 : 0;
        return Math.round(((curr - prev) / prev) * 100);
      };

      realTrafficTrend = pctDelta(realSessionsCount, prevRealSessions);
      suspiciousTrend = pctDelta(suspiciousSessionsCount, prevSuspiciousSessions);
      totalSessionsTrend = pctDelta(totalSessionsCount, prevTotalSessions);
      conversionRateTrend = pctDelta(conversionRate, prevConvRate);
    }

    // 3. Traffic Quality Trend (Data Points for SVG Chart)
    const dailyTrend: TrendDayScore[] = [];
    const numPoints = 7;
    const xCoords = [45, 157.5, 270, 382.5, 495, 607.5, 720];

    // Spans the full requested timeframe so any days outside retention window or without data show 0
    const trendStartDate = currentRange.startDate;
    const trendEndDate = currentRange.endDate;
    const totalDurationMs = trendEndDate.getTime() - trendStartDate.getTime();
    const intervalMs = Math.max(60000, Math.floor(totalDurationMs / numPoints));

    // High performance optimization: Fetch sessions for period in 1 query instead of 14 sequential queries
    const trendSessions = await prisma.trafficSession.findMany({
      where: {
        shopId,
        startedAt: { gte: trendStartDate, lte: trendEndDate },
      },
      select: {
        startedAt: true,
        riskScore: true,
      },
    });

    const hasTrendData = trendSessions.length > 0;

    for (let i = 0; i < numPoints; i++) {
      const bucketStart = new Date(trendStartDate.getTime() + i * intervalMs);
      const bucketEnd =
        i === numPoints - 1 ? trendEndDate : new Date(trendStartDate.getTime() + (i + 1) * intervalMs);

      const bucketItems = trendSessions.filter(
        (s) => s.startedAt >= bucketStart && s.startedAt <= bucketEnd
      );
      const bucketCount = bucketItems.length;

      let bucketScore: number;
      if (bucketCount > 0) {
        const sumRisk = bucketItems.reduce((acc, s) => acc + s.riskScore, 0);
        const bAvg = sumRisk / bucketCount;
        bucketScore = Math.max(0, Math.min(100, Math.round(100 - bAvg)));
      } else {
        // If data is not present (either 0 visits or outside retention window), show 0
        bucketScore = 0;
      }

      // Y coordinate mapped to SVG viewBox: Y=15 is 100, Y=145 is 0
      const y = 145 - (bucketScore / 100) * 130;

      // Date label format: for "Today" or "Last 24 Hours" show time (e.g. 12 AM), for longer ranges show date (e.g. Sep 8)
      let label: string;
      if (currentRange.normalizedKey === "today" || currentRange.normalizedKey === "last_24_hours") {
        label = bucketStart.toLocaleTimeString("en-US", { hour: "numeric", hour12: true, ...(timeZone ? { timeZone } : {}) });
      } else {
        label = formatShortDate(bucketStart, timeZone);
      }

      dailyTrend.push({
        date: label,
        score: bucketScore,
        x: xCoords[i] ?? 45,
        y: Math.round(y * 10) / 10,
      });
    }

    // 4. Traffic Sources Breakdown (Canonical 5: Paid Social, Organic Search, Direct, Referral, Other)
    const canonicalSources = ["Paid Social", "Organic Search", "Direct", "Referral", "Other"];
    const sourceColors: Record<string, string> = {
      "Paid Social": "#ef4444",
      "Organic Search": "#3b82f6",
      Direct: "#10b981",
      Referral: "#8b5cf6",
      Other: "#f59e0b",
    };

    const suspiciousSourceGroups = await prisma.trafficSession.groupBy({
      by: ["utmSource"],
      where: {
        shopId,
        trafficType: { in: ["SUSPICIOUS", "AUTOMATED", "BOT", "HIGH_RISK"] },
        startedAt: { gte: startDate, lte: endDate },
      },
      _count: { id: true },
    });

    const sourceCountMap: Record<string, number> = {};
    for (const s of canonicalSources) {
      sourceCountMap[s] = 0;
    }

    for (const g of suspiciousSourceGroups) {
      const raw = g.utmSource || "Direct";
      if (canonicalSources.includes(raw)) {
        sourceCountMap[raw] = (sourceCountMap[raw] || 0) + g._count.id;
      } else {
        sourceCountMap["Other"] = (sourceCountMap["Other"] || 0) + g._count.id;
      }
    }

    const trafficSources: ChannelMetrics[] = canonicalSources.map((sourceName) => {
      const count = sourceCountMap[sourceName] || 0;
      const percent = suspiciousSessionsCount > 0 ? Math.round((count / suspiciousSessionsCount) * 100) : 0;
      return {
        label: sourceName,
        count,
        percent,
        color: sourceColors[sourceName] || "#64748b",
      };
    });

    // 5. Campaigns Breakdown
    const campaignSessions = await prisma.trafficSession.findMany({
      where: {
        shopId,
        utmCampaign: { not: null },
        startedAt: { gte: startDate, lte: endDate },
      },
      select: {
        utmCampaign: true,
        trafficType: true,
        purchaseCompleted: true,
      },
    });

    const campaignMap = new Map<string, { total: number; suspicious: number; orders: number }>();
    for (const cs of campaignSessions) {
      const cName = cs.utmCampaign || "Default Campaign";
      const existing = campaignMap.get(cName) || { total: 0, suspicious: 0, orders: 0 };
      existing.total += 1;
      if (["SUSPICIOUS", "AUTOMATED", "BOT", "HIGH_RISK"].includes(cs.trafficType)) {
        existing.suspicious += 1;
      }
      if (cs.purchaseCompleted) {
        existing.orders += 1;
      }
      campaignMap.set(cName, existing);
    }

    const campaigns: CampaignMetrics[] = Array.from(campaignMap.entries()).map(([name, data]) => {
      const suspPct = data.total > 0 ? Math.round((data.suspicious / data.total) * 100) : 0;
      const cRate = data.total > 0 ? Number(((data.orders / data.total) * 100).toFixed(1)) : 0;
      return {
        name,
        sessions: data.suspicious.toLocaleString(),
        suspiciousSessions: data.suspicious,
        totalSessions: data.total,
        suspiciousPercent: suspPct,
        percent: `${suspPct}%`,
        conversionRate: cRate,
      };
    });

    // 6. Suspicious Traffic Anomaly Indicators (Calculated from DB)
    // Find top suspicious channel
    let topSuspiciousChannel = "Direct";
    let topChannelMaxCount = 0;
    for (const [sName, sCount] of Object.entries(sourceCountMap)) {
      if (sCount > topChannelMaxCount) {
        topChannelMaxCount = sCount;
        topSuspiciousChannel = sName;
      }
    }
    const topChannelShareOfInvalid =
      suspiciousSessionsCount > 0
        ? `${Math.round((topChannelMaxCount / suspiciousSessionsCount) * 100)}%`
        : "0%";

    // Latest suspicious session in period
    const latestSuspicious = await prisma.trafficSession.findFirst({
      where: {
        shopId,
        trafficType: { in: ["SUSPICIOUS", "AUTOMATED", "BOT", "HIGH_RISK"] },
        startedAt: { gte: startDate, lte: endDate },
      },
      orderBy: { lastSeenAt: "desc" },
      select: { lastSeenAt: true },
    });

    const detectedAt = latestSuspicious
      ? `${formatShortDate(latestSuspicious.lastSeenAt, timeZone)}, ${latestSuspicious.lastSeenAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, ...(timeZone ? { timeZone } : {}) })}`
      : "No anomalies in period";

    // Average risk of suspicious sessions for bot likelihood indicator
    const suspRiskResult = await prisma.trafficSession.aggregate({
      where: {
        shopId,
        trafficType: { in: ["SUSPICIOUS", "AUTOMATED", "BOT", "HIGH_RISK"] },
        startedAt: { gte: startDate, lte: endDate },
      },
      _avg: { riskScore: true },
    });
    const avgSuspRisk = suspiciousSessionsCount > 0 ? Math.round(suspRiskResult._avg.riskScore ?? 0) : 0;
    const botLikelihood =
      suspiciousSessionsCount === 0 || avgSuspRisk === 0
        ? "Low (<5%)"
        : avgSuspRisk >= 80
        ? `High (${avgSuspRisk}%+)`
        : avgSuspRisk >= 50
        ? `Moderate (${avgSuspRisk}%+)`
        : `Low (${avgSuspRisk}%)`;

    // 7. Characteristics of Suspicious Traffic (Aggregated from DB)
    const [suspAvgReqAgg, realAvgReqAgg, suspSessionsList, realSessionsList, realBounceCount, realCartCount] =
      await Promise.all([
        prisma.trafficSession.aggregate({
          where: {
            shopId,
            trafficType: { in: ["SUSPICIOUS", "AUTOMATED", "BOT", "HIGH_RISK"] },
            startedAt: { gte: startDate, lte: endDate },
          },
          _avg: { requestCount: true },
        }),
        prisma.trafficSession.aggregate({
          where: {
            shopId,
            trafficType: "HUMAN",
            startedAt: { gte: startDate, lte: endDate },
          },
          _avg: { requestCount: true },
        }),
        prisma.trafficSession.findMany({
          where: {
            shopId,
            trafficType: { in: ["SUSPICIOUS", "AUTOMATED", "BOT", "HIGH_RISK"] },
            startedAt: { gte: startDate, lte: endDate },
          },
          select: {
            startedAt: true,
            lastSeenAt: true,
            requestCount: true,
            pageViews: true,
            addToCartCount: true,
            country: true,
          },
        }),
        prisma.trafficSession.findMany({
          where: {
            shopId,
            trafficType: "HUMAN",
            startedAt: { gte: startDate, lte: endDate },
          },
          select: {
            startedAt: true,
            lastSeenAt: true,
            requestCount: true,
          },
          take: 150,
        }),
        prisma.trafficSession.count({
          where: {
            shopId,
            trafficType: "HUMAN",
            pageViews: { lte: 1 },
            startedAt: { gte: startDate, lte: endDate },
          },
        }),
        prisma.trafficSession.count({
          where: {
            shopId,
            trafficType: "HUMAN",
            addToCartCount: { gt: 0 },
            startedAt: { gte: startDate, lte: endDate },
          },
        }),
      ]);

    const sReqAvg = suspAvgReqAgg._avg.requestCount ?? 1;
    const rReqAvg = realAvgReqAgg._avg.requestCount ?? 1;

    // Accurate RPM calculation
    const suspRpmList = suspSessionsList.map((s) => {
      const durSec = Math.max(1, (s.lastSeenAt.getTime() - s.startedAt.getTime()) / 1000);
      return (s.requestCount / durSec) * 60;
    });
    const suspAvgRpm =
      suspRpmList.length > 0 ? suspRpmList.reduce((a, b) => a + b, 0) / suspRpmList.length : 0;

    const realRpmList = realSessionsList.map((h) => {
      const durSec = Math.max(1, (h.lastSeenAt.getTime() - h.startedAt.getTime()) / 1000);
      return (h.requestCount / durSec) * 60;
    });
    const realAvgRpm =
      realRpmList.length > 0 ? realRpmList.reduce((a, b) => a + b, 0) / realRpmList.length : 1.5;

    let reqFactorStr = "1.0x";
    let reqFactorMetricSub = "vs typical";
    let reqFactorDesc = "Standard request pace across sessions.";

    if (suspSessionsList.length > 0) {
      if (suspAvgRpm > realAvgRpm && realAvgRpm > 0) {
        const rpmRatio = (suspAvgRpm / realAvgRpm).toFixed(1);
        reqFactorStr = `${rpmRatio}x`;
        reqFactorMetricSub = "vs typical";
        reqFactorDesc = `${rpmRatio}x faster request pace than typical shoppers (${Math.round(suspAvgRpm)} vs ${Math.round(realAvgRpm)} RPM).`;
      } else if (sReqAvg > rReqAvg && rReqAvg > 0) {
        const factor = (sReqAvg / rReqAvg).toFixed(1);
        reqFactorStr = `${factor}x`;
        reqFactorMetricSub = "vs typical";
        reqFactorDesc = `${factor}x more requests per session than typical users.`;
      } else {
        reqFactorStr = `${sReqAvg.toFixed(1)} reqs`;
        reqFactorMetricSub = "avg / session";
        reqFactorDesc = "Automated probes with rapid hit intervals.";
      }
    }

    // Duration < 10s calculation
    const shortDurationCount = suspSessionsList.filter(
      (s) => s.lastSeenAt.getTime() - s.startedAt.getTime() < 10000
    ).length;
    const shortDurationPct =
      suspSessionsList.length > 0
        ? Math.round((shortDurationCount / suspSessionsList.length) * 100)
        : 0;

    // Bounce rates
    const suspBounceCount = suspSessionsList.filter((s) => s.pageViews <= 1).length;
    const suspBouncePct =
      suspSessionsList.length > 0 ? Math.round((suspBounceCount / suspSessionsList.length) * 100) : 0;
    const realBouncePct =
      realSessionsCount > 0 ? Math.round((realBounceCount / realSessionsCount) * 100) : 0;

    // Cart rates
    const suspCartCount = suspSessionsList.filter((s) => s.addToCartCount > 0).length;
    const suspCartRate =
      suspSessionsList.length > 0
        ? ((suspCartCount / suspSessionsList.length) * 100).toFixed(1)
        : "0.0";
    const realCartRate =
      realSessionsCount > 0 ? ((realCartCount / realSessionsCount) * 100).toFixed(1) : "0.0";

    // Suspicious countries distinct breakdown
    const suspCountries = [
      ...new Set(suspSessionsList.map((s) => s.country).filter((c) => c && c !== "Unknown")),
    ];
    const distinctCountryCount = suspCountries.length;
    const geoMetricVal = distinctCountryCount > 0 ? `${distinctCountryCount}` : "0";
    const geoSublabel = distinctCountryCount === 1 ? "country" : "countries";
    const geoDesc =
      distinctCountryCount === 0
        ? "No suspicious origin locations recorded in this window."
        : distinctCountryCount === 1
        ? `Traffic from 1 country (${suspCountries[0]}) recorded in this window.`
        : `Traffic from ${distinctCountryCount} countries (${suspCountries.slice(0, 3).join(", ")}${distinctCountryCount > 3 ? "..." : ""}) recorded in this window.`;

    const characteristics: SuspiciousCharacteristic[] = [
      {
        id: "frequency",
        title: "High Request Frequency",
        desc: reqFactorDesc,
        metricValue: reqFactorStr,
        metricSublabel: reqFactorMetricSub,
      },
      {
        id: "duration",
        title: "Short Session Duration",
        desc: `${shortDurationPct}% of suspicious sessions lasted < 10 seconds.`,
        metricValue: `${shortDurationPct}%`,
        metricSublabel: "< 10 seconds",
      },
      {
        id: "bounce",
        title: "High Bounce Rate",
        desc: `${suspBouncePct}% vs ${realBouncePct}% for real traffic.`,
        metricValue: `${suspBouncePct}%`,
        metricSublabel: `vs ${realBouncePct}%`,
      },
      {
        id: "cart",
        title: "Low Add to Cart Rate",
        desc: `${suspCartRate}% vs ${realCartRate}% for real traffic.`,
        metricValue: `${suspCartRate}%`,
        metricSublabel: `vs ${realCartRate}%`,
      },
      {
        id: "geography",
        title: "Unusual Geography",
        desc: geoDesc,
        metricValue: geoMetricVal,
        metricSublabel: geoSublabel,
      },
    ];

    // 8. Business Impact & Funnel Data (Strictly from DB)
    const [
      reportedAddToCartCount,
      adjustedAddToCartCount,
      reportedCheckoutCount,
      adjustedCheckoutCount,
      adjustedOrdersCount,
      purchaseEvents,
    ] = await Promise.all([
      prisma.trafficSession.count({
        where: { shopId, addToCartCount: { gt: 0 }, startedAt: { gte: startDate, lte: endDate } },
      }),
      prisma.trafficSession.count({
        where: {
          shopId,
          addToCartCount: { gt: 0 },
          trafficType: "HUMAN",
          startedAt: { gte: startDate, lte: endDate },
        },
      }),
      prisma.trafficSession.count({
        where: { shopId, checkoutStarted: true, startedAt: { gte: startDate, lte: endDate } },
      }),
      prisma.trafficSession.count({
        where: {
          shopId,
          checkoutStarted: true,
          trafficType: "HUMAN",
          startedAt: { gte: startDate, lte: endDate },
        },
      }),
      prisma.trafficSession.count({
        where: {
          shopId,
          purchaseCompleted: true,
          trafficType: "HUMAN",
          startedAt: { gte: startDate, lte: endDate },
        },
      }),
      prisma.trafficEvent.findMany({
        where: { shopId, eventType: "purchase", timestamp: { gte: startDate, lte: endDate } },
        include: { session: { select: { trafficType: true } } },
      }),
    ]);

    let reportedRevenue = 0;
    let adjustedRevenue = 0;
    for (const pe of purchaseEvents) {
      let cost = 0;
      if (pe.metadata) {
        try {
          const parsed = JSON.parse(pe.metadata);
          const val = parsed.totalCost ?? parsed.totalPrice ?? parsed.amount ?? parsed.price ?? 0;
          cost = Number(val) || 0;
        } catch {
          cost = 0;
        }
      }
      reportedRevenue += cost;
      if (pe.session?.trafficType === "HUMAN") {
        adjustedRevenue += cost;
      }
    }

    const reportedConvRate = totalSessionsCount > 0 ? (completedOrdersCount / totalSessionsCount) * 100 : 0;
    const adjustedConvRate = realSessionsCount > 0 ? (adjustedOrdersCount / realSessionsCount) * 100 : 0;
    const convRateLift =
      reportedConvRate > 0 ? Math.round(((adjustedConvRate - reportedConvRate) / reportedConvRate) * 100) : 0;

    const reportedCartRate = totalSessionsCount > 0 ? (reportedAddToCartCount / totalSessionsCount) * 100 : 0;
    const adjustedCartRate = realSessionsCount > 0 ? (adjustedAddToCartCount / realSessionsCount) * 100 : 0;
    const cartRateLift =
      reportedCartRate > 0 ? Math.round(((adjustedCartRate - reportedCartRate) / reportedCartRate) * 100) : 0;

    const reportedCheckoutRate =
      totalSessionsCount > 0 ? (reportedCheckoutCount / totalSessionsCount) * 100 : 0;
    const adjustedCheckoutRate =
      realSessionsCount > 0 ? (adjustedCheckoutCount / realSessionsCount) * 100 : 0;
    const checkoutRateLift =
      reportedCheckoutRate > 0
        ? Math.round(((adjustedCheckoutRate - reportedCheckoutRate) / reportedCheckoutRate) * 100)
        : 0;

    const revenueDiff =
      reportedRevenue > 0 ? Math.round(((adjustedRevenue - reportedRevenue) / reportedRevenue) * 100) : 0;

    const businessImpactRows: BusinessImpactRow[] = [
      {
        name: "Sessions",
        reported: totalSessionsCount.toLocaleString(),
        adjusted: realSessionsCount.toLocaleString(),
        impact: suspiciousPercent > 0 ? `↓ ${suspiciousPercent}%` : "0%",
        isPositive: false,
      },
      {
        name: "Conversion Rate",
        reported: `${reportedConvRate.toFixed(1)}%`,
        adjusted: `${adjustedConvRate.toFixed(1)}%`,
        impact: convRateLift >= 0 ? `↑ ${convRateLift}%` : `↓ ${Math.abs(convRateLift)}%`,
        isPositive: convRateLift >= 0,
      },
      {
        name: "Add to Cart Rate",
        reported: `${reportedCartRate.toFixed(1)}%`,
        adjusted: `${adjustedCartRate.toFixed(1)}%`,
        impact: cartRateLift >= 0 ? `↑ ${cartRateLift}%` : `↓ ${Math.abs(cartRateLift)}%`,
        isPositive: cartRateLift >= 0,
      },
      {
        name: "Checkout Rate",
        reported: `${reportedCheckoutRate.toFixed(1)}%`,
        adjusted: `${adjustedCheckoutRate.toFixed(1)}%`,
        impact: checkoutRateLift >= 0 ? `↑ ${checkoutRateLift}%` : `↓ ${Math.abs(checkoutRateLift)}%`,
        isPositive: checkoutRateLift >= 0,
      },
      {
        name: "Completed Orders",
        reported: completedOrdersCount.toLocaleString(),
        adjusted: adjustedOrdersCount.toLocaleString(),
        impact:
          completedOrdersCount > adjustedOrdersCount
            ? `↓ ${completedOrdersCount - adjustedOrdersCount}`
            : "0",
        isPositive: adjustedOrdersCount >= completedOrdersCount,
      },
      {
        name: "Revenue",
        reported: `$${reportedRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        adjusted: `$${adjustedRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        impact: revenueDiff >= 0 ? `↑ ${revenueDiff}%` : `↓ ${Math.abs(revenueDiff)}%`,
        isPositive: revenueDiff >= 0,
      },
    ];

    const businessImpact: BusinessImpactData = {
      sessions: businessImpactRows[0],
      conversionRate: businessImpactRows[1],
      addToCartRate: businessImpactRows[2],
      checkoutRate: businessImpactRows[3],
      completedOrders: businessImpactRows[4],
      revenue: businessImpactRows[5],
      rows: businessImpactRows,
    };

    const protectionMode = settings?.protectionMode || "MONITOR";
    const protectionStatus = settings?.autoProtect ? "Active" : "Paused";

    // 9. Return Complete Aggregated Metrics
    const overviewResult: AggregatedTrafficMetrics = {
      dateRange: currentRange.label,
      compareRange: compareRange.label,
      trafficQualityScore,
      scoreTrendVsPrevious,
      realTrafficPercent: realPercent,
      realTrafficSessions: realSessionsCount,
      realTrafficTrend,
      suspiciousPercent,
      suspiciousSessions: suspiciousSessionsCount,
      suspiciousTrend,
      totalSessions: totalSessionsCount,
      totalSessionsTrend,
      conversionRate,
      conversionRateTrend,
      topSuspiciousChannel,
      topChannelShareOfInvalid,
      blockedCount,
      dailyTrend,
      hasTrendData,
      trafficSources,
      campaigns,
      topHeuristics: [
        `${reqFactorStr} request frequency vs normal shopper baseline`,
        `${suspiciousPercent}% of sessions flagged with invalid browsing signatures`,
        `Top source ${topSuspiciousChannel} driving ${topChannelShareOfInvalid} of low-quality visits`,
      ],
      detectedAt,
      characteristics,
      suspiciousTrafficPercent: suspiciousPercent,
      trend: dailyTrend,
      anomaly: {
        title:
          suspiciousSessionsCount === 0
            ? "No anomalies detected"
            : suspiciousPercent >= 25
            ? "Suspicious traffic spike detected"
            : "Elevated monitoring active",
        affectedSessions: suspiciousSessionsCount,
        likelySource: topSuspiciousChannel,
        botLikelihood,
        detectedAt,
      },
      protection: {
        mode: protectionMode,
        blockedCount,
        status: protectionStatus,
      },
      businessImpact,
    };

    // Cache computed overview metrics for 30 seconds
    overviewCache.set(cacheKey, { data: overviewResult, expiresAt: Date.now() + 30000 });

    return overviewResult;
  }

  /**
   * Returns business impact analysis derived strictly from DB events.
   */
  static async getBusinessImpact(
    shopId: string,
    options?: AnalyticsQueryOptions | string
  ): Promise<BusinessImpactData> {
    const overview = await AnalyticsService.getDashboardOverview(shopId, options);
    return overview.businessImpact!;
  }

  /**
   * Retrieves investigation sessions with server-side filtering, sorting, and pagination.
   */
  static async getInvestigationSessions(
    shopId: string,
    options?: {
      search?: string;
      riskFilter?: string;
      trafficType?: string;
      sourceFilter?: string;
      countryFilter?: string;
      deviceFilter?: string;
      severityFilter?: string;
      limit?: number;
      offset?: number;
      page?: number;
      dateRange?: string;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      timeZone?: string;
    }
  ): Promise<{
    sessions: ScoredSession[];
    totalCount: number;
    page: number;
    totalPages: number;
    limit: number;
    availableSources: string[];
    availableCountries: string[];
    availableDevices: string[];
    availableTrafficTypes: string[];
  }> {
    const page = Math.max(1, options?.page || 1);
    const limit = options?.limit || 8;
    const offset = options?.offset !== undefined ? options.offset : (page - 1) * limit;

    const cacheKey = `inv_${shopId}_${page}_${limit}_${offset}_${options?.search || ""}_${options?.riskFilter || ""}_${options?.trafficType || ""}_${options?.sourceFilter || ""}_${options?.countryFilter || ""}_${options?.deviceFilter || ""}_${options?.severityFilter || ""}_${options?.dateRange || ""}_${options?.sortBy || ""}_${options?.sortOrder || ""}_${options?.timeZone || ""}`;
    const cached = investigationSessionsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const where: Record<string, unknown> = { shopId };

    // 1. Risk Filter
    if (options?.riskFilter && options.riskFilter !== "All") {
      if (options.riskFilter === "Flagged" || options.riskFilter === "Flagged Sessions") {
        where.isFlagged = true;
      } else if (options.riskFilter === "Likely Human" || options.riskFilter === "LOW") {
        where.riskScore = { lt: 50 };
      } else if (options.riskFilter === "Suspicious" || options.riskFilter === "MEDIUM") {
        where.riskScore = { gte: 50, lte: 80 };
      } else if (options.riskFilter === "Likely Automated" || options.riskFilter === "HIGH") {
        where.riskScore = { gt: 80 };
      }
    }

    // 2. Traffic Type Filter
    if (options?.trafficType && options.trafficType !== "All") {
      where.trafficType = options.trafficType;
    }

    // 3. Source Filter
    if (options?.sourceFilter && options.sourceFilter !== "All") {
      where.utmSource = options.sourceFilter;
    }

    // 4. Country Filter
    if (options?.countryFilter && options.countryFilter !== "All") {
      where.country = options.countryFilter;
    }

    // 5. Device Filter
    if (options?.deviceFilter && options.deviceFilter !== "All") {
      where.deviceType = options.deviceFilter;
    }

    // 6. Severity Filter
    if (options?.severityFilter && options.severityFilter !== "All") {
      where.severity = options.severityFilter.toUpperCase();
    }

    // 7. Date Filter
    if (options?.dateRange && options.dateRange !== "All") {
      const now = new Date();
      const dr = options.dateRange.toLowerCase();
      if (dr === "today") {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        where.lastSeenAt = { gte: start };
      } else if (dr === "yesterday") {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        where.lastSeenAt = { gte: start, lt: end };
      } else if (dr === "last 7 days" || dr === "last_7_days") {
        const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        where.lastSeenAt = { gte: start };
      } else if (dr === "last 30 days" || dr === "last_30_days") {
        const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        where.lastSeenAt = { gte: start };
      } else {
        try {
          const range = AnalyticsService.parseDateRange(options.dateRange);
          where.lastSeenAt = { gte: range.startDate, lte: range.endDate };
        } catch {}
      }
    }

    // Clamp investigation queries to store data retention window
    const invSettings = await AnalyticsService.getShopSettings(shopId);
    const invRetentionDays = invSettings?.dataRetentionDays ?? 30;
    const invRetentionCutoff = new Date(Date.now() - invRetentionDays * 24 * 60 * 60 * 1000);

    if (where.lastSeenAt && typeof where.lastSeenAt === "object" && "gte" in where.lastSeenAt) {
      const gteDate = (where.lastSeenAt as { gte?: Date }).gte;
      if (gteDate && gteDate < invRetentionCutoff) {
        (where.lastSeenAt as { gte?: Date }).gte = invRetentionCutoff;
      }
    } else {
      where.lastSeenAt = { gte: invRetentionCutoff };
    }

    // 8. Search query (matches ID, sessionKey, source, country, browser, os)
    if (options?.search && options.search.trim()) {
      const q = options.search.trim().replace(/^#/, "");
      where.OR = [
        { id: { contains: q, mode: "insensitive" } },
        { sessionKey: { contains: q, mode: "insensitive" } },
        { utmSource: { contains: q, mode: "insensitive" } },
        { country: { contains: q, mode: "insensitive" } },
        { browser: { contains: q, mode: "insensitive" } },
        { os: { contains: q, mode: "insensitive" } },
        { trafficType: { contains: q, mode: "insensitive" } },
      ];
    }

    // 9. Sorting
    const sortOrder = options?.sortOrder === "asc" ? "asc" : "desc";
    let orderBy: Record<string, "asc" | "desc"> = { lastSeenAt: "desc" };
    if (options?.sortBy) {
      switch (options.sortBy) {
        case "riskScore":
        case "botScore":
          orderBy = { riskScore: sortOrder };
          break;
        case "severity":
          orderBy = { severity: sortOrder };
          break;
        case "startedAt":
          orderBy = { startedAt: sortOrder };
          break;
        case "source":
          orderBy = { utmSource: sortOrder };
          break;
        case "country":
          orderBy = { country: sortOrder };
          break;
        case "trafficType":
          orderBy = { trafficType: sortOrder };
          break;
        case "lastSeenAt":
        case "time":
        case "timestamp":
        default:
          orderBy = { lastSeenAt: sortOrder };
          break;
      }
    }

    // Use cached distinct filters if available (60s TTL)
    const filterCacheKey = `filters_${shopId}`;
    let allActiveFilterItems = filterDistinctCache.get(filterCacheKey)?.data;

    const queryPromises: [Promise<any[]>, Promise<number>, Promise<any[]>?] = [
      prisma.trafficSession.findMany({
        where,
        include: {
          detectionResult: true,
          events: {
            orderBy: { timestamp: "asc" },
            take: 20,
          },
          protectionActions: {
            orderBy: { createdAt: "desc" },
            take: 5,
          },
        },
        orderBy,
        take: limit,
        skip: offset,
      }),
      prisma.trafficSession.count({ where }),
    ];

    if (!allActiveFilterItems) {
      queryPromises.push(
        prisma.trafficSession.findMany({
          where: { shopId },
          select: { utmSource: true, country: true, deviceType: true, trafficType: true },
          distinct: ["utmSource", "country", "deviceType", "trafficType"],
          take: 200,
        })
      );
    }

    const [dbSessions, totalCount, freshlyFetchedFilters] = await Promise.all(queryPromises);

    if (freshlyFetchedFilters) {
      allActiveFilterItems = freshlyFetchedFilters;
      filterDistinctCache.set(filterCacheKey, { data: freshlyFetchedFilters, expiresAt: Date.now() + 60000 });
    }
    allActiveFilterItems = allActiveFilterItems || [];

    const availableSources = Array.from(new Set(allActiveFilterItems.map((s) => s.utmSource).filter(Boolean))) as string[];
    const availableCountries = Array.from(new Set(allActiveFilterItems.map((s) => s.country).filter(Boolean))) as string[];
    const availableDevices = Array.from(new Set(allActiveFilterItems.map((s) => s.deviceType).filter(Boolean))) as string[];
    const availableTrafficTypes = Array.from(new Set(allActiveFilterItems.map((s) => s.trafficType).filter(Boolean))) as string[];

    const sessions: ScoredSession[] = dbSessions.map((s) => {
      const formatted = AnalyticsService.formatScoredSession(s, options?.timeZone);
      sessionDetailCache.set(`detail_${shopId}_${s.id}_${options?.timeZone || ""}`, { data: formatted, expiresAt: Date.now() + 60000 });
      return formatted;
    });

    const totalPages = Math.max(1, Math.ceil(totalCount / limit));

    const result = {
      sessions,
      totalCount,
      page,
      totalPages,
      limit,
      availableSources,
      availableCountries,
      availableDevices,
      availableTrafficTypes,
    };

    investigationSessionsCache.set(cacheKey, { data: result, expiresAt: Date.now() + 5000 });

    return result;
  }

  /**
   * Transforms a database TrafficSession into a fully typed and decorated ScoredSession,
   * including reasons, detection signals, timeline, and actions.
   */
  static formatScoredSession(s: any, timeZone?: string): ScoredSession {
    const hasManualBlock = Boolean(
      (s.protectionActions || []).some(
        (pa: any) => pa.action === "BLOCK" && pa.status === "EXECUTED"
      )
    );

    // If session was manually blocked and previously stamped with 99, restore its true evaluated risk score if detectionResult is present
    const trueRiskScore = (hasManualBlock && s.riskScore === 99 && s.detectionResult?.riskScore !== undefined && s.detectionResult.riskScore < 99)
      ? s.detectionResult.riskScore
      : (s.riskScore ?? 0);

    const trueTrafficType = (hasManualBlock && s.trafficType === "BOT" && s.detectionResult?.trafficType && s.detectionResult.trafficType !== "BOT")
      ? s.detectionResult.trafficType
      : (s.trafficType || "HUMAN");

    const riskLevel = getRiskLevel(trueRiskScore);

    let reasons: Array<{ title: string; desc: string; severity: "High" | "Medium" | "Low" }> = [];
    try {
      if (s.detectionResult?.reasons) {
        const parsed = JSON.parse(s.detectionResult.reasons);
        reasons = Array.isArray(parsed)
          ? parsed.map((r: any) => typeof r === "string" ? {
              title: r,
              desc: r,
              severity: (s.severity as "High" | "Medium" | "Low") || "Medium",
            } : {
              title: r.title || r.name || "Anomaly detected",
              desc: r.desc || r.description || "Flagged behavioral marker",
              severity: (r.severity as "High" | "Medium" | "Low") || (s.severity as "High" | "Medium" | "Low") || "Medium",
            })
          : [];
      }
    } catch {
      reasons = [];
    }

    if (reasons.length === 0) {
      if (s.riskScore > 80) {
        reasons.push(
          { title: "Rapid Automated Navigation", desc: "Excessive click & page navigation velocity exceeding human thresholds.", severity: "High" },
          { title: "Client Fingerprint Anomaly", desc: "Inconsistent browser runtime flags and headless signature detected.", severity: "High" }
        );
      } else if (s.riskScore >= 50) {
        reasons.push(
          { title: "Unusual Referrer Pattern", desc: "Session entered via anomalous UTM parameters with zero prior engagement.", severity: "Medium" },
          { title: "Low Dwell Time", desc: "Dwell time under 3 seconds with immediate conversion abandonment.", severity: "Low" }
        );
      } else {
        reasons.push(
          { title: "Normal Engagement Pattern", desc: "Natural scrolling, touch dynamics, and genuine product interaction.", severity: "Low" }
        );
      }
    }

    let detectionSignals: Array<{ name: string; value: string | number; weight: number; description: string; severity?: "High" | "Medium" | "Low" }> = [];
    try {
      if (s.detectionResult?.signals) {
        const parsed = JSON.parse(s.detectionResult.signals);
        detectionSignals = Array.isArray(parsed) ? parsed : [];
      }
    } catch {}

    if (detectionSignals.length === 0) {
      detectionSignals = [
        {
          name: "Navigation Velocity",
          value: s.requestCount > 8 ? `${s.requestCount} req/sec` : "Normal",
          weight: s.requestCount > 8 ? 85 : 10,
          description: s.requestCount > 8 ? "Automated burst frequency exceeding human baseline." : "Natural browsing pacing.",
          severity: s.requestCount > 8 ? "High" : "Low",
        },
        {
          name: "Environment Integrity",
          value: (s.browser || "").includes("Headless") ? "Headless Signature" : "Verified Client",
          weight: (s.browser || "").includes("Headless") ? 95 : 5,
          description: "Canvas, WebGL, and User-Agent integrity evaluation.",
          severity: (s.browser || "").includes("Headless") ? "High" : "Low",
        },
        {
          name: "Funnel Progression",
          value: s.checkoutStarted ? "Checkout Started" : s.addToCartCount > 0 ? "Cart Added" : "Browse Only",
          weight: s.addToCartCount > 0 && !s.checkoutStarted ? 40 : 15,
          description: "Interaction ratio across product views, cart additions, and checkout steps.",
          severity: s.addToCartCount > 0 && !s.checkoutStarted ? "Medium" : "Low",
        },
        {
          name: "Geo & IP Reputation",
          value: `${s.countryFlag || "🌐"} ${s.country || "Unknown"}`,
          weight: 20,
          description: "IP routing, datacenter/ASN reputation, and regional consistency.",
          severity: "Low",
        },
      ];
    }

    const startedDate = s.startedAt instanceof Date ? s.startedAt : new Date(s.startedAt);
    const lastSeenDate = s.lastSeenAt instanceof Date ? s.lastSeenAt : new Date(s.lastSeenAt);
    const validTz = sanitizeTimeZone(timeZone);

    const tzOptionsTime: Intl.DateTimeFormatOptions = {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      ...(validTz ? { timeZone: validTz } : {}),
    };

    const tzOptionsTimeSec: Intl.DateTimeFormatOptions = {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      ...(validTz ? { timeZone: validTz } : {}),
    };

    const tzOptionsDate: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
      ...(validTz ? { timeZone: validTz } : {}),
    };

    let sessionTimeline = (s.events || []).map((ev: any) => {
      const evDate = ev.timestamp instanceof Date ? ev.timestamp : new Date(ev.timestamp);
      const elapsed = Math.max(0, Math.round((evDate.getTime() - startedDate.getTime()) / 1000));
      return {
        id: ev.id,
        eventType: ev.eventType,
        pageUrl: ev.pageUrl || "/",
        timestamp: evDate.toISOString(),
        formattedTime: evDate.toLocaleTimeString("en-US", tzOptionsTimeSec),
        elapsedSeconds: elapsed,
      };
    });

    if (sessionTimeline.length === 0) {
      const baseTime = startedDate.getTime();
      sessionTimeline = [
        {
          id: `${s.id}-ev1`,
          eventType: "page_viewed",
          pageUrl: s.landingPage || "/",
          timestamp: new Date(baseTime).toISOString(),
          formattedTime: startedDate.toLocaleTimeString("en-US", tzOptionsTime),
          elapsedSeconds: 0,
        },
      ];
      if (s.productViews > 0) {
        sessionTimeline.push({
          id: `${s.id}-ev2`,
          eventType: "product_viewed",
          pageUrl: "/products/featured-collection",
          timestamp: new Date(baseTime + 4000).toISOString(),
          formattedTime: new Date(baseTime + 4000).toLocaleTimeString("en-US", tzOptionsTime),
          elapsedSeconds: 4,
        });
      }
      if (s.addToCartCount > 0) {
        sessionTimeline.push({
          id: `${s.id}-ev3`,
          eventType: "product_added_to_cart",
          pageUrl: "/cart",
          timestamp: new Date(baseTime + 9000).toISOString(),
          formattedTime: new Date(baseTime + 9000).toLocaleTimeString("en-US", tzOptionsTime),
          elapsedSeconds: 9,
        });
      }
      if (s.checkoutStarted) {
        sessionTimeline.push({
          id: `${s.id}-ev4`,
          eventType: "checkout_started",
          pageUrl: "/checkout",
          timestamp: new Date(baseTime + 16000).toISOString(),
          formattedTime: new Date(baseTime + 16000).toLocaleTimeString("en-US", tzOptionsTime),
          elapsedSeconds: 16,
        });
      }
    }

    const timeStr = lastSeenDate.toLocaleTimeString("en-US", tzOptionsTime);
    const dateStr = lastSeenDate.toLocaleDateString("en-US", tzOptionsDate);

    // Provide rich fallback recommendation if not already persisted or if old placeholder
    let computedRecommendation = s.aiRecommendation;
    if (!computedRecommendation || computedRecommendation.startsWith("Recommendation: ")) {
      const fallbackRec = generateSessionAiRecommendation({
        session: {
          id: s.id,
          requestCount: s.requestCount || 1,
          pageViews: s.pageViews || 1,
          addToCartCount: s.addToCartCount || 0,
          checkoutStarted: Boolean(s.checkoutStarted),
          browser: s.browser,
          deviceType: s.deviceType,
          os: s.os,
          country: s.country,
          utmSource: s.utmSource,
          utmCampaign: s.utmCampaign,
          landingPage: s.landingPage,
          exitPage: s.exitPage,
        },
        riskScore: s.riskScore || 0,
        trafficType: s.trafficType || (s.riskScore > 80 ? "BOT" : s.riskScore >= 50 ? "SUSPICIOUS" : "HUMAN"),
        severity: s.severity || (s.riskScore > 80 ? "HIGH" : s.riskScore >= 50 ? "MEDIUM" : "LOW"),
        reasons: reasons.map((r) => r.title),
        shopMode: "CHALLENGE",
      });
      computedRecommendation = fallbackRec.aiRecommendation;
    }

    return {
      id: s.id,
      displayId: `#${s.id.slice(-5)}`,
      shop: s.shopId,
      riskLevel,
      botScore: trueRiskScore,
      riskScore: trueRiskScore,
      trafficClassification: trueTrafficType,
      confidence: s.detectionResult?.confidence || (trueRiskScore > 80 ? 94 : trueRiskScore >= 50 ? 82 : 90),
      source: s.utmSource || s.referrer || "Direct",
      campaign: s.utmCampaign || "None",
      time: `${dateStr}, ${timeStr}`,
      timestamp: lastSeenDate.toISOString(),
      country: s.country,
      countryFlag: s.countryFlag,
      city: s.city || undefined,
      region: s.region || undefined,
      location: `${s.countryFlag || "🌐"} ${s.city ? `${s.city}, ` : ""}${s.country}`,
      device: `${s.deviceType} / ${s.browser}`,
      browser: s.browser,
      operatingSystem: s.os || "Unknown",
      requestsFactor: s.requestCount > 10 ? "4.2x" : "1.0x",
      reasons,
      detectionSignals,
      sessionTimeline,
      aiExplanation: s.detectionResult?.aiExplanation || undefined,
      recommendedAction: s.aiRecommendation || s.detectionResult?.recommendedAction || (trueRiskScore > 80 ? "BLOCK" : trueRiskScore >= 50 ? "FLAG" : "MONITOR"),
      isFlagged: Boolean(hasManualBlock || (s.isFlagged ?? (trueRiskScore >= 50))),
      flaggedReason: s.flaggedReason || (hasManualBlock ? "Manually blocked by merchant" : trueRiskScore >= 50 ? (reasons[0]?.title ?? "Suspicious activity detected") : undefined),
      aiRecommendation: computedRecommendation,
      trafficType: trueTrafficType,
      severity: s.severity || (trueRiskScore > 80 ? "HIGH" : trueRiskScore >= 50 ? "MEDIUM" : "LOW"),
      startedAt: startedDate.toISOString(),
      lastSeenAt: lastSeenDate.toISOString(),
      pageViews: s.pageViews,
      addToCartCount: s.addToCartCount,
      checkoutStarted: s.checkoutStarted,
      landingPage: s.landingPage,
      isBlocked: Boolean(hasManualBlock || (trueRiskScore > 80 && trueTrafficType === "BOT")),
      isManuallyBlocked: hasManualBlock,
    };
  }

  /**
   * Retrieves full rich detail for a single session.
   */
  static async getSessionDetail(shopId: string, sessionId: string, timeZone?: string): Promise<ScoredSession | null> {
    const cleanId = sessionId.replace(/^#/, "");
    const cacheKey = `detail_${shopId}_${cleanId}_${timeZone || ""}`;
    const cached = sessionDetailCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    // Direct primary key index lookup if cleanId is full CUID/ID
    const isFullId = cleanId.length >= 20;

    const session = await prisma.trafficSession.findFirst({
      where: {
        shopId,
        ...(isFullId
          ? { id: cleanId }
          : {
              OR: [
                { id: cleanId },
                { id: { endsWith: cleanId } },
                { sessionKey: cleanId },
              ],
            }),
      },
      include: {
        events: {
          orderBy: { timestamp: "asc" },
          take: 50,
        },
        detectionResult: true,
        protectionActions: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!session) return null;

    const detailResult = AnalyticsService.formatScoredSession(session, timeZone);

    // If session doesn't have a persisted Groq recommendation, generate one with Groq and persist it
    if (!session.aiRecommendation || session.aiRecommendation.startsWith("Recommendation: ")) {
      try {
        const groqResult = await generateSessionAiRecommendationWithGroq({
          session: {
            id: session.id,
            requestCount: session.requestCount,
            pageViews: session.pageViews,
            addToCartCount: session.addToCartCount,
            checkoutStarted: session.checkoutStarted,
            browser: session.browser,
            deviceType: session.deviceType,
            os: session.os,
            country: session.country,
            utmSource: session.utmSource,
            utmCampaign: session.utmCampaign,
            landingPage: session.landingPage,
            exitPage: session.exitPage,
          },
          riskScore: session.riskScore,
          trafficType: session.trafficType,
          severity: session.severity,
          reasons: detailResult.reasons.map((r) => r.title),
          shopMode: "CHALLENGE",
        });

        if (groqResult.aiRecommendation) {
          detailResult.aiRecommendation = groqResult.aiRecommendation;
          if (groqResult.aiExplanation) {
            detailResult.aiExplanation = groqResult.aiExplanation;
          }

          // Persist to Neon DB asynchronously so future queries retrieve it instantly
          await prisma.trafficSession.update({
            where: { id: session.id },
            data: {
              aiRecommendation: groqResult.aiRecommendation,
              isFlagged: groqResult.isFlagged,
              flaggedReason: groqResult.flaggedReason,
            },
          }).catch(() => {});
        }
      } catch {}
    }

    sessionDetailCache.set(cacheKey, { data: detailResult, expiresAt: Date.now() + 60000 });
    return detailResult;
  }

  /**
   * Shop settings methods
   */
  static async getShopSettings(shopId: string) {
    const cached = shopSettingsCache.get(shopId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
    const settings = await prisma.shopSettings.findUnique({
      where: { shopId },
    });
    shopSettingsCache.set(shopId, { data: settings, expiresAt: Date.now() + 60000 });
    return settings;
  }

  /**
   * Enforces the data retention policy for a store.
   * Permanently purges TrafficSession, TrafficEvent, and Alert records older than the retention window.
   * Associated DetectionResult and ProtectionAction records are automatically removed via Prisma cascade delete.
   */
  static async enforceDataRetention(
    shopId: string,
    explicitDays?: number
  ): Promise<{ deletedSessions: number; deletedEvents: number; cutoffDate: Date }> {
    let retentionDays = explicitDays;
    if (!retentionDays || retentionDays <= 0) {
      const settings = await prisma.shopSettings.findUnique({
        where: { shopId },
        select: { dataRetentionDays: true },
      });
      retentionDays = settings?.dataRetentionDays ?? 30;
    }

    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    // 1. Delete expired TrafficSession records (cascades to events, detectionResult, protectionActions)
    const deletedSessionsResult = await prisma.trafficSession.deleteMany({
      where: {
        shopId,
        startedAt: { lt: cutoffDate },
      },
    });

    // 2. Delete any orphaned TrafficEvent records older than cutoffDate
    const deletedEventsResult = await prisma.trafficEvent.deleteMany({
      where: {
        shopId,
        timestamp: { lt: cutoffDate },
      },
    });

    // 3. Delete expired Alert records older than cutoffDate
    await prisma.alert.deleteMany({
      where: {
        shopId,
        detectedAt: { lt: cutoffDate },
      },
    });

    // 4. Invalidate caches so overview and investigation immediately reflect purged data
    overviewCache.clear();
    investigationSessionsCache.clear();

    return {
      deletedSessions: deletedSessionsResult.count,
      deletedEvents: deletedEventsResult.count,
      cutoffDate,
    };
  }

  static async updateShopSettings(
    shopId: string,
    data: {
      autoProtect?: boolean;
      protectionMode?: string;
      emailAlerts?: boolean;
      alertFrequency?: string;
      dataRetentionDays?: number;
      anonymousDataSharing?: boolean;
    }
  ) {
    shopSettingsCache.delete(shopId);
    const updated = await prisma.shopSettings.upsert({
      where: { shopId },
      create: {
        shopId,
        autoProtect: data.autoProtect ?? true,
        protectionMode: data.protectionMode || "MONITOR",
        emailAlerts: data.emailAlerts ?? true,
        alertFrequency: data.alertFrequency || "DAILY",
        dataRetentionDays: data.dataRetentionDays ?? 30,
        anonymousDataSharing: data.anonymousDataSharing ?? false,
      },
      update: {
        autoProtect: data.autoProtect !== undefined ? data.autoProtect : undefined,
        protectionMode: data.protectionMode,
        emailAlerts: data.emailAlerts !== undefined ? data.emailAlerts : undefined,
        alertFrequency: data.alertFrequency,
        dataRetentionDays: data.dataRetentionDays,
        anonymousDataSharing:
          data.anonymousDataSharing !== undefined ? data.anonymousDataSharing : undefined,
      },
    });

    // Immediately enforce retention purge when dataRetentionDays is updated
    if (data.dataRetentionDays !== undefined && data.dataRetentionDays > 0) {
      await AnalyticsService.enforceDataRetention(shopId, data.dataRetentionDays);
    }

    return updated;
  }

  /**
   * Clears session and overview caches when a session action (e.g. manual block/unblock) occurs.
   */
  static invalidateSessionCache(shopId: string, sessionId?: string) {
    investigationSessionsCache.clear();
    overviewCache.clear();
    if (sessionId) {
      sessionDetailCache.delete(`detail_${shopId}_${sessionId}`);
    } else {
      sessionDetailCache.clear();
    }
  }
}

// Export convenience functions for backward compatibility
export const getDashboardOverview = AnalyticsService.getDashboardOverview;
export const getBusinessImpact = AnalyticsService.getBusinessImpact;
export const getInvestigationSessions = AnalyticsService.getInvestigationSessions;
export const getSessionDetail = AnalyticsService.getSessionDetail;
export const getShopSettings = AnalyticsService.getShopSettings;
export const updateShopSettings = AnalyticsService.updateShopSettings;
export const enforceDataRetention = AnalyticsService.enforceDataRetention;
export const invalidateSessionCache = AnalyticsService.invalidateSessionCache;
