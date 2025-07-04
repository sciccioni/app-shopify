// Funzione per eseguire chiamate API a Shopify
async function callShopifyApi(query) {
    // Prende le credenziali segrete dalle variabili d'ambiente di Netlify
    const storeName = process.env.SHOPIFY_STORE_NAME;
    const adminApiToken = process.env.SHOPIFY_ADMIN_API_TOKEN;

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

// Funzione principale del backend che viene eseguita da Netlify
exports.handler = async function(event) {
    // Accetta solo richieste di tipo POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const payload = JSON.parse(event.body);

        // Caso 1: L'app chiede di ANALIZZARE i prodotti
        if (payload.type === 'analyze') {
            const { skus } = payload;
            const query = `
                query getProductsBySkus {
                    products(first: ${skus.length}, query: "sku:(${skus.join(' OR ')})") {
                        edges {
                            node {
                                title
                                sku
                                variants(first: 1) {
                                    edges { node { inventoryItem { id } inventoryQuantity } }
                                }
                            }
                        }
                    }
                }`;
            const shopifyData = await callShopifyApi(query);
            // Formatta i dati per l'app frontend
            const products = shopifyData.products.edges.map(edge => {
                const variant = edge.node.variants.edges[0]?.node;
                return {
                    minsan: edge.node.sku,
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
            // Prende l'ID della sede dalle variabili d'ambiente
            const locationId = `gid://shopify/Location/${process.env.SHOPIFY_LOCATION_ID}`;
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
