const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixBlockedSession() {
  const sessionRecord = await prisma.trafficSession.findUnique({
    where: { id: "cmue990r9000pii0431jjefyj" },
    include: { shop: true }
  });

  if (!sessionRecord) {
    console.log("Session not found");
    return;
  }

  console.log("Found session:", sessionRecord.id, "for shop:", sessionRecord.shop.shopDomain);

  // 1. Create ProtectionAction
  const action = await prisma.protectionAction.create({
    data: {
      shopId: sessionRecord.shopId,
      sessionId: sessionRecord.id,
      action: "BLOCK",
      status: "EXECUTED",
      reason: "Manually blocked by merchant via Traffic Investigation",
      metadata: JSON.stringify({
        manual: true,
        sessionKey: sessionRecord.sessionKey,
        timestamp: new Date().toISOString(),
      }),
    }
  });
  console.log("Created ProtectionAction:", action.id);

  // 2. Update all sessions with that sessionKey
  const updateRes = await prisma.trafficSession.updateMany({
    where: {
      OR: [
        { id: sessionRecord.id },
        { sessionKey: sessionRecord.sessionKey },
      ]
    },
    data: {
      isFlagged: true,
      flaggedReason: "Manually blocked by merchant",
      aiRecommendation: "Session manually blocked by merchant. Block active on storefront and checkout.",
      riskScore: 99,
      severity: "CRITICAL",
      trafficType: "BOT",
    }
  });
  console.log(`Updated ${updateRes.count} session(s) to BLOCKED (BOT, 99 risk)`);
}

fixBlockedSession()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
