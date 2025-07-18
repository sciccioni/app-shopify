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
        const sheetName = workbook.SheetNames[0]; // Prende il primo foglio
        const sheet = workbook.Sheets[sheetName];

        // *** MODIFICA QUI: Ritorna al metodo standard di sheet_to_json che gestisce gli header automaticamente ***
        // 'header: 1' istruisce a usare la prima riga come header. 'raw: true' mantiene i valori non-stringa come numeri, ecc.
        const rawData = XLSX.utils.sheet_to_json(sheet, { raw: true });

        // Definisci la mappatura delle colonne. Le chiavi sono i nomi nel tuo JSON finale, i valori sono i possibili nomi delle colonne nel tuo Excel.
        const columnMapping = {
            'Ditta': ['Ditta', 'Azienda'],
            'Minsan': ['Minsan', 'CodiceMinsan', 'MINSAN'], // Aggiungi MINSAN se in maiuscolo
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

        const processedProductsMap = new Map();

        for (const rawRow of rawData) {
            // Crea un oggetto riga normalizzato usando la mappatura
            const row = {};
            for (const key in columnMapping) {
                const possibleNames = columnMapping[key];
                for (const name of possibleNames) {
                    if (rawRow[name] !== undefined) {
                        row[key] = rawRow[name];
                        break; // Trovato il valore, passa al prossimo campo
                    }
                    // Aggiungi un controllo per lowercase/uppercase se i nomi variano
                    if (rawRow[name.toLowerCase()] !== undefined) {
                        row[key] = rawRow[name.toLowerCase()];
                        break;
                    }
                    if (rawRow[name.toUpperCase()] !== undefined) {
                        row[key] = rawRow[name.toUpperCase()];
                        break;
                    }
                }
            }

            const minsan = String(row.Minsan || '').trim();
            if (!minsan || minsan.length < 9) {
                console.warn(`Minsan non valido o troppo corto saltato (min 9 cifre): ${row.Minsan || rawRow['Minsan']}`);
                continue;
            }

            const giacenzaRaw = row.Giacenza;
            const giacenza = parseFloat(giacenzaRaw || 0);

            const lotto = String(row.Lotto || '').trim();
            let scadenza = row.Scadenza;

            // Tentativo più robusto di conversione data Excel (numerico) a stringa YYYY-MM-DD
            if (typeof scadenza === 'number' && !isNaN(scadenza)) {
                try {
                    const date = XLSX.SSF.parse_date_code(scadenza);
                    if (date && date.y && date.m && date.d) { // Assicurati che tutti i componenti della data siano validi
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
                    Ditta: String(row.Ditta || '').trim(),
                    Minsan: minsan,
                    EAN: String(row.EAN || '').trim(),
                    Descrizione: String(row.Descrizione || '').trim(),
                    Giacenza: 0, // Verrà sommata
                    Scadenza: null, // Verrà aggiornata con la più recente
                    Lotti: [], // Per tracciare i lotti originali (opzionale)
                    CostoBase: parseFloat(row.CostoBase || 0),
                    CostoMedio: parseFloat(row.CostoMedio || 0),
                    UltimoCostoDitta: parseFloat(row.UltimoCostoDitta || 0),
                    DataUltimoCostoDitta: String(row.DataUltimoCostoDitta || '').trim(),
                    PrezzoBD: parseFloat(row.PrezzoBD || 0),
                    IVA: parseFloat(row.IVA || 0)
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