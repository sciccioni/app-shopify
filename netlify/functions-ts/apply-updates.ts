import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

// --- INTERFACCE ---
interface PendingUpdate {
  id: number;
  product_variant_id: string;
  inventory_item_id: string;
  changes: {
    quantity?: { old: number; new: number };
    price?: { old: string; new: string };
    cost?: { old: number | null; new: string };
  };
}

// --- FUNZIONI HELPER PER SHOPIFY ---
async function executeShopifyMutation(domain: string, token: string, query: string, variables: object) {
  const url = `https://${domain}/admin/api/2025-07/graphql.json`; // API AGGIORNATA
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const jsonResponse = await response.json() as any;
  const userErrors = jsonResponse.data?.productVariantUpdate?.userErrors || jsonResponse.data?.inventoryAdjustQuantities?.userErrors || [];
  if (jsonResponse.errors || userErrors.length > 0) {
    console.error("Shopify API Error:", JSON.stringify(jsonResponse, null, 2));
    const errorMessage = userErrors.map((e: any) => e.message).join(', ') || jsonResponse.errors?.map((e: any) => e.message).join(', ') || "Errore sconosciuto da Shopify.";
    throw new Error(errorMessage);
  }
  return jsonResponse;
}

// --- HANDLER PRINCIPALE ---
const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Metodo non consentito." }) };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, SHOPIFY_STORE_NAME, SHOPIFY_ADMIN_API_TOKEN, SHOPIFY_LOCATION_ID } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SHOPIFY_STORE_NAME || !SHOPIFY_ADMIN_API_TOKEN || !SHOPIFY_LOCATION_ID) {
    return { statusCode: 500, body: JSON.stringify({ error: "Variabili d'ambiente mancanti." }) };
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const { update_ids, import_id } = JSON.parse(event.body || "{}");
    if (!update_ids || !Array.isArray(update_ids) || update_ids.length === 0 || !import_id) {
      return { statusCode: 400, body: JSON.stringify({ error: "Dati mancanti." }) };
    }

    const { data: updates, error: fetchError } = await supabase
      .from('pending_updates')
      .select('id, product_variant_id, inventory_item_id, changes')
      .in('id', update_ids)
      .returns<PendingUpdate[]>();
    if (fetchError) throw fetchError;
    
    console.log(`Trovate ${updates?.length || 0} modifiche da applicare.`);

    let successCount = 0;
    let errorCount = 0;
    const logs = [];

    for (const update of updates) {
      const { product_variant_id, inventory_item_id, changes } = update;
      
      try {
        console.log(`Processando product_variant_id: ${product_variant_id}`);
        // A. Aggiorna prezzo e costo
        if (changes.price || changes.cost) {
          const variantInput: any = { id: product_variant_id };
          if (changes.price) variantInput.price = changes.price.new;
          if (changes.cost) variantInput.inventoryItem = { cost: changes.cost.new };
          
          const mutation = `mutation productVariantUpdate($input: ProductVariantInput!) {
            productVariantUpdate(input: $input) { productVariant { id } userErrors { field message } }
          }`;
          await executeShopifyMutation(SHOPIFY_STORE_NAME, SHOPIFY_ADMIN_API_TOKEN, mutation, { input: variantInput });
        }

        // B. Aggiorna la giacenza
        if (changes.quantity && inventory_item_id) {
          const delta = changes.quantity.new - changes.quantity.old;
          const mutation = `mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
            inventoryAdjustQuantities(input: $input) { userErrors { field message } }
          }`;
          const variables = { input: { reason: "correction", name: "Excel Sync", changes: [{ inventoryItemId: inventory_item_id, locationId: `gid://shopify/Location/${SHOPIFY_LOCATION_ID}`, delta: delta }] } };
          await executeShopifyMutation(SHOPIFY_STORE_NAME, SHOPIFY_ADMIN_API_TOKEN, mutation, variables);
        }

        successCount++;
        logs.push({ import_id, product_variant_id, status: 'success', action: 'update', details: { message: 'Aggiornato con successo.' } });

      } catch (e: any) {
        errorCount++;
        logs.push({ import_id, product_variant_id, status: 'error', action: 'update', details: { error: e.message } });
      }
    }

    // --- SEZIONE DI LOGGING MIGLIORATA ---
    if (logs.length > 0) {
        console.log(`Tentativo di inserire ${logs.length} record in sync_logs.`);
        try {
            const { error: logError } = await supabase.from('sync_logs').insert(logs);
            if (logError) {
                // Se anche il logging fallisce, lo stampiamo nella console di Netlify
                console.error("ERRORE CRITICO: Impossibile salvare i log su Supabase.", logError);
                throw new Error("Impossibile salvare i log delle operazioni.");
            }
            console.log("Log salvati con successo.");
        } catch (logCatchError) {
             console.error("Eccezione durante il salvataggio dei log:", logCatchError);
        }
    }
    
    console.log("Tentativo di eliminare le modifiche processate da pending_updates.");
    await supabase.from('pending_updates').delete().in('id', update_ids);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Processo di aggiornamento completato.", success: successCount, errors: errorCount }),
    };

  } catch (error: any) {
    console.error("Errore durante l'applicazione delle modifiche:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || "Errore interno." }) };
  }
};

export { handler };
