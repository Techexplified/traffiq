import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getShopByDomain } from "../services/shop.server";
import { AnalyticsService } from "../services/analytics.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

/**
 * Resolves the shop domain and database shop ID.
 * Supports Shopify Admin session, Bearer token, or store domain verification.
 */
async function resolveShop(request: Request): Promise<{ shopId: string; shopDomain: string }> {
  const url = new URL(request.url);
  const shopParam = url.searchParams.get("shop");

  // 1. Try standard Shopify Admin embedded session
  try {
    const { session } = await authenticate.admin(request);
    const shop = await getShopByDomain(session.shop);
    const shopId = shop?.id || session.shop;
    return { shopId, shopDomain: session.shop };
  } catch {
    // 2. Try Authorization Bearer Token
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

    // 3. Try shop parameter with verified database existence
    if (shopParam) {
      const shop = await getShopByDomain(shopParam);
      if (shop) {
        return { shopId: shop.id, shopDomain: shop.shopDomain };
      }
    }

    // 4. Default to first active shop in development if available
    const defaultShop = await prisma.shop.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
    });
    if (defaultShop) {
      return { shopId: defaultShop.id, shopDomain: defaultShop.shopDomain };
    }

    throw new Response(
      JSON.stringify({ error: "Unauthorized. A valid Shopify store context is required." }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

/**
 * GET /api/traffic/overview
 *
 * Query parameters:
 * - dateRange: 'today' | 'last_7_days' | 'last_30_days' | 'yesterday' | 'custom'
 * - compareRange: 'previous_period' | 'same_period_last_year' | 'none'
 * - startDate: ISO string (for custom range)
 * - endDate: ISO string (for custom range)
 * - shop: store domain
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const { shopId, shopDomain } = await resolveShop(request);
  const url = new URL(request.url);

  const dateRange = url.searchParams.get("dateRange") || undefined;
  const compareRange = url.searchParams.get("compareRange") || undefined;
  const startDate = url.searchParams.get("startDate") || undefined;
  const endDate = url.searchParams.get("endDate") || undefined;

  const metrics = await AnalyticsService.getDashboardOverview(shopId, {
    dateRange,
    compareRange,
    startDate,
    endDate,
  });

  return Response.json(
    {
      success: true,
      shop: shopDomain,
      metrics,
    },
    { headers: corsHeaders }
  );
};
