import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const shops = await prisma.shop.findMany({
    select: { id: true, shopDomain: true, status: true, installedAt: true }
  });
  console.log("SHOPS in DB:", JSON.stringify(shops, null, 2));

  const totalEvents = await prisma.trafficEvent.count();
  console.log("Total TrafficEvents:", totalEvents);

  const recentEvents = await prisma.trafficEvent.findMany({
    take: 10,
    orderBy: { timestamp: 'desc' },
    select: {
      id: true,
      shopId: true,
      eventType: true,
      timestamp: true,
      pageUrl: true,
      productId: true,
      sessionId: true,
    }
  });
  console.log("Recent Events:", JSON.stringify(recentEvents, null, 2));

  const totalSessions = await prisma.trafficSession.count();
  console.log("Total TrafficSessions:", totalSessions);

  const recentSessions = await prisma.trafficSession.findMany({
    take: 10,
    orderBy: { startedAt: 'desc' },
    select: {
      id: true,
      shopId: true,
      sessionKey: true,
      startedAt: true,
      lastSeenAt: true,
      pageViews: true,
      addToCartCount: true,
      trafficType: true,
      riskScore: true,
      isDemo: true,
    }
  });
  console.log("Recent Sessions:", JSON.stringify(recentSessions, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
