import { serve } from 'https://deno.land/std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);
serve(async req => {
  const { import_id } = await req.json();
  const { data: rows } = await supabase.from('raw_rows').select('*').eq('import_id', import_id);
  const groups = rows.reduce((map, r) => {
    map[r.minsan] = map[r.minsan] || [];
    map[r.minsan].push(r);
    return map;
  }, {} as Record<string, any[]>);
  for (const m in groups) {
    const recs = groups[m];
    const dates = recs.map(r=>new Date(r.scadenza_txt)).filter(d=>!isNaN(d.valueOf()));
    const nearest = dates.length ? new Date(Math.min(...dates.map(d=>d.valueOf()))) : null;
    const sumQty = recs.map(r=>Math.max(0,r.giacenza)).reduce((a,b)=>a+b,0);
    const onlyNeg = recs.every(r=>r.giacenza<0);
    await supabase.from('consolidated_products').upsert({
      import_id,
      minsan: m,
      descrizione: recs[0].descrizione,
      giacenza_finale: onlyNeg?0:sumQty,
      scadenza_finale: nearest?.toISOString().split('T')[0] || null,
      is_negative_only: onlyNeg,
      to_update_qty: true,
      to_update_exp: Boolean(nearest)
    }, { onConflict: ['import_id','minsan'] });
  }
  return new Response(JSON.stringify({ status:'ok' }));
});
