import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const session = await prisma.session.findFirst({
    where: { shop: 'fitlinetest.myshopify.com', isOnline: false }
  });
  
  // Let's test what query getWebPixel returns
  const query = `#graphql
    query getWebPixel {
      webPixel {
        id
        settings
      }
    }
  `;

  const res = await fetch(`https://fitlinetest.myshopify.com/admin/api/2026-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': session.accessToken,
    },
    body: JSON.stringify({ query }),
  });

  const json = await res.json();
  console.log("Status:", res.status);
  console.log("JSON:", JSON.stringify(json, null, 2));
}

main().finally(() => prisma.$disconnect());
