import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { ensureShopConnected, fetchShopDataFromAdmin, ensureWebPixelSynchronized } from "./services/shop.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY || "traffiq_api_key",
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "traffiq_api_secret",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "https://traffiq.dev",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma as never),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    afterAuth: async ({ session, admin }) => {
      try {
        // Register app webhooks for this shop
        await shopify.registerWebhooks({ session });

        // Query shop info and sync database Shop record
        const shopData = await fetchShopDataFromAdmin(admin, session.shop);
        await ensureShopConnected(session.shop, shopData);

        // Auto-connect / synchronize Web Pixel extension
        const appUrl = (process.env.SHOPIFY_APP_URL || "https://traffiq-smoky.vercel.app").replace(/\/+$/, "");
        await ensureWebPixelSynchronized(admin, session.shop, appUrl);
      } catch (error) {
        console.error(`[afterAuth] Error initializing store for ${session.shop}:`, error);
      }
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
