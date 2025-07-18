const XLSX = require('xlsx');
const multipart = require('parse-multipart-data');
const { getShopifyProducts } = require('../functions/shopify-api'); // Percorso corretto verso shopify-api.js

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const contentType = event.headers['content-type'];
        if (!contentType || !contentType.includes('multipart/form-data')) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Content-Type must be multipart/form-data' }) };
        }

        // Parsing del file multipart/form-data
        const boundary = multipart.getBoundary(contentType);
        const parts = multipart.parse(Buffer.from(event.body, 'base64'), boundary);

        const filePart = parts.find(p => p.name === 'excelFile');
        if (!filePart) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Nessun file Excel trovato nella richiesta.' }) };
        }

        // Leggi il workbook dal buffer
        const workbook = XLSX.read(filePart.data, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0]; // Prende il primo foglio
        const sheet = workbook.Sheets[sheetName];
        const rawData = XLSX.utils.sheet_to_json(sheet); // Converte in JSON array

        const processedProductsMap = new Map();

        for (const row of rawData) {
            // Pulizia e validazione dei dati
            const minsan = String(row.Minsan || '').trim();
            if (!minsan || minsan.length < 9) {
                console.warn(`Minsan non valido o troppo corto saltato (min 9 cifre): ${row.Minsan}`);
                continue; // Salta la riga
            }

            const giacenza = parseFloat(row.Giacenza || 0);
            const lotto = String(row.Lotto || '').trim();
            let scadenza = String(row.Scadenza || '').trim();

            // Tenta di convertire la scadenza in formato YYYY-MM-DD se è un numero (Excel date)
            if (typeof row.Scadenza === 'number' && !isNaN(row.Scadenza)) {
                // Excel date (numero seriale) to JS Date (da 1899-12-30 per Windows o 1904-01-01 per Mac)
                // Usiamo un piccolo offset per Windows date, assumendo che la maggior parte venga da lì
                const excelDate = new Date(Date.UTC(0, 0, row.Scadenza - 1)); // -1 per adattarsi a 1899-12-30
                scadenza = excelDate.toISOString().split('T')[0]; // Formato YYYY-MM-DD
            }


            // Inizializza o recupera il prodotto nella mappa
            if (!processedProductsMap.has(minsan)) {
                processedProductsMap.set(minsan, {
                    Ditta: String(row.Ditta || '').trim(),
                    Minsan: minsan,
                    EAN: String(row.EAN || '').trim(),
                    Descrizione: String(row.Descrizione || '').trim(),
                    Giacenza: 0, // Verrà sommata
                    Scadenza: null, // Verrà aggiornata con la più recente
                    Lotti: [], // Per tracciare i lotti originali
                    CostoBase: parseFloat(row.CostoBase || 0),
                    CostoMedio: parseFloat(row.CostoMedio || 0),
                    UltimoCostoDitta: parseFloat(row.UltimoCostoDitta || 0),
                    DataUltimoCostoDitta: String(row.DataUltimoCostoDitta || '').trim(), // Assumi come stringa o da convertire
                    PrezzoBD: parseFloat(row.PrezzoBD || 0),
                    IVA: parseFloat(row.IVA || 0)
                });
            }

            const product = processedProductsMap.get(minsan);

            // Somma algebrica della giacenza, trattando giacenze di lotto negative come 0
            product.Giacenza += Math.max(0, giacenza);

            // Gestione della scadenza più recente per il Minsan
            if (scadenza) {
                if (!product.Scadenza || new Date(scadenza) > new Date(product.Scadenza)) {
                    product.Scadenza = scadenza;
                }
            }

            // Traccia i lotti (opzionale, ma utile per audit/dettagli)
            if (lotto) {
                product.Lotti.push({
                    Lotto: lotto,
                    Giacenza: giacenza,
                    Scadenza: scadenza // Scadenza specifica del lotto
                });
            }
        }

        const processedProducts = Array.from(processedProductsMap.values());
        console.log(`Elaborati ${processedProducts.length} prodotti unici dal file Excel.`);

        // Recupera i prodotti esistenti da Shopify
        const shopifyProducts = await getShopifyProducts();
        console.log(`Recuperati ${shopifyProducts.length} prodotti da Shopify.`);


        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: 'File elaborato e confrontato con successo!',
                processedProducts: processedProducts,
                shopifyProducts: shopifyProducts
            }),
        };

    } catch (error) {
        console.error('Errore nella Netlify Function process-excel:', error);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: `Errore del server: ${error.message}` }),
        };
    }
};