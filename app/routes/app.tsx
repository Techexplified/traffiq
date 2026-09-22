import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { ensureShopConnected, fetchShopDataFromAdmin } from "../services/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  try {
    const shopData = await fetchShopDataFromAdmin(admin, session.shop);
    await ensureShopConnected(session.shop, shopData);

    // Ensure Web Pixel is connected on the store and synchronized with active appUrl
    try {
      const appUrl = (process.env.SHOPIFY_APP_URL || "https://traffiq-smoky.vercel.app").replace(/\/+$/, "");
      if (appUrl) {
        const queryRes = await admin.graphql(
          `#graphql
          query getWebPixel {
            webPixel {
              id
              settings
            }
          }`
        );
        const queryJson = await queryRes.json();
        const existingPixel = queryJson?.data?.webPixel;

        if (existingPixel?.id) {
          let currentSettings: any = {};
          try {
            currentSettings = JSON.parse(existingPixel.settings || "{}");
          } catch {}

          if (currentSettings.appUrl !== appUrl) {
            await admin.graphql(
              `#graphql
              mutation webPixelUpdate($id: ID!, $webPixel: WebPixelInput!) {
                webPixelUpdate(id: $id, webPixel: $webPixel) {
                  userErrors { field message }
                  webPixel { id settings }
                }
              }`,
              {
                variables: {
                  id: existingPixel.id,
                  webPixel: { settings: JSON.stringify({ appUrl }) },
                },
              }
            );
            console.log(`[WebPixel Sync] Updated Web Pixel on ${session.shop} to ${appUrl}`);
          }
        } else {
          await admin.graphql(
            `#graphql
            mutation webPixelCreate($webPixel: WebPixelInput!) {
              webPixelCreate(webPixel: $webPixel) {
                userErrors { field message }
                webPixel { id }
              }
            }`,
            {
              variables: {
                webPixel: { settings: JSON.stringify({ appUrl }) },
              },
            }
          );
          console.log(`[WebPixel Sync] Created Web Pixel on ${session.shop} with ${appUrl}`);
        }
      }
    } catch (pixelErr) {
      console.error("[WebPixel Sync] Error ensuring web pixel:", pixelErr);
    }
  } catch (err) {
    console.error("Failed to ensure shop record:", err);
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">Traffic Truth</Link>
        <Link to="/app/investigation">Traffic Investigation</Link>
        <Link to="/app/impact">Impact &amp; Sources</Link>
        <Link to="/app/alerts">Alerts (3)</Link>
        <Link to="/app/settings">Settings</Link>
      </NavMenu>

      <div className="tq-app-container">
        <main style={{ flex: 1 }}>
          <Outlet />
        </main>
      </div>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
