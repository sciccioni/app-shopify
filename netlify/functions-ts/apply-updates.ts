import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

// --- INTERFACCE ---
interface PendingUpdate {
  id: number;
  product_variant_id: string;
  changes: {
    quantity?: { old: number; new: number };
    price?: { old: string; new: string };
    cost?: { old: number | null; new: string };
  };
}

// --- FUNZIONI HELPER PER SHOPIFY ---
async function executeShopifyMutation(domain: string, token: string, query: string, variables: object) {
  const url = `https://${domain}/admin/api/2023-10/graphql.json`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const jsonResponse = await response.json() as any;
  if (jsonResponse.errors || jsonResponse.data?.productVariantUpdate?.userErrors?.length > 0 || jsonResponse.data?.inventoryAdjustQuantities?.userErrors?.length > 0) {
    console.error("Shopify API Error:", JSON.stringify(jsonResponse, null, 2));
    throw new Error("Errore durante l'aggiornamento su Shopify.");
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
    const { update_ids } = JSON.parse(event.body || "{}");
    if (!update_ids || !Array.isArray(update_ids) || update_ids.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "Nessun ID di modifica fornito." }) };
    }

    // 1. Recupera le modifiche selezionate
    const { data: updates, error: fetchError } = await supabase
      .from('pending_updates')
      .select('id, product_variant_id, changes')
      .in('id', update_ids)
      .returns<PendingUpdate[]>();
    if (fetchError) throw fetchError;

    let successCount = 0;
    let errorCount = 0;
    const logs = [];

    // 2. Itera su ogni modifica e applicala
    for (const update of updates) {
      const { product_variant_id, changes } = update;
      
      try {
        // A. Aggiorna prezzo e costo
        if (changes.price || changes.cost) {
          const variantInput: any = { id: product_variant_id };
          if (changes.price) variantInput.price = changes.price.new;
          if (changes.cost) variantInput.inventoryItem = { cost: changes.cost.new };
          
          const mutation = `mutation productVariantUpdate($input: ProductVariantInput!) {
            productVariantUpdate(input: $input) {
              productVariant { id }
              userErrors { field message }
            }
          }`;
          await executeShopifyMutation(SHOPIFY_STORE_NAME, SHOPIFY_ADMIN_API_TOKEN, mutation, { input: variantInput });
        }

        // B. Aggiorna la giacenza
        if (changes.quantity) {
          const delta = changes.quantity.new - changes.quantity.old;
          const inventoryItemId = (await (await fetch(`https://${SHOPIFY_STORE_NAME}/admin/api/2023-10/variants/${product_variant_id.split('/').pop()}.json`, { headers: {'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN} })).json()).variant.inventory_item_id;
          
          const mutation = `mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
            inventoryAdjustQuantities(input: $input) {
              userErrors { field message }
            }
          }`;
          const variables = { input: { reason: "correction", name: "Excel Sync", changes: [{ inventoryItemId: `gid://shopify/InventoryItem/${inventoryItemId}`, locationId: `gid://shopify/Location/${SHOPIFY_LOCATION_ID}`, delta: delta }] } };
          await executeShopifyMutation(SHOPIFY_STORE_NAME, SHOPIFY_ADMIN_API_TOKEN, mutation, variables);
        }

        successCount++;
        logs.push({ product_variant_id, status: 'success', action: 'update', details: { message: 'Aggiornato con successo.' } });

      } catch (e: any) {
        errorCount++;
        logs.push({ product_variant_id, status: 'error', action: 'update', details: { error: e.message } });
      }
    }

    // 3. Salva i log su Supabase
    if (logs.length > 0) {
      await supabase.from('sync_logs').insert(logs);
    }

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
