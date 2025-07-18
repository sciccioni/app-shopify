const SHOPIFY_STORE_NAME = process.env.SHOPIFY_STORE_NAME;
const SHOPIFY_ADMIN_API_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;
const SHOPIFY_API_VERSION = '2024-07'; // Versione API di Shopify

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
 * Recupera i prodotti Shopify, opzionalmente filtrando per un elenco di SKU/Minsan.
 * Se viene fornito un elenco di skus, cerca i prodotti che hanno queste SKUs nelle loro varianti.
 * Altrimenti, recupera tutti i prodotti. Implementa la paginazione.
 *
 * @param {Array<string>} [skusToFetch=[]] - Un array di stringhe SKU/Minsan da cercare. Se vuoto, recupera tutti i prodotti.
 * @param {string} [pageInfo=null] - Il parametro 'page_info' per la paginazione di Shopify (next/previous page cursor).
 * @param {number} [limit=20] - Il numero massimo di prodotti da recuperare per pagina.
 * @returns {Promise<{products: Array<object>, nextPageInfo: string|null, prevPageInfo: string|null}>} Oggetto con prodotti, e info per la paginazione.
 * @throws {Error} Se il recupero fallisce.
 */
async function getShopifyProducts(skusToFetch = [], pageInfo = null, limit = 20) {
    let products = [];
    // Aggiungiamo 'vendor' esplicitamente nei campi richiesti per assicurarne la presenza
    let queryParams = `fields=id,title,handle,vendor,variants,metafields&limit=${limit}`; 

    if (pageInfo) {
        queryParams += `&page_info=${pageInfo}`;
    }

    let endpoint = `products.json?${queryParams}`;

    let nextPageInfo = null;
    let prevPageInfo = null;

    try {
        console.log(`Fetching Shopify products with pagination: ${endpoint}`);
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

            const minsanMetafield = product.metafields?.find(m => m.key === 'minsan' && m.namespace === 'custom_fields');
            const scadenzaMetafield = product.metafields?.find(m => m.key === 'scadenza' && m.namespace === 'custom_fields');

            return {
                id: product.id,
                title: product.title,
                handle: product.handle,
                vendor: product.vendor || '-', // Aggiungi il campo vendor qui
                minsan: minsanMetafield?.value ? String(minsanMetafield.value).trim() : (variant.sku ? String(variant.sku).trim() : String(product.id).trim()),
                variants: product.variants,
                Giacenza: variant.inventory_quantity || 0,
                PrezzoBD: parseFloat(variant.price || 0),
                Scadenza: scadenzaMetafield?.value || null,
                metafields: product.metafields
            };
        });

        // Se sono stati forniti degli SKU (per la tab "Importa/Aggiorna"), filtriamo i prodotti recuperati.
        // Se skusToFetch è vuoto (per la tab "Prodotti Shopify"), restituiamo tutti i prodotti normalizzati.
        if (skusToFetch.length > 0) {
            const skusSet = new Set(skusToFetch.map(s => String(s).trim()));
            const filtered = normalizedProducts.filter(p => skusSet.has(p.minsan));
            console.log(`Filtro applicato: da ${normalizedProducts.length} a ${filtered.length} prodotti per SKUs specifici.`);
            return {
                products: filtered,
                nextPageInfo: null, // Per le query SKU, non gestiamo la paginazione in questo modo
                prevPageInfo: null
            };
        }

        return {
            products: normalizedProducts,
            nextPageInfo: nextPageInfo,
            prevPageInfo: prevPageInfo
        };

    } catch (error) {
        console.error('Errore nel recupero prodotti Shopify:', error);
        throw new Error('Impossibile recuperare i prodotti da Shopify: ' + error.message);
    }
}

module.exports = {
    callShopifyAdminApi,
    getShopifyProducts
};