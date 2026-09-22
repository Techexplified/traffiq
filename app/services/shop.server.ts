import prisma from "../db.server";

export interface ShopifyShopData {
  id?: string;
  name: string;
  myshopifyDomain: string;
  url: string;
  plan?: { displayName: string };
  currencyCode?: string;
  email?: string;
}

export interface OnboardingPermissions {
  checkoutValidation?: boolean;
  telemetryAccess?: boolean;
  threatDefense?: boolean;
  attributionAccess?: boolean;
}

export async function fetchShopDataFromAdmin(
  admin: { graphql: (query: string) => Promise<Response> },
  shopDomain: string
): Promise<ShopifyShopData> {
  let shopData: ShopifyShopData = {
    name: shopDomain.replace(".myshopify.com", ""),
    myshopifyDomain: shopDomain,
    url: `https://${shopDomain}`,
    plan: { displayName: "Storefront" },
    currencyCode: "USD",
    email: "",
  };

  try {
    const response = await admin.graphql(`
      #graphql
      query getShopInfo {
        shop {
          id
          name
          myshopifyDomain
          url
          plan {
            displayName
          }
          currencyCode
          email
        }
      }
    `);
    const data = await response.json();
    if (data.data?.shop) {
      shopData = {
        ...shopData,
        ...data.data.shop,
      };
    }
  } catch (err) {
    console.error("Failed to query shop info from Shopify Admin API:", err);
  }

  return shopData;
}

export async function getShopByDomain(shopDomain: string) {
  return await prisma.shop.findUnique({
    where: { shopDomain },
    include: {
      settings: true,
    },
  });
}

export async function recordAuditLog(
  shopId: string,
  actor: string,
  action: string,
  resourceType: string,
  resourceId?: string,
  metadata?: unknown
) {
  try {
    return await prisma.auditLog.create({
      data: {
        shopId,
        actor,
        action,
        resourceType,
        resourceId,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });
  } catch (err) {
    console.error("Failed to record audit log:", err);
    return null;
  }
}

export async function ensureShopConnected(
  shopDomain: string,
  shopifyShopData?: ShopifyShopData
) {
  const existing = await prisma.shop.findUnique({
    where: { shopDomain },
    include: { settings: true },
  });

  if (existing) {
    // Update shop info if changed and ensure active status
    const updated = await prisma.shop.update({
      where: { id: existing.id },
      data: {
        status: "ACTIVE",
        name: shopifyShopData?.name || existing.name,
        email: shopifyShopData?.email || existing.email,
        currencyCode: shopifyShopData?.currencyCode || existing.currencyCode || "USD",
        planName: shopifyShopData?.plan?.displayName || existing.planName,
        shopifyShopId: shopifyShopData?.id || existing.shopifyShopId,
        uninstalledAt: null,
        updatedAt: new Date(),
      },
      include: { settings: true },
    });

    if (!updated.settings) {
      await prisma.shopSettings.create({
        data: {
          shopId: updated.id,
          protectionMode: "MONITOR",
          autoProtect: true,
          emailAlerts: true,
          alertFrequency: "DAILY",
          dataRetentionDays: 30,
          anonymousDataSharing: false,
          checkoutValidation: true,
          telemetryAccess: true,
          threatDefense: true,
          attributionAccess: true,
        },
      });
    }

    return updated;
  }

  // Create new shop record
  const newShop = await prisma.shop.create({
    data: {
      shopDomain,
      name: shopifyShopData?.name,
      email: shopifyShopData?.email,
      currencyCode: shopifyShopData?.currencyCode || "USD",
      planName: shopifyShopData?.plan?.displayName,
      shopifyShopId: shopifyShopData?.id,
      status: "ACTIVE",
      isOnboarded: false,
      onboardingStep: 1,
      installedAt: new Date(),
      settings: {
        create: {
          protectionMode: "MONITOR",
          autoProtect: true,
          emailAlerts: true,
          alertFrequency: "DAILY",
          dataRetentionDays: 30,
          anonymousDataSharing: false,
          checkoutValidation: true,
          telemetryAccess: true,
          threatDefense: true,
          attributionAccess: true,
        },
      },
    },
    include: { settings: true },
  });

  // Create audit log for initial store connection
  await recordAuditLog(
    newShop.id,
    "MERCHANT",
    "STORE_CONNECTED",
    "Shop",
    newShop.id,
    {
      shopDomain,
      installedAt: newShop.installedAt,
      name: shopifyShopData?.name,
    }
  );

  return newShop;
}

export async function saveOnboardingPermissions(
  shopId: string,
  permissions: OnboardingPermissions
) {
  const settings = await prisma.shopSettings.upsert({
    where: { shopId },
    update: {
      checkoutValidation: permissions.checkoutValidation ?? true,
      telemetryAccess: permissions.telemetryAccess ?? true,
      threatDefense: permissions.threatDefense ?? true,
      attributionAccess: permissions.attributionAccess ?? true,
      updatedAt: new Date(),
    },
    create: {
      shopId,
      protectionMode: "MONITOR",
      autoProtect: true,
      emailAlerts: true,
      alertFrequency: "DAILY",
      dataRetentionDays: 30,
      anonymousDataSharing: false,
      checkoutValidation: permissions.checkoutValidation ?? true,
      telemetryAccess: permissions.telemetryAccess ?? true,
      threatDefense: permissions.threatDefense ?? true,
      attributionAccess: permissions.attributionAccess ?? true,
    },
  });

  await prisma.shop.update({
    where: { id: shopId },
    data: { onboardingStep: 3, updatedAt: new Date() },
  });

  await recordAuditLog(
    shopId,
    "MERCHANT",
    "PERMISSIONS_UPDATED",
    "ShopSettings",
    settings.id,
    permissions
  );

  return settings;
}

export async function completeOnboarding(
  shopId: string,
  permissions?: OnboardingPermissions
) {
  if (permissions) {
    await saveOnboardingPermissions(shopId, permissions);
  }

  const updatedShop = await prisma.shop.update({
    where: { id: shopId },
    data: {
      isOnboarded: true,
      onboardingStep: 5,
      updatedAt: new Date(),
    },
    include: { settings: true },
  });

  await recordAuditLog(
    shopId,
    "MERCHANT",
    "ONBOARDING_COMPLETED",
    "Shop",
    shopId,
    {
      isOnboarded: true,
      completedAt: new Date(),
    }
  );

  return updatedShop;
}

export async function updateOnboardingStep(shopId: string, step: number) {
  return await prisma.shop.update({
    where: { id: shopId },
    data: { onboardingStep: step, updatedAt: new Date() },
  });
}

export async function disconnectShop(shopDomain: string) {
  const existing = await prisma.shop.findUnique({
    where: { shopDomain },
  });

  if (existing) {
    const updated = await prisma.shop.update({
      where: { id: existing.id },
      data: {
        status: "UNINSTALLED",
        uninstalledAt: new Date(),
        updatedAt: new Date(),
      },
    });

    await recordAuditLog(
      existing.id,
      "SHOPIFY_WEBHOOK",
      "APP_UNINSTALLED",
      "Shop",
      existing.id,
      {
        shopDomain,
        uninstalledAt: updated.uninstalledAt,
      }
    );

    return updated;
  }

  return null;
}
