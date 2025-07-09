// Funzione helper per eseguire chiamate all'API GraphQL di Shopify
async function callShopifyApi(query, variables = {}) {
    // Recupera le credenziali dalle variabili d'ambiente del server
    const { SHOPIFY_STORE_NAME, SHOPIFY_ADMIN_API_TOKEN } = process.env;

    // Determina l'URL base di Shopify. Se SHOPIFY_STORE_NAME include già ".myshopify.com",
    // lo usiamo direttamente. Altrimenti, lo concateniamo.
    let shopifyBaseUrl;
    if (SHOPIFY_STORE_NAME.includes('.myshopify.com')) {
        shopifyBaseUrl = `https://${SHOPIFY_STORE_NAME}`;
    } else {
        shopifyBaseUrl = `https://${SHOPIFY_STORE_NAME}.myshopify.com`;
    }

    // Esegue la chiamata all'endpoint GraphQL di Shopify
    const response = await fetch(`${shopifyBaseUrl}/admin/api/2024-07/graphql.json`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
        },
        body: JSON.stringify({ query, variables }),
    });

    const data = await response.json();
    
    // Se Shopify restituisce errori, li inoltra al frontend
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
        // Controllo robusto delle variabili d'ambiente
        const { SHOPIFY_STORE_NAME, SHOPIFY_ADMIN_API_TOKEN, APP_PASSWORD } = process.env;
        if (!SHOPIFY_STORE_NAME || !SHOPIFY_ADMIN_API_TOKEN || !APP_PASSWORD) {
            const missing = [
                !SHOPIFY_STORE_NAME && "SHOPIFY_STORE_NAME",
                !SHOPIFY_ADMIN_API_TOKEN && "SHOPIFY_ADMIN_API_TOKEN",
                !APP_PASSWORD && "APP_PASSWORD"
            ].filter(Boolean).join(', ');
            throw new Error(`Variabili d'ambiente mancanti su Netlify: ${missing}`);
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

        // 1. ANALIZZA PRODOTTI
        if (payload.type === 'analyze') {
            const { skus } = payload;
            if (!skus || !Array.isArray(skus)) {
                 throw new Error("Array di SKU/Minsan non fornito.");
            }
            
            // *** FIX AGGIUNTIVO PER L'ERRORE DI SINTASSI (unexpected INT) ***
            // Aggiungiamo un prefisso al valore dello SKU nella query per forzare l'interpretazione come stringa
            // e ci assicuriamo che sia pulito e escapato correttamente.
            const skuQueryString = skus.map(s => {
                const cleanedSku = String(s).trim().replace(/"/g, '\\"');
                return `sku:"${cleanedSku}"`; // Manteniamo la sintassi standard
            }).join(' OR ');

            // Aggiungiamo un console.log per debuggarre la stringa generata
            console.log("DEBUG: Generated skuQueryString:", skuQueryString);
            
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
            
            const shopifyData = await callShopifyApi(query);
            
            const products = [];
            const foundSkus = new Set();

            if (shopifyData.products && shopifyData.products.edges) {
                shopifyData.products.edges.forEach(productEdge => {
                    const productNode = productEdge.node;
                    if (productNode.variants && productNode.variants.edges) {
                        productNode.variants.edges.forEach(variantEdge => {
                            const variantNode = variantEdge.node;
                            // Controlliamo se lo SKU del prodotto Shopify corrisponde a uno degli SKU nel payload
                            // Usiamo String(variantNode.sku) per garantire la comparazione tra stringhe
                            if (variantNode && skus.map(s => String(s)).includes(String(variantNode.sku))) {
                                products.push({
                                    found: true,
                                    minsan: String(variantNode.sku), // Assicuriamo che sia stringa
                                    price: variantNode.price,
                                    variant_id: variantNode.id,
                                    product_id: productNode.id,
                                    title: productNode.title,
                                });
                                foundSkus.add(String(variantNode.sku)); // Assicuriamo che sia stringa
                            }
                        });
                    }
                });
            }

            // Aggiungiamo i prodotti non trovati, assicurandoci che 'minsan' sia una stringa
            skus.forEach(sku => {
                if (!foundSkus.has(String(sku))) {
                    products.push({ found: false, minsan: String(sku) });
                }
            });

            return { statusCode: 200, body: JSON.stringify(products) };
        }

        // 2. SINCRONIZZA PREZZI
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

            const allErrors = Object.values(result).flatMap(res => res.userErrors || []);
            if (allErrors.length > 0) {
                throw new Error(allErrors.map(e => `[${e.field.join(', ')}]: ${e.message}`).join('; '));
            }

            return { statusCode: 200, body: JSON.stringify({ success: true, data: result }) };
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
