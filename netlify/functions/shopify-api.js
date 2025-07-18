const SHOPIFY_STORE_NAME = process.env.SHOPIFY_STORE_NAME;
const SHOPIFY_ADMIN_API_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;
const SHOPIFY_API_VERSION = '2024-07';

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
    // CORREZIONE FINALE E DEFINITIVA QUI: da SHOPIFY_STORE_FRAME a SHOPIFY_STORE_NAME
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
 * @param {Array<string>} [skusToFetch=[]] - Un array di stringhe SKU/Minsan da cercare.
 * @returns {Promise<Array<object>>} Array di oggetti prodotto Shopify, normalizzati.
 * @throws {Error} Se il recupero fallisce.
 */
async function getShopifyProducts(skusToFetch = []) {
    let allProducts = [];
    let nextLink = `products.json?fields=id,title,handle,variants,metafields`;

    // Aggiungiamo un limite esplicito, anche se è il default, per chiarezza.
    nextLink += `&limit=50`;

    try {
        while (nextLink) {
            console.log(`Fetching Shopify products: ${nextLink}`);
            const responseData = await callShopifyAdminApi(nextLink);
            allProducts = allProducts.concat(responseData.json.products);

            const linkHeader = responseData.headers.get('Link');
            if (linkHeader) {
                const parts = linkHeader.split(',');
                const nextPart = parts.find(p => p.includes('rel="next"'));
                if (nextPart) {
                    const urlMatch = nextPart.match(/<(.*?)>/);
                    if (urlMatch && urlMatch[1]) {
                        const urlObj = new URL(urlMatch[1]);
                        nextLink = `${urlObj.pathname.split('/').pop()}${urlObj.search}`;
                    } else {
                        nextLink = null;
                    }
                } else {
                    nextLink = null;
                }
            } else {
                nextLink = null;
            }
        }

        // Normalizza e filtra i prodotti Shopify
        const normalizedProducts = allProducts.map(product => {
            const variant = product.variants && product.variants.length > 0 ? product.variants[0] : {};
            const minsanMetafield = product.metafields?.find(m => m.key === 'minsan' && m.namespace === 'custom_fields');
            const scadenzaMetafield = product.metafields?.find(m => m.key === 'scadenza' && m.namespace === 'custom_fields');

            return {
                id: product.id,
                title: product.title,
                handle: product.handle,
                minsan: minsanMetafield?.value ? String(minsanMetafield.value).trim() : (variant.sku ? String(variant.sku).trim() : String(product.id).trim()),
                variants: product.variants,
                Giacenza: variant.inventory_quantity || 0,
                PrezzoBD: parseFloat(variant.price || 0),
                Scadenza: scadenzaMetafield?.value || null,
                metafields: product.metafields
            };
        });

        // Se sono stati forniti degli SKU, filtriamo i prodotti recuperati
        if (skusToFetch.length > 0) {
            const skusSet = new Set(skusToFetch.map(s => String(s).trim()));
            return normalizedProducts.filter(p => skusSet.has(p.minsan));
        }

        return normalizedProducts;

    } catch (error) {
        console.error('Errore nel recupero prodotti Shopify:', error);
        throw new Error('Impossibile recuperare i prodotti da Shopify: ' + error.message);
    }
}

module.exports = {
    callShopifyAdminApi,
    getShopifyProducts
};