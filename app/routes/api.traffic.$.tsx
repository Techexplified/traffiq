import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getShopByDomain } from "../services/shop.server";
import {
  getDashboardOverview,
  getInvestigationSessions,
  getSessionDetail,
  getShopSettings,
  updateShopSettings,
} from "../services/analytics.server";
import { getShopAlerts, toggleAlertStatus, resolveAlert, checkAndGenerateAlerts } from "../services/alertEngine.server";
import { generateAiInsights } from "../services/aiInsights.server";
import { evaluateSessionRisk } from "../services/detectionEngine.server";
import { ProtectionEngine, ProtectionRuleManager, ProtectionActionManager } from "../services/protectionEngine.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

/**
 * Resolves the authenticated shop context.
 * Supports Shopify Admin session, Bearer token, query param, or development store fallback.
 */
async function resolveAuthenticatedShop(request: Request): Promise<{ shopId: string; shopDomain: string }> {
  const url = new URL(request.url);
  const shopParam = url.searchParams.get("shop");

  // 1. Embedded Shopify Admin session
  try {
    const { session } = await authenticate.admin(request);
    const shop = await getShopByDomain(session.shop);
    const shopId = shop?.id || session.shop;
    return { shopId, shopDomain: session.shop };
  } catch {
    // 2. Authorization Bearer token
    const authHeader = request.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const sessionRecord = await prisma.session.findFirst({
        where: { accessToken: token },
      });
      if (sessionRecord) {
        const shop = await getShopByDomain(sessionRecord.shop);
        return { shopId: shop?.id || sessionRecord.shop, shopDomain: sessionRecord.shop };
      }
    }

    // 3. Query param `shop`
    if (shopParam) {
      const shop = await getShopByDomain(shopParam);
      if (shop) {
        return { shopId: shop.id, shopDomain: shop.shopDomain };
      }
    }

    // 4. Default to most recently active shop in development if available
    const defaultShop = await prisma.shop.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
    });
    if (defaultShop) {
      return { shopId: defaultShop.id, shopDomain: defaultShop.shopDomain };
    }

    throw new Response(
      JSON.stringify({ error: "Unauthorized. Valid Shopify merchant authentication required." }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

/**
 * GET Handler for /api/traffic/*
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const { shopId, shopDomain } = await resolveAuthenticatedShop(request);
  const splat = params["*"] || "";
  const parts = splat.split("/").filter(Boolean);
  const route = parts[0] || "";
  const url = new URL(request.url);

  switch (route) {
    // 1. GET /api/traffic/overview
    case "overview": {
      const dateRange = url.searchParams.get("dateRange") || undefined;
      const compareRange = url.searchParams.get("compareRange") || undefined;
      const startDate = url.searchParams.get("startDate") || undefined;
      const endDate = url.searchParams.get("endDate") || undefined;
      const overview = await getDashboardOverview(shopId, { dateRange, compareRange, startDate, endDate });
      return Response.json({ success: true, shopDomain, overview, metrics: overview }, { headers: corsHeaders });
    }

    // 2. GET /api/traffic/sessions or GET /api/traffic/sessions/:id
    case "sessions": {
      const sessionId = parts[1];
      if (sessionId) {
        // GET /api/traffic/sessions/:id
        const sessionDetail = await getSessionDetail(shopId, sessionId);
        if (!sessionDetail) {
          return Response.json(
            { error: `Session '${sessionId}' not found for this store` },
            { status: 404, headers: corsHeaders }
          );
        }

        return Response.json({
          success: true,
          shopDomain,
          session: sessionDetail,
          ...sessionDetail,
        }, { headers: corsHeaders });
      }

      // GET /api/traffic/sessions (paginated, searched, filtered, sorted)
      const page = parseInt(url.searchParams.get("page") || "1", 10);
      const limit = parseInt(url.searchParams.get("limit") || "8", 10);
      const offsetParam = url.searchParams.get("offset");
      const offset = offsetParam !== null ? parseInt(offsetParam, 10) : (page - 1) * limit;

      const search = url.searchParams.get("search") || undefined;
      const riskFilter = url.searchParams.get("riskFilter") || url.searchParams.get("risk") || undefined;
      const trafficType = url.searchParams.get("trafficType") || url.searchParams.get("trafficTypeFilter") || undefined;
      const sourceFilter = url.searchParams.get("source") || url.searchParams.get("sourceFilter") || undefined;
      const countryFilter = url.searchParams.get("country") || url.searchParams.get("countryFilter") || undefined;
      const deviceFilter = url.searchParams.get("device") || url.searchParams.get("deviceFilter") || undefined;
      const severityFilter = url.searchParams.get("severity") || url.searchParams.get("severityFilter") || undefined;
      const dateRange = url.searchParams.get("dateFilter") || url.searchParams.get("dateRange") || undefined;
      const sortBy = url.searchParams.get("sortBy") || undefined;
      const sortOrder = (url.searchParams.get("sortOrder") as "asc" | "desc") || "desc";

      const sessionsData = await getInvestigationSessions(shopId, {
        page,
        limit,
        offset,
        search,
        riskFilter,
        trafficType,
        sourceFilter,
        countryFilter,
        deviceFilter,
        severityFilter,
        dateRange,
        sortBy,
        sortOrder,
      });

      return Response.json({ success: true, shopDomain, ...sessionsData }, { headers: corsHeaders });
    }

    // 3. GET /api/traffic/sources
    case "sources": {
      const overview = await getDashboardOverview(shopId);
      return Response.json(
        { success: true, shopDomain, sources: overview.trafficSources },
        { headers: corsHeaders }
      );
    }

    // 4. GET /api/traffic/campaigns
    case "campaigns": {
      const overview = await getDashboardOverview(shopId);
      return Response.json(
        { success: true, shopDomain, campaigns: overview.campaigns },
        { headers: corsHeaders }
      );
    }

    // 5. GET /api/traffic/alerts
    case "alerts": {
      const statusParam = url.searchParams.get("status") || undefined;
      const severity = url.searchParams.get("severity") || undefined;
      const dateRange = url.searchParams.get("dateRange") || url.searchParams.get("date") || undefined;
      const sortOrder = url.searchParams.get("sortOrder") as "newest" | "oldest" | "severity" | "affected" | undefined;

      await checkAndGenerateAlerts(shopId);
      const alerts = await getShopAlerts(shopId, { status: statusParam, severity, dateRange, sortOrder });
      return Response.json({ success: true, shopDomain, alerts, totalCount: alerts.length }, { headers: corsHeaders });
    }

    // 6. GET /api/traffic/insights
    case "insights": {
      const overview = await getDashboardOverview(shopId);
      const insights = await generateAiInsights(overview, shopId);
      return Response.json({ success: true, shopDomain, insights }, { headers: corsHeaders });
    }

    // 7. GET /api/traffic/settings
    case "settings": {
      const settings = await getShopSettings(shopId);
      return Response.json({ success: true, shopDomain, settings }, { headers: corsHeaders });
    }

    // 8. GET /api/traffic/impact
    case "impact": {
      const overview = await getDashboardOverview(shopId);
      return Response.json(
        { success: true, shopDomain, businessImpact: overview.businessImpact },
        { headers: corsHeaders }
      );
    }

    // 9. GET /api/traffic/capabilities
    case "capabilities": {
      const capabilities = await ProtectionEngine.getPlatformCapabilityStatus(shopId, shopDomain);
      return Response.json({ success: true, shopDomain, capabilities }, { headers: corsHeaders });
    }

    // 10. GET /api/traffic/audit-logs
    case "audit-logs": {
      const limit = parseInt(url.searchParams.get("limit") || "50", 10);
      const auditLogs = await ProtectionEngine.getAuditLogs(shopId, limit);
      return Response.json({ success: true, shopDomain, auditLogs }, { headers: corsHeaders });
    }

    // 11. GET /api/traffic/protection-rules
    case "protection-rules": {
      const rules = await ProtectionRuleManager.getRules(shopId);
      return Response.json({ success: true, shopDomain, rules, totalCount: rules.length }, { headers: corsHeaders });
    }

    // 12. GET /api/traffic/protection-actions
    case "protection-actions": {
      const limit = parseInt(url.searchParams.get("limit") || "50", 10);
      const offset = parseInt(url.searchParams.get("offset") || "0", 10);
      const actionFilter = url.searchParams.get("action") as any;
      const statusFilter = url.searchParams.get("status") || undefined;
      const result = await ProtectionActionManager.getActions(shopId, { limit, offset, action: actionFilter, status: statusFilter });
      return Response.json({ success: true, shopDomain, ...result }, { headers: corsHeaders });
    }

    default:
      return Response.json(
        {
          error: `Endpoint '/api/traffic/${splat}' not found. Available: overview, sessions, sources, campaigns, alerts, insights, settings, impact, capabilities, audit-logs, protection-rules, protection-actions`,
        },
        { status: 404, headers: corsHeaders }
      );
  }
};

/**
 * POST Handler for /api/traffic/*
 */
export const action = async ({ request, params }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const { shopId, shopDomain } = await resolveAuthenticatedShop(request);
  const splat = params["*"] || "";
  const parts = splat.split("/").filter(Boolean);
  const route = parts[0] || "";

  try {
    const body = await request.json().catch(() => ({}));

    switch (route) {
      // 1. POST /api/traffic/settings
      case "settings": {
        const updated = await updateShopSettings(shopId, {
          autoProtect: typeof body.autoProtect === "boolean" ? body.autoProtect : undefined,
          protectionMode: typeof body.protectionMode === "string" ? body.protectionMode : undefined,
          emailAlerts: typeof body.emailAlerts === "boolean" ? body.emailAlerts : undefined,
          alertFrequency: typeof body.alertFrequency === "string" ? body.alertFrequency : undefined,
          dataRetentionDays: typeof body.dataRetentionDays === "number" ? body.dataRetentionDays : undefined,
          anonymousDataSharing: typeof body.anonymousDataSharing === "boolean" ? body.anonymousDataSharing : undefined,
        });

        await prisma.auditLog.create({
          data: {
            shopId,
            actor: "MERCHANT",
            action: "SETTINGS_UPDATED",
            resourceType: "Settings",
            resourceId: updated.id,
            metadata: JSON.stringify(body),
          },
        });

        return Response.json({ success: true, settings: updated }, { headers: corsHeaders });
      }

      // 2. POST /api/traffic/actions
      case "actions": {
        const { sessionId, action: protectionAction, reason } = body;
        if (!sessionId || !protectionAction) {
          return Response.json(
            { error: "Missing required fields: sessionId, action" },
            { status: 400, headers: corsHeaders }
          );
        }

        const session = await prisma.trafficSession.findFirst({
          where: { id: sessionId, shopId },
        });

        if (!session) {
          return Response.json(
            { error: `Session '${sessionId}' not found for store` },
            { status: 404, headers: corsHeaders }
          );
        }

        const recorded = await prisma.protectionAction.create({
          data: {
            shopId,
            sessionId: session.id,
            action: protectionAction,
            status: "EXECUTED",
            reason: reason || `Manual action enforced by merchant.`,
          },
        });

        await prisma.auditLog.create({
          data: {
            shopId,
            actor: "MERCHANT",
            action: "PROTECTION_ACTION_ENFORCED",
            resourceType: "ProtectionAction",
            resourceId: recorded.id,
            metadata: JSON.stringify({ sessionId, action: protectionAction, reason }),
          },
        });

        return Response.json({ success: true, action: recorded }, { status: 201, headers: corsHeaders });
      }

      // 3. POST /api/traffic/sessions/:id/investigate
      case "sessions": {
        const sessionId = parts[1];
        const subAction = parts[2];

        if (subAction === "investigate" && sessionId) {
          const session = await prisma.trafficSession.findFirst({
            where: { id: sessionId, shopId },
            include: { events: true },
          });

          if (!session) {
            return Response.json(
              { error: `Session '${sessionId}' not found for store` },
              { status: 404, headers: corsHeaders }
            );
          }

          const detection = await evaluateSessionRisk(session);

          return Response.json(
            {
              success: true,
              sessionId: session.id,
              riskScore: detection.riskScore,
              trafficType: detection.trafficType,
              severity: detection.severity,
              reasons: detection.reasons,
              signals: detection.signals,
              recommendedAction: detection.recommendedAction,
            },
            { headers: corsHeaders }
          );
        }

        return Response.json({ error: "Invalid sessions sub-action" }, { status: 404, headers: corsHeaders });
      }

      // 4. POST /api/traffic/alerts/:id/resolve or /api/traffic/alerts/:id/toggle
      case "alerts": {
        const alertId = parts[1];
        const subAction = parts[2] || "resolve";

        if (alertId && (subAction === "resolve" || subAction === "toggle")) {
          const updated = subAction === "resolve"
            ? await resolveAlert(alertId, shopId)
            : await toggleAlertStatus(alertId, shopId);

          if (!updated) {
            return Response.json(
              { error: `Alert '${alertId}' not found for store` },
              { status: 404, headers: corsHeaders }
            );
          }

          return Response.json({ success: true, alert: updated }, { headers: corsHeaders });
        }

        return Response.json({ error: "Invalid alerts sub-action" }, { status: 404, headers: corsHeaders });
      }

      // 5. POST /api/traffic/protection-rules
      case "protection-rules": {
        const { name, action: ruleAction, threshold, configuration, enabled } = body;
        if (!name || !ruleAction) {
          return Response.json(
            { error: "Missing required fields: name, action" },
            { status: 400, headers: corsHeaders }
          );
        }

        const rule = await prisma.protectionRule.create({
          data: {
            shopId,
            name,
            action: ruleAction,
            threshold: typeof threshold === "number" ? threshold : 80,
            configuration: configuration ? JSON.stringify(configuration) : null,
            enabled: typeof enabled === "boolean" ? enabled : true,
          },
        });

        await prisma.auditLog.create({
          data: {
            shopId,
            actor: "MERCHANT",
            action: "PROTECTION_RULE_CREATED",
            resourceType: "ProtectionRule",
            resourceId: rule.id,
            metadata: JSON.stringify({ name, action: ruleAction, threshold }),
          },
        });

        return Response.json({ success: true, rule }, { status: 201, headers: corsHeaders });
      }

      default:
        return Response.json(
          { error: `Invalid action endpoint: '/api/traffic/${splat}'` },
          { status: 404, headers: corsHeaders }
        );
    }
  } catch (err) {
    console.error("Traffic API Error:", err);
    return Response.json(
      {
        error: "Internal Server Error",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500, headers: corsHeaders }
    );
  }
};
