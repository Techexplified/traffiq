import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { ensureShopConnected, fetchShopDataFromAdmin, ensureWebPixelSynchronized } from "../services/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  try {
    const shopData = await fetchShopDataFromAdmin(admin, session.shop);
    await ensureShopConnected(session.shop, shopData);

    // Ensure Web Pixel is connected on the store and synchronized with active appUrl
    const appUrl = (process.env.SHOPIFY_APP_URL || "https://traffiq-smoky.vercel.app").replace(/\/+$/, "");
    await ensureWebPixelSynchronized(admin, session.shop, appUrl);
  } catch (err) {
    console.error("Failed to ensure shop record or web pixel:", err);
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
