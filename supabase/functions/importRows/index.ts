import { serve } from 'https://deno.land/std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'https://esm.sh/xlsx';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);
serve(async req => {
  const form = await req.formData();
  const file = form.get('file') as File;
  const { data: imp } = await supabase
    .from('imports').insert({ filename: file.name }).select('id').single();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }) as any[];
  for (const r of rows) {
    await supabase.from('raw_rows').insert({
      import_id: imp.id,
      ditta: r.Ditta,
      minsan: r.Minsan,
      ean: r.EAN,
      descrizione: r.Descrizione,
      scadenza_txt: r.Scadenza,
      lotto: r.lotto,
      giacenza: parseInt(r.Giacenza) || 0,
      costobase: parseFloat(r.CostoBase) || 0,
      costomedio: parseFloat(r.CostoMedio) || 0,
      ultimo_costo: parseFloat(r.UltimoCostoDitta) || 0,
      data_ultimo_costo: r.DataUltimoCostoDitta ? new Date(r.DataUltimoCostoDitta) : null,
      prezzo_bd: parseFloat(r.PrezzoBD) || 0,
      iva: parseFloat(r.IVA) || 0
    });
  }
  return new Response(JSON.stringify({ status:'imported', import_id: imp.id }));
});
