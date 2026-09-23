import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const appUrl = "https://traffiq-smoky.vercel.app";

async function ensurePixelForShop(shopDomain) {
  const session = await prisma.session.findFirst({
    where: { shop: shopDomain, isOnline: false },
    orderBy: { expires: 'desc' }
  });

  if (!session) {
    console.log(`No offline session found for ${shopDomain}`);
    return;
  }

  console.log(`Ensuring Web Pixel on ${shopDomain}...`);

  // 1. Query existing
  const query = `#graphql
    query getWebPixel {
      webPixel {
        id
        settings
      }
    }
  `;

  let existingId = null;
  let currentSettings = {};

  try {
    const res = await fetch(`https://${shopDomain}/admin/api/2026-10/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': session.accessToken,
      },
      body: JSON.stringify({ query }),
    });

    const json = await res.json();
    if (json?.data?.webPixel?.id) {
      existingId = json.data.webPixel.id;
      try {
        currentSettings = JSON.parse(json.data.webPixel.settings || "{}");
      } catch {}
    }
  } catch (err) {
    console.warn(`Query webPixel error on ${shopDomain}:`, err.message);
  }

  if (existingId) {
    console.log(`Existing pixel found: ${existingId} (appUrl: ${currentSettings.appUrl})`);
    if (currentSettings.appUrl !== appUrl) {
      const updateMutation = `#graphql
        mutation webPixelUpdate($id: ID!, $webPixel: WebPixelInput!) {
          webPixelUpdate(id: $id, webPixel: $webPixel) {
            userErrors { field message }
            webPixel { id settings }
          }
        }
      `;
      const upRes = await fetch(`https://${shopDomain}/admin/api/2026-10/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': session.accessToken,
        },
        body: JSON.stringify({
          query: updateMutation,
          variables: { id: existingId, webPixel: { settings: JSON.stringify({ appUrl }) } },
        }),
      });
      const upJson = await upRes.json();
      console.log(`Updated pixel on ${shopDomain}:`, JSON.stringify(upJson));
    }
  } else {
    console.log(`Creating web pixel on ${shopDomain} with ${appUrl}...`);
    const createMutation = `#graphql
      mutation webPixelCreate($webPixel: WebPixelInput!) {
        webPixelCreate(webPixel: $webPixel) {
          userErrors { field message }
          webPixel { id settings }
        }
      }
    `;
    const crRes = await fetch(`https://${shopDomain}/admin/api/2026-10/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': session.accessToken,
      },
      body: JSON.stringify({
        query: createMutation,
        variables: { webPixel: { settings: JSON.stringify({ appUrl }) } },
      }),
    });
    const crJson = await crRes.json();
    console.log(`Created pixel on ${shopDomain}:`, JSON.stringify(crJson));
  }
}

async function main() {
  const shops = await prisma.shop.findMany({ where: { status: 'ACTIVE' } });
  for (const shop of shops) {
    await ensurePixelForShop(shop.shopDomain);
  }
}

main().finally(() => prisma.$disconnect());
