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
    return String(minsan).replace(/[^a-zA-Z0-9]/g, '').toUpperCase().trim();
}

/**
 * Funzione per effettuare richieste all'Admin API di Shopify.
 */
async function callShopifyAdminApi(endpoint, method = 'GET', body = null) {
    if (!SHOPIFY_STORE_NAME || !SHOPIFY_ADMIN_API_TOKEN) {
        throw new Error('Variabili d\'ambiente Shopify non configurate (SHOPIFY_STORE_NAME o SHOPIFY_ADMIN_API_TOKEN).');
    }
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
    const url = `https://${SHOPIFY_STORE_NAME}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/${cleanEndpoint}`;
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN
        }
    };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(url, options);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Shopify API error: ${response.status} - ${text}`);
    }
    return response.json();
}

/**
 * Recupera prodotti da Shopify, con paginazione e filtro opzionale per SKUs (Minsan).
 * @param {string[]} skusToFetch - Lista di Minsan da filtrare.
 * @param {number} limit - Numero massimo di prodotti per pagina.
 */
async function getShopifyProducts(skusToFetch = [], limit = 20) {
    try {
        let products = [];
        let nextPageInfo = null;
        let prevPageInfo = null;
        let endpoint = `products.json?fields=id,title,handle,vendor,variants,metafields&limit=${limit}`;

        // Ciclo di paginazione
        do {
            const responseData = await callShopifyAdminApi(endpoint);
            products = products.concat(responseData.products);

            const linkHeader = responseData.headers?.get('link');
            if (linkHeader) {
                const parts = linkHeader.split(',');
                const nextPart = parts.find(p => p.includes('rel="next"'));
                if (nextPart) {
                    const match = nextPart.match(/page_info=(.*?)[&>]/);
                    if (match) nextPageInfo = match[1];
                }
            }

            endpoint = nextPageInfo
                ? `products.json?fields=id,title,handle,vendor,variants,metafields&limit=${limit}&page_info=${nextPageInfo}`
                : null;
        } while (endpoint);

        // Normalizza i prodotti
        const normalizedProducts = products.map(product => {
            const variant = (product.variants && product.variants[0]) || {};
            const minsanField = product.metafields?.find(m => m.key === 'minsan' && m.namespace === 'custom_fields');
            const normalizedMinsan = normalizeMinsan(minsanField?.value || variant.sku || String(product.id));

            return {
                id: product.id,
                title: product.title,
                handle: product.handle,
                vendor: product.vendor || '-',
                minsan: normalizedMinsan,
                variants: product.variants,
                Giacenza: variant.inventory_quantity || 0,
                PrezzoBD: parseFloat(variant.price || 0),
                Scadenza: product.metafields?.find(m => m.key === 'scadenza')?.value || null,
                CostoMedio: parseFloat(product.metafields?.find(m => m.key === 'costo_medio')?.value || 0),
                IVA: parseFloat(product.metafields?.find(m => m.key === 'iva')?.value || 0),
                metafields: product.metafields
            };
        });

        // Se richiesto, filtra i prodotti per Minsan
        if (skusToFetch.length > 0) {
            const skusSet = new Set(skusToFetch.map(s => normalizeMinsan(s)));
            const filtered = normalizedProducts.filter(p => skusSet.has(p.minsan));

            // Log solo prodotti filtrati
            filtered.forEach(p => console.log(
                `[SHOPIFY_API] Prodotto Shopify filtrato: ${p.title} (ID: ${p.id}) -> Minsan: "${p.minsan}"`
            ));
            console.log(
                `[SHOPIFY_API] Filtro applicato: da ${normalizedProducts.length} a ${filtered.length} prodotti per SKUs specifici.`
            );

            return { products: filtered, nextPageInfo: null, prevPageInfo: null };
        }

        // Nessun filtro, restituisci tutti
        return { products: normalizedProducts, nextPageInfo, prevPageInfo };

    } catch (error) {
        console.error('[SHOPIFY_API] Errore nel recupero prodotti Shopify:', error);
        throw new Error('Impossibile recuperare i prodotti da Shopify: ' + error.message);
    }
}

module.exports = {
    callShopifyAdminApi,
    getShopifyProducts,
    normalizeMinsan
};
