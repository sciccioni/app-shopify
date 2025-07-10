// supabase-ingest.js
import { createClient } from '@supabase/supabase-js';

// Queste variabili d'ambiente devono essere configurate su Netlify
// SUPABASE_URL e SUPABASE_ANON_KEY sono disponibili nella dashboard del tuo progetto Supabase
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Inizializza il client Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const payload = JSON.parse(event.body);
        const { productsToIngest } = payload;

        if (!productsToIngest || !Array.isArray(productsToIngest) || productsToIngest.length === 0) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Nessun prodotto fornito per l\'ingestione.' }) };
        }

        const ingestionResults = [];

        for (const productData of productsToIngest) {
            const { minsan, title, giacenzaFile, scadenzaFile, shopify_product_id, shopify_variant_id, shopify_inventory_item_id, shopify_on_hand_quantity, shopify_available_quantity, shopify_committed_quantity, shopify_unavailable_quantity, shopify_expiry_date, status, details, _debug_source_row } = productData;

            try {
                // 1. Inserisci o aggiorna il prodotto nella tabella 'products'
                // Utilizziamo upsert per gestire sia nuovi prodotti che aggiornamenti
                const { data: product, error: productError } = await supabase
                    .from('products')
                    .upsert({
                        sku_or_minsan: minsan,
                        title: title || _debug_source_row?.Descrizione || '', // Usa il titolo da Shopify o la descrizione dal file
                        shopify_product_id,
                        shopify_variant_id,
                        shopify_inventory_item_id,
                        last_ingested_at: new Date().toISOString()
                    }, { onConflict: 'sku_or_minsan', ignoreDuplicates: false }) // Aggiorna se SKU esiste
                    .select(); // Richiedi i dati inseriti/aggiornati

                if (productError) {
                    console.error('Errore upsert prodotto:', productError);
                    throw new Error(`Errore upsert prodotto ${minsan}: ${productError.message}`);
                }

                const productId = product[0].id; // Ottieni l'ID del prodotto da Supabase

                // 2. Inserisci un nuovo record in 'inventory_updates'
                // Questo crea uno storico di ogni tentativo di aggiornamento
                const { data: inventoryUpdate, error: updateError } = await supabase
                    .from('inventory_updates')
                    .insert({
                        product_id: productId,
                        quantity_from_file: giacenzaFile,
                        expiry_date_from_file: scadenzaFile,
                        shopify_on_hand_quantity,
                        shopify_available_quantity,
                        shopify_committed_quantity,
                        shopify_unavailable_quantity,
                        shopify_expiry_date,
                        status, // Lo stato iniziale dall'analisi (es. 'to-update', 'not-found', 'error')
                        details,
                        last_sync_attempt_at: new Date().toISOString()
                    });

                if (updateError) {
                    console.error('Errore insert inventory_update:', updateError);
                    throw new Error(`Errore insert update per ${minsan}: ${updateError.message}`);
                }

                ingestionResults.push({ minsan, status: 'success', message: 'Dati ingeriti con successo in Supabase.' });

            } catch (itemError) {
                console.error(`Errore durante l'ingestione per ${minsan}:`, itemError);
                ingestionResults.push({ minsan, status: 'error', message: itemError.message });
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, results: ingestionResults })
        };

    } catch (error) {
        console.error('Errore generale nella funzione di ingestione:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: `Errore del server durante l'ingestione: ${error.message}` })
        };
    }
};
