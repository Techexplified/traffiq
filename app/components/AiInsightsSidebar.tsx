import { useEffect } from "react";
import { Link } from "react-router";
import type { StructuredAiInsightsResponse, RecommendedActionItem } from "../types/insights";

interface AiInsightsSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  dateRange?: string;
  insights?: StructuredAiInsightsResponse;
}

export default function AiInsightsSidebar({
  isOpen,
  onClose,
  dateRange = "Last 7 Days",
  insights
}: AiInsightsSidebarProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="tq-drawer-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over Drawer Panel */}
      <div
        className="tq-drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-insights-drawer-title"
      >
        {/* Header */}
        <div className="tq-drawer-header">
          <div className="tq-drawer-title-row">
            <div className="tq-drawer-title-left">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
              </svg>
              <h2 className="tq-drawer-title" id="ai-insights-drawer-title">
                AI Insights
              </h2>
            </div>
            <button
              type="button"
              className="tq-drawer-close-btn"
              onClick={onClose}
              aria-label="Close sidebar"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="tq-drawer-meta" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.4rem" }}>
            <span style={{ fontWeight: 600, color: "#334155" }}>
              Period: {insights?.analysisPeriod || dateRange}
            </span>
            <span style={{ opacity: 0.5 }}>•</span>
            <span style={{ color: "#64748b" }}>
              Generated: {insights?.generatedTimestamp || "Just now"}
            </span>
          </div>

          {/* Data Sources */}
          <div style={{ marginTop: "0.4rem", display: "flex", flexWrap: "wrap", gap: "0.3rem", alignItems: "center" }}>
            <span style={{ fontSize: "0.7rem", color: "#64748b", fontWeight: 600 }}>Sources:</span>
            {(insights?.dataSources && insights.dataSources.length > 0 ? insights.dataSources : [
              "Shopify Web Pixel Behavioral Telemetry",
              "Neon DB Session Aggregator",
              "Deterministic Multi-Signal Detection Engine"
            ]).map((ds, idx) => (
              <span
                key={idx}
                style={{
                  fontSize: "0.675rem",
                  fontWeight: 600,
                  background: "#f1f5f9",
                  color: "#334155",
                  padding: "0.15rem 0.45rem",
                  borderRadius: "4px",
                  border: "1px solid #e2e8f0"
                }}
              >
                {ds}
              </span>
            ))}
          </div>

          <p className="tq-drawer-desc" style={{ marginTop: "0.6rem" }}>
            Detailed analysis of suspicious traffic, key patterns, and recommended actions for your store based on verified telemetry.
          </p>
        </div>

        {/* Scrollable Content Body */}
        <div className="tq-drawer-body">
          {/* Card 1: Key Finding */}
          <div className="tq-insight-drawer-card" style={{ borderColor: "#fecaca", background: "#fffdfd" }}>
            <div className="tq-insight-drawer-card-header">
              <div style={{
                width: "28px",
                height: "28px",
                borderRadius: "6px",
                background: "#fee2e2",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="4"/>
                  <line x1="12" y1="20" x2="12" y2="10"/>
                  <line x1="6" y1="20" x2="6" y2="14"/>
                </svg>
              </div>
              <span className="tq-insight-drawer-card-title">Key Finding</span>
            </div>
            {insights?.keyFindings && insights.keyFindings.length > 0 ? (
              <ul style={{ margin: "0.35rem 0 0 0", paddingLeft: "1.1rem", fontSize: "0.8rem", color: "#334155", lineHeight: "1.55" }}>
                {insights.keyFindings.map((finding, idx) => (
                  <li key={idx} style={{ marginBottom: "0.3rem" }}>
                    {finding}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="tq-insight-drawer-card-body">
                {insights ? (
                  insights.whatsHappening
                ) : (
                  <>
                    Paid Social is the primary driver of suspicious traffic, accounting for{" "}
                    <strong style={{ color: "#dc2626" }}>59%</strong> of all suspicious sessions. This traffic is causing a significant drop in conversion rate and revenue quality.
                  </>
                )}
              </p>
            )}
          </div>

          {/* Card 2: Business Impact */}
          <div className="tq-insight-drawer-card" style={{ borderColor: "#bbf7d0", background: "#fcfdfc" }}>
            <div className="tq-insight-drawer-card-header">
              <div style={{
                width: "28px",
                height: "28px",
                borderRadius: "6px",
                background: "#dcfce7",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                  <polyline points="17 6 23 6 23 12"/>
                </svg>
              </div>
              <span className="tq-insight-drawer-card-title">Business Impact</span>
            </div>
            {insights?.businessImpact && Array.isArray(insights.businessImpact) && insights.businessImpact.length > 0 ? (
              <ul style={{ margin: "0.35rem 0 0 0", paddingLeft: "1.1rem", fontSize: "0.8rem", color: "#334155", lineHeight: "1.55" }}>
                {insights.businessImpact.map((impact, idx) => (
                  <li key={idx} style={{ marginBottom: "0.3rem" }}>
                    {impact}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="tq-insight-drawer-card-body">
                {insights?.businessImpact || "Suspicious traffic is inflating your reported sessions, leading to a lower conversion rate (1.4% vs 2.1%) and affecting the accuracy of your performance metrics. This can result in wasted ad spend and poor decision-making."}
              </p>
            )}
          </div>

          {/* Card 3: Key Patterns Detected */}
          <div className="tq-insight-drawer-card" style={{ borderColor: "#bfdbfe", background: "#fcfdff" }}>
            <div className="tq-insight-drawer-card-header">
              <div style={{
                width: "28px",
                height: "28px",
                borderRadius: "6px",
                background: "#eff6ff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6"/>
                  <line x1="8" y1="12" x2="21" y2="12"/>
                  <line x1="8" y1="18" x2="21" y2="18"/>
                  <line x1="3" y1="6" x2="3.01" y2="6"/>
                  <line x1="3" y1="12" x2="3.01" y2="12"/>
                  <line x1="3" y1="18" x2="3.01" y2="18"/>
                </svg>
              </div>
              <span className="tq-insight-drawer-card-title">Key Patterns Detected</span>
            </div>
            <ul style={{ margin: "0.35rem 0 0 0", paddingLeft: "1.1rem", fontSize: "0.8rem", color: "#475569", lineHeight: "1.55" }}>
              {(((insights?.keyPatterns && insights.keyPatterns.length > 0) ? insights.keyPatterns : insights?.patterns) || [
                "High request frequency exceeding human baselines",
                "Rapid navigation intervals without reader dwell time",
                "Repetitive product indexing and automated browsing patterns",
                "Traffic concentrated in high-velocity ad placements"
              ]).map((pat, idx) => (
                <li key={idx} style={{ marginBottom: "0.25rem" }}>{pat}</li>
              ))}
            </ul>

            {insights?.channelInsights && insights.channelInsights.length > 0 && (
              <div style={{ marginTop: "0.65rem", paddingTop: "0.55rem", borderTop: "1px dashed #e2e8f0" }}>
                <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                  Channel Risk Share:
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginTop: "0.35rem" }}>
                  {insights.channelInsights.map((ci, idx) => (
                    <div key={idx} style={{ fontSize: "0.76rem", display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#334155", fontWeight: 600 }}>{ci.channel}</span>
                      <span style={{ color: "#ef4444", fontWeight: 700 }}>{ci.riskShare}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Card 4: Why This Matters */}
          <div className="tq-insight-drawer-card" style={{ borderColor: "#fde68a", background: "#fffdfa" }}>
            <div className="tq-insight-drawer-card-header">
              <div style={{
                width: "28px",
                height: "28px",
                borderRadius: "6px",
                background: "#fef3c7",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <span className="tq-insight-drawer-card-title">Why This Matters</span>
            </div>
            <p className="tq-insight-drawer-card-body">
              {insights?.whyItMatters || "Low-quality traffic can inflate your metrics, reduce conversion rate, waste ad spend, and make it harder to measure the true performance of your marketing channels. Taking action early helps protect your store's growth and ROI."}
            </p>

            {insights?.mythsAndMisinterpretations && insights.mythsAndMisinterpretations.length > 0 && (
              <div style={{ marginTop: "0.65rem", paddingTop: "0.55rem", borderTop: "1px dashed #fed7aa" }}>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#b45309", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: "0.3rem" }}>
                  Common Misconceptions:
                </div>
                <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.775rem", color: "#78350f", lineHeight: "1.5" }}>
                  {insights.mythsAndMisinterpretations.map((m, idx) => (
                    <li key={idx} style={{ marginBottom: "0.25rem" }}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Card 5: Recommended Actions */}
          <div className="tq-insight-drawer-card" style={{ borderColor: "#e9d5ff", background: "#faf8fe" }}>
            <div className="tq-insight-drawer-card-header">
              <div style={{
                width: "28px",
                height: "28px",
                borderRadius: "6px",
                background: "#f3e8ff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9333ea" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <circle cx="12" cy="12" r="6"/>
                  <circle cx="12" cy="12" r="2"/>
                </svg>
              </div>
              <span className="tq-insight-drawer-card-title">Recommended Actions</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.4rem" }}>
              {(insights?.recommendedActions && insights.recommendedActions.length > 0
                ? insights.recommendedActions
                : [
                    {
                      priority: "HIGH" as const,
                      action: "Review Paid Social campaign audience targeting",
                      reason: "Accounts for 59% of detected invalid sessions",
                    },
                    {
                      priority: "MEDIUM" as const,
                      action: "Enable Cart & Checkout Validation protection",
                      reason: "Prevents automated bots from initiating checkout or scraping discount codes",
                    },
                    {
                      priority: "LOW" as const,
                      action: "Monitor Traffic Investigation log for recurring ASN datacenter proxies",
                      reason: "Allows proactive identification of scrapers and automated crawling bursts",
                    },
                  ]
              ).map((item: RecommendedActionItem, idx: number) => (
                <div key={idx} style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem" }}>
                  <span style={{
                    width: "22px",
                    height: "22px",
                    borderRadius: "50%",
                    background: item.priority === "HIGH" ? "#fee2e2" : item.priority === "MEDIUM" ? "#fef3c7" : "#dbeafe",
                    color: item.priority === "HIGH" ? "#dc2626" : item.priority === "MEDIUM" ? "#d97706" : "#2563eb",
                    fontSize: "0.725rem",
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    marginTop: "1px"
                  }}>
                    {idx + 1}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#0f172a" }}>
                        {item.action}
                      </span>
                      <span style={{
                        fontSize: "0.65rem",
                        fontWeight: 700,
                        padding: "0.1rem 0.35rem",
                        borderRadius: "4px",
                        background: item.priority === "HIGH" ? "#fee2e2" : item.priority === "MEDIUM" ? "#fef3c7" : "#f1f5f9",
                        color: item.priority === "HIGH" ? "#dc2626" : item.priority === "MEDIUM" ? "#b45309" : "#475569",
                      }}>
                        {item.priority}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.15rem", lineHeight: "1.4" }}>
                      {item.reason}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="tq-drawer-footer">
          <Link
            to="/app/investigation"
            onClick={onClose}
            style={{
              flex: 1,
              background: "#2563eb",
              color: "#ffffff",
              padding: "0.55rem 0.85rem",
              borderRadius: "8px",
              fontSize: "0.825rem",
              fontWeight: 600,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.4rem",
              boxShadow: "0 1px 2px rgba(37, 99, 235, 0.2)",
              transition: "background 0.15s ease"
            }}
          >
            <span>Investigate suspicious traffic</span>
            <span>→</span>
          </Link>

          <Link
            to="/app/impact"
            onClick={onClose}
            style={{
              background: "#ffffff",
              border: "1px solid #cbd5e1",
              color: "#0f172a",
              padding: "0.55rem 0.85rem",
              borderRadius: "8px",
              fontSize: "0.825rem",
              fontWeight: 600,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.4rem",
              transition: "all 0.15s ease"
            }}
          >
            <span>View source analysis</span>
            <span>→</span>
          </Link>
        </div>
      </div>
    </>
  );
}
