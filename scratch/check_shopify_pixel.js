import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function checkPixel(shopDomain) {
  const session = await prisma.session.findFirst({
    where: { shop: shopDomain, isOnline: false }
  });
  if (!session) {
    console.log(`No offline session for ${shopDomain}`);
    return;
  }

  const query = `#graphql
    query getWebPixel {
      webPixel {
        id
        settings
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
      body: JSON.stringify({ query }),
    });

    const data = await res.json();
    console.log(`Web Pixel for ${shopDomain}:`, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`Error querying ${shopDomain}:`, err);
  }
}

async function main() {
  await checkPixel('cartmend.myshopify.com');
  await checkPixel('fitlinetest.myshopify.com');
}

main().finally(() => prisma.$disconnect());
