import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const VERCEL_URL = "https://traffiq-smoky.vercel.app";

async function verifyPixels() {
  console.log("=== 1. VERIFYING WEB PIXELS ON ALL SHOPS ===");
  const shops = ["cartmend.myshopify.com", "fitlinetest.myshopify.com"];

  for (const shop of shops) {
    const session = await prisma.session.findFirst({
      where: { shop, isOnline: false },
      orderBy: { expires: 'desc' }
    });

    if (!session) {
      console.log(`❌ No session for ${shop}`);
      continue;
    }

    const query = `#graphql
      query getWebPixel {
        webPixel {
          id
          settings
        }
      }
    `;

    const res = await fetch(`https://${shop}/admin/api/2026-10/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': session.accessToken,
      },
      body: JSON.stringify({ query }),
    });

    const json = await res.json();
    const pixel = json?.data?.webPixel;
    if (pixel?.id) {
      console.log(`✓ ${shop} has ACTIVE Web Pixel: ${pixel.id} -> ${pixel.settings}`);
    } else {
      console.log(`❌ ${shop} has NO Web Pixel:`, JSON.stringify(json?.errors || json));
    }
  }
}

async function simulateStorefrontActivity(shopDomain) {
  console.log(`\n=== 2. SIMULATING STOREFRONT ACTIVITY FOR ${shopDomain} ===`);
  const clientId = "client_sim_" + Date.now();

  // A. Page View
  const pagePayload = {
    eventId: "tq_sf_" + Date.now() + "_pv",
    eventType: "page_viewed",
    timestamp: new Date().toISOString(),
    clientId,
    sessionId: "sess_sim_123",
    shopDomain,
    page: `https://${shopDomain}/products/classic-tee`,
    referrer: "https://google.com",
    metadata: {
      source: "traffiq_theme_embed",
    },
  };

  const pvRes = await fetch(`${VERCEL_URL}/api/events?shop=${encodeURIComponent(shopDomain)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pagePayload),
  });
  const pvJson = await pvRes.json();
  console.log(`Page View Ingestion Result (${pvRes.status}):`, JSON.stringify(pvJson));

  // Small delay to simulate human dwell time before add to cart
  await new Promise(r => setTimeout(r, 600));

  // B. Product Added To Cart
  const cartPayload = {
    eventId: "tq_sf_" + Date.now() + "_atc",
    eventType: "product_added_to_cart",
    timestamp: new Date().toISOString(),
    clientId,
    sessionId: "sess_sim_123",
    shopDomain,
    page: `https://${shopDomain}/products/classic-tee`,
    productId: "9988776655",
    variantId: "4433221100",
    quantity: 1,
    metadata: {
      source: "traffiq_theme_embed",
      productId: "9988776655",
      variantId: "4433221100",
      quantity: 1,
    },
  };

  const atcRes = await fetch(`${VERCEL_URL}/api/events?shop=${encodeURIComponent(shopDomain)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cartPayload),
  });
  const atcJson = await atcRes.json();
  console.log(`Add To Cart Ingestion Result (${atcRes.status}):`, JSON.stringify(atcJson));

  return clientId;
}

async function verifyInDb(shopDomain, clientId) {
  console.log(`\n=== 3. VERIFYING DATABASE RECORDS FOR ${shopDomain} ===`);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  });

  const session = await prisma.trafficSession.findFirst({
    where: {
      shopId: shop.id,
      sessionKey: clientId,
    },
    include: {
      events: true,
    }
  });

  if (session) {
    console.log(`✓ Session Found: ID=${session.id}, trafficType=${session.trafficType}, riskScore=${session.riskScore}`);
    console.log(`✓ Page Views: ${session.pageViews}, Add To Cart Count: ${session.addToCartCount}`);
    console.log(`✓ Captured Events (${session.events.length}):`, session.events.map(e => e.eventType));
  } else {
    console.log(`❌ Session not found for clientId ${clientId}`);
  }
}

async function main() {
  await verifyPixels();
  const clientId = await simulateStorefrontActivity("fitlinetest.myshopify.com");
  await verifyInDb("fitlinetest.myshopify.com", clientId);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
