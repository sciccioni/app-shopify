import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

// --- INTERFACCE ---
interface LocalProduct {
  minsan: string;
  ditta: string;
  iva: number;
  giacenza: number;
  costo_medio?: number;
  prezzo_bd?: number;
  scadenza?: string;
}
interface ShopifyVariant {
  id: string;
  sku: string;
  displayName:string;
  price: string;
  compareAtPrice: string | null;
  inventoryQuantity: number;
  inventoryItem: { id: string; unitCost: { amount: string } | null };
  metafield: { value: string } | null;
  product: { id: string };
}
interface ShopifyGraphQLResponse {
  data?: { productVariants?: { edges: { node: ShopifyVariant }[] } };
  errors?: { message: string }[];
}

// --- HANDLER PRINCIPALE ---
const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Metodo non consentito." }) };

  let importId: string;
  try {
    const body = JSON.parse(event.body || "{}");
    importId = body.importId;
    if (!importId) throw new Error("importId non fornito.");
  } catch (error) {
    return { statusCode: 400, body: JSON.stringify({ error: "Corpo richiesta non valido." }) };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, SHOPIFY_STORE_NAME, SHOPIFY_ADMIN_API_TOKEN } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SHOPIFY_STORE_NAME || !SHOPIFY_ADMIN_API_TOKEN) {
    return { statusCode: 500, body: JSON.stringify({ error: "Variabili d'ambiente mancanti." }) };
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    console.log(`[compute-diffs] Avviato per importId: ${importId}`);
    const { data: localProducts, error: pError } = await supabase.from('products').select('*').eq('import_id', importId).returns<LocalProduct[]>();
    if (pError) throw pError;
    const { data: markups, error: mError } = await supabase.from('company_markups').select('ditta, markup_percentage');
    if (mError) throw mError;

    console.log(`[compute-diffs] Trovati ${localProducts?.length || 0} prodotti normalizzati.`);
    if (!localProducts?.length) return { statusCode: 200, body: JSON.stringify({ message: "Nessun prodotto da analizzare.", updatesFound: 0 }) };

    const markupsMap = new Map(markups?.map(m => [m.ditta, m.markup_percentage]));

    // 2. Interroga Shopify (con product.id)
    const skusQuery = localProducts.map(p => `sku:'${p.minsan}'`).join(' OR ');
    const graphqlQuery = `
      query { 
        productVariants(first: 250, query: "${skusQuery}") { 
          edges { 
            node { 
              id 
              sku 
              displayName 
              price 
              compareAtPrice
              inventoryQuantity 
              inventoryItem { id unitCost { amount } }
              metafield(namespace: "custom", key: "data_di_scadenza") { value }
              product { id }
            } 
          } 
        } 
      }`;
    const shopifyDomain = SHOPIFY_STORE_NAME;
    let shopifyResponse: ShopifyGraphQLResponse;

    try {
        console.log(`[compute-diffs] Esecuzione chiamata a Shopify per ${localProducts.length} SKU...`);
        const response = await fetch(`https://${shopifyDomain}/admin/api/2024-07/graphql.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN }, body: JSON.stringify({ query: graphqlQuery }) });
        if (!response.ok) {
            throw new Error(`Shopify ha risposto con status ${response.status} ${response.statusText}`);
        }
        shopifyResponse = await response.json() as ShopifyGraphQLResponse;
        console.log("[compute-diffs] Risposta da Shopify ricevuta e parsata.");
    } catch (fetchError: any) {
        console.error("[compute-diffs] Errore critico durante la chiamata a Shopify:", fetchError);
        throw new Error(`Impossibile comunicare con Shopify: ${fetchError.message}`);
    }
    
    if (shopifyResponse.errors) throw new Error(`Errore GraphQL: ${shopifyResponse.errors.map((e) => e.message).join(', ')}`);
    
    const shopifyVariants = shopifyResponse.data?.productVariants?.edges?.map(edge => edge.node) || [];
    const shopifyVariantsMap = new Map<string, ShopifyVariant>(shopifyVariants.map(v => [v.sku, v]));
    console.log(`[compute-diffs] Shopify ha restituito ${shopifyVariants.length} prodotti corrispondenti.`);
    
    const pendingUpdates = [];

    for (const local of localProducts) {
      const shopify = shopifyVariantsMap.get(local.minsan);
      if (!shopify) continue;

      const changes: any = {};
      
      if (local.giacenza !== shopify.inventoryQuantity) {
        changes.quantity = { old: shopify.inventoryQuantity, new: local.giacenza };
      }

      const shopifyCost = shopify.inventoryItem?.unitCost ? parseFloat(shopify.inventoryItem.unitCost.amount) : null;
      const localCost = local.costo_medio;
      if (localCost != null && localCost.toFixed(2) !== shopifyCost?.toFixed(2)) {
        changes.cost = { old: shopifyCost, new: localCost.toFixed(2) };
      }

      const markup = markupsMap.get(local.ditta);
      if (markup !== undefined && markup > 0 && localCost != null) {
        const newPrice = (localCost * (1 + markup / 100) * (1 + (local.iva || 0) / 100)).toFixed(2);
        if (newPrice !== shopify.price) {
          changes.price = { old: shopify.price, new: newPrice };
        }
      }

      const localComparePrice = local.prezzo_bd?.toFixed(2);
      if (localComparePrice != null && localComparePrice !== shopify.compareAtPrice) {
        changes.compare_at_price = { old: shopify.compareAtPrice, new: localComparePrice };
      }

      const localExpiry = local.scadenza;
      if (localExpiry && localExpiry !== shopify.metafield?.value) {
        changes.expiry_date = { old: shopify.metafield?.value, new: localExpiry };
      }
      
      if (Object.keys(changes).length > 0) {
        pendingUpdates.push({
          import_id: importId,
          product_id: shopify.product.id,
          product_variant_id: shopify.id,
          inventory_item_id: shopify.inventoryItem?.id,
          product_title: shopify.displayName,
          minsan: local.minsan,
          ditta: local.ditta,
          changes: changes
        });
      }
    }

    console.log(`[compute-diffs] Creati ${pendingUpdates.length} record di aggiornamento da salvare.`);
    await supabase.from('pending_updates').delete().eq('import_id', importId);
    if (pendingUpdates.length > 0) {
      const { error: insertError } = await supabase.from('pending_updates').insert(pendingUpdates);
      if (insertError) {
          console.error("[compute-diffs] Errore durante l'inserimento in pending_updates:", insertError);
          throw insertError;
      }
    }
    console.log("[compute-diffs] Operazioni su DB completate.");

    return { statusCode: 200, body: JSON.stringify({ message: "Calcolo differenze completato.", updatesFound: pendingUpdates.length }) };

  } catch (error: any) {
    console.error("ERRORE COMPLETO durante il calcolo delle differenze:", error);
    const errorMessage = error.message || "Errore sconosciuto. Controllare i log della funzione Netlify per i dettagli.";
    return { statusCode: 500, body: JSON.stringify({ error: errorMessage }) };
  }
};

export { handler };
