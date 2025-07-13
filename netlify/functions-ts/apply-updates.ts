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
    compare_at_price?: { old: string | null; new: string };
    expiry_date?: { old: string | null; new: string };
  };
}

// ... (executeShopifyMutation rimane invariata)

// --- HANDLER PRINCIPALE ---
const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // ... (codice di inizializzazione invariato)

  try {
    // ... (codice di recupero updates invariato)

    for (const update of updates) {
      const { product_variant_id, inventory_item_id, changes } = update;
      
      try {
        // --- LOGICA DI AGGIORNAMENTO CORRETTA E SEPARATA ---

        // A. Aggiorna prezzo, costo e compareAtPrice
        const priceChanged = changes.price && changes.price.old !== changes.price.new;
        const costChanged = changes.cost && (changes.cost.old?.toFixed(2) !== changes.cost.new);
        const comparePriceChanged = changes.compare_at_price && changes.compare_at_price.old !== changes.compare_at_price.new;

        if (priceChanged || costChanged || comparePriceChanged) {
          const variantInput: any = { id: product_variant_id };
          if (priceChanged) variantInput.price = changes.price!.new;
          if (comparePriceChanged) variantInput.compareAtPrice = changes.compare_at_price!.new;
          if (costChanged) variantInput.inventoryItem = { cost: changes.cost!.new };
          
          const mutation = `mutation productVariantUpdate($input: ProductVariantInput!) {
            productVariantUpdate(input: $input) { userErrors { field message } }
          }`;
          await executeShopifyMutation(SHOPIFY_STORE_NAME, SHOPIFY_ADMIN_API_TOKEN, mutation, { input: variantInput });
        }

        // B. Aggiorna il metafield della scadenza
        if (changes.expiry_date) {
            const mutation = `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
                metafieldsSet(metafields: $metafields) { userErrors { field message } }
            }`;
            const variables = {
                metafields: [{
                    key: "data_di_scadenza",
                    namespace: "custom",
                    ownerId: product_variant_id,
                    type: "date",
                    value: changes.expiry_date.new
                }]
            };
            await executeShopifyMutation(SHOPIFY_STORE_NAME, SHOPIFY_ADMIN_API_TOKEN, mutation, variables);
        }

        // C. Aggiorna la giacenza
        if (changes.quantity && inventory_item_id && changes.quantity.old !== changes.quantity.new) {
          // ... (logica giacenza invariata)
        }

        successCount++;
        logs.push({ import_id, product_variant_id, status: 'success', action: 'update', details: { message: 'Aggiornato con successo.' } });

      } catch (e: any) {
        errorCount++;
        logs.push({ import_id, product_variant_id, status: 'error', action: 'update', details: { error: e.message } });
      }
    }

    // ... (salvataggio log e pulizia pending_updates invariato)

  } catch (error: any) {
    // ... (gestione errore generale invariata)
  }
};

export { handler };
