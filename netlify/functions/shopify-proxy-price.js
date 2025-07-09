// Funzione helper per eseguire chiamate all'API GraphQL di Shopify
async function callShopifyApi(query, variables = {}) {
    const { SHOPIFY_STORE_NAME, SHOPIFY_ADMIN_API_TOKEN } = process.env;

    let shopifyBaseUrl;
    if (SHOPIFY_STORE_NAME.includes('.myshopify.com')) {
        shopifyBaseUrl = `https://${SHOPIFY_STORE_NAME}`;
    } else {
        shopifyBaseUrl = `https://${SHOPIFY_STORE_NAME}.myshopify.com`;
    }

    // *** CAMBIATO QUI: VERSIONE API 2024-04 PER LA SINCRONIZZAZIONE ***
    // Questo è cruciale perché productVariantUpdate è disponibile in questa versione.
    const response = await fetch(`${shopifyBaseUrl}/admin/api/2024-04/graphql.json`, { 
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
        },
        body: JSON.stringify({ query, variables }),
    });

    const data = await response.json();
    
    if (data.errors) {
        console.error("Shopify API Errors:", JSON.stringify(data.errors, null, 2));
        console.error("GraphQL Query/Mutation that failed:", query); 
        throw new Error(data.errors.map(e => e.message).join(', '));
    }
    return data.data;
}

exports.handler = async function(event) {
    const mainLogic = async () => {
        const { SHOPIFY_STORE_NAME, SHOPIFY_ADMIN_API_TOKEN, APP_PASSWORD } = process.env;
        if (!SHOPIFY_STORE_NAME || !SHOPIFY_ADMIN_API_TOKEN || !APP_PASSWORD) {
            const missing = [
                !SHOPIFY_STORE_NAME && "SHOPIFY_STORE_NAME",
                !SHOPIFY_ADMIN_API_TOKEN && "SHOPIFY_ADMIN_API_TOKEN",
                !APP_PASSWORD && "APP_PASSWORD"
            ].filter(Boolean).join(', ');
            throw new Error(`Variabili d'ambiente mancanti su Netlify: ${missing}`);
        }

        if (event.httpMethod !== 'POST') {
            return { statusCode: 405, body: 'Method Not Allowed' };
        }

        const payload = JSON.parse(event.body);

        if (payload.password !== APP_PASSWORD) {
            return { statusCode: 401, body: JSON.stringify({ error: "Autenticazione fallita." }) };
        }

        // 1. ANALIZZA PRODOTTI
        if (payload.type === 'analyze') {
            const { skus } = payload;
            if (!skus || !Array.isArray(skus)) {
                 throw new Error("Array di SKU/Minsan non fornito.");
            }
            
            console.log("DEBUG: Received SKUs payload for analyze:", skus);

            const skuQueryString = skus.map(s => `sku:'${String(s).trim()}'`).join(' OR '); 
            
            console.log("DEBUG: Final skuQueryString for Shopify (analyze):", skuQueryString);
            
            const query = `
                query getProductsBySkus {
                    products(first: ${skus.length}, query: "${skuQueryString}") {
                        edges {
                            node {
                                id
                                title
                                variants(first: 10) {
                                    edges { 
                                        node { 
                                            id
                                            sku
                                            price
                                        } 
                                    }
                                }
                            }
                        }
                    }
                }`;
            
            console.log("DEBUG: Complete GraphQL Query sent to Shopify (analyze):", query); 

            const shopifyData = await callShopifyApi(query);
            
            const products = [];
            const foundSkus = new Set();

            if (shopifyData.products && shopifyData.products.edges) {
                shopifyData.products.edges.forEach(productEdge => {
                    const productNode = productEdge.node;
                    if (productNode.variants && productNode.variants.edges) {
                        productNode.variants.edges.forEach(variantEdge => {
                            const variantNode = variantEdge.node;
                            if (variantNode && skus.map(s => String(s)).includes(String(variantNode.sku))) {
                                products.push({
                                    found: true,
                                    minsan: String(variantNode.sku),
                                    price: variantNode.price,
                                    variant_id: variantNode.id,
                                    product_id: productNode.id, 
                                    title: productNode.title,
                                });
                                foundSkus.add(String(variantNode.sku));
                            }
                        });
                    }
                });
            }

            skus.forEach(sku => {
                if (!foundSkus.has(String(sku))) {
                    products.push({ found: false, minsan: String(sku) });
                }
            });

            return { statusCode: 200, body: JSON.stringify(products) };
        }

        // 2. SINCRONIZZA PREZZI - RIPRISTINATO productVariantUpdate (per singola variante)
        // e API versione 2024-04
        if (payload.type === 'sync') {
            const { items } = payload; 

            if (!items || !Array.isArray(items) || items.length === 0) {
                return { statusCode: 200, body: JSON.stringify({ success: true, message: "Nessuna azione da eseguire." }) };
            }

            const results = [];
            const errors = [];

            // Adesso iteriamo su ogni singolo item e inviamo una mutazione productVariantUpdate
            for (const item of items) {
                const originalPrice = item.price;
                const variantId = item.variantId; // Prendiamo il variantId

                if (!variantId) {
                    console.warn(`WARN: Skipping variant due to missing variantId in sync payload: ${JSON.stringify(item)}`);
                    errors.push(`Missing variantId for item: ${JSON.stringify(item)}`);
                    continue;
                }
                
                // Pulizia e formattazione del prezzo
                const cleanedPriceString = String(originalPrice).replace(',', '.');
                const parsedPrice = parseFloat(cleanedPriceString);
                
                if (isNaN(parsedPrice)) {
                    console.error(`ERROR: Invalid price encountered for variant ${variantId} (original: '${originalPrice}')`);
                    errors.push(`Invalid price format for variant ${variantId}: '${originalPrice}'`);
                    continue; // Salta questo item e passa al successivo
                }
                
                const formattedPrice = parsedPrice.toFixed(2);

                const mutation = `
                    mutation productVariantUpdate($id: ID!, $price: Decimal!) {
                        productVariantUpdate(input: {id: $id, price: $price}) {
                            productVariant {
                                id
                                price
                            }
                            userErrors {
                                field
                                message
                            }
                        }
                    }
                `;
                
                const variables = {
                    id: variantId,
                    price: formattedPrice
                };

                console.log(`DEBUG: Sending productVariantUpdate for variant ${variantId}`);
                console.log("DEBUG: Mutation:", mutation);
                console.log("DEBUG: Variables:", JSON.stringify(variables, null, 2));

                try {
                    // Chiamata all'API GraphQL con mutazione e variabili
                    const result = await callShopifyApi(mutation, variables);
                    const userErrors = result.productVariantUpdate?.userErrors || [];
                    if (userErrors.length > 0) {
                        userErrors.forEach(err => errors.push(`[${variantId} - ${err.field?.join(', ') || 'N/A'}]: ${err.message}`));
                    } else {
                        results.push({ variantId, success: true });
                    }
                } catch (e) {
                    errors.push(`Error for variant ${variantId}: ${e.message}`);
                }
            }

            if (errors.length > 0) {
                const errorMessage = "Errore durante la sincronizzazione di alcuni prodotti: " + errors.join('; ');
                console.error("Final sync errors:", errorMessage);
                throw new Error(errorMessage);
            }

            return { statusCode: 200, body: JSON.stringify({ success: true, results: results }) };
        }

        return { statusCode: 400, body: JSON.stringify({ error: 'Tipo di richiesta non valido.' }) };
    };

    try {
        const watchdog = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Timeout della funzione superato (10s). Il pacchetto di dati potrebbe essere troppo grande.")), 9500)
        );
        return await Promise.race([mainLogic(), watchdog]);
    } catch (error) {
        console.error('Errore nel backend:', error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
