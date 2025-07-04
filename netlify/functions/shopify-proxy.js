// Funzione per eseguire chiamate API a Shopify
async function callShopifyApi(query) {
    const storeName = process.env.SHOPIFY_STORE_NAME;
    const adminApiToken = process.env.SHOPIFY_ADMIN_API_TOKEN;

    if (!storeName || !adminApiToken) {
        throw new Error("Variabili d'ambiente SHOPIFY_STORE_NAME o SHOPIFY_ADMIN_API_TOKEN non trovate.");
    }

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
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const payload = JSON.parse(event.body);

        // Caso 1: L'app chiede di ANALIZZARE i prodotti
        if (payload.type === 'analyze') {
            const { skus } = payload;
            // CORREZIONE #3: La query ora costruisce una stringa di ricerca OR valida per Shopify.
            const skuQueryString = skus.map(s => `sku:'${s}'`).join(' OR ');
            const query = `
                query getProductsBySkus {
                    products(first: ${skus.length}, query: "${skuQueryString}") {
                        edges {
                            node {
                                title
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
                    minsan: variant?.sku,
                    title: edge.node.title,
                    inventory_quantity: variant?.inventoryQuantity,
                    inventory_item_id: variant?.inventoryItem.id,
                };
            });
            return { statusCode: 200, body: JSON.stringify(products) };
        }

        // Caso 2: L'app chiede di SINCRONIZZARE un prodotto
        if (payload.type === 'sync') {
            const { inventoryItemId, quantity } = payload;
            const locationIdRaw = process.env.SHOPIFY_LOCATION_ID;
            if (!locationIdRaw) {
                throw new Error("Variabile d'ambiente SHOPIFY_LOCATION_ID non trovata.");
            }
            const locationId = `gid://shopify/Location/${locationIdRaw}`;
            const mutation = `
                mutation inventorySetOnHandQuantities {
                    inventorySetOnHandQuantities(input: {
                        reason: "correction",
                        setQuantities: [{
                            inventoryItemId: "${inventoryItemId}",
                            locationId: "${locationId}",
                            quantity: ${quantity}
                        }]
                    }) {
                        userErrors { field message }
                    }
                }`;
            const result = await callShopifyApi(mutation);
            if (result.inventorySetOnHandQuantities.userErrors.length > 0) {
                throw new Error(result.inventorySetOnHandQuantities.userErrors.map(e => e.message).join(', '));
            }
            return { statusCode: 200, body: JSON.stringify({ success: true }) };
        }

        // Se il tipo di richiesta non è valido
        return { statusCode: 400, body: JSON.stringify({ error: 'Tipo di richiesta non valido.' }) };

    } catch (error) {
        console.error('Errore nel backend:', error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
