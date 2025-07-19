const XLSX = require('xlsx');
const multipart = require('parse-multipart-data');
const { getShopifyProducts, callShopifyAdminApi, normalizeMinsan } = require('../functions/shopify-api');

exports.handler = async (event, context) => {
    // --- Metriche di Riepilogo ---
    let totalRowsImported = 0;
    let productsToModifyCount = 0;
    let newProductsCount = 0;
    let nonImportableMinsanZeroCount = 0; // Contatore per Minsan che iniziano per 0
    let shopifyOnlyCount = 0; // Prodotti Shopify non nel file, candidati per azzeramento

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
                if (typeof name === 'string') {
                    const lowerName = name.toLowerCase();
                    if (rowObject[lowerName] !== undefined && rowObject[lowerName] !== null) return rowObject[lowerName];
                    const upperName = name.toUpperCase();
                    if (rowObject[upperName] !== undefined && rowObject[upperName] !== null) return rowObject[upperName];
                }
            }
            return undefined;
        };

        const processedProductsMap = new Map();
        const minsanListForShopifyQuery = new Set(); // Minsan normalizzati per la query Shopify

        for (const rowData of dataRows) {
            const rowObj = {};
            headers.forEach((header, index) => {
                const normalizedHeader = Object.keys(columnMapping).find(key => 
                    columnMapping[key].includes(header) || 
                    columnMapping[key].includes(header.toLowerCase()) || 
                    columnMapping[key].includes(header.toUpperCase())
                ) || header;
                rowObj[normalizedHeader] = rowData[index];
            });

            const rawMinsanFromFile = String(getColumnValue(rowObj, columnMapping.Minsan) || '').trim();
            const minsan = normalizeMinsan(rawMinsanFromFile); // Normalizza il Minsan del file

            let isMinsanStartingWithZero = false; // Flag per Minsan che inizia per 0 (reale)

            // --- LOGICA DI FILTRO MINSAN (Solo se inizia REALMENTE con '0') ---
            if (!minsan || minsan.length < 9) {
                console.warn(`[PROCESS_EXCEL] Minsan non valido o troppo corto saltato (min 9 cifre): ${rawMinsanFromFile}`);
                continue; // Queste righe vengono ancora saltate
            }
            if (minsan.startsWith('0')) { // Questa condizione cattura solo i VERI Minsan che iniziano per 0
                nonImportableMinsanZeroCount++;
                isMinsanStartingWithZero = true; // Flagga la riga
                console.warn(`[PROCESS_EXCEL] Minsan problematico (inizia per 0): ${minsan}`);
            }
            // --- FINE LOGICA DI FILTRO ---

            minsanListForShopifyQuery.add(minsan); // Aggiungi il Minsan normalizzato alla lista per la query Shopify

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
                    console.warn(`[PROCESS_EXCEL] Errore durante la conversione della data Excel per Minsan ${minsan}: ${scadenza}. Usando la stringa originale.`, e);
                    scadenza = String(scadenza || '').trim();
                }
            } else {
                scadenza = String(scadenza || '').trim();
            }

            if (!processedProductsMap.has(minsan)) {
                processedProductsMap.set(minsan, {
                    Ditta: String(getColumnValue(rowObj, columnMapping.Ditta) || '').trim(),
                    Minsan: minsan, // Salva il Minsan normalizzato
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
                    IVA: parseFloat(getColumnValue(rowObj, columnMapping.IVA) || 0),
                    isMinsanStartingWithZero: isMinsanStartingWithZero // NUOVO: Flag reale per Minsan che inizia per 0
                });
            }

            const product = processedProductsMap.get(minsan);

            product.Giacenza += Math.max(0, giacenza);

            if (scadenza && scadenza !== '-') {
                const currentProductScadenzaDate = product.Scadenza ? new Date(product.Scadenza) : null;
                const newScadenzaDate = new Date(scadenza);

                if (!currentProductScadenzaDate || newScadenzaDate > currentScadenzaDate) {
                    product.Scadenza = scadenza;
                }
            }
        }

        const processedProducts = Array.from(processedProductsMap.values());
        console.log(`[PROCESS_EXCEL] Elaborati ${processedProducts.length} prodotti unici dal file Excel (Minsan validi).`);
        console.log(`[PROCESS_EXCEL] Minsan totali normalizzati dal file per query Shopify: ${minsanListForShopifyQuery.size}`);
        // console.log(`[PROCESS_EXCEL] Lista Minsan normalizzati dal file:`, Array.from(minsanListForShopifyQuery));

        const shopifyApiResult = await getShopifyProducts(Array.from(minsanListForShopifyQuery));
        const shopifyProducts = shopifyApiResult.products;

        const productsToUpdateOrCreate = []; // Qui i prodotti preparati per le API Shopify
        const comparisonTableItems = []; // Qui gli items per la tabella di confronto del frontend

        const shopifyProductsMap = new Map(shopifyProducts.map(p => [String(p.minsan).trim(), p]));

        // --- Calcolo Metriche e Preparazione Dati per Frontend e API ---
        for (const fileProd of processedProducts) {
            const minsan = String(fileProd.Minsan).trim(); // Minsan già normalizzato dal file
            const shopifyProd = shopifyProductsMap.get(minsan);
            
            // Determina lo stato iniziale e se richiede approvazione
            let status = 'sincronizzato'; // Default
            let hasChanges = false;
            let type = 'product'; // Tipo per la tabella di confronto


            // Logica per determinare lo status e le modifiche
            if (shopifyProd) {
                // Prodotto esistente: confronta per vedere se è da modificare
                const currentGiacenza = shopifyProd.variants[0]?.inventory_quantity ?? 0;
                const currentPrice = parseFloat(shopifyProd.variants[0]?.price ?? 0);
                const currentScadenza = shopifyProd.Scadenza || '';
                const currentVendor = shopifyProd.vendor || '';
                const currentCostoMedio = shopifyProd.CostoMedio || 0;
                const currentIVA = shopifyProd.IVA || 0;

                hasChanges = (fileProd.Giacenza !== currentGiacenza ||
                                    Math.abs(fileProd.PrezzoBD - currentPrice) > 0.001 ||
                                    (fileProd.Scadenza || '') !== currentScadenza ||
                                    (fileProd.Ditta || '') !== currentVendor ||
                                    Math.abs(fileProd.CostoMedio - currentCostoMedio) > 0.001 ||
                                    Math.abs(fileProd.IVA - currentIVA) > 0.001);

                if (hasChanges) {
                    productsToModifyCount++;
                    status = 'modificato';
                } else {
                    status = 'sincronizzato';
                }

                // Prepara per l'aggiornamento API
                productsToUpdateOrCreate.push({
                    type: 'update',
                    product: {
                        id: shopifyProd.id,
                        vendor: fileProd.Ditta, // Aggiorna anche il vendor/ditta se presente
                        variants: [{
                            id: shopifyProd.variants[0].id,
                            price: String(fileProd.PrezzoBD),
                            inventory_quantity: fileProd.Giacenza,
                            sku: fileProd.Minsan,
                            barcode: fileProd.EAN || ''
                        }],
                        metafields: [
                            { namespace: 'custom_fields', key: 'minsan', value: minsan, type: 'single_line_text_field' },
                            { namespace: 'custom_fields', key: 'scadenza', value: fileProd.Scadenza || '', type: 'single_line_text_field' },
                            { namespace: 'custom_fields', key: 'costo_medio', value: String(fileProd.CostoMedio), type: 'number_decimal' },
                            { namespace: 'custom_fields', key: 'iva', value: String(fileProd.IVA), type: 'number_decimal' }
                        ]
                    },
                    status: status // Il suo status finale
                });

            } else {
                // Nuovo prodotto (Minsan dal file non trovato su Shopify dopo normalizzazione)
                newProductsCount++;
                status = 'nuovo';
                
                // Prepara per la creazione API
                productsToUpdateOrCreate.push({
                    type: 'create',
                    product: {
                        title: fileProd.Descrizione,
                        product_type: "Farmaco",
                        vendor: fileProd.Ditta,
                        variants: [{
                            price: String(fileProd.PrezzoBD),
                            sku: fileProd.Minsan,
                            barcode: fileProd.EAN || '',
                            inventory_quantity: fileProd.Giacenza,
                        }],
                        metafields: [
                            { namespace: 'custom_fields', key: 'minsan', value: minsan, type: 'single_line_text_field' },
                            { namespace: 'custom_fields', key: 'scadenza', value: fileProd.Scadenza || '', type: 'single_line_text_field' },
                            { namespace: 'custom_fields', key: 'costo_medio', value: String(fileProd.CostoMedio), type: 'number_decimal' },
                            { namespace: 'custom_fields', key: 'iva', value: String(fileProd.IVA), type: 'number_decimal' }
                        ]
                    },
                    status: status // Il suo status finale
                });
            }

            // --- GESTIONE STATUS "NON IMPORTABILE (MINSAN 0)" per la Tabella ---
            if (fileProd.isMinsanStartingWithZero) { // Questo flag viene dal parsing iniziale
                status = 'non-importabile'; // Forze lo status per la tabella di confronto
                hasChanges = false; // Non è una "modifica" da approvare nel senso tradizionale
            }

            // Aggiungi l'elemento alla lista per la tabella di confronto del frontend
            comparisonTableItems.push({
                type: 'product', // È un prodotto reale
                fileData: fileProd,
                shopifyData: shopifyProd, // Potrebbe essere null
                status: status, // Questo è lo status che vedrai in tabella
                hasChanges: hasChanges // Indica se richiede approvazione (per bottoni)
            });
        }

        // --- Calcolo Metriche: Prodotti Solo su Shopify (che non erano nel file e con giacenza > 0) ---
        shopifyProducts.forEach(shopifyProd => {
            const minsanFoundInFile = processedProducts.some(p => String(p.Minsan).trim() === String(shopifyProd.minsan).trim());
            if (!minsanFoundInFile && (shopifyProd.variants[0]?.inventory_quantity ?? 0) > 0) {
                shopifyOnlyCount++;
                // Questi prodotti andranno mostrati in tabella con status 'shopify-only'
                 comparisonTableItems.push({
                    type: 'product', // È un prodotto reale
                    fileData: null,
                    shopifyData: shopifyProd,
                    status: 'shopify-only',
                    hasChanges: true // Richiede azzeramento
                });
            } else if (!minsanFoundInFile && (shopifyProd.variants[0]?.inventory_quantity ?? 0) === 0) {
                // Prodotto Shopify non nel file e già azzerato
                 comparisonTableItems.push({
                    type: 'product',
                    fileData: null,
                    shopifyData: shopifyProd,
                    status: 'sincronizzato (giacenza 0)',
                    hasChanges: false
                });
            }
        });

        // La riga di riepilogo "Non Importabile" sarà generata nel frontend se metrics.nonImportableMinsanZero > 0

        console.log(`[PROCESS_EXCEL] Riepilogo Metriche:
        - Righe Importate (dal file, Minsan validi): ${totalRowsImported}
        - Prodotti Nuovi (da creare): ${newProductsCount}
        - Prodotti Modificati (da aggiornare): ${productsToModifyCount}
        - Prodotti Solo Shopify (da azzerare): ${shopifyOnlyCount}
        - Minsan Non Importabili (iniziano per 0): ${nonImportableMinsanZeroCount}`);


        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: 'File elaborato e confrontato con successo!',
                comparisonTableItems: comparisonTableItems, 
                productsToUpdateOrCreate: productsToUpdateOrCreate, // Dati preparati per l'API Shopify (CREATE/UPDATE)
                metrics: { // Le metriche definitive
                    totalRowsImported: totalRowsImported,
                    newProducts: newProductsCount,
                    productsToModify: productsToModifyCount,
                    nonImportableMinsanZero: nonImportableMinsanZeroCount,
                    shopifyOnly: shopifyOnlyCount
                }
            }),
        };

    } catch (error) {
        console.error('[PROCESS_EXCEL] Errore nella Netlify Function process-excel:', error);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: `Errore del server: ${error.message}` }),
        };
    }
};