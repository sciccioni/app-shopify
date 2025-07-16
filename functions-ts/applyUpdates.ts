import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { chunk } from 'lodash';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } }
);

const STORE   = process.env.SHOPIFY_STORE_NAME!;
const TOKEN   = process.env.SHOPIFY_ADMIN_API_TOKEN!;
const API_VER = process.env.SHOPIFY_API_VERSION || '2024-07';
const LOC_ID  = process.env.SHOPIFY_LOCATION_ID!;

/* ---------- Rate Limiter -------------------------------------------- */
class RateLimiter {
  private queue: Array<() => Promise<any>> = [];
  private processing = false;
  private readonly delayMs: number;

  constructor(requestsPerSecond: number = 2) {
    this.delayMs = 1000 / requestsPerSecond;
  }

  async add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      this.process();
    });
  }

  private async process() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    while (this.queue.length > 0) {
      const fn = this.queue.shift()!;
      await fn();
      if (this.queue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, this.delayMs));
      }
    }
    this.processing = false;
  }
}

const rateLimiter = new RateLimiter(2); // 2 requests/sec

/* ---------- GraphQL utilities ----------------------------------------- */
async function shopifyFetch(query: string, variables: any = {}) {
  return rateLimiter.add(async () => {
    const res = await fetch(`https://${STORE}.myshopify.com/admin/api/${API_VER}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
      body: JSON.stringify({ query, variables })
    });
    
    const json = await res.json();
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
    }
    
    if (json.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
    }
    
    // Check for userErrors in mutations
    const data = json.data;
    const mutation = Object.values(data)[0] as any;
    if (mutation?.userErrors?.length > 0) {
      throw new Error(`User errors: ${JSON.stringify(mutation.userErrors)}`);
    }
    
    return data;
  });
}

/* ---------- REST API utilities ---------------------------------------- */
async function shopifyRestFetch(endpoint: string, method: string = 'GET', body?: any) {
  return rateLimiter.add(async () => {
    const res = await fetch(`https://${STORE}.myshopify.com/admin/api/${API_VER}/${endpoint}`, {
      method,
      headers: { 
        'Content-Type': 'application/json', 
        'X-Shopify-Access-Token': TOKEN 
      },
      body: body ? JSON.stringify(body) : undefined
    });
    
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`REST API ${res.status}: ${errorText}`);
    }
    
    return res.json();
  });
}

/* ---------- Single mutations for debugging --------------------------- */
async function updateSingleVariant(variantId: string, input: any) {
  // Extract the numeric ID from the GraphQL ID
  const numericId = variantId.replace('gid://shopify/ProductVariant/', '');
  
  const updateData: any = { variant: {} };
  
  if (input.price !== undefined) {
    updateData.variant.price = input.price;
  }
  
  if (input.compareAtPrice !== undefined) {
    updateData.variant.compare_at_price = input.compareAtPrice;
  }
  
  return await shopifyRestFetch(`variants/${numericId}.json`, 'PUT', updateData);
}

async function updateSingleInventory(inventoryItemId: string, delta: number) {
  // Use GraphQL for inventory as it's the recommended way
  return await shopifyFetch(`
    mutation($inventoryItemId: ID!, $locationId: ID!, $availableDelta: Int!) {
      inventoryAdjustQuantity(input: {
        inventoryItemId: $inventoryItemId,
        locationId: $locationId,
        availableDelta: $availableDelta
      }) {
        userErrors { field message }
      }
    }
  `, {
    inventoryItemId,
    locationId: LOC_ID,
    availableDelta: delta
  });
}

async function updateSingleCost(inventoryItemId: string, cost: number) {
  // Extract numeric ID and use REST API
  const numericId = inventoryItemId.replace('gid://shopify/InventoryItem/', '');
  
  return await shopifyRestFetch(`inventory_items/${numericId}.json`, 'PUT', {
    inventory_item: {
      cost: cost.toString()
    }
  });
}

/* ---------- Batch mutations ------------------------------------------- */
async function batchUpdateVariants(updates: Array<{id: string, input: any}>) {
  if (updates.length === 0) return;
  
  // Use REST API one by one
  for (const update of updates) {
    await updateSingleVariant(update.id, update.input);
  }
}

async function batchUpdateInventory(updates: Array<{inventoryItemId: string, delta: number}>) {
  if (updates.length === 0) return;
  
  // Use GraphQL one by one for inventory
  for (const update of updates) {
    if (update.delta !== 0) {
      await updateSingleInventory(update.inventoryItemId, update.delta);
    }
  }
}

async function batchUpdateCosts(updates: Array<{id: string, amount: number}>) {
  if (updates.length === 0) return;
  
  // Use REST API one by one
  for (const update of updates) {
    await updateSingleCost(update.id, update.amount);
  }
}

async function batchUpdateMetafields(updates: Array<{productId: string, value: string}>) {
  if (updates.length === 0) return;
  
  const metafields = updates.map(update => ({
    ownerId: update.productId,
    namespace: "custom",
    key: "data_di_scadenza",
    type: "date",
    value: update.value
  }));

  await shopifyFetch(`
    mutation($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
        metafields { id }
      }
    }
  `, { metafields });
}

/* ---------- Main handler ----------------------------------------------- */
export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'POST only' };
  }

  const start = Date.now();

  try {
    const { import_id, minsans } = JSON.parse(event.body || '{}');
    if (!import_id || !Array.isArray(minsans) || !minsans.length) {
      return { statusCode: 400, body: 'import_id o minsans mancante' };
    }

    console.log(`Starting batch update for ${minsans.length} items`);

    // Recupera tutte le righe in una volta
    const { data: rows, error } = await sb
      .from('pending_updates')
      .select('*')
      .eq('import_id', import_id)
      .in('minsan', minsans);

    if (error) throw error;
    if (!rows || rows.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ success: true, updated: 0, errors: 0 }) };
    }

    // Separa i tipi di aggiornamenti per batch processing
    const variantUpdates: Array<{id: string, input: any}> = [];
    const inventoryUpdates: Array<{inventoryItemId: string, delta: number}> = [];
    const costUpdates: Array<{id: string, amount: number}> = [];
    const metafieldUpdates: Array<{productId: string, value: string}> = [];
    
    const logEntries: Array<{minsan: string, status: string, details: string, action: string}> = [];
    let skipped = 0;

    // Prepara i batch
    for (const r of rows) {
      try {
        if (r.changes?.missing) {
          logEntries.push({ minsan: r.minsan, status: 'skipped', details: 'missing in Shopify', action: 'skip' });
          skipped++;
          continue;
        }

        // Variant updates (price + compareAtPrice)
        if (r.changes.price || r.changes.compare_price) {
          const input: any = {};
          
          if (r.changes.price?.new !== undefined) {
            input.price = r.changes.price.new.toString();
          }
          
          if (r.changes.compare_price?.new !== undefined) {
            input.compareAtPrice = r.changes.compare_price.new.toString();
          }
          
          variantUpdates.push({ id: r.product_variant_id, input });
        }

        // Inventory updates
        if (r.changes.inventory) {
          const delta = r.changes.inventory.new - r.changes.inventory.old;
          if (delta !== 0) {
            inventoryUpdates.push({ 
              inventoryItemId: r.inventory_item_id, 
              delta 
            });
          }
        }

        // Cost updates
        if (r.changes.cost?.new !== undefined) {
          costUpdates.push({ 
            id: r.inventory_item_id, 
            amount: r.changes.cost.new 
          });
        }

        // Metafield updates
        if (r.changes.expiry?.new) {
          metafieldUpdates.push({ 
            productId: r.product_id, 
            value: r.changes.expiry.new 
          });
        }

        logEntries.push({ minsan: r.minsan, status: 'success', details: '', action: 'update' });
      } catch (e: any) {
        console.error(`Error preparing update for ${r.minsan}:`, e.message);
        logEntries.push({ minsan: r.minsan, status: 'error', details: e.message, action: 'update' });
      }
    }

    // Esegui batch updates in parallelo con chunking
    const batchSize = 10; // GraphQL alias limit
    const promises: Promise<void>[] = [];

    if (variantUpdates.length > 0) {
      promises.push(...chunk(variantUpdates, batchSize).map(batchUpdateVariants));
    }
    
    if (inventoryUpdates.length > 0) {
      promises.push(...chunk(inventoryUpdates, batchSize).map(batchUpdateInventory));
    }
    
    if (costUpdates.length > 0) {
      promises.push(...chunk(costUpdates, batchSize).map(batchUpdateCosts));
    }
    
    if (metafieldUpdates.length > 0) {
      promises.push(...chunk(metafieldUpdates, batchSize).map(batchUpdateMetafields));
    }

    // Attendi tutti i batch
    await Promise.all(promises);

    // Salva tutti i log in batch
    if (logEntries.length > 0) {
      const { error: logError } = await sb.from('sync_logs').insert(logEntries);
      if (logError) {
        console.error('Error saving logs:', logError);
      }
    }

    // Aggiorna lo status dell'import
    await sb.from('imports').update({ status: 'applied' }).eq('id', import_id);

    const successful = logEntries.filter(l => l.status === 'success').length;
    const errors = logEntries.filter(l => l.status === 'error').length;

    console.log(`Batch update completed: ${successful} success, ${errors} errors, ${skipped} skipped in ${Date.now() - start}ms`);

    return { 
      statusCode: 200, 
      body: JSON.stringify({ 
        success: true, 
        updated: successful, 
        errors: errors,
        skipped: skipped,
        duration_ms: Date.now() - start
      }) 
    };

  } catch (e: any) {
    console.error('Batch update fatal error:', e);
    return { statusCode: 500, body: e.message || 'Errore batch update' };
  }
};
