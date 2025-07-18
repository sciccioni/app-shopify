const XLSX = require('xlsx');
const multipart = require('parse-multipart-data');
// Importiamo getShopifyProducts con la sua nuova capacità di filtraggio
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
        const sheetName = workbook.SheetNames[0]; // Prende il primo foglio
        const sheet = workbook.Sheets[sheetName];

        // sheet_to_json con header:1 per leggere la prima riga come intestazione e raw:true per tipi originali
        const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

        // Mappa gli header dalla prima riga (rawData[0]) ai nomi delle colonne desiderati
        const headers = rawData[0];
        const dataRows = rawData.slice(1); // Tutte le righe tranne l'header

        // Mappatura dinamica per tollerare piccole variazioni nel nome delle colonne
        const columnMapping = {
            'Ditta': ['Ditta', 'Azienda'],
            'Minsan': ['Minsan', 'CodiceMinsan', 'MINSAN'], // Aggiungi maiuscole per maggiore compatibilità
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
        const getColumnValue = (rowObj, possibleNames) => {
            for (const name of possibleNames) {
                if (rowObj[name] !== undefined && rowObj[name] !== null) {
                    return rowObj[name];
                }
                // Prova anche versioni upper/lower case nel caso l'header non sia mappato esattamente
                if (typeof name === 'string') {
                    const lowerName = name.toLowerCase();
                    if (rawRow[lowerName] !== undefined && rawRow[lowerName] !== null) return rawRow[lowerName];
                    const upperName = name.toUpperCase();
                    if (rawRow[upperName] !== undefined && rawRow[upperName] !== null) return rawRow[upperName];
                }
            }
            return undefined; // Ritorna undefined se nessuna corrispondenza
        };

        const processedProductsMap = new Map();
        const minsanListFromFile = new Set(); // Per raccogliere tutti i Minsan unici dal file

        for (const rowData of dataRows) {
            // Crea un oggetto riga con header come chiavi e valori come valori
            const rawRow = headers.reduce((acc, header, index) => {
                acc[header] = rowData[index];
                return acc;
            }, {});

            // Estrai i valori usando la mappatura
            const minsan = String(getColumnValue(rawRow, columnMapping.Minsan) || '').trim();
            if (!minsan || minsan.length < 9) {
                console.warn(`Minsan non valido o troppo corto saltato (min 9 cifre): ${minsan}`);
                continue;
            }
            minsanListFromFile.add(minsan); // Aggiungi il Minsan alla lista

            const giacenzaRaw = getColumnValue(rawRow, columnMapping.Giacenza);
            const giacenza = parseFloat(giacenzaRaw || 0);

            const lotto = String(getColumnValue(rawRow, columnMapping.Lotto) || '').trim();
            let scadenza = getColumnValue(rawRow, columnMapping.Scadenza);

            // Tentativo più robusto di conversione data Excel (numerico) a stringa YYYY-MM-DD
            if (typeof scadenza === 'number' && !isNaN(scadenza)) {
                try {
                    const date = XLSX.SSF.parse_date_code(scadenza);
                    if (date && date.y && date.m && date.d) {
                        scadenza = `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
                    } else {
                        scadenza = String(scadenza).trim(); // Fallback
                    }
                } catch (e) {
                    console.warn(`Errore durante la conversione della data Excel per Minsan ${minsan}: ${scadenza}. Usando la stringa originale.`, e);
                    scadenza = String(scadenza || '').trim(); // Fallback
                }
            } else {
                scadenza = String(scadenza || '').trim(); // Assicura che sia una stringa
            }


            // Inizializza o recupera il prodotto nella mappa
            if (!processedProductsMap.has(minsan)) {
                processedProductsMap.set(minsan, {
                    Ditta: String(getColumnValue(rawRow, columnMapping.Ditta) || '').trim(),
                    Minsan: minsan,
                    EAN: String(getColumnValue(rawRow, columnMapping.EAN) || '').trim(),
                    Descrizione: String(getColumnValue(rawRow, columnMapping.Descrizione) || '').trim(),
                    Giacenza: 0, // Verrà sommata
                    Scadenza: null, // Verrà aggiornata con la più recente
                    Lotti: [], // Per tracciare i lotti originali (opzionale)
                    CostoBase: parseFloat(getColumnValue(rawRow, columnMapping.CostoBase) || 0),
                    CostoMedio: parseFloat(getColumnValue(rawRow, columnMapping.CostoMedio) || 0),
                    UltimoCostoDitta: parseFloat(getColumnValue(rawRow, columnMapping.UltimoCostoDitta) || 0),
                    DataUltimoCostoDitta: String(getColumnValue(rawRow, columnMapping.DataUltimoCostoDitta) || '').trim(),
                    PrezzoBD: parseFloat(getColumnValue(rawRow, columnMapping.PrezzoBD) || 0),
                    IVA: parseFloat(getColumnValue(rawRow, columnMapping.IVA) || 0)
                });
            }

            const product = processedProductsMap.get(minsan);

            // Somma algebrica della giacenza, trattando giacenze di lotto negative come 0
            product.Giacenza += Math.max(0, giacenza);

            // Gestione della scadenza più recente per il Minsan
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

        // Passa la lista dei Minsan unici alla funzione getShopifyProducts per ottimizzare il recupero
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