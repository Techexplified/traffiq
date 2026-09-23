import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const fitlineShop = await prisma.shop.findUnique({
    where: { shopDomain: "fitlinetest.myshopify.com" },
    include: {
      settings: true,
      sessions: { take: 5, orderBy: { startedAt: 'desc' } },
      events: { take: 5, orderBy: { timestamp: 'desc' } },
    }
  });
  console.log("FITLINE SHOP:", JSON.stringify(fitlineShop, null, 2));

  const allActiveShops = await prisma.shop.findMany({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: 'asc' }
  });
  console.log("FIRST ACTIVE SHOP (default in loader):", allActiveShops[0]?.shopDomain, allActiveShops[0]?.id);
}

main().finally(() => prisma.$disconnect());
