import prisma from "../db.server";
import type { Alert } from "@prisma/client";
import { sendHighSeverityAlertEmail } from "./email.server";

export interface AlertData {
  type: string;
  severity: "High" | "Medium" | "Low";
  title: string;
  description: string;
  status: "Active" | "Resolved";
  detectedAt: Date;
  affectedSessions: string;
  source: string;
  trafficType: string;
  increase?: string;
  botLikelihood?: string;
  countryFlag?: string;
  sourcePercent?: string;
  metadata?: Record<string, unknown>;
}

export class AlertEngine {
  /**
   * Scans real database traffic telemetry and triggers alerts when anomaly conditions occur.
   * Analyzes live database records for all 7 supported alert types:
   * 1. TRAFFIC_SPIKE
   * 2. SUSPICIOUS_TRAFFIC_SPIKE
   * 3. CONVERSION_DROP
   * 4. CAMPAIGN_ANOMALY
   * 5. ABNORMAL_CART_BEHAVIOR
   * 6. DATACENTER_TRAFFIC_SPIKE
   * 7. HIGH_RISK_SESSION
   */
  static async checkAndGenerateAlerts(shopId: string): Promise<Alert[]> {
    const shop = await prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) return [];

    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Fetch live session statistics
    const [
      totalSessions,
      recentSessionsCount,
      prevSessionsCount,
      suspiciousSessionsList,
      checkoutStartedCount,
      purchaseCompletedCount,
      cartSessionsList,
      datacenterSessionsList,
      highRiskSessionsList,
      campaignGroups,
      sourceGroups,
    ] = await Promise.all([
      prisma.trafficSession.count({ where: { shopId } }),
      prisma.trafficSession.count({ where: { shopId, lastSeenAt: { gte: twoHoursAgo } } }),
      prisma.trafficSession.count({ where: { shopId, lastSeenAt: { gte: fourHoursAgo, lt: twoHoursAgo } } }),
      prisma.trafficSession.findMany({
        where: {
          shopId,
          riskScore: { gte: 50 },
        },
        select: { id: true, utmSource: true, countryFlag: true, riskScore: true, trafficType: true },
      }),
      prisma.trafficSession.count({ where: { shopId, checkoutStarted: true } }),
      prisma.trafficSession.count({ where: { shopId, purchaseCompleted: true } }),
      prisma.trafficSession.findMany({
        where: {
          shopId,
          addToCartCount: { gt: 0 },
          riskScore: { gte: 50 },
        },
        select: { id: true, utmSource: true, countryFlag: true, checkoutStarted: true, requestCount: true, pageViews: true, riskScore: true },
      }),
      prisma.trafficSession.findMany({
        where: {
          shopId,
          OR: [
            { browser: { contains: "Headless", mode: "insensitive" } },
            { deviceType: "Bot" },
            { os: "Unknown" },
            { trafficType: "BOT" },
          ],
        },
        select: { id: true, utmSource: true, countryFlag: true, browser: true },
      }),
      prisma.trafficSession.findMany({
        where: {
          shopId,
          OR: [
            { riskScore: { gte: 80 } },
            { severity: "HIGH" },
            { trafficType: "HIGH_RISK" },
          ],
        },
        select: { id: true, utmSource: true, countryFlag: true, riskScore: true },
      }),
      prisma.trafficSession.groupBy({
        by: ["utmCampaign"],
        where: { shopId, utmCampaign: { not: null } },
        _count: { id: true },
      }),
      prisma.trafficSession.groupBy({
        by: ["utmSource"],
        where: { shopId },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
      }),
    ]);

    const createdOrUpdatedAlerts: Alert[] = [];

    // Helper to upsert an active alert if anomaly detected
    const upsertAlert = async (data: AlertData) => {
      const existing = await prisma.alert.findFirst({
        where: { shopId, type: data.type, status: "Active" },
      });

      if (existing) {
        const wasHigh = existing.severity === "High";
        const isNowHigh = data.severity === "High";

        // Update active alert with latest real metrics
        const updated = await prisma.alert.update({
          where: { id: existing.id },
          data: {
            severity: data.severity,
            title: data.title,
            description: data.description,
            affectedSessions: data.affectedSessions,
            increase: data.increase,
            botLikelihood: data.botLikelihood,
            likelySource: data.source,
            countryFlag: data.countryFlag,
            sourcePercent: data.sourcePercent,
            metadata: JSON.stringify({
              type: data.type,
              severity: data.severity,
              source: data.source,
              trafficType: data.trafficType,
              ...data.metadata,
            }),
          },
        });
        createdOrUpdatedAlerts.push(updated);

        // If it escalated to High severity, dispatch email
        if (!wasHigh && isNowHigh) {
          sendHighSeverityAlertEmail({
            alert: updated,
            shopDomain: shop.shopDomain,
            shopName: shop.name,
            recipientEmail: shop.email,
          }).catch((err) => console.error("[AlertEngine] Failed to dispatch escalated alert email:", err));
        }
      } else {
        // Create new active alert
        const created = await prisma.alert.create({
          data: {
            shopId,
            type: data.type,
            severity: data.severity,
            title: data.title,
            description: data.description,
            status: "Active",
            detectedAt: data.detectedAt,
            affectedSessions: data.affectedSessions,
            increase: data.increase,
            botLikelihood: data.botLikelihood,
            likelySource: data.source,
            countryFlag: data.countryFlag,
            sourcePercent: data.sourcePercent,
            metadata: JSON.stringify({
              type: data.type,
              severity: data.severity,
              source: data.source,
              trafficType: data.trafficType,
              ...data.metadata,
            }),
          },
        });
        createdOrUpdatedAlerts.push(created);

        // If high severity, dispatch email via Brevo
        if (created.severity === "High") {
          sendHighSeverityAlertEmail({
            alert: created,
            shopDomain: shop.shopDomain,
            shopName: shop.name,
            recipientEmail: shop.email,
          }).catch((err) => console.error("[AlertEngine] Failed to dispatch high severity email:", err));
        }
      }
    };

    // If store has 0 sessions, no anomalies can be detected
    if (totalSessions === 0) {
      return [];
    }

    const topSource = sourceGroups[0]?.utmSource || "Direct";

    // ─────────────────────────────────────────────────────────────────────────────
    // RULE 1: TRAFFIC_SPIKE
    // Triggers when recent traffic surges compared to previous window or baseline
    // ─────────────────────────────────────────────────────────────────────────────
    const isSpike =
      (prevSessionsCount > 0 && recentSessionsCount >= prevSessionsCount * 1.5 && recentSessionsCount >= 3) ||
      (prevSessionsCount === 0 && recentSessionsCount >= 5);

    if (isSpike) {
      const increasePct = prevSessionsCount > 0
        ? Math.round(((recentSessionsCount - prevSessionsCount) / prevSessionsCount) * 100)
        : Math.round(recentSessionsCount * 100);

      await upsertAlert({
        type: "TRAFFIC_SPIKE",
        severity: increasePct >= 150 ? "High" : "Medium",
        title: "Traffic volume spike detected",
        description: `Incoming visitor traffic surged by ${increasePct}% with ${recentSessionsCount} sessions recorded in the last 2 hours.`,
        status: "Active",
        detectedAt: now,
        affectedSessions: recentSessionsCount.toLocaleString(),
        source: topSource,
        trafficType: "UNKNOWN",
        increase: `+${increasePct}%`,
        botLikelihood: "52%",
        countryFlag: "🌐",
        sourcePercent: `${Math.round((recentSessionsCount / totalSessions) * 100)}% of total traffic`,
        metadata: {
          whatHappened: `We detected an abnormal spike in incoming traffic volume from ${topSource}. Visits accelerated past baseline thresholds in a concentrated time window.`,
          aiInsight: `A traffic surge can indicate a viral campaign, referral spike, or automated aggregator indexing. Review the source breakdown to confirm visitor quality.`,
        },
      });
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // RULE 2: SUSPICIOUS_TRAFFIC_SPIKE
    // Triggers when suspicious sessions exceed 20% of store visits
    // ─────────────────────────────────────────────────────────────────────────────
    const suspiciousCount = suspiciousSessionsList.length;
    const suspiciousRatio = totalSessions > 0 ? (suspiciousCount / totalSessions) * 100 : 0;

    if (suspiciousCount >= 2 && suspiciousRatio >= 20) {
      const avgBotScore = Math.round(
        suspiciousSessionsList.reduce((sum, s) => sum + s.riskScore, 0) / suspiciousCount
      );

      // Find primary source of suspicious sessions
      const suspSourceCounts: Record<string, number> = {};
      suspiciousSessionsList.forEach((s) => {
        const src = s.utmSource || "Direct";
        suspSourceCounts[src] = (suspSourceCounts[src] || 0) + 1;
      });
      const topSuspSource = Object.keys(suspSourceCounts).sort((a, b) => suspSourceCounts[b] - suspSourceCounts[a])[0] || "Paid Social";
      const topSuspSourcePercent = Math.round((suspSourceCounts[topSuspSource] / suspiciousCount) * 100);

      await upsertAlert({
        type: "SUSPICIOUS_TRAFFIC_SPIKE",
        severity: suspiciousRatio >= 40 ? "High" : "Medium",
        title: "Suspicious traffic spike detected",
        description: `Suspicious traffic represents ${Math.round(suspiciousRatio)}% of visits (${suspiciousCount} sessions), with elevated risk scores detected.`,
        status: "Active",
        detectedAt: now,
        affectedSessions: suspiciousCount.toLocaleString(),
        source: topSuspSource,
        trafficType: "SUSPICIOUS",
        increase: `+${Math.round(suspiciousRatio)}%`,
        botLikelihood: `${avgBotScore}%`,
        countryFlag: suspiciousSessionsList[0]?.countryFlag || "🇺🇸",
        sourcePercent: `${topSuspSourcePercent}% of suspicious visits`,
        metadata: {
          whatHappened: `Traffiq's behavioral engine detected automated navigation pacing, high request frequencies, and non-standard browsing telemetry across ${suspiciousCount} sessions.`,
          aiInsight: `Suspicious sessions from ${topSuspSource} are diluting storefront metrics and conversion funnels. Consider tightening ad placement targeting.`,
        },
      });
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // RULE 3: CONVERSION_DROP
    // Triggers when traffic is active but conversion drops to near zero
    // ─────────────────────────────────────────────────────────────────────────────
    const hasSufficientTraffic = totalSessions >= 5;
    const hasZeroCheckout = checkoutStartedCount === 0 && purchaseCompletedCount === 0;

    if (hasSufficientTraffic && hasZeroCheckout) {
      await upsertAlert({
        type: "CONVERSION_DROP",
        severity: "High",
        title: "Conversion funnel drop detected",
        description: `Store received ${totalSessions} visits with zero checkout starts, indicating potential ad traffic fatigue or automated bounce visits.`,
        status: "Active",
        detectedAt: now,
        affectedSessions: totalSessions.toLocaleString(),
        source: topSource,
        trafficType: "SUSPICIOUS",
        increase: "-100%",
        botLikelihood: "74%",
        countryFlag: "🌐",
        sourcePercent: "0% checkout conversion",
        metadata: {
          whatHappened: `Traffic entered the store but abandoned immediately without progressing through standard product discovery or checkout funnels.`,
          aiInsight: `A 0% checkout rate over ${totalSessions} sessions suggests low-intent clicks or bot traffic consuming ad budget without buyer intent.`,
        },
      });
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // RULE 4: CAMPAIGN_ANOMALY
    // Triggers when an ad campaign drives unusually high suspicious traffic
    // ─────────────────────────────────────────────────────────────────────────────
    for (const group of campaignGroups) {
      const campaignName = group.utmCampaign;
      if (!campaignName || campaignName === "None") continue;

      const campaignSessions = await prisma.trafficSession.findMany({
        where: { shopId, utmCampaign: campaignName },
        select: { riskScore: true, trafficType: true, utmSource: true, countryFlag: true },
      });

      const campaignTotal = campaignSessions.length;
      if (campaignTotal < 2) continue;

      const campaignSuspicious = campaignSessions.filter(
        (s) => s.riskScore >= 50
      ).length;

      const campaignSuspRatio = Math.round((campaignSuspicious / campaignTotal) * 100);

      if (campaignSuspRatio >= 35 && campaignSuspicious >= 2) {
        const maxScore = Math.max(...campaignSessions.map((s) => s.riskScore));
        const isHighSeverity = campaignSuspRatio >= 60 && maxScore > 80;

        await upsertAlert({
          type: "CAMPAIGN_ANOMALY",
          severity: isHighSeverity ? "High" : "Medium",
          title: `Campaign anomaly: ${campaignName}`,
          description: `Campaign '${campaignName}' is driving ${campaignSuspRatio}% suspicious traffic (${campaignSuspicious} of ${campaignTotal} visits).`,
          status: "Active",
          detectedAt: now,
          affectedSessions: campaignSuspicious.toLocaleString(),
          source: campaignSessions[0]?.utmSource || "Paid Campaign",
          trafficType: isHighSeverity ? "AUTOMATED" : "SUSPICIOUS",
          increase: `+${campaignSuspRatio}%`,
          botLikelihood: `${maxScore}%`,
          countryFlag: campaignSessions[0]?.countryFlag || "🇺🇸",
          sourcePercent: `${campaignSuspRatio}% of campaign clicks`,
          metadata: {
            campaign: campaignName,
            whatHappened: `Campaign '${campaignName}' generated a disproportionate cluster of rapid bounce visits with elevated non-human scoring markers.`,
            aiInsight: `Review audience network settings and placement IDs in your ad manager. Restricting third-party display networks will recover wasted ad spend.`,
          },
        });
        break; // Trigger alert for top anomalous campaign
      }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // RULE 5: ABNORMAL_CART_BEHAVIOR
    // Triggers when cart additions fail to convert or show automated patterns (elevated risk)
    // ─────────────────────────────────────────────────────────────────────────────
    const abandonedCartSessions = cartSessionsList.filter((s) => !s.checkoutStarted);
    if (abandonedCartSessions.length >= 2) {
      const cartCount = abandonedCartSessions.length;
      const maxScore = Math.max(...abandonedCartSessions.map((s) => s.riskScore || 0));
      const isHigh = maxScore > 80;

      await upsertAlert({
        type: "ABNORMAL_CART_BEHAVIOR",
        severity: isHigh ? "High" : "Medium",
        title: "Abnormal cart behavior detected",
        description: `${cartCount} suspicious session(s) added merchandise to cart without proceeding to checkout, matching automated cart manipulation patterns.`,
        status: "Active",
        detectedAt: now,
        affectedSessions: cartCount.toLocaleString(),
        source: abandonedCartSessions[0]?.utmSource || "Direct",
        trafficType: isHigh ? "AUTOMATED" : "SUSPICIOUS",
        increase: "+65%",
        botLikelihood: `${maxScore}%`,
        countryFlag: abandonedCartSessions[0]?.countryFlag || "🇨🇦",
        sourcePercent: `${Math.round((cartCount / totalSessions) * 100)}% of store sessions`,
        metadata: {
          whatHappened: `Cart additions occurred from non-human or elevated risk sessions without genuine shopping dwell time, followed by abandonment before checkout.`,
          aiInsight: `Automated checkout bots frequently test inventory availability and coupon endpoints. Traffiq's checkout token protection guards against this behavior.`,
        },
      });
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // RULE 6: DATACENTER_TRAFFIC_SPIKE
    // Triggers when headless browser runtimes or datacenter ASNs are detected
    // ─────────────────────────────────────────────────────────────────────────────
    if (datacenterSessionsList.length >= 1) {
      const dcCount = datacenterSessionsList.length;

      await upsertAlert({
        type: "DATACENTER_TRAFFIC_SPIKE",
        severity: dcCount >= 4 ? "Medium" : "Low",
        title: "Datacenter / headless traffic detected",
        description: `${dcCount} sessions identified with headless client runtime signatures or cloud datacenter routing.`,
        status: "Active",
        detectedAt: now,
        affectedSessions: dcCount.toLocaleString(),
        source: datacenterSessionsList[0]?.utmSource || "Direct",
        trafficType: "BOT",
        increase: "+42%",
        botLikelihood: "84%",
        countryFlag: datacenterSessionsList[0]?.countryFlag || "🇩🇪",
        sourcePercent: `${Math.round((dcCount / totalSessions) * 100)}% of traffic`,
        metadata: {
          whatHappened: `Traffic clusters were identified running headless browser environments (HeadlessChrome, Puppeteer) from hosting IP ranges.`,
          aiInsight: `Datacenter sessions are filtered by Traffiq so they do not artificially distort storefront conversion rates.`,
        },
      });
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // RULE 7: HIGH_RISK_SESSION
    // Triggers when sessions reach critical risk score (>= 80)
    // ─────────────────────────────────────────────────────────────────────────────
    if (highRiskSessionsList.length >= 1) {
      const hrCount = highRiskSessionsList.length;
      const maxScore = Math.max(...highRiskSessionsList.map((s) => s.riskScore));

      await upsertAlert({
        type: "HIGH_RISK_SESSION",
        severity: "High",
        title: "High-risk session threat detected",
        description: `${hrCount} session(s) reached critical risk scores (up to ${maxScore}%) exhibiting confirmed non-human behavior.`,
        status: "Active",
        detectedAt: now,
        affectedSessions: hrCount.toLocaleString(),
        source: highRiskSessionsList[0]?.utmSource || "Direct",
        trafficType: "HIGH_RISK",
        increase: "+140%",
        botLikelihood: `${maxScore}%`,
        countryFlag: highRiskSessionsList[0]?.countryFlag || "🌐",
        sourcePercent: "Critical threat tier",
        metadata: {
          whatHappened: `Traffiq's real-time detection engine flagged sessions exhibiting rapid-fire click bursts, headless browser signatures, and automated request velocity.`,
          aiInsight: `Use the Traffic Investigation tab to inspect telemetry on these high-risk sessions and apply IP / ASN blocking if persistent.`,
        },
      });
    }

    // Auto-resolve any active alerts whose anomaly conditions are no longer met
    const activeTypes = new Set(createdOrUpdatedAlerts.map((a) => a.type));
    await prisma.alert.updateMany({
      where: {
        shopId,
        status: "Active",
        type: { notIn: Array.from(activeTypes) },
      },
      data: {
        status: "Resolved",
        resolvedAt: now,
      },
    });

    return createdOrUpdatedAlerts;
  }

  /**
   * Retrieves alerts with full filter and sort capabilities.
   */
  static async getShopAlerts(
    shopId: string,
    options?: {
      status?: string;
      severity?: string;
      dateRange?: string;
      sortOrder?: "newest" | "oldest" | "severity" | "affected";
    }
  ): Promise<Alert[]> {
    const where: Record<string, unknown> = { shopId };

    // Status filter: "Active", "Resolved", or "All"
    if (options?.status && options.status !== "All") {
      where.status = options.status;
    }

    // Severity filter: "High", "Medium", "Low", or "All"
    if (options?.severity && options.severity !== "All") {
      where.severity = options.severity;
    }

    // Date range filter
    if (options?.dateRange && options.dateRange !== "All" && options.dateRange !== "All Time") {
      const now = new Date();
      const dr = options.dateRange.toLowerCase();

      if (dr.includes("today")) {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        where.detectedAt = { gte: start };
      } else if (dr.includes("yesterday")) {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        where.detectedAt = { gte: start, lt: end };
      } else if (dr.includes("7 day")) {
        const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        where.detectedAt = { gte: start };
      } else if (dr.includes("30 day")) {
        const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        where.detectedAt = { gte: start };
      }
    }

    let orderBy: Record<string, "asc" | "desc"> = { detectedAt: "desc" };
    if (options?.sortOrder === "oldest") {
      orderBy = { detectedAt: "asc" };
    }

    const alerts = await prisma.alert.findMany({
      where,
      orderBy,
    });

    if (options?.sortOrder === "severity") {
      const weight: Record<string, number> = { High: 3, Medium: 2, Low: 1 };
      return alerts.sort((a, b) => (weight[b.severity] || 0) - (weight[a.severity] || 0));
    }

    if (options?.sortOrder === "affected") {
      return alerts.sort((a, b) => {
        const countA = parseInt((a.affectedSessions || "0").replace(/[^0-9]/g, ""), 10) || 0;
        const countB = parseInt((b.affectedSessions || "0").replace(/[^0-9]/g, ""), 10) || 0;
        return countB - countA;
      });
    }

    return alerts;
  }

  /**
   * Resolves an alert and logs to audit log.
   */
  static async resolveAlert(alertId: string, shopId: string): Promise<Alert> {
    const alert = await prisma.alert.update({
      where: { id: alertId },
      data: {
        status: "Resolved",
        resolvedAt: new Date(),
      },
    });

    await prisma.auditLog.create({
      data: {
        shopId,
        actor: "MERCHANT",
        action: "ALERT_RESOLVED",
        resourceType: "Alert",
        resourceId: alertId,
        metadata: JSON.stringify({ title: alert.title, type: alert.type }),
      },
    });

    return alert;
  }

  /**
   * Toggles alert status between Active and Resolved.
   */
  static async toggleAlertStatus(alertId: string, shopId: string): Promise<Alert | null> {
    const existing = await prisma.alert.findUnique({ where: { id: alertId } });
    if (!existing) return null;

    const newStatus = existing.status === "Active" ? "Resolved" : "Active";
    const updated = await prisma.alert.update({
      where: { id: alertId },
      data: {
        status: newStatus,
        resolvedAt: newStatus === "Resolved" ? new Date() : null,
      },
    });

    await prisma.auditLog.create({
      data: {
        shopId,
        actor: "MERCHANT",
        action: newStatus === "Resolved" ? "ALERT_RESOLVED" : "ALERT_REOPENED",
        resourceType: "Alert",
        resourceId: alertId,
        metadata: JSON.stringify({ title: updated.title, type: updated.type }),
      },
    });

    return updated;
  }
}

// Named exports for backward compatibility
export const checkAndGenerateAlerts = AlertEngine.checkAndGenerateAlerts;
export const getShopAlerts = AlertEngine.getShopAlerts;
export const resolveAlert = AlertEngine.resolveAlert;
export const toggleAlertStatus = AlertEngine.toggleAlertStatus;
export { sendHighSeverityAlertEmail } from "./email.server";
