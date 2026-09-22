import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { getShopByDomain } from "../services/shop.server";
import prisma from "../db.server";
import { getShopSettings, updateShopSettings } from "../services/analytics.server";
import { sendHighSeverityAlertEmail } from "../services/email.server";

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

  const [settings, shopObj] = await Promise.all([
    getShopSettings(shopId),
    prisma.shop.findUnique({ where: { id: shopId }, select: { email: true } }),
  ]);

  const cleanShop = shopDomain.replace(".myshopify.com", "");
  const apiKey = process.env.SHOPIFY_API_KEY || "756e05704f05bf7d737d3e0e517ece64";
  const themeEditorUrl = `https://admin.shopify.com/store/${cleanShop}/themes/current/editor?context=apps&activateAppId=${apiKey}/traffiq_challenge`;

  return {
    settings: {
      protectionMode: settings?.protectionMode === "BLOCK" ? "BLOCK" : "CHALLENGE",
      autoProtect: settings?.autoProtect ?? true,
      emailAlerts: settings?.emailAlerts ?? true,
      alertFrequency:
        settings?.alertFrequency === "REALTIME"
          ? "Real-time"
          : settings?.alertFrequency === "HOURLY"
            ? "Hourly"
            : settings?.alertFrequency === "WEEKLY"
              ? "Weekly"
              : "Daily",
      dataRetention: `${settings?.dataRetentionDays ?? 30} days`,
      shareData: settings?.anonymousDataSharing ?? false,
    },
    shopDomain,
    themeEditorUrl,
    shopEmail: shopObj?.email || "sparsh.saxena@explified.com",
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
  const intent = formData.get("intent") as string | undefined;

  // Handle live test alert email dispatch
  if (intent === "sendTestEmail") {
    const shop = await prisma.shop.findUnique({ where: { id: shopId }, include: { settings: true } });
    if (shop) {
      const recipientEmail = (formData.get("recipientEmail") as string) || shop.email || "sparsh.saxena@explified.com";
      const mockAlert = {
        type: "TEST_SECURITY_ALERT",
        title: "Test Security Alert: High Risk Session Detected",
        description: "This is a real test notification from Traffiq to verify that high-severity security alerts are successfully delivered to your inbox.",
        severity: "High" as const,
        status: "Active" as const,
        detectedAt: new Date(),
        affectedSessions: "1",
        botLikelihood: "98%",
        source: "Direct Traffic",
        trafficType: "BOT",
        countryFlag: "🛡️",
        increase: "+100%",
      };
      const result = await sendHighSeverityAlertEmail({
        alert: mockAlert,
        shopDomain: shop.shopDomain,
        shopName: shop.name,
        recipientEmail,
      });
      return { success: result.sent, testEmailSent: true, recipientEmail, messageId: result.messageId, error: result.reason };
    }
  }

  // Handle recipient email update
  if (formData.has("merchantEmail")) {
    const rawEmail = formData.get("merchantEmail");
    const merchantEmail = typeof rawEmail === "string" ? rawEmail.trim() : "";
    if (merchantEmail) {
      await prisma.shop.update({
        where: { id: shopId },
        data: { email: merchantEmail },
      });
    }
  }

  const protectionMode = formData.get("protectionMode") as string | undefined;
  const autoProtect = formData.has("autoProtect")
    ? formData.get("autoProtect") === "true"
    : undefined;
  const emailAlerts = formData.has("emailAlerts")
    ? formData.get("emailAlerts") === "true"
    : undefined;
  const alertFrequency = formData.get("alertFrequency") as string | undefined;
  const dataRetention = formData.get("dataRetention") as string | undefined;
  const shareData = formData.has("shareData")
    ? formData.get("shareData") === "true"
    : undefined;

  let freqStr: string | undefined = undefined;
  if (alertFrequency) {
    freqStr = alertFrequency.toUpperCase();
    if (freqStr === "REAL-TIME") freqStr = "REALTIME";
  }

  let retentionDays: number | undefined = undefined;
  if (dataRetention) {
    retentionDays = parseInt(dataRetention.replace(/\D/g, ""), 10) || 30;
  }

  const previousSettings = await prisma.shopSettings.findUnique({ where: { shopId } });

  const updated = await updateShopSettings(shopId, {
    protectionMode: protectionMode || undefined,
    autoProtect,
    emailAlerts,
    alertFrequency: freqStr,
    dataRetentionDays: retentionDays,
    anonymousDataSharing: shareData,
  });

  // Write to AuditLog when protectionMode changes
  if (protectionMode && protectionMode !== previousSettings?.protectionMode) {
    await prisma.auditLog.create({
      data: {
        shopId,
        actor: "MERCHANT",
        action: "SETTINGS_PROTECTION_MODE_UPDATED",
        resourceType: "Settings",
        resourceId: updated.id,
        metadata: JSON.stringify({
          previousMode: previousSettings?.protectionMode || "MONITOR",
          newMode: protectionMode,
          timestamp: new Date().toISOString(),
        }),
      },
    });
  }

  return { success: true, settings: updated };
};

const getProtectionModeDesc = (mode: string) => {
  switch (mode) {
    case "BLOCK":
      return "Enforce automated blocking on high-risk traffic (score > 80) at checkout validation. Suspicious sessions (score 50–80) are flagged with continuous AI recommendations and are not blocked.";
    case "CHALLENGE":
    default:
      return "Require a quick bot verification challenge for high-risk traffic (score > 80) at checkout. Suspicious sessions (score 50–80) are flagged with continuous AI recommendations and are not blocked.";
  }
};

export default function SettingsPage() {
  const { settings: initialSettings, themeEditorUrl } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const [protectionMode, setProtectionMode] = useState(initialSettings.protectionMode === "BLOCK" ? "BLOCK" : "CHALLENGE");
  const [emailAlerts, setEmailAlerts] = useState(initialSettings.emailAlerts);
  const [alertFrequency, setAlertFrequency] = useState(initialSettings.alertFrequency);
  const [dataRetention, setDataRetention] = useState(initialSettings.dataRetention);
  const [shareData, setShareData] = useState(initialSettings.shareData);
  const [savedFeedback, setSavedFeedback] = useState(false);

  useEffect(() => {
    setProtectionMode(initialSettings.protectionMode === "BLOCK" ? "BLOCK" : "CHALLENGE");
    setEmailAlerts(initialSettings.emailAlerts);
    setAlertFrequency(initialSettings.alertFrequency);
    setDataRetention(initialSettings.dataRetention);
    setShareData(initialSettings.shareData);
  }, [initialSettings]);

  const showSavedNotice = () => {
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 2200);
  };

  const handleUpdate = (field: string, value: string | boolean) => {
    showSavedNotice();
    fetcher.submit(
      { [field]: String(value) },
      { method: "POST" }
    );
  };

  const setMode = (mode: string) => {
    setProtectionMode(mode);
    handleUpdate("protectionMode", mode);
  };

  return (
    <div className="tq-page" style={{ margin: 0, maxWidth: "1050px", padding: "1.25rem 2rem 2rem 2rem" }}>
      {/* Header */}
      <div className="tq-header-row" style={{ marginBottom: "1rem", justifyContent: "flex-start", alignItems: "center", gap: "1.5rem" }}>
        <div className="tq-header-title">
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0 0 0.2rem 0", textAlign: "left" }}>Settings</h1>
          <p style={{ fontSize: "0.85rem", color: "var(--tq-text-muted)", margin: 0, textAlign: "left" }}>Manage Traffiq preferences and protection.</p>
        </div>

        {savedFeedback && (
          <div className="tq-toast-notice">
            <span>✓</span>
            <span>Preferences updated</span>
          </div>
        )}
      </div>

      {/* 1. Protection Card */}
      <div className="tq-settings-card-v2">
        <div className="tq-settings-left-col">
          <div className="tq-settings-left-icon blue">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <h3>Protection</h3>
          <p>Control how Traffiq responds to suspicious traffic.</p>
        </div>

        <div className="tq-settings-right-col">
          {/* Protection status */}
          <div className="tq-settings-row-v2">
            <div className="tq-settings-label-wrap">
              <h4>Protection status</h4>
            </div>
            <div className="tq-status-active-pill">
              <span className="tq-green-dot-pulse"></span>
              <span>Active</span>
            </div>
          </div>

          {/* Protection mode dropdown & dynamic description */}
          <div className="tq-settings-row-v2 stacked" style={{ borderBottom: "none", paddingBottom: 0 }}>
            <div style={{ width: "100%", marginBottom: "0.15rem" }}>
              <h4 style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--tq-text-main)", margin: "0 0 0.4rem 0" }}>
                Protection mode
              </h4>
              <div style={{ position: "relative", maxWidth: "380px" }}>
                <div style={{
                  position: "absolute",
                  left: "0.8rem",
                  top: "50%",
                  transform: "translateY(-50%)",
                  pointerEvents: "none",
                  display: "flex",
                  alignItems: "center",
                  color: "#2563eb",
                }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <select
                  className="tq-native-select"
                  value={protectionMode}
                  onChange={(e) => setMode(e.target.value)}
                  style={{
                    width: "100%",
                    paddingLeft: "2.3rem",
                    paddingRight: "2rem",
                    height: "34px",
                    fontSize: "0.85rem",
                    fontWeight: 500,
                    borderRadius: "6px",
                  }}
                >
                  <option value="CHALLENGE">Challenge suspicious traffic (Default)</option>
                  <option value="BLOCK">Block high-risk traffic</option>
                </select>
              </div>
            </div>

            <p style={{ fontSize: "0.775rem", color: "var(--tq-text-muted)", margin: "0.4rem 0 0 0" }}>
              {getProtectionModeDesc(protectionMode)}
            </p>
          </div>

          {/* Storefront Bot Challenge App Embed Activation */}
          <div className="tq-settings-row-v2 stacked" style={{ borderTop: "1px solid #f1f5f9", paddingTop: "0.95rem", marginTop: "0.95rem", borderBottom: "none", paddingBottom: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%", gap: "1rem" }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                  <h4 style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--tq-text-main)", margin: 0 }}>
                    Storefront Bot Challenge (App Embed)
                  </h4>
                  <span className="tq-perm-scope-badge amber" style={{ fontSize: "0.7rem", padding: "0.15rem 0.45rem" }}>
                    Theme Embed
                  </span>
                </div>
                <p style={{ fontSize: "0.775rem", color: "var(--tq-text-muted)", margin: 0, lineHeight: 1.4 }}>
                  Displays an interactive bot verification modal on storefront product and cart pages when Protection Mode is set to Challenge. Enable or customize this embed in your active theme.
                </p>
              </div>

              <a
                href={themeEditorUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="tq-btn tq-btn-secondary"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  fontSize: "0.8rem",
                  padding: "0.45rem 0.85rem",
                  textDecoration: "none",
                  flexShrink: 0,
                  borderRadius: "6px",
                  fontWeight: 600,
                }}
              >
                <span>Open Theme Editor</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Alerts Card */}
      <div className="tq-settings-card-v2">
        <div className="tq-settings-left-col">
          <div className="tq-settings-left-icon purple">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </div>
          <h3>Alerts</h3>
          <p>Choose when and how you want to be notified.</p>
        </div>

        <div className="tq-settings-right-col">
          {/* Email alerts */}
          <div className="tq-settings-row-v2">
            <div className="tq-settings-label-wrap">
              <h4>Email alerts</h4>
              <p>Receive email notifications for important traffic events.</p>
            </div>
            <label className="tq-ios-switch" aria-label="Toggle email alerts">
              <input
                type="checkbox"
                checked={emailAlerts}
                onChange={(e) => {
                  setEmailAlerts(e.target.checked);
                  handleUpdate("emailAlerts", e.target.checked);
                }}
              />
              <span className="tq-ios-slider"></span>
            </label>
          </div>

          {/* Alert frequency */}
          <div className="tq-settings-row-v2" style={{ borderBottom: "none", paddingBottom: 0 }}>
            <div className="tq-settings-label-wrap">
              <h4>Alert frequency</h4>
              <p>Send a summary email</p>
            </div>
            <div>
              <select
                className="tq-native-select"
                value={alertFrequency}
                onChange={(e) => {
                  setAlertFrequency(e.target.value);
                  handleUpdate("alertFrequency", e.target.value);
                }}
                style={{ minWidth: "120px" }}
              >
                <option value="Daily">Daily</option>
                <option value="Real-time">Real-time</option>
                <option value="Hourly">Hourly</option>
                <option value="Weekly">Weekly</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Data & Privacy Card */}
      <div className="tq-settings-card-v2" style={{ marginBottom: 0 }}>
        <div className="tq-settings-left-col">
          <div className="tq-settings-left-icon green">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
            </svg>
          </div>
          <h3>Data &amp; Privacy</h3>
          <p>Manage how Traffiq handles your data.</p>
        </div>

        <div className="tq-settings-right-col">
          {/* Data retention */}
          <div className="tq-settings-row-v2">
            <div className="tq-settings-label-wrap">
              <h4>Data retention</h4>
              <p>Store traffic data for the selected period. Traffic sessions, events, and security logs older than this window are automatically purged.</p>
            </div>
            <div>
              <select
                className="tq-native-select"
                value={dataRetention}
                onChange={(e) => {
                  setDataRetention(e.target.value);
                  handleUpdate("dataRetention", e.target.value);
                }}
                style={{ minWidth: "160px" }}
              >
                <option value="7 days">7 days</option>
                <option value="14 days">14 days</option>
                <option value="30 days">30 days (Recommended)</option>
                <option value="60 days">60 days</option>
                <option value="90 days">90 days</option>
                <option value="365 days">365 days (1 year)</option>
              </select>
            </div>
          </div>

          {/* Share anonymous data */}
          <div className="tq-settings-row-v2">
            <div className="tq-settings-label-wrap">
              <h4>Share anonymous data</h4>
              <p>Help improve bot detection by sharing anonymized traffic patterns.</p>
            </div>
            <label className="tq-ios-switch" aria-label="Toggle anonymous data sharing">
              <input
                type="checkbox"
                checked={shareData}
                onChange={(e) => {
                  setShareData(e.target.checked);
                  handleUpdate("shareData", e.target.checked);
                }}
              />
              <span className="tq-ios-slider"></span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
