// Funzione per eseguire chiamate API a Shopify
async function callShopifyApi(query) {
    const storeName = process.env.SHOPIFY_STORE_NAME;
    const adminApiToken = process.env.SHOPIFY_ADMIN_API_TOKEN;

    // Le variabili sono già state controllate all'inizio della funzione handler
    const response = await fetch(`https://${storeName}/admin/api/2024-04/graphql.json`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': adminApiToken,
        },
        body: JSON.stringify({ query }),
    });

    const data = await response.json();
    if (data.errors) {
        throw new Error(data.errors.map(e => e.message).join(', '));
    }
    return data.data;
}

// Funzione principale del backend
exports.handler = async function(event) {
    // Funzione interna che contiene la logica principale
    const mainLogic = async () => {
        // Controlla subito le variabili d'ambiente necessarie
        const { SHOPIFY_STORE_NAME, SHOPIFY_ADMIN_API_TOKEN, SHOPIFY_LOCATION_ID } = process.env;
        if (!SHOPIFY_STORE_NAME || !SHOPIFY_ADMIN_API_TOKEN || !SHOPIFY_LOCATION_ID) {
            const missing = [
                !SHOPIFY_STORE_NAME && "SHOPIFY_STORE_NAME",
                !SHOPIFY_ADMIN_API_TOKEN && "SHOPIFY_ADMIN_API_TOKEN",
                !SHOPIFY_LOCATION_ID && "SHOPIFY_LOCATION_ID"
            ].filter(Boolean).join(', ');
            // Restituisce un errore specifico se mancano delle variabili
            throw new Error(`Variabili d'ambiente mancanti su Netlify: ${missing}`);
        }

        if (event.httpMethod !== 'POST') {
            return { statusCode: 405, body: 'Method Not Allowed' };
        }

        const payload = JSON.parse(event.body);

        // Caso 1: L'app chiede di ANALIZZARE un pacchetto di prodotti
        if (payload.type === 'analyze') {
            const { skus } = payload;
            
            const skuQueryString = skus.map(s => `sku:'${s}'`).join(' OR ');
            const query = `
                query getProductsBySkus {
                    products(first: ${skus.length}, query: "${skuQueryString}") {
                        edges {
                            node {
                                id
                                title
                                expireDate: metafield(namespace: "custom", key: "Expire_Date") {
                                    value
                                }
                                variants(first: 1) {
                                    edges { 
                                        node { 
                                            sku
                                            inventoryItem { id } 
                                            inventoryQuantity 
                                        } 
                                    }
                                }
                            }
                        }
                    }
                }`;
            const shopifyData = await callShopifyApi(query);
            const products = shopifyData.products.edges.map(edge => {
                const variant = edge.node.variants.edges[0]?.node;
                return {
                    product_id: edge.node.id,
                    minsan: variant?.sku,
                    title: edge.node.title,
                    inventory_quantity: variant?.inventoryQuantity,
                    inventory_item_id: variant?.inventoryItem.id,
                    expiry_date: edge.node.expireDate?.value
                };
            });

            return { statusCode: 200, body: JSON.stringify(products) };
        }

        // Caso 2: L'app chiede di SINCRONIZZARE un pacchetto di prodotti
        if (payload.type === 'sync') {
            const { items } = payload;
            if (!items || !Array.isArray(items) || items.length === 0) {
                throw new Error("Nessun prodotto da sincronizzare nel pacchetto.");
            }

            const locationId = `gid://shopify/Location/${SHOPIFY_LOCATION_ID}`;
            
            let mutations = [];

            // 1. Mutazioni per le giacenze
            const inventoryItems = items.filter(item => item.inventoryItemId && item.quantity !== undefined);
            if (inventoryItems.length > 0) {
                const setQuantitiesString = inventoryItems.map(item => `{
                    inventoryItemId: "${item.inventoryItemId}",
                    locationId: "${locationId}",
                    quantity: ${item.quantity}
                }`).join(',\n');
                mutations.push(`
                    inventoryUpdate: inventorySetOnHandQuantities(input: {
                        reason: "correction",
                        setQuantities: [${setQuantitiesString}]
                    }) {
                        userErrors { field message }
                    }
                `);
            }

            // 2. Mutazioni per le date di scadenza (metafields)
            const metafieldItems = items.filter(item => item.productId && item.expiryDate);
            if (metafieldItems.length > 0) {
                const metafieldsString = metafieldItems.map(item => `{
                    ownerId: "${item.productId}",
                    namespace: "custom",
                    key: "Expire_Date",
                    type: "date",
                    value: "${item.expiryDate}"
                }`).join(',\n');
                mutations.push(`
                    metafieldsUpdate: metafieldsSet(metafields: [${metafieldsString}]) {
                        userErrors { field message }
                    }
                `);
            }

            if (mutations.length === 0) {
                return { statusCode: 200, body: JSON.stringify({ success: true, message: "Nessuna azione da eseguire." }) };
            }

            const finalMutation = `mutation { ${mutations.join('\n')} }`;
            
            const result = await callShopifyApi(finalMutation);

            const userErrors = [
                ...(result.inventoryUpdate?.userErrors || []),
                ...(result.metafieldsUpdate?.userErrors || [])
            ];

            if (userErrors.length > 0) {
                throw new Error(userErrors.map(e => e.message).join(', '));
            }

            return { statusCode: 200, body: JSON.stringify({ success: true }) };
        }

        return { statusCode: 400, body: JSON.stringify({ error: 'Tipo di richiesta non valido.' }) };
    };

    try {
        const watchdog = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Timeout della funzione superato (10s). Il pacchetto di dati potrebbe essere troppo grande.")), 9500)
        );
        return await Promise.race([mainLogic(), watchdog]);
    } catch (error) {
        console.error('Errore nel backend o timeout:', error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
