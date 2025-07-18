// netlify/functions/get-all-shopify-products.js - AGGIORNATO ENDPOINT HTTP

// Importa la funzione getShopifyProducts dalla tua libreria API Shopify
const { getShopifyProducts } = require('./shopify-api');

exports.handler = async (event, context) => {
    // Solo richieste GET sono permesse per questo endpoint
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        console.log("Invocazione della funzione get-all-shopify-products.");

        // Recupera i parametri di paginazione dalla query string
        const pageInfo = event.queryStringParameters.page_info || null;
        const limit = parseInt(event.queryStringParameters.limit || '20', 10); // Default a 20 prodotti per pagina

        console.log(`Richiesta di prodotti Shopify: page_info=${pageInfo}, limit=${limit}`);

        // Chiama getShopifyProducts con i parametri di paginazione
        // skusToFetch rimane vuoto per questa funzione che deve recuperare tutti i prodotti
        const result = await getShopifyProducts([], pageInfo, limit); // Ora getShopifyProducts restituisce un oggetto

        console.log(`Recuperati ${result.products.length} prodotti per la pagina corrente.`);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: 'Prodotti Shopify recuperati con successo!',
                shopifyProducts: result.products,
                nextPageInfo: result.nextPageInfo,
                prevPageInfo: result.prevPageInfo
            }),
        };

    } catch (error) {
        console.error('Errore nella Netlify Function get-all-shopify-products:', error);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: `Errore del server: ${error.message}` }),
        };
    }
};