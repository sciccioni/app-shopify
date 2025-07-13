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
    cost?: { old: number | null; new: string | null };
  };
}

// --- FUNZIONI HELPER PER SHOPIFY ---
async function executeShopifyMutation(
  domain: string,
  token: string,
  query: string,
  variables: object
) {
  const url = `https://${domain}/admin/api/2024-07/graphql.json`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await response.json()) as any;

  const userErrors =
    json.data?.productVariantUpdate?.userErrors ||
    json.data?.inventoryItemUpdate?.userErrors ||
    json.data?.inventoryAdjustQuantities?.userErrors ||
    [];

  if (json.errors || userErrors.length > 0) {
    console.error("Shopify API Error:", JSON.stringify(json, null, 2));
    const msg =
      userErrors.map((e: any) => e.message).join(", ") ||
      json.errors.map((e: any) => e.message).join(", ") ||
      "Errore sconosciuto da Shopify.";
    throw new Error(msg);
  }
  return json;
}

// --- HANDLER PRINCIPALE ---
const handler: Handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Metodo non consentito." }) };
  }

  const {
    SUPABASE_URL,
    SUPABASE_SERVICE_KEY,
    SHOPIFY_STORE_NAME,
    SHOPIFY_ADMIN_API_TOKEN,
    SHOPIFY_LOCATION_ID,
  } = process.env;
  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_KEY ||
    !SHOPIFY_STORE_NAME ||
    !SHOPIFY_ADMIN_API_TOKEN ||
    !SHOPIFY_LOCATION_ID
  ) {
    return { statusCode: 500, body: JSON.stringify({ error: "Variabili d'ambiente mancanti." }) };
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const { update_ids, import_id } = JSON.parse(event.body || "{}");
    if (!Array.isArray(update_ids) || update_ids.length === 0 || !import_id) {
      return { statusCode: 400, body: JSON.stringify({ error: "Dati mancanti." }) };
    }

    const { data: updates, error: fetchError } = await supabase
      .from("pending_updates")
      .select("id, product_variant_id, inventory_item_id, changes")
      .in("id", update_ids)
      .returns<PendingUpdate[]>();
    if (fetchError) throw fetchError;

    let successCount = 0;
    let errorCount = 0;
    const logs: any[] = [];

    for (const upd of updates) {
      const { product_variant_id, inventory_item_id, changes } = upd;
      try {
        // A. Aggiorna prezzo variante
        if (changes.price && changes.price.old !== changes.price.new) {
          const m = `
            mutation productVariantUpdate($input: ProductVariantInput!) {
              productVariantUpdate(input: $input) {
                userErrors { field message }
              }
            }
          `;
          await executeShopifyMutation(
            SHOPIFY_STORE_NAME,
            SHOPIFY_ADMIN_API_TOKEN,
            m,
            { input: { id: product_variant_id, price: changes.price.new } }
          );
        }

        // B. Aggiorna costo inventory item
        if (
          changes.cost &&
          changes.cost.new !== null &&
          inventory_item_id &&
          changes.cost.old !== null &&
          changes.cost.old.toFixed(2) !== changes.cost.new
        ) {
          const m = `
            mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
              inventoryItemUpdate(id: $id, input: $input) {
                inventoryItem { id }
                userErrors { field message }
              }
            }
          `;
          const vars = {
            id: inventory_item_id,
            input: { cost: parseFloat(changes.cost.new) },
          };
          await executeShopifyMutation(
            SHOPIFY_STORE_NAME,
            SHOPIFY_ADMIN_API_TOKEN,
            m,
            vars
          );
        }

        // C. Aggiusta quantità disponibile
        if (changes.quantity && inventory_item_id && changes.quantity.old !== changes.quantity.new) {
          const delta = changes.quantity.new - changes.quantity.old;
          const m = `
            mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
              inventoryAdjustQuantities(input: $input) {
                userErrors { field message }
              }
            }
          `;
          const vars = {
            input: {
              reason: "correction",
              name: "available",                          // valore valido per disponibilità :contentReference[oaicite:2]{index=2}
              referenceDocumentUri: "excel://sync",        // URI libero per tracciare la sorgente :contentReference[oaicite:3]{index=3}
              changes: [
                {
                  inventoryItemId: inventory_item_id,
                  locationId: `gid://shopify/Location/${SHOPIFY_LOCATION_ID}`,
                  delta: delta
                }
              ]
            }
          };
          await executeShopifyMutation(
            SHOPIFY_STORE_NAME,
            SHOPIFY_ADMIN_API_TOKEN,
            m,
            vars
          );
        }

        successCount++;
        logs.push({
          import_id,
          product_variant_id,
          status: "success",
          action: "update",
          details: { message: "Aggiornato con successo." },
        });
      } catch (e: any) {
        errorCount++;
        logs.push({
          import_id,
          product_variant_id,
          status: "error",
          action: "update",
          details: { error: e.message },
        });
      }
    }

    if (logs.length) {
      await supabase.from("sync_logs").insert(logs);
      await supabase.from("pending_updates").delete().in("id", update_ids);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Processo di aggiornamento completato.",
        success: successCount,
        errors: errorCount,
      }),
    };
  } catch (error: any) {
    console.error("Errore durante l'applicazione delle modifiche:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || "Errore interno." }),
    };
  }
};

export { handler };
