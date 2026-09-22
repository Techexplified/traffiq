import { useState, useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useSearchParams, redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import AiInsightsSidebar from "../components/AiInsightsSidebar";
import { getDashboardOverview, getShopSettings } from "../services/analytics.server";
import { getShopByDomain } from "../services/shop.server";
import { generateAiInsights } from "../services/aiInsights.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getShopByDomain(session.shop);
  const url = new URL(request.url);

  // If store has not completed onboarding, guide merchant through onboarding first
  if (!shop || !shop.isOnboarded) {
    const search = url.search ? url.search : `?shop=${session.shop}`;
    throw redirect(`/app/onboarding${search}`);
  }

  const shopId = shop?.id || session.shop;
  const dateRangeParam = url.searchParams.get("dateRange") || undefined;
  const compareRangeParam = url.searchParams.get("compareRange") || undefined;
  const startDateParam = url.searchParams.get("startDate") || undefined;
  const endDateParam = url.searchParams.get("endDate") || undefined;

  const [metrics, settings] = await Promise.all([
    getDashboardOverview(shopId, {
      dateRange: dateRangeParam,
      compareRange: compareRangeParam,
      startDate: startDateParam,
      endDate: endDateParam,
    }),
    getShopSettings(shopId),
  ]);
  const aiInsights = await generateAiInsights(metrics, shopId);
  return {
    shopDomain: session.shop,
    metrics,
    aiInsights,
    settings,
  };
};

interface TrendPoint {
  date: string;
  score: number;
  x: number;
  y: number;
}

function getCharIcon(id: string) {
  switch (id) {
    case "frequency":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="20" x2="18" y2="4" />
          <line x1="12" y1="20" x2="12" y2="10" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
      );
    case "duration":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case "bounce":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
          <polyline points="17 6 23 6 23 12" />
        </svg>
      );
    case "cart":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="21" r="1" />
          <circle cx="20" cy="21" r="1" />
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
        </svg>
      );
    default:
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      );
  }
}

export default function TrafficTruthDashboard() {
  const { shopDomain, metrics, aiInsights, settings } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  const compareRange = searchParams.get("compareRange") || metrics.compareRange || "Previous Period";

  const getModeLabel = (mode?: string) => {
    switch (mode) {
      case "BLOCK":
        return "Block high-risk traffic";
      case "CHALLENGE":
      default:
        return "Challenge suspicious traffic (Default)";
    }
  };
  const protectionMode = getModeLabel(settings?.protectionMode);
  const [showTooltip, setShowTooltip] = useState<string | null>(null);
  const [showSuspiciousModal, setShowSuspiciousModal] = useState(false);
  const [showAiSidebar, setShowAiSidebar] = useState(false);
  const [hoveredPoint, setHoveredPoint] = useState<TrendPoint | null>(null);

  // Pure database calculations - zero mock multipliers
  const currentTotalSessions = metrics.totalSessions;
  const currentSuspiciousSessions = metrics.suspiciousSessions;
  const currentRealSessions = metrics.realTrafficSessions;

  // Trend chart state with independent on-demand fetching
  const [trendTimeRange, setTrendTimeRange] = useState("Last 7 Days");
  const [trendPoints, setTrendPoints] = useState<TrendPoint[]>(
    metrics.dailyTrend && metrics.dailyTrend.length > 0 ? metrics.dailyTrend : []
  );
  const [hasTrendData, setHasTrendData] = useState<boolean>(
    metrics.hasTrendData ?? (metrics.totalSessions > 0)
  );
  const [isTrendLoading, setIsTrendLoading] = useState(false);

  const handleTrendTimeRangeChange = async (newRange: string) => {
    setTrendTimeRange(newRange);
    setIsTrendLoading(true);
    try {
      const res = await fetch(
        `/api/traffic/overview?dateRange=${encodeURIComponent(newRange)}&shop=${encodeURIComponent(shopDomain)}`
      );
      if (res.ok) {
        const data = await res.json();
        const pts: TrendPoint[] = data.metrics?.dailyTrend || [];
        setTrendPoints(pts);
        setHasTrendData(data.metrics?.hasTrendData ?? (data.metrics?.totalSessions > 0));
      } else {
        setHasTrendData(false);
      }
    } catch (err) {
      console.error("Failed to fetch trend data:", err);
      setHasTrendData(false);
    } finally {
      setIsTrendLoading(false);
    }
  };

  const chartPoints: TrendPoint[] = trendPoints;
  const linePathD = chartPoints.reduce((acc, pt, i) => `${acc} ${i === 0 ? "M" : "L"} ${pt.x},${pt.y}`, "");
  const areaFillD = chartPoints.length > 0
    ? `${linePathD} L ${chartPoints[chartPoints.length - 1]?.x ?? 720},145 L ${chartPoints[0]?.x ?? 45},145 Z`
    : "";

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowSuspiciousModal(false);
      }
    };
    if (showSuspiciousModal) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showSuspiciousModal]);

  return (
    <div className="tq-page">
      {/* Header Row - Minimalist, time controls moved to Traffic Quality Trend */}
      <div className="tq-header-row">
        <div className="tq-header-title">
          <h1>Traffic Truth</h1>
          <p>Real-time overview of your store's traffic quality and protection status.</p>
        </div>
      </div>

      {/* Top 5 KPI Cards Row - Exact Match to Screenshot */}
      <div className="tq-grid-5">
        {/* 1. Traffic Quality Score */}
        <div className="tq-card tq-stat-card">
          <div className="tq-stat-header">
            <span>Traffic Quality Score</span>
            <span
              className="tq-info-icon"
              title="Calculated from real shopper engagement vs non-human session signatures."
              onClick={() => setShowTooltip(showTooltip === "score" ? null : "score")}
            >
              ⓘ
            </span>
          </div>
          <div className="tq-stat-value-row">
            <span className="tq-stat-number" style={{ color: metrics.trafficQualityScore >= 70 ? "#16a34a" : metrics.trafficQualityScore >= 40 ? "#d97706" : "#dc2626" }}>
              {metrics.trafficQualityScore}
            </span>
            <span className="tq-stat-subtext" style={{ fontSize: "1.05rem" }}>/100</span>
            <span className={`tq-badge ${metrics.trafficQualityScore >= 70 ? "tq-badge-good" : metrics.trafficQualityScore >= 40 ? "tq-badge-medium" : "tq-badge-high"}`} style={{ marginLeft: "0.35rem" }}>
              {metrics.trafficQualityScore >= 70 ? "Good" : metrics.trafficQualityScore >= 40 ? "Moderate" : "Needs Review"}
            </span>
          </div>
          <div className="tq-stat-trend tq-trend-down-red">
            <span>{metrics.scoreTrendVsPrevious < 0 ? `↓ ${Math.abs(metrics.scoreTrendVsPrevious)}%` : `↑ ${metrics.scoreTrendVsPrevious}%`}</span>
            <span style={{ color: "var(--tq-text-muted)", fontWeight: 500 }}>vs {compareRange}</span>
          </div>
        </div>

        {/* 2. Real Traffic */}
        <div className="tq-card tq-stat-card">
          <div className="tq-stat-header">
            <span>Real Traffic</span>
            <span
              className="tq-info-icon"
              title="Human sessions with genuine browsing patterns."
              onClick={() => setShowTooltip(showTooltip === "real" ? null : "real")}
            >
              ⓘ
            </span>
          </div>
          <div className="tq-stat-value-row">
            <span className="tq-stat-number">{metrics.realTrafficPercent}%</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span className="tq-stat-subtext">{currentRealSessions.toLocaleString()} sessions</span>
            <span className="tq-stat-trend tq-trend-up-green">↑ {metrics.realTrafficTrend}%</span>
          </div>
        </div>

        {/* 3. Suspicious Traffic */}
        <div
          className="tq-card tq-stat-card"
          onClick={() => setShowSuspiciousModal(true)}
          style={{ cursor: "pointer" }}
          title="Click to view characteristics of suspicious traffic"
        >
          <div className="tq-stat-header">
            <span>Suspicious Traffic</span>
            <span
              className="tq-info-icon"
              title="Click to view characteristics of suspicious traffic"
              onClick={(e) => {
                e.stopPropagation();
                setShowSuspiciousModal(true);
              }}
            >
              ⓘ
            </span>
          </div>
          <div className="tq-stat-value-row">
            <span className="tq-stat-number" style={{ color: "#ef4444" }}>{metrics.suspiciousPercent}%</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span className="tq-stat-subtext">{currentSuspiciousSessions.toLocaleString()} sessions</span>
            <span className="tq-stat-trend tq-trend-up-red">↑ {metrics.suspiciousTrend}%</span>
          </div>
        </div>

        {/* 4. Total Sessions */}
        <div className="tq-card tq-stat-card">
          <div className="tq-stat-header">
            <span>Total Sessions</span>
            <span
              className="tq-info-icon"
              title="Aggregate visits recorded across all store traffic."
              onClick={() => setShowTooltip(showTooltip === "sessions" ? null : "sessions")}
            >
              ⓘ
            </span>
          </div>
          <div className="tq-stat-value-row">
            <span className="tq-stat-number">{currentTotalSessions.toLocaleString()}</span>
          </div>
          <div className="tq-stat-trend tq-trend-up-green">
            <span>↑ {metrics.totalSessionsTrend}%</span>
            <span style={{ color: "var(--tq-text-muted)", fontWeight: 500 }}>vs {compareRange}</span>
          </div>
        </div>

        {/* 5. Conversion Rate */}
        <div className="tq-card tq-stat-card">
          <div className="tq-stat-header">
            <span>Conversion Rate</span>
            <span
              className="tq-info-icon"
              title="Completed orders divided by total recorded sessions."
              onClick={() => setShowTooltip(showTooltip === "conversion" ? null : "conversion")}
            >
              ⓘ
            </span>
          </div>
          <div className="tq-stat-value-row">
            <span className="tq-stat-number">{metrics.conversionRate}%</span>
          </div>
          <div className="tq-stat-trend tq-trend-down-red">
            <span>↓ {Math.abs(metrics.conversionRateTrend)}%</span>
            <span style={{ color: "var(--tq-text-muted)", fontWeight: 500 }}>vs {compareRange}</span>
          </div>
        </div>
      </div>

      {/* Main Two-Column Layout (Exact Match to Screenshot) */}
      <div className="tq-dashboard-main-grid">
        {/* LEFT COLUMN: Traffic Quality Trend + AI Summary & Insights */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {/* 1. Traffic Quality Trend Card */}
          <div className="tq-chart-card" style={{ marginBottom: 0 }}>
            <div className="tq-chart-header">
              <div className="tq-chart-header-left">
                <span>Traffic Quality Trend</span>
                <span
                  className="tq-info-icon"
                  title="Daily traffic quality index score from 0 (lowest) to 100 (highest)."
                  onClick={() => setShowTooltip(showTooltip === "trend" ? null : "trend")}
                >
                  ⓘ
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <select
                  className="tq-dropdown"
                  style={{ padding: "0.3rem 0.65rem", fontSize: "0.8rem", borderRadius: "8px" }}
                  value={trendTimeRange}
                  onChange={(e) => handleTrendTimeRangeChange(e.target.value)}
                  disabled={isTrendLoading}
                  aria-label="Select timeframe for traffic quality trend"
                >
                  <option value="Last 7 Days">Last 7 Days</option>
                  <option value="Today">Today (Live)</option>
                  <option value="Yesterday">Yesterday</option>
                  <option value="Last 30 Days">Last 30 Days</option>
                  <option value="Last 90 Days">Last 90 Days</option>
                </select>
              </div>
            </div>

            <div className="tq-chart-wrapper">
              {isTrendLoading && (
                <div className="tq-chart-loading-overlay">
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#2563eb", fontWeight: 500, fontSize: "0.875rem" }}>
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ animation: "spin 1s linear infinite" }}
                    >
                      <circle cx="12" cy="12" r="10" strokeOpacity="0.2" />
                      <path d="M12 2a10 10 0 0 1 10 10" />
                    </svg>
                    <span>Updating trend...</span>
                  </div>
                </div>
              )}

              {chartPoints.length === 0 ? (
                <div className="tq-chart-empty-state">
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="20" x2="18" y2="10" />
                    <line x1="12" y1="20" x2="12" y2="4" />
                    <line x1="6" y1="20" x2="6" y2="14" />
                  </svg>
                  <div className="tq-chart-empty-title">No data available for {trendTimeRange}</div>
                  <div className="tq-chart-empty-subtitle">
                    No traffic sessions recorded in this timeframe.
                  </div>
                </div>
              ) : (
              <svg
                className="tq-chart-svg"
                viewBox="0 0 760 185"
                preserveAspectRatio="none"
                onMouseLeave={() => setHoveredPoint(null)}
              >
                <defs>
                  <linearGradient id="tq-trend-gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.14" />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Horizontal Grid Lines & Y-Axis Labels */}
                {[
                  { val: 100, y: 15 },
                  { val: 75, y: 47.5 },
                  { val: 50, y: 80 },
                  { val: 25, y: 112.5 },
                  { val: 0, y: 145 },
                ].map(({ val, y }) => (
                  <g key={val}>
                    <text
                      x="28"
                      y={y + 4}
                      textAnchor="end"
                      fill="#94a3b8"
                      fontSize="12"
                      fontFamily="Inter, -apple-system, sans-serif"
                    >
                      {val}
                    </text>
                    <line
                      x1="40"
                      y1={y}
                      x2="740"
                      y2={y}
                      stroke="#f1f5f9"
                      strokeWidth="1"
                    />
                  </g>
                ))}

                {/* Gradient Area under Curve */}
                <path d={areaFillD} fill="url(#tq-trend-gradient)" />

                {/* Trend Blue Line */}
                <path
                  d={linePathD}
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Circular Data Points with Hover Interaction */}
                {chartPoints.map((pt, idx) => {
                  const isHovered = hoveredPoint?.date === pt.date;
                  return (
                    <g
                      key={idx}
                      onMouseEnter={() => setHoveredPoint(pt)}
                      style={{ cursor: "pointer" }}
                    >
                      {/* Invisible enlarged hit target for easy mouse hover */}
                      <circle cx={pt.x} cy={pt.y} r="16" fill="transparent" />

                      {/* Outer pulse ring when hovered */}
                      {isHovered && (
                        <circle
                          cx={pt.x}
                          cy={pt.y}
                          r="9"
                          fill="none"
                          stroke="#bfdbfe"
                          strokeWidth="3"
                        />
                      )}

                      {/* Visible Point */}
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r={isHovered ? 5.5 : 4.5}
                        fill="#ffffff"
                        stroke="#2563eb"
                        strokeWidth={isHovered ? 3 : 2.5}
                        className="tq-chart-point"
                      />

                      {/* X-Axis Date Label */}
                      <text
                        x={pt.x}
                        y="172"
                        textAnchor="middle"
                        fill="#64748b"
                        fontSize="12"
                        fontWeight="500"
                        fontFamily="Inter, -apple-system, sans-serif"
                      >
                        {pt.date}
                      </text>
                    </g>
                  );
                })}

                {/* Hover Tooltip Overlay */}
                {hoveredPoint && (() => {
                  const tooltipWidth = 76;
                  const halfWidth = tooltipWidth / 2;
                  // Ensure the tooltip box stays gracefully within SVG viewBox bounds
                  const clampedX = Math.min(Math.max(hoveredPoint.x, halfWidth + 4), 760 - halfWidth - 4);
                  const boxOffset = clampedX - hoveredPoint.x;

                  return (
                    <g
                      transform={`translate(${hoveredPoint.x}, ${hoveredPoint.y - 14})`}
                      style={{ pointerEvents: "none", transition: "transform 0.08s ease-out" }}
                    >
                      <rect
                        x={-halfWidth + boxOffset}
                        y="-26"
                        width={tooltipWidth}
                        height="22"
                        rx="5"
                        fill="#0f172a"
                      />
                      <polygon
                        points="-4,-4 4,-4 0,0"
                        fill="#0f172a"
                      />
                      <text
                        x={boxOffset}
                        y="-12"
                        textAnchor="middle"
                        fill="#ffffff"
                        fontSize="11"
                        fontWeight="600"
                        fontFamily="Inter, -apple-system, sans-serif"
                      >
                        {hoveredPoint.score > 0 ? `Score: ${hoveredPoint.score}` : "Score: 0"}
                      </text>
                    </g>
                  );
                })()}
              </svg>
            )}
          </div>
          </div>

          {/* 2. AI Summary & Insights Card */}
          <div className="tq-card">
            {/* Header Row */}
            <div className="tq-ai-header">
              <div className="tq-ai-header-left">
                <span className="tq-ai-badge">AI</span>
                <span>AI Summary &amp; Insights</span>
                <span className="tq-beta-badge">BETA</span>
              </div>
              <span className="tq-timestamp">Last updated: {aiInsights.summary.lastUpdated}</span>
            </div>

            {/* Lead Headline & Description */}
            <div style={{ marginTop: "0.25rem", marginBottom: "1.25rem" }}>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: "1.05rem",
                  color: "#0f172a",
                  marginBottom: "0.35rem",
                  letterSpacing: "-0.01em",
                }}
              >
                {aiInsights.summary.headline}
              </div>
              <div
                style={{
                  fontSize: "0.925rem",
                  color: "#475569",
                  lineHeight: 1.55,
                }}
              >
                {aiInsights.summary.subheadline}
              </div>
            </div>

            {/* Subtle Divider */}
            <hr className="tq-divider-subtle" />

            {/* 3 Structured Insights Rows */}
            <div className="tq-ai-rows-list">
              {/* Row 1: What's happening */}
              <div className="tq-ai-row">
                <div className="tq-ai-row-title-col">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="#ef4444" style={{ flexShrink: 0 }}>
                    <rect x="3" y="13" width="4" height="7" rx="1" />
                    <rect x="10" y="8" width="4" height="12" rx="1" />
                    <rect x="17" y="3" width="4" height="17" rx="1" />
                  </svg>
                  <span>What's happening</span>
                </div>
                <div className="tq-ai-row-desc-col">
                  {aiInsights.whatsHappening}
                </div>
              </div>

              {/* Row 2: Why it matters */}
              <div className="tq-ai-row">
                <div className="tq-ai-row-title-col">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="#2563eb" style={{ flexShrink: 0 }}>
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.87-3.13-7-7-7zm-3 18c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-.5H9v.5z" />
                  </svg>
                  <span>Why it matters</span>
                </div>
                <div className="tq-ai-row-desc-col">
                  {aiInsights.whyItMatters}
                </div>
              </div>

              {/* Row 3: Recommended action */}
              <div className="tq-ai-row">
                <div className="tq-ai-row-title-col">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <line x1="9" y1="6" x2="20" y2="6" />
                    <line x1="9" y1="12" x2="20" y2="12" />
                    <line x1="9" y1="18" x2="20" y2="18" />
                    <rect x="3" y="4.5" width="3" height="3" rx="0.5" fill="#16a34a" />
                    <rect x="3" y="10.5" width="3" height="3" rx="0.5" fill="#16a34a" />
                    <rect x="3" y="16.5" width="3" height="3" rx="0.5" fill="#16a34a" />
                  </svg>
                  <span>Recommended action</span>
                </div>
                <div className="tq-ai-row-desc-col">
                  {aiInsights.recommendedAction}
                </div>
              </div>
            </div>

            {/* View Full Insights Action Button */}
            <div>
              <button
                type="button"
                onClick={() => setShowAiSidebar(true)}
                className="tq-insights-btn"
                style={{ cursor: "pointer" }}
                aria-label="View full insight"
                title="View full insight"
              >
                <span>View full insight</span>
                <span>→</span>
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Traffic Anomaly Alerts + Protection Status */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {/* 1. Traffic Anomaly Alerts Card */}
          <div className="tq-card" style={{ padding: "1.25rem" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700, fontSize: "0.95rem" }}>
                <span>Traffic Anomaly Alerts</span>
                <span className="tq-info-icon" title="Active alerts generated by real-time heuristic monitoring.">ⓘ</span>
              </div>
              <Link to="/app/alerts" style={{ fontSize: "0.825rem", color: "#2563eb", fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                <span>View all alerts</span>
                <span>→</span>
              </Link>
            </div>

            <div className="tq-alert-banner">
              <div className="tq-alert-header">
                <div className="tq-alert-title-row">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span>Suspicious traffic spike detected</span>
                </div>
                <span style={{
                  background: metrics.suspiciousPercent >= 35 ? "#fee2e2" : "#fef3c7",
                  color: metrics.suspiciousPercent >= 35 ? "#ef4444" : "#d97706",
                  borderRadius: "9999px",
                  padding: "0.15rem 0.65rem",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  display: "inline-block",
                }}>
                  {metrics.suspiciousPercent >= 35 ? "High" : "Medium"}
                </span>
              </div>

              <div className="tq-alert-desc">
                Suspicious traffic accounts for {metrics.suspiciousPercent}% of your store's total visits, with {metrics.topSuspiciousChannel} driving {metrics.topChannelShareOfInvalid} of invalid activity.
              </div>

              <div className="tq-alert-rows">
                <div className="tq-alert-row-item">
                  <div className="tq-alert-row-left">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="12 2 2 7 12 12 22 7 12 2" />
                      <polyline points="2 17 12 22 22 17" />
                      <polyline points="2 12 12 17 22 12" />
                    </svg>
                    <span>Affected sessions</span>
                  </div>
                  <span className="tq-alert-row-val">{currentSuspiciousSessions.toLocaleString()}</span>
                </div>

                <div className="tq-alert-row-item">
                  <div className="tq-alert-row-left">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                    <span>Likely source</span>
                  </div>
                  <span className="tq-alert-row-val">{metrics.topSuspiciousChannel}</span>
                </div>

                <div className="tq-alert-row-item">
                  <div className="tq-alert-row-left">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="10" rx="2" />
                      <circle cx="12" cy="5" r="2" />
                      <path d="M12 7v4" />
                      <line x1="8" y1="16" x2="8.01" y2="16" />
                      <line x1="16" y1="16" x2="16.01" y2="16" />
                    </svg>
                    <span>Bot likelihood</span>
                  </div>
                  <span className="tq-alert-row-val">{metrics.trafficQualityScore < 60 ? "High (85%+)" : "Moderate (65%+)"}</span>
                </div>

                <div className="tq-alert-row-item">
                  <div className="tq-alert-row-left">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    <span>Detected at</span>
                  </div>
                  <span className="tq-alert-row-val">{metrics.detectedAt}</span>
                </div>
              </div>

              <Link to="/app/investigation" className="tq-alert-btn">
                <span>Investigate traffic</span>
                <span>→</span>
              </Link>
            </div>
          </div>

          {/* 2. Protection Status Card */}
          <div className="tq-protection-status-card">
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700, fontSize: "0.95rem", marginBottom: "1rem" }}>
              <span>Protection Status</span>
              <span className="tq-info-icon" title="Real-time protection policy enforcement.">ⓘ</span>
            </div>

            <div className="tq-protection-header">
              <div className="tq-protection-shield-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <div>
                <div className="tq-protection-title">
                  Protection: Active
                </div>
                <p className="tq-protection-desc">
                  High-risk traffic protection is enabled and actively helping to prevent low-quality traffic from affecting your store.
                </p>
              </div>
            </div>

            <div className="tq-protection-kv-list">
              <div className="tq-protection-kv-row">
                <span className="tq-protection-kv-label">Mode</span>
                <span className="tq-protection-kv-val">{protectionMode}</span>
              </div>

              <div className="tq-protection-kv-row">
                <span className="tq-protection-kv-label">Last action</span>
                <span className="tq-protection-kv-val">
                  {settings?.protectionMode === "BLOCK"
                    ? `Blocked ${metrics.blockedCount} high-risk sessions`
                    : `Challenged ${metrics.blockedCount} high-risk sessions`}
                </span>
              </div>
            </div>

            <Link to="/app/settings" className="tq-protection-link">
              <span>View details</span>
              <span>→</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Characteristics of Suspicious Traffic Modal */}
      {showSuspiciousModal && (
        <div
          className="tq-modal-backdrop"
          onClick={() => setShowSuspiciousModal(false)}
        >
          <div
            className="tq-modal-box"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="suspicious-modal-title"
          >
            {/* Modal Header */}
            <div className="tq-modal-header">
              <div className="tq-modal-title-row">
                <div className="tq-modal-title" id="suspicious-modal-title">
                  <span>Characteristics of Suspicious Traffic</span>
                  <span className="tq-info-icon" title="Aggregated behavioral patterns of detected bots and invalid traffic.">ⓘ</span>
                </div>
                <button
                  type="button"
                  className="tq-modal-close-btn"
                  onClick={() => setShowSuspiciousModal(false)}
                  aria-label="Close dialog"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <p className="tq-modal-subtitle">
                Common patterns and behaviors observed in suspicious traffic for this period.
              </p>
            </div>

            {/* Dynamic Characteristics or Clean Zero-State */}
            {(!metrics.characteristics || metrics.characteristics.length === 0 || metrics.suspiciousSessions === 0) ? (
              <div className="tq-modal-empty-state">
                <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: "#ecfdf5", color: "#16a34a", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "0.75rem" }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <div style={{ fontWeight: 700, color: "#0f172a", fontSize: "1.05rem" }}>
                  No Suspicious Traffic Detected
                </div>
                <p style={{ color: "#64748b", fontSize: "0.875rem", marginTop: "0.35rem", maxWidth: "420px", lineHeight: "1.4" }}>
                  Zero suspicious sessions were detected for this period. All recorded visitor sessions demonstrated legitimate browsing behavior, natural dwell times, and authentic shopper patterns.
                </p>
              </div>
            ) : (
              <div className="tq-char-list">
                {metrics.characteristics.map((char) => (
                  <div key={char.id} className="tq-char-item">
                    <div className="tq-char-left">
                      <div className="tq-char-icon-circle">
                        {getCharIcon(char.id)}
                      </div>
                      <div>
                        <div className="tq-char-title">{char.title}</div>
                        <div className="tq-char-desc">{char.desc}</div>
                      </div>
                    </div>
                    <div className="tq-char-metric">
                      <div className="tq-char-val">{char.metricValue}</div>
                      <div className="tq-char-sublabel">{char.metricSublabel}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Bottom Info Banner */}
            <div className="tq-modal-footer-notice">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "2px" }}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <span>
                These patterns are automatically detected using a combination of behavioral signals, device fingerprinting, and network intelligence.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* AI Insights Slide-over Sidebar Drawer */}
      <AiInsightsSidebar
        isOpen={showAiSidebar}
        onClose={() => setShowAiSidebar(false)}
        dateRange={metrics.dateRange || "Last 7 Days"}
        insights={aiInsights}
      />
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
