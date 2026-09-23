const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const shop = await prisma.shop.findFirst({
    where: { status: 'ACTIVE' },
    include: { settings: true }
  });
  console.log('SHOP:', shop?.shopDomain, 'ID:', shop?.id);
  console.log('SETTINGS:', shop?.settings);

  const actions = await prisma.protectionAction.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' },
    include: { session: true }
  });
  console.log('\n--- RECENT PROTECTION ACTIONS (' + actions.length + ') ---');
  for (const a of actions) {
    console.log(`Action: ${a.action} | Status: ${a.status} | SessionID: ${a.sessionId} | Reason: ${a.reason}`);
    console.log(`  Metadata: ${a.metadata}`);
    console.log(`  SessionKey: ${a.session?.sessionKey} | TrafficType: ${a.session?.trafficType} | Flagged: ${a.session?.isFlagged} | Risk: ${a.session?.riskScore}`);
  }

  const sessions = await prisma.trafficSession.findMany({
    take: 10,
    orderBy: { lastSeenAt: 'desc' }
  });
  console.log('\n--- RECENT SESSIONS (' + sessions.length + ') ---');
  for (const s of sessions) {
    console.log(`ID: ${s.id} | Key: ${s.sessionKey} | IP/Country: ${s.country} | Flagged: ${s.isFlagged} | Type: ${s.trafficType} | Risk: ${s.riskScore} | LastSeen: ${s.lastSeenAt}`);
  }
}

check()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
