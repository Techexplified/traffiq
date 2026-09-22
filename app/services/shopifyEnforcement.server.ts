import prisma from "../db.server";
import { ProtectionEngine } from "./protectionEngine.server";

export interface CheckoutValidationInput {
  shopId: string;
  cartId?: string;
  token?: string;
  clientId?: string;
  clientIp?: string;
  userAgent?: string;
  totalAmount?: number;
}

export interface CheckoutValidationOutput {
  allowed: boolean;
  decision: "ALLOW" | "BLOCK" | "CHALLENGE" | "MONITOR";
  reason: string;
  errors?: Array<{
    localizedMessage: string;
    target: "cart" | "checkout";
  }>;
}

/**
 * Real Shopify Functions Cart & Checkout Validation integration handler.
 * Evaluates session telemetry against merchant protection rules at the checkout extension point.
 */
export async function validateCheckoutSession(
  input: CheckoutValidationInput
): Promise<CheckoutValidationOutput> {
  const { shopId, token, clientId, clientIp } = input;

  // Locate session by clientId, token, or IP fingerprint
  const sessionKey = clientId || token || (clientIp ? `anon_${clientIp.replace(/[^a-zA-Z0-9]/g, "_")}` : "");

  const session = await prisma.trafficSession.findFirst({
    where: {
      shopId,
      OR: [
        { sessionKey },
        { id: token || "" },
      ],
    },
    orderBy: { lastSeenAt: "desc" },
  });

  const settings = await prisma.shopSettings.findUnique({
    where: { shopId },
  });

  const activeMode = (settings?.protectionMode || "CHALLENGE").toUpperCase() === "BLOCK" ? "BLOCK" : "CHALLENGE";
  const autoProtect = settings?.autoProtect ?? true;

  // If session not found, allow conservatively
  if (!session) {
    return {
      allowed: true,
      decision: "ALLOW",
      reason: "No high-risk indicators associated with checkout session.",
    };
  }

  // Check if session has an explicit manual BLOCK action executed by merchant
  const manualBlock = await prisma.protectionAction.findFirst({
    where: {
      shopId,
      action: "BLOCK",
      status: "EXECUTED",
      OR: [
        { sessionId: session.id },
        { session: { sessionKey: session.sessionKey } },
        { metadata: { contains: session.sessionKey } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });

  const isSessionFlaggedAsBlocked =
    session.isFlagged &&
    (session.flaggedReason?.includes("Manually blocked") ||
      session.aiRecommendation?.includes("manually blocked"));

  if (manualBlock || isSessionFlaggedAsBlocked) {
    return {
      allowed: false,
      decision: "BLOCK",
      reason:
        manualBlock?.reason ||
        session.flaggedReason ||
        "Session manually blocked by merchant via Traffic Investigation.",
      errors: [
        {
          localizedMessage: "Access to checkout is restricted for this session.",
          target: "checkout",
        },
      ],
    };
  }

  // Suspicious traffic (50 to 80): ALWAYS ALLOW checkout, never block!
  if (session.riskScore <= 80) {
    if (session.riskScore >= 50) {
      // Record FLAG action in background for telemetry and AI recommendation
      await ProtectionEngine.evaluateAndEnforceProtection(session, session.riskScore);
    }
    return {
      allowed: true,
      decision: "ALLOW",
      reason: session.riskScore >= 50
        ? `Suspicious session (Risk: ${session.riskScore}/100) flagged for monitoring. Checkout allowed.`
        : "Session verified clean. Checkout permitted.",
    };
  }

  // Likely Automated traffic (> 80): Enforce active mode (BLOCK or CHALLENGE)
  if (!autoProtect) {
    return {
      allowed: true,
      decision: "ALLOW",
      reason: "Auto-protect disabled in store settings. Checkout allowed.",
    };
  }

  if (activeMode === "BLOCK") {
    const decision = await ProtectionEngine.evaluateAndEnforceProtection(session, session.riskScore);

    return {
      allowed: false,
      decision: "BLOCK",
      reason: decision?.reason || "High-confidence automated threat blocked at checkout.",
      errors: [
        {
          localizedMessage: "Unable to process order. Security verification was not completed.",
          target: "checkout",
        },
      ],
    };
  }

  // Active CHALLENGE mode
  // Check if session has already completed CAPTCHA verification
  const verifiedAction = await prisma.protectionAction.findFirst({
    where: {
      sessionId: session.id,
      action: "CHALLENGE",
      status: "VERIFIED",
    },
  });

  if (verifiedAction) {
    return {
      allowed: true,
      decision: "ALLOW",
      reason: "Visitor passed CAPTCHA challenge in current session. Checkout permitted.",
    };
  }

  await ProtectionEngine.evaluateAndEnforceProtection(session, session.riskScore);

  return {
    allowed: false,
    decision: "CHALLENGE",
    reason: "Bot challenge token verification required before checkout completion.",
    errors: [
      {
        localizedMessage: "Please verify you are human to complete your order.",
        target: "checkout",
      },
    ],
  };
}
