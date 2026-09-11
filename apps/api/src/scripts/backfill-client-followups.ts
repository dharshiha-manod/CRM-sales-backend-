// One-time backfill script.
//
// Why this exists: converting a lead to a client now copies the lead's
// scheduled follow-up into the `follow_ups` table (see the comment in
// leads.repository.ts around `convertLead`). Clients that converted BEFORE
// that fix went in never got that row, so their "Follow-up" column on the
// Clients page shows "—" even though the original lead had a follow-up
// date. This script finds exactly those clients and creates the missing
// row, using each client's own converted lead as the source of the date.
//
// Safe to re-run: it only inserts a follow-up for a client that has zero
// rows in follow_ups already, so running it twice does not create
// duplicates.
//
// Run with:
//   npx tsx scripts/backfill-client-followups.ts

import { supabaseAdmin } from '../src/lib/supabase.js';

async function main() {
  const { data: convertedLeads, error: leadsError } = await supabaseAdmin
    .from('leads')
    .select('id, organization_id, representative_id, company_name, next_action, next_action_due_at, priority, notes, converted_client_id')
    .not('converted_client_id', 'is', null)
    .not('next_action_due_at', 'is', null);

  if (leadsError) {
    console.error('Failed to load converted leads:', leadsError.message);
    process.exit(1);
  }

  if (!convertedLeads || convertedLeads.length === 0) {
    console.log('No converted leads with a follow-up date found. Nothing to do.');
    return;
  }

  let created = 0;
  let skipped = 0;

  for (const lead of convertedLeads) {
    const clientId = lead.converted_client_id as string;

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('follow_ups')
      .select('id')
      .eq('client_id', clientId)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      console.error(`Skipping client ${clientId} — could not check existing follow-ups: ${existingError.message}`);
      continue;
    }

    if (existing) {
      skipped += 1;
      continue;
    }

    if (!lead.representative_id) {
      console.log(`Skipping client ${clientId} (lead ${lead.id}) — lead has no representative_id, so a follow-up can't be assigned.`);
      continue;
    }

    const { error: insertError } = await supabaseAdmin.from('follow_ups').insert({
      organization_id: lead.organization_id,
      representative_id: lead.representative_id,
      client_id: clientId,
      title: lead.next_action || `Follow up with ${lead.company_name}`,
      due_at: lead.next_action_due_at,
      priority: lead.priority ?? 'normal',
      notes: lead.notes ?? null,
    });

    if (insertError) {
      console.error(`Failed to backfill follow-up for client ${clientId}: ${insertError.message}`);
      continue;
    }

    created += 1;
    console.log(`Created follow-up for client ${clientId} (from lead "${lead.company_name}", due ${lead.next_action_due_at}).`);
  }

  console.log(`\nDone. Created ${created} follow-up row(s), skipped ${skipped} client(s) that already had one.`);
}

main().catch((error) => {
  console.error('Backfill script crashed:', error);
  process.exit(1);
});