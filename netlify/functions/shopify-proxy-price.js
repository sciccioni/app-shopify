// Funzione helper per eseguire chiamate all'API GraphQL di Shopify
async function callShopifyApi(query, variables = {}) {
    const { SHOPIFY_STORE_NAME, SHOPIFY_ADMIN_API_TOKEN } = process.env;

    let shopifyBaseUrl;
    if (SHOPIFY_STORE_NAME.includes('.myshopify.com')) {
        shopifyBaseUrl = `https://${SHOPIFY_STORE_NAME}`;
    } else {
        shopifyBaseUrl = `https://${SHOPIFY_STORE_NAME}.myshopify.com`;
    }

    const response = await fetch(`${shopifyBaseUrl}/admin/api/2024-07/graphql.json`, { 
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
                                    product_id: productNode.id, // Assicurati di avere questo ID dal frontend
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

        // 2. SINCRONIZZA PREZZI - Raggruppiamo per productId per usare productVariantsBulkUpdate
        if (payload.type === 'sync') {
            const { items } = payload; // 'items' qui sono le varianti da aggiornare

            if (!items || !Array.isArray(items) || items.length === 0) {
                return { statusCode: 200, body: JSON.stringify({ success: true, message: "Nessuna azione da eseguire." }) };
            }

            // Raggruppa gli item per productId
            const itemsGroupedByProductId = items.reduce((acc, item) => {
                const productId = item.productId; // Abbiamo bisogno del productId dal frontend!
                if (!productId) {
                    console.warn(`WARN: Variant ${item.variantId} missing productId, skipping.`);
                    return acc;
                }
                if (!acc[productId]) {
                    acc[productId] = [];
                }
                acc[productId].push(item);
                return acc;
            }, {});

            const results = [];
            const errors = [];

            // Itera su ogni gruppo di productId e invia una mutazione bulk separata
            for (const productId in itemsGroupedByProductId) {
                const variantsToUpdate = itemsGroupedByProductId[productId];

                const variantInputs = variantsToUpdate.map(variantItem => ({
                    id: variantItem.variantId,
                    price: parseFloat(variantItem.price).toFixed(2)
                }));

                const mutation = `
                    mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantBulkUpdateInput!]!) {
                        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                            productVariants {
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
                    productId: productId,
                    variants: variantInputs
                };

                console.log(`DEBUG: Sending productVariantsBulkUpdate for productId: ${productId}`);
                console.log("DEBUG: Mutation:", mutation);
                console.log("DEBUG: Variables:", JSON.stringify(variables, null, 2));

                try {
                    const result = await callShopifyApi(mutation, variables);
                    const userErrors = result.productVariantsBulkUpdate?.userErrors || [];
                    if (userErrors.length > 0) {
                        userErrors.forEach(err => errors.push(`[${productId} - ${err.field?.join(', ') || 'N/A'}]: ${err.message}`));
                    } else {
                        results.push({ productId, success: true });
                    }
                } catch (e) {
                    errors.push(`Error for productId ${productId}: ${e.message}`);
                }
            }

            if (errors.length > 0) {
                throw new Error("Errore durante la sincronizzazione di alcuni prodotti: " + errors.join('; '));
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
