import shopify from '../app/shopify.server';
import prisma from '../app/db.server';

async function main() {
  const session = await prisma.session.findFirst({
    where: { shop: 'fitlinetest.myshopify.com', isOnline: false }
  });
  
  if (!session) {
    console.log("No session found");
    return;
  }

  try {
    const query = `#graphql
      query getWebPixel {
        webPixel {
          id
          settings
        }
      }
    `;
    console.log("Calling Graphql query...");
    const client = new shopify.api.clients.Graphql({ session });
    const response = await client.request(query);
    console.log("Response:", JSON.stringify(response, null, 2));
  } catch (err: any) {
    console.log("Caught Error from Graphql client:", err.message);
    console.log("Response errors:", JSON.stringify(err.response?.errors));
  }
}

main().finally(() => prisma.$disconnect());
