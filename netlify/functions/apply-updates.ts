import { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const handler: Handler = async (event) => {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: JSON.stringify({ error: "Metodo non consentito." }) };
    }

    const { SUPABASE_URL, SUPABASE_SERVICE_KEY, SHOPIFY_STORE_NAME, SHOPIFY_ADMIN_API_TOKEN } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SHOPIFY_STORE_NAME || !SHOPIFY_ADMIN_API_TOKEN) {
        return { statusCode: 500, body: JSON.stringify({ error: "Variabili d'ambiente mancanti." }) };
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const shopifyEndpoint = `https://${SHOPIFY_STORE_NAME}/admin/api/2024-07/graphql.json`;

    let importId: string;
    let updateIds: number[];
    try {
        const body = JSON.parse(event.body || "{}");
        importId = body.import_id;
        updateIds = body.update_ids;
        if (!importId || !updateIds || !Array.isArray(updateIds)) {
            throw new Error("import_id e update_ids sono richiesti.");
        }
    } catch (error) {
        return { statusCode: 400, body: JSON.stringify({ error: "Corpo della richiesta non valido." }) };
    }

    try {
        // 1. Recupera le modifiche da applicare dal DB
        const { data: updates, error: fetchError } = await supabase
            .from('pending_updates')
            .select('*')
            .in('id', updateIds);

        if (fetchError) throw fetchError;

        let successCount = 0;
        let errorCount = 0;
        const logEntries = [];

        // 2. Cicla su ogni modifica e costruisce una mutazione GraphQL
        for (const update of updates) {
            const { changes, inventory_item_id, product_variant_id, minsan, id: pending_update_id } = update;
            let mutation = 'mutation {';
            let hasChanges = false;

            // A. Mutazione per prezzo, costo e prezzo barrato
            if (changes.price || changes.cost || changes.compare_at_price) {
                hasChanges = true;
                const priceInput = changes.price ? `price: "${changes.price.new}"` : '';
                const compareAtPriceInput = changes.compare_at_price ? `compareAtPrice: "${changes.compare_at_price.new}"` : '';
                const costInput = (changes.cost && inventory_item_id) ? `inventoryItem: { cost: "${changes.cost.new}" }` : '';
                
                mutation += `
                  variantUpdate: productVariantUpdate(input: {id: "${product_variant_id}", ${priceInput}, ${compareAtPriceInput}, ${costInput}}) {
                    userErrors { field message }
                  }
                `;
            }

            // B. Mutazione per la giacenza
            if (changes.quantity && inventory_item_id) {
                hasChanges = true;
                const delta = changes.quantity.new - changes.quantity.old;
                mutation += `
                  inventoryAdjust: inventoryAdjustQuantities(input: {
                    reason: "correction", 
                    name: "disponibile", 
                    changes: [{ inventoryItemId: "${inventory_item_id}", quantityDelta: ${delta} }]
                  }) {
                    userErrors { field message }
                  }
                `;
            }

            // C. Mutazione per il metafield della scadenza
            if (changes.expiry_date) {
                hasChanges = true;
                mutation += `
                    metafieldUpdate: metafieldsSet(metafields: [{
                        ownerId: "${product_variant_id}",
                        namespace: "custom",
                        key: "data_di_scadenza",
                        type: "date",
                        value: "${changes.expiry_date.new}"
                    }]) {
                        userErrors { field message }
                    }
                `;
            }
            mutation += '}';

            if (!hasChanges) continue;

            // 3. Esegue la mutazione su Shopify
            try {
                const response = await fetch(shopifyEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN },
                    body: JSON.stringify({ query: mutation })
                });
                const result = await response.json() as any;

                const errors = [
                    ...(result.data?.variantUpdate?.userErrors || []),
                    ...(result.data?.inventoryAdjust?.userErrors || []),
                    ...(result.data?.metafieldUpdate?.userErrors || [])
                ];

                if (errors.length > 0) {
                    throw new Error(errors.map(e => e.message).join(', '));
                }
                
                // Successo: prepara il log e rimuovi la modifica pendente
                successCount++;
                logEntries.push({ import_id: importId, pending_update_id, minsan, status: 'success', details: { changes } });
                await supabase.from('pending_updates').delete().eq('id', pending_update_id);

            } catch (e: any) {
                // Errore: prepara il log
                errorCount++;
                logEntries.push({ import_id: importId, pending_update_id, minsan, status: 'error', details: { error: e.message, attemptedChanges: changes } });
            }
        }
        
        // 4. Salva tutti i log in un'unica operazione
        if (logEntries.length > 0) {
            await supabase.from('sync_logs').insert(logEntries);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Operazione completata.", success: successCount, errors: errorCount }),
        };

    } catch (error: any) {
        console.error("Errore in apply-updates:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};

export { handler };
