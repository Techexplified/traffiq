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
    const rawCandidates = url.searchParams.get("candidates") || "";
    const rawMetaY = url.searchParams.get("metaY");
    const rawMetaS = url.searchParams.get("metaS");

    const clientIp =
      request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "127.0.0.1";
    const anonKey = `anon_${clientIp.replace(/[^a-zA-Z0-9]/g, "_")}`;

    const rawList = [
      rawClientId,
      rawSessionKey,
      rawSessionId,
      rawMetaY,
      rawMetaS,
      ...rawCandidates.split(","),
      clientIp,
      anonKey,
    ];

    const keySet = new Set<string>();
    for (const item of rawList) {
      if (typeof item === "string" && item.trim().length > 0) {
        const clean = item.replace(/^["']+|["']+$/g, "").trim();
        if (clean) {
          keySet.add(clean);
          // If UUID with hyphens, also add version without hyphens
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean)) {
            keySet.add(clean.replace(/-/g, ""));
          } else if (/^[0-9a-f]{32}$/i.test(clean)) {
            // If 32-hex string without hyphens, also add hyphenated UUID version
            const formatted = `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`;
            keySet.add(formatted);
          }
        }
      }
    }

    const candidateKeys = Array.from(keySet);
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
          shopId: shop.id,
          action: "BLOCK",
          status: { in: ["EXECUTED", "ACTIVE"] },
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
          shopId: shop.id,
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
                { aiRecommendation: { contains: "manually blocked", mode: "insensitive" } },
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
      if (sessionKey) {
        const trafficSession = await prisma.trafficSession.findFirst({
          where: {
            shopId: shop.id,
            OR: [{ sessionKey }, { id: sessionKey }],
          },
          select: { riskScore: true, trafficType: true, severity: true },
        });
        if (trafficSession) {
          sessionRiskScore = trafficSession.riskScore;
          sessionTrafficType = trafficSession.trafficType;
          sessionSeverity = trafficSession.severity;
        }
      }
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

    const isTestOverride =
      url.searchParams.get("test_challenge") === "1" ||
      url.searchParams.get("simulate_high_severity") === "1";

    const challengeRequired =
      !isManuallyBlocked &&
      !isVerified &&
      (
        isTestOverride ||
        (protectionMode === "CHALLENGE" &&
          autoProtect &&
          (sessionRiskScore >= 50 ||
            sessionTrafficType === "BOT" ||
            sessionTrafficType === "SUSPICIOUS" ||
            sessionSeverity === "HIGH" ||
            sessionSeverity === "CRITICAL"))
      );

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
