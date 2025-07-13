import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

// --- INTERFACCE ---
interface PendingUpdate {
  id: number;
  product_id: string;        // GID del prodotto, es. "gid://shopify/Product/1234567890"
  product_variant_id: string;   // GID della variante, es. "gid://shopify/ProductVariant/0987654321"
  inventory_item_id: string;    // GID dell’inventory item
  minsan: string;
  changes: {
    quantity?: { old: number; new: number };
    price?: { old: string; new: string };
    compare_at_price?: { old: string | null; new: string | null };
    cost?: { old: number | null; new: string | null };
    expiry_date?: { old: string | null; new: string | null };
  };
}

// --- HELPER PER SHOPIFY ---
async function executeShopifyMutation(
  domain: string,
  token: string,
  query: string,
  variables: object
) {
  const url = `https://${domain}/admin/api/2025-07/graphql.json`; // API AGGIORNATA
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as any;
  
  const errs =
    json.data?.productVariantsBulkUpdate?.userErrors ||
    json.data?.inventoryItemUpdate?.userErrors ||
    json.data?.inventoryAdjustQuantities?.userErrors ||
    json.data?.metafieldsSet?.userErrors ||
    json.errors ||
    [];
  if (errs.length > 0) {
    const msg = errs.map((e: any) => e.message).join("; ");
    throw new Error(msg);
  }
  return json.data;
}

// --- HANDLER PRINCIPALE ---
const handler: Handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Metodo non consentito" }) };
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
    return { statusCode: 500, body: JSON.stringify({ error: "Env vars mancanti" }) };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const { update_ids, import_id } = JSON.parse(event.body || "{}");
    if (!Array.isArray(update_ids) || update_ids.length === 0 || !import_id) {
      return { statusCode: 400, body: JSON.stringify({ error: "Dati mancanti" }) };
    }

    // 1. Fetch degli aggiornamenti pendenti
    const { data: updates, error } = await supabase
      .from("pending_updates")
      .select("id, product_id, product_variant_id, inventory_item_id, changes, minsan")
      .in("id", update_ids) as { data: PendingUpdate[]; error: any };
    if (error) throw error;

    // 2. Raggruppa per product_id per bulk update
    const grouped = updates.reduce((acc, upd) => {
      (acc[upd.product_id] = acc[upd.product_id] || []).push(upd);
      return acc;
    }, {} as Record<string, PendingUpdate[]>);

    let successCount = 0;
    let errorCount = 0;
    const logs: any[] = [];

    // 3. Per ogni gruppo di varianti, esegui bulkUpdate
    for (const [productId, group] of Object.entries(grouped)) {
      try {
        // 3.1 Costruisci l’array variants per bulk (prezzo e prezzo barrato)
        const variantsBulk = group.map((u) => {
          const v: any = { id: u.product_variant_id };
          if (u.changes.price && u.changes.price.old !== u.changes.price.new) {
            v.price = u.changes.price.new;
          }
          if (u.changes.compare_at_price && u.changes.compare_at_price.old !== u.changes.compare_at_price.new) {
            v.compareAtPrice = u.changes.compare_at_price.new;
          }
          return v;
        }).filter(v => Object.keys(v).length > 1);

        if (variantsBulk.length > 0) {
          const bulkMutation = `
            mutation bulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
              productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                userErrors { field message }
              }
            }
          `;
          await executeShopifyMutation(
            SHOPIFY_STORE_NAME,
            SHOPIFY_ADMIN_API_TOKEN,
            bulkMutation,
            { productId, variants: variantsBulk }
          );
        }

        // 3.2 Per ogni variante del gruppo: cost, expiry_date e quantity
        for (const u of group) {
          // 3.2.a Aggiornamento costo
          if (u.changes.cost && u.changes.cost.new !== null && String(u.changes.cost.old?.toFixed(2)) !== u.changes.cost.new) {
            const costMutation = `
              mutation updateInventoryItem($id: ID!, $input: InventoryItemInput!) {
                inventoryItemUpdate(id: $id, input: $input) {
                  userErrors { field message }
                }
              }
            `;
            await executeShopifyMutation(
              SHOPIFY_STORE_NAME,
              SHOPIFY_ADMIN_API_TOKEN,
              costMutation,
              { id: u.inventory_item_id, input: { cost: parseFloat(u.changes.cost.new) } }
            );
          }

          // 3.2.b Metafield expiry_date
          if (u.changes.expiry_date && u.changes.expiry_date.old !== u.changes.expiry_date.new) {
            const mfMutation = `
              mutation setExpiry($metafields: [MetafieldsSetInput!]!) {
                metafieldsSet(metafields: $metafields) {
                  userErrors { field message }
                }
              }
            `;
            await executeShopifyMutation(
              SHOPIFY_STORE_NAME,
              SHOPIFY_ADMIN_API_TOKEN,
              mfMutation,
              {
                metafields: [{
                  key: "data_di_scadenza",
                  namespace: "custom",
                  ownerId: u.product_variant_id,
                  type: "date",
                  value: u.changes.expiry_date.new!
                }]
              }
            );
          }

          // 3.2.c InventoryAdjustQuantities
          if (u.changes.quantity && u.changes.quantity.old !== u.changes.quantity.new) {
            const delta = u.changes.quantity.new - u.changes.quantity.old;
            const qtyMutation = `
              mutation adjustQty($input: InventoryAdjustQuantitiesInput!) {
                inventoryAdjustQuantities(input: $input) {
                  userErrors { field message }
                }
              }
            `;
            await executeShopifyMutation(
              SHOPIFY_STORE_NAME,
              SHOPIFY_ADMIN_API_TOKEN,
              qtyMutation,
              {
                input: {
                  reason: "correction",
                  name: "available",
                  changes: [
                    {
                      inventoryItemId: u.inventory_item_id,
                      locationId: `gid://shopify/Location/${SHOPIFY_LOCATION_ID}`,
                      delta,
                    }
                  ]
                }
              }
            );
          }

          successCount++;
          logs.push({
            import_id,
            product_variant_id: u.product_variant_id,
            minsan: u.minsan,
            status: "success",
            action: "update",
            details: { changes: u.changes },
          });
        }

      } catch (e: any) {
        errorCount += group.length;
        for (const u of group) {
          logs.push({
            import_id,
            product_variant_id: u.product_variant_id,
            minsan: u.minsan,
            status: "error",
            action: "update",
            details: { error: e.message, attemptedChanges: u.changes },
          });
        }
      }
    }

    if (logs.length) {
      await supabase.from("sync_logs").insert(logs);
    }
    await supabase.from("pending_updates").delete().in("id", update_ids);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Aggiornamento batch completato.",
        success: successCount,
        errors: errorCount,
      }),
    };
  } catch (err: any) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || "Errore interno" }),
    };
  }
};

export { handler };
