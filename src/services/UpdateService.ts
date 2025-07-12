// src/services/UpdateService.ts
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
import { PriceService } from './PriceService';

export class UpdateService {
  static async run(importId: number, updates: any[]) {
    for (const u of updates) {
      try {
        // chiama Shopify
        const res = await PriceService.updateVariant(u);
        await sb.from('sync_logs').insert({ product_id: u.productId, import_id: importId, action: u.field, status: 'success', message: '' });
      } catch(e:any){
        await sb.from('sync_logs').insert({ product_id: u.productId, import_id: importId, action: u.field, status: 'error', message: e.message });
        throw e; // rollback globale se serve
      }
    }
  }
}

// netlify/functions/apply-updates.ts
import { Handler } from '@netlify/functions';
import { UpdateService } from '../../src/services/UpdateService';
export const handler: Handler = async (evt) => {
  const { import_id, updates } = JSON.parse(evt.body!);
  await UpdateService.run(import_id, updates);
  return { statusCode: 200, body: 'OK' };
};
