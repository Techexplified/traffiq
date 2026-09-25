import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`[Compliance Webhook] Received ${topic} for ${shop}:`, payload);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
    case "customers/data_request": {
      // Traffiq does not store customer personal data.
      return new Response(JSON.stringify({ message: "No customer PII stored." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "CUSTOMERS_REDACT":
    case "customers/redact": {
      // Traffiq does not store customer personal data to redact.
      return new Response(JSON.stringify({ message: "No customer PII to redact." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "SHOP_REDACT":
    case "shop/redact": {
      try {
        const existingShop = await db.shop.findUnique({
          where: { shopDomain: shop },
        });

        if (existingShop) {
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
    }

    default:
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
  }
};
