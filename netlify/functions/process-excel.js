// process-excel.js (CommonJS)
// Netlify Function: gestisce l'upload Excel e confronto con Shopify

const XLSX = require('xlsx');
const multipart = require('parse-multipart-data');
const { getShopifyProducts } = require('./shopify-api');

// Utility per normalizzare Minsan (rimuove caratteri non alfanumerici, uppercase)
function normalizeMinsan(minsan) {
  if (!minsan) return '';
  return String(minsan).replace(/[^a-zA-Z0-9]/g, '').toUpperCase().trim();
}

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Parse multipart/form-data
    const contentType = event.headers['content-type'] || event.headers['Content-Type'];
    const boundary = multipart.getBoundary(contentType);
    const parts = multipart.parse(Buffer.from(event.body, 'base64'), boundary);
    const filePart = parts.find(p => p.name === 'excelFile');
    if (!filePart) {
      return { statusCode: 400, body: JSON.stringify({ message: 'Nessun file Excel trovato.' }) };
    }

    // Leggi e parsifica Excel
    const workbook = XLSX.read(filePart.data, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
    const headers = raw[0];
    const rows = raw.slice(1);

    // Mappa header verso indice
    const columnIndex = {};
    headers.forEach((h, i) => { columnIndex[String(h).trim()] = i; });

    // Estrai righe e Minsans
    const items = [];
    const minsans = [];
    rows.forEach(r => {
      const rawM = String(r[columnIndex['Minsan']] || '');
      const m = normalizeMinsan(rawM);
      if (m && !m.startsWith('0')) {
        minsans.push(m);
        items.push({ row: r, minsan: m });
      }
    });

    // Chiamate Shopify in parallelo
    const shopifyResult = await getShopifyProducts(minsans);
    const shopifyMap = new Map();
    shopifyResult.products.forEach(p => shopifyMap.set(p.minsan, p));

    // Costruisci risultato confronto
    const comparison = items.map(({ row, minsan }) => {
      const product = shopifyMap.get(minsan) || {};
      return {
        Minsan: minsan,
        FileGiacenza: row[columnIndex['Giacenza']] || 0,
        ShopifyGiacenza: product.Giacenza || 0,
        FilePrezzo: row[columnIndex['PrezzoBD']] || 0,
        ShopifyPrezzo: product.PrezzoBD || 0
      };
    });

    // Ritorna JSON con dati e metriche
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        comparisonTableItems: comparison,
        metrics: { totalRows: rows.length, recordsMatched: comparison.length }
      })
    };

  } catch (err) {
    console.error('process-excel error:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: err.message }) };
  }
};
