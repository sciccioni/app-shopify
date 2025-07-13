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
      id: string; // <-- ID dell'articolo di magazzino
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
    const { data: localProducts, error: pError } = await supabase.from('products').select('minsan, ditta, iva, giacenza, costo_medio, scadenza').eq('import_id', importId).returns<LocalProduct[]>();
    if (pError) throw pError;
    const { data: markups, error: mError } = await supabase.from('company_markups').select('ditta, markup_percentage');
    if (mError) throw mError;
    if (!localProducts?.length) return { statusCode: 404, body: JSON.stringify({ error: "Nessun prodotto normalizzato trovato." }) };

    const markupsMap = new Map(markups?.map(m => [m.ditta, m.markup_percentage]));

    // 2. Interroga Shopify (con inventoryItem.id e API aggiornata)
    const skusQuery = localProducts.map(p => `sku:'${p.minsan}'`).join(' OR ');
    const graphqlQuery = `query { productVariants(first: 250, query: "${skusQuery}") { edges { node { id sku displayName price inventoryQuantity inventoryItem { id unitCost { amount } } } } } }`;
    const shopifyDomain = SHOPIFY_STORE_NAME;
    const shopifyResponse = await (await fetch(`https://${shopifyDomain}/admin/api/2025-07/graphql.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN }, body: JSON.stringify({ query: graphqlQuery }) })).json() as ShopifyGraphQLResponse;
    if (shopifyResponse.errors) throw new Error(`Errore GraphQL: ${shopifyResponse.errors.map((e) => e.message).join(', ')}`);
    
    const shopifyVariants = shopifyResponse.data?.productVariants?.edges?.map(edge => edge.node) || [];
    const shopifyVariantsMap = new Map<string, ShopifyVariant>(shopifyVariants.map(v => [v.sku, v]));
    
    const pendingUpdates = [];
    const productPriceUpdates = [];

    for (const local of localProducts) {
      const shopify = shopifyVariantsMap.get(local.minsan);
      if (!shopify) continue;

      const changes: any = {};
      const shopifyCost = shopify.inventoryItem?.unitCost ? parseFloat(shopify.inventoryItem.unitCost.amount) : null;
      let newPriceFormatted: string | undefined;

      const markup = markupsMap.get(local.ditta);
      if (markup !== undefined && markup > 0 && local.costo_medio != null) {
        const newPrice = (local.costo_medio * (1 + markup / 100) * (1 + (local.iva || 0) / 100));
        newPriceFormatted = newPrice.toFixed(2);
        productPriceUpdates.push({ minsan: local.minsan, prezzo_calcolato: parseFloat(newPriceFormatted) });
      }

      changes.quantity = { old: shopify.inventoryQuantity, new: local.giacenza };
      changes.cost = { old: shopifyCost, new: local.costo_medio?.toFixed(2) };
      changes.price = { old: shopify.price, new: newPriceFormatted };
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

    await supabase.from('pending_updates').delete().eq('import_id', importId);
    if (pendingUpdates.length > 0) {
      await supabase.from('pending_updates').insert(pendingUpdates);
    }

    if (productPriceUpdates.length > 0) {
        const updatePromises = productPriceUpdates.map(p =>
            supabase.from('products').update({ prezzo_calcolato: p.prezzo_calcolato }).eq('import_id', importId).eq('minsan', p.minsan)
        );
        await Promise.all(updatePromises);
    }

    return { statusCode: 200, body: JSON.stringify({ message: "Calcolo differenze completato.", updatesFound: pendingUpdates.length }) };

  } catch (error: any) {
    console.error("Errore durante il calcolo delle differenze:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || "Errore interno." }) };
  }
};

export { handler };
