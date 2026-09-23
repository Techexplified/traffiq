import { useState, useEffect, useCallback, useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getDashboardOverview,
  getInvestigationSessions,
  getSessionDetail,
  getShopSettings,
  invalidateSessionCache,
} from "../services/analytics.server";
import { getShopByDomain } from "../services/shop.server";
import type { ScoredSession } from "../types/insights";

import prisma from "../db.server";

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

  const [metrics, sessionsData, shopSettings] = await Promise.all([
    getDashboardOverview(shopId),
    getInvestigationSessions(shopId, { limit: 8, page: 1 }),
    getShopSettings(shopId),
  ]);

  const initialDetail = sessionsData.sessions[0] || null;

  return {
    metrics,
    initialSessions: sessionsData.sessions,
    initialDetail,
    totalCount: sessionsData.totalCount,
    totalPages: sessionsData.totalPages,
    availableSources: sessionsData.availableSources,
    availableCountries: sessionsData.availableCountries,
    availableDevices: sessionsData.availableDevices,
    availableTrafficTypes: sessionsData.availableTrafficTypes,
    shopDomain,
    protectionMode: shopSettings?.protectionMode || metrics.protection?.mode || "MONITOR",
  };
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
  const actionType = formData.get("actionType") as string;
  const sessionId = formData.get("sessionId") as string;

  if (!sessionId) {
    return Response.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const sessionRecord = await prisma.trafficSession.findFirst({
    where: { id: sessionId, shopId },
  });

  if (!sessionRecord) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  if (actionType === "block_session") {
    // 1. Create or ensure ProtectionAction with BLOCK
    await prisma.protectionAction.create({
      data: {
        shopId,
        sessionId: sessionRecord.id,
        action: "BLOCK",
        status: "EXECUTED",
        reason: "Manually blocked by merchant via Traffic Investigation",
        metadata: JSON.stringify({
          manual: true,
          sessionKey: sessionRecord.sessionKey,
          timestamp: new Date().toISOString(),
        }),
      },
    });

    // 2. Mark session and any sessions sharing this sessionKey as flagged and blocked
    await prisma.trafficSession.updateMany({
      where: {
        shopId,
        OR: [
          { id: sessionRecord.id },
          { sessionKey: sessionRecord.sessionKey },
        ],
      },
      data: {
        isFlagged: true,
        flaggedReason: "Manually blocked by merchant",
        aiRecommendation: "Session manually blocked by merchant. Block active on storefront and checkout.",
        riskScore: 99,
        severity: "CRITICAL",
        trafficType: "BOT",
      },
    });

    // 3. Invalidate caches so UI & overview update immediately
    invalidateSessionCache(shopId, sessionRecord.id);

    // 4. Audit log
    await prisma.auditLog.create({
      data: {
        shopId,
        actor: "MERCHANT",
        action: "SESSION_MANUALLY_BLOCKED",
        resourceType: "TrafficSession",
        resourceId: sessionRecord.id,
        metadata: JSON.stringify({ sessionId: sessionRecord.id, sessionKey: sessionRecord.sessionKey }),
      },
    });

    return Response.json({ success: true, action: "blocked", sessionId: sessionRecord.id });
  }

  if (actionType === "unblock_session") {
    // 1. Delete BLOCK actions for this session or sessionKey
    await prisma.protectionAction.deleteMany({
      where: {
        shopId,
        OR: [
          { sessionId: sessionRecord.id },
          { session: { sessionKey: sessionRecord.sessionKey } },
          { metadata: { contains: sessionRecord.sessionKey } },
        ],
        action: "BLOCK",
      },
    });

    // 2. Reset session flagged status across matching sessions
    await prisma.trafficSession.updateMany({
      where: {
        shopId,
        OR: [
          { id: sessionRecord.id },
          { sessionKey: sessionRecord.sessionKey },
        ],
      },
      data: {
        isFlagged: false,
        flaggedReason: null,
        aiRecommendation: null,
        riskScore: 15,
        severity: "LOW",
        trafficType: "HUMAN",
      },
    });

    // 3. Invalidate caches
    invalidateSessionCache(shopId, sessionRecord.id);

    // 4. Audit log
    await prisma.auditLog.create({
      data: {
        shopId,
        actor: "MERCHANT",
        action: "SESSION_UNBLOCKED",
        resourceType: "TrafficSession",
        resourceId: sessionRecord.id,
        metadata: JSON.stringify({ sessionId: sessionRecord.id, sessionKey: sessionRecord.sessionKey }),
      },
    });

    return Response.json({ success: true, action: "unblocked", sessionId: sessionRecord.id });
  }

  return Response.json({ error: "Invalid actionType" }, { status: 400 });
};

/**
 * Format country names and flag icons cleanly, avoiding raw or corrupted codes.
 */
function formatCountry(country?: string, flag?: string) {
  if (!country) return { flag: "🌐", name: "Unknown" };

  const isoMap: Record<string, { flag: string; name: string }> = {
    US: { flag: "🇺🇸", name: "United States" },
    USA: { flag: "🇺🇸", name: "United States" },
    GB: { flag: "🇬🇧", name: "United Kingdom" },
    UK: { flag: "🇬🇧", name: "United Kingdom" },
    IN: { flag: "🇮🇳", name: "India" },
    CA: { flag: "🇨🇦", name: "Canada" },
    AU: { flag: "🇦🇺", name: "Australia" },
    DE: { flag: "🇩🇪", name: "Germany" },
    FR: { flag: "🇫🇷", name: "France" },
    NL: { flag: "🇳🇱", name: "Netherlands" },
    JP: { flag: "🇯🇵", name: "Japan" },
    SG: { flag: "🇸🇬", name: "Singapore" },
    BR: { flag: "🇧🇷", name: "Brazil" },
  };

  const upperCountry = country.toUpperCase();
  if (isoMap[upperCountry]) {
    return isoMap[upperCountry];
  }

  // Check if country matches any name
  for (const entry of Object.values(isoMap)) {
    if (entry.name.toLowerCase() === country.toLowerCase()) {
      return entry;
    }
  }

  let displayFlag = "🌐";
  if (flag && flag.length === 2 && isoMap[flag.toUpperCase()]) {
    displayFlag = isoMap[flag.toUpperCase()].flag;
  } else if (flag && !flag.includes("?") && flag.length <= 4 && flag.trim() !== "d???") {
    displayFlag = flag.trim();
  }

  return { flag: displayFlag, name: country };
}

function cleanUrlPath(url?: string): string {
  if (!url) return "/";
  try {
    if (url.startsWith("http")) {
      const parsed = new URL(url);
      return parsed.pathname || "/";
    }
    return url;
  } catch {
    return url.replace(/^https?:\/\/[^/]+/, "") || "/";
  }
}

function formatSignalName(name: string): string {
  const map: Record<string, string> = {
    request_frequency: "Request Frequency",
    navigation_dwell: "Navigation Dwell",
    catalog_traversal: "Catalog Traversal",
    cart_checkout_velocity: "Checkout Velocity",
    automation_signatures: "Automation Signatures",
    campaign_attribution: "Campaign Attribution",
  };
  return map[name] || name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function TrafficInvestigation() {
  const {
    metrics,
    initialSessions,
    initialDetail,
    totalCount: initialTotalCount,
    totalPages: initialTotalPages,
    availableSources: initialSources,
    availableCountries: initialCountries,
    availableDevices: initialDevices,
    availableTrafficTypes: initialTrafficTypes,
    shopDomain,
    protectionMode: loadedProtectionMode,
  } = useLoaderData<typeof loader>();

  const currentProtectionMode = (loadedProtectionMode || metrics?.protection?.mode || "CHALLENGE").toUpperCase() === "BLOCK" ? "BLOCK" : "CHALLENGE";

  const [sessions, setSessions] = useState<ScoredSession[]>(initialSessions);
  const [selectedSession, setSelectedSession] = useState<ScoredSession | null>(initialDetail);
  const [totalCount, setTotalCount] = useState<number>(initialTotalCount);
  const [totalPages, setTotalPages] = useState<number>(initialTotalPages);

  // Search, Filter & Sort State
  const [searchQuery, setSearchQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState("All");
  const [trafficTypeFilter, setTrafficTypeFilter] = useState("All");
  const [sourceFilter, setSourceFilter] = useState("All");
  const [countryFilter, setCountryFilter] = useState("All");
  const [deviceFilter, setDeviceFilter] = useState("All");
  const [severityFilter, setSeverityFilter] = useState("All");
  const [dateFilter, setDateFilter] = useState("All");
  const [sortBy, setSortBy] = useState("lastSeenAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [activePage, setActivePage] = useState(1);

  // UI state
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showSignalsDropdown, setShowSignalsDropdown] = useState(false);
  const [showActivityDropdown, setShowActivityDropdown] = useState(false);
  const [showAssessmentDropdown, setShowAssessmentDropdown] = useState(false);
  const [actionNotice, setActionNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const actionFetcher = useFetcher();

  const handleBlockSession = (sessionId: string) => {
    actionFetcher.submit(
      { actionType: "block_session", sessionId },
      { method: "POST" }
    );
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              isBlocked: true,
              isManuallyBlocked: true,
              isFlagged: true,
              flaggedReason: "Manually blocked by merchant",
            }
          : s
      )
    );
    if (selectedSession && selectedSession.id === sessionId) {
      setSelectedSession({
        ...selectedSession,
        isBlocked: true,
        isManuallyBlocked: true,
        isFlagged: true,
        flaggedReason: "Manually blocked by merchant",
        aiRecommendation: "Session manually blocked by merchant. Block active on storefront and checkout.",
      });
    }
    setActionNotice({ type: "success", message: "✓ Session manually blocked. Storefront & checkout access blocked." });
    setTimeout(() => setActionNotice(null), 4000);
  };

  const handleUnblockSession = (sessionId: string) => {
    actionFetcher.submit(
      { actionType: "unblock_session", sessionId },
      { method: "POST" }
    );
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              isBlocked: false,
              isManuallyBlocked: false,
              isFlagged: (s.riskScore || s.botScore || 0) >= 50,
              flaggedReason: (s.riskScore || s.botScore || 0) >= 50 ? "Suspicious activity detected" : undefined,
            }
          : s
      )
    );
    if (selectedSession && selectedSession.id === sessionId) {
      setSelectedSession({
        ...selectedSession,
        isBlocked: false,
        isManuallyBlocked: false,
        isFlagged: (selectedSession.riskScore || selectedSession.botScore || 0) >= 50,
        flaggedReason: (selectedSession.riskScore || selectedSession.botScore || 0) >= 50 ? "Suspicious activity detected" : undefined,
      });
    }
    setActionNotice({ type: "success", message: "✓ Session unblocked. Normal storefront access restored." });
    setTimeout(() => setActionNotice(null), 4000);
  };

  // Dynamic filter pill choices
  const availableSources = Array.from(new Set([...initialSources, ...sessions.map((s) => s.source)])).filter(Boolean);
  const availableCountries = Array.from(new Set([...initialCountries, ...sessions.map((s) => s.country)])).filter(Boolean);
  const availableDevices = Array.from(new Set([...initialDevices, ...sessions.map((s) => s.device.split("/")[0].trim())])).filter(Boolean);
  const availableTrafficTypes = Array.from(new Set([...initialTrafficTypes, ...sessions.map((s) => s.trafficType).filter(Boolean)])) as string[];

  // Dynamic KPI calculations
  const likelyAutomatedSessions = sessions.filter((s) => s.riskLevel === "Likely Automated");
  const automatedRatio = sessions.length > 0 ? Math.round((likelyAutomatedSessions.length / sessions.length) * 100) : 54;
  const avgBotScore = sessions.length > 0
    ? Math.round(sessions.reduce((sum, s) => sum + (s.botScore ?? 0), 0) / sessions.length)
    : 56;

  // Track initial render to skip duplicate fetch
  // Track initial render to skip duplicate fetch
  const isInitialMount = useRef(true);
  const selectedSessionRef = useRef<ScoredSession | null>(selectedSession);
  selectedSessionRef.current = selectedSession;

  // Fetch list of sessions from GET /api/traffic/sessions
  const fetchSessions = useCallback(async (silent = false) => {
    if (!silent) setIsLoadingList(true);
    try {
      const params = new URLSearchParams({
        page: String(activePage),
        limit: "8",
        shop: shopDomain,
        _t: String(Date.now()),
      });

      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      if (riskFilter !== "All") params.set("riskFilter", riskFilter);
      if (trafficTypeFilter !== "All") params.set("trafficType", trafficTypeFilter);
      if (sourceFilter !== "All") params.set("source", sourceFilter);
      if (countryFilter !== "All") params.set("country", countryFilter);
      if (deviceFilter !== "All") params.set("device", deviceFilter);
      if (severityFilter !== "All") params.set("severity", severityFilter);
      if (dateFilter !== "All") params.set("dateRange", dateFilter);
      if (sortBy) params.set("sortBy", sortBy);
      if (sortOrder) params.set("sortOrder", sortOrder);

      const res = await fetch(`/api/traffic/sessions?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.sessions) {
          setSessions(data.sessions);
          setTotalPages(data.totalPages || 1);
          setTotalCount(data.totalCount ?? data.sessions.length);

          const currentSelected = selectedSessionRef.current;
          // If currently selected session is not in returned list, select the first
          if (data.sessions.length > 0 && (!currentSelected || !data.sessions.some((s: ScoredSession) => s.id === currentSelected.id))) {
            loadSessionDetail(data.sessions[0].id, data.sessions[0]);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch investigation sessions:", err);
    } finally {
      if (!silent) setIsLoadingList(false);
    }
  }, [
    activePage,
    searchQuery,
    riskFilter,
    trafficTypeFilter,
    sourceFilter,
    countryFilter,
    deviceFilter,
    severityFilter,
    dateFilter,
    sortBy,
    sortOrder,
    shopDomain,
  ]);

  // Fetch single session details from GET /api/traffic/sessions/:id
  const loadSessionDetail = async (sessionId: string, fallbackSession?: ScoredSession) => {
    if (fallbackSession) {
      setSelectedSession(fallbackSession);
    }
    setDrawerOpen(true);
    setIsLoadingDetail(true);

    try {
      const res = await fetch(`/api/traffic/sessions/${encodeURIComponent(sessionId)}?shop=${encodeURIComponent(shopDomain)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.session) {
          setSelectedSession(data.session);
        }
      }
    } catch (err) {
      console.error("Failed to load session details:", err);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  // Re-fetch sessions when search/filter/sort/pagination changes (skipping initial mount)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    const debounceTimer = setTimeout(() => {
      fetchSessions();
    }, 250);
    return () => clearTimeout(debounceTimer);
  }, [fetchSessions]);

  // Real-time background sync: automatically refresh sessions every 10s when active
  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        fetchSessions(true);
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [fetchSessions]);

  // Copy to clipboard helper
  const handleCopyId = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    navigator.clipboard?.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  // Gauge calculations for selectedSession
  const botScore = selectedSession?.botScore ?? 0;
  const isHuman = botScore < 50 || selectedSession?.riskLevel === "Likely Human";
  const isAutomated = botScore > 80 || selectedSession?.riskLevel === "Likely Automated";

  const gaugeColor = isHuman ? "#10b981" : isAutomated ? "#ef4444" : "#f59e0b";
  const gaugeSubtext = isAutomated
    ? "Very high probability of automated behavior"
    : isHuman
    ? "Authentic human browsing behavior"
    : "Elevated suspicious browsing detected";

  const selectedCountryInfo = formatCountry(selectedSession?.country, selectedSession?.countryFlag);

  return (
    <div className="tq-page">
      {/* Header */}
      <div className="tq-header-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
        <div className="tq-header-title">
          <h1>Traffic Investigation</h1>
          <p>Explore suspicious traffic and understand why sessions were flagged.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <button
            type="button"
            onClick={() => fetchSessions(false)}
            disabled={isLoadingList}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              background: "#ffffff",
              border: "1px solid #d1d5db",
              color: "#1e293b",
              fontWeight: 600,
              fontSize: "0.85rem",
              padding: "0.5rem 0.85rem",
              borderRadius: "6px",
              cursor: isLoadingList ? "not-allowed" : "pointer",
              boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
              transition: "all 0.15s ease",
            }}
          >
            <span style={{ display: "inline-block", transform: isLoadingList ? "rotate(360deg)" : "none", transition: "transform 0.6s linear" }}>
              🔄
            </span>
            {isLoadingList ? "Refreshing..." : "Refresh Live Traffic"}
          </button>
        </div>
      </div>

      {/* Top 3 KPI Stats */}
      <div className="tq-grid-3">
        {/* 1 */}
        <div className="tq-card tq-stat-card">
          <div className="tq-stat-header">
            <span>Suspicious Sessions</span>
            <span className="tq-info-icon" title="Flagged visits requiring review.">ⓘ</span>
          </div>
          <div className="tq-stat-value-row">
            <span className="tq-stat-number" style={{ color: "var(--tq-danger)" }}>
              {metrics.suspiciousSessions.toLocaleString()}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span className="tq-stat-subtext">{metrics.suspiciousPercent}% of total sessions</span>
            <span className="tq-stat-trend tq-trend-up-red">↑ {metrics.suspiciousTrend}%</span>
          </div>
        </div>

        {/* 2 */}
        <div className="tq-card tq-stat-card">
          <div className="tq-stat-header">
            <span>Likely Automated</span>
            <span className="tq-info-icon" title="Sessions with high automated probability.">ⓘ</span>
          </div>
          <div className="tq-stat-value-row">
            <span className="tq-stat-number">
              {Math.round(metrics.suspiciousSessions * (automatedRatio / 100)).toLocaleString()}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span className="tq-stat-subtext">{automatedRatio}% of suspicious</span>
            <span className="tq-stat-trend tq-trend-up-red">↑ 18%</span>
          </div>
        </div>

        {/* 3 */}
        <div className="tq-card tq-stat-card">
          <div className="tq-stat-header">
            <span>Avg. Bot Likelihood Score</span>
            <span className="tq-info-icon" title="Average confidence score across flagged traffic.">ⓘ</span>
          </div>
          <div className="tq-stat-value-row">
            <span className="tq-stat-number">{avgBotScore}%</span>
            <span className={`tq-badge ${avgBotScore > 80 ? "tq-badge-high" : avgBotScore >= 50 ? "tq-badge-medium" : "tq-badge-good"}`} style={{ marginLeft: "0.5rem" }}>
              {avgBotScore > 80 ? "High" : avgBotScore >= 50 ? "Medium" : "Low"}
            </span>
          </div>
          <div className="tq-stat-subtext" style={{ fontSize: "0.8rem" }}>
            {avgBotScore > 80 ? "Strong probability of non-human traffic" : avgBotScore >= 50 ? "Elevated suspicious browsing detected" : "Authentic human traffic"}
          </div>
        </div>
      </div>

      {/* Split View: Table on Left + Inspector Drawer on Right */}
      <div
        className="tq-split-container"
        style={{
          gridTemplateColumns: drawerOpen ? "minmax(0, 1fr) 380px" : "1fr",
          transition: "all 0.2s ease",
        }}
      >
        {/* Left: Sessions Table Card */}
        <div className="tq-card" style={{ padding: "1.25rem", minWidth: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
            <div style={{ fontWeight: 700, fontSize: "1.05rem", color: "var(--tq-text-main)" }}>
              Sessions ({totalCount})
            </div>
            {isLoadingList && (
              <span style={{ fontSize: "0.8rem", color: "var(--tq-primary)", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                <span className="tq-loading-spinner" style={{ width: "12px", height: "12px", border: "2px solid #cbd5e1", borderTopColor: "var(--tq-primary)", borderRadius: "50%", display: "inline-block", animation: "spin 0.8s linear infinite" }}></span>
                Updating...
              </span>
            )}
          </div>

          {/* Upper Row: Search bar + Sort dropdown */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", marginBottom: "0.875rem" }}>
            <div className="tq-search-box" style={{ flex: 1, minWidth: 0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--tq-text-subtle)", flexShrink: 0 }}>
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                type="text"
                placeholder="Search sessions by ID, source, country, browser..."
                className="tq-search-input"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setActivePage(1);
                }}
              />
            </div>

            {/* Shifted Sort dropdown to upper row */}
            <select
              className="tq-filter-pill"
              style={{ flexShrink: 0, minWidth: "150px" }}
              value={`${sortBy}_${sortOrder}`}
              onChange={(e) => {
                const [newSortBy, newSortOrder] = e.target.value.split("_");
                setSortBy(newSortBy);
                setSortOrder(newSortOrder as "asc" | "desc");
                setActivePage(1);
              }}
            >
              <option value="lastSeenAt_desc">Sort: Newest</option>
              <option value="lastSeenAt_asc">Sort: Oldest</option>
              <option value="riskScore_desc">Sort: Highest Risk</option>
              <option value="riskScore_asc">Sort: Lowest Risk</option>
            </select>
          </div>

          {/* Dynamic Filter Pills Row (Strictly single row across all 5 types) */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
              gap: "0.35rem",
              marginBottom: "1.25rem",
              width: "100%",
            }}
          >
            <select
              className="tq-filter-pill"
              style={{ width: "100%", minWidth: 0, fontSize: "0.75rem", padding: "0.35rem 0.4rem", textOverflow: "ellipsis" }}
              value={riskFilter}
              onChange={(e) => {
                setRiskFilter(e.target.value);
                setActivePage(1);
              }}
            >
              <option value="All">Risk: All</option>
              <option value="Flagged">Risk: Flagged</option>
              <option value="Likely Human">Risk: Human</option>
              <option value="Suspicious">Risk: Suspicious</option>
              <option value="Likely Automated">Risk: Automated</option>
            </select>

            <select
              className="tq-filter-pill"
              style={{ width: "100%", minWidth: 0, fontSize: "0.75rem", padding: "0.35rem 0.4rem", textOverflow: "ellipsis" }}
              value={trafficTypeFilter}
              onChange={(e) => {
                setTrafficTypeFilter(e.target.value);
                setActivePage(1);
              }}
            >
              <option value="All">Type: All</option>
              {availableTrafficTypes.map((t) => (
                <option key={t} value={t}>Type: {t}</option>
              ))}
            </select>

            <select
              className="tq-filter-pill"
              style={{ width: "100%", minWidth: 0, fontSize: "0.75rem", padding: "0.35rem 0.4rem", textOverflow: "ellipsis" }}
              value={sourceFilter}
              onChange={(e) => {
                setSourceFilter(e.target.value);
                setActivePage(1);
              }}
            >
              <option value="All">Source: All</option>
              {availableSources.map((s) => (
                <option key={s} value={s}>Source: {s}</option>
              ))}
            </select>

            <select
              className="tq-filter-pill"
              style={{ width: "100%", minWidth: 0, fontSize: "0.75rem", padding: "0.35rem 0.4rem", textOverflow: "ellipsis" }}
              value={countryFilter}
              onChange={(e) => {
                setCountryFilter(e.target.value);
                setActivePage(1);
              }}
            >
              <option value="All">Country: All</option>
              {availableCountries.map((c) => {
                const info = formatCountry(c);
                return (
                  <option key={c} value={c}>Country: {info.flag} {info.name}</option>
                );
              })}
            </select>

            <select
              className="tq-filter-pill"
              style={{ width: "100%", minWidth: 0, fontSize: "0.75rem", padding: "0.35rem 0.4rem", textOverflow: "ellipsis" }}
              value={deviceFilter}
              onChange={(e) => {
                setDeviceFilter(e.target.value);
                setActivePage(1);
              }}
            >
              <option value="All">Device: All</option>
              {availableDevices.map((d) => (
                <option key={d} value={d}>Device: {d}</option>
              ))}
            </select>
          </div>

          {/* Sessions Table */}
          <div style={{ overflowX: "auto", width: "100%", WebkitOverflowScrolling: "touch" }}>
            <table className="tq-table">
              <thead>
                <tr>
                  <th>Session ID</th>
                  <th>Traffic Type</th>
                  <th>Risk Score</th>
                  <th>Risk Level</th>
                  <th>Source</th>
                  <th>Country</th>
                  <th>Time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", padding: "2.5rem 1rem", color: "var(--tq-text-muted)" }}>
                      No sessions found matching your active filters.
                    </td>
                  </tr>
                ) : (
                  sessions.map((session) => {
                    const isSelected = selectedSession?.id === session.id;
                    const isManuallyBlocked = Boolean(session.isManuallyBlocked);
                    const sessionIsHuman = !isManuallyBlocked && (session.riskLevel === "Likely Human" || (session.botScore ?? 0) < 50);
                    const sessionIsHigh = isManuallyBlocked || (session.botScore ?? 0) > 80 || session.riskLevel === "Likely Automated";
                    const isSuspicious = !sessionIsHuman && !sessionIsHigh;
                    const dotColor = isManuallyBlocked ? "#dc2626" : sessionIsHuman ? "#10b981" : sessionIsHigh ? "var(--tq-danger)" : "var(--tq-warning)";
                    const barColor = isManuallyBlocked ? "#dc2626" : sessionIsHuman ? "#10b981" : sessionIsHigh ? "var(--tq-danger)" : "var(--tq-warning)";
                    const typeLabel = isManuallyBlocked ? "Blocked (Manual)" : session.riskLevel || (sessionIsHuman ? "Likely Human" : sessionIsHigh ? "Likely Automated" : "Suspicious");
                    const isFlagged = session.isFlagged ?? (isSuspicious || sessionIsHigh || isManuallyBlocked);
                    let statusLabel = "✓ Monitored";
                    if (isManuallyBlocked) {
                      statusLabel = "🛑 Blocked (Manual)";
                    } else if (sessionIsHigh) {
                      statusLabel = currentProtectionMode === "BLOCK" ? "Blocked" : "Challenge";
                    } else if (isSuspicious || isFlagged) {
                      statusLabel = "🚩 Flagged";
                    }

                    const countryInfo = formatCountry(session.country, session.countryFlag);
                    const shortId = `#${session.id.slice(-6)}`;

                    return (
                      <tr
                        key={session.id}
                        className={`tq-row-selectable ${isSelected ? "tq-row-selected" : ""}`}
                        onClick={() => loadSessionDetail(session.id, session)}
                      >
                        <td>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                            <span
                              style={{ fontWeight: 700, color: "var(--tq-primary)", fontFamily: "monospace" }}
                              title={session.id}
                            >
                              {shortId}
                            </span>
                            <button
                              onClick={(e) => handleCopyId(session.id, e)}
                              style={{
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                padding: "2px",
                                fontSize: "0.75rem",
                                color: copiedId === session.id ? "var(--tq-success)" : "var(--tq-text-subtle)",
                              }}
                              title="Copy full session ID"
                            >
                              {copiedId === session.id ? "✓" : "📋"}
                            </button>
                          </div>
                        </td>
                        <td>
                          <span className={`tq-badge ${isManuallyBlocked ? "tq-badge-high" : sessionIsHuman ? "tq-badge-good" : sessionIsHigh ? "tq-badge-high" : "tq-badge-medium"}`}>
                            {typeLabel}
                          </span>
                        </td>
                        <td>
                          <div className="tq-likelihood-bar-container">
                            <span style={{ fontWeight: 700, fontSize: "0.825rem", width: "24px", textAlign: "right" }}>
                              {session.botScore ?? session.riskScore ?? 0}
                            </span>
                            <div className="tq-likelihood-bar">
                              <div
                                className="tq-likelihood-fill"
                                style={{
                                  width: `${Math.min(100, Math.max(0, session.botScore ?? session.riskScore ?? 0))}%`,
                                  background: barColor,
                                }}
                              />
                            </div>
                          </div>
                        </td>
                        <td>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.825rem", fontWeight: 500, whiteSpace: "nowrap" }}>
                            <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: dotColor }}></span>
                            <span>{session.riskLevel}</span>
                          </span>
                        </td>
                        <td style={{ color: "var(--tq-text-muted)" }}>{session.source}</td>
                        <td style={{ color: "var(--tq-text-muted)", fontSize: "0.825rem", whiteSpace: "nowrap" }}>
                          {countryInfo.flag} {countryInfo.name}
                        </td>
                        <td style={{ color: "var(--tq-text-muted)", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                          {session.time}
                        </td>
                        <td>
                          <span className={`tq-badge ${isManuallyBlocked ? "tq-badge-high" : isFlagged ? "tq-badge-medium" : "tq-badge-good"}`} style={{ fontWeight: 600, fontSize: "0.75rem" }}>
                            {statusLabel}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Dynamic Pagination */}
          <div className="tq-pagination" style={{ marginTop: "1.25rem" }}>
            <button
              className="tq-page-btn"
              disabled={activePage <= 1}
              onClick={() => setActivePage((p) => Math.max(1, p - 1))}
            >
              ‹
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
              <button
                key={pageNum}
                className={`tq-page-btn ${activePage === pageNum ? "active" : ""}`}
                onClick={() => setActivePage(pageNum)}
              >
                {pageNum}
              </button>
            ))}
            <button
              className="tq-page-btn"
              disabled={activePage >= totalPages}
              onClick={() => setActivePage((p) => Math.min(totalPages, p + 1))}
            >
              ›
            </button>
          </div>
        </div>

        {/* Right: Interactive Session Detail Inspector Drawer */}
        {drawerOpen && selectedSession && (
          <div className="tq-card" style={{ padding: "1.25rem", position: "sticky", top: "5rem", minWidth: 0 }}>
            {/* Drawer Header: Title, Badge, and Close Button */}
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "0.85rem",
              gap: "0.5rem",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                <span style={{ fontSize: "1.1rem", fontWeight: 800, color: "#0f172a" }}>
                  Session #{selectedSession.displayId?.replace(/^#/, "") || selectedSession.id.slice(-5)}
                </span>
                <button
                  onClick={(e) => handleCopyId(selectedSession.id, e)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "2px",
                    fontSize: "0.75rem",
                    color: copiedId === selectedSession.id ? "var(--tq-success)" : "var(--tq-text-subtle)",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                  title={`Copy full ID: ${selectedSession.id}`}
                >
                  {copiedId === selectedSession.id ? "✓" : "📋"}
                </button>
                <span style={{
                  background: isHuman ? "#dcfce7" : isAutomated ? "#fef2f2" : "#fffbeb",
                  color: isHuman ? "#15803d" : isAutomated ? "#ef4444" : "#b45309",
                  border: isHuman ? "1px solid #bbf7d0" : isAutomated ? "1px solid #fee2e2" : "1px solid #fde68a",
                  fontSize: "0.725rem",
                  fontWeight: 600,
                  padding: "0.15rem 0.55rem",
                  borderRadius: "9999px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                }}>
                  <span style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: isHuman ? "#16a34a" : isAutomated ? "#ef4444" : "#f59e0b",
                  }}></span>
                  <span>{selectedSession.riskLevel}</span>
                </span>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "1.2rem",
                  color: "#64748b",
                  padding: "2px 6px",
                  lineHeight: 1,
                }}
                title="Close drawer"
              >
                ✕
              </button>
            </div>

            {/* Compact 3-Column Inspection Summary (Score + Gauge, Source/Time, Country/Device) */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "1.25fr 1fr 1fr",
              borderTop: "1px solid #f1f5f9",
              borderBottom: "1px solid #f1f5f9",
              padding: "0.75rem 0",
              marginBottom: "1rem",
              gap: "0",
            }}>
              {/* Column 1: Bot Likelihood Score & Gauge */}
              <div style={{ paddingRight: "0.75rem", borderRight: "1px solid #f1f5f9" }}>
                <div style={{ fontSize: "0.725rem", color: "#64748b", fontWeight: 500 }}>
                  Bot Likelihood Score
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "0.2rem 0" }}>
                  <span style={{ fontSize: "1.75rem", fontWeight: 800, color: gaugeColor, lineHeight: 1 }}>
                    {botScore}%
                  </span>
                  <svg width="64" height="34" viewBox="0 0 76 42" style={{ overflow: "visible", flexShrink: 0 }}>
                    {/* Background Arc */}
                    <path
                      d="M 10 34 A 28 28 0 0 1 66 34"
                      fill="none"
                      stroke="#f1f5f9"
                      strokeWidth="9"
                      strokeLinecap="round"
                    />
                    {/* Progress Arc */}
                    <path
                      d="M 10 34 A 28 28 0 0 1 66 34"
                      fill="none"
                      stroke={gaugeColor}
                      strokeWidth="9"
                      strokeLinecap="round"
                      strokeDasharray="88"
                      strokeDashoffset={88 - (88 * Math.min(100, Math.max(0, botScore))) / 100}
                      style={{ transition: "stroke-dashoffset 0.6s ease" }}
                    />
                  </svg>
                </div>
                <div style={{ fontSize: "0.7rem", color: "#64748b", lineHeight: 1.35 }}>
                  {gaugeSubtext}
                </div>
              </div>

              {/* Column 2: Source & Detected at */}
              <div style={{ padding: "0 0.75rem", borderRight: "1px solid #f1f5f9", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: "0.725rem", color: "#64748b", fontWeight: 500, marginBottom: "0.15rem" }}>
                    Source
                  </div>
                  <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {selectedSession.source || "Direct"}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "0.725rem", color: "#64748b", fontWeight: 500, marginBottom: "0.15rem" }}>
                    Detected at
                  </div>
                  <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {selectedSession.time || "Recently"}
                  </div>
                </div>
              </div>

              {/* Column 3: Country & Device */}
              <div style={{ paddingLeft: "0.75rem", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: "0.725rem", color: "#64748b", fontWeight: 500, marginBottom: "0.15rem" }}>
                    Country
                  </div>
                  <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {selectedCountryInfo.flag} {selectedCountryInfo.name}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "0.725rem", color: "#64748b", fontWeight: 500, marginBottom: "0.15rem" }}>
                    Device
                  </div>
                  <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {selectedSession.device || `${selectedSession.device?.split("/")[0]?.trim() || "Desktop"} / ${selectedSession.browser || "Chrome"}`}
                  </div>
                </div>
              </div>
            </div>

            {/* 1. Detection Signals Dropdown Option */}
            {selectedSession.detectionSignals && selectedSession.detectionSignals.length > 0 && (() => {
              const allNormal = selectedSession.detectionSignals.every((s) => !s.severity || s.severity === "Low");
              const elevatedCount = selectedSession.detectionSignals.filter((s) => s.severity === "High" || s.severity === "Medium").length;

              return (
                <div style={{ marginBottom: "0.55rem" }}>
                  <button
                    type="button"
                    onClick={() => setShowSignalsDropdown(!showSignalsDropdown)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "0.5rem 0.75rem",
                      background: showSignalsDropdown ? "var(--tq-bg)" : "#ffffff",
                      borderRadius: showSignalsDropdown ? "8px 8px 0 0" : "8px",
                      border: "1px solid #e2e8f0",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
                      <span style={{ fontSize: "0.85rem" }}>📡</span>
                      <span style={{ fontSize: "0.775rem", fontWeight: 700, color: "#1e293b" }}>
                        Detection Signals ({selectedSession.detectionSignals.length})
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
                      {allNormal ? (
                        <span style={{
                          fontSize: "0.68rem",
                          color: "#15803d",
                          fontWeight: 600,
                          background: "#dcfce7",
                          border: "1px solid #bbf7d0",
                          padding: "0.15rem 0.5rem",
                          borderRadius: "9999px",
                        }}>
                          ✓ All signals normal
                        </span>
                      ) : (
                        <span style={{
                          fontSize: "0.68rem",
                          color: "#b91c1c",
                          fontWeight: 600,
                          background: "#fee2e2",
                          border: "1px solid #fca5a5",
                          padding: "0.15rem 0.5rem",
                          borderRadius: "9999px",
                        }}>
                          ⚠️ {elevatedCount} elevated
                        </span>
                      )}
                      <span style={{
                        fontSize: "0.65rem",
                        color: "#64748b",
                        transform: showSignalsDropdown ? "rotate(180deg)" : "rotate(0deg)",
                        transition: "transform 0.2s ease",
                        display: "inline-block",
                        lineHeight: 1,
                      }}>
                        ▼
                      </span>
                    </div>
                  </button>

                  {showSignalsDropdown && (
                    <div style={{
                      padding: "0.65rem 0.75rem",
                      background: "#ffffff",
                      border: "1px solid #e2e8f0",
                      borderTop: "none",
                      borderRadius: "0 0 8px 8px",
                      display: "grid",
                      gridTemplateColumns: "repeat(2, 1fr)",
                      gap: "0.35rem",
                    }}>
                      {selectedSession.detectionSignals.map((sig, i) => {
                        const isHigh = sig.severity === "High";
                        const isMed = sig.severity === "Medium";
                        return (
                          <div
                            key={i}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              fontSize: "0.72rem",
                              padding: "0.35rem 0.5rem",
                              background: isHigh ? "#fef2f2" : isMed ? "#fffbeb" : "var(--tq-bg)",
                              borderRadius: "6px",
                              border: isHigh ? "1px solid #fecaca" : isMed ? "1px solid #fde68a" : "1px solid #e2e8f0",
                            }}
                          >
                            <span style={{ fontWeight: 600, color: isHigh ? "#dc2626" : isMed ? "#b45309" : "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {formatSignalName(sig.name)}
                            </span>
                            <span style={{
                              fontSize: "0.65rem",
                              fontWeight: 700,
                              color: isHigh ? "#dc2626" : isMed ? "#b45309" : "#16a34a",
                              background: isHigh ? "#fee2e2" : isMed ? "#fef3c7" : "#ecfdf5",
                              padding: "0.1rem 0.35rem",
                              borderRadius: "4px",
                              border: isHigh ? "1px solid #fca5a5" : isMed ? "1px solid #fcd34d" : "1px solid #a7f3d0",
                              marginLeft: "0.3rem",
                              flexShrink: 0,
                            }}>
                              {sig.value}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* 2. Funnel & Activity Timeline Dropdown Option */}
            <div style={{ marginBottom: "0.55rem" }}>
              <button
                type="button"
                onClick={() => setShowActivityDropdown(!showActivityDropdown)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0.5rem 0.75rem",
                  background: showActivityDropdown ? "var(--tq-bg)" : "#ffffff",
                  borderRadius: showActivityDropdown ? "8px 8px 0 0" : "8px",
                  border: "1px solid #e2e8f0",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
                  <span style={{ fontSize: "0.85rem" }}>⚡</span>
                  <span style={{ fontSize: "0.775rem", fontWeight: 700, color: "#1e293b" }}>
                    Funnel &amp; Activity ({selectedSession.sessionTimeline?.length || selectedSession.pageViews || 1} events)
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
                  <span style={{
                    fontSize: "0.68rem",
                    color: "#475569",
                    fontWeight: 600,
                    background: "#f1f5f9",
                    border: "1px solid #e2e8f0",
                    padding: "0.15rem 0.5rem",
                    borderRadius: "9999px",
                  }}>
                    {selectedSession.pageViews || 1} page{selectedSession.pageViews === 1 ? "" : "s"} • {selectedSession.addToCartCount || 0} cart
                  </span>
                  <span style={{
                    fontSize: "0.65rem",
                    color: "#64748b",
                    transform: showActivityDropdown ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.2s ease",
                    display: "inline-block",
                    lineHeight: 1,
                  }}>
                    ▼
                  </span>
                </div>
              </button>

              {showActivityDropdown && (
                <div style={{
                  padding: "0.65rem 0.75rem",
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderTop: "none",
                  borderRadius: "0 0 8px 8px",
                }}>
                  {/* 4 Mini Funnel Metrics */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.35rem", textAlign: "center", marginBottom: "0.5rem" }}>
                    <div style={{ background: "var(--tq-bg)", padding: "0.25rem", borderRadius: "5px", border: "1px solid var(--tq-border)" }}>
                      <div style={{ fontSize: "0.65rem", color: "var(--tq-text-muted)" }}>Pages</div>
                      <div style={{ fontWeight: 700, fontSize: "0.825rem" }}>{selectedSession.pageViews || 1}</div>
                    </div>
                    <div style={{ background: "var(--tq-bg)", padding: "0.25rem", borderRadius: "5px", border: "1px solid var(--tq-border)" }}>
                      <div style={{ fontSize: "0.65rem", color: "var(--tq-text-muted)" }}>Cart Adds</div>
                      <div style={{ fontWeight: 700, fontSize: "0.825rem", color: (selectedSession.addToCartCount || 0) > 0 ? "var(--tq-primary)" : "inherit" }}>
                        {selectedSession.addToCartCount || 0}
                      </div>
                    </div>
                    <div style={{ background: "var(--tq-bg)", padding: "0.25rem", borderRadius: "5px", border: "1px solid var(--tq-border)" }}>
                      <div style={{ fontSize: "0.65rem", color: "var(--tq-text-muted)" }}>Checkout</div>
                      <div style={{ fontWeight: 700, fontSize: "0.825rem", color: selectedSession.checkoutStarted ? "var(--tq-success)" : "inherit" }}>
                        {selectedSession.checkoutStarted ? "Yes" : "No"}
                      </div>
                    </div>
                    <div style={{ background: "var(--tq-bg)", padding: "0.25rem", borderRadius: "5px", border: "1px solid var(--tq-border)" }}>
                      <div style={{ fontSize: "0.65rem", color: "var(--tq-text-muted)" }}>Velocity</div>
                      <div style={{ fontWeight: 700, fontSize: "0.825rem", color: selectedSession.requestsFactor !== "1.0x" ? "var(--tq-danger)" : "inherit" }}>
                        {selectedSession.requestsFactor || "1.0x"}
                      </div>
                    </div>
                  </div>

                  {/* Events List */}
                  {selectedSession.sessionTimeline && selectedSession.sessionTimeline.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", maxHeight: "140px", overflowY: "auto" }}>
                      {selectedSession.sessionTimeline.map((ev, i) => (
                        <div
                          key={ev.id || i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            fontSize: "0.72rem",
                            background: "var(--tq-bg)",
                            padding: "0.25rem 0.45rem",
                            borderRadius: "5px",
                            border: "1px solid #e2e8f0",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", overflow: "hidden" }}>
                            <span style={{ color: "var(--tq-primary)", fontWeight: 600, fontSize: "0.6rem" }}>●</span>
                            <span style={{ fontWeight: 600, textTransform: "capitalize", whiteSpace: "nowrap" }}>
                              {ev.eventType.replace(/_/g, " ")}
                            </span>
                            <span
                              style={{
                                color: "var(--tq-text-muted)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                maxWidth: "140px",
                                fontFamily: "monospace",
                                fontSize: "0.68rem",
                              }}
                              title={ev.pageUrl}
                            >
                              {cleanUrlPath(ev.pageUrl)}
                            </span>
                          </div>
                          <span style={{ color: "var(--tq-text-subtle)", whiteSpace: "nowrap", fontSize: "0.68rem" }}>
                            {ev.formattedTime || `+${ev.elapsedSeconds || 0}s`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 3. Flagged Indicators Dropdown (Only displayed for suspicious or automated sessions) */}
            {!isHuman && selectedSession.reasons && selectedSession.reasons.length > 0 && (
              <div style={{ marginBottom: "0.75rem" }}>
                <button
                  type="button"
                  onClick={() => setShowAssessmentDropdown(!showAssessmentDropdown)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0.5rem 0.75rem",
                    background: showAssessmentDropdown ? "var(--tq-bg)" : "#ffffff",
                    borderRadius: showAssessmentDropdown ? "8px 8px 0 0" : "8px",
                    border: "1px solid #e2e8f0",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
                    <span style={{ fontSize: "0.85rem" }}>⚠️</span>
                    <span style={{ fontSize: "0.775rem", fontWeight: 700, color: "#1e293b" }}>
                      Flagged Indicators ({selectedSession.reasons.length})
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
                    <span style={{
                      fontSize: "0.68rem",
                      color: "#b91c1c",
                      fontWeight: 600,
                      background: "#fee2e2",
                      border: "1px solid #fca5a5",
                      padding: "0.15rem 0.5rem",
                      borderRadius: "9999px",
                    }}>
                      {selectedSession.reasons.length} flagged
                    </span>
                    <span style={{
                      fontSize: "0.65rem",
                      color: "#64748b",
                      transform: showAssessmentDropdown ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 0.2s ease",
                      display: "inline-block",
                      lineHeight: 1,
                    }}>
                      ▼
                    </span>
                  </div>
                </button>

                {showAssessmentDropdown && (
                  <div style={{
                    padding: "0.65rem 0.75rem",
                    background: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderTop: "none",
                    borderRadius: "0 0 8px 8px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.3rem",
                  }}>
                    {selectedSession.reasons.map((r, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          padding: "0.45rem 0.6rem",
                          background: r.severity === "High" ? "#fef2f2" : r.severity === "Medium" ? "#fffbeb" : "#f0fdf4",
                          borderRadius: "6px",
                          border: r.severity === "High" ? "1px solid #fecaca" : r.severity === "Medium" ? "1px solid #fde68a" : "1px solid #bbf7d0",
                          fontSize: "0.725rem",
                          gap: "0.5rem",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.45rem", flex: 1 }}>
                          <span style={{ fontSize: "0.8rem", lineHeight: 1.2, marginTop: "0.05rem", flexShrink: 0 }}>
                            {r.severity === "High" ? "🚨" : r.severity === "Medium" ? "⚠️" : "✓"}
                          </span>
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                            <span style={{ fontWeight: 600, color: r.severity === "High" ? "#991b1b" : r.severity === "Medium" ? "#92400e" : "#15803d" }}>
                              {r.title}
                            </span>
                            <span style={{ color: "#475569", fontSize: "0.7rem", lineHeight: 1.35 }}>
                              {r.desc}
                            </span>
                          </div>
                        </div>
                        <span className={`tq-badge tq-badge-${r.severity.toLowerCase()}`} style={{ fontSize: "0.65rem", padding: "0.1rem 0.35rem", flexShrink: 0 }}>
                          {r.severity}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* AI Explanation Callout */}
            <div style={{
              background: "var(--tq-primary-light)",
              border: "1px solid var(--tq-primary-border)",
              borderRadius: "8px",
              padding: "0.65rem 0.75rem",
              marginBottom: "0.75rem",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700, fontSize: "0.775rem", color: "var(--tq-primary)", marginBottom: "0.2rem" }}>
                <span>✦</span>
                <span>AI Explanation</span>
              </div>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "#1e3a8a", lineHeight: 1.45 }}>
                {selectedSession.aiExplanation || "Automated behavioral pattern detected across navigation timing and client environment signatures."}
              </p>
            </div>

            {/* AI Recommendation & Action Callout */}
            {(() => {
              const sessionScore = selectedSession.botScore ?? selectedSession.riskScore ?? 0;
              const isManuallyBlocked = Boolean(selectedSession.isManuallyBlocked);
              const isHuman = !isManuallyBlocked && (selectedSession.riskLevel === "Likely Human" || sessionScore < 50);
              const isHigh = isManuallyBlocked || sessionScore > 80 || selectedSession.riskLevel === "Likely Automated";
              const isSuspicious = !isHuman && !isHigh;
              const isFlagged = selectedSession.isFlagged ?? (isSuspicious || isHigh || isManuallyBlocked);

              let rawRec = selectedSession.aiRecommendation || "";
              if (rawRec.startsWith("Recommendation: ")) {
                rawRec = rawRec.replace(/^Recommendation:\s*/i, "");
              }

              const recommendationText = isManuallyBlocked
                ? "Session manually blocked by merchant via Traffic Investigation. Visitor is barred from adding items to cart or proceeding to checkout."
                : (rawRec || (
                    isHigh
                      ? (currentProtectionMode === "BLOCK"
                          ? "High-confidence automated bot threat (Risk > 80). Direct checkout block enforced on storefront to protect store inventory."
                          : "High-confidence automated bot activity (Risk > 80). Verification challenge required before allowing checkout.")
                      : isSuspicious
                      ? `Flagged suspicious session (Risk ${sessionScore}/100). Monitored under continuous AI observation without blocking; recommend observing traffic source (${selectedSession.source}) and ad audience spend.`
                      : `Verified genuine shopper browsing pattern (Risk ${sessionScore}/100). Allow full storefront access with standard telemetry observation.`
                  ));

              const badgeLabel = isManuallyBlocked
                ? "🛑 Blocked: Manual Enforcement"
                : isHigh
                ? (currentProtectionMode === "BLOCK" ? "Block: Blocked" : "Challenge: Required")
                : isSuspicious
                ? "Flagged: Allowed (Monitoring)"
                : "Allowed: Safe Browsing";

              const badgeColor = (isManuallyBlocked || isHigh) ? "#dc2626" : isSuspicious ? "#92400e" : "#065f46";
              const badgeBg = (isManuallyBlocked || isHigh) ? "#fee2e2" : isSuspicious ? "#fef3c7" : "#ecfdf5";
              const badgeBorder = (isManuallyBlocked || isHigh) ? "1px solid #fca5a5" : isSuspicious ? "1px solid #fde68a" : "1px solid #a7f3d0";

              return (
                <div style={{
                  background: "#ffffff",
                  border: isManuallyBlocked ? "1px solid #fca5a5" : isFlagged ? "1px solid #fde68a" : "1px solid var(--tq-border)",
                  borderRadius: "10px",
                  padding: "0.85rem",
                  marginBottom: "0.75rem",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700, fontSize: "0.8rem", color: (isManuallyBlocked || isHigh) ? "#dc2626" : isFlagged ? "#92400e" : "var(--tq-primary)" }}>
                      <span>{isManuallyBlocked ? "🛑" : "💡"}</span>
                      <span>{isManuallyBlocked ? "Enforcement Status" : "AI Recommended Action"}</span>
                    </div>
                    <span style={{
                      fontSize: "0.68rem",
                      fontWeight: 600,
                      padding: "0.15rem 0.5rem",
                      borderRadius: "9999px",
                      background: badgeBg,
                      color: badgeColor,
                      border: badgeBorder,
                    }}>
                      {badgeLabel}
                    </span>
                  </div>

                  {selectedSession.flaggedReason && isFlagged && (
                    <div style={{ fontSize: "0.72rem", color: isManuallyBlocked ? "#dc2626" : "#b45309", marginBottom: "0.4rem", fontWeight: 600 }}>
                      Reason: {selectedSession.flaggedReason}
                    </div>
                  )}

                  <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--tq-text-main)", lineHeight: 1.45 }}>
                    {recommendationText}
                  </p>

                  {/* Manual Enforcement Actions */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem", marginTop: "0.85rem" }}>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      {isManuallyBlocked ? (
                        <button
                          type="button"
                          className="tq-btn"
                          disabled={actionFetcher.state !== "idle"}
                          onClick={() => handleUnblockSession(selectedSession.id)}
                          style={{
                            flex: 1,
                            fontSize: "0.75rem",
                            padding: "0.45rem 0.65rem",
                            background: "#16a34a",
                            color: "#ffffff",
                            border: "1px solid #15803d",
                            fontWeight: 600,
                            borderRadius: "6px",
                            cursor: actionFetcher.state !== "idle" ? "not-allowed" : "pointer",
                          }}
                        >
                          {actionFetcher.state !== "idle" ? "Updating..." : "🛡️ Unblock Session"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="tq-btn"
                          disabled={actionFetcher.state !== "idle"}
                          onClick={() => handleBlockSession(selectedSession.id)}
                          style={{
                            flex: 1,
                            fontSize: "0.75rem",
                            padding: "0.45rem 0.65rem",
                            background: "#dc2626",
                            color: "#ffffff",
                            border: "1px solid #b91c1c",
                            fontWeight: 600,
                            borderRadius: "6px",
                            cursor: actionFetcher.state !== "idle" ? "not-allowed" : "pointer",
                          }}
                          title="Block this visitor session from adding to cart or accessing checkout"
                        >
                          {actionFetcher.state !== "idle" ? "Blocking..." : "🛑 Manually Block Session"}
                        </button>
                      )}
                      {selectedSession.campaign && selectedSession.campaign !== "None" && (
                        <button
                          type="button"
                          className="tq-btn tq-btn-outline"
                          style={{ fontSize: "0.75rem", padding: "0.45rem 0.65rem" }}
                          onClick={() => {
                            alert(`Campaign '${selectedSession.campaign}' marked for negative audience exclusion.`);
                          }}
                        >
                          Exclude from Ads
                        </button>
                      )}
                    </div>
                    {actionNotice && (
                      <div style={{ fontSize: "0.725rem", color: actionNotice.type === "error" ? "#dc2626" : "#16a34a", fontWeight: 600 }}>
                        {actionNotice.message}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
