import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { disconnectShop } from "../services/shop.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`[Webhook] Received ${topic} webhook for ${shop}`);

  try {
    // 1. Mark store as UNINSTALLED and create audit log
    await disconnectShop(shop);

    // 2. Clean up active shop sessions
    if (session) {
      await db.session.deleteMany({ where: { shop } });
    }
  } catch (error) {
    console.error(`[Webhook] Error processing app uninstalled for ${shop}:`, error);
  }

  return new Response();
};
