import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function testPixelCreate(shopDomain) {
  const session = await prisma.session.findFirst({
    where: { shop: shopDomain, isOnline: false }
  });
  if (!session) {
    console.log(`No offline session for ${shopDomain}`);
    return;
  }

  const appUrl = "https://traffiq-smoky.vercel.app";
  const mutation = `#graphql
    mutation webPixelCreate($webPixel: WebPixelInput!) {
      webPixelCreate(webPixel: $webPixel) {
        userErrors {
          field
          message
          code
        }
        webPixel {
          id
          settings
        }
      }
    }
  `;

  try {
    const res = await fetch(`https://${shopDomain}/admin/api/2026-10/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': session.accessToken,
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          webPixel: { settings: JSON.stringify({ appUrl }) },
        },
      }),
    });

    const data = await res.json();
    console.log(`webPixelCreate for ${shopDomain}:`, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`Error creating pixel for ${shopDomain}:`, err);
  }
}

async function main() {
  await testPixelCreate('fitlinetest.myshopify.com');
}

main().finally(() => prisma.$disconnect());
