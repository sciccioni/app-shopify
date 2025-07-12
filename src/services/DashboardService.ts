import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface DashboardStats {
  stats: {
    totalRows: number;
    uniqueCount: number;
    duplicateCount: number;
    missingCount: number;
  };
  chart: {
    labels: string[];
    values: number[];
  };
}

export class DashboardService {
  private sb: SupabaseClient;

  constructor() {
    this.sb = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );
  }

  async getStats(importId: number): Promise<DashboardStats> {
    // 1. Totale righe importate
    const { data: rawRow, error: rawErr } = await this.sb
      .from('imports_raw')
      .select('import_data')
      .eq('id', importId)
      .single();
    if (rawErr) throw new Error(rawErr.message);
    const totalRows = Array.isArray(rawRow.import_data)
      ? rawRow.import_data.length
      : 0;

    // 2. Prodotti unici (distinct Minsan)
    const { count: uniqueCount, error: prodErr } = await this.sb
      .from('products')
      .select('minsan', { count: 'exact', head: true })
      .eq('import_id', importId);
    if (prodErr) throw new Error(prodErr.message);

    // 3. Duplicati
    const duplicateCount = totalRows - (uniqueCount || 0);

    // 4. Elementi non trovati su Shopify
    const { data: pending, error: pendErr } = await this.sb
      .from('pending_updates')
      .select('updates')
      .eq('import_id', importId)
      .single();
    if (pendErr) throw new Error(pendErr.message);
    const missingCount = Array.isArray(pending.updates)
      ? pending.updates.filter((u: any) => !u.productId).length
      : 0;

    return {
      stats: {
        totalRows,
        uniqueCount: uniqueCount || 0,
        duplicateCount,
        missingCount
      },
      chart: {
        labels: [
          'Righe importate',
          'Prodotti unici',
          'Duplicati',
          'Non trovati'
        ],
        values: [
          totalRows,
          uniqueCount || 0,
          duplicateCount,
          missingCount
        ]
      }
    };
  }
}
