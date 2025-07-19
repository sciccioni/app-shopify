// process-excel.js (CommonJS)
// Netlify Function: elabora Excel e confronta con Shopify usando GraphQL per prestazioni migliori

const XLSX = require('xlsx');
const multipart = require('parse-multipart-data');

// Configurazione Shopify via env vars
const SHOPIFY_STORE_NAME = process.env.SHOPIFY_STORE_NAME;
const SHOPIFY_ADMIN_API_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;
const SHOPIFY_API_VERSION = '2024-07';

// Utility per normalizzare Minsan
function normalizeMinsan(minsan) {
  return String(minsan || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .trim();
}

// Esegue una chiamata GraphQL all'Admin API di Shopify
async function callShopifyGraphQL(query, variables = {}) {
  const url = `https://${SHOPIFY_STORE_NAME}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN
    },
    body: JSON.stringify({ query, variables })
  });
  const result = await response.json();
  if (result.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
  }
  return result.data;
}

// Recupera prodotti Shopify via GraphQL filtrando per SKU/Minsan in un'unica chiamata
async function getShopifyProducts(minsans) {
  // Costruiamo query OR di SKU
  const normalizedSkus = minsans.map(normalizeMinsan);
  const queryStrings = normalizedSkus.map(sku => `sku:${sku}`).join(' OR ');
  const graphQLQuery = `
    query fetchBySkus($query: String!) {
      products(first: ${normalizedSkus.length}, query: $query) {
        edges {
          node {
            variants(first:1) {
              edges {
                node {
                  sku
                  price
                  inventoryQuantity
                }
              }
            }
          }
        }
      }
    }
  `;

  const data = await callShopifyGraphQL(graphQLQuery, { query: queryStrings });
  const products = data.products.edges.map(edge => {
    const variant = edge.node.variants.edges[0]?.node || {};
    const skuNorm = normalizeMinsan(variant.sku);
    return {
      minsan: skuNorm,
      Giacenza: variant.inventoryQuantity || 0,
      PrezzoBD: parseFloat(variant.price) || 0
    };
  });
  return products;
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Parsing multipart/form-data
    const contentType = event.headers['content-type'] || event.headers['Content-Type'];
    const boundary = multipart.getBoundary(contentType);
    const parts = multipart.parse(Buffer.from(event.body, 'base64'), boundary);
    const filePart = parts.find(p => p.name === 'excelFile');
    if (!filePart) {
      return { statusCode: 400, body: JSON.stringify({ message: 'Excel mancante nella richiesta.' }) };
    }

    // Lettura Excel in memoria
    const workbook = XLSX.read(filePart.data, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
    const headers = raw[0] || [];
    const rows = raw.slice(1);

    // Mappatura colonne
    const idx = {};
    headers.forEach((h, i) => { idx[String(h).trim()] = i; });

    // Estrazione Minsan e preparazione righe
    const items = [];
    const minsans = [];
    rows.forEach(r => {
      const rawM = r[idx['Minsan']];
      const m = normalizeMinsan(rawM);
      if (m && !m.startsWith('0')) {
        minsans.push(m);
        items.push({ row: r, minsan: m });
      }
    });

    // Fetch Shopify in un'unica chiamata GraphQL
    const shopifyArr = await getShopifyProducts(minsans);
    const shopifyMap = new Map(shopifyArr.map(o => [o.minsan, o]));

    // Costruzione confronto
    const comparison = items.map(({ row, minsan }) => {
      const prod = shopifyMap.get(minsan) || {};
      return {
        Minsan: minsan,
        FileGiacenza: row[idx['Giacenza']] || 0,
        ShopifyGiacenza: prod.Giacenza || 0,
        FilePrezzo: row[idx['PrezzoBD']] || 0,
        ShopifyPrezzo: prod.PrezzoBD || 0
      };
    });

    // Risposta
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        comparisonTableItems: comparison,
        metrics: { totalRows: rows.length, recordsMatched: comparison.length }
      })
    };

  } catch (err) {
    console.error('Error process-excel:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: err.message }) };
  }
};
