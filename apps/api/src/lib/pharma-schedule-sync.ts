// Pharma: the "Drug schedule" chosen on the Products form is written into Drug Schedules (the table that blocks sales to
// unlicensed buyers and feeds the Schedule register), so there is ONE source of truth. Products of other industries never reach this.
import { supabaseAdmin } from './supabase.js';
import { industryCodeOf } from './fmcg-market.js';
import { insertNumbered, type Row } from './pharma-db.js';

const FROM_PRODUCT: Record<string, string> = { 'Schedule H': 'H', 'Schedule H1': 'H1', 'Schedule X': 'X' };
const NOTE = 'Synced from the Products form';

export async function syncDrugScheduleFromProduct(org: string, product: { id: string; product_code?: unknown; product_name?: unknown }, input: Record<string, unknown>): Promise<void> {
  try {
    const details = input.pharmaDetails as { drugSchedule?: string | null } | null | undefined;
    if (!details || !('drugSchedule' in details)) return; // the form did not send a schedule: leave Drug Schedules alone
    const code = String(product.product_code ?? '').trim();
    if (!code) return;
    let ids = Array.isArray(input.industryTypeIds) ? (input.industryTypeIds as string[]) : [];
    if (!ids.length) {
      const { data } = await supabaseAdmin.from('product_industry_types').select('industry_type_id').eq('organization_id', org).eq('product_id', product.id);
      ids = ((data ?? []) as Row[]).map((r) => String(r.industry_type_id));
    }
    const wanted = FROM_PRODUCT[String(details.drugSchedule ?? '').trim()] ?? null;
    for (const it of ids) {
      if ((await industryCodeOf(org, it)) !== 'pharma') continue;
      const { data: found, error } = await supabaseAdmin.from('pharma_drug_schedules').select('id, schedule, status').eq('organization_id', org).eq('industry_type_id', it).eq('product_code', code).limit(1);
      if (error) { if ((error as { code?: string }).code === '42P01') return; throw error; }
      const row = ((found ?? [])[0] ?? null) as Row | null;
      if (wanted) {
        if (row) await supabaseAdmin.from('pharma_drug_schedules').update({ schedule: wanted, status: 'Active', product_name: product.product_name }).eq('organization_id', org).eq('id', row.id);
        else await insertNumbered('pharma_drug_schedules', 'schedule_code', org, 'SCH-', { industry_type_id: it, product_code: code, product_name: product.product_name, schedule: wanted, status: 'Active', notes: NOTE });
      } else if (row && row.schedule !== 'Narcotic (NDPS)' && row.status !== 'Inactive') {
        // product is now "None / G / C": the rule no longer applies (an NDPS entry made by hand is never touched)
        await supabaseAdmin.from('pharma_drug_schedules').update({ status: 'Inactive' }).eq('organization_id', org).eq('id', row.id);
      }
    }
  } catch { /* the product is already saved; Drug Schedules can still be edited by hand */ }
}