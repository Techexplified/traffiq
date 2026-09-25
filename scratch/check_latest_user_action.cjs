const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkLatest() {
  const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
  
  console.log("=== SESSIONS IN LAST 15 MINS ===");
  const sessions = await prisma.trafficSession.findMany({
    where: { lastSeenAt: { gte: fifteenMinsAgo } },
    orderBy: { lastSeenAt: 'desc' },
    include: { shop: true, events: { take: 5, orderBy: { timestamp: 'desc' } } }
  });
  console.log(`Found ${sessions.length} sessions in last 15 mins:`);
  for (const s of sessions) {
    console.log(`\nSESSION: ${s.id}`);
    console.log(`  Shop: ${s.shop.shopDomain} (${s.shopId})`);
    console.log(`  SessionKey: "${s.sessionKey}"`);
    console.log(`  RiskScore: ${s.riskScore} | Flagged: ${s.isFlagged} | Type: ${s.trafficType}`);
    console.log(`  FlaggedReason: ${s.flaggedReason}`);
    console.log(`  LastSeenAt: ${s.lastSeenAt.toISOString()}`);
    console.log(`  Events:`, s.events.map(e => `${e.id} [${e.eventType}] on ${e.pageUrl}`));
  }

  console.log("\n=== ALL RECENT EVENTS (LAST 10) ===");
  const events = await prisma.trafficEvent.findMany({
    take: 10,
    orderBy: { timestamp: 'desc' },
    include: { session: true }
  });
  for (const e of events) {
    console.log(`${e.timestamp.toISOString()} | ${e.eventType} | ID: ${e.id} | Session: ${e.sessionId} | Key: ${e.session?.sessionKey} | Page: ${e.pageUrl}`);
    console.log(`   Meta: ${e.metadata}`);
  }
}

checkLatest().finally(() => prisma.$disconnect());
