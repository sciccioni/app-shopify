// Funzione per eseguire chiamate all'API GraphQL di Shopify
async function callShopifyApi(graphQlQuery, variables = {}) { // Resa esplicita per GraphQL
    const { SHOPIFY_STORE_NAME, SHOPIFY_ADMIN_API_TOKEN } = process.env;

    let shopifyBaseUrl;
    if (SHOPIFY_STORE_NAME.includes('.myshopify.com')) {
        shopifyBaseUrl = `https://${SHOPIFY_STORE_NAME}`;
    } else {
        shopifyBaseUrl = `https://${SHOPIFY_STORE_NAME}.myshopify.com`;
    }

    // Endpoint GraphQL Admin API
    // Per l'analisi, possiamo rimanere su 2024-07 se non ci sono stati altri problemi,
    // o 2024-04 se preferisci coerenza con l'altro file per l'analisi.
    // L'errore corrente NON è legato alla versione API in questo contesto.
    const graphqlApiUrl = `${shopifyBaseUrl}/admin/api/2024-07/graphql.json`; 

    const headers = {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
    };

    const requestBody = JSON.stringify({ query: graphQlQuery, variables: variables });

    const response = await fetch(graphqlApiUrl, { // URL è ora corretto
        method: 'POST', // Le chiamate GraphQL sono POST
        headers: headers,
        body: requestBody
    });

    const data = await response.json();
    
    if (data.errors) { 
        console.error("Shopify API Errors (GraphQL):", JSON.stringify(data.errors, null, 2));
        console.error("GraphQL Query/Mutation that failed:", graphQlQuery); 
        throw new Error(data.errors.map(e => e.message).join(', '));
    }
    
    // Per GraphQL, la risposta valida è solitamente in data.data
    if (data.data) {
        return data.data;
    } else {
        // Gestione caso limite se non c'è data.data ma non ci sono errori espliciti
        console.warn("GraphQL API response missing 'data' field but no explicit errors:", JSON.stringify(data, null, 2));
        throw new Error("Risposta API GraphQL inattesa.");
    }
}


// Funzione per eseguire chiamate all'API REST di Shopify (Nuova funzione o integrata)
async function callShopifyRestApi(endpoint, method, body = null) {
    const { SHOPIFY_STORE_NAME, SHOPIFY_ADMIN_API_TOKEN } = process.env;

    let baseUrl;
    if (SHOPIFY_STORE_NAME.includes('.myshopify.com')) {
        baseUrl = `https://${SHOPIFY_STORE_NAME}`;
    } else {
        baseUrl = `https://${SHOPIFY_STORE_NAME}.myshopify.com`;
    }

    const url = `${baseUrl}${endpoint}`; 

    const headers = {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
    };

    const response = await fetch(url, {
        method: method,
        headers: headers,
        body: body ? JSON.stringify(body) : undefined
    });

    const data = await response.json();

    if (response.status >= 400) {
        console.error("Shopify API Errors (REST):", JSON.stringify(data, null, 2));
        let errorMessage = `REST API Error ${response.status}`;
        if (data.errors) {
            if (Array.isArray(data.errors)) {
                errorMessage += `: ${data.errors.join(', ')}`;
            } else if (typeof data.errors === 'object') {
                errorMessage += `: ${Object.values(data.errors).flat().join(', ')}`;
            } else {
                errorMessage += `: ${data.errors.toString()}`;
            }
        } else if (data.error) {
            errorMessage += `: ${data.error}`;
        }
        throw new Error(errorMessage);
    }
    return data;
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

        // 1. ANALIZZA PRODOTTI (usa GraphQL tramite callShopifyApi)
        if (payload.type === 'analyze') {
            const { skus } = payload;
            if (!skus || !Array.isArray(skus)) {
                 throw new Error("Array di SKU/Minsan non fornito.");
            }
            
            console.log("DEBUG: Received SKUs payload for analyze:", skus);

            const skuQueryString = skus.map(s => `sku:'${String(s).trim()}'`).join(' OR '); 
            
            console.log("DEBUG: Final skuQueryString for Shopify (analyze):", skuQueryString);
            
            // Query GraphQL per l'analisi
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

            // *** MODIFICA QUI: Chiamata corretta a callShopifyApi per GraphQL ***
            const shopifyData = await callShopifyApi(query); // query è il primo argomento (GraphQL)

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

        // 2. SINCRONIZZA PREZZI (usa la NUOVA funzione callShopifyRestApi)
        if (payload.type === 'sync') {
            const { items } = payload; 

            if (!items || !Array.isArray(items) || items.length === 0) {
                return { statusCode: 200, body: JSON.stringify({ success: true, message: "Nessuna azione da eseguire." }) };
            }

            const results = [];
            const errors = [];

            for (const item of items) {
                const originalPrice = item.price;
                const variantId = item.variantId; 

                if (!variantId) {
                    console.warn(`WARN: Skipping variant due to missing variantId in sync payload: ${JSON.stringify(item)}`);
                    errors.push(`Missing variantId for item: ${JSON.stringify(item)}`);
                    continue;
                }
                
                const cleanedPriceString = String(originalPrice).replace(',', '.');
                const parsedPrice = parseFloat(cleanedPriceString);
                
                if (isNaN(parsedPrice)) {
                    console.error(`ERROR: Invalid price encountered for variant ${variantId} (original: '${originalPrice}')`);
                    errors.push(`Invalid price format for variant ${variantId}: '${originalPrice}'`);
                    continue; 
                }
                
                const formattedPrice = parsedPrice.toFixed(2);

                // L'ID della variante GraphQL (gid://...) deve essere convertito a ID numerico per l'API REST
                const restVariantId = variantId.split('/').pop();
                if (!restVariantId) {
                    console.error(`ERROR: Could not parse REST ID from GID: ${variantId}`);
                    errors.push(`Invalid Variant ID format for REST: ${variantId}`);
                    continue;
                }

                // Endpoint API REST per aggiornare la variante (VERSIONE 2024-07)
                const endpoint = `/admin/api/2024-07/variants/${restVariantId}.json`;
                const requestBody = {
                    variant: {
                        id: restVariantId,
                        price: formattedPrice
                    }
                };

                console.log(`DEBUG: Sending REST PUT to ${endpoint} for variant ${variantId}`);
                console.log("DEBUG: REST Request Body:", JSON.stringify(requestBody, null, 2));

                try {
                    // *** MODIFICA QUI: Chiamata a callShopifyRestApi per REST ***
                    const result = await callShopifyRestApi(endpoint, 'PUT', requestBody);
                    if (result.variant && result.variant.id) {
                        results.push({ variantId, success: true, rest_response: result.variant });
                    } else {
                        errors.push(`REST update failed for variant ${variantId}: ${JSON.stringify(result)}`);
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
