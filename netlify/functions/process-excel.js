// process-excel.js (CommonJS)
// Netlify Function: elabora Excel e confronta con Shopify utilizzando il fetch globale di Node 18+

const XLSX = require('xlsx');
const multipart = require('parse-multipart-data');

// Configurazione Shopify via env vars
const SHOPIFY_STORE_NAME = process.env.SHOPIFY_STORE_NAME;
const SHOPIFY_ADMIN_API_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;
const SHOPIFY_API_VERSION = '2024-07';

// Utility per normalizzare Minsan (rimuove caratteri non alfanumerici, uppercase)
function normalizeMinsan(minsan) {
  if (!minsan) return '';
  return String(minsan).replace(/[^a-zA-Z0-9]/g, '').toUpperCase().trim();
}

// Effettua chiamata all'Admin API di Shopify usando fetch globale
async function callShopifyAdminApi(endpoint, method = 'GET', body = null) {
  if (!SHOPIFY_STORE_NAME || !SHOPIFY_ADMIN_API_TOKEN) {
    throw new Error('Shopify environment variables non configurate');
  }
  const url = `https://${SHOPIFY_STORE_NAME}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/${endpoint.replace(/^\//, '')}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN
    }
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Shopify API error ${res.status}: ${JSON.stringify(data)}`);
  }
  return { data, headers: res.headers };
}

// Recupera prodotti Shopify per lista di Minsan in parallelo
// Recupera prodotti Shopify per lista di Minsan in parallelo con throttling
async function getShopifyProducts(minsans, limit = 20) {
  let products = [];
  let nextPageInfo;
  let endpoint = `products.json?fields=id,title,variants,metafields&limit=${limit}`;
  const skuSet = new Set(minsans.map(normalizeMinsan));

  // Funzione sleep per throttling
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  do {
    // Effettuiamo massimo 1 chiamata ogni 600ms per non superare 2/sec
    await sleep(600);
    let response;
    try {
      response = await callShopifyAdminApi(endpoint);
    } catch (err) {
      if (/429/.test(err.message)) {
        // Se rate limit, aspettiamo e ritentiamo
        console.warn('Shopify rate limit exceeded, retrying after 1000ms');
        await sleep(1000);
        response = await callShopifyAdminApi(endpoint);
      } else {
        throw err;
      }
    }
    const { data, headers } = response;
    products = products.concat(data.products || []);
    const link = headers.get('link') || headers.get('Link') || '';
    const match = link.match(/page_info=([^&>]+)/);
    nextPageInfo = match && match[1];
    endpoint = nextPageInfo ? `products.json?fields=id,title,variants,metafields&limit=${limit}&page_info=${nextPageInfo}` : null;
  } while (endpoint);

  // Normalizza e filtra solo gli Minsan richiesti
  return products.map(prod => {
    const mf = (prod.metafields || []).find(m => m.namespace==='custom_fields' && m.key==='minsan');
    let sku = mf?.value || (prod.variants[0]||{}).sku || '';
    sku = normalizeMinsan(sku);
    const variant = prod.variants.find(v=>normalizeMinsan(v.sku)===sku) || prod.variants[0] || {};
    return { minsan: sku, Giacenza: variant.inventory_quantity||0, PrezzoBD: parseFloat(variant.price||0) };
  }).filter(item => skuSet.has(item.minsan));
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

    // Lettura Excel
    const workbook = XLSX.read(filePart.data, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
    const headers = raw[0] || [];
    const rows = raw.slice(1);

    // Mappatura colonne
    const idx = {};
    headers.forEach((h, i) => { idx[String(h).trim()] = i; });

    // Estrazione Minsan
    const items = [];
    const minsans = [];
    rows.forEach(r => {
      const rawM = String(r[idx['Minsan']] || '');
      const m = normalizeMinsan(rawM);
      if (m && !m.startsWith('0')) {
        minsans.push(m);
        items.push({ row: r, minsan: m });
      }
    });

    // Fetch Shopify
    const shopifyArr = await getShopifyProducts(minsans);
    const shopifyMap = new Map(shopifyArr.map(o => [o.minsan, o]));

    // Costruzione risposta
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

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comparisonTableItems: comparison, metrics: { totalRows: rows.length, recordsMatched: comparison.length } })
    };
  } catch (err) {
    console.error('Error process-excel:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: err.message }) };
  }
};
