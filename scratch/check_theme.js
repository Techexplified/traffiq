import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();
const prisma = new PrismaClient();

async function main() {
  const session = await prisma.session.findUnique({
    where: { id: 'offline_blog-lift-v2.myshopify.com' }
  });
  
  const query = `
    query getThemes {
      themes(first: 5, roles: [MAIN]) {
        nodes {
          id
          name
          role
          files(first: 10, filenames: ["config/settings_data.json"]) {
            nodes {
              filename
              body {
                ... on OnlineStoreThemeFileBodyText {
                  content
                }
              }
            }
          }
        }
      }
    }
  `;

  const res = await fetch('https://blog-lift-v2.myshopify.com/admin/api/2026-07/graphql.json', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': session.accessToken
    },
    body: JSON.stringify({ query })
  });

  const data = await res.json();
  console.log('GRAPHQL RESPONSE:');
  if (data.errors) {
    console.log('Errors:', JSON.stringify(data.errors, null, 2));
    return;
  }
  const theme = data?.data?.themes?.nodes?.[0];
  console.log('Main Theme Name:', theme?.name, 'ID:', theme?.id);
  const file = theme?.files?.nodes?.[0];
  if (file && file.body && file.body.content) {
    const content = file.body.content;
    console.log('settings_data.json length:', content.length);
    console.log('Includes traffiq?:', content.toLowerCase().includes('traffiq'));
    const parsed = JSON.parse(content);
    const blocks = parsed?.current?.blocks || {};
    console.log('All blocks in current:', Object.keys(blocks));
    for (const [k, v] of Object.entries(blocks)) {
      if (JSON.stringify(v).toLowerCase().includes('traffiq') || k.toLowerCase().includes('traffiq')) {
        console.log('FOUND TRAFFIQ BLOCK:', k, JSON.stringify(v));
      }
    }
  } else {
    console.log('File content not found or inaccessible');
  }
}

main().finally(() => prisma.$disconnect());
