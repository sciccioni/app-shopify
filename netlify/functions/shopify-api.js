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

    // Assicurati che l'endpoint non inizi con '/', Shopify API non lo vuole.
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
        // Il Shopify API Link header può essere un oggetto di tipo Headers, non un semplice oggetto.
        // Lo restituiamo insieme al JSON per facilitare la paginazione in getShopifyProducts.
        return { json: await response.json(), headers: response.headers };
    } catch (error) {
        console.error('Errore nella chiamata Shopify API:', error.message);
        throw error;
    }
}

/**
 * Recupera tutti i prodotti Shopify con le loro varianti e metafields rilevanti.
 * Implementa la paginazione usando l'header Link di Shopify.
 * @returns {Promise<Array<object>>} Array di oggetti prodotto Shopify, normalizzati.
 * @throws {Error} Se il recupero fallisce.
 */
async function getShopifyProducts() {
    let allProducts = [];
    // Richiedi solo i campi necessari per performance. includi metafields per Minsan e Scadenza.
    let nextLink = `products.json?fields=id,title,handle,variants,metafields`;

    try {
        while (nextLink) {
            console.log(`Fetching Shopify products: ${nextLink}`);
            // La risposta ora è un oggetto { json, headers }
            const responseData = await callShopifyAdminApi(nextLink);
            allProducts = allProducts.concat(responseData.json.products);

            // Shopify usa l'header 'Link' per la paginazione
            const linkHeader = responseData.headers.get('Link'); // Accedi direttamente con .get()
            if (linkHeader) {
                const parts = linkHeader.split(',');
                const nextPart = parts.find(p => p.includes('rel="next"'));
                if (nextPart) {
                    const urlMatch = nextPart.match(/<(.*?)>/);
                    if (urlMatch && urlMatch[1]) {
                        // Estrai solo il percorso relativo per la prossima chiamata (es. "products.json?page_info=...")
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

        // Normalizza i prodotti Shopify per facilitare il confronto nel frontend
        return allProducts.map(product => {
            const variant = product.variants && product.variants.length > 0 ? product.variants[0] : {};

            // Cerca Minsan e Scadenza nei metafields.
            // Assumi che Minsan sia memorizzato in un metafield 'minsan' con namespace 'custom_fields'
            // E la Scadenza in un metafield 'scadenza' con namespace 'custom_fields'
            const minsanMetafield = product.metafields?.find(m => m.key === 'minsan' && m.namespace === 'custom_fields');
            const scadenzaMetafield = product.metafields?.find(m => m.key === 'scadenza' && m.namespace === 'custom_fields');

            return {
                id: product.id,
                title: product.title,
                handle: product.handle,
                // Priorità per minsan: metafield, poi SKU della variante, altrimenti ID prodotto Shopify
                minsan: minsanMetafield?.value ? String(minsanMetafield.value).trim() : (variant.sku ? String(variant.sku).trim() : String(product.id).trim()),
                variants: product.variants, // Manteniamo tutte le varianti per operazioni future
                Giacenza: variant.inventory_quantity || 0,
                PrezzoBD: parseFloat(variant.price || 0),
                Scadenza: scadenzaMetafield?.value || null, // Valore grezzo del metafield di scadenza
                metafields: product.metafields // Manteniamo i metafields per completezza
            };
        });

    } catch (error) {
        console.error('Errore nel recupero prodotti Shopify:', error);
        throw new Error('Impossibile recuperare i prodotti da Shopify: ' + error.message);
    }
}

module.exports = {
    callShopifyAdminApi,
    getShopifyProducts
};