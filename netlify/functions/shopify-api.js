const SHOPIFY_STORE_NAME = process.env.SHOPIFY_STORE_NAME;
const SHOPIFY_ADMIN_API_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;
const SHOPIFY_API_VERSION = '2024-07'; // Puoi aggiornare la versione API

/**
 * Funzione per effettuare richieste all'Admin API di Shopify.
 * @param {string} endpoint - L'endpoint dell'API (es. 'products.json')
 * @param {string} method - Metodo HTTP (GET, POST, PUT, DELETE)
 * @param {object} body - Corpo della richiesta per POST/PUT
 * @returns {Promise<object>} - La risposta dell'API
 */
async function callShopifyAdminApi(endpoint, method = 'GET', body = null) {
    const url = `https://${SHOPIFY_STORE_NAME}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/${endpoint}`;
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

    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Shopify API Error: ${response.status} - ${errorText}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Errore nella chiamata Shopify API:', error.message);
        throw error;
    }
}

/**
 * Recupera tutti i prodotti Shopify con le loro varianti e, se presenti, i metafields di scadenza.
 * Implementa la paginazione per gestire grandi quantità di prodotti.
 * @returns {Promise<Array<object>>} Array di oggetti prodotto Shopify
 */
async function getShopifyProducts() {
    let allProducts = [];
    let nextLink = `products.json?fields=id,title,variants,metafields`; // Richiedi solo i campi necessari

    try {
        while (nextLink) {
            const response = await callShopifyAdminApi(nextLink);
            allProducts = allProducts.concat(response.products);

            // Gestione della paginazione con l'header Link
            const linkHeader = response.headers?.get('Link') || response.headers?.link; // Netlify Function fetch might have a different header object
            if (linkHeader) {
                const parts = linkHeader.split(',');
                const nextPart = parts.find(p => p.includes('rel="next"'));
                if (nextPart) {
                    const urlMatch = nextPart.match(/<(.*?)>/);
                    if (urlMatch && urlMatch[1]) {
                        // Estrai solo il percorso relativo per la prossima chiamata
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

        // Normalizza i prodotti Shopify per facilitare il confronto
        return allProducts.map(product => {
            const variant = product.variants && product.variants.length > 0 ? product.variants[0] : {};
            const minsanMetafield = product.metafields?.find(m => m.key === 'minsan' && m.namespace === 'custom_fields'); // Assumi minsan come custom metafield
            const scadenzaMetafield = product.metafields?.find(m => m.key === 'scadenza' && m.namespace === 'custom_fields'); // Assumi scadenza come custom metafield

            return {
                id: product.id,
                title: product.title,
                minsan: minsanMetafield ? String(minsanMetafield.value) : (variant.sku ? String(variant.sku) : String(product.id)), // Preferisci metafield, poi SKU, altrimenti ID prodotto Shopify
                variants: product.variants, // Manteniamo tutte le varianti per operazioni future
                Giacenza: variant.inventory_quantity || 0,
                PrezzoBD: parseFloat(variant.price || 0),
                Scadenza: scadenzaMetafield ? scadenzaMetafield.value : null,
                metafields: product.metafields // Manteniamo i metafields per completezza
            };
        });

    } catch (error) {
        console.error('Errore nel recupero prodotti Shopify:', error);
        throw new Error('Impossibile recuperare i prodotti da Shopify.');
    }
}

module.exports = {
    callShopifyAdminApi,
    getShopifyProducts
};