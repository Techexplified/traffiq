import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`[Compliance Webhook] Received ${topic} for ${shop}:`, payload);

  try {
    const existingShop = await db.shop.findUnique({
      where: { shopDomain: shop },
    });

    if (existingShop) {
      // Purge store data upon Shopify's 48-hour post-uninstall redaction request
      await db.shop.delete({
        where: { id: existingShop.id },
      });
      console.log(`[Compliance Webhook] Successfully purged records for ${shop}`);
    }
  } catch (error) {
    console.error(`[Compliance Webhook] Error processing shop/redact for ${shop}:`, error);
  }

  return new Response(JSON.stringify({ message: "Shop data purged." }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
