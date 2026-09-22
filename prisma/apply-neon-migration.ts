import { Client } from "pg";

const ddl = `
-- CreateTable
CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Shop" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopifyShopId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ShopSettings" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "protectionMode" TEXT NOT NULL DEFAULT 'MONITOR',
    "autoProtect" BOOLEAN NOT NULL DEFAULT true,
    "emailAlerts" BOOLEAN NOT NULL DEFAULT true,
    "alertFrequency" TEXT NOT NULL DEFAULT 'DAILY',
    "dataRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "anonymousDataSharing" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TrafficSession" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "country" TEXT NOT NULL DEFAULT 'Unknown',
    "countryFlag" TEXT NOT NULL DEFAULT '🌐',
    "region" TEXT,
    "deviceType" TEXT NOT NULL DEFAULT 'Desktop',
    "browser" TEXT NOT NULL DEFAULT 'Chrome',
    "os" TEXT NOT NULL DEFAULT 'Unknown',
    "landingPage" TEXT NOT NULL DEFAULT '/',
    "exitPage" TEXT,
    "referrer" TEXT NOT NULL DEFAULT '',
    "utmSource" TEXT NOT NULL DEFAULT 'Direct',
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "pageViews" INTEGER NOT NULL DEFAULT 1,
    "requestCount" INTEGER NOT NULL DEFAULT 1,
    "productViews" INTEGER NOT NULL DEFAULT 0,
    "searches" INTEGER NOT NULL DEFAULT 0,
    "addToCartCount" INTEGER NOT NULL DEFAULT 0,
    "checkoutStarted" BOOLEAN NOT NULL DEFAULT false,
    "purchaseCompleted" BOOLEAN NOT NULL DEFAULT false,
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "trafficType" TEXT NOT NULL DEFAULT 'HUMAN',
    "severity" TEXT NOT NULL DEFAULT 'LOW',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrafficSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TrafficEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pageUrl" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "referrer" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrafficEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DetectionResult" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "trafficType" TEXT NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "confidence" INTEGER NOT NULL,
    "severity" TEXT NOT NULL,
    "reasons" TEXT NOT NULL,
    "signals" TEXT NOT NULL,
    "recommendedAction" TEXT NOT NULL,
    "aiExplanation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DetectionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProtectionRule" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "threshold" INTEGER NOT NULL DEFAULT 80,
    "configuration" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProtectionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProtectionAction" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EXECUTED',
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProtectionAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Alert" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "affectedSessions" TEXT,
    "increase" TEXT,
    "botLikelihood" TEXT,
    "likelySource" TEXT,
    "countryFlag" TEXT,
    "sourcePercent" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AIInsight" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "recommendations" TEXT NOT NULL,
    "sourceDetectionIds" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "actor" TEXT NOT NULL DEFAULT 'SYSTEM',
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Shop_shopDomain_key" ON "Shop"("shopDomain");
CREATE INDEX IF NOT EXISTS "Shop_shopDomain_idx" ON "Shop"("shopDomain");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ShopSettings_shopId_key" ON "ShopSettings"("shopId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TrafficSession_shopId_idx" ON "TrafficSession"("shopId");
CREATE INDEX IF NOT EXISTS "TrafficSession_startedAt_idx" ON "TrafficSession"("startedAt");
CREATE INDEX IF NOT EXISTS "TrafficSession_riskScore_idx" ON "TrafficSession"("riskScore");
CREATE INDEX IF NOT EXISTS "TrafficSession_trafficType_idx" ON "TrafficSession"("trafficType");
CREATE INDEX IF NOT EXISTS "TrafficSession_severity_idx" ON "TrafficSession"("severity");
CREATE INDEX IF NOT EXISTS "TrafficSession_sessionKey_idx" ON "TrafficSession"("sessionKey");
CREATE INDEX IF NOT EXISTS "TrafficSession_utmSource_idx" ON "TrafficSession"("utmSource");
CREATE INDEX IF NOT EXISTS "TrafficSession_utmCampaign_idx" ON "TrafficSession"("utmCampaign");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TrafficEvent_shopId_idx" ON "TrafficEvent"("shopId");
CREATE INDEX IF NOT EXISTS "TrafficEvent_sessionId_idx" ON "TrafficEvent"("sessionId");
CREATE INDEX IF NOT EXISTS "TrafficEvent_timestamp_idx" ON "TrafficEvent"("timestamp");
CREATE INDEX IF NOT EXISTS "TrafficEvent_eventType_idx" ON "TrafficEvent"("eventType");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DetectionResult_sessionId_key" ON "DetectionResult"("sessionId");
CREATE INDEX IF NOT EXISTS "DetectionResult_shopId_idx" ON "DetectionResult"("shopId");
CREATE INDEX IF NOT EXISTS "DetectionResult_trafficType_idx" ON "DetectionResult"("trafficType");
CREATE INDEX IF NOT EXISTS "DetectionResult_riskScore_idx" ON "DetectionResult"("riskScore");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProtectionRule_shopId_idx" ON "ProtectionRule"("shopId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProtectionAction_shopId_idx" ON "ProtectionAction"("shopId");
CREATE INDEX IF NOT EXISTS "ProtectionAction_sessionId_idx" ON "ProtectionAction"("sessionId");
CREATE INDEX IF NOT EXISTS "ProtectionAction_action_idx" ON "ProtectionAction"("action");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Alert_shopId_idx" ON "Alert"("shopId");
CREATE INDEX IF NOT EXISTS "Alert_status_idx" ON "Alert"("status");
CREATE INDEX IF NOT EXISTS "Alert_severity_idx" ON "Alert"("severity");
CREATE INDEX IF NOT EXISTS "Alert_detectedAt_idx" ON "Alert"("detectedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AIInsight_shopId_idx" ON "AIInsight"("shopId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditLog_shopId_idx" ON "AuditLog"("shopId");
CREATE INDEX IF NOT EXISTS "AuditLog_action_idx" ON "AuditLog"("action");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AlterTable for Monitor Flagging & AI Recommendations
ALTER TABLE "TrafficSession" ADD COLUMN IF NOT EXISTS "isFlagged" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TrafficSession" ADD COLUMN IF NOT EXISTS "flaggedReason" TEXT;
ALTER TABLE "TrafficSession" ADD COLUMN IF NOT EXISTS "aiRecommendation" TEXT;
CREATE INDEX IF NOT EXISTS "TrafficSession_isFlagged_idx" ON "TrafficSession"("isFlagged");
CREATE INDEX IF NOT EXISTS "TrafficSession_shopId_isFlagged_idx" ON "TrafficSession"("shopId", "isFlagged");
`;

async function main() {
  const connectionString =
    process.env.DATABASE_URL ||
    "postgresql://neondb_owner:npg_8NlFrz9LPnHM@ep-icy-recipe-aucukrsj-pooler.c-10.us-east-1.aws.neon.tech/neondb?sslmode=require";

  console.log("Connecting to Neon PostgreSQL...");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log("Connected! Running migration DDL...");

  await client.query(ddl);
  console.log("Migration DDL successfully executed!");

  const res = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `);

  console.log("Active tables in database:");
  for (const row of res.rows) {
    console.log(" - " + row.table_name);
  }

  await client.end();
  console.log("Finished successfully!");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
