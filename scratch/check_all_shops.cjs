const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkShops() {
  const shops = await prisma.shop.findMany({
    include: {
      settings: true,
      sessions: { take: 5, orderBy: { lastSeenAt: 'desc' } },
      protectionActions: { take: 5, orderBy: { createdAt: 'desc' } },
    }
  });

  for (const s of shops) {
    console.log(`\n========================================`);
    console.log(`SHOP: ${s.shopDomain} (${s.id})`);
    console.log(`Protection Mode: ${s.settings?.protectionMode}`);
    console.log(`Sessions count in DB: ${await prisma.trafficSession.count({ where: { shopId: s.id } })}`);
    console.log(`Protection Actions count in DB: ${await prisma.protectionAction.count({ where: { shopId: s.id } })}`);
    for (const a of s.protectionActions) {
      console.log(` - Action: ${a.action} | Status: ${a.status} | Reason: ${a.reason} | SessionId: ${a.sessionId} | Metadata: ${a.metadata}`);
    }
    for (const sess of s.sessions) {
      console.log(` - Session: ${sess.id} | Key: ${sess.sessionKey} | Risk: ${sess.riskScore} | Flagged: ${sess.isFlagged} | Type: ${sess.trafficType} | LastSeen: ${sess.lastSeenAt}`);
    }
  }
}

checkShops().finally(() => prisma.$disconnect());
