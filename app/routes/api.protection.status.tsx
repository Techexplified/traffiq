import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(request.url);
    const shopQuery = url.searchParams.get("shop");
    const rawClientId = url.searchParams.get("clientId");
    const rawSessionKey = url.searchParams.get("sessionKey");
    const rawSessionId = url.searchParams.get("sessionId");

    const candidateKeys = [rawClientId, rawSessionKey, rawSessionId]
      .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
      .map((k) => k.replace(/^["']+|["']+$/g, "").trim());

    const sessionKey = candidateKeys[0] || null;

    // Resolve shop domain
    let candidateDomain = shopQuery;
    if (!candidateDomain) {
      const referer = request.headers.get("referer");
      if (referer) {
        try {
          candidateDomain = new URL(referer).hostname;
        } catch {
          // Ignored
        }
      }
    }

    const cleanDomain = (candidateDomain || "")
      .replace(/^https?:\/\//, "")
      .split("/")[0]
      .split(":")[0]
      .toLowerCase();

    let shop = cleanDomain
      ? await prisma.shop.findFirst({
          where: {
            OR: [
              { shopDomain: cleanDomain },
              { shopDomain: `${cleanDomain}.myshopify.com` },
              { shopDomain: { startsWith: cleanDomain.split(".")[0] } },
            ],
            status: "ACTIVE",
          },
          include: { settings: true },
        })
      : null;

    if (!shop) {
      shop = await prisma.shop.findFirst({
        where: { status: "ACTIVE" },
        include: { settings: true },
      });
    }

    if (!shop) {
      return new Response(
        JSON.stringify({
          error: "Store not registered",
          protectionMode: "MONITOR",
          challengeRequired: false,
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const protectionMode = shop.settings?.protectionMode || "MONITOR";
    const autoProtect = shop.settings?.autoProtect ?? true;

    // Check if current session is already verified
    let isVerified = false;
    if (candidateKeys.length > 0) {
      const verifiedAction = await prisma.protectionAction.findFirst({
        where: {
          shopId: shop.id,
          action: "CHALLENGE",
          status: "VERIFIED",
          session: {
            sessionKey: { in: candidateKeys },
          },
        },
      });
      if (verifiedAction) {
        isVerified = true;
      }
    }

    // Check if current session is manually blocked by merchant in Traffic Investigation
    let isManuallyBlocked = false;
    let manualBlockReason = "";
    if (candidateKeys.length > 0) {
      const manualBlockAction = await prisma.protectionAction.findFirst({
        where: {
          action: "BLOCK",
          status: "EXECUTED",
          OR: candidateKeys.flatMap((k) => [
            { session: { sessionKey: k } },
            { session: { id: k } },
            { sessionId: k },
            { metadata: { contains: k } },
          ]),
        },
        orderBy: { createdAt: "desc" },
      });

      const flaggedSession = await prisma.trafficSession.findFirst({
        where: {
          isFlagged: true,
          OR: candidateKeys.flatMap((k) => [
            { sessionKey: k },
            { id: k },
          ]),
          AND: [
            {
              OR: [
                { flaggedReason: { contains: "blocked", mode: "insensitive" } },
                { flaggedReason: { contains: "manual", mode: "insensitive" } },
                { riskScore: { gte: 90 } },
                { severity: "CRITICAL" },
              ],
            },
          ],
        },
        orderBy: { lastSeenAt: "desc" },
      });

      if (manualBlockAction || flaggedSession) {
        isManuallyBlocked = true;
        manualBlockReason =
          manualBlockAction?.reason ||
          flaggedSession?.flaggedReason ||
          "Session manually blocked by merchant via Traffic Investigation";
      }
    }

    // Determine whether this session is HIGH SEVERITY / THREAT
    let isHighSeveritySession = false;
    let severityReason = "Normal traffic (safe shopper)";
    let sessionRiskScore = 0;
    let sessionTrafficType = "HUMAN";
    let sessionSeverity = "LOW";

    // 1. Manual block priority
    if (isManuallyBlocked) {
      isHighSeveritySession = true;
      severityReason = manualBlockReason;
      sessionRiskScore = 99;
      sessionTrafficType = "BOT";
      sessionSeverity = "HIGH";
    } else {
      // 2. Manual test override (?test_challenge=1 or ?simulate_high_severity=1)
      const isTestOverride =
        url.searchParams.get("test_challenge") === "1" ||
        url.searchParams.get("simulate_high_severity") === "1";

      if (isTestOverride) {
        isHighSeveritySession = true;
        severityReason = "Simulated high severity alert session (test mode)";
        sessionRiskScore = 95;
        sessionTrafficType = "BOT";
        sessionSeverity = "HIGH";
      } else if (sessionKey) {
        // 3. Query the active TrafficSession in DB
        const trafficSession = await prisma.trafficSession.findFirst({
          where: {
            shopId: shop.id,
            OR: [
              { sessionKey },
              { id: sessionKey },
            ],
          },
          orderBy: { lastSeenAt: "desc" },
          include: { detectionResult: true },
        });

        if (trafficSession) {
          sessionRiskScore = trafficSession.riskScore;
          sessionTrafficType = trafficSession.trafficType;
          sessionSeverity = trafficSession.severity;

          const isHighOrCritical =
            trafficSession.severity === "HIGH" ||
            trafficSession.severity === "CRITICAL" ||
            trafficSession.detectionResult?.severity === "HIGH" ||
            trafficSession.detectionResult?.severity === "CRITICAL";

          const isHighRiskScore = trafficSession.riskScore >= 60;
          const isBotOrHighRiskType =
            trafficSession.trafficType === "BOT" ||
            trafficSession.trafficType === "HIGH_RISK";

          const isRecommendedChallengeOrBlock =
            trafficSession.detectionResult?.recommendedAction === "CHALLENGE" ||
            trafficSession.detectionResult?.recommendedAction === "BLOCK";

          if (isHighOrCritical || isHighRiskScore || isBotOrHighRiskType || isRecommendedChallengeOrBlock) {
            isHighSeveritySession = true;
            severityReason = `Session flagged as High Severity Threat (${trafficSession.trafficType}, risk: ${trafficSession.riskScore}, severity: ${trafficSession.severity})`;
          }
        }
      }

      // 4. User-Agent Bot / Automation Signature Check
      const userAgent = request.headers.get("user-agent") || "";
      if (!isHighSeveritySession && /bot|crawl|spider|headless|puppeteer|playwright|selenium/i.test(userAgent)) {
        isHighSeveritySession = true;
        severityReason = "Automated bot / scraper user-agent detected";
        sessionRiskScore = Math.max(sessionRiskScore, 92);
        sessionTrafficType = "BOT";
        sessionSeverity = "HIGH";
      }
    }

    // Protection Decisions:
    // 1. Manually blocked sessions are always directly blocked
    // 2. In BLOCK mode: automated bot threats (risk score > 80 or bot type) are directly blocked.
    //    Traffic with risk score <= 80 is not blocked.
    // 3. In CHALLENGE mode: suspicious/threat traffic (risk score >= 60) requires challenge if not verified.
    const isAutomatedBotThreat =
      sessionRiskScore > 80 ||
      sessionTrafficType === "BOT" ||
      sessionSeverity === "CRITICAL";

    const blockRequired =
      isManuallyBlocked ||
      (protectionMode === "BLOCK" && autoProtect && isAutomatedBotThreat);

    const challengeRequired =
      !isManuallyBlocked &&
      protectionMode === "CHALLENGE" &&
      autoProtect &&
      !isVerified &&
      (sessionRiskScore >= 60 || sessionTrafficType === "BOT" || sessionSeverity === "HIGH" || sessionSeverity === "CRITICAL");

    return new Response(
      JSON.stringify({
        success: true,
        shopDomain: shop.shopDomain,
        protectionMode,
        challengeRequired,
        blockRequired,
        isVerified,
        isManuallyBlocked,
        isHighSeverity: isHighSeveritySession,
        severity: sessionSeverity,
        riskScore: sessionRiskScore,
        trafficType: sessionTrafficType,
        reason: severityReason,
        challengeType: "interactive_captcha",
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (err) {
    console.error("[ProtectionStatus] Error checking status:", err);
    return new Response(
      JSON.stringify({
        error: "Failed to check protection status",
        protectionMode: "MONITOR",
        challengeRequired: false,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
};
