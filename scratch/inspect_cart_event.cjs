const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function inspectEvent() {
  const event = await prisma.trafficEvent.findFirst({
    where: {
      eventType: 'product_added_to_cart',
      sessionId: 'cmuebhcik0019l304e7u4nhgl'
    },
    orderBy: { timestamp: 'desc' }
  });
  console.log("Event details:", JSON.stringify(event, null, 2));
}

inspectEvent().finally(() => prisma.$disconnect());
