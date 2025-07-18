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
    const url = `https://${SHOPIFY_STORE_NAME}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/${cleanEndpoint}`; // Correzione definitiva di SHOPIFY_STORE_FRAME
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
 * @returns {Promise<Array<object>>} Array di oggetti prodotto Shopify, normalizzati.
 * @throws {Error} Se il recupero fallisce.
 */
async function getShopifyProducts(skusToFetch = []) {
    let allProducts = [];
    // Aggiungiamo un limite esplicito per pagina.
    // Shopify API raccomanda di non superare 250 (max per API KEY). 50 è un buon compromesso.
    let nextLink = `products.json?fields=id,title,handle,variants,metafields&limit=50`;

    // Se stiamo cercando SKUs specifici, possiamo aggiungere un filtro "query"
    // MA L'API Shopify search (query) è limitata e non filtra bene per varianti SKU/barcode.
    // La strategia più robusta è recuperare e filtrare lato nostro.
    // Se skusToFetch è vuoto, recuperiamo tutto il possibile.
    // Se non è vuoto, scarichiamo comunque paginando e poi filtriamo localmente.
    // PER STORE MOLTO GRANDI (centinaia di migliaia di prodotti), questa strategia può ancora andare in timeout.
    // In quel caso, si dovrebbe usare un database esterno per la sincronizzazione o un'API di ricerca custom.

    try {
        let fetchCount = 0; // Contatore per il debug del timeout
        while (nextLink) {
            console.log(`Fetching Shopify products: ${nextLink}`);
            const responseData = await callShopifyAdminApi(nextLink);
            allProducts = allProducts.concat(responseData.json.products);

            fetchCount++;
            // Loggarlo per capire quante chiamate paginate avvengono
            console.log(`Fetched page ${fetchCount}, total products so far: ${allProducts.length}`);

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

        // Normalizza i prodotti Shopify
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

        // Se sono stati forniti degli SKU (per la tab "Importa/Aggiorna"), filtriamo i prodotti recuperati.
        // Se skusToFetch è vuoto (per la tab "Prodotti Shopify"), restituiamo tutti i prodotti normalizzati.
        if (skusToFetch.length > 0) {
            const skusSet = new Set(skusToFetch.map(s => String(s).trim()));
            const filtered = normalizedProducts.filter(p => skusSet.has(p.minsan));
            console.log(`Filtro applicato: da ${normalizedProducts.length} a ${filtered.length} prodotti per SKUs specifici.`);
            return filtered;
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