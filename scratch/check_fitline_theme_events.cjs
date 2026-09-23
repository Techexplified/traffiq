const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkThemeEvents() {
  const events = await prisma.trafficEvent.findMany({
    where: {
      shop: { shopDomain: 'fitlinetest.myshopify.com' },
      id: { startsWith: 'tq_sf_' }
    },
    take: 10,
    orderBy: { timestamp: 'desc' }
  });
  console.log(`Found ${events.length} tq_sf_ events for fitlinetest:`);
  for (const e of events) {
    console.log(e.id, e.eventType, e.timestamp);
  }
}

checkThemeEvents().finally(() => prisma.$disconnect());
