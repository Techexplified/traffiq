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

export async function getShopByDomain(rawDomain: string) {
  if (!rawDomain) return null;
  const cleanDomain = rawDomain
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0]
    .trim()
    .toLowerCase();

  // Try exact match first
  let shop = await prisma.shop.findUnique({
    where: { shopDomain: cleanDomain },
    include: { settings: true },
  });
  if (shop) return shop;

  // Try with .myshopify.com suffix if not present
  if (!cleanDomain.endsWith(".myshopify.com")) {
    shop = await prisma.shop.findUnique({
      where: { shopDomain: `${cleanDomain}.myshopify.com` },
      include: { settings: true },
    });
    if (shop) return shop;
  }

  // Try finding by prefix match
  const prefix = cleanDomain.split(".")[0];
  shop = await prisma.shop.findFirst({
    where: {
      OR: [
        { shopDomain: { startsWith: prefix } },
        { shopDomain: { contains: prefix } },
      ],
      status: "ACTIVE",
    },
    include: { settings: true },
  });
  return shop;
}

export async function ensureWebPixelSynchronized(
  admin: { graphql: (query: string, options?: any) => Promise<Response> },
  shopDomain: string,
  appUrl: string
): Promise<{ success: boolean; pixelId?: string; action: "created" | "updated" | "current" | "failed" }> {
  try {
    const cleanAppUrl = (appUrl || "https://traffiq-smoky.vercel.app").replace(/\/+$/, "");
    let existingPixelId: string | null = null;
    let existingSettings: { appUrl?: string } = {};

    try {
      const queryRes = await admin.graphql(
        `#graphql
        query getWebPixel {
          webPixel {
            id
            settings
          }
        }`
      );
      const queryJson = await queryRes.json();
      if (queryJson?.data?.webPixel?.id) {
        existingPixelId = queryJson.data.webPixel.id;
        try {
          existingSettings = JSON.parse(queryJson.data.webPixel.settings || "{}");
        } catch {}
      }
    } catch (queryErr) {
      console.log(`[WebPixel Sync] Query check on ${shopDomain} (proceeding to create if needed):`, queryErr);
    }

    if (existingPixelId) {
      if (existingSettings.appUrl !== cleanAppUrl) {
        const updateRes = await admin.graphql(
          `#graphql
          mutation webPixelUpdate($id: ID!, $webPixel: WebPixelInput!) {
            webPixelUpdate(id: $id, webPixel: $webPixel) {
              userErrors { field message }
              webPixel { id settings }
            }
          }`,
          {
            variables: {
              id: existingPixelId,
              webPixel: { settings: JSON.stringify({ appUrl: cleanAppUrl }) },
            },
          }
        );
        const updateJson = await updateRes.json();
        console.log(`[WebPixel Sync] Updated Web Pixel on ${shopDomain}:`, JSON.stringify(updateJson));
        return { success: true, pixelId: existingPixelId, action: "updated" };
      }
      return { success: true, pixelId: existingPixelId, action: "current" };
    }

    // Create new Web Pixel
    const createRes = await admin.graphql(
      `#graphql
      mutation webPixelCreate($webPixel: WebPixelInput!) {
        webPixelCreate(webPixel: $webPixel) {
          userErrors { field message }
          webPixel { id settings }
        }
      }`,
      {
        variables: {
          webPixel: { settings: JSON.stringify({ appUrl: cleanAppUrl }) },
        },
      }
    );
    const createJson = await createRes.json();
    const createdId = createJson?.data?.webPixelCreate?.webPixel?.id;
    console.log(`[WebPixel Sync] Created Web Pixel on ${shopDomain}:`, JSON.stringify(createJson));
    return { success: Boolean(createdId), pixelId: createdId, action: "created" };
  } catch (err) {
    console.error(`[WebPixel Sync] Error synchronizing web pixel on ${shopDomain}:`, err);
    return { success: false, action: "failed" };
  }
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
