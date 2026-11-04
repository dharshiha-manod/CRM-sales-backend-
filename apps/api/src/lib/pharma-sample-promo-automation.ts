// Pharma upkeep automation for Samples and Product Promotions (runs with the existing Pharma scheduler, no new table).
//   1. Sample issued to a rep but still not distributed after SAMPLE_OVERDUE_DAYS  -> Follow-up for that rep.
//   2. Sample units still with a rep / doctor after the sample's batch expiry date  -> Follow-up to take them back.
//   3. Promotion finished with no doctor feedback recorded                          -> Follow-up 3 days after its end date to collect it.
// A follow-up is made only when the hospital (client) and the sales rep can be matched, and only once per title (never re-created
// after someone completes it). Idempotent: running it again changes nothing. Set PHARMA_SAMPLE_PROMO_AUTOMATION=off to disable.
import { supabaseAdmin } from './supabase.js';
import { todayLocal } from './ist-date.js';
import { createManual as createFollowUp } from '../repositories/follow-ups.repository.js';

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const num = (v: unknown) => Number(v ?? 0) || 0;
const SAMPLE_OVERDUE_DAYS = Math.max(1, Number(process.env.PHARMA_SAMPLE_OVERDUE_DAYS ?? 7));
const FEEDBACK_AFTER_DAYS = 3;
const addDays = (isoDate: string, days: number) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function makeFollowUp(orgId: string, industryTypeId: string, hospital: string, repCode: string, title: string, dueDate: string, notes: string): Promise<boolean> {
  if (!hospital || !repCode) return false;
  const [{ data: client }, { data: rep }] = await Promise.all([
    supabaseAdmin.from('clients').select('id').eq('organization_id', orgId).eq('industry_type_id', industryTypeId).eq('client_name', hospital).limit(1).maybeSingle(),
    supabaseAdmin.from('sales_representatives').select('id').eq('organization_id', orgId).eq('employee_code', repCode).maybeSingle(),
  ]);
  if (!client || !rep) return false;
  const { data: already } = await supabaseAdmin.from('follow_ups').select('id').eq('organization_id', orgId).eq('client_id', client.id as string).eq('title', title).limit(1).maybeSingle();
  if (already) return false; // any status: a completed reminder is never recreated
  const dueAt = new Date(Math.max(Date.parse(`${dueDate}T09:00:00+05:30`), Date.now() + 5 * 60_000)).toISOString();
  await createFollowUp(orgId, { clientId: client.id as string, representativeId: rep.id as string, title, dueAt, priority: 'normal', followUpType: 'visit', notes });
  return true;
}

export async function runSamplePromoAutomation(orgId: string): Promise<{ followUps: number }> {
  if (String(process.env.PHARMA_SAMPLE_PROMO_AUTOMATION ?? '').toLowerCase() === 'off') return { followUps: 0 };
  let made = 0;
  const t = todayLocal();

  // 1 + 2: samples
  const { data: samples, error: se } = await supabaseAdmin.from('pharma_samples')
    .select('sample_code, product_name, batch_number, expiry_date, quantity_remaining, sales_rep, hospital_name, issue_date, status, industry_type_id')
    .eq('organization_id', orgId).in('status', ['Assigned', 'Taken for visit']).gt('quantity_remaining', 0);
  if (se) { if ((se as { code?: string }).code !== '42P01') throw se; }
  for (const s of (samples ?? []) as Row[]) {
    try {
      const code = str(s.sample_code); const it = str(s.industry_type_id);
      const expiry = str(s.expiry_date).slice(0, 10); const issued = str(s.issue_date).slice(0, 10);
      if (expiry && expiry < t) {
        if (await makeFollowUp(orgId, it, str(s.hospital_name), str(s.sales_rep), `Sample ${code} expired: take back ${num(s.quantity_remaining)} unit(s)`, t, `${str(s.product_name)} batch ${str(s.batch_number)} expired on ${expiry}. Collect the unused units and mark the sample Returned.`)) made += 1;
      } else if (issued && issued <= addDays(t, -SAMPLE_OVERDUE_DAYS)) {
        if (await makeFollowUp(orgId, it, str(s.hospital_name), str(s.sales_rep), `Sample ${code} not distributed yet`, t, `${str(s.product_name)} (${num(s.quantity_remaining)} unit(s)) was issued on ${issued} and is still not distributed. Distribute it or mark it Returned.`)) made += 1;
      }
    } catch { /* one bad row never stops the rest */ }
  }

  // 3: finished promotions with no feedback
  const { data: promos, error: pe } = await supabaseAdmin.from('pharma_promotions')
    .select('promotion_code, campaign_name, end_date, feedback, doctor_response, sales_rep, hospital_name, status, industry_type_id')
    .eq('organization_id', orgId).in('status', ['Active', 'Completed']).lte('end_date', t).gte('end_date', addDays(t, -60));
  if (pe) { if ((pe as { code?: string }).code !== '42P01') throw pe; }
  for (const p of (promos ?? []) as Row[]) {
    try {
      if (str(p.feedback) || str(p.doctor_response)) continue;
      const end = str(p.end_date).slice(0, 10); if (!end) continue;
      const due = addDays(end, FEEDBACK_AFTER_DAYS); if (due > t) continue; // wait the 3 days first
      if (await makeFollowUp(orgId, str(p.industry_type_id), str(p.hospital_name), str(p.sales_rep), `Collect feedback: ${str(p.campaign_name)} (${str(p.promotion_code)})`, t, `Campaign ended on ${end}. Ask the doctor for feedback and record it in Product Promotions.`)) made += 1;
    } catch { /* continue */ }
  }
  return { followUps: made };
}