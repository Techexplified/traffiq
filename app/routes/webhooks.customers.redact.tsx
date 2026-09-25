import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`[Compliance Webhook] Received ${topic} for ${shop}:`, payload);

  // Traffiq does not collect or store personal customer data (names, emails, phones, addresses).
  return new Response(JSON.stringify({ message: "No customer PII to redact." }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
