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
    const options = { method, headers: {
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
    // Restituisci sia JSON che headers per poter fare paginazione
    return { json: await response.json(), headers: response.headers };
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
        let endpoint = `products.json?fields=id,title,handle,vendor,variants,metafields&limit=${limit}`;

        // Costruisci set SKU da cercare per matching varianti
        const skusSet = new Set(skusToFetch.map(s => normalizeMinsan(s)));

        // Ciclo di paginazione completo
        do {
            const { json: data, headers } = await callShopifyAdminApi(endpoint);
            products = products.concat(data.products);
            const linkHeader = headers.get('link') || headers.get('Link');
            if (linkHeader) {
                const nextLink = linkHeader.split(',').find(p => p.includes('rel="next"'));
                if (nextLink) {
                    const match = nextLink.match(/page_info=(.*?)[&>]/);
                    nextPageInfo = match ? match[1] : null;
                }
            }
            endpoint = nextPageInfo
                ? `products.json?fields=id,title,handle,vendor,variants,metafields&limit=${limit}&page_info=${nextPageInfo}`
                : null;
        } while (endpoint);

        // Normalizza i prodotti selezionando la variante corretta
        const normalizedProducts = products.map(product => {
            const metafield = product.metafields?.find(m => m.namespace === 'custom_fields' && m.key === 'minsan');
            // Se esiste metafield usalo, altrimenti cerca variante con SKU matching
            let matchedSku = metafield?.value || '';
            if (!matchedSku) {
                const variantMatch = product.variants.find(v => skusSet.has(normalizeMinsan(v.sku)));
                matchedSku = variantMatch ? variantMatch.sku : product.variants[0]?.sku;
            }
            const normalizedMinsan = normalizeMinsan(matchedSku || product.id);
            // Scegli variante dati: variante matching o prima
            const variantData = product.variants.find(v => normalizeMinsan(v.sku) === normalizedMinsan) || product.variants[0] || {};

            return {
                id: product.id,
                title: product.title,
                handle: product.handle,
                vendor: product.vendor || '-',
                minsan: normalizedMinsan,
                variants: product.variants,
                Giacenza: variantData.inventory_quantity || 0,
                PrezzoBD: parseFloat(variantData.price || 0),
                Scadenza: product.metafields?.find(m => m.namespace === 'custom_fields' && m.key === 'scadenza')?.value || null,
                CostoMedio: parseFloat(product.metafields?.find(m => m.namespace === 'custom_fields' && m.key === 'costo_medio')?.value || 0),
                IVA: parseFloat(product.metafields?.find(m => m.namespace === 'custom_fields' && m.key === 'iva')?.value || 0),
                metafields: product.metafields
            };
        });

        // Se richiesto, filtra i prodotti per Minsan
        if (skusToFetch.length > 0) {
            const filtered = normalizedProducts.filter(p => skusSet.has(p.minsan));
            filtered.forEach(p => console.log(
                `[SHOPIFY_API] Prodotto Shopify filtrato: ${p.title} (ID: ${p.id}) -> Minsan: "${p.minsan}"`
            ));
            console.log(
                `[SHOPIFY_API] Filtro applicato: da ${normalizedProducts.length} a ${filtered.length} prodotti per SKUs specifici.`
            );
            return { products: filtered, nextPageInfo: null, prevPageInfo: null };
        }

        // Nessun filtro, restituisci tutti
        return { products: normalizedProducts, nextPageInfo: nextPageInfo, prevPageInfo: null };

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
