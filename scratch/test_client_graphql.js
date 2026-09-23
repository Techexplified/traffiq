import shopify from '../app/shopify.server.js';
import prisma from '../app/db.server.js';

async function main() {
  const session = await prisma.session.findFirst({
    where: { shop: 'fitlinetest.myshopify.com', isOnline: false }
  });
  
  const admin = shopify.api.clients.graphqlProxy ? null : new shopify.api.clients.Graphql({
    session: session,
  });

  try {
    const query = `#graphql
      query getWebPixel {
        webPixel {
          id
          settings
        }
      }
    `;
    console.log("Calling admin.graphql via shopify api client...");
    const client = new shopify.api.clients.Graphql({ session });
    const response = await client.request(query);
    console.log("Response:", JSON.stringify(response, null, 2));
  } catch (err) {
    console.log("Caught Error from Graphql client:", err.message, err.response?.errors);
  }
}

main().finally(() => prisma.$disconnect());
