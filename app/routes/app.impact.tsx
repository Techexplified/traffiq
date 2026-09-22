import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getDashboardOverview } from "../services/analytics.server";
import { getShopByDomain } from "../services/shop.server";
import { generateAiInsights } from "../services/aiInsights.server";
import AiInsightsSidebar from "../components/AiInsightsSidebar";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getShopByDomain(session.shop);
  const shopId = shop?.id || session.shop;

  const metrics = await getDashboardOverview(shopId);
  const insights = await generateAiInsights(metrics, shopId);
  return { metrics, insights };
};

export default function ImpactAndSources() {
  const { metrics, insights } = useLoaderData<typeof loader>();
  const [dateRange, setDateRange] = useState(metrics.dateRange);
  const [compareRange, setCompareRange] = useState(metrics.compareRange);
  const [hoveredSource, setHoveredSource] = useState<string | null>(null);
  const [showAiSidebar, setShowAiSidebar] = useState(false);

  const cleanTrafficFactor = 1 / (1 - (metrics.suspiciousPercent || 38) / 100);

  const businessImpactMetrics = metrics.businessImpact?.rows || [
    {
      name: "Sessions",
      reported: metrics.totalSessions.toLocaleString(),
      adjusted: metrics.realTrafficSessions.toLocaleString(),
      impact: `↓ ${metrics.suspiciousPercent}%`,
      isPositive: false,
    },
    {
      name: "Conversion Rate",
      reported: `${metrics.conversionRate.toFixed(1)}%`,
      adjusted: `${metrics.conversionRate.toFixed(1)}%`,
      impact: "0%",
      isPositive: true,
    },
    {
      name: "Add to Cart Rate",
      reported: "0.0%",
      adjusted: "0.0%",
      impact: "0%",
      isPositive: true,
    },
    {
      name: "Checkout Rate",
      reported: "0.0%",
      adjusted: "0.0%",
      impact: "0%",
      isPositive: true,
    },
    {
      name: "Completed Orders",
      reported: "0",
      adjusted: "0",
      impact: "0",
      isPositive: true,
    },
    {
      name: "Revenue",
      reported: "$0.00",
      adjusted: "$0.00",
      impact: "0%",
      isPositive: true,
    },
  ];

  const trafficSources = metrics.trafficSources;
  const campaigns = metrics.campaigns;

  return (
    <div className="tq-page">
      {/* Header */}
      <div className="tq-header-row">
        <div className="tq-header-title">
          <h1>Impact &amp; Sources</h1>
          <p>Understand how suspicious traffic is affecting your metrics and where it's coming from.</p>
        </div>

        <div className="tq-controls-group">
          <select
            className="tq-dropdown"
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
          >
            <option value="May 12 - May 18, 2025">📅 May 12 – May 18, 2025</option>
            <option value="Last 30 Days">📅 Last 30 Days</option>
          </select>

          <select
            className="tq-dropdown"
            value={compareRange}
            onChange={(e) => setCompareRange(e.target.value)}
          >
            <option value="May 5 - May 11, 2025">Compare to: May 5 – May 11, 2025</option>
            <option value="Previous Period">Compare to: Previous Period</option>
          </select>
        </div>
      </div>

      {/* Top Grid: Business Impact + AI Insights (Screenshot 4 exact match) */}
      <div style={{ display: "grid", gridTemplateColumns: "1.25fr 0.75fr", gap: "1.5rem", marginBottom: "1.5rem" }}>
        {/* Business Impact Card */}
        <div className="tq-card">
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700, fontSize: "1.05rem", marginBottom: "1rem" }}>
            <span>Business Impact</span>
            <span className="tq-info-icon" title="Compares raw metrics including bots vs clean human visitor traffic.">ⓘ</span>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="tq-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Reported (All Traffic)</th>
                  <th>Adjusted (High-Quality Traffic)</th>
                  <th>Impact</th>
                </tr>
              </thead>
              <tbody>
                {businessImpactMetrics.map((row) => (
                  <tr key={row.name}>
                    <td style={{ fontWeight: 600 }}>{row.name}</td>
                    <td style={{ color: "var(--tq-text-muted)" }}>{row.reported}</td>
                    <td style={{ fontWeight: 600, color: "var(--tq-text-main)" }}>{row.adjusted}</td>
                    <td>
                      <span className={row.isPositive ? "tq-trend-up-green" : "tq-trend-down-red"} style={{ fontWeight: 700 }}>
                        {row.impact}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.775rem", color: "var(--tq-text-muted)", marginTop: "1rem" }}>
            <span>ⓘ</span>
            <span>Adjusted metrics exclude sessions classified as Likely Automated or high-risk suspicious.</span>
          </div>
        </div>

        {/* AI Insights Card */}
        <div className="tq-card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 700, fontSize: "1.05rem", color: "var(--tq-primary)", marginBottom: "1.25rem" }}>
              <span>✦</span>
              <span>AI Insights</span>
            </div>

            <p style={{ fontSize: "0.95rem", color: "var(--tq-text-main)", lineHeight: 1.55, margin: "0 0 1.5rem 0" }}>
              {insights.whatsHappening}
            </p>

            <div style={{ marginBottom: "1.5rem" }}>
              <div style={{ fontSize: "0.825rem", fontWeight: 700, color: "var(--tq-text-main)", marginBottom: "0.4rem" }}>
                Recommended action
              </div>
              <p style={{ fontSize: "0.85rem", color: "var(--tq-text-muted)", lineHeight: 1.5, margin: 0 }}>
                {insights.recommendedAction}
              </p>
            </div>
          </div>

          <button
            type="button"
            className="tq-btn tq-btn-outline"
            style={{ alignSelf: "flex-start", cursor: "pointer" }}
            onClick={() => setShowAiSidebar(true)}
            aria-label="View full insight"
            title="View full insight"
          >
            <span>View full insight</span>
            <span>→</span>
          </button>
        </div>
      </div>

      {/* Bottom Grid: Suspicious Traffic by Source + Suspicious Traffic by Campaign (Screenshot 4 exact match) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
        {/* Suspicious Traffic by Source (Donut Chart) */}
        <div className="tq-card">
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700, fontSize: "1.05rem", marginBottom: "1.25rem" }}>
            <span>Suspicious Traffic by Source</span>
            <span className="tq-info-icon">ⓘ</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "2rem", flexWrap: "wrap" }}>
            {/* SVG Donut Chart */}
            <div style={{ position: "relative", width: "170px", height: "170px", flexShrink: 0 }}>
              <svg width="170" height="170" viewBox="0 0 170 170">
                {(() => {
                  const circumference = 2 * Math.PI * 65; // ~408.407
                  let accumulatedOffset = 0;
                  return trafficSources.map((source) => {
                    const strokeDash = (source.percent / 100) * circumference;
                    const offset = accumulatedOffset;
                    accumulatedOffset -= strokeDash;
                    return (
                      <circle
                        key={source.label}
                        cx="85"
                        cy="85"
                        r="65"
                        fill="none"
                        stroke={source.color}
                        strokeWidth="20"
                        strokeDasharray={`${strokeDash.toFixed(1)} ${circumference.toFixed(1)}`}
                        strokeDashoffset={offset.toFixed(1)}
                        style={{ transition: "stroke-dasharray 0.5s ease" }}
                      />
                    );
                  });
                })()}
              </svg>

              {/* Center Counter */}
              <div style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center"
              }}>
                <div style={{ fontSize: "1.45rem", fontWeight: 800, color: "var(--tq-text-main)", lineHeight: 1.1 }}>
                  {metrics.suspiciousSessions.toLocaleString()}
                </div>
                <div style={{ fontSize: "0.68rem", color: "var(--tq-text-muted)", fontWeight: 600, maxWidth: "70px", marginTop: "0.2rem" }}>
                  Suspicious Sessions
                </div>
              </div>
            </div>

            {/* Legend & Breakdown Table */}
            <div style={{ flex: 1, minWidth: "200px" }}>
              <table style={{ width: "100%", fontSize: "0.825rem", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: "var(--tq-text-muted)", borderBottom: "1px solid var(--tq-border)" }}>
                    <th style={{ textAlign: "left", padding: "0.4rem 0" }}>Source</th>
                    <th style={{ textAlign: "right", padding: "0.4rem 0.5rem" }}>Suspicious Sessions</th>
                    <th style={{ textAlign: "right", padding: "0.4rem 0" }}>% of Total Suspicious</th>
                  </tr>
                </thead>
                <tbody>
                  {trafficSources.map((s) => (
                    <tr key={s.label} style={{ borderBottom: "1px solid var(--tq-border-subtle)" }}>
                      <td style={{ padding: "0.5rem 0", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: s.color }}></span>
                        <span style={{ fontWeight: 500 }}>{s.label}</span>
                      </td>
                      <td style={{ textAlign: "right", padding: "0.5rem 0.5rem", color: "var(--tq-text-muted)" }}>
                        {s.count.toLocaleString()}
                      </td>
                      <td style={{ textAlign: "right", padding: "0.5rem 0", fontWeight: 600 }}>
                        {s.percent}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <Link to="/app/investigation" className="tq-btn tq-btn-outline" style={{ marginTop: "1.5rem", display: "inline-block", textDecoration: "none" }}>
            View all sources
          </Link>
        </div>

        {/* Suspicious Traffic by Campaign */}
        <div className="tq-card">
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700, fontSize: "1.05rem", marginBottom: "1.25rem" }}>
            <span>Suspicious Traffic by Campaign</span>
            <span className="tq-info-icon">ⓘ</span>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="tq-table">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th style={{ textAlign: "right" }}>Suspicious</th>
                  <th style={{ textAlign: "right" }}>Suspicious %</th>
                  <th style={{ textAlign: "right" }}>Conv. Rate</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.length > 0 ? (
                  campaigns.map((c) => (
                    <tr key={c.name}>
                      <td style={{ fontWeight: 600, color: "var(--tq-text-main)" }}>{c.name}</td>
                      <td style={{ textAlign: "right", color: "var(--tq-text-muted)" }}>{(c.totalSessions ?? c.sessions).toLocaleString()}</td>
                      <td style={{ textAlign: "right", color: "var(--tq-text-muted)" }}>{(c.suspiciousSessions ?? c.sessions).toLocaleString()}</td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: "var(--tq-danger)" }}>{c.percent}</td>
                      <td style={{ textAlign: "right", fontWeight: 600, color: "var(--tq-text-main)" }}>
                        {c.conversionRate !== undefined ? `${c.conversionRate}%` : "—"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: "1.25rem", color: "var(--tq-text-muted)" }}>
                      No tracked campaign sessions recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <Link to="/app/investigation" className="tq-btn tq-btn-outline" style={{ marginTop: "1.5rem", display: "inline-block", textDecoration: "none" }}>
            View all campaigns
          </Link>
        </div>
      </div>

      {/* AI Insights Slide-over Sidebar Drawer */}
      <AiInsightsSidebar
        isOpen={showAiSidebar}
        onClose={() => setShowAiSidebar(false)}
        dateRange={dateRange}
        insights={insights}
      />
    </div>
  );
}
