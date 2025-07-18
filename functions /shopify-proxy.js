const fetch = require('node-fetch');

// Funzione per eseguire chiamate API a Shopify
async function callShopifyApi(query, variables = {}) {
    const storeName = process.env.SHOPIFY_STORE_NAME;
    const adminApiToken = process.env.SHOPIFY_ADMIN_API_TOKEN;

    // Verifica che le variabili d'ambiente siano impostate correttamente
    if (!storeName || !adminApiToken) {
        console.error('Mancano le variabili d\'ambiente SHOPIFY_STORE_NAME o SHOPIFY_ADMIN_API_TOKEN.');
        throw new Error('Variabili d\'ambiente non configurate correttamente.');
    }

    try {
        const response = await fetch(`https://${storeName}/admin/api/2024-04/graphql.json`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': adminApiToken,
            },
            body: JSON.stringify({ query, variables }),
        });

        const data = await response.json();

        // Se ci sono errori nell'API, logga e lancia un'eccezione
        if (data.errors) {
            console.error("Errore API Shopify:", data.errors);
            throw new Error(data.errors.map(e => e.message).join(', '));
        }

        return data.data;
    } catch (error) {
        console.error('Errore durante la chiamata API a Shopify:', error);
        throw new Error('Errore durante la comunicazione con Shopify.');
    }
}

// Funzione principale del backend
exports.handler = async function(event) {
    // Funzione interna che contiene la logica principale
    const mainLogic = async () => {
        const { SHOPIFY_STORE_NAME, SHOPIFY_ADMIN_API_TOKEN, SHOPIFY_LOCATION_ID, APP_PASSWORD, JWT_SECRET } = process.env;
        
        // Controlla subito le variabili d'ambiente necessarie
        if (!SHOPIFY_STORE_NAME || !SHOPIFY_ADMIN_API_TOKEN || !SHOPIFY_LOCATION_ID || !APP_PASSWORD || !JWT_SECRET) {
            const missing = [
                !SHOPIFY_STORE_NAME && "SHOPIFY_STORE_NAME",
                !SHOPIFY_ADMIN_API_TOKEN && "SHOPIFY_ADMIN_API_TOKEN",
                !SHOPIFY_LOCATION_ID && "SHOPIFY_LOCATION_ID",
                !APP_PASSWORD && "APP_PASSWORD",
                !JWT_SECRET && "JWT_SECRET"
            ].filter(Boolean).join(', ');
            console.error(`Variabili d'ambiente mancanti su Netlify: ${missing}`);
            throw new Error(`Variabili d'ambiente mancanti su Netlify: ${missing}`);
        }

        if (event.httpMethod !== 'POST') {
            console.error("Metodo non consentito:", event.httpMethod);
            return { statusCode: 405, body: 'Method Not Allowed' };
        }

        const payload = JSON.parse(event.body);

        // Gestione login con password
        if (payload.type === 'login') {
            const { password } = payload;
            if (password === APP_PASSWORD) {
                return { statusCode: 200, body: JSON.stringify({ success: true }) };
            } else {
                return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Password non corretta.' }) };
            }
        }

        // Caso: Analisi dei prodotti
        if (payload.type === 'analyze') {
            const { skus } = payload;
            console.log("Inizio analisi per SKUs:", skus);
            
            const skuQueryString = skus.map(s => `sku:'${s}'`).join(' OR ');
            const query = `
                query getProductsBySkus {
                    products(first: ${skus.length}, query: "${skuQueryString}") {
                        edges {
                            node {
                                id
                                title
                                expireDate: metafield(namespace: "custom", key: "data_di_scadenza") {
                                    value
                                }
                                variants(first: 1) {
                                    edges { 
                                        node { 
                                            sku
                                            inventoryItem { 
                                                id 
                                                inventoryLevels(first: 1, query: "location_id:gid://shopify/Location/${SHOPIFY_LOCATION_ID}") {
                                                    edges {
                                                        node {
                                                            quantities(names: ["available", "committed", "on_hand"]) {
                                                                name
                                                                quantity
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                            inventoryQuantity 
                                        } 
                                    }
                                }
                            }
                        }
                    }
                }`;
            
            try {
                const shopifyData = await callShopifyApi(query);
                const products = shopifyData.products.edges.map(edge => {
                    const variant = edge.node.variants.edges[0]?.node;
                    const inventoryLevel = variant?.inventoryItem?.inventoryLevels?.edges[0]?.node;
                    let onHand, available, committed;

                    if (inventoryLevel && Array.isArray(inventoryLevel.quantities)) {
                        inventoryLevel.quantities.forEach(q => {
                            if (q.name === 'on_hand') onHand = q.quantity;
                            if (q.name === 'available') available = q.quantity;
                            if (q.name === 'committed') committed = q.quantity;
                        });
                    }
                    const unavailable = (onHand !== undefined && available !== undefined) ? (onHand - available) : undefined;

                    return {
                        product_id: edge.node.id,
                        minsan: variant?.sku,
                        title: edge.node.title,
                        inventory_quantity: variant?.inventoryQuantity,
                        inventory_item_id: variant?.inventoryItem.id,
                        expiry_date: edge.node.expireDate?.value,
                        on_hand_quantity: onHand,
                        available_quantity: available,
                        committed_quantity: committed,
                        unavailable_quantity: unavailable
                    };
                });

                return { statusCode: 200, body: JSON.stringify(products) };
            } catch (error) {
                console.error("Errore nell'analisi dei prodotti:", error);
                return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
            }
        }

        // Caso: Sincronizzazione dei prodotti
        if (payload.type === 'sync') {
            const { items } = payload;
            if (!items || !Array.isArray(items) || items.length === 0) {
                console.error("Nessun prodotto da sincronizzare.");
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
                    key: "data_di_scadenza",
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

            try {
                const result = await callShopifyApi(finalMutation);

                const userErrors = [
                    ...(result.inventoryUpdate?.userErrors || []),
                    ...(result.metafieldsUpdate?.userErrors || [])
                ];

                if (userErrors.length > 0) {
                    throw new Error(userErrors.map(e => e.message).join(', '));
                }

                return { statusCode: 200, body: JSON.stringify({ success: true }) };
            } catch (error) {
                console.error("Errore nella sincronizzazione dei prodotti:", error);
                return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
            }
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
