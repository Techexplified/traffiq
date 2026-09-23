import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const session = await prisma.session.findFirst({
    where: { shop: 'fitlinetest.myshopify.com', isOnline: false }
  });
  
  // Delete the pixel to see what happens
  const deleteMutation = `#graphql
    mutation webPixelDelete($id: ID!) {
      webPixelDelete(id: $id) {
        userErrors { field message }
      }
    }
  `;

  await fetch(`https://fitlinetest.myshopify.com/admin/api/2026-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': session.accessToken,
    },
    body: JSON.stringify({ query: deleteMutation, variables: { id: "gid://shopify/WebPixel/2844754085" } }),
  });

  // Now query
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
  console.log("Delete & Query response:", JSON.stringify(json, null, 2));
}

main().finally(() => prisma.$disconnect());
