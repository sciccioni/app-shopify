// process-excel.js (CommonJS)
// Netlify Function: elabora Excel e confronta con Shopify senza dipendenze esterne

const XLSX = require('xlsx');
const multipart = require('parse-multipart-data');
const fetch = require('node-fetch');

// Configurazione Shopify
const SHOPIFY_STORE_NAME = process.env.SHOPIFY_STORE_NAME;
const SHOPIFY_ADMIN_API_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;
const SHOPIFY_API_VERSION = '2024-07';

// Utility per normalizzare Minsan
function normalizeMinsan(minsan) {
  if (!minsan) return '';
  return String(minsan).replace(/[^a-zA-Z0-9]/g, '').toUpperCase().trim();
}

// Effettua chiamata all'Admin API di Shopify
async function callShopifyAdminApi(endpoint, method = 'GET', body = null) {
  if (!SHOPIFY_STORE_NAME || !SHOPIFY_ADMIN_API_TOKEN) {
    throw new Error('Shopify environment variables non configurate');
  }
  const url = `https://${SHOPIFY_STORE_NAME}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/${endpoint.replace(/^\//, '')}`;
  const options = { method, headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN
  }};
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(`Shopify API error ${res.status}: ${JSON.stringify(data)}`);
  return { data, headers: res.headers };
}

// Recupera prodotti Shopify per lista di SKU/Minsan in parallelo
async function getShopifyProducts(minsans, limit = 20) {
  // Paginazione semplice: fetch tutti e poi filtra
  let products = [];
  let nextPageInfo;
  let endpoint = `products.json?fields=id,title,variants,metafields&limit=${limit}`;
  do {
    const { data, headers } = await callShopifyAdminApi(endpoint);
    products = products.concat(data.products || []);
    const link = headers.get('link') || headers.get('Link') || '';
    const match = link.match(/page_info=([^&>]+)/);
    nextPageInfo = match && match[1];
    endpoint = nextPageInfo ? `products.json?fields=id,title,variants,metafields&limit=${limit}&page_info=${nextPageInfo}` : null;
  } while (endpoint);

  // Normalizza e seleziona
  const skuSet = new Set(minsans.map(normalizeMinsan));
  const normalized = products.map(prod => {
    // cerca metafield minsan
    const mf = (prod.metafields || []).find(m => m.namespace==='custom_fields' && m.key==='minsan');
    let sku = mf?.value || (prod.variants[0]||{}).sku || '';
    sku = normalizeMinsan(sku);
    const variant = prod.variants.find(v=>normalizeMinsan(v.sku)===sku) || prod.variants[0] || {};
    return { minsan: sku, Giacenza: variant.inventory_quantity||0, PrezzoBD: parseFloat(variant.price||0) };
  }).filter(item => skuSet.has(item.minsan));

  return normalized;
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    // Parse multipart
    const contentType = event.headers['content-type'] || event.headers['Content-Type'];
    const boundary = multipart.getBoundary(contentType);
    const parts = multipart.parse(Buffer.from(event.body, 'base64'), boundary);
    const f = parts.find(p=>p.name==='excelFile');
    if (!f) return { statusCode: 400, body: JSON.stringify({ message:'Excel mancante'}) };

    // Leggi Excel
    const wb = XLSX.read(f.data, { type:'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet,{header:1,raw:true});
    const headers = raw[0]||[];
    const rows = raw.slice(1);

    // Mappatura colonne
    const idx = {}; headers.forEach((h,i)=>idx[String(h).trim()]=i);
    const items = [];
    const minsans = [];
    rows.forEach(r=>{
      const m = normalizeMinsan(String(r[idx['Minsan']]||''));
      if (m && !m.startsWith('0')) { minsans.push(m); items.push({ row:r, minsan:m }); }
    });

    // Fetch Shopify
    const shopifyArr = await getShopifyProducts(minsans);
    const map = new Map(shopifyArr.map(o=>[o.minsan,o]));

    // Costruisci risposta
    const comparison = items.map(({row,minsan})=>({
      Minsan: minsan,
      FileGiacenza: row[idx['Giacenza']]||0,
      ShopifyGiacenza: map.get(minsan)?.Giacenza||0,
      FilePrezzo: row[idx['PrezzoBD']]||0,
      ShopifyPrezzo: map.get(minsan)?.PrezzoBD||0
    }));

    return {
      statusCode:200,
      body: JSON.stringify({comparisonTableItems:comparison, metrics:{totalRows:rows.length, recordsMatched:comparison.length}})
    };
  } catch(e) {
    console.error('Error process-excel:',e);
    return { statusCode:500, body: JSON.stringify({message:e.message}) };
  }
};
