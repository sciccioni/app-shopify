// src/services/PriceService.ts
import fetch from 'node-fetch';
import { RateLimiter } from './RateLimiter';
export class PriceService {
  static async updateVariant({ productId, field, newValue, /*...*/ }) {
    // usa RateLimiter.schedule per batching/backoff
    await RateLimiter.schedule(() => fetch(
      `https://${process.env.SHOPIFY_STORE}/admin/api/2025-01/variants/${productId}.json`,
      { method:'PUT', headers:{'X-Shopify-Access-Token':process.env.SHOPIFY_API_PASSWORD,'Content-Type':'application/json'},
        body: JSON.stringify({ variant: { id: productId, [field]: newValue } })
      }
    ));
  }
}

// src/services/RateLimiter.ts
export class RateLimiter {
  private static queue: (()=>Promise<any>)[] = [];
  private static running = 0;
  static async schedule(fn: ()=>Promise<any>) {
    if (this.running >= 2) { // Shopify limit ~2 req/sec
      await new Promise(r => setTimeout(r, 500));
      return this.schedule(fn);
    }
    this.running++;
    try { return await fn(); }
    finally { this.running--; }
  }
}
