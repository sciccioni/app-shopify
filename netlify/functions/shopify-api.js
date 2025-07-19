const SHOPIFY_STORE_NAME = process.env.SHOPIFY_STORE_NAME;
const SHOPIFY_ADMIN_API_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;
const SHOPIFY_API_VERSION = '2024-07';

/**
 * Normalizza un codice Minsan rimuovendo caratteri non alfanumerici e convertendo a maiuscolo.
 * @param {string} minsan - Il codice Minsan da normalizzare.
 * @returns {string} Il codice Minsan normalizzato.
 */
function normalizeMinsan(minsan) {
    if (!minsan) return '';
    // Rimuove tutti i caratteri che non sono lettere o numeri, e converte a maiuscolo
    return String(minsan).replace(/[^a-zA-Z0-9]/g, '').toUpperCase().trim();
}

/**
 * Funzione per effettuare richieste all'Admin API di Shopify.
 * @param {string} endpoint - L'endpoint dell'API (es. 'products.json', 'products/{id}.json')
 * @param {string} method - Metodo HTTP (GET, POST, PUT, DELETE)
 * @param {object} [body=null] - Corpo della richiesta per POST/PUT.
 * @returns {Promise<object>} - La risposta dell'API.
 * @throws {Error} Se la richiesta fallisce o la risposta non è OK.
 */
async function callShopifyAdminApi(endpoint, method = 'GET', body = null) {
    if (!SHOPIFY_STORE_NAME || !SHOPIFY_ADMIN_API_TOKEN) {
        throw new Error('Variabili d\'ambiente Shopify non configurate (SHOPIFY_STORE_NAME o SHOPIFY_ADMIN_API_TOKEN).');
    }

    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
    const url = `https://${SHOPIFY_STORE_NAME}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/${cleanEndpoint}`;
    const options = {
        method: method,
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
        },
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    console.log(`Shopify API Call: ${method} ${url}`);
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Shopify API Error (${response.status} ${response.statusText}): ${errorText}`);
            throw new Error(`Shopify API Error: ${response.status} - ${errorText}`);
        }
        return { json: await response.json(), headers: response.headers };
    } catch (error) {
        console.error('Errore nella chiamata Shopify API:', error.message);
        throw error;
    }
}

/**
 * Recupera i prodotti Shopify, opzionalmente filtrando per un elenco di SKU/Minsan o per paginazione.
 *
 * @param {Array<string>} [skusToFetch=[]] - Array di SKU/Minsan da cercare. Se vuoto, non filtra per SKU.
 * @param {string} [pageInfo=null] - Cursore 'page_info' per la paginazione Shopify.
 * @param {number} [limit=20] - Numero di prodotti da recuperare per pagina.
 * @returns {Promise<{products: Array<object>, nextPageInfo: string|null, prevPageInfo: string|null}>} Oggetto con prodotti, e info per la paginazione.
 * @throws {Error} Se il recupero fallisce.
 */
async function getShopifyProducts(skusToFetch = [], pageInfo = null, limit = 20) {
    let products = [];
    let queryParams = `fields=id,title,handle,vendor,variants,metafields&limit=${limit}`;

    if (pageInfo) {
        queryParams += `&page_info=${pageInfo}`;
    }

    let endpoint = `products.json?${queryParams}`;

    let nextPageInfo = null;
    let prevPageInfo = null;

    try {
        console.log(`[SHOPIFY_API] Fetching Shopify products with pagination: ${endpoint}`);
        const responseData = await callShopifyAdminApi(endpoint);
        products = responseData.json.products;

        const linkHeader = responseData.headers.get('Link');
        if (linkHeader) {
            const parts = linkHeader.split(',');
            const nextPart = parts.find(p => p.includes('rel="next"'));
            const prevPart = parts.find(p => p.includes('rel="previous"'));

            if (nextPart) {
                const urlMatch = nextPart.match(/page_info=(.*?)[&>]/);
                if (urlMatch && urlMatch[1]) {
                    nextPageInfo = urlMatch[1];
                }
            }
            if (prevPart) {
                const urlMatch = prevPart.match(/page_info=(.*?)[&>]/);
                if (urlMatch && urlMatch[1]) {
                    prevPageInfo = urlMatch[1];
                }
            }
        }

        // Normalizza i prodotti Shopify
        const normalizedProducts = products.map(product => {
            const variant = product.variants && product.variants.length > 0 ? product.variants[0] : {};

            // Recupera i metafields per Minsan, Scadenza, CostoMedio e IVA
            const minsanMetafield = product.metafields?.find(m => m.key === 'minsan' && m.namespace === 'custom_fields');
            const scadenzaMetafield = product.metafields?.find(m => m.key === 'scadenza' && m.namespace === 'custom_fields');
            const costoMedioMetafield = product.metafields?.find(m => m.key === 'costo_medio' && m.namespace === 'custom_fields');
            const ivaMetafield = product.metafields?.find(m => m.key === 'iva' && m.namespace === 'custom_fields');

            // --- MODIFICA QUI: Normalizza il Minsan estratto da Shopify ---
            const normalizedMinsan = normalizeMinsan(minsanMetafield?.value || variant.sku || String(product.id));

            console.log(`[SHOPIFY_API] Prodotto Shopify: ${product.title} (ID: ${product.id}) -> Minsan estratto: "${normalizedMinsan}" (da Metafield: ${!!minsanMetafield}, da SKU: ${!!variant.sku})`);
            // --- FINE MODIFICA ---

            return {
                id: product.id,
                title: product.title,
                handle: product.handle,
                vendor: product.vendor || '-',
                minsan: normalizedMinsan, // Usa il Minsan normalizzato
                variants: product.variants,
                Giacenza: variant.inventory_quantity || 0,
                PrezzoBD: parseFloat(variant.price || 0),
                Scadenza: scadenzaMetafield?.value || null,
                CostoMedio: parseFloat(costoMedioMetafield?.value || 0),
                IVA: parseFloat(ivaMetafield?.value || 0),
                metafields: product.metafields
            };
        });

        if (skusToFetch.length > 0) {
            const skusSet = new Set(skusToFetch.map(s => normalizeMinsan(s))); // Normalizza anche gli SKU da cercare
            const filtered = normalizedProducts.filter(p => skusSet.has(p.minsan));
            console.log(`[SHOPIFY_API] Filtro applicato: da ${normalizedProducts.length} a ${filtered.length} prodotti per SKUs specifici.`);
            return {
                products: filtered,
                nextPageInfo: null,
                prevPageInfo: null
            };
        }

        return {
            products: normalizedProducts,
            nextPageInfo: nextPageInfo,
            prevPageInfo: prevPageInfo
        };

    } catch (error) {
        console.error('[SHOPIFY_API] Errore nel recupero prodotti Shopify:', error);
        throw new Error('Impossibile recuperare i prodotti da Shopify: ' + error.message);
    }
}

module.exports = {
    callShopifyAdminApi,
    getShopifyProducts,
    normalizeMinsan // Esporta la funzione per usarla anche in process-excel.js
};