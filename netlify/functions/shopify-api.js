// process-excel.js (CommonJS)
// Descrizione: Netlify Function per elaborare file Excel e confrontare con Shopify

const XLSX = require('xlsx');
const multipart = require('parse-multipart-data');
const { getShopifyProducts, normalizeMinsan } = require('./shopify-api');

exports.handler = async function(event, context) {
  // Solo POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // 1) Parse multipart/form-data
    const contentType = event.headers['content-type'] || event.headers['Content-Type'];
    const boundary = multipart.getBoundary(contentType);
    const parts = multipart.parse(Buffer.from(event.body, 'base64'), boundary);

    const filePart = parts.find(p => p.name === 'excelFile');
    if (!filePart) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Nessun file Excel trovato nella richiesta.' })
      };
    }

    // 2) Leggi file Excel
    const workbook = XLSX.read(filePart.data, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
    const headers = raw[0];
    const rows = raw.slice(1);

    // 3) Mappa colonne e normalizza
    const columnIndex = {};
    headers.forEach((h, i) => { columnIndex[h.trim()] = i; });

    const items = [];
    const minsans = [];

    rows.forEach(r => {
      const rawM = String(r[columnIndex['Minsan']] || '').trim();
      const m = normalizeMinsan(rawM);
      if (m && !m.startsWith('0')) {
        minsans.push(m);
        items.push({
          row: r,
          minsan: m
        });
      }
    });

    // 4) Chiamate Shopify in parallelo
    const shopifyResult = await getShopifyProducts(minsans);
    const shopifyMap = new Map();
    shopifyResult.products.forEach(p => {
      shopifyMap.set(String(p.minsan), p);
    });

    // 5) Costruisci confronto e metriche
    const comparison = [];
    items.forEach(({ row, minsan }) => {
      const shop = shopifyMap.get(minsan) || {};
      comparison.push({
        Minsan: minsan,
        FileGiacenza: row[columnIndex['Giacenza']] || 0,
        ShopifyGiacenza: shop.Giacenza || 0,
        FilePrezzo: row[columnIndex['PrezzoBD']] || 0,
        ShopifyPrezzo: shop.PrezzoBD || 0
      });
    });

    // 6) Ritorna JSON
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        comparisonTableItems: comparison,
        metrics: {
          totalRows: rows.length,
          recordsMatched: comparison.length
        }
      })
    };

  } catch (err) {
    console.error('process-excel error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: err.message })
    };
  }
};
