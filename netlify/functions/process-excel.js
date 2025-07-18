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
        const parts = multipart.parse(Buffer.from(event.body, 'base64'), boundary);

        const filePart = parts.find(p => p.name === 'excelFile');
        if (!filePart) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Nessun file Excel trovato nella richiesta.' }) };
        }

        const workbook = XLSX.read(filePart.data, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

        const headers = rawData[0];
        const dataRows = rawData.slice(1);

        const columnMapping = {
            'Ditta': ['Ditta', 'Azienda'],
            'Minsan': ['Minsan', 'CodiceMinsan', 'MINSAN'],
            'EAN': ['EAN', 'CodiceEAN', 'CODICE_EAN'],
            'Descrizione': ['Descrizione', 'Descr', 'NomeProdotto'],
            'Scadenza': ['Scadenza', 'DataScadenza', 'SCADENZA'],
            'Lotto': ['Lotto', 'NumLotto', 'LOTTO'],
            'Giacenza': ['Giacenza', 'Quantita', 'Disponibilita'],
            'CostoBase': ['CostoBase', 'Costo', 'COSTO_BASE'],
            'CostoMedio': ['CostoMedio', 'COSTO_MEDIO'],
            'UltimoCostoDitta': ['UltimoCostoDitta', 'UltimoCosto', 'ULTIMO_COSTO_DITTA'],
            'DataUltimoCostoDitta': ['DataUltimoCostoDitta', 'DataCosto', 'DATA_ULTIMO_COSTO_DITTA'],
            'PrezzoBD': ['PrezzoBD', 'PrezzoVendita', 'PREZZO_BD'],
            'IVA': ['IVA', 'Imposta']
        };

        // Funzione helper per trovare il valore della colonna basandosi su più nomi possibili
        // Ora prende 'rowObject' come parametro, non si aspetta 'rawRow' dall'esterno.
        const getColumnValue = (rowObject, possibleNames) => {
            for (const name of possibleNames) {
                if (rowObject[name] !== undefined && rowObject[name] !== null) {
                    return rowObject[name];
                }
                // Prova anche versioni upper/lower case nel caso l'header non sia mappato esattamente
                if (typeof name === 'string') {
                    const lowerName = name.toLowerCase();
                    // Assicurati che 'rowObject' sia usato qui
                    if (rowObject[lowerName] !== undefined && rowObject[lowerName] !== null) return rowObject[lowerName];
                    const upperName = name.toUpperCase();
                    // Assicurati che 'rowObject' sia usato qui
                    if (rowObject[upperName] !== undefined && rowObject[upperName] !== null) return rowObject[upperName];
                }
            }
            return undefined;
        };

        const processedProductsMap = new Map();
        const minsanListFromFile = new Set();

        for (const rowData of dataRows) {
            const rowObj = headers.reduce((acc, header, index) => {
                acc[header] = rowData[index];
                return acc;
            }, {});

            const minsan = String(getColumnValue(rowObj, columnMapping.Minsan) || '').trim();
            if (!minsan || minsan.length < 9) {
                console.warn(`Minsan non valido o troppo corto saltato (min 9 cifre): ${minsan}`);
                continue;
            }
            minsanListFromFile.add(minsan);

            const giacenzaRaw = getColumnValue(rowObj, columnMapping.Giacenza);
            const giacenza = parseFloat(giacenzaRaw || 0);

            const lotto = String(getColumnValue(rowObj, columnMapping.Lotto) || '').trim();
            let scadenza = getColumnValue(rowObj, columnMapping.Scadenza);

            if (typeof scadenza === 'number' && !isNaN(scadenza)) {
                try {
                    const date = XLSX.SSF.parse_date_code(scadenza);
                    if (date && date.y && date.m && date.d) {
                        scadenza = `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
                    } else {
                        scadenza = String(scadenza).trim();
                    }
                } catch (e) {
                    console.warn(`Errore durante la conversione della data Excel per Minsan ${minsan}: ${scadenza}. Usando la stringa originale.`, e);
                    scadenza = String(scadenza || '').trim();
                }
            } else {
                scadenza = String(scadenza || '').trim();
            }

            if (!processedProductsMap.has(minsan)) {
                processedProductsMap.set(minsan, {
                    Ditta: String(getColumnValue(rowObj, columnMapping.Ditta) || '').trim(),
                    Minsan: minsan,
                    EAN: String(getColumnValue(rowObj, columnMapping.EAN) || '').trim(),
                    Descrizione: String(getColumnValue(rowObj, columnMapping.Descrizione) || '').trim(),
                    Giacenza: 0,
                    Scadenza: null,
                    Lotti: [],
                    CostoBase: parseFloat(getColumnValue(rowObj, columnMapping.CostoBase) || 0),
                    CostoMedio: parseFloat(getColumnValue(rowObj, columnMapping.CostoMedio) || 0),
                    UltimoCostoDitta: parseFloat(getColumnValue(rowObj, columnMapping.UltimoCostoDitta) || 0),
                    DataUltimoCostoDitta: String(getColumnValue(rowObj, columnMapping.DataUltimoCostoDitta) || '').trim(),
                    PrezzoBD: parseFloat(getColumnValue(rowObj, columnMapping.PrezzoBD) || 0),
                    IVA: parseFloat(getColumnValue(rowObj, columnMapping.IVA) || 0)
                });
            }

            const product = processedProductsMap.get(minsan);

            product.Giacenza += Math.max(0, giacenza);

            if (scadenza && scadenza !== '-') {
                const currentProductScadenzaDate = product.Scadenza ? new Date(product.Scadenza) : null;
                const newScadenzaDate = new Date(scadenza);

                if (!currentProductScadenzaDate || newScadenzaDate > currentProductScadenzaDate) {
                    product.Scadenza = scadenza;
                }
            }
        }

        const processedProducts = Array.from(processedProductsMap.values());
        console.log(`Elaborati ${processedProducts.length} prodotti unici dal file Excel.`);

        const shopifyProducts = await getShopifyProducts(Array.from(minsanListFromFile));
        console.log(`Recuperati ${shopifyProducts.length} prodotti da Shopify (filtrati per Minsan del file).`);

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