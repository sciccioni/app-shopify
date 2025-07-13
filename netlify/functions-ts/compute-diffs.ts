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
  scadenza?: string;
}
interface ShopifyVariant {
  id: string;
  sku: string;
  displayName:string;
  price: string;
  inventoryQuantity: number;
  inventoryItem: { 
      id: string;
      unitCost: { amount: string } | null 
  };
}
interface ShopifyGraphQLResponse {
  data?: { productVariants?: { edges: { node: ShopifyVariant }[] } };
  errors?: { message: string }[];
}

// --- HANDLER PRINCIPALE ---
const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Metodo non consentito." }) };
  }

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
    // 1. Recupera dati da Supabase
    const { data: localProducts, error: pError } = await supabase.from('products').select('minsan, ditta, iva, giacenza, costo_medio, scadenza').eq('import_id', importId).returns<LocalProduct[]>();
    if (pError) throw pError;
    const { data: markups, error: mError } = await supabase.from('company_markups').select('ditta, markup_percentage');
    if (mError) throw mError;

    console.log(`[compute-diffs] Trovati ${localProducts?.length || 0} prodotti normalizzati nel DB.`);
    if (!localProducts?.length) return { statusCode: 200, body: JSON.stringify({ message: "Nessun prodotto da analizzare.", updatesFound: 0 }) };

    const markupsMap = new Map(markups?.map(m => [m.ditta, m.markup_percentage]));

    // 2. Interroga Shopify
    const skusQuery = localProducts.map(p => `sku:'${p.minsan}'`).join(' OR ');
    console.log(`[compute-diffs] Query SKU inviata a Shopify: ${skusQuery}`);
    
    const graphqlQuery = `query { productVariants(first: 250, query: "${skusQuery}") { edges { node { id sku displayName price inventoryQuantity inventoryItem { id unitCost { amount } } } } } }`;
    const shopifyDomain = SHOPIFY_STORE_NAME;
    const shopifyResponse = await (await fetch(`https://${shopifyDomain}/admin/api/2025-07/graphql.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN }, body: JSON.stringify({ query: graphqlQuery }) })).json() as ShopifyGraphQLResponse;
    if (shopifyResponse.errors) throw new Error(`Errore GraphQL: ${shopifyResponse.errors.map((e) => e.message).join(', ')}`);
    
    const shopifyVariants = shopifyResponse.data?.productVariants?.edges?.map(edge => edge.node) || [];
    const shopifyVariantsMap = new Map<string, ShopifyVariant>(shopifyVariants.map(v => [v.sku, v]));

    console.log(`[compute-diffs] Shopify ha restituito ${shopifyVariants.length} prodotti corrispondenti.`);
    
    const pendingUpdates = [];

    for (const local of localProducts) {
      const shopify = shopifyVariantsMap.get(local.minsan);
      if (!shopify) continue;

      const changes: any = {};
      const shopifyCost = shopify.inventoryItem?.unitCost ? parseFloat(shopify.inventoryItem.unitCost.amount) : null;
      
      // --- LOGICA DI COSTRUZIONE 'changes' MIGLIORATA ---
      changes.quantity = { old: shopify.inventoryQuantity, new: local.giacenza };
      
      // Aggiungi il costo solo se esiste
      if (local.costo_medio !== undefined) {
        changes.cost = { old: shopifyCost, new: local.costo_medio?.toFixed(2) };
      } else {
        changes.cost = { old: shopifyCost, new: null };
      }

      // Aggiungi il prezzo solo se è stato calcolato
      const markup = markupsMap.get(local.ditta);
      if (markup !== undefined && markup > 0 && local.costo_medio != null) {
        const newPrice = (local.costo_medio * (1 + markup / 100) * (1 + (local.iva || 0) / 100));
        changes.price = { old: shopify.price, new: newPrice.toFixed(2) };
      } else {
        changes.price = { old: shopify.price, new: shopify.price }; // Nessuna modifica se non c'è markup
      }

      if (local.scadenza) {
        changes.expiry = { new: local.scadenza };
      }
      
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

    console.log(`[compute-diffs] Creati ${pendingUpdates.length} record di aggiornamento.`);

    await supabase.from('pending_updates').delete().eq('import_id', importId);
    if (pendingUpdates.length > 0) {
      const { error: insertError } = await supabase.from('pending_updates').insert(pendingUpdates);
      if (insertError) {
          // Se l'inserimento fallisce, ora vedremo un errore chiaro.
          console.error("[compute-diffs] Errore durante l'inserimento in pending_updates:", insertError);
          throw insertError;
      }
    }

    return { statusCode: 200, body: JSON.stringify({ message: "Calcolo differenze completato.", updatesFound: pendingUpdates.length }) };

  } catch (error: any) {
    console.error("[compute-diffs] Errore:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || "Errore interno." }) };
  }
};

export { handler };
