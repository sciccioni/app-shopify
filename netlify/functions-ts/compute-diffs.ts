import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

// Interfacce
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
  displayName: string;
  price: string;
  inventoryQuantity: number;
  inventoryItem: { unitCost: { amount: string } | null };
}

// Handler principale
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

    if (!localProducts?.length) return { statusCode: 404, body: JSON.stringify({ error: "Nessun prodotto normalizzato trovato." }) };

    const markupsMap = new Map(markups?.map(m => [m.ditta, m.markup_percentage]));

    // 2. Interroga Shopify
    const skusQuery = localProducts.map(p => `sku:'${p.minsan}'`).join(' OR ');
    const graphqlQuery = `query { productVariants(first: 250, query: "${skusQuery}") { edges { node { id sku displayName price inventoryQuantity inventoryItem { unitCost { amount } } } } } }`;
    const shopifyDomain = SHOPIFY_STORE_NAME;
    const shopifyResponse = await (await fetch(`https://${shopifyDomain}/admin/api/2023-10/graphql.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN }, body: JSON.stringify({ query: graphqlQuery }) })).json() as any;
    if (shopifyResponse.errors) throw new Error(`Errore GraphQL: ${shopifyResponse.errors.map((e: any) => e.message).join(', ')}`);

    const shopifyVariantsMap = new Map(shopifyResponse.data?.productVariants?.edges?.map((edge: any) => [edge.node.sku, edge.node]) || []);
    
    // 3. Consolida le differenze
    const pendingUpdates = [];
    for (const local of localProducts) {
      const shopify = shopifyVariantsMap.get(local.minsan);
      if (!shopify) continue;

      const changes: any = {};

      // Giacenza
      if (local.giacenza !== shopify.inventoryQuantity) {
        changes.quantity = { old: shopify.inventoryQuantity, new: local.giacenza };
      }

      // Costo
      const shopifyCost = shopify.inventoryItem?.unitCost ? parseFloat(shopify.inventoryItem.unitCost.amount) : null;
      if (local.costo_medio != null && local.costo_medio.toFixed(2) !== shopifyCost?.toFixed(2)) {
        changes.cost = { old: shopifyCost, new: local.costo_medio.toFixed(2) };
      }

      // Prezzo
      const markup = markupsMap.get(local.ditta);
      if (markup !== undefined && local.costo_medio != null) {
        const newPrice = (local.costo_medio * (1 + markup / 100) * (1 + (local.iva || 0) / 100)).toFixed(2);
        if (newPrice !== shopify.price) {
          changes.price = { old: shopify.price, new: newPrice };
        }
      }
      
      // Scadenza
      if (local.scadenza) {
        changes.expiry = { new: local.scadenza };
      }

      // Se ci sono modifiche, crea un singolo record
      if (Object.keys(changes).length > 0) {
        pendingUpdates.push({
          import_id: importId,
          product_variant_id: shopify.id,
          product_title: shopify.displayName,
          changes: changes
        });
      }
    }

    // 4. Salva le differenze consolidate
    if (pendingUpdates.length > 0) {
      await supabase.from('pending_updates').delete().eq('import_id', importId);
      const { error: insertError } = await supabase.from('pending_updates').insert(pendingUpdates);
      if (insertError) throw insertError;
    }

    return { statusCode: 200, body: JSON.stringify({ message: "Calcolo differenze completato.", updatesFound: pendingUpdates.length }) };

  } catch (error: any) {
    console.error("Errore durante il calcolo delle differenze:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || "Errore interno." }) };
  }
};

export { handler };
