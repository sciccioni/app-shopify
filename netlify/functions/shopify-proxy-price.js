// Funzione helper per eseguire chiamate all'API GraphQL di Shopify
async function callShopifyApi(query, variables = {}) {
    // Recupera le credenziali dalle variabili d'ambiente del server
    const { SHOPIFY_STORE_NAME, SHOPIFY_ADMIN_API_TOKEN } = process.env;

    // Esegue la chiamata all'endpoint GraphQL di Shopify
    const response = await fetch(`https://${SHOPIFY_STORE_NAME}.myshopify.com/admin/api/2024-07/graphql.json`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
        },
        body: JSON.stringify({ query, variables }),
    });

    const data = await response.json();
    // Se Shopify restituisce errori, li logga e li inoltra al frontend
    if (data.errors) {
        console.error("Shopify API Errors:", JSON.stringify(data.errors, null, 2));
        throw new Error(data.errors.map(e => e.message).join(', '));
    }
    return data.data;
}

// Funzione principale del backend (Serverless Function)
exports.handler = async function(event) {
    // Funzione interna che contiene la logica principale, per gestirla con un timeout
    const mainLogic = async () => {
        // Controlla subito che tutte le variabili d'ambiente necessarie siano state impostate su Netlify
        const { SHOPIFY_STORE_NAME, SHOPIFY_ADMIN_API_TOKEN, APP_PASSWORD } = process.env;
        if (!SHOPIFY_STORE_NAME || !SHOPIFY_ADMIN_API_TOKEN || !APP_PASSWORD) {
            const missing = [
                !SHOPIFY_STORE_NAME && "SHOPIFY_STORE_NAME",
                !SHOPIFY_ADMIN_API_TOKEN && "SHOPIFY_ADMIN_API_TOKEN",
                !APP_PASSWORD && "APP_PASSWORD"
            ].filter(Boolean).join(', ');
            return { statusCode: 500, body: JSON.stringify({ error: `Variabili d'ambiente mancanti sul server: ${missing}` }) };
        }

        // Accetta solo richieste di tipo POST
        if (event.httpMethod !== 'POST') {
            return { statusCode: 405, body: 'Method Not Allowed' };
        }

        const payload = JSON.parse(event.body);

        // Controllo della password per ogni singola richiesta
        if (payload.password !== APP_PASSWORD) {
            return { statusCode: 401, body: JSON.stringify({ error: "Autenticazione fallita." }) };
        }

        // --- GESTIONE DELLE DIVERSE AZIONI ---

        // 1. ANALIZZA PRODOTTI (gestito a pacchetti dal frontend)
        if (payload.type === 'analyze') {
            const { skus } = payload;
            if (!skus || !Array.isArray(skus)) {
                 throw new Error("Array di SKU non fornito.");
            }
            
            const skuQueryString = skus.map(s => `sku:'${s}'`).join(' OR ');
            const query = `
                query getProductVariantsBySkus {
                    productVariants(first: ${skus.length}, query: "${skuQueryString}") {
                        edges {
                            node {
                                id
                                sku
                                price
                                product {
                                    id
                                    title
                                }
                            }
                        }
                    }
                }`;

            const shopifyData = await callShopifyApi(query);
            
            const products = shopifyData.productVariants.edges.map(edge => ({
                found: true,
                minsan: edge.node.sku,
                price: edge.node.price,
                variant_id: edge.node.id,
                product_id: edge.node.product.id,
                title: edge.node.product.title,
            }));

            const foundSkus = new Set(products.map(p => p.minsan));
            skus.forEach(sku => {
                if (!foundSkus.has(sku)) {
                    products.push({ found: false, minsan: sku });
                }
            });

            return { statusCode: 200, body: JSON.stringify(products) };
        }

        // 2. SINCRONIZZA PREZZI (gestito a pacchetti dal frontend)
        if (payload.type === 'sync') {
            const { items } = payload;
            if (!items || !Array.isArray(items) || items.length === 0) {
                throw new Error("Nessun prodotto da sincronizzare.");
            }

            let mutations = items.map((item, index) => `
                variantUpdate${index}: productVariantUpdate(input: {id: "${item.variantId}", price: "${item.price}"}) {
                    productVariant {
                        id
                        price
                    }
                    userErrors {
                        field
                        message
                    }
                }
            `).join('\n');

            const finalMutation = `mutation { ${mutations} }`;
            
            const result = await callShopifyApi(finalMutation);

            const allErrors = Object.values(result).flatMap(res => res.userErrors);
            if (allErrors.length > 0) {
                throw new Error(allErrors.map(e => `[${e.field.join(', ')}]: ${e.message}`).join('; '));
            }

            return { statusCode: 200, body: JSON.stringify({ success: true, data: result }) };
        }

        // Se il tipo di richiesta non è valido
        return { statusCode: 400, body: JSON.stringify({ error: 'Tipo di richiesta non valido.' }) };
    };

    // Watchdog per gestire i timeout delle funzioni serverless
    try {
        const watchdog = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Timeout della funzione superato (10s). Il pacchetto di dati è troppo grande.")), 9500)
        );
        return await Promise.race([mainLogic(), watchdog]);
    } catch (error) {
        console.error('Errore nel backend o timeout:', error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
