// Funzione helper per eseguire chiamate API (ora supporta anche REST)
async function callShopifyApi(endpoint, method, body = null, variables = {}) {
    const { SHOPIFY_STORE_NAME, SHOPIFY_ADMIN_API_TOKEN } = process.env;

    let baseUrl;
    if (SHOPIFY_STORE_NAME.includes('.myshopify.com')) {
        baseUrl = `https://${SHOPIFY_STORE_NAME}`;
    } else {
        baseUrl = `https://${SHOPIFY_STORE_NAME}.myshopify.com`;
    }

    const url = `${baseUrl}${endpoint}`; // L'endpoint è ora un percorso completo per REST o GraphQL

    const headers = {
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
    };

    let requestBody = undefined;
    if (body) {
        // Per GraphQL, body è già JSON.stringify({ query, variables })
        // Per REST, body sarà un oggetto da stringify
        headers['Content-Type'] = 'application/json';
        requestBody = JSON.stringify(body);
    } else if (method === 'POST' || method === 'PUT') {
        // Se è una chiamata GraphQL, variabili contengono query e variabili GraphQL
        headers['Content-Type'] = 'application/json';
        requestBody = JSON.stringify({ query: endpoint, variables: variables }); // Endpoint è la query GraphQL qui
    }


    const response = await fetch(url, {
        method: method,
        headers: headers,
        body: requestBody
    });

    const data = await response.json();
    
    // Controlla errori sia per GraphQL che per REST (REST ha errori in un formato diverso, ma il .json li cattura)
    // Per GraphQL, data.errors. Per REST, a volte l'API restituisce un oggetto 'errors' nel body
    if (data.errors) { // GraphQL errors
        console.error("Shopify API Errors (GraphQL):", JSON.stringify(data.errors, null, 2));
        console.error("GraphQL Query/Mutation that failed:", endpoint); 
        throw new Error(data.errors.map(e => e.message).join(', '));
    }
    // Esempio rudimentale per errori REST nel body
    if (response.status >= 400 && data.error) { // REST errors
         console.error("Shopify API Errors (REST):", JSON.stringify(data.error, null, 2));
         throw new Error(data.error);
    }
    if (response.status >= 400 && data.errors) { // REST errors (a volte come array di errori)
        console.error("Shopify API Errors (REST):", JSON.stringify(data.errors, null, 2));
        if (Array.isArray(data.errors)) {
            throw new Error(data.errors.join(', '));
        }
        if (typeof data.errors === 'object') {
            throw new Error(Object.values(data.errors).flat().join(', '));
        }
        throw new Error(data.errors.toString());
    }


    return data; // REST restituisce l'oggetto risorsa direttamente, GraphQL restituisce data.data
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

        // 1. ANALIZZA PRODOTTI (rimane invariato, usa GraphQL)
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

            // Chiamata all'API GraphQL (passando la query come primo argomento)
            const shopifyData = await callShopifyApi(query, 'POST', { query: query }); // Passa la query come oggetto GraphQL

            const products = [];
            const foundSkus = new Set();

            if (shopifyData.data && shopifyData.data.products && shopifyData.data.products.edges) { // Accesso ai dati GraphQL
                shopifyData.data.products.edges.forEach(productEdge => {
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

        // 2. SINCRONIZZA PREZZI - ORA USA L'API REST
        if (payload.type === 'sync') {
            const { items } = payload; 

            if (!items || !Array.isArray(items) || items.length === 0) {
                return { statusCode: 200, body: JSON.stringify({ success: true, message: "Nessuna azione da eseguire." }) };
            }

            const results = [];
            const errors = [];

            // Adesso iteriamo su ogni singolo item e inviamo una richiesta REST PUT
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
                    continue; 
                }
                
                const formattedPrice = parsedPrice.toFixed(2);

                // L'ID della variante GraphQL (gid://...) deve essere convertito a ID numerico per l'API REST
                // L'ID numerico si trova alla fine del GID.
                const restVariantId = variantId.split('/').pop();
                if (!restVariantId) {
                    console.error(`ERROR: Could not parse REST ID from GID: ${variantId}`);
                    errors.push(`Invalid Variant ID format for REST: ${variantId}`);
                    continue;
                }

                // Endpoint API REST per aggiornare la variante
                // Usiamo la versione API 2024-07 per REST.
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
                    // Chiamata all'API REST (metodo PUT, con body)
                    const result = await callShopifyApi(endpoint, 'PUT', requestBody);
                    // L'API REST restituisce l'oggetto variante aggiornato o errori.
                    if (result.variant && result.variant.id) {
                        results.push({ variantId, success: true, rest_response: result.variant });
                    } else {
                        // Gestione di errori REST non nel campo 'errors' ma nel body di risposta
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
