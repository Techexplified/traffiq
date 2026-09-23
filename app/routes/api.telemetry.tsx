import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { processIngestionEvent, type IngestionEventPayload } from "../services/sessionAggregator.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  return new Response(JSON.stringify({ status: "Traffiq Telemetry Endpoint Active" }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload = (await request.json()) as Partial<IngestionEventPayload>;

    let shop = payload.shopDomain
      ? await prisma.shop.findUnique({ where: { shopDomain: payload.shopDomain } })
      : null;

    if (!shop) {
      shop = await prisma.shop.findFirst({ where: { status: "ACTIVE" } });
    }

    if (!shop) {
      return new Response(JSON.stringify({ error: "No active store found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const headerCountry =
      request.headers.get("x-vercel-ip-country") ||
      request.headers.get("cf-ipcountry") ||
      request.headers.get("x-country-code") ||
      request.headers.get("cloudfront-viewer-country");
    const headerRegion = request.headers.get("x-vercel-ip-country-region") || undefined;
    const headerCity = request.headers.get("x-vercel-ip-city") || undefined;
    const headerTimezone = request.headers.get("x-vercel-ip-timezone") || undefined;

    const rawCountry = typeof payload.country === "string" ? payload.country : headerCountry || undefined;
    const rawTimezone =
      (typeof payload.timezone === "string" ? payload.timezone : undefined) ||
      (typeof (payload.metadata as any)?.timezone === "string" ? (payload.metadata as any).timezone : undefined) ||
      headerTimezone;
    const rawLocale =
      (typeof (payload.metadata as any)?.locale === "string" ? (payload.metadata as any).locale : undefined) ||
      (typeof (payload.metadata as any)?.language === "string" ? (payload.metadata as any).language : undefined) ||
      request.headers.get("accept-language") ||
      undefined;

    const { event, session } = await processIngestionEvent(
      {
        ...payload,
        eventId: payload.eventId || `evt_${Date.now()}`,
        eventType: payload.eventType || "page_viewed",
        userAgent: request.headers.get("user-agent") || "",
        clientIp: request.headers.get("x-forwarded-for") || "127.0.0.1",
        country: rawCountry,
        city: typeof payload.city === "string" ? payload.city : headerCity,
        region: typeof payload.region === "string" ? payload.region : headerRegion,
        timezone: rawTimezone,
        locale: rawLocale,
      },
      shop.id
    );

    return new Response(
      JSON.stringify({
        success: true,
        sessionId: session.id,
        eventId: event.id,
        riskScore: session.riskScore,
        trafficType: session.trafficType,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "Failed to process telemetry",
        details: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
};
