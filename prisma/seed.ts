import prisma from "../app/db.server";
import { ensureShopConnected } from "../app/services/shop.server";

async function seed() {
  console.log("=== TRAFFIQ PRODUCTION DATABASE SEED START ===");

  const shopDomain = "cartmend.myshopify.com";
  const shop = await ensureShopConnected(shopDomain, {
    id: "gid://shopify/Shop/8291048291",
    name: "Cartmend",
    myshopifyDomain: shopDomain,
    url: `https://${shopDomain}`,
    plan: { displayName: "Shopify Plus" },
    currencyCode: "USD",
    email: "merchant@cartmend.com",
  });

  console.log(`Configured shop: ${shop.shopDomain} (ID: ${shop.id})`);

  // 1. Clean previous DEMO data to guarantee isolation and allow clean re-seeding
  console.log("Cleaning up previous demo data...");
  await prisma.detectionResult.deleteMany({
    where: { shopId: shop.id },
  });
  await prisma.protectionAction.deleteMany({
    where: { shopId: shop.id },
  });
  await prisma.trafficEvent.deleteMany({
    where: { shopId: shop.id },
  });
  await prisma.trafficSession.deleteMany({
    where: { shopId: shop.id },
  });
  await prisma.protectionRule.deleteMany({
    where: { shopId: shop.id },
  });
  await prisma.alert.deleteMany({
    where: { shopId: shop.id },
  });
  await prisma.aIInsight.deleteMany({
    where: { shopId: shop.id },
  });
  await prisma.auditLog.deleteMany({
    where: { shopId: shop.id, actor: "DEV_SEED" },
  });

  const now = new Date();

  // Helper to calculate relative timestamp
  const relativeTime = (minutesAgo: number) =>
    new Date(now.getTime() - minutesAgo * 60 * 1000);

  // 2. Comprehensive 8-category demo sessions definition (Phase 17 Spec)
  const sessionBlueprints = [
    // -------------------------------------------------------------
    // Category 1: Normal human sessions
    // -------------------------------------------------------------
    {
      sessionKey: "client_human_organic_01",
      country: "United States",
      countryFlag: "🇺🇸",
      region: "California",
      city: "San Francisco",
      deviceType: "Desktop",
      browser: "Chrome",
      os: "macOS",
      landingPage: "/collections/apparel",
      referrer: "https://www.google.com",
      utmSource: "Organic Search",
      utmMedium: "organic",
      pageViews: 6,
      requestCount: 11,
      productViews: 4,
      searches: 1,
      addToCartCount: 1,
      checkoutStarted: true,
      purchaseCompleted: true,
      totalSpend: 89.5,
      riskScore: 6,
      trafficType: "HUMAN",
      severity: "LOW",
      minutesAgo: 15,
      events: [
        { type: "page_viewed", url: "/collections/apparel", offsetMins: 15 },
        { type: "search_submitted", url: "/collections/apparel?q=hoodie", offsetMins: 14 },
        { type: "product_viewed", url: "/products/cotton-hoodie", productId: "prod_001", offsetMins: 13 },
        { type: "product_added_to_cart", url: "/products/cotton-hoodie", productId: "prod_001", offsetMins: 11 },
        { type: "checkout_started", url: "/checkouts/c101", offsetMins: 8 },
        { type: "purchase", url: "/checkouts/c101/thank-you", offsetMins: 5 },
      ],
    },
    {
      sessionKey: "client_human_direct_02",
      country: "United Kingdom",
      countryFlag: "🇬🇧",
      region: "England",
      city: "London",
      deviceType: "Mobile",
      browser: "Safari",
      os: "iOS",
      landingPage: "/",
      referrer: "",
      utmSource: "Direct",
      pageViews: 4,
      requestCount: 7,
      productViews: 2,
      searches: 0,
      addToCartCount: 1,
      checkoutStarted: false,
      purchaseCompleted: false,
      totalSpend: 0.0,
      riskScore: 10,
      trafficType: "HUMAN",
      severity: "LOW",
      minutesAgo: 35,
      events: [
        { type: "page_viewed", url: "/", offsetMins: 35 },
        { type: "product_viewed", url: "/products/travel-backpack", productId: "prod_002", offsetMins: 33 },
        { type: "product_added_to_cart", url: "/products/travel-backpack", productId: "prod_002", offsetMins: 30 },
      ],
    },

    // -------------------------------------------------------------
    // Category 2: Automated scraper sessions
    // -------------------------------------------------------------
    {
      sessionKey: "client_scraper_catalog_01",
      country: "Germany",
      countryFlag: "🇩🇪",
      region: "Hesse",
      city: "Frankfurt",
      deviceType: "Desktop",
      browser: "Chrome",
      os: "Linux",
      landingPage: "/products/catalog-index",
      referrer: "",
      utmSource: "Direct",
      pageViews: 32,
      requestCount: 114,
      productViews: 28,
      searches: 0,
      addToCartCount: 0,
      checkoutStarted: false,
      purchaseCompleted: false,
      totalSpend: 0.0,
      riskScore: 88,
      trafficType: "BOT",
      severity: "HIGH",
      minutesAgo: 45,
      events: [
        { type: "page_viewed", url: "/products/catalog-index", offsetMins: 45 },
        { type: "product_viewed", url: "/products/item-001", productId: "prod_101", offsetMins: 44.8 },
        { type: "product_viewed", url: "/products/item-002", productId: "prod_102", offsetMins: 44.6 },
        { type: "product_viewed", url: "/products/item-003", productId: "prod_103", offsetMins: 44.3 },
      ],
      detection: {
        confidence: 96,
        recommendedAction: "ALERT",
        aiExplanation: "Rapid sequential catalog scraper extracting item catalogs without reading dwell time.",
        reasons: [
          "Repetitive sequential catalog crawling pattern",
          "Sub-1.2s reader dwell times across 28 products",
          "Headless browser webdriver flag present",
        ],
        signals: [
          { name: "request_frequency", value: 88, weight: 0.35 },
          { name: "navigation_pattern", value: 92, weight: 0.35 },
          { name: "automation_markers", value: 85, weight: 0.30 },
        ],
      },
    },

    // -------------------------------------------------------------
    // Category 3: Suspicious high-frequency sessions
    // -------------------------------------------------------------
    {
      sessionKey: "client_suspicious_freq_01",
      country: "Netherlands",
      countryFlag: "🇳🇱",
      region: "North Holland",
      city: "Amsterdam",
      deviceType: "Desktop",
      browser: "Firefox",
      os: "Windows",
      landingPage: "/collections/new-arrivals",
      referrer: "",
      utmSource: "Direct",
      pageViews: 12,
      requestCount: 56,
      productViews: 8,
      searches: 3,
      addToCartCount: 0,
      checkoutStarted: false,
      purchaseCompleted: false,
      totalSpend: 0.0,
      riskScore: 74,
      trafficType: "SUSPICIOUS",
      severity: "MEDIUM",
      minutesAgo: 60,
      detection: {
        confidence: 86,
        recommendedAction: "FLAG",
        aiExplanation: "Unusually high request frequency bursting faster than standard human shopper patterns.",
        reasons: [
          "Sub-300ms interaction cadence across multiple queries",
          "Anomalous query parameter fuzzing on collection filters",
        ],
        signals: [
          { name: "request_frequency", value: 82, weight: 0.4 },
          { name: "navigation_pattern", value: 68, weight: 0.3 },
          { name: "client_environment", value: 70, weight: 0.3 },
        ],
      },
    },

    // -------------------------------------------------------------
    // Category 4: Paid campaign traffic (Meta / TikTok UTMs)
    // -------------------------------------------------------------
    {
      sessionKey: "client_paid_meta_legit_01",
      country: "United States",
      countryFlag: "🇺🇸",
      region: "New York",
      city: "New York",
      deviceType: "Mobile",
      browser: "Instagram In-App",
      os: "iOS",
      landingPage: "/products/leather-jacket",
      referrer: "https://l.instagram.com",
      utmSource: "Paid Social",
      utmMedium: "cpc",
      utmCampaign: "FB_Conv_April",
      pageViews: 5,
      requestCount: 9,
      productViews: 3,
      searches: 0,
      addToCartCount: 1,
      checkoutStarted: true,
      purchaseCompleted: true,
      totalSpend: 165.0,
      riskScore: 8,
      trafficType: "HUMAN",
      severity: "LOW",
      minutesAgo: 75,
      events: [
        { type: "page_viewed", url: "/products/leather-jacket", offsetMins: 75 },
        { type: "product_added_to_cart", url: "/products/leather-jacket", productId: "prod_003", offsetMins: 72 },
        { type: "checkout_started", url: "/checkouts/c102", offsetMins: 70 },
        { type: "purchase", url: "/checkouts/c102/thank-you", offsetMins: 67 },
      ],
    },
    {
      sessionKey: "client_paid_meta_invalid_02",
      country: "United States",
      countryFlag: "🇺🇸",
      region: "Texas",
      city: "Dallas",
      deviceType: "Mobile",
      browser: "Safari",
      os: "iOS",
      landingPage: "/products/summer-sale",
      referrer: "https://facebook.com",
      utmSource: "Paid Social",
      utmMedium: "cpc",
      utmCampaign: "FB_Prospecting_US",
      pageViews: 1,
      requestCount: 3,
      productViews: 1,
      searches: 0,
      addToCartCount: 0,
      checkoutStarted: false,
      purchaseCompleted: false,
      totalSpend: 0.0,
      riskScore: 68,
      trafficType: "SUSPICIOUS",
      severity: "MEDIUM",
      minutesAgo: 90,
      detection: {
        confidence: 84,
        recommendedAction: "FLAG",
        aiExplanation: "Instant bounce paid click with concentrated invalid traffic markers.",
        reasons: [
          "Session dwell time < 3 seconds from paid placement",
          "Zero human pointer displacement",
        ],
        signals: [
          { name: "session_dwell", value: 75, weight: 0.5 },
          { name: "interaction_entropy", value: 62, weight: 0.5 },
        ],
      },
    },
    {
      sessionKey: "client_paid_tiktok_bot_03",
      country: "United States",
      countryFlag: "🇺🇸",
      region: "Virginia",
      city: "Ashburn",
      deviceType: "Desktop",
      browser: "Chrome",
      os: "Linux",
      landingPage: "/products/viral-sunglasses",
      referrer: "https://tiktok.com",
      utmSource: "Paid Social",
      utmMedium: "cpc",
      utmCampaign: "TikTok_Spring_Drop",
      pageViews: 8,
      requestCount: 36,
      productViews: 6,
      searches: 0,
      addToCartCount: 0,
      checkoutStarted: false,
      purchaseCompleted: false,
      totalSpend: 0.0,
      riskScore: 92,
      trafficType: "BOT",
      severity: "HIGH",
      minutesAgo: 105,
      detection: {
        confidence: 94,
        recommendedAction: "ALERT",
        aiExplanation: "Automated click farm bot exhausting paid campaign budget.",
        reasons: [
          "Data-center IP range attributed to cloud proxy node",
          "Synthetic click timing adhering to exact millisecond intervals",
        ],
        signals: [
          { name: "ip_reputation", value: 95, weight: 0.4 },
          { name: "click_interval_jitter", value: 90, weight: 0.6 },
        ],
      },
    },

    // -------------------------------------------------------------
    // Category 5: Organic traffic
    // -------------------------------------------------------------
    {
      sessionKey: "client_organic_bing_01",
      country: "Canada",
      countryFlag: "🇨🇦",
      region: "Ontario",
      city: "Toronto",
      deviceType: "Desktop",
      browser: "Edge",
      os: "Windows",
      landingPage: "/blogs/news/sustainable-fashion-guide",
      referrer: "https://www.bing.com",
      utmSource: "Organic Search",
      utmMedium: "organic",
      pageViews: 3,
      requestCount: 5,
      productViews: 1,
      searches: 0,
      addToCartCount: 0,
      checkoutStarted: false,
      purchaseCompleted: false,
      totalSpend: 0.0,
      riskScore: 5,
      trafficType: "HUMAN",
      severity: "LOW",
      minutesAgo: 120,
    },

    // -------------------------------------------------------------
    // Category 6: Abnormal cart traffic (Cart Stuffing / Inventory Hold)
    // -------------------------------------------------------------
    {
      sessionKey: "client_cart_stuffing_anomaly",
      country: "United States",
      countryFlag: "🇺🇸",
      region: "Ohio",
      city: "Columbus",
      deviceType: "Mobile",
      browser: "Chrome",
      os: "Android",
      landingPage: "/cart",
      referrer: "",
      utmSource: "Direct",
      pageViews: 6,
      requestCount: 28,
      productViews: 1,
      searches: 0,
      addToCartCount: 11,
      checkoutStarted: true,
      purchaseCompleted: false,
      totalSpend: 0.0,
      riskScore: 94,
      trafficType: "HIGH_RISK",
      severity: "CRITICAL",
      minutesAgo: 140,
      events: [
        { type: "page_viewed", url: "/cart", offsetMins: 140 },
        { type: "product_added_to_cart", url: "/cart", productId: "prod_limited_01", offsetMins: 139.9 },
        { type: "product_added_to_cart", url: "/cart", productId: "prod_limited_02", offsetMins: 139.8 },
        { type: "product_added_to_cart", url: "/cart", productId: "prod_limited_03", offsetMins: 139.6 },
        { type: "checkout_started", url: "/checkouts/hold-attempt", offsetMins: 138 },
      ],
      detection: {
        confidence: 97,
        recommendedAction: "CHALLENGE",
        aiExplanation: "Rapid cart-stuffing inventory reservation bot targeting limited-run stock.",
        reasons: [
          "Rapid cart-stuffing anomaly (11 items added in under 3 seconds)",
          "Bypassed catalog browsing, landing straight on cart endpoints",
          "Zero human mouse movement jitter or dwell time",
        ],
        signals: [
          { name: "cart_velocity", value: 98, weight: 0.45 },
          { name: "dwell_time", value: 92, weight: 0.35 },
          { name: "interaction_entropy", value: 90, weight: 0.20 },
        ],
      },
    },

    // -------------------------------------------------------------
    // Category 7: Traffic spikes (burst of coordinated sessions)
    // -------------------------------------------------------------
    {
      sessionKey: "client_spike_burst_01",
      country: "United States",
      countryFlag: "🇺🇸",
      region: "New Jersey",
      city: "Secaucus",
      deviceType: "Desktop",
      browser: "Chrome",
      os: "Windows",
      landingPage: "/products/flash-deal",
      referrer: "https://facebook.com",
      utmSource: "Paid Social",
      utmCampaign: "FB_Conv_April",
      pageViews: 4,
      requestCount: 18,
      productViews: 4,
      searches: 0,
      addToCartCount: 0,
      checkoutStarted: false,
      purchaseCompleted: false,
      totalSpend: 0.0,
      riskScore: 89,
      trafficType: "BOT",
      severity: "HIGH",
      minutesAgo: 160,
    },
    {
      sessionKey: "client_spike_burst_02",
      country: "United States",
      countryFlag: "🇺🇸",
      region: "New Jersey",
      city: "Secaucus",
      deviceType: "Desktop",
      browser: "Chrome",
      os: "Windows",
      landingPage: "/products/flash-deal",
      referrer: "https://facebook.com",
      utmSource: "Paid Social",
      utmCampaign: "FB_Conv_April",
      pageViews: 4,
      requestCount: 19,
      productViews: 4,
      searches: 0,
      addToCartCount: 0,
      checkoutStarted: false,
      purchaseCompleted: false,
      totalSpend: 0.0,
      riskScore: 90,
      trafficType: "BOT",
      severity: "HIGH",
      minutesAgo: 159,
    },

    // -------------------------------------------------------------
    // Category 8: High-risk sessions (with automated block enforcement)
    // -------------------------------------------------------------
    {
      sessionKey: "client_high_risk_block_01",
      country: "United States",
      countryFlag: "🇺🇸",
      region: "Virginia",
      city: "Ashburn",
      deviceType: "Desktop",
      browser: "HeadlessChrome",
      os: "Linux",
      landingPage: "/cart",
      referrer: "",
      utmSource: "Direct",
      pageViews: 8,
      requestCount: 48,
      productViews: 2,
      searches: 0,
      addToCartCount: 5,
      checkoutStarted: true,
      purchaseCompleted: false,
      totalSpend: 0.0,
      riskScore: 98,
      trafficType: "HIGH_RISK",
      severity: "CRITICAL",
      minutesAgo: 180,
      detection: {
        confidence: 99,
        recommendedAction: "BLOCK",
        aiExplanation: "Automated checkout bot from hosting facility attempting credential or inventory exploitation.",
        reasons: [
          "Datacenter ASN (AS14618 Amazon.com) identified on consumer storefront",
          "Automated headless browser signature detected (navigator.webdriver)",
          "Sub-200ms interaction velocity",
          "Deterministic scripted mouse trajectories",
        ],
        signals: [
          { name: "asn_datacenter", value: 100, weight: 0.35 },
          { name: "webdriver_fingerprint", value: 100, weight: 0.35 },
          { name: "interaction_entropy", value: 95, weight: 0.30 },
        ],
      },
      protectionAction: {
        action: "BLOCK",
        status: "EXECUTED",
        reason: "Automated checkout attempt exceeded risk threshold (98 >= 80)",
        metadata: JSON.stringify({
          ruleTriggered: "High-Risk Bot Protection",
          threshold: 80,
          detectedScore: 98,
        }),
      },
    },
  ];

  console.log(`Seeding ${sessionBlueprints.length} realistic sessions across 8 traffic categories...`);

  for (const bp of sessionBlueprints) {
    const startedTime = relativeTime(bp.minutesAgo);
    const session = await prisma.trafficSession.create({
      data: {
        shopId: shop.id,
        sessionKey: bp.sessionKey,
        startedAt: startedTime,
        lastSeenAt: startedTime,
        endedAt: new Date(startedTime.getTime() + (bp.pageViews * 25 + 30) * 1000),
        country: bp.country,
        countryFlag: bp.countryFlag,
        region: bp.region,
        city: bp.city,
        deviceType: bp.deviceType,
        browser: bp.browser,
        os: bp.os,
        landingPage: bp.landingPage,
        exitPage: bp.landingPage,
        referrer: bp.referrer,
        utmSource: bp.utmSource,
        utmMedium: bp.utmMedium,
        utmCampaign: bp.utmCampaign,
        pageViews: bp.pageViews,
        requestCount: bp.requestCount,
        productViews: bp.productViews,
        searches: bp.searches,
        addToCartCount: bp.addToCartCount,
        checkoutStarted: bp.checkoutStarted,
        purchaseCompleted: bp.purchaseCompleted,
        totalSpend: bp.totalSpend,
        riskScore: bp.riskScore,
        trafficType: bp.trafficType,
        severity: bp.severity,
        isDemo: true, // Marked strictly as demo data!
      },
    });

    // Create associated granular events if specified
    if (bp.events && bp.events.length > 0) {
      for (const evt of bp.events) {
        await prisma.trafficEvent.create({
          data: {
            shopId: shop.id,
            sessionId: session.id,
            eventType: evt.type,
            pageUrl: evt.url,
            productId: (evt as any).productId || null,
            referrer: bp.referrer,
            utmSource: bp.utmSource,
            utmMedium: bp.utmMedium,
            utmCampaign: bp.utmCampaign,
            timestamp: relativeTime(evt.offsetMins),
            isDemo: true,
          },
        });
      }
    }

    // Create associated DetectionResult if specified
    if (bp.detection) {
      await prisma.detectionResult.create({
        data: {
          shopId: shop.id,
          sessionId: session.id,
          trafficType: bp.trafficType,
          riskScore: bp.riskScore,
          confidence: bp.detection.confidence,
          severity: bp.severity,
          reasons: JSON.stringify(bp.detection.reasons),
          signals: JSON.stringify(bp.detection.signals),
          recommendedAction: bp.detection.recommendedAction,
          aiExplanation: bp.detection.aiExplanation,
          createdAt: startedTime,
        },
      });
    }

    // Create associated ProtectionAction if specified
    if ((bp as any).protectionAction) {
      const pa = (bp as any).protectionAction;
      await prisma.protectionAction.create({
        data: {
          shopId: shop.id,
          sessionId: session.id,
          action: pa.action,
          status: pa.status,
          reason: pa.reason,
          metadata: pa.metadata,
          createdAt: startedTime,
        },
      });
    }
  }

  // 3. Seed Default Protection Rules
  console.log("Seeding default protection rules...");
  await prisma.protectionRule.createMany({
    data: [
      {
        shopId: shop.id,
        name: "High-Risk Bot Protection",
        action: "BLOCK",
        enabled: true,
        threshold: 80,
        configuration: JSON.stringify({
          targetScenarios: ["DATACENTER_PROXY", "HEADLESS_BROWSER", "EXPLOIT_SCANNER"],
          challengeMethod: "BLOCK",
        }),
      },
      {
        shopId: shop.id,
        name: "Cart Stuffing & Inventory Shield",
        action: "CHALLENGE",
        enabled: true,
        threshold: 75,
        configuration: JSON.stringify({
          targetScenarios: ["RAPID_CART_STUFFING", "INVENTORY_HOLD"],
          maxItemsPerSecond: 3,
        }),
      },
      {
        shopId: shop.id,
        name: "Low-Quality Ad Click Filter",
        action: "FLAG",
        enabled: true,
        threshold: 60,
        configuration: JSON.stringify({
          targetScenarios: ["INSTANT_BOUNCE", "CLICK_FARM_SIGNATURE"],
        }),
      },
    ],
  });

  // 4. Seed Realistic Alerts (traffic spike, high-risk checkout)
  console.log("Seeding realistic alerts...");
  await prisma.alert.createMany({
    data: [
      {
        shopId: shop.id,
        type: "TRAFFIC_SPIKE",
        severity: "High",
        title: "Suspicious paid campaign traffic spike",
        description: "8,420 automated sessions detected from paid campaign placement within 30 minutes.",
        status: "Active",
        affectedSessions: "8,420",
        increase: "220%",
        botLikelihood: "96%",
        likelySource: "Paid Social (Meta Ads)",
        countryFlag: "🇺🇸",
        sourcePercent: "59% of suspicious traffic",
        metadata: JSON.stringify({
          campaign: "FB_Conv_April",
          spikeWindow: "30m",
          recommendation: "Review campaign targeting and adjust spend to minimize bot-exhaustion.",
        }),
      },
      {
        shopId: shop.id,
        type: "HIGH_RISK_CHECKOUT",
        severity: "High",
        title: "High-risk checkout bot activity",
        description: "Automated sessions initiated checkout without shopping dwell time.",
        status: "Active",
        affectedSessions: "142",
        increase: "185%",
        botLikelihood: "94%",
        likelySource: "Direct Traffic",
        countryFlag: "🇺🇸",
        sourcePercent: "78% of checkout bot attempts",
        metadata: JSON.stringify({
          trigger: "Cart stuffing anomaly detected on limited inventory items",
          recommendation: "Enable Challenge mode on checkout validations.",
        }),
      },
    ],
  });

  // 5. Seed Initial AI Insights
  console.log("Seeding AI insights...");
  await prisma.aIInsight.createMany({
    data: [
      {
        shopId: shop.id,
        type: "WEEKLY_SUMMARY",
        title: "Weekly Traffic Quality Baseline",
        summary: "78% of your overall store traffic is verified human shoppers. Paid social campaigns show concentrated automated click activity on FB_Conv_April.",
        recommendations: JSON.stringify([
          "Enable Challenge protection for traffic risk scores >= 75",
          "Audit Meta Ads placement FB_Conv_April to exclude audience network click farms",
          "Maintain monitor mode for Organic Search traffic",
        ]),
      },
      {
        shopId: shop.id,
        type: "SPIKE_EXPLANATION",
        title: "Paid Campaign Anomaly Breakdown",
        summary: "A 220% traffic surge was detected from Meta Ads originating primarily from Ashburn and Secaucus proxy clusters with zero dwell time.",
        recommendations: JSON.stringify([
          "Exclude cloud hosting subnet IP ranges",
          "Cap ad budget during non-peak conversion hours",
        ]),
      },
    ],
  });

  // 6. Seed Audit Logs
  console.log("Seeding audit logs...");
  await prisma.auditLog.createMany({
    data: [
      {
        shopId: shop.id,
        actor: "DEV_SEED",
        action: "STORE_CONNECTED",
        resourceType: "Shop",
        resourceId: shop.id,
        metadata: JSON.stringify({
          shopDomain: shop.shopDomain,
          installedAt: shop.installedAt,
        }),
      },
      {
        shopId: shop.id,
        actor: "DEV_SEED",
        action: "PROTECTION_RULE_ENFORCED",
        resourceType: "ProtectionRule",
        resourceId: "rule_high_risk_bot",
        metadata: JSON.stringify({
          action: "BLOCK",
          sessionKey: "client_high_risk_block_01",
          riskScore: 98,
        }),
      },
      {
        shopId: shop.id,
        actor: "DEV_SEED",
        action: "SETTINGS_UPDATED",
        resourceType: "ShopSettings",
        resourceId: shop.id,
        metadata: JSON.stringify({
          protectionMode: "MONITOR",
          checkoutValidation: true,
          telemetryAccess: true,
          threatDefense: true,
          attributionAccess: true,
        }),
      },
    ],
  });

  console.log("=== TRAFFIQ PRODUCTION DATABASE SEED COMPLETE ===");
}

seed()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
