const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkEvents() {
  const events = await prisma.trafficEvent.findMany({
    where: {
      session: {
        shop: { shopDomain: 'fitlinetest.myshopify.com' }
      }
    },
    take: 10,
    orderBy: { timestamp: 'desc' },
    include: { session: true }
  });

  console.log(`Found ${events.length} events for fitlinetest:`);
  for (const e of events) {
    console.log(`Event: ${e.eventType} | SessionKey: ${e.session?.sessionKey} | IP/Country: ${e.session?.country} | Risk: ${e.session?.riskScore} | Flagged: ${e.session?.isFlagged}`);
    console.log(`  Page: ${e.pageUrl} | Meta: ${e.metadata}`);
  }
}

checkEvents().finally(() => prisma.$disconnect());
