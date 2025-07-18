// netlify/functions/get-all-shopify-products.js - NUOVO ENDPOINT HTTP

// Importa la funzione getShopifyProducts dalla tua libreria API Shopify
const { getShopifyProducts } = require('./shopify-api');

exports.handler = async (event, context) => {
    // Solo richieste GET sono permesse per questo endpoint
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        console.log("Invocazione della funzione get-all-shopify-products.");

        // Chiama getShopifyProducts senza passare SKU per ottenere tutti i prodotti
        const shopifyProducts = await getShopifyProducts();

        console.log(`Recuperati ${shopifyProducts.length} prodotti totali da Shopify per la tab.`);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: 'Prodotti Shopify recuperati con successo!',
                shopifyProducts: shopifyProducts
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