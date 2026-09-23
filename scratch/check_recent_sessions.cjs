const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkRecent() {
  const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
  
  console.log("=== SESSIONS IN LAST 30 MINS ===");
  const sessions = await prisma.trafficSession.findMany({
    where: {
      lastSeenAt: { gte: thirtyMinsAgo }
    },
    orderBy: { lastSeenAt: 'desc' },
    include: { shop: true, events: { take: 3, orderBy: { timestamp: 'desc' } } }
  });
  console.log(`Found ${sessions.length} sessions:`);
  for (const s of sessions) {
    console.log(`\nSession ID: ${s.id}`);
    console.log(`  Shop: ${s.shop.shopDomain} (${s.shopId})`);
    console.log(`  SessionKey: "${s.sessionKey}"`);
    console.log(`  RiskScore: ${s.riskScore} | Flagged: ${s.isFlagged} | Type: ${s.trafficType}`);
    console.log(`  FlaggedReason: ${s.flaggedReason}`);
    console.log(`  AiRecommendation: ${s.aiRecommendation}`);
    console.log(`  LastSeenAt: ${s.lastSeenAt.toISOString()}`);
    console.log(`  Events (${s.events.length}):`, s.events.map(e => `${e.eventType} on ${e.pageUrl}`));
  }

  console.log("\n=== PROTECTION ACTIONS IN LAST 30 MINS ===");
  const actions = await prisma.protectionAction.findMany({
    where: {
      createdAt: { gte: thirtyMinsAgo }
    },
    orderBy: { createdAt: 'desc' },
    include: { shop: true, session: true }
  });
  console.log(`Found ${actions.length} actions:`);
  for (const a of actions) {
    console.log(`\nAction ID: ${a.id} | Action: ${a.action} | Status: ${a.status}`);
    console.log(`  Shop: ${a.shop.shopDomain}`);
    console.log(`  SessionId: ${a.sessionId} | Key: "${a.session?.sessionKey}"`);
    console.log(`  Reason: ${a.reason}`);
    console.log(`  Metadata: ${a.metadata}`);
    console.log(`  CreatedAt: ${a.createdAt.toISOString()}`);
  }
}

checkRecent().finally(() => prisma.$disconnect());
