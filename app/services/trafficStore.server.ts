import type {
  AggregatedTrafficMetrics,
  ScoredSession,
  RawTelemetryEvent,
  TrendDayScore,
} from "../types/insights";
import { evaluateTelemetryEvent } from "./detectionEngine.server";

// Helper functions for dynamic date formatting
function formatShortDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDateRange(startDate: Date, endDate: Date): string {
  const startMonth = startDate.toLocaleDateString("en-US", { month: "short" });
  const endMonth = endDate.toLocaleDateString("en-US", { month: "short" });
  const year = endDate.getFullYear();
  if (startMonth === endMonth) {
    return `${startMonth} ${startDate.getDate()} – ${endDate.getDate()}, ${year}`;
  }
  return `${startMonth} ${startDate.getDate()} – ${endMonth} ${endDate.getDate()}, ${year}`;
}

function getRecentTimeString(minutesAgo: number): string {
  const d = new Date(Date.now() - minutesAgo * 60 * 1000);
  const timeStr = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return `Today, ${timeStr}`;
}

function generateDynamicTrend(): TrendDayScore[] {
  const trend: TrendDayScore[] = [];
  const now = new Date();
  const curveScores = [75, 75, 70, 60, 62, 68, 76];
  const xCoords = [45, 157.5, 270, 382.5, 495, 607.5, 720];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const scoreIndex = 6 - i;
    const score = curveScores[scoreIndex] ?? 72;
    // Map score 0-100 to Y axis
    const y = 145 - (score / 100) * 125;
    trend.push({
      date: formatShortDate(d),
      score,
      x: xCoords[scoreIndex] ?? (45 + scoreIndex * 112.5),
      y: Math.round(y * 10) / 10,
    });
  }
  return trend;
}

// Initial seeded sessions for the investigation view with dynamic recent timestamps
const INITIAL_SESSIONS: ScoredSession[] = [
  {
    id: "#84291",
    shop: "cartmend.myshopify.com",
    riskLevel: "Likely Automated",
    botScore: 96,
    source: "Paid Social",
    time: getRecentTimeString(3),
    country: "United States",
    countryFlag: "🇺🇸",
    device: "Desktop / Chrome",
    requestsFactor: "4.2x",
    reasons: [
      { title: "Abnormally high request frequency", desc: "4.2x more requests than typical users", severity: "High" },
      { title: "Repetitive browsing patterns", desc: "Visited many pages in a very short time", severity: "Medium" },
      { title: "Suspicious IP / ASN", desc: "IP associated with a datacenter / proxy", severity: "High" },
      { title: "Automated browser characteristics", desc: "Headless browser signals detected", severity: "Medium" },
      { title: "Unusual cart behavior", desc: "Added many items to cart rapidly", severity: "Medium" },
    ],
    aiExplanation: "This session shows strong indicators of automated behavior. It generated requests at a much higher rate than normal users and followed a repetitive browsing pattern. The IP is associated with a datacenter and the browser appears to be automated.",
    recommendedAction: "Review the associated Paid Social campaign and audience targeting for unusual placements or traffic sources.",
  },
  {
    id: "#84290",
    shop: "cartmend.myshopify.com",
    riskLevel: "Likely Automated",
    botScore: 94,
    source: "Paid Social",
    time: getRecentTimeString(7),
    country: "United States",
    countryFlag: "🇺🇸",
    device: "Mobile / Safari",
    requestsFactor: "3.8x",
    reasons: [
      { title: "Rapid click pattern", desc: "3.8x faster link clicks than human benchmarks", severity: "High" },
      { title: "Datacenter ASN Origin", desc: "AS14061 DigitalOcean egress node", severity: "High" },
      { title: "Zero mouse movement jitter", desc: "Deterministic trajectory detected", severity: "Medium" },
    ],
    aiExplanation: "Clear automated click farm signature originating from cloud hosting IP block.",
    recommendedAction: "Exclude AS14061 IP subnets from store ingress rules.",
  },
  {
    id: "#84289",
    shop: "cartmend.myshopify.com",
    riskLevel: "Suspicious",
    botScore: 78,
    source: "Paid Social",
    time: getRecentTimeString(14),
    country: "India",
    countryFlag: "🇮🇳",
    device: "Desktop / Firefox",
    requestsFactor: "2.5x",
    reasons: [
      { title: "Unusual geographic distribution", desc: "High traffic volume from off-target region", severity: "Medium" },
      { title: "Repetitive catalog crawling", desc: "Sequential product SKU indexing", severity: "Medium" },
    ],
    aiExplanation: "Scraping bot querying product inventory and variant pricing.",
    recommendedAction: "Apply rate limiting to collection pagination routes.",
  },
  {
    id: "#84288",
    shop: "cartmend.myshopify.com",
    riskLevel: "Suspicious",
    botScore: 72,
    source: "Organic Search",
    time: getRecentTimeString(21),
    country: "Germany",
    countryFlag: "🇩🇪",
    device: "Desktop / Chrome",
    requestsFactor: "2.1x",
    reasons: [
      { title: "Automated search queries", desc: "Submitting dictionary terms in search bar", severity: "Medium" },
    ],
    aiExplanation: "Automated vulnerability scanner checking store search parameters.",
    recommendedAction: "Monitor storefront search queries for SQLi/XSS probing.",
  },
  {
    id: "#84287",
    shop: "cartmend.myshopify.com",
    riskLevel: "Likely Automated",
    botScore: 93,
    source: "Paid Social",
    time: getRecentTimeString(28),
    country: "United States",
    countryFlag: "🇺🇸",
    device: "Desktop / Chrome",
    requestsFactor: "4.0x",
    reasons: [
      { title: "Rapid checkout spamming", desc: "Attempted 12 coupon code combinations in 30s", severity: "High" },
      { title: "Spoofed User Agent", desc: "Browser header mismatch detected", severity: "High" },
    ],
    aiExplanation: "Coupon stuffing bot testing discount code enumeration.",
    recommendedAction: "Enable CAPTCHA on checkout coupon application step.",
  },
  {
    id: "#84286",
    shop: "cartmend.myshopify.com",
    riskLevel: "Suspicious",
    botScore: 69,
    source: "Direct",
    time: getRecentTimeString(36),
    country: "Canada",
    countryFlag: "🇨🇦",
    device: "Mobile / Chrome",
    requestsFactor: "1.9x",
    reasons: [
      { title: "Zero referrer with bounce", desc: "Instant landing on cart without catalog visit", severity: "Medium" },
    ],
    aiExplanation: "Direct cart endpoint probing from unknown referrer.",
    recommendedAction: "Verify webhook integrity for cart session tokens.",
  },
  {
    id: "#84285",
    shop: "cartmend.myshopify.com",
    riskLevel: "Suspicious",
    botScore: 71,
    source: "Referral",
    time: getRecentTimeString(45),
    country: "United Kingdom",
    countryFlag: "🇬🇧",
    device: "Desktop / Safari",
    requestsFactor: "2.2x",
    reasons: [
      { title: "Untrusted referral domain", desc: "Referrer is flagged adware affiliate", severity: "Medium" },
    ],
    aiExplanation: "Low-quality affiliate ad network sending fabricated clicks.",
    recommendedAction: "Review affiliate partner terms and disable suspicious UTM source.",
  },
  {
    id: "#84284",
    shop: "cartmend.myshopify.com",
    riskLevel: "Likely Automated",
    botScore: 95,
    source: "Paid Social",
    time: getRecentTimeString(55),
    country: "United States",
    countryFlag: "🇺🇸",
    device: "Desktop / Edge",
    requestsFactor: "4.5x",
    reasons: [
      { title: "Headless puppeteer fingerprint", desc: "Webdriver flags active in navigator object", severity: "High" },
      { title: "Synthetic interaction timing", desc: "Exact 200ms intervals between page navigations", severity: "High" },
    ],
    aiExplanation: "Puppeteer automation script running web extraction loop.",
    recommendedAction: "Block session fingerprint and ban associated IP.",
  },
  {
    id: "#84283",
    shop: "cartmend.myshopify.com",
    riskLevel: "Suspicious",
    botScore: 67,
    source: "Paid Social",
    time: getRecentTimeString(68),
    country: "United States",
    countryFlag: "🇺🇸",
    device: "Mobile / Safari",
    requestsFactor: "1.8x",
    reasons: [
      { title: "Abnormal scroll speed", desc: "Scrolled entire catalog in 1.2 seconds", severity: "Medium" },
    ],
    aiExplanation: "High probability automated ad click verification crawler.",
    recommendedAction: "Audit Facebook ad placement networks for Audience Network fraud.",
  },
  {
    id: "#84282",
    shop: "cartmend.myshopify.com",
    riskLevel: "Suspicious",
    botScore: 68,
    source: "Organic Search",
    time: getRecentTimeString(82),
    country: "France",
    countryFlag: "🇫🇷",
    device: "Desktop / Chrome",
    requestsFactor: "1.7x",
    reasons: [
      { title: "Fast page hop rate", desc: "No reader dwell time detected", severity: "Medium" },
    ],
    aiExplanation: "SEO competitor scraping tool harvesting product metadata.",
    recommendedAction: "Add anti-scraping honeytrap links in footer.",
  },
  {
    id: "#84281",
    shop: "cartmend.myshopify.com",
    riskLevel: "Likely Human",
    botScore: 8,
    source: "Organic Search",
    time: getRecentTimeString(95),
    country: "United States",
    countryFlag: "🇺🇸",
    device: "Mobile / iOS Safari",
    requestsFactor: "1.0x",
    reasons: [
      { title: "Authentic browsing trajectory", desc: "Natural mouse physics, authentic dwell time, and realistic scrolling", severity: "Low" },
      { title: "Standard shopping behavior", desc: "Viewed 2 product variants and inspected customer reviews", severity: "Low" },
    ],
    aiExplanation: "Verified human visitor. This session exhibits authentic shopper behavior with normal dwell times and expected interaction dynamics.",
    recommendedAction: "No action required. Genuine shopper traffic.",
  },
  {
    id: "#84280",
    shop: "cartmend.myshopify.com",
    riskLevel: "Likely Human",
    botScore: 12,
    source: "Direct",
    time: getRecentTimeString(115),
    country: "Canada",
    countryFlag: "🇨🇦",
    device: "Desktop / Chrome",
    requestsFactor: "0.9x",
    reasons: [
      { title: "Returning customer profile", desc: "Authenticated customer session with past order history", severity: "Low" },
      { title: "Valid checkout navigation", desc: "Organic progression from product to cart and checkout", severity: "Low" },
    ],
    aiExplanation: "Verified human shopper. Clean residential ISP address and standard browser telemetry.",
    recommendedAction: "No action required. High-intent customer.",
  },
];

class TrafficStore {
  private sessions: ScoredSession[] = [...INITIAL_SESSIONS];
  private totalSessionsCount = 23782;
  private suspiciousSessionsCount = 8420;
  private blockedCount = 214;

  public getMetrics(selectedRangeKey?: string, selectedCompareKey?: string): AggregatedTrafficMetrics {
    const now = new Date();
    const last7Start = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    const prevPeriodEnd = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const prevPeriodStart = new Date(now.getTime() - 13 * 24 * 60 * 60 * 1000);

    const defaultDateRange = formatDateRange(last7Start, now);
    const defaultCompareRange = formatDateRange(prevPeriodStart, prevPeriodEnd);

    const dateRange = selectedRangeKey && (selectedRangeKey.includes("–") || selectedRangeKey.includes("-"))
      ? selectedRangeKey
      : defaultDateRange;

    const compareRange = selectedCompareKey && (selectedCompareKey.includes("–") || selectedCompareKey.includes("-"))
      ? selectedCompareKey
      : defaultCompareRange;

    const realSessions = this.totalSessionsCount - this.suspiciousSessionsCount;
    const realPercent = Math.round((realSessions / this.totalSessionsCount) * 100);
    const suspiciousPercent = Math.round((this.suspiciousSessionsCount / this.totalSessionsCount) * 100);

    return {
      dateRange,
      compareRange,
      trafficQualityScore: 72,
      scoreTrendVsPrevious: -14,
      realTrafficPercent: realPercent || 62,
      realTrafficSessions: realSessions,
      realTrafficTrend: 8,
      suspiciousPercent: suspiciousPercent || 38,
      suspiciousSessions: this.suspiciousSessionsCount,
      suspiciousTrend: 26,
      totalSessions: this.totalSessionsCount,
      totalSessionsTrend: 12,
      conversionRate: 1.4,
      conversionRateTrend: -9,
      topSuspiciousChannel: "Paid Social",
      topChannelShareOfInvalid: "59%",
      blockedCount: this.blockedCount,
      dailyTrend: generateDynamicTrend(),
      trafficSources: [
        { label: "Paid Social", count: Math.round(this.suspiciousSessionsCount * 0.59), percent: 59, color: "#ef4444" },
        { label: "Organic Search", count: Math.round(this.suspiciousSessionsCount * 0.18), percent: 18, color: "#3b82f6" },
        { label: "Direct", count: Math.round(this.suspiciousSessionsCount * 0.14), percent: 14, color: "#10b981" },
        { label: "Referral", count: Math.round(this.suspiciousSessionsCount * 0.06), percent: 6, color: "#8b5cf6" },
        { label: "Other", count: Math.round(this.suspiciousSessionsCount * 0.03), percent: 3, color: "#f59e0b" },
      ],
      campaigns: [
        { name: "FB_Conv_April", sessions: Math.round(this.suspiciousSessionsCount * 0.59 * 0.44).toLocaleString(), percent: "44%" },
        { name: "FB_Prospecting_US", sessions: Math.round(this.suspiciousSessionsCount * 0.59 * 0.27).toLocaleString(), percent: "27%" },
        { name: "IG_Story_Sale", sessions: Math.round(this.suspiciousSessionsCount * 0.59 * 0.17).toLocaleString(), percent: "17%" },
        { name: "FB_Retargeting", sessions: Math.round(this.suspiciousSessionsCount * 0.59 * 0.13).toLocaleString(), percent: "13%" },
      ],
      topHeuristics: [
        "Abnormally high request frequency (4.2x)",
        "Datacenter ASN / Cloud hosting proxy",
        "Repetitive automated browsing patterns",
      ],
      detectedAt: `${formatShortDate(now)}, 9:00 AM`,
      characteristics: [
        {
          id: "frequency",
          title: "High Request Frequency",
          desc: "4.2x more requests than typical users.",
          metricValue: "4.2x",
          metricSublabel: "vs typical",
        },
        {
          id: "duration",
          title: "Short Session Duration",
          desc: `${Math.min(92, Math.round(suspiciousPercent * 1.8 + 4))}% of suspicious sessions lasted < 10 seconds.`,
          metricValue: `${Math.min(92, Math.round(suspiciousPercent * 1.8 + 4))}%`,
          metricSublabel: "< 10 seconds",
        },
        {
          id: "bounce",
          title: "High Bounce Rate",
          desc: "89% vs 42% for real traffic.",
          metricValue: "89%",
          metricSublabel: "vs 42%",
        },
        {
          id: "cart",
          title: "Low Add to Cart Rate",
          desc: "2.1% vs 7.6% for real traffic.",
          metricValue: "2.1%",
          metricSublabel: "vs 7.6%",
        },
        {
          id: "geography",
          title: "Unusual Geography",
          desc: "Traffic from 45+ countries with very low engagement.",
          metricValue: "45+",
          metricSublabel: "countries",
        },
      ],
    };
  }

  public getSessions(): ScoredSession[] {
    return this.sessions;
  }

  public recordTelemetry(event: RawTelemetryEvent): ScoredSession {
    const scored = evaluateTelemetryEvent(event);
    this.sessions.unshift(scored);
    if (this.sessions.length > 100) {
      this.sessions.pop();
    }

    this.totalSessionsCount += 1;
    if (scored.riskLevel === "Suspicious" || scored.riskLevel === "Likely Automated") {
      this.suspiciousSessionsCount += 1;
      if (scored.botScore >= 80) {
        this.blockedCount += 1;
      }
    }

    return scored;
  }
}

// Global singleton instance across requests
const globalForTraffic = globalThis as unknown as { traffiqStore: TrafficStore };
export const trafficStore = globalForTraffic.traffiqStore || new TrafficStore();
if (process.env.NODE_ENV !== "production") {
  globalForTraffic.traffiqStore = trafficStore;
}
