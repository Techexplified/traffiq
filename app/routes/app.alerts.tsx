import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { getShopByDomain } from "../services/shop.server";
import prisma from "../db.server";
import {
  getShopAlerts,
  toggleAlertStatus,
  resolveAlert,
  checkAndGenerateAlerts,
} from "../services/alertEngine.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let shopDomain = "cartmend.myshopify.com";
  let shopId = "cmtsvcn3q0000f1ug830bb00p";

  try {
    const { session } = await authenticate.admin(request);
    const shop = await getShopByDomain(session.shop);
    shopId = shop?.id || session.shop;
    shopDomain = session.shop;
  } catch {
    const defaultShop = await prisma.shop.findFirst({ where: { status: "ACTIVE" } });
    if (defaultShop) {
      shopId = defaultShop.id;
      shopDomain = defaultShop.shopDomain;
    }
  }

  // Scan real database telemetry and generate/update alerts
  await checkAndGenerateAlerts(shopId);

  // Fetch real database alerts
  const dbAlerts = await getShopAlerts(shopId);

  return { dbAlerts, shopDomain };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  let shopId = "cmtsvcn3q0000f1ug830bb00p";

  try {
    const { session } = await authenticate.admin(request);
    const shop = await getShopByDomain(session.shop);
    shopId = shop?.id || session.shop;
  } catch {
    const defaultShop = await prisma.shop.findFirst({ where: { status: "ACTIVE" } });
    if (defaultShop) {
      shopId = defaultShop.id;
    }
  }

  const formData = await request.formData();
  const alertId = formData.get("alertId") as string;
  const actionType = formData.get("actionType") as string;

  if (alertId) {
    if (actionType === "toggle_status") {
      const updated = await toggleAlertStatus(alertId, shopId);
      return { success: true, alert: updated };
    }
    if (actionType === "resolve_alert") {
      const updated = await resolveAlert(alertId, shopId);
      return { success: true, alert: updated };
    }
  }

  return { success: true };
};

export interface AlertItem {
  id: string;
  type: string;
  title: string;
  summary: string;
  severity: "High" | "Medium" | "Low";
  detected: string;
  detectedAt: string;
  status: "Active" | "Resolved";
  affectedSessions: string;
  increase: string;
  botLikelihood: string;
  likelySource: string;
  countryFlag: string;
  sourcePercent: string;
  whatHappened: string;
  aiInsight: string;
}

function formatAlert(a: any): AlertItem {
  let meta: any = {};
  if (a.metadata) {
    try {
      meta = typeof a.metadata === "string" ? JSON.parse(a.metadata) : a.metadata;
    } catch {}
  }
  return {
    id: a.id,
    type: a.type || meta.type || "ANOMALY",
    title: a.title,
    summary: a.description || "Suspicious traffic anomaly detected.",
    severity: (a.severity as "High" | "Medium" | "Low") || "Medium",
    detected: a.detectedAt
      ? new Date(a.detectedAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "Recently",
    detectedAt: a.detectedAt ? new Date(a.detectedAt).toISOString() : new Date().toISOString(),
    status: (a.status as "Active" | "Resolved") || "Active",
    affectedSessions: a.affectedSessions || "1",
    increase: a.increase || "+100%",
    botLikelihood: a.botLikelihood || "75%",
    likelySource: a.likelySource || meta.source || "Direct",
    countryFlag: a.countryFlag || "🌐",
    sourcePercent: a.sourcePercent || "Elevated traffic volume",
    whatHappened:
      meta.whatHappened ||
      a.description ||
      "Anomalous traffic activity detected across incoming browsing telemetry.",
    aiInsight:
      meta.aiInsight ||
      "Review incoming traffic in Traffic Investigation to verify visitor quality and tighten ad placements.",
  };
}

export default function AlertsPage() {
  const { dbAlerts } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const formattedAlerts: AlertItem[] = (dbAlerts || []).map(formatAlert);

  const [alerts, setAlerts] = useState<AlertItem[]>(formattedAlerts);
  const [selectedAlert, setSelectedAlert] = useState<AlertItem | null>(formattedAlerts[0] || null);
  const [dateRange, setDateRange] = useState("All Time");
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [filterSeverity, setFilterSeverity] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "severity" | "affected">("newest");

  useEffect(() => {
    const mapped = (dbAlerts || []).map(formatAlert);
    setAlerts(mapped);
    setSelectedAlert((prev) => {
      if (!prev && mapped.length > 0) return mapped[0];
      const found = mapped.find((a) => a.id === prev?.id);
      return found || mapped[0] || null;
    });
  }, [dbAlerts]);

  const toggleResolveStatus = (alertId: string) => {
    setAlerts((prev) =>
      prev.map((a) => {
        if (a.id === alertId) {
          const newStatus = a.status === "Active" ? "Resolved" : "Active";
          const updated = { ...a, status: newStatus as "Active" | "Resolved" };
          if (selectedAlert?.id === alertId) {
            setSelectedAlert(updated);
          }
          return updated;
        }
        return a;
      })
    );
    fetcher.submit({ actionType: "toggle_status", alertId }, { method: "POST" });
  };

  // Real database KPI stats
  const activeAlertsCount = alerts.filter((a) => a.status === "Active").length;
  const highSeverityCount = alerts.filter((a) => a.severity === "High" && a.status === "Active").length;
  const mediumSeverityCount = alerts.filter((a) => a.severity === "Medium" && a.status === "Active").length;
  const resolvedCount = alerts.filter((a) => a.status === "Resolved").length;

  // Filtered and sorted alerts
  const filteredAlerts = alerts
    .filter((a) => {
      if (filterSeverity !== "All" && a.severity !== filterSeverity) return false;
      if (filterStatus !== "All" && a.status !== filterStatus) return false;

      if (dateRange !== "All" && dateRange !== "All Time") {
        const now = new Date();
        const detected = new Date(a.detectedAt);
        const dr = dateRange.toLowerCase();

        if (dr.includes("today")) {
          const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          if (detected < start) return false;
        } else if (dr.includes("yesterday")) {
          const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
          const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          if (detected < start || detected >= end) return false;
        } else if (dr.includes("7 day")) {
          const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          if (detected < start) return false;
        } else if (dr.includes("30 day")) {
          const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          if (detected < start) return false;
        }
      }

      return true;
    })
    .sort((a, b) => {
      if (sortOrder === "oldest") {
        return new Date(a.detectedAt).getTime() - new Date(b.detectedAt).getTime();
      }
      if (sortOrder === "severity") {
        const weights: Record<string, number> = { High: 3, Medium: 2, Low: 1 };
        return (weights[b.severity] || 0) - (weights[a.severity] || 0);
      }
      if (sortOrder === "affected") {
        const numA = parseInt((a.affectedSessions || "0").replace(/[^0-9]/g, ""), 10) || 0;
        const numB = parseInt((b.affectedSessions || "0").replace(/[^0-9]/g, ""), 10) || 0;
        return numB - numA;
      }
      // Default: newest
      return new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime();
    });

  return (
    <div className="tq-page">
      {/* Header */}
      <div className="tq-header-row">
        <div className="tq-header-title">
          <h1>Alerts</h1>
          <p>Real-time security and traffic anomaly alerts driven by live store telemetry.</p>
        </div>

        <div className="tq-controls-group">
          <select
            className="tq-dropdown"
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
          >
            <option value="All Time">📅 All Time</option>
            <option value="Today">📅 Today</option>
            <option value="Yesterday">📅 Yesterday</option>
            <option value="Last 7 Days">📅 Last 7 Days</option>
            <option value="Last 30 Days">📅 Last 30 Days</option>
          </select>
        </div>
      </div>

      {/* Top 4 KPI Cards (Database-driven stats) */}
      <div className="tq-grid-4">
        {/* Active Alerts */}
        <div className="tq-card tq-stat-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: "0.825rem", color: "var(--tq-text-muted)", fontWeight: 500 }}>Active Alerts</div>
              <div className="tq-stat-number" style={{ color: activeAlertsCount > 0 ? "var(--tq-danger)" : "var(--tq-success)", marginTop: "0.25rem" }}>
                {activeAlertsCount}
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--tq-text-muted)", marginTop: "0.2rem" }}>
                {activeAlertsCount > 0 ? "Needs attention" : "All clear"}
              </div>
            </div>
            <div style={{ width: "42px", height: "42px", borderRadius: "50%", background: activeAlertsCount > 0 ? "#fee2e2" : "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center", color: activeAlertsCount > 0 ? "#ef4444" : "#16a34a" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
            </div>
          </div>
        </div>

        {/* High Severity */}
        <div className="tq-card tq-stat-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: "0.825rem", color: "var(--tq-text-muted)", fontWeight: 500 }}>High Severity</div>
              <div className="tq-stat-number" style={{ color: "var(--tq-danger)", marginTop: "0.25rem" }}>
                {highSeverityCount}
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--tq-text-muted)", marginTop: "0.2rem" }}>Critical issues</div>
            </div>
            <div style={{ width: "42px", height: "42px", borderRadius: "50%", background: "#fee2e2", display: "flex", alignItems: "center", justifyContent: "center", color: "#ef4444" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                <polyline points="17 6 23 6 23 12"/>
              </svg>
            </div>
          </div>
        </div>

        {/* Medium Severity */}
        <div className="tq-card tq-stat-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: "0.825rem", color: "var(--tq-text-muted)", fontWeight: 500 }}>Medium Severity</div>
              <div className="tq-stat-number" style={{ color: "var(--tq-warning-text)", marginTop: "0.25rem" }}>
                {mediumSeverityCount}
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--tq-text-muted)", marginTop: "0.2rem" }}>Monitor closely</div>
            </div>
            <div style={{ width: "42px", height: "42px", borderRadius: "50%", background: "#fef3c7", display: "flex", alignItems: "center", justifyContent: "center", color: "#d97706" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            </div>
          </div>
        </div>

        {/* Resolved */}
        <div className="tq-card tq-stat-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: "0.825rem", color: "var(--tq-text-muted)", fontWeight: 500 }}>Resolved</div>
              <div className="tq-stat-number" style={{ color: "var(--tq-success)", marginTop: "0.25rem" }}>
                {resolvedCount}
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--tq-text-muted)", marginTop: "0.2rem" }}>Processed alerts</div>
            </div>
            <div style={{ width: "42px", height: "42px", borderRadius: "50%", background: "#d1fae5", display: "flex", alignItems: "center", justifyContent: "center", color: "#10b981" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Split View: All Alerts Table + Alert Inspector Drawer */}
      <div
        className="tq-split-container"
        style={{
          gridTemplateColumns: drawerOpen && selectedAlert ? "minmax(0, 1fr) 380px" : "1fr",
          transition: "all 0.2s ease",
        }}
      >
        {/* Left: All Alerts Table Card */}
        <div className="tq-card" style={{ padding: "1.25rem", minWidth: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.5rem" }}>
            <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>
              All Alerts ({filteredAlerts.length})
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <select
                className="tq-filter-pill"
                value={filterSeverity}
                onChange={(e) => setFilterSeverity(e.target.value)}
              >
                <option value="All">All Severities</option>
                <option value="High">High Severity</option>
                <option value="Medium">Medium Severity</option>
                <option value="Low">Low Severity</option>
              </select>

              <select
                className="tq-filter-pill"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="All">All Statuses</option>
                <option value="Active">Active Only</option>
                <option value="Resolved">Resolved Only</option>
              </select>

              <select
                className="tq-filter-pill"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as any)}
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="severity">Highest Severity</option>
                <option value="affected">Most Affected Sessions</option>
              </select>
            </div>
          </div>

          <div style={{ overflowX: "auto", width: "100%", WebkitOverflowScrolling: "touch" }}>
            <table className="tq-table">
              <thead>
                <tr>
                  <th>Alert</th>
                  <th>Severity</th>
                  <th>Detected</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredAlerts.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--tq-text-muted)" }}>
                      <div style={{ fontSize: "1.75rem", marginBottom: "0.5rem" }}>🛡️</div>
                      <div style={{ fontWeight: 600, fontSize: "0.95rem", color: "var(--tq-text-main)" }}>
                        No alerts matching your criteria
                      </div>
                      <div style={{ fontSize: "0.8rem", marginTop: "0.25rem" }}>
                        Store traffic telemetry is running normally with no active threat conditions detected.
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredAlerts.map((alert) => {
                    const isSelected = selectedAlert?.id === alert.id;
                    const isActive = alert.status === "Active";

                    return (
                      <tr
                        key={alert.id}
                        className={`tq-row-selectable ${isSelected ? "tq-row-selected" : ""}`}
                        onClick={() => {
                          setSelectedAlert(alert);
                          setDrawerOpen(true);
                        }}
                      >
                        <td>
                          <div style={{ display: "flex", alignItems: "flex-start", gap: "0.625rem" }}>
                            <span style={{ fontSize: "1.1rem", marginTop: "0.1rem" }}>
                              {alert.severity === "High" ? "🚨" : alert.severity === "Medium" ? "⚠️" : "🛡️"}
                            </span>
                            <div>
                              <div style={{ fontWeight: 600, color: "var(--tq-text-main)" }}>{alert.title}</div>
                              <div style={{ fontSize: "0.75rem", color: "var(--tq-text-muted)", marginTop: "0.15rem", whiteSpace: "normal" }}>
                                {alert.summary}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`tq-badge tq-badge-${alert.severity.toLowerCase()}`}>
                            {alert.severity}
                          </span>
                        </td>
                        <td style={{ color: "var(--tq-text-muted)", fontSize: "0.825rem", whiteSpace: "nowrap" }}>
                          {alert.detected}
                        </td>
                        <td>
                          <span
                            className={`tq-badge ${isActive ? "tq-badge-active" : "tq-badge-resolved"}`}
                            style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleResolveStatus(alert.id);
                            }}
                            title="Click to toggle status"
                          >
                            {isActive ? "● Active" : "✓ Resolved"}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Interactive Alert Inspector Drawer */}
        {drawerOpen && selectedAlert && (
          <div className="tq-card" style={{ padding: "1.25rem", position: "sticky", top: "5rem", minWidth: 0 }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "0.75rem", gap: "0.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
                <span style={{
                  width: "34px",
                  height: "34px",
                  borderRadius: "8px",
                  background: selectedAlert.severity === "High" ? "#fee2e2" : "#fef3c7",
                  color: selectedAlert.severity === "High" ? "#ef4444" : "#d97706",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "1.1rem",
                  flexShrink: 0,
                }}>
                  {selectedAlert.severity === "High" ? "🚨" : "⚠️"}
                </span>
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {selectedAlert.title}
                  </h3>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
                <span className={`tq-badge tq-badge-${selectedAlert.severity.toLowerCase()}`}>
                  {selectedAlert.severity}
                </span>
                <button
                  onClick={() => setDrawerOpen(false)}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.2rem", color: "var(--tq-text-muted)", padding: "2px 4px" }}
                  title="Close drawer"
                >
                  ✕
                </button>
              </div>
            </div>

            <p style={{ fontSize: "0.825rem", color: "var(--tq-text-muted)", margin: "0 0 1rem 0", lineHeight: 1.4 }}>
              {selectedAlert.summary}
            </p>

            {/* 3 Real Metrics Row */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "0.5rem",
              background: "var(--tq-bg)",
              padding: "0.75rem",
              borderRadius: "10px",
              border: "1px solid var(--tq-border)",
              marginBottom: "1rem",
              textAlign: "center",
            }}>
              <div>
                <div style={{ fontSize: "0.68rem", color: "var(--tq-text-muted)", textTransform: "uppercase" }}>Affected</div>
                <div style={{ fontWeight: 800, fontSize: "1.1rem", marginTop: "0.15rem" }}>
                  {selectedAlert.affectedSessions}
                </div>
              </div>
              <div>
                <div style={{ fontSize: "0.68rem", color: "var(--tq-text-muted)", textTransform: "uppercase" }}>Delta</div>
                <div style={{ fontWeight: 800, fontSize: "1.1rem", color: "var(--tq-danger)", marginTop: "0.15rem" }}>
                  {selectedAlert.increase}
                </div>
                <div style={{ fontSize: "0.65rem", color: "var(--tq-text-muted)" }}>vs baseline</div>
              </div>
              <div>
                <div style={{ fontSize: "0.68rem", color: "var(--tq-text-muted)", textTransform: "uppercase" }}>Bot score</div>
                <div style={{ fontWeight: 800, fontSize: "1.1rem", color: "var(--tq-danger)", marginTop: "0.15rem" }}>
                  {selectedAlert.botLikelihood}
                </div>
                <div style={{ fontSize: "0.65rem", color: "var(--tq-danger)", fontWeight: 600 }}>
                  {selectedAlert.severity}
                </div>
              </div>
            </div>

            {/* Likely Source Card */}
            <div style={{
              background: "#ffffff",
              border: "1px solid var(--tq-border)",
              borderRadius: "10px",
              padding: "0.75rem",
              marginBottom: "1rem",
            }}>
              <div style={{ fontSize: "0.7rem", color: "var(--tq-text-muted)", textTransform: "uppercase", fontWeight: 600, marginBottom: "0.3rem" }}>
                Likely source
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.9rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {selectedAlert.countryFlag} {selectedAlert.likelySource}
                  </div>
                  <div style={{ fontSize: "0.725rem", color: "var(--tq-text-muted)", marginTop: "0.1rem" }}>
                    {selectedAlert.sourcePercent}
                  </div>
                </div>

                <Link
                  to="/app/impact"
                  className="tq-btn tq-btn-outline"
                  style={{ fontSize: "0.725rem", padding: "0.3rem 0.55rem", whiteSpace: "nowrap", textDecoration: "none" }}
                >
                  View impact
                </Link>
              </div>
            </div>

            {/* Detected Time */}
            <div style={{ fontSize: "0.775rem", color: "var(--tq-text-muted)", marginBottom: "0.85rem" }}>
              <strong>Detected:</strong> {selectedAlert.detected}
            </div>

            {/* What happened */}
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontWeight: 700, fontSize: "0.825rem", marginBottom: "0.3rem" }}>
                What happened
              </div>
              <p style={{ fontSize: "0.775rem", color: "var(--tq-text-muted)", lineHeight: 1.45, margin: 0 }}>
                {selectedAlert.whatHappened}
              </p>
            </div>

            {/* AI Insight Box */}
            <div style={{
              background: "var(--tq-primary-light)",
              border: "1px solid var(--tq-primary-border)",
              borderRadius: "10px",
              padding: "0.75rem",
              marginBottom: "1.25rem",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700, fontSize: "0.8rem", color: "var(--tq-primary)", marginBottom: "0.25rem" }}>
                <span>✦</span>
                <span>AI Insight</span>
              </div>
              <p style={{ margin: 0, fontSize: "0.775rem", color: "#1e3a8a", lineHeight: 1.45 }}>
                {selectedAlert.aiInsight}
              </p>
            </div>

            {/* Action Button: Resolve */}
            <div>
              <button
                onClick={() => toggleResolveStatus(selectedAlert.id)}
                className={`tq-btn ${selectedAlert.status === "Active" ? "tq-btn-outline" : "tq-btn-primary"}`}
                style={{ width: "100%", fontSize: "0.8rem", padding: "0.5rem" }}
              >
                {selectedAlert.status === "Active" ? "✓ Mark Resolved" : "Re-open"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
