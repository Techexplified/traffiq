import prisma from "../db.server";
import type { Alert } from "@prisma/client";
import type { AlertData } from "./alertEngine.server";

export interface SendAlertEmailOptions {
  alert: Alert | AlertData;
  shopDomain: string;
  shopName?: string | null;
  recipientEmail?: string | null;
}

export interface SendEmailResult {
  sent: boolean;
  messageId?: string;
  reason?: string;
}

/**
 * Sends a high-severity security alert email via the Brevo API to the merchant.
 * Checks that emailAlerts is enabled in ShopSettings before dispatching.
 */
export async function sendHighSeverityAlertEmail(
  options: SendAlertEmailOptions
): Promise<SendEmailResult> {
  const { alert, shopDomain } = options;

  // 1. Check if severity is High
  const isHighSeverity =
    typeof alert.severity === "string" &&
    alert.severity.trim().toLowerCase() === "high";

  if (!isHighSeverity) {
    return { sent: false, reason: "Alert is not High severity." };
  }

  // 2. Resolve shop and check if email alerts are enabled in settings
  const shop = await prisma.shop.findFirst({
    where: {
      OR: [
        { shopDomain },
        { shopDomain: `${shopDomain}.myshopify.com` },
        { shopDomain: { startsWith: shopDomain.split(".")[0] } },
      ],
    },
    include: { settings: true },
  });

  if (!shop) {
    return { sent: false, reason: `Shop ${shopDomain} not found.` };
  }

  const emailAlertsEnabled = shop.settings?.emailAlerts ?? true;
  if (!emailAlertsEnabled) {
    console.log(`[EmailService] Email alerts are disabled in settings for ${shop.shopDomain}. Skipping email.`);
    return { sent: false, reason: "Email alerts are disabled in settings." };
  }

  // 3. Check Brevo API key
  const apiKey = process.env.BREVO_API;
  if (!apiKey) {
    console.warn("[EmailService] BREVO_API key is not configured in environment.");
    return { sent: false, reason: "BREVO_API key missing." };
  }

  // 4. Resolve recipient email
  let recipientEmail =
    options.recipientEmail ||
    shop.email;

  if (!recipientEmail) {
    // Check if offline session has an email or find first active session
    const session = await prisma.session.findFirst({
      where: { shop: shop.shopDomain, email: { not: null } },
    });
    recipientEmail = session?.email || null;
  }

  // Final fallback to verified account email if no shop email is recorded
  if (!recipientEmail) {
    recipientEmail = "sparsh.saxena@explified.com";
  }

  const recipientName = options.shopName || shop.name || "Store Merchant";
  const senderEmail = process.env.BREVO_SENDER_EMAIL || "yashsaxena291@gmail.com";
  const senderName = "Traffiq Security";

  // 5. Construct Direct Store Alerts Link
  // Formats: https://admin.shopify.com/store/{subdomain}/apps/traffiq/app/alerts
  const cleanSubdomain = shop.shopDomain.replace(/\.myshopify\.com$/, "").replace(/^https?:\/\//, "");
  const directAlertUrl = `https://admin.shopify.com/store/${cleanSubdomain}/apps/traffiq/app/alerts`;
  const directStoreAppUrl = `https://${shop.shopDomain}/admin/apps/traffiq/app/alerts`;

  // 6. Build High Severity Alert Email HTML
  const subject = `🚨 High Severity Alert: ${alert.title} - ${shop.name || shop.shopDomain}`;

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #0f172a; line-height: 1.5;">
  <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 14px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05);">
    
    <!-- Red Alert Banner Header -->
    <tr>
      <td style="background: linear-gradient(135deg, #dc2626, #b91c1c); padding: 24px 28px; color: #ffffff;">
        <table width="100%" border="0" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <span style="display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; background: rgba(255, 255, 255, 0.22); padding: 4px 10px; border-radius: 20px; margin-bottom: 8px;">
                🚨 HIGH SEVERITY SECURITY ALERT
              </span>
              <h1 style="margin: 6px 0 0 0; font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em;">
                Traffiq Threat Detection
              </h1>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Body Content -->
    <tr>
      <td style="padding: 28px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; font-size: 12.5px; color: #64748b;">
          <span>Store: <strong style="color: #0f172a;">${shop.shopDomain}</strong></span>
          <span>&bull; ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
        </div>

        <h2 style="margin: 0 0 10px 0; font-size: 18px; font-weight: 700; color: #0f172a;">
          ${alert.title}
        </h2>
        <p style="margin: 0 0 20px 0; font-size: 14px; color: #334155; line-height: 1.55;">
          ${alert.description}
        </p>

        <!-- Anomaly Signal Summary Table -->
        <table width="100%" border="0" cellpadding="10" cellspacing="0" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 24px; font-size: 13px;">
          ${
            alert.affectedSessions
              ? `<tr>
                  <td style="border-bottom: 1px solid #e2e8f0; color: #64748b; padding: 10px 14px;">Affected Sessions:</td>
                  <td style="border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #0f172a; text-align: right; padding: 10px 14px;">${alert.affectedSessions}</td>
                </tr>`
              : ""
          }
          ${
            alert.botLikelihood
              ? `<tr>
                  <td style="border-bottom: 1px solid #e2e8f0; color: #64748b; padding: 10px 14px;">Bot Likelihood:</td>
                  <td style="border-bottom: 1px solid #e2e8f0; font-weight: 700; color: #dc2626; text-align: right; padding: 10px 14px;">${alert.botLikelihood}</td>
                </tr>`
              : ""
          }
          ${
            (alert as any).likelySource || (alert as any).source
              ? `<tr>
                  <td style="border-bottom: 1px solid #e2e8f0; color: #64748b; padding: 10px 14px;">Likely Traffic Source:</td>
                  <td style="border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #0f172a; text-align: right; padding: 10px 14px;">${alert.countryFlag || "🌐"} ${(alert as any).likelySource || (alert as any).source}</td>
                </tr>`
              : ""
          }
          ${
            alert.increase
              ? `<tr>
                  <td style="color: #64748b; padding: 10px 14px;">Anomaly Surge:</td>
                  <td style="font-weight: 700; color: #dc2626; text-align: right; padding: 10px 14px;">${alert.increase}</td>
                </tr>`
              : ""
          }
        </table>

        <!-- Direct CTA Button to Shopify Store Alerts Page -->
        <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 18px;">
          <tr>
            <td align="center">
              <a href="${directAlertUrl}" target="_blank" style="display: inline-block; background-color: #2563eb; color: #ffffff; font-weight: 700; font-size: 14.5px; padding: 13px 32px; border-radius: 8px; text-decoration: none; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.25);">
                Open Alerts Page on Store ➔
              </a>
            </td>
          </tr>
        </table>

        <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px 16px; font-size: 12px; color: #1e40af; text-align: center;">
          Direct Store Link: <a href="${directAlertUrl}" style="color: #2563eb; font-weight: 600; text-decoration: underline;">${directAlertUrl}</a>
        </div>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="background-color: #f1f5f9; padding: 18px 28px; font-size: 12px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0;">
        You received this security notification because <strong>Email alerts</strong> are enabled in your Traffiq settings for <strong>${shop.shopDomain}</strong>.
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  // 7. Dispatch via Brevo API
  try {
    const payload = {
      sender: {
        name: senderName,
        email: senderEmail,
      },
      to: [
        {
          email: recipientEmail,
          name: recipientName,
        },
      ],
      subject,
      htmlContent,
    };

    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok && data?.messageId) {
      console.log(`[EmailService] ✓ High severity alert email sent to ${recipientEmail} (ID: ${data.messageId})`);

      // Record AuditLog
      await prisma.auditLog.create({
        data: {
          shopId: shop.id,
          actor: "SYSTEM",
          action: "HIGH_SEVERITY_ALERT_EMAIL_SENT",
          resourceType: "Alert",
          resourceId: (alert as any).id || null,
          metadata: JSON.stringify({
            recipientEmail,
            messageId: data.messageId,
            alertTitle: alert.title,
            severity: alert.severity,
          }),
        },
      });

      return { sent: true, messageId: data.messageId };
    } else {
      console.error("[EmailService] Brevo send error:", res.status, data);
      return { sent: false, reason: JSON.stringify(data) };
    }
  } catch (err) {
    console.error("[EmailService] Network exception sending email:", err);
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
