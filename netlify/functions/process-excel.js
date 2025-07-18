const XLSX = require('xlsx');
const multipart = require('parse-multipart-data');
const { getShopifyProducts } = require('../functions/shopify-api');

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const contentType = event.headers['content-type'];
        if (!contentType || !contentType.includes('multipart/form-data')) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Content-Type must be multipart/form-data' }) };
        }

        const boundary = multipart.getBoundary(contentType);
        // Netlify Functions riceve il body già come base64 per POST/PUT, quindi Buffer.from è corretto.
        const parts = multipart.parse(Buffer.from(event.body, 'base64'), boundary);

        const filePart = parts.find(p => p.name === 'excelFile');
        if (!filePart) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Nessun file Excel trovato nella richiesta.' }) };
        }

        const workbook = XLSX.read(filePart.data, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0]; // Prende il primo foglio
        const sheet = workbook.Sheets[sheetName];
        // sheet_to_json può prendere un'opzione raw:true per mantenere i numeri delle date come numeri,
        // che è poi gestito dalla funzione di conversione. header:1 se la prima riga è l'header.
        const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }); // Legge la prima riga come header

        // Mappa gli header dalla prima riga (rawData[0]) ai nomi delle colonne desiderati
        const headers = rawData[0];
        const dataRows = rawData.slice(1); // Tutte le righe tranne l'header

        // Mappatura dinamica per tollerare piccole variazioni nel nome delle colonne
        const columnMapping = {
            'Ditta': ['Ditta', 'Azienda'],
            'Minsan': ['Minsan', 'CodiceMinsan'],
            'EAN': ['EAN', 'CodiceEAN'],
            'Descrizione': ['Descrizione', 'Descr', 'NomeProdotto'],
            'Scadenza': ['Scadenza', 'DataScadenza'],
            'Lotto': ['Lotto', 'NumLotto'],
            'Giacenza': ['Giacenza', 'Quantita', 'Disponibilita'],
            'CostoBase': ['CostoBase', 'Costo'],
            'CostoMedio': ['CostoMedio'],
            'UltimoCostoDitta': ['UltimoCostoDitta', 'UltimoCosto'],
            'DataUltimoCostoDitta': ['DataUltimoCostoDitta', 'DataCosto'],
            'PrezzoBD': ['PrezzoBD', 'PrezzoVendita'],
            'IVA': ['IVA', 'Imposta']
        };

        // Funzione helper per trovare il valore della colonna basandosi su più nomi possibili
        const getColumnValue = (rowObj, possibleNames) => {
            for (const name of possibleNames) {
                if (rowObj[name] !== undefined && rowObj[name] !== null) {
                    return rowObj[name];
                }
            }
            return undefined; // Ritorna undefined se nessuna corrispondenza
        };

        const processedProductsMap = new Map();

        for (const rowData of dataRows) {
            // Crea un oggetto riga con header come chiavi e valori come valori
            const rowObj = headers.reduce((acc, header, index) => {
                acc[header] = rowData[index];
                return acc;
            }, {});

            const minsan = String(getColumnValue(rowObj, columnMapping.Minsan) || '').trim();
            if (!minsan || minsan.length < 9) {
                console.warn(`Minsan non valido o troppo corto saltato (min 9 cifre): ${minsan}`);
                continue; // Salta la riga
            }

            const giacenzaRaw = getColumnValue(rowObj, columnMapping.Giacenza);
            const giacenza = parseFloat(giacenzaRaw || 0);

            const lotto = String(getColumnValue(rowObj, columnMapping.Lotto) || '').trim();
            let scadenza = getColumnValue(rowObj, columnMapping.Scadenza);

            // Tentativo più robusto di conversione data Excel (numerico) a stringa YYYY-MM-DD
            if (typeof scadenza === 'number' && !isNaN(scadenza)) {
                try {
                    const date = XLSX.SSF.parse_date_code(scadenza);
                    if (date) {
                        scadenza = `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
                    } else {
                        scadenza = String(scadenza).trim(); // Fallback
                    }
                } catch (e) {
                    console.warn(`Errore durante la conversione della data Excel per Minsan ${minsan}: ${scadenza}. Usando la stringa originale.`, e);
                    scadenza = String(scadenza || '').trim(); // Fallback alla stringa originale
                }
            } else {
                scadenza = String(scadenza || '').trim(); // Assicura che sia una stringa
            }


            // Inizializza o recupera il prodotto nella mappa
            if (!processedProductsMap.has(minsan)) {
                processedProductsMap.set(minsan, {
                    Ditta: String(getColumnValue(rowObj, columnMapping.Ditta) || '').trim(),
                    Minsan: minsan,
                    EAN: String(getColumnValue(rowObj, columnMapping.EAN) || '').trim(),
                    Descrizione: String(getColumnValue(rowObj, columnMapping.Descrizione) || '').trim(),
                    Giacenza: 0, // Verrà sommata
                    Scadenza: null, // Verrà aggiornata con la più recente
                    Lotti: [], // Per tracciare i lotti originali (opzionale)
                    CostoBase: parseFloat(getColumnValue(rowObj, columnMapping.CostoBase) || 0),
                    CostoMedio: parseFloat(getColumnValue(rowObj, columnMapping.CostoMedio) || 0),
                    UltimoCostoDitta: parseFloat(getColumnValue(rowObj, columnMapping.UltimoCostoDitta) || 0),
                    DataUltimoCostoDitta: String(getColumnValue(rowObj, columnMapping.DataUltimoCostoDitta) || '').trim(), // Assumi come stringa o da convertire
                    PrezzoBD: parseFloat(getColumnValue(rowObj, columnMapping.PrezzoBD) || 0),
                    IVA: parseFloat(getColumnValue(rowObj, columnMapping.IVA) || 0)
                });
            }

            const product = processedProductsMap.get(minsan);

            // Somma algebrica della giacenza, trattando giacenze di lotto negative come 0
            product.Giacenza += Math.max(0, giacenza);

            // Gestione della scadenza più recente per il Minsan
            if (scadenza && scadenza !== '-') { // Evita di considerare '-' come una data valida
                const currentProductScadenzaDate = product.Scadenza ? new Date(product.Scadenza) : null;
                const newScadenzaDate = new Date(scadenza);

                if (!currentProductScadenzaDate || newScadenzaDate > currentProductScadenzaDate) {
                    product.Scadenza = scadenza;
                }
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