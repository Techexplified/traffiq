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

    const { event, session } = await processIngestionEvent(
      {
        ...payload,
        eventId: payload.eventId || `evt_${Date.now()}`,
        eventType: payload.eventType || "page_viewed",
        userAgent: request.headers.get("user-agent") || "",
        clientIp: request.headers.get("x-forwarded-for") || "127.0.0.1",
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
