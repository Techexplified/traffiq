const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testStatus() {
  const shop = await prisma.shop.findFirst({ where: { status: 'ACTIVE' } });
  const key = "30970b12-b76f-4ea5-a0e1-078d3f105236";

  const manualBlockAction = await prisma.protectionAction.findFirst({
    where: {
      action: "BLOCK",
      status: "EXECUTED",
      OR: [
        { session: { sessionKey: key } },
        { session: { id: key } },
        { sessionId: key },
        { metadata: { contains: key } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  console.log("Found manualBlockAction?", Boolean(manualBlockAction), manualBlockAction?.id);

  const flaggedSession = await prisma.trafficSession.findFirst({
    where: {
      isFlagged: true,
      OR: [
        { sessionKey: key },
        { id: key },
      ],
      AND: [
        {
          OR: [
            { flaggedReason: { contains: "blocked", mode: "insensitive" } },
            { flaggedReason: { contains: "manual", mode: "insensitive" } },
            { riskScore: { gte: 90 } },
            { severity: "CRITICAL" },
          ],
        },
      ],
    },
    orderBy: { lastSeenAt: "desc" },
  });
  console.log("Found flaggedSession?", Boolean(flaggedSession), flaggedSession?.id);
}

testStatus()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
