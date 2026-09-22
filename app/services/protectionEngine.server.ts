import prisma from "../db.server";
import type { TrafficSession, ProtectionRule, ProtectionAction, AuditLog } from "@prisma/client";

export type ProtectionMode = "MONITOR" | "FLAG" | "ALERT" | "REDIRECT" | "CHALLENGE" | "BLOCK";

export type CapabilityStatus = "SUPPORTED" | "NOT_SUPPORTED" | "CONFIGURATION_REQUIRED";

export interface PlatformCapability {
  id: string;
  name: string;
  category: "ENFORCEMENT" | "TELEMETRY" | "CHALLENGE" | "NOTIFICATIONS";
  status: CapabilityStatus;
  description: string;
  technicalMechanism: string;
  badge: string;
  badgeColor: "success" | "neutral" | "warning";
  actionPrompt?: string;
  actionUrl?: string;
}

export interface PlatformCapabilityMatrix {
  shopDomain: string;
  activeMode: ProtectionMode;
  autoProtect: boolean;
  capabilities: PlatformCapability[];
  summary: {
    supportedCount: number;
    notSupportedCount: number;
    configRequiredCount: number;
  };
  surfaces: {
    webPixel: {
      name: string;
      status: "ACTIVE" | "INACTIVE";
      description: string;
      supported: boolean;
    };
    cartCheckoutValidation: {
      name: string;
      status: "ACTIVE" | "AVAILABLE" | "SIMULATED";
      description: string;
      supported: boolean;
      integrationEndpoint?: string;
    };
    checkoutUiExtension: {
      name: string;
      status: "AVAILABLE" | "INACTIVE";
      description: string;
      supported: boolean;
    };
    storefrontEdgeInterception: {
      name: string;
      status: "RESTRICTED_BY_SHOPIFY_ARCHITECTURE";
      description: string;
      supported: boolean;
      explanation: string;
    };
  };
}

export interface ProtectionDecision {
  sessionId: string;
  riskScore: number;
  mode: ProtectionMode;
  decision: ProtectionMode;
  status: "EXECUTED" | "SIMULATED" | "FAILED";
  allowed: boolean;
  reason: string;
  ruleId?: string;
  timestamp: string;
  enforcementSurface: "SHOPIFY_FUNCTION_CHECKOUT" | "WEB_PIXEL_TELEMETRY" | "CHECKOUT_UI_EXTENSION" | "STOREFRONT_EDGE";
  capabilityNotice?: string;
}

export interface CreateProtectionRuleInput {
  name: string;
  action: ProtectionMode;
  threshold?: number;
  configuration?: Record<string, unknown> | null;
  enabled?: boolean;
}

export interface UpdateProtectionRuleInput {
  name?: string;
  action?: ProtectionMode;
  threshold?: number;
  configuration?: Record<string, unknown> | null;
  enabled?: boolean;
}

export class ProtectionEngine {
  /**
   * Evaluates a session against configured protection modes and custom rules.
   * Default mode is MONITOR (detect suspicious traffic, record decision, do NOT block visitor).
   * In BLOCK mode, uses only Shopify-supported enforcement (Checkout Validation API);
   * never claims unsupported storefront edge HTTP requests were blocked.
   * Every decision is written to AuditLog.
   */
  static async evaluateAndEnforceProtection(
    session: TrafficSession,
    riskScore: number,
    context?: { isCheckout?: boolean; isCart?: boolean; eventType?: string }
  ): Promise<ProtectionDecision | null> {
    // 1. Fetch shop settings (default: MONITOR)
    const settings = await prisma.shopSettings.findUnique({
      where: { shopId: session.shopId },
    });

    const activeMode: ProtectionMode = (settings?.protectionMode as ProtectionMode) || "MONITOR";
    const autoProtect = settings?.autoProtect ?? true;

    // 2. Fetch custom protection rules configured for this shop
    const customRules = await prisma.protectionRule.findMany({
      where: { shopId: session.shopId, enabled: true },
      orderBy: { threshold: "desc" },
    });

    // Match against custom rules if any
    const matchedRule = customRules.find((r) => riskScore >= r.threshold);

    // If score is safe and no rule matches, no enforcement required
    if (riskScore < 40 && !matchedRule) {
      return null;
    }

    const timestamp = new Date().toISOString();
    let decisionAction: ProtectionMode = activeMode;
    let status: "EXECUTED" | "SIMULATED" | "FAILED" = "SIMULATED";
    let allowed = true;
    let reason = "Standard traffic monitoring active.";
    let ruleId: string | undefined = matchedRule?.id;
    let surface: ProtectionDecision["enforcementSurface"] = "WEB_PIXEL_TELEMETRY";
    let capabilityNotice: string | undefined;

    const isCheckoutOrCart =
      context?.isCheckout === true ||
      context?.isCart === true ||
      session.checkoutStarted ||
      session.addToCartCount > 0;

    // Custom rule priority check
    if (matchedRule) {
      const ruleAction = matchedRule.action as ProtectionMode;
      ruleId = matchedRule.id;

      if (activeMode === "MONITOR") {
        // In MONITOR mode, custom rules are evaluated and recorded but NEVER block the visitor
        decisionAction = "MONITOR";
        status = "SIMULATED";
        allowed = true;
        surface = "WEB_PIXEL_TELEMETRY";
        reason = `Matched custom rule "${matchedRule.name}" (Threshold: ${matchedRule.threshold}). Simulated in MONITOR mode (safe detection, visitor allowed).`;
        capabilityNotice = "Store is in MONITOR mode. Decision recorded in dashboard without disrupting customer visits.";
      } else if (ruleAction === "BLOCK") {
        decisionAction = "BLOCK";
        if (isCheckoutOrCart) {
          // Shopify-supported enforcement mechanism
          status = "EXECUTED";
          allowed = false;
          surface = "SHOPIFY_FUNCTION_CHECKOUT";
          reason = `Matched BLOCK rule "${matchedRule.name}" (Threshold: ${matchedRule.threshold}). Blocked at checkout validation via Shopify Functions.`;
        } else {
          // Storefront edge HTTP blocking is architecturally restricted by Shopify CDN
          status = "SIMULATED";
          allowed = true;
          surface = "STOREFRONT_EDGE";
          reason = `Matched BLOCK rule "${matchedRule.name}" (Threshold: ${matchedRule.threshold}). Storefront edge HTTP interception is restricted by Shopify architecture. Session armed for checkout blocking.`;
          capabilityNotice = "Shopify architecture does not permit edge HTTP blocking on storefront visits. Protection is actively armed for Cart & Checkout validation.";
        }
      } else if (ruleAction === "CHALLENGE") {
        decisionAction = "CHALLENGE";
        status = isCheckoutOrCart ? "EXECUTED" : "SIMULATED";
        allowed = !isCheckoutOrCart;
        surface = "CHECKOUT_UI_EXTENSION";
        reason = `Matched CHALLENGE rule "${matchedRule.name}" (Threshold: ${matchedRule.threshold}). Verification challenge presented via Checkout UI Extension.`;
      } else if (ruleAction === "REDIRECT") {
        decisionAction = "REDIRECT";
        status = "SIMULATED";
        allowed = true;
        surface = "STOREFRONT_EDGE";
        reason = `Matched REDIRECT rule "${matchedRule.name}" (Threshold: ${matchedRule.threshold}). Suspicious session marked for verification page redirect.`;
      } else if (ruleAction === "ALERT") {
        decisionAction = "ALERT";
        status = "EXECUTED";
        allowed = true;
        surface = "WEB_PIXEL_TELEMETRY";
        reason = `Matched ALERT rule "${matchedRule.name}" (Threshold: ${matchedRule.threshold}). Anomaly alert dispatched for merchant review.`;
      } else if (ruleAction === "FLAG") {
        decisionAction = "FLAG";
        status = "EXECUTED";
        allowed = true;
        surface = "WEB_PIXEL_TELEMETRY";
        reason = `Matched FLAG rule "${matchedRule.name}" (Threshold: ${matchedRule.threshold}). Flagged for investigation and filtered from marketing analytics.`;
      } else {
        // Default MONITOR
        decisionAction = "MONITOR";
        status = "SIMULATED";
        allowed = true;
        surface = "WEB_PIXEL_TELEMETRY";
        reason = `Matched MONITOR rule "${matchedRule.name}". Monitored safely.`;
      }
    } else {
      // Global shop protectionMode logic
      switch (activeMode) {
        case "BLOCK": {
          // BLOCK mode:
          // Likely Automated (> 80): Block at checkout validation
          // Suspicious (50-80): Flag without blocking (storefront and checkout allowed)
          // Likely Human (< 50): Monitor safely
          if (autoProtect && riskScore > 80) {
            decisionAction = "BLOCK";
            if (isCheckoutOrCart) {
              // Supported: Cart & Checkout validation via Shopify Functions
              status = "EXECUTED";
              allowed = false;
              surface = "SHOPIFY_FUNCTION_CHECKOUT";
              reason = `High-confidence automated threat (risk score: ${riskScore}). Blocked at checkout validation via Shopify Functions.`;
            } else {
              // Storefront edge HTTP interception is restricted by Shopify architecture
              status = "SIMULATED";
              allowed = true;
              surface = "STOREFRONT_EDGE";
              reason = `High-confidence automated threat detected (risk score: ${riskScore}). Session armed for Cart & Checkout blocking.`;
              capabilityNotice = "Shopify architecture does not permit edge HTTP blocking on storefront visits. Protection is actively armed for Cart & Checkout validation.";
            }
          } else if (riskScore >= 50) {
            // Suspicious: Flagged for review, visitor allowed without blocking
            decisionAction = "FLAG";
            status = "EXECUTED";
            allowed = true;
            surface = "WEB_PIXEL_TELEMETRY";
            reason = `Suspicious traffic flagged (risk score: ${riskScore}). Monitored and flagged for review without blocking visitor.`;
            capabilityNotice = "Session flagged for merchant review. Continuous AI monitoring active without disrupting storefront browsing or checkout.";
          } else {
            decisionAction = "MONITOR";
            status = "SIMULATED";
            allowed = true;
            surface = "WEB_PIXEL_TELEMETRY";
            reason = `Normal traffic observed (risk score: ${riskScore}). Monitored safely.`;
          }
          break;
        }

        case "CHALLENGE": {
          // CHALLENGE mode:
          // Likely Automated / Threat (>= 60): Verification challenge required
          // Suspicious (50-59): Flag without blocking (storefront and checkout allowed)
          // Likely Human (< 50): Monitor safely
          if (riskScore >= 60) {
            decisionAction = "CHALLENGE";
            status = isCheckoutOrCart ? "EXECUTED" : "SIMULATED";
            allowed = !isCheckoutOrCart;
            surface = "CHECKOUT_UI_EXTENSION";
            reason = `High-risk automated activity (risk score: ${riskScore} >= 60). Verification challenge required at checkout.`;
          } else if (riskScore >= 50) {
            // Suspicious: Flagged for review, visitor allowed without blocking
            decisionAction = "FLAG";
            status = "EXECUTED";
            allowed = true;
            surface = "WEB_PIXEL_TELEMETRY";
            reason = `Suspicious traffic flagged (risk score: ${riskScore}). Monitored and flagged for review without blocking visitor.`;
            capabilityNotice = "Session flagged for merchant review. Continuous AI monitoring active without disrupting storefront browsing or checkout.";
          } else {
            decisionAction = "MONITOR";
            status = "SIMULATED";
            allowed = true;
            surface = "WEB_PIXEL_TELEMETRY";
            reason = `Traffic monitored safely (risk score: ${riskScore}). Below threat threshold.`;
          }
          break;
        }

        case "REDIRECT": {
          decisionAction = "REDIRECT";
          status = "SIMULATED";
          allowed = true;
          surface = "STOREFRONT_EDGE";
          reason = `Suspicious session (risk score: ${riskScore}) marked for redirect to security verification page via Theme App Extension.`;
          break;
        }

        case "FLAG": {
          decisionAction = "FLAG";
          status = "EXECUTED";
          allowed = true;
          surface = "WEB_PIXEL_TELEMETRY";
          reason = `Automated or suspicious traffic flagged for investigation (risk score: ${riskScore}). Filtered from marketing analytics.`;
          break;
        }

        case "ALERT": {
          decisionAction = "ALERT";
          status = "EXECUTED";
          allowed = true;
          surface = "WEB_PIXEL_TELEMETRY";
          reason = `Traffic anomaly detected (risk score: ${riskScore}). Real-time alert dispatched for merchant notification.`;
          break;
        }

        default: {
          decisionAction = "MONITOR";
          status = "SIMULATED";
          allowed = true;
          surface = "WEB_PIXEL_TELEMETRY";
          reason = `Traffic observed (risk score: ${riskScore}). Monitored safely.`;
        }
      }
    }

    const decision: ProtectionDecision = {
      sessionId: session.id,
      riskScore,
      mode: activeMode,
      decision: decisionAction,
      status,
      allowed,
      reason,
      ruleId,
      timestamp,
      enforcementSurface: surface,
      capabilityNotice,
    };

    // 3. Record ProtectionAction in PostgreSQL
    await prisma.protectionAction.create({
      data: {
        shopId: session.shopId,
        sessionId: session.id,
        action: decision.decision,
        status: decision.status,
        reason: decision.reason,
        metadata: JSON.stringify({
          allowed: decision.allowed,
          mode: activeMode,
          riskScore,
          surface: decision.enforcementSurface,
          capabilityNotice: decision.capabilityNotice,
          ruleId: decision.ruleId,
        }),
      },
    });

    // 4. Record auditable AuditLog in PostgreSQL
    await prisma.auditLog.create({
      data: {
        shopId: session.shopId,
        actor: "SYSTEM",
        action: `PROTECTION_${decision.decision}_DECISION`,
        resourceType: "Session",
        resourceId: session.id,
        metadata: JSON.stringify({
          sessionId: session.id,
          riskScore,
          mode: activeMode,
          decision: decision.decision,
          status: decision.status,
          allowed: decision.allowed,
          reason: decision.reason,
          ruleId: decision.ruleId,
          timestamp: decision.timestamp,
          enforcementSurface: decision.enforcementSurface,
          capabilityNotice: decision.capabilityNotice,
        }),
      },
    });

    return decision;
  }

  /**
   * Manually triggers or enforces a protection decision on a session by merchant action.
   */
  static async enforceManualDecision(
    sessionId: string,
    shopId: string,
    action: ProtectionMode,
    reason: string
  ): Promise<ProtectionAction> {
    const session = await prisma.trafficSession.findFirst({
      where: { id: sessionId, shopId },
    });

    if (!session) {
      throw new Error(`Session '${sessionId}' not found for store`);
    }

    const recorded = await prisma.protectionAction.create({
      data: {
        shopId,
        sessionId: session.id,
        action,
        status: "EXECUTED",
        reason: reason || `Manual merchant enforcement: ${action}`,
        metadata: JSON.stringify({
          actor: "MERCHANT",
          manual: true,
          timestamp: new Date().toISOString(),
        }),
      },
    });

    await prisma.auditLog.create({
      data: {
        shopId,
        actor: "MERCHANT",
        action: `MANUAL_PROTECTION_${action}`,
        resourceType: "Session",
        resourceId: session.id,
        metadata: JSON.stringify({
          sessionId: session.id,
          riskScore: session.riskScore,
          decision: action,
          reason,
          timestamp: new Date().toISOString(),
          actor: "MERCHANT",
        }),
      },
    });

    return recorded;
  }

  /**
   * Returns current Shopify platform capability status and integration points.
   * Transparently documents what can and cannot be technically enforced,
   * categorizing each into SUPPORTED, NOT_SUPPORTED, or CONFIGURATION_REQUIRED.
   */
  static async getPlatformCapabilityStatus(
    shopId: string,
    shopDomain: string
  ): Promise<PlatformCapabilityMatrix> {
    const settings = await prisma.shopSettings.findUnique({ where: { shopId } });
    const activeMode: ProtectionMode = (settings?.protectionMode as ProtectionMode) || "MONITOR";
    const autoProtect = settings?.autoProtect ?? true;
    const checkoutValidationEnabled = settings?.checkoutValidation ?? true;

    // Check if store has live web pixel events
    const eventCount = await prisma.trafficEvent.count({ where: { shopId } });
    const hasActivePixel = eventCount > 0;

    const capabilities: PlatformCapability[] = [
      {
        id: "cart-checkout-validation",
        name: "Cart & Checkout Validation",
        category: "ENFORCEMENT",
        status: checkoutValidationEnabled ? "SUPPORTED" : "CONFIGURATION_REQUIRED",
        description:
          "Blocks automated or malicious checkout attempts and inventory stuffing using Shopify Functions Cart & Checkout Validation API.",
        technicalMechanism: "Shopify Functions (Cart & Checkout Validation API)",
        badge: checkoutValidationEnabled ? "Supported" : "Configuration Required",
        badgeColor: checkoutValidationEnabled ? "success" : "warning",
        actionPrompt: checkoutValidationEnabled ? undefined : "Enable in Traffiq Settings",
      },
      {
        id: "web-pixel-telemetry",
        name: "Storefront Behavioral Telemetry",
        category: "TELEMETRY",
        status: "SUPPORTED",
        description:
          "Subscribes to customer browsing events, click cadence, and client heuristics inside Shopify's isolated Web Pixels sandbox.",
        technicalMechanism: "Shopify Web Pixels API (Isolated Sandbox)",
        badge: hasActivePixel ? "Supported & Active" : "Supported",
        badgeColor: "success",
      },
      {
        id: "realtime-anomaly-alerts",
        name: "Real-time Anomaly Dispatch",
        category: "NOTIFICATIONS",
        status: "SUPPORTED",
        description:
          "Monitors storefront traffic velocity and dispatches instant security alerts when traffic spikes or conversion drops occur.",
        technicalMechanism: "Traffiq Alert Engine & Webhooks",
        badge: "Supported",
        badgeColor: "success",
      },
      {
        id: "checkout-ui-challenge",
        name: "Checkout Challenge & Verification",
        category: "CHALLENGE",
        status: "CONFIGURATION_REQUIRED",
        description:
          "Presents bot verification prompts and security banners to suspicious visitors before payment processing.",
        technicalMechanism: "Shopify Checkout UI Extensions",
        badge: "Configuration Required",
        badgeColor: "warning",
        actionPrompt: "Configure in Shopify Checkout Editor",
        actionUrl: `https://${shopDomain}/admin/settings/checkout`,
      },
      {
        id: "storefront-edge-interception",
        name: "Storefront Edge HTTP Interception",
        category: "ENFORCEMENT",
        status: "NOT_SUPPORTED",
        description:
          "Arbitrary edge HTTP request blocking (returning HTTP 403s on initial storefront GET requests) is restricted by Shopify CDN architecture.",
        technicalMechanism: "Shopify Global Edge CDN (Restricted Reverse Proxy)",
        badge: "Restricted by Shopify Architecture",
        badgeColor: "neutral",
      },
    ];

    const supportedCount = capabilities.filter((c) => c.status === "SUPPORTED").length;
    const notSupportedCount = capabilities.filter((c) => c.status === "NOT_SUPPORTED").length;
    const configRequiredCount = capabilities.filter((c) => c.status === "CONFIGURATION_REQUIRED").length;

    const surfaces = {
      webPixel: {
        name: "Storefront Behavioral Telemetry",
        status: hasActivePixel ? ("ACTIVE" as const) : ("INACTIVE" as const),
        description: "Subscribes to customer browsing events inside Shopify's isolated Web Pixels sandbox.",
        supported: true,
      },
      cartCheckoutValidation: {
        name: "Cart & Checkout Validation",
        status: activeMode === "BLOCK" ? ("ACTIVE" as const) : ("AVAILABLE" as const),
        description: "Blocks automated or malicious checkout attempts using Shopify Functions Cart and Checkout Validation API.",
        supported: true,
        integrationEndpoint: "/api/protection/checkout-validate",
      },
      checkoutUiExtension: {
        name: "Checkout Challenge & Verification",
        status: activeMode === "CHALLENGE" ? ("AVAILABLE" as const) : ("INACTIVE" as const),
        description: "Presents bot mitigation challenges and banner notices via Shopify Checkout UI Extensions.",
        supported: true,
      },
      storefrontEdgeInterception: {
        name: "Storefront Edge HTTP Interception",
        status: "RESTRICTED_BY_SHOPIFY_ARCHITECTURE" as const,
        description: "Arbitrary edge HTTP blocking of storefront visits is architecturally restricted by Shopify CDN.",
        supported: false,
        explanation: "Shopify routes storefront traffic through its own global edge CDN. Standard app backends cannot intercept arbitrary storefront HTTP GET requests. Traffiq protects your conversion funnel at Cart & Checkout validation extension points instead.",
      },
    };

    return {
      shopDomain,
      activeMode,
      autoProtect,
      capabilities,
      summary: {
        supportedCount,
        notSupportedCount,
        configRequiredCount,
      },
      surfaces,
    };
  }

  /**
   * Retrieves recent audit logs for merchant review.
   */
  static async getAuditLogs(shopId: string, limit = 50): Promise<AuditLog[]> {
    return await prisma.auditLog.findMany({
      where: { shopId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  /**
   * Returns overview metrics for protection status based on real database records.
   */
  static async getProtectionOverview(shopId: string) {
    const settings = await prisma.shopSettings.findUnique({ where: { shopId } });
    const [
      totalBlocked,
      totalMonitored,
      totalFlagged,
      totalChallenged,
      totalActions,
      activeRules,
      recentActions,
    ] = await Promise.all([
      prisma.protectionAction.count({
        where: { shopId, action: "BLOCK", status: "EXECUTED" },
      }),
      prisma.protectionAction.count({
        where: { shopId, action: "MONITOR" },
      }),
      prisma.protectionAction.count({
        where: { shopId, action: "FLAG" },
      }),
      prisma.protectionAction.count({
        where: { shopId, action: "CHALLENGE" },
      }),
      prisma.protectionAction.count({
        where: { shopId },
      }),
      prisma.protectionRule.count({
        where: { shopId, enabled: true },
      }),
      prisma.protectionAction.findMany({
        where: { shopId },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

    return {
      mode: (settings?.protectionMode as ProtectionMode) || "MONITOR",
      autoProtect: settings?.autoProtect ?? true,
      totalBlockedSessions: totalBlocked,
      totalMonitoredSessions: totalMonitored,
      totalFlaggedSessions: totalFlagged,
      totalChallengedSessions: totalChallenged,
      totalProtectionActions: totalActions,
      activeRulesCount: activeRules,
      recentActions,
    };
  }
}

/**
 * ProtectionRule Manager
 * Provides complete CRUD operations for merchant-configured protection rules.
 */
export class ProtectionRuleManager {
  static async getRules(shopId: string): Promise<ProtectionRule[]> {
    return await prisma.protectionRule.findMany({
      where: { shopId },
      orderBy: { threshold: "asc" },
    });
  }

  static async createRule(shopId: string, input: CreateProtectionRuleInput): Promise<ProtectionRule> {
    const rule = await prisma.protectionRule.create({
      data: {
        shopId,
        name: input.name,
        action: input.action,
        threshold: input.threshold ?? 80,
        configuration: input.configuration ? JSON.stringify(input.configuration) : null,
        enabled: input.enabled ?? true,
      },
    });

    await prisma.auditLog.create({
      data: {
        shopId,
        actor: "MERCHANT",
        action: "PROTECTION_RULE_CREATED",
        resourceType: "ProtectionRule",
        resourceId: rule.id,
        metadata: JSON.stringify({
          name: rule.name,
          action: rule.action,
          threshold: rule.threshold,
        }),
      },
    });

    return rule;
  }

  static async updateRule(
    ruleId: string,
    shopId: string,
    input: UpdateProtectionRuleInput
  ): Promise<ProtectionRule | null> {
    const existing = await prisma.protectionRule.findFirst({
      where: { id: ruleId, shopId },
    });

    if (!existing) return null;

    const updated = await prisma.protectionRule.update({
      where: { id: ruleId },
      data: {
        name: input.name ?? undefined,
        action: input.action ?? undefined,
        threshold: input.threshold ?? undefined,
        configuration:
          input.configuration !== undefined
            ? input.configuration
              ? JSON.stringify(input.configuration)
              : null
            : undefined,
        enabled: input.enabled !== undefined ? input.enabled : undefined,
      },
    });

    await prisma.auditLog.create({
      data: {
        shopId,
        actor: "MERCHANT",
        action: "PROTECTION_RULE_UPDATED",
        resourceType: "ProtectionRule",
        resourceId: updated.id,
        metadata: JSON.stringify({
          ruleId: updated.id,
          name: updated.name,
          action: updated.action,
          threshold: updated.threshold,
          enabled: updated.enabled,
        }),
      },
    });

    return updated;
  }

  static async deleteRule(ruleId: string, shopId: string): Promise<boolean> {
    const existing = await prisma.protectionRule.findFirst({
      where: { id: ruleId, shopId },
    });

    if (!existing) return false;

    await prisma.protectionRule.delete({
      where: { id: ruleId },
    });

    await prisma.auditLog.create({
      data: {
        shopId,
        actor: "MERCHANT",
        action: "PROTECTION_RULE_DELETED",
        resourceType: "ProtectionRule",
        resourceId: ruleId,
        metadata: JSON.stringify({
          ruleId,
          name: existing.name,
        }),
      },
    });

    return true;
  }
}

/**
 * ProtectionAction Manager
 * Provides queries and records for protection enforcement events.
 */
export class ProtectionActionManager {
  static async recordAction(data: {
    shopId: string;
    sessionId: string;
    action: ProtectionMode;
    status: "EXECUTED" | "SIMULATED" | "FAILED";
    reason: string;
    metadata?: Record<string, unknown>;
  }): Promise<ProtectionAction> {
    const action = await prisma.protectionAction.create({
      data: {
        shopId: data.shopId,
        sessionId: data.sessionId,
        action: data.action,
        status: data.status,
        reason: data.reason,
        metadata: data.metadata ? JSON.stringify(data.metadata) : null,
      },
    });

    await prisma.auditLog.create({
      data: {
        shopId: data.shopId,
        actor: "SYSTEM",
        action: `PROTECTION_${data.action}_RECORDED`,
        resourceType: "ProtectionAction",
        resourceId: action.id,
        metadata: JSON.stringify({
          actionId: action.id,
          sessionId: data.sessionId,
          action: data.action,
          status: data.status,
          reason: data.reason,
        }),
      },
    });

    return action;
  }

  static async getActions(
    shopId: string,
    options?: {
      limit?: number;
      offset?: number;
      action?: ProtectionMode;
      status?: string;
    }
  ): Promise<{ actions: ProtectionAction[]; totalCount: number }> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const where: any = { shopId };

    if (options?.action) where.action = options.action;
    if (options?.status) where.status = options.status;

    const [actions, totalCount] = await Promise.all([
      prisma.protectionAction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.protectionAction.count({ where }),
    ]);

    return { actions, totalCount };
  }
}

// Backward-compatible named exports
export const evaluateAndEnforceProtection = ProtectionEngine.evaluateAndEnforceProtection;
export const getProtectionStatus = ProtectionEngine.getProtectionOverview;
export const enforceManualDecision = ProtectionEngine.enforceManualDecision;
export const getPlatformCapabilityStatus = ProtectionEngine.getPlatformCapabilityStatus;
export const getAuditLogs = ProtectionEngine.getAuditLogs;
