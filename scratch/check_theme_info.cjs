const fs = require('fs');

async function checkThemeInfo() {
  const formBody = new URLSearchParams();
  formBody.append("form_type", "storefront_password");
  formBody.append("utf8", "✓");
  formBody.append("password", "auvowl");

  const loginRes = await fetch("https://cartmend.myshopify.com/password", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody.toString(),
    redirect: "manual",
  });

  const cookieHeaders = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [loginRes.headers.get("set-cookie")];
  const cookie = cookieHeaders.map(c => (c || "").split(";")[0]).filter(Boolean).join("; ");

  const res = await fetch("https://cartmend.myshopify.com/collections/all", {
    headers: { Cookie: cookie }
  });
  const html = await res.text();

  // Find theme ID and theme name
  const themeMatch = html.match(/Shopify\.theme\s*=\s*({[^}]+})/i);
  console.log("Shopify.theme:", themeMatch ? themeMatch[1] : "not found");

  const boMatches = html.match(/content_for_header/i);
  console.log("content_for_header mentioned:", Boolean(boMatches));

  // Check all cdn.shopify.com scripts
  const cdnScripts = html.match(/https?:\/\/[^"']+\/extensions\/[^"']+/gi) || [];
  console.log("Extension scripts in HTML:", cdnScripts);
}

checkThemeInfo().catch(console.error);
