import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useNavigate, useLoaderData, useFetcher, redirect } from "react-router";
import { authenticate } from "../shopify.server";
import {
  fetchShopDataFromAdmin,
  getShopByDomain,
  ensureShopConnected,
  saveOnboardingPermissions,
  completeOnboarding,
} from "../services/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopData = await fetchShopDataFromAdmin(admin, session.shop);
  const dbShop = await getShopByDomain(session.shop);
  const url = new URL(request.url);

  // If merchant has already completed onboarding, direct them straight to dashboard
  const forceReconfigure = url.searchParams.get("reconfigure") === "1";
  if (dbShop?.isOnboarded && !forceReconfigure) {
    const search = url.search ? url.search : `?shop=${session.shop}`;
    throw redirect(`/app${search}`);
  }

  const isAlreadyConnected = Boolean(dbShop && dbShop.status === "ACTIVE");
  const isOnboarded = Boolean(dbShop?.isOnboarded);
  const initialStep = dbShop?.onboardingStep || 1;

  const cleanShop = session.shop.replace(".myshopify.com", "");
  const apiKey = process.env.SHOPIFY_API_KEY || "add5a28769a30d6564929931f077bf84";
  const themeEditorUrl = `https://admin.shopify.com/store/${cleanShop}/themes/current/editor?context=apps&activateAppId=${apiKey}/traffiq_challenge`;

  return {
    shop: shopData,
    shopDomain: session.shop,
    themeEditorUrl,
    isAlreadyConnected,
    isOnboarded,
    initialStep,
    settings: {
      checkoutValidation: dbShop?.settings?.checkoutValidation ?? true,
      telemetryAccess: dbShop?.settings?.telemetryAccess ?? true,
      threatDefense: dbShop?.settings?.threatDefense ?? true,
      attributionAccess: dbShop?.settings?.attributionAccess ?? true,
    },
    installedAt: dbShop?.installedAt ? dbShop.installedAt.toISOString() : null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "connect_store") {
    const shopData = await fetchShopDataFromAdmin(admin, session.shop);
    const shop = await ensureShopConnected(session.shop, shopData);
    return {
      success: true,
      actionType: "connect_store",
      shopId: shop.id,
      status: shop.status,
      shopName: shop.name || shopData.name,
    };
  }

  if (actionType === "save_permissions") {
    const dbShop = await getShopByDomain(session.shop);
    if (dbShop) {
      const checkoutValidation = formData.get("checkoutValidation") === "true";
      const telemetryAccess = formData.get("telemetryAccess") === "true";
      const threatDefense = formData.get("threatDefense") === "true";
      const attributionAccess = formData.get("attributionAccess") === "true";

      await saveOnboardingPermissions(dbShop.id, {
        checkoutValidation,
        telemetryAccess,
        threatDefense,
        attributionAccess,
      });
      return { success: true, actionType: "save_permissions", step: 3 };
    }
  }

  if (actionType === "complete_onboarding") {
    const dbShop = await getShopByDomain(session.shop);
    if (dbShop) {
      await completeOnboarding(dbShop.id);
      return { success: true, actionType: "complete_onboarding", completed: true };
    }
  }

  return { success: true };
};

export default function Onboarding() {
  const { shop, shopDomain, themeEditorUrl, isAlreadyConnected, initialStep, settings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{
    success: boolean;
    actionType?: string;
    shopId?: string;
    shopName?: string;
    completed?: boolean;
  }>();

  const [currentStep, setCurrentStep] = useState(initialStep);
  const [inputStore, setInputStore] = useState(shop.myshopifyDomain || shopDomain || "cartmend.myshopify.com");
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "connecting" | "connected">(
    isAlreadyConnected ? "connected" : "idle"
  );
  const [connectionFeedback, setConnectionFeedback] = useState(
    isAlreadyConnected ? "Store connection verified and active." : ""
  );
  const [analyzingProgress, setAnalyzingProgress] = useState(0);
  const [checkoutValidation, setCheckoutValidation] = useState(settings.checkoutValidation);
  const [telemetryAccess, setTelemetryAccess] = useState(settings.telemetryAccess);
  const [threatDefense, setThreatDefense] = useState(settings.threatDefense);
  const [attributionAccess, setAttributionAccess] = useState(settings.attributionAccess);
  const [hasOpenedThemeEditor, setHasOpenedThemeEditor] = useState(false);
  const [embedConfirmed, setEmbedConfirmed] = useState(false);
  const navigate = useNavigate();

  const steps = [
    { num: 1, title: "Connect Store" },
    { num: 2, title: "Grant Access" },
    { num: 3, title: "Analyzing Traffic" },
    { num: 4, title: "Results Ready" },
    { num: 5, title: "Get Started" },
  ];

  // Handle Step 1 "Connect with Shopify" button click
  const handleConnectWithShopify = () => {
    setConnectionStatus("connecting");
    setConnectionFeedback(`Verifying Shopify Admin API credentials & scopes for ${inputStore}...`);
    fetcher.submit({ actionType: "connect_store" }, { method: "POST" });
  };

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data?.actionType === "connect_store") {
      setConnectionFeedback(`Store connection established with ${fetcher.data.shopName || shop.name}!`);
      setConnectionStatus("connected");
      setTimeout(() => {
        setCurrentStep(2);
      }, 900);
    }
    if (fetcher.data?.success && fetcher.data?.actionType === "complete_onboarding") {
      navigate("/app");
    }
  }, [fetcher.data, shop.name, navigate]);

  // Step 2 submit permissions and proceed
  const handleGrantAccess = () => {
    fetcher.submit(
      {
        actionType: "save_permissions",
        checkoutValidation: String(checkoutValidation),
        telemetryAccess: String(telemetryAccess),
        threatDefense: String(threatDefense),
        attributionAccess: String(attributionAccess),
      },
      { method: "POST" }
    );
    setCurrentStep(3);
  };

  // Step 5 complete onboarding and open dashboard
  const handleCompleteOnboarding = () => {
    fetcher.submit({ actionType: "complete_onboarding" }, { method: "POST" });
  };

  // Step 3 Automated Scanning & Loading Animation
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (currentStep === 3) {
      setAnalyzingProgress(0);

      const startTime = Date.now();
      const totalDuration = 3200; // 3.2 seconds total scan time

      timer = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(Math.round((elapsed / totalDuration) * 100), 100);
        setAnalyzingProgress(progress);

        if (progress >= 100) {
          clearInterval(timer);
          setTimeout(() => {
            setCurrentStep(4);
          }, 700);
        }
      }, 100);
    }
    return () => clearInterval(timer);
  }, [currentStep]);

  return (
    <div className="tq-page tq-onboarding-page">
      {/* Header with App Logo */}
      <div style={{ textAlign: "center", marginBottom: "0.75rem", marginTop: "0.25rem" }}>
        <img
          src="/traffiq-logo.png"
          alt="Traffiq"
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "12px",
            boxShadow: "0 4px 14px rgba(37, 99, 235, 0.22)",
            marginBottom: "0.45rem",
            display: "inline-block",
          }}
        />
        <h1 style={{ fontSize: "2.15rem", fontWeight: 800, margin: "0 0 0.3rem 0", color: "var(--tq-text-main)", letterSpacing: "-0.03em" }}>
          Welcome to Traffiq
        </h1>
        <p style={{ fontSize: "1.05rem", color: "var(--tq-text-muted)", margin: 0 }}>
          Let&apos;s connect your store and start protecting your data.
        </p>

        {/* Persistent Connected Store Pill once connection is made and past step 1 */}
        {connectionStatus === "connected" && currentStep > 1 && (
          <div className="tq-connected-store-pill">
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
            <span>Connected Store: <strong>{shop.name}</strong> ({inputStore})</span>
          </div>
        )}
      </div>

      {/* Stepper with arrow divider between every stage */}
      <div className="tq-stepper">
        {steps.map((step, idx) => {
          const isCompleted = currentStep > step.num;
          const isActive = currentStep === step.num;

          return (
            <div key={step.num} style={{ display: "contents" }}>
              <div
                className="tq-step-item"
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (currentStep > step.num) {
                    setCurrentStep(step.num);
                  }
                }}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && currentStep > step.num) {
                    setCurrentStep(step.num);
                  }
                }}
                style={{ cursor: currentStep > step.num ? "pointer" : "default" }}
                title={`Step ${step.num}: ${step.title}`}
              >
                <div
                  className={`tq-step-circle ${isActive ? "active" : ""} ${
                    isCompleted ? "completed" : ""
                  }`}
                >
                  {isCompleted ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    step.num
                  )}
                </div>
                <span className={`tq-step-label ${isActive ? "active" : ""}`}>
                  {step.title}
                </span>
              </div>

              {idx < steps.length - 1 && (
                <div className={`tq-step-divider ${currentStep > step.num ? "completed" : ""}`}>
                  <div className="tq-step-divider-line" />
                  <svg className="tq-step-divider-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* STEP 1: Connect Store */}
      {currentStep === 1 && (
        <div className="tq-onboarding-hero">
          {/* Animated 3-Node Connected Graphic */}
          <div className="tq-connection-graphic">
            <div className="tq-connecting-dashes" />

            {/* Left Node: Shopify Bag */}
            <div className="tq-node-box" title="Shopify Store" style={{ padding: "8px" }}>
              <img
                src="/shopify-bag.png"
                alt="Shopify Store"
                style={{
                  width: "36px",
                  height: "40px",
                  objectFit: "contain",
                  display: "block",
                }}
              />
            </div>

            {/* Center Node: Traffiq Logo with Verified Shield */}
            <div style={{ position: "relative" }}>
              <div
                className="tq-node-box tq-node-center"
                title="Traffiq Engine"
                style={{
                  padding: 0,
                  background: "transparent",
                  border: "none",
                  boxShadow: "none",
                }}
              >
                <img
                  src="/traffiq-logo.png"
                  alt="Traffiq Engine"
                  style={{
                    width: "72px",
                    height: "72px",
                    borderRadius: "18px",
                    boxShadow: "0 8px 24px rgba(37, 99, 235, 0.4)",
                    display: "block",
                  }}
                />
              </div>
              <div style={{
                position: "absolute",
                bottom: "-6px",
                left: "50%",
                transform: "translateX(-50%)",
                background: "#2563eb",
                color: "#ffffff",
                width: "20px",
                height: "20px",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
                border: "2px solid #ffffff",
                zIndex: 3,
              }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            </div>

            {/* Right Node: Analytics Chart */}
            <div className="tq-node-box" title="Store Analytics">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 20V10" />
                <path d="M12 20V4" />
                <path d="M6 20v-6" />
              </svg>
            </div>
          </div>

          <h2 style={{ fontSize: "1.35rem", fontWeight: 700, margin: "0 0 0.35rem 0", color: "var(--tq-text-main)", letterSpacing: "-0.02em" }}>
            Connect your Shopify store
          </h2>

          <p style={{ fontSize: "0.85rem", color: "var(--tq-text-muted)", maxWidth: "460px", margin: "0 auto 1.25rem auto", lineHeight: 1.45 }}>
            Traffiq integrates with your Shopify storefront to monitor visitor patterns, block checkout bots, and protect analytics.
          </p>

          {/* Connected Store Card (Shown ONLY when connected - no duplicate input field) */}
          {connectionStatus === "connected" ? (
            <div className="tq-connected-store-card" style={{ maxWidth: "440px", margin: "0 auto 1.35rem auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
                <div style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "10px",
                  background: "#f0fdf4",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid #bbf7d0",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                  flexShrink: 0,
                }}>
                  <img src="/shopify-bag.png" alt="" style={{ width: "22px", height: "24px", objectFit: "contain" }} />
                </div>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "#0f172a" }}>
                    {shop.name}
                  </div>
                  <div style={{ fontSize: "0.775rem", color: "#64748b" }}>
                    {inputStore} • {shop.plan?.displayName || "Active Store"}
                  </div>
                </div>
              </div>
              <div style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                fontSize: "0.75rem",
                fontWeight: 600,
                color: "#16a34a",
                background: "#f0fdf4",
                padding: "0.25rem 0.65rem",
                borderRadius: "9999px",
                border: "1px solid #bbf7d0",
              }}>
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#16a34a", display: "inline-block" }} />
                <span>Connected</span>
              </div>
            </div>
          ) : (
            /* Store Domain Input Field (Shown ONLY when disconnected or manual entry needed) */
            <div className="tq-store-input-box" style={{ maxWidth: "440px", margin: "0 auto 1.25rem auto" }}>
              <img
                src="/shopify-bag.png"
                alt=""
                style={{ width: "20px", height: "22px", objectFit: "contain", flexShrink: 0 }}
              />
              <input
                type="text"
                className="tq-store-input-field"
                value={inputStore}
                onChange={(e) => setInputStore(e.target.value)}
                placeholder="your-store.myshopify.com"
                disabled={connectionStatus === "connecting"}
              />
              <span style={{ fontSize: "0.75rem", color: "#2563eb", fontWeight: 600, background: "#eff6ff", padding: "0.2rem 0.5rem", borderRadius: "4px" }}>
                Detected
              </span>
            </div>
          )}

          {/* Action Area: Single Primary CTA with subtle secondary options */}
          {connectionStatus === "connected" ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem", marginBottom: "0.85rem" }}>
              <button
                type="button"
                onClick={() => setCurrentStep(2)}
                className="tq-btn tq-btn-primary"
                style={{
                  padding: "0.65rem 1.8rem",
                  fontSize: "0.925rem",
                  borderRadius: "8px",
                }}
              >
                Configure Protection Access →
              </button>

              <div style={{ display: "flex", alignItems: "center", gap: "0.85rem", fontSize: "0.775rem", color: "#64748b" }}>
                <button
                  type="button"
                  onClick={handleConnectWithShopify}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#64748b",
                    textDecoration: "underline",
                    cursor: "pointer",
                    padding: 0,
                    fontSize: "inherit",
                  }}
                >
                  Re-verify connection
                </button>
                <span style={{ color: "#cbd5e1" }}>•</span>
                <button
                  type="button"
                  onClick={() => {
                    fetcher.submit({ actionType: "complete_onboarding" }, { method: "POST" });
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#64748b",
                    textDecoration: "underline",
                    cursor: "pointer",
                    padding: 0,
                    fontSize: "inherit",
                  }}
                >
                  Skip to Dashboard
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleConnectWithShopify}
              disabled={connectionStatus === "connecting"}
              className="tq-btn tq-btn-primary"
              style={{
                padding: "0.65rem 1.8rem",
                fontSize: "0.925rem",
                borderRadius: "8px",
                marginBottom: "0.85rem",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.6rem",
                cursor: connectionStatus === "connecting" ? "wait" : "pointer",
              }}
            >
              {connectionStatus === "connecting" ? (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "spin 1s linear infinite" }}>
                    <line x1="12" y1="2" x2="12" y2="6" />
                    <line x1="12" y1="18" x2="12" y2="22" />
                    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
                    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                    <line x1="2" y1="12" x2="6" y2="12" />
                    <line x1="18" y1="12" x2="22" y2="12" />
                    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
                    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
                  </svg>
                  <span>{connectionFeedback || "Connecting..."}</span>
                </>
              ) : (
                <>
                  <img src="/shopify-bag.png" alt="" style={{ width: "18px", height: "20px", objectFit: "contain" }} />
                  <span>Connect Store</span>
                </>
              )}
            </button>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem", fontSize: "0.75rem", color: "var(--tq-text-muted)", marginTop: "0.25rem" }}>
            <span>🔒</span>
            <span>Your store data is secure. We only access what&apos;s needed for traffic defense.</span>
          </div>
        </div>
      )}

      {/* STEP 2: Grant Access (Checkout Validation & Telemetry) */}
      {currentStep === 2 && (
        <div className="tq-onboarding-hero" style={{ maxWidth: "560px" }}>
          <div style={{
            width: "48px",
            height: "48px",
            background: "var(--tq-primary-light)",
            color: "var(--tq-primary)",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 0.6rem auto",
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>

          <h2 style={{ fontSize: "1.3rem", fontWeight: 700, margin: "0 0 0.25rem 0", color: "var(--tq-text-main)" }}>
            Authorize Permissions for {shop.name}
          </h2>
          <p style={{ fontSize: "0.85rem", color: "var(--tq-text-muted)", marginBottom: "1.1rem" }}>
            Select the protection modules to enable for <strong>{inputStore}</strong>.
          </p>

          <div style={{ textAlign: "left", display: "flex", flexDirection: "column", gap: "0.55rem", marginBottom: "1.25rem" }}>
            {/* Permission 1: Storefront Web Traffic Telemetry */}
            <div
              className="tq-perm-toggle-item"
              role="button"
              tabIndex={0}
              onClick={() => setTelemetryAccess(!telemetryAccess)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  setTelemetryAccess(!telemetryAccess);
                }
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flex: 1 }}>
                <div style={{ width: "34px", height: "34px", borderRadius: "8px", background: "#f0fdf4", color: "#16a34a", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                </div>
                <div style={{ flex: 1, textAlign: "left" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 650, fontSize: "0.85rem", color: "#0f172a" }}>
                      Storefront Web Telemetry
                    </span>
                    <span className="tq-perm-scope-badge green">
                      Web Pixels
                    </span>
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--tq-text-muted)", marginTop: "0.15rem", lineHeight: 1.35 }}>
                    Live visitor tracking and scraper detection with zero site latency.
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={telemetryAccess}
                onChange={() => {}}
                style={{ width: "18px", height: "18px", accentColor: "#2563eb", cursor: "pointer", marginLeft: "0.5rem", flexShrink: 0 }}
              />
            </div>

            {/* Permission 3: Checkout Validation Rules */}
            <div
              className="tq-perm-toggle-item"
              role="button"
              tabIndex={0}
              onClick={() => setCheckoutValidation(!checkoutValidation)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  setCheckoutValidation(!checkoutValidation);
                }
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flex: 1 }}>
                <div style={{ width: "34px", height: "34px", borderRadius: "8px", background: "#eff6ff", color: "#2563eb", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="9" cy="21" r="1" />
                    <circle cx="20" cy="21" r="1" />
                    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                  </svg>
                </div>
                <div style={{ flex: 1, textAlign: "left" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 650, fontSize: "0.85rem", color: "#0f172a" }}>
                      Checkout Validation Rules
                    </span>
                    <span className="tq-perm-scope-badge blue">
                      Shopify Functions
                    </span>
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--tq-text-muted)", marginTop: "0.15rem", lineHeight: 1.35 }}>
                    Blocks automated checkout bot rushes, card testing, and fake orders.
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={checkoutValidation}
                onChange={() => {}}
                style={{ width: "18px", height: "18px", accentColor: "#2563eb", cursor: "pointer", marginLeft: "0.5rem", flexShrink: 0 }}
              />
            </div>

            {/* Permission 4: Campaign & Product Context */}
            <div
              className="tq-perm-toggle-item"
              role="button"
              tabIndex={0}
              onClick={() => setAttributionAccess(!attributionAccess)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  setAttributionAccess(!attributionAccess);
                }
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flex: 1 }}>
                <div style={{ width: "34px", height: "34px", borderRadius: "8px", background: "#faf5ff", color: "#9333ea", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="20" x2="18" y2="4" />
                    <line x1="12" y1="20" x2="12" y2="10" />
                    <line x1="6" y1="20" x2="6" y2="14" />
                  </svg>
                </div>
                <div style={{ flex: 1, textAlign: "left" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 650, fontSize: "0.85rem", color: "#0f172a" }}>
                      Ad &amp; Campaign Protection
                    </span>
                    <span className="tq-perm-scope-badge purple">
                      Metaobjects
                    </span>
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--tq-text-muted)", marginTop: "0.15rem", lineHeight: 1.35 }}>
                    Filters invalid bot clicks from paid ads to protect your ad budget.
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={attributionAccess}
                onChange={() => {}}
                style={{ width: "18px", height: "18px", accentColor: "#2563eb", cursor: "pointer", marginLeft: "0.5rem", flexShrink: 0 }}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={handleGrantAccess}
            className="tq-btn tq-btn-primary"
            style={{ padding: "0.65rem 1.8rem", fontSize: "0.9rem" }}
          >
            Grant Access &amp; Begin Scanning →
          </button>
        </div>
      )}

      {/* STEP 3: Analyzing Traffic (Interactive Loading Screen) */}
      {currentStep === 3 && (
        <div className="tq-onboarding-hero" style={{ maxWidth: "520px" }}>
          {/* Radar Pulse Animation */}
          <div className="tq-radar-box">
            <div className="tq-radar-ring" />
            <div className="tq-radar-ring tq-radar-ring-2" />
            <div className="tq-radar-ring tq-radar-ring-3" />
            <div className="tq-radar-core">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "tqSpinFast 2s linear infinite" }}>
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
            </div>
          </div>

          <h2 style={{ fontSize: "1.35rem", fontWeight: 700, margin: "0 0 1.5rem 0", color: "var(--tq-text-main)" }}>
            Analyzing {shop.name} Traffic...
          </h2>

          {/* Progress Bar */}
          <div style={{ maxWidth: "400px", margin: "0 auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.825rem", fontWeight: 700, marginBottom: "0.5rem" }}>
              <span style={{ color: "#334155" }}>Telemetry Inspection</span>
              <span style={{ color: "var(--tq-primary)", fontVariantNumeric: "tabular-nums" }}>{analyzingProgress}%</span>
            </div>
            <div style={{ height: "8px", background: "#e2e8f0", borderRadius: "9999px", overflow: "hidden", boxShadow: "inset 0 1px 2px rgba(0,0,0,0.06)" }}>
              <div style={{
                height: "100%",
                width: `${analyzingProgress}%`,
                background: "linear-gradient(90deg, #3b82f6 0%, #1d4ed8 100%)",
                borderRadius: "9999px",
                transition: "width 0.2s ease",
              }} />
            </div>
          </div>
        </div>
      )}

      {/* STEP 4: Results Ready & App Embed Theme Extension Activation */}
      {currentStep === 4 && (
        <div className="tq-onboarding-hero" style={{ maxWidth: "530px" }}>
          <div style={{
            width: "48px",
            height: "48px",
            background: "#f0fdf4",
            color: "#16a34a",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 0.6rem auto",
            border: "1px solid #bbf7d0",
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>

          <h2 style={{ fontSize: "1.35rem", fontWeight: 700, margin: "0 0 0.25rem 0", color: "var(--tq-text-main)" }}>
            Results Ready for {shop.name}!
          </h2>
          <p style={{ fontSize: "0.85rem", color: "var(--tq-text-muted)", marginBottom: "1.1rem", lineHeight: 1.45 }}>
            Baseline scan completed for <strong>{inputStore}</strong>. Enable storefront defense to complete activation.
          </p>

          {/* Simple, Clean Baseline Status Card */}
          <div style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "12px",
            padding: "1rem 1.25rem",
            marginBottom: "1rem",
            textAlign: "left",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
          }}>
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              paddingBottom: "0.65rem",
              borderBottom: "1px solid #f1f5f9",
              marginBottom: "0.75rem",
            }}>
              <span style={{ fontSize: "0.825rem", fontWeight: 700, color: "#0f172a" }}>
                Store Baseline
              </span>
              <span style={{
                fontSize: "0.725rem",
                fontWeight: 600,
                color: "#16a34a",
                background: "#f0fdf4",
                padding: "0.2rem 0.6rem",
                borderRadius: "9999px",
                border: "1px solid #bbf7d0",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
              }}>
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#16a34a", display: "inline-block" }} />
                Calibrated &amp; Ready
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.8rem" }}>
                <span style={{ color: "#64748b" }}>Storefront Telemetry</span>
                <span style={{ fontWeight: 600, color: "#0f172a", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  Active (0 ms lag)
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.8rem" }}>
                <span style={{ color: "#64748b" }}>Checkout Protection</span>
                <span style={{ fontWeight: 600, color: "#0f172a", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  Ready to Enforce
                </span>
              </div>
            </div>
          </div>

          {/* Dedicated Storefront App Embed Activation Card */}
          <div style={{
            background: "#f8fafc",
            border: "1.5px solid #cbd5e1",
            borderRadius: "12px",
            padding: "1.1rem 1.25rem",
            marginBottom: "1.25rem",
            textAlign: "left",
            boxShadow: "0 2px 6px rgba(0, 0, 0, 0.03)",
          }}>
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "0.6rem",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <div style={{
                  width: "28px",
                  height: "28px",
                  borderRadius: "6px",
                  background: "#eff6ff",
                  color: "#2563eb",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "#0f172a" }}>
                  Enable Storefront Bot Challenge
                </span>
              </div>
              <span className="tq-perm-scope-badge amber" style={{ fontSize: "0.7rem", padding: "0.15rem 0.5rem" }}>
                Theme App Embed
              </span>
            </div>

            <p style={{ fontSize: "0.78rem", color: "var(--tq-text-muted)", margin: "0 0 0.85rem 0", lineHeight: 1.4 }}>
              To intercept suspicious bot sessions and present the CAPTCHA challenge on storefront product pages, activate the <strong>Traffiq Bot Challenge</strong> embed in your Shopify Theme Editor.
            </p>

            {/* 3-Step Guided Instructions */}
            <div style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              padding: "0.75rem 0.85rem",
              marginBottom: "0.85rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.45rem",
              fontSize: "0.76rem",
              color: "#334155",
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
                <span style={{ background: "#2563eb", color: "#ffffff", width: "18px", height: "18px", borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", fontWeight: 700, flexShrink: 0, marginTop: "1px" }}>1</span>
                <span>Click the button below to open your active theme in Shopify Theme Editor.</span>
              </div>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
                <span style={{ background: "#2563eb", color: "#ffffff", width: "18px", height: "18px", borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", fontWeight: 700, flexShrink: 0, marginTop: "1px" }}>2</span>
                <span>Verify that <strong>Traffiq Bot Challenge</strong> is toggled <strong>ON</strong> under App Embeds.</span>
              </div>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
                <span style={{ background: "#2563eb", color: "#ffffff", width: "18px", height: "18px", borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", fontWeight: 700, flexShrink: 0, marginTop: "1px" }}>3</span>
                <span>Click <strong>Save</strong> in the top right corner of the Shopify Theme Editor.</span>
              </div>
            </div>

            {/* 1-Click Deep Link Button */}
            <a
              href={themeEditorUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setHasOpenedThemeEditor(true)}
              className="tq-btn tq-btn-primary"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                textDecoration: "none",
                width: "100%",
                padding: "0.65rem 1.15rem",
                fontSize: "0.875rem",
                fontWeight: 650,
                borderRadius: "8px",
                background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
                boxShadow: "0 3px 10px rgba(37, 99, 235, 0.22)",
                boxSizing: "border-box",
              }}
            >
              <span>Open Shopify Theme Editor</span>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>

            {/* Confirmation Banner once clicked */}
            {hasOpenedThemeEditor && (
              <div style={{
                fontSize: "0.76rem",
                color: "#166534",
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: "6px",
                padding: "0.45rem 0.7rem",
                marginTop: "0.65rem",
                display: "flex",
                alignItems: "center",
                gap: "0.45rem",
              }}>
                <span style={{ fontWeight: 700 }}>✓</span>
                <span>Theme Editor opened in a new tab. Once saved in Shopify, proceed below.</span>
              </div>
            )}

            {/* Checkbox confirmation */}
            <label style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              fontSize: "0.78rem",
              color: "#475569",
              cursor: "pointer",
              marginTop: "0.65rem",
              userSelect: "none",
            }}>
              <input
                type="checkbox"
                checked={embedConfirmed}
                onChange={(e) => setEmbedConfirmed(e.target.checked)}
                style={{ width: "16px", height: "16px", accentColor: "#2563eb", cursor: "pointer", flexShrink: 0 }}
              />
              <span>I have enabled &amp; saved the Traffiq Bot Challenge embed in Shopify</span>
            </label>
          </div>

          <button
            type="button"
            onClick={() => setCurrentStep(5)}
            className="tq-btn tq-btn-primary"
            style={{ padding: "0.65rem 1.8rem", fontSize: "0.9rem", borderRadius: "8px", width: "100%" }}
          >
            Activate Protection on {shop.name} →
          </button>
        </div>
      )}

      {/* STEP 5: Get Started (Open Dashboard) */}
      {currentStep === 5 && (
        <div className="tq-onboarding-hero" style={{ maxWidth: "520px" }}>
          <div style={{
            position: "relative",
            width: "60px",
            height: "60px",
            margin: "0 auto 0.75rem auto",
          }}>
            <img
              src="/traffiq-logo.png"
              alt="Traffiq Engine Activated"
              style={{
                width: "60px",
                height: "60px",
                borderRadius: "16px",
                boxShadow: "0 8px 22px rgba(37,99,235,0.35)",
                display: "block",
              }}
            />
            <div style={{
              position: "absolute",
              bottom: "-4px",
              right: "-4px",
              background: "#10b981",
              color: "#ffffff",
              width: "22px",
              height: "22px",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
              border: "2px solid #ffffff",
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          </div>

          <h2 style={{ fontSize: "1.4rem", fontWeight: 800, margin: "0 0 0.35rem 0", color: "var(--tq-text-main)", letterSpacing: "-0.02em" }}>
            Protection Engine Activated!
          </h2>
          <p style={{ fontSize: "0.85rem", color: "var(--tq-text-muted)", maxWidth: "420px", margin: "0 auto 1.15rem auto", lineHeight: 1.45 }}>
            Storefront defenses and real-time monitoring are now active for <strong>{shop.name}</strong>.
          </p>

          <div style={{
            background: "var(--tq-bg)",
            border: "1px solid #e2e8f0",
            borderRadius: "10px",
            padding: "0.85rem 1.1rem",
            maxWidth: "390px",
            margin: "0 auto 1.25rem auto",
            textAlign: "left",
            display: "flex",
            flexDirection: "column",
            gap: "0.45rem",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.825rem", color: "#334155", fontWeight: 600 }}>
              <span style={{ color: "#10b981" }}>✓</span>
              <span>Real-time traffic monitoring active</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.825rem", color: "#334155", fontWeight: 600 }}>
              <span style={{ color: "#10b981" }}>✓</span>
              <span>Checkout bot protection armed</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.825rem", color: "#334155", fontWeight: 600 }}>
              <span style={{ color: "#10b981" }}>✓</span>
              <span>Storefront bot challenge enabled</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.825rem", color: "#334155", fontWeight: 600 }}>
              <span style={{ color: "#10b981" }}>✓</span>
              <span>AI traffic insights &amp; alerts ready</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCompleteOnboarding}
            className="tq-btn tq-btn-primary"
            style={{
              padding: "0.7rem 1.8rem",
              fontSize: "0.925rem",
              fontWeight: 700,
              boxShadow: "0 4px 14px rgba(37, 99, 235, 0.3)",
            }}
          >
            Open Traffiq Dashboard →
          </button>

          <div style={{ marginTop: "0.85rem", fontSize: "0.775rem", color: "#64748b" }}>
            Need to adjust your theme later?{" "}
            <a
              href={themeEditorUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#2563eb", textDecoration: "underline", fontWeight: 600 }}
            >
              Open Shopify Theme Editor ↗
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
