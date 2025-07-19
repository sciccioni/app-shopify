const XLSX = require('xlsx');
const multipart = require('parse-multipart-data');
// Importa callShopifyAdminApi per le operazioni di creazione/aggiornamento prodotti
const { getShopifyProducts, callShopifyAdminApi } = require('../functions/shopify-api');

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // --- Metriche di Riepilogo ---
    let totalRowsImported = 0;
    let productsToModifyCount = 0;
    let newProductsCount = 0;
    let nonImportableMinsanZeroCount = 0;
    let shopifyOnlyCount = 0; // Prodotti Shopify non nel file, candidati per azzeramento

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

        totalRowsImported = dataRows.length; // Calcola il totale delle righe importate

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

        const getColumnValue = (rowObject, possibleNames) => {
            for (const name of possibleNames) {
                if (rowObject[name] !== undefined && rowObject[name] !== null) {
                    return rowObject[name];
                }
                // Controlla anche versioni lower/upper case se l'header non è mappato esattamente
                if (typeof name === 'string') {
                    const lowerName = name.toLowerCase();
                    // Necessario accedere a rowObject con le chiavi attuali di rawData
                    // che sheet_to_json genera dalla riga header.
                    // Poiché rowObject è già un oggetto chiave-valore,
                    // non c'è bisogno di rawRow[lowerName]. Accedi direttamente a rowObject[lowerName]
                    if (rowObject[lowerName] !== undefined && rowObject[lowerName] !== null) return rowObject[lowerName];
                    const upperName = name.toUpperCase();
                    if (rowObject[upperName] !== undefined && rowObject[upperName] !== null) return rowObject[upperName];
                }
            }
            return undefined;
        };

        const processedProductsMap = new Map();
        const minsanListFromFile = new Set(); // Per i minsan validi da usare nella query Shopify

        for (const rowData of dataRows) {
            // Crea un oggetto riga con header come chiavi e valori come valori, normalizzando le chiavi
            const rowObj = {};
            headers.forEach((header, index) => {
                const normalizedHeader = Object.keys(columnMapping).find(key => 
                    columnMapping[key].includes(header) || 
                    columnMapping[key].includes(header.toLowerCase()) || 
                    columnMapping[key].includes(header.toUpperCase())
                ) || header; // Se non mappa, usa l'header originale
                rowObj[normalizedHeader] = rowData[index];
            });


            const minsan = String(getColumnValue(rowObj, columnMapping.Minsan) || '').trim();

            // --- NUOVA LOGICA DI FILTRO MINSAN ---
            if (!minsan || minsan.length < 9) {
                // Non contiamo come "non importabile" solo i Minsan che iniziano per 0,
                // ma qualsiasi Minsan non valido per la lunghezza.
                // Non abbiamo una metrica esplicita per questo, quindi lo logghiamo.
                console.warn(`Minsan non valido o troppo corto saltato (min 9 cifre): ${minsan}`);
                continue; // Salta la riga
            }
            if (minsan.startsWith('0')) {
                nonImportableMinsanZeroCount++;
                console.warn(`Prodotto non importabile: Minsan inizia per 0 (${minsan})`);
                continue; // Salta la riga
            }
            // --- FINE NUOVA LOGICA DI FILTRO ---

            minsanListFromFile.add(minsan); // Aggiungi il Minsan alla lista per la query Shopify (solo validi)

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
        console.log(`Elaborati ${processedProducts.length} prodotti unici dal file Excel (Minsan validi).`);

        const shopifyApiResult = await getShopifyProducts(Array.from(minsanListFromFile));
        const shopifyProducts = shopifyApiResult.products;

        const productsToUpdateOrCreate = [];
        const shopifyProductsMap = new Map(shopifyProducts.map(p => [p.minsan, p]));

        // --- Calcolo Metriche: Prodotti Nuovi e Da Modificare ---
        for (const fileProd of processedProducts) {
            const shopifyProd = shopifyProductsMap.get(fileProd.Minsan);
            
            // Prepara i metafields da salvare su Shopify (anche per nuovi prodotti)
            const metafields = [
                { namespace: 'custom_fields', key: 'minsan', value: fileProd.Minsan, type: 'single_line_text_field' },
                { namespace: 'custom_fields', key: 'scadenza', value: fileProd.Scadenza || '', type: 'single_line_text_field' },
                { namespace: 'custom_fields', key: 'costo_medio', value: String(fileProd.CostoMedio), type: 'number_decimal' },
                { namespace: 'custom_fields', key: 'iva', value: String(fileProd.IVA), type: 'number_decimal' }
            ];

            if (shopifyProd) {
                // Prodotto esistente: confronta per vedere se è da modificare
                const currentGiacenza = shopifyProd.variants[0]?.inventory_quantity ?? 0;
                const currentPrice = parseFloat(shopifyProd.variants[0]?.price ?? 0); // Prezzo numerico per confronto
                const currentScadenza = shopifyProd.Scadenza || '';
                const currentVendor = shopifyProd.vendor || '';
                const currentCostoMedio = shopifyProd.CostoMedio || 0;
                const currentIVA = shopifyProd.IVA || 0;

                const hasChanges = (fileProd.Giacenza !== currentGiacenza ||
                                    Math.abs(fileProd.PrezzoBD - currentPrice) > 0.001 ||
                                    (fileProd.Scadenza || '') !== currentScadenza ||
                                    (fileProd.Ditta || '') !== currentVendor ||
                                    Math.abs(fileProd.CostoMedio - currentCostoMedio) > 0.001 ||
                                    Math.abs(fileProd.IVA - currentIVA) > 0.001);

                if (hasChanges) {
                    productsToModifyCount++;
                }

                const updatedProduct = {
                    id: shopifyProd.id,
                    vendor: fileProd.Ditta,
                    variants: [{
                        id: shopifyProd.variants[0].id,
                        price: String(fileProd.PrezzoBD),
                        inventory_quantity: fileProd.Giacenza,
                        sku: fileProd.Minsan,
                        barcode: fileProd.EAN || ''
                    }],
                    metafields: metafields
                };
                productsToUpdateOrCreate.push({ type: 'update', product: updatedProduct, status: hasChanges ? 'modified' : 'sincronizzato' });

            } else {
                // Nuovo prodotto
                newProductsCount++;
                const newProduct = {
                    title: fileProd.Descrizione,
                    product_type: "Farmaco",
                    vendor: fileProd.Ditta,
                    variants: [{
                        price: String(fileProd.PrezzoBD),
                        sku: fileProd.Minsan,
                        barcode: fileProd.EAN || '',
                        inventory_quantity: fileProd.Giacenza,
                    }],
                    metafields: metafields
                };
                productsToUpdateOrCreate.push({ type: 'create', product: newProduct, status: 'new' });
            }
        }

        // --- Calcolo Metriche: Prodotti Solo su Shopify ---
        // Identifica i prodotti Shopify che non sono presenti nel file Excel
        // e che hanno una giacenza > 0 (candidati per azzeramento)
        shopifyProducts.forEach(shopifyProd => {
            const minsanFoundInFile = processedProducts.some(p => String(p.Minsan).trim() === String(shopifyProd.minsan).trim());
            if (!minsanFoundInFile && (shopifyProd.variants[0]?.inventory_quantity ?? 0) > 0) {
                shopifyOnlyCount++;
                // Questi prodotti andranno mostrati in tabella con stato 'Solo Shopify' e azione 'Azzera'
                // Non li includiamo direttamente in productsToUpdateOrCreate per ora, ma li tracciamo per le metriche
            }
        });


        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: 'File elaborato e confrontato con successo!',
                processedProducts: processedProducts, // Prodotti dal file (validi Minsan)
                shopifyProducts: shopifyProducts,     // Prodotti da Shopify (filtrati per Minsan del file + altri)
                productsToUpdateOrCreate: productsToUpdateOrCreate, // Prodotti preparati per l'API Shopify (CREATE/UPDATE)
                // --- NUOVE METRICHE ---
                metrics: {
                    totalRowsImported: totalRowsImported,
                    productsToModify: productsToModifyCount,
                    newProducts: newProductsCount,
                    nonImportableMinsanZero: nonImportableMinsanZeroCount,
                    shopifyOnly: shopifyOnlyCount
                }
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