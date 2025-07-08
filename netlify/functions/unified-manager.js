const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');

// Funzione per verificare il token JWT
function verifyToken(authHeader) {
    if (!authHeader) {
        throw new Error('Autorizzazione mancante.');
    }
    const token = authHeader.split(' ')[1]; // Formato: "Bearer TOKEN"
    try {
        jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        throw new Error('Token non valido o scaduto.');
    }
}

// Funzione per eseguire chiamate API a Shopify
async function callShopifyApi(query) {
    const { SHOPIFY_STORE_NAME, SHOPIFY_ADMIN_API_TOKEN } = process.env;
    const endpoint = `https://${SHOPIFY_STORE_NAME}.myshopify.com/admin/api/2024-04/graphql.json`;

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
        },
        body: JSON.stringify({ query }),
    });

    const data = await response.json();
    if (data.errors) {
        throw new Error(data.errors.map(e => e.message).join(', '));
    }
    return data.data;
}

// Handler principale della funzione Netlify
exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const payload = JSON.parse(event.body);

        switch (payload.action) {
            // --- AZIONI PUBBLICHE ---
            case 'login':
                const { password } = payload;
                if (!password || password !== process.env.APP_PASSWORD) {
                    return { statusCode: 401, body: JSON.stringify({ error: 'Password non corretta.' }) };
                }
                const token = jwt.sign({ authorized: true }, process.env.JWT_SECRET, { expiresIn: '8h' });
                return { statusCode: 200, body: JSON.stringify({ token }) };

            // --- AZIONI PROTETTE ---
            case 'get-initial-data':
                verifyToken(event.headers.authorization);
                return getInitialData(payload.skus);
            
            case 'sync-inventory':
                 verifyToken(event.headers.authorization);
                 return syncInventory(payload.items);

            case 'update-prices':
                verifyToken(event.headers.authorization);
                return updatePrices(payload.items);

            default:
                return { statusCode: 400, body: JSON.stringify({ error: 'Azione non riconosciuta' }) };
        }
    } catch (error) {
        console.error('Errore nel backend:', error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};

// Recupera tutti i dati iniziali (prezzi e giacenze)
async function getInitialData(skus) {
    const skuQueryString = skus.map(s => `sku:'${s}'`).join(' OR ');
    const query = `
        query getProductsBySkus {
            productVariants(first: ${skus.length}, query: "${skuQueryString}") {
                edges {
                    node {
                        sku
                        price
                        inventoryQuantity
                        inventoryItem { id }
                        product {
                            id
                            title
                            expireDate: metafield(namespace: "custom", key: "data_di_scadenza") {
                                value
                            }
                        }
                    }
                }
            }
        }`;
    
    const shopifyData = await callShopifyApi(query);
    const products = shopifyData.productVariants.edges.map(edge => {
        const variant = edge.node;
        const product = variant.product;
        return {
            sku: variant.sku,
            price: parseFloat(variant.price),
            inventory_quantity: variant.inventoryQuantity,
            inventory_item_id: variant.inventoryItem.id,
            product_id: product.id,
            title: product.title,
            expiry_date: product.expireDate?.value
        };
    });

    return { statusCode: 200, body: JSON.stringify({ results: products }) };
}

// Sincronizza giacenze e scadenze
async function syncInventory(items) {
    const locationId = `gid://shopify/Location/${process.env.SHOPIFY_LOCATION_ID}`;
    let mutations = [];

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
            }) { userErrors { field message } }
        `);
    }

    const metafieldItems = items.filter(item => item.productId && item.expiryDate);
    if (metafieldItems.length > 0) {
        const metafieldsString = metafieldItems.map(item => `{
            ownerId: "${item.productId}",
            namespace: "custom",
            key: "data_di_scadenza",
            type: "date",
            value: "${item.expiryDate}"
        }`).join(',\n');
        mutations.push(`
            metafieldsUpdate: metafieldsSet(metafields: [${metafieldsString}]) { userErrors { field message } }
        `);
    }

    if (mutations.length > 0) {
        const finalMutation = `mutation { ${mutations.join('\n')} }`;
        const result = await callShopifyApi(finalMutation);
        const userErrors = [...(result.inventoryUpdate?.userErrors || []), ...(result.metafieldsUpdate?.userErrors || [])];
        if (userErrors.length > 0) {
            throw new Error(userErrors.map(e => e.message).join(', '));
        }
    }

    // Ritorna un successo generico, il frontend gestisce lo stato per riga
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
}


// Aggiorna i prezzi
async function updatePrices(items) {
    let results = [];
    for (const item of items) {
        const findVariantQuery = `query { productVariants(first: 1, query: "sku:${item.sku}") { edges { node { id } } } }`;
        try {
            const findData = await callShopifyApi(findVariantQuery);
            const variantId = findData.productVariants.edges[0]?.node.id;

            if (!variantId) {
                results.push({ sku: item.sku, success: false, error: 'SKU non trovato' });
                continue;
            }

            const updatePriceMutation = `
                mutation { productVariantUpdate(input: {id: "${variantId}", price: "${item.price}"}) {
                    productVariant { id price }
                    userErrors { field message }
                } }`;
            
            const updateData = await callShopifyApi(updatePriceMutation);
            if (updateData.productVariantUpdate.userErrors.length > 0) {
                throw new Error(updateData.productVariantUpdate.userErrors.map(e => e.message).join(', '));
            }
            results.push({ sku: item.sku, success: true });
        } catch (error) {
            results.push({ sku: item.sku, success: false, error: error.message });
        }
    }
    
    const successCount = results.filter(r => r.success).length;
    return {
        statusCode: 200,
        body: JSON.stringify({
            message: 'Operazione completata.',
            summary: { success: successCount, failure: results.length - successCount },
            results: results,
        }),
    };
}
