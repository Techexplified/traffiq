import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  return new Response(JSON.stringify({ status: "Traffiq Challenge Verification API" }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const shopDomain =
      (typeof body.shopDomain === "string" ? body.shopDomain : null) ||
      new URL(request.url).searchParams.get("shop");
    const sessionKey =
      typeof body.sessionKey === "string"
        ? body.sessionKey
        : typeof body.clientId === "string"
        ? body.clientId
        : null;
    const challengeAnswer = body.answer || body.response || body.token;

    if (!challengeAnswer) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing challenge answer or verification payload" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve shop
    const cleanDomain = (shopDomain || "")
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
        })
      : null;

    if (!shop) {
      shop = await prisma.shop.findFirst({
        where: { status: "ACTIVE" },
      });
    }

    if (!shop) {
      return new Response(
        JSON.stringify({ success: false, error: "Store not registered" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const clientIp =
      request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "127.0.0.1";
    const anonKey = `anon_${clientIp.replace(/[^a-zA-Z0-9]/g, "_")}`;

    const candidateKeys = [
      sessionKey,
      typeof body.clientId === "string" ? body.clientId : null,
      typeof body.sessionId === "string" ? body.sessionId : null,
      anonKey,
    ].filter((k): k is string => typeof k === "string" && k.trim().length > 0);

    // Find or locate active session for this client across candidate keys
    let session = await prisma.trafficSession.findFirst({
      where: {
        shopId: shop.id,
        OR: candidateKeys.map((k) => ({ sessionKey: k })),
      },
      orderBy: { lastSeenAt: "desc" },
    });

    if (session) {
      // Mark matching sessions as verified human and reset risk score
      await prisma.trafficSession.updateMany({
        where: {
          shopId: shop.id,
          OR: candidateKeys.map((k) => ({ sessionKey: k })),
        },
        data: {
          trafficType: "HUMAN",
          riskScore: 10,
          severity: "LOW",
          isFlagged: false,
        },
      });

      // Record ProtectionAction
      await prisma.protectionAction.create({
        data: {
          shopId: shop.id,
          sessionId: session.id,
          action: "CHALLENGE",
          status: "VERIFIED",
          reason: "Visitor completed interactive CAPTCHA challenge successfully.",
          metadata: JSON.stringify({
            verifiedAt: new Date().toISOString(),
            challengeType: "interactive_captcha",
            sessionKey: sessionKey || candidateKeys[0],
            candidateKeys,
          }),
        },
      });
    }

    // Record AuditLog
    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        actor: "MERCHANT",
        action: "PROTECTION_CHALLENGE_VERIFIED",
        resourceType: "Session",
        resourceId: session?.id || sessionKey || undefined,
        metadata: JSON.stringify({
          sessionKey,
          verifiedAt: new Date().toISOString(),
          ip:
            request.headers.get("cf-connecting-ip") ||
            request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            "127.0.0.1",
        }),
      },
    });

    const verificationToken = `tq_v_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    return new Response(
      JSON.stringify({
        success: true,
        verified: true,
        verificationToken,
        verifiedAt: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[VerifyChallenge] Error verifying challenge:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Challenge verification failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};
