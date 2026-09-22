import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { validateCheckoutSession } from "../services/shopifyEnforcement.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  return new Response(
    JSON.stringify({
      status: "Traffiq Checkout Validation Extension API Ready",
      target: "shopify_function_checkout_validation",
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
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
    const body = await request.json().catch(() => ({}));
    const clientIp =
      request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "127.0.0.1";

    const shopDomain = body.shopDomain || new URL(request.url).searchParams.get("shop");
    const shop = shopDomain
      ? await prisma.shop.findFirst({ where: { shopDomain: { contains: shopDomain.split(".")[0] } } })
      : await prisma.shop.findFirst({ where: { status: "ACTIVE" } });

    if (!shop) {
      return new Response(JSON.stringify({ allowed: true, reason: "Store not registered" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validationResult = await validateCheckoutSession({
      shopId: shop.id,
      cartId: body.cartId,
      token: body.token || body.sessionId,
      clientId: body.clientId,
      clientIp,
      userAgent: request.headers.get("user-agent") || undefined,
      totalAmount: body.totalAmount,
    });

    return new Response(JSON.stringify(validationResult), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Checkout validation error:", err);
    // Fail safe: never break checkout unexpectedly
    return new Response(
      JSON.stringify({ allowed: true, reason: "Fail-safe: Checkout allowed on validation error" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};
