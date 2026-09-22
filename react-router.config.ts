import type { Config } from "@react-router/dev/config";

export default {
  // Allow Shopify Admin iframe and cloudflare tunnel origins for action requests
  allowedActionOrigins: [
    "admin.shopify.com",
    "*.myshopify.com",
    "**.myshopify.com",
    "*.shopify.com",
    "**.shopify.com",
    "*.spin.dev",
    "*.trycloudflare.com",
    "localhost:*",
    "127.0.0.1:*",
  ],
} satisfies Config;
