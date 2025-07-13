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
    const { data: localProducts, error: pError } = await supabase.from('products').select('*').eq('import_id', importId).returns<LocalProduct[]>();
    if (pError) throw pError;
    const { data: markups, error: mError } = await supabase.from('company_markups').select('ditta, markup_percentage');
    if (mError) throw mError;
    if (!localProducts?.length) return { statusCode: 404, body: JSON.stringify({ error: "Nessun prodotto normalizzato trovato." }) };

    const markupsMap = new Map(markups?.map(m => [m.ditta, m.markup_percentage]));

    // 2. Interroga Shopify (con compareAtPrice e metafield)
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
            } 
          } 
        } 
      }`;
    const shopifyDomain = SHOPIFY_STORE_NAME;
    const shopifyResponse = await (await fetch(`https://${shopifyDomain}/admin/api/2025-07/graphql.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN }, body: JSON.stringify({ query: graphqlQuery }) })).json() as any;
    if (shopifyResponse.errors) throw new Error(`Errore GraphQL: ${shopifyResponse.errors.map((e: any) => e.message).join(', ')}`);
    
    const shopifyVariantsMap = new Map(shopifyResponse.data?.productVariants?.edges?.map((edge: any) => [edge.node.sku, edge.node]) || []);
    
    const pendingUpdates = [];

    for (const local of localProducts) {
      const shopify = shopifyVariantsMap.get(local.minsan);
      if (!shopify) continue;

      const changes: any = {};
      
      // Confronta Giacenza
      if (local.giacenza !== shopify.inventoryQuantity) {
        changes.quantity = { old: shopify.inventoryQuantity, new: local.giacenza };
      }

      // Confronta Costo
      const shopifyCost = shopify.inventoryItem?.unitCost ? parseFloat(shopify.inventoryItem.unitCost.amount) : null;
      const localCost = local.costo_medio;
      if (localCost != null && localCost.toFixed(2) !== shopifyCost?.toFixed(2)) {
        changes.cost = { old: shopifyCost, new: localCost.toFixed(2) };
      }

      // Calcola e confronta Prezzo
      const markup = markupsMap.get(local.ditta);
      if (markup !== undefined && markup > 0 && localCost != null) {
        const newPrice = (localCost * (1 + markup / 100) * (1 + (local.iva || 0) / 100)).toFixed(2);
        if (newPrice !== shopify.price) {
          changes.price = { old: shopify.price, new: newPrice };
        }
      }

      // Confronta Prezzo Barrato (Compare At Price)
      const localComparePrice = local.prezzo_bd?.toFixed(2);
      if (localComparePrice != null && localComparePrice !== shopify.compareAtPrice) {
        changes.compare_at_price = { old: shopify.compareAtPrice, new: localComparePrice };
      }

      // Confronta Scadenza (Metafield)
      const localExpiry = local.scadenza;
      if (localExpiry && localExpiry !== shopify.metafield?.value) {
        changes.expiry_date = { old: shopify.metafield?.value, new: localExpiry };
      }
      
      // Aggiungi alla lista SOLO SE ci sono modifiche effettive
      if (Object.keys(changes).length > 0) {
        pendingUpdates.push({
          import_id: importId,
          product_variant_id: shopify.id,
          inventory_item_id: shopify.inventoryItem?.id,
          product_title: shopify.displayName,
          minsan: local.minsan,
          ditta: local.ditta,
          changes: changes
        });
      }
    }

    await supabase.from('pending_updates').delete().eq('import_id', importId);
    if (pendingUpdates.length > 0) {
      await supabase.from('pending_updates').insert(pendingUpdates);
    }

    return { statusCode: 200, body: JSON.stringify({ message: "Calcolo differenze completato.", updatesFound: pendingUpdates.length }) };

  } catch (error: any) {
    console.error("Errore durante il calcolo delle differenze:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || "Errore interno." }) };
  }
};

export { handler };
