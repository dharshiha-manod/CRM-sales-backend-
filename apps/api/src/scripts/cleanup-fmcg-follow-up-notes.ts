import { supabaseAdmin } from '../lib/supabase.js';

const FMCG_META_MARKER = '<<<FMCG_META>>>';
const PAGE_SIZE = 100;

type FollowUpNote = {
  id: string;
  notes: string | null;
};

function stripFmcgMeta(notes: string): string {
  const markerIndex = notes.indexOf(FMCG_META_MARKER);
  return markerIndex === -1 ? notes : notes.slice(0, markerIndex).trimEnd();
}

async function cleanupFmcgFollowUpNotes(): Promise<void> {
  let cleaned = 0;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from('follow_ups')
      .select('id, notes')
      .like('notes', `%${FMCG_META_MARKER}%`)
      .range(0, PAGE_SIZE - 1);
    if (error) throw error;

    const rows = (data ?? []) as FollowUpNote[];
    for (const row of rows) {
      if (row.notes == null) continue;
      const { error: updateError } = await supabaseAdmin
        .from('follow_ups')
        .update({ notes: stripFmcgMeta(row.notes) })
        .eq('id', row.id);
      if (updateError) throw updateError;
      cleaned += 1;
    }

    if (rows.length < PAGE_SIZE) break;
  }

  console.info(`Cleaned FMCG metadata from ${cleaned} follow-up note(s).`);
}

cleanupFmcgFollowUpNotes().catch((error: unknown) => {
  console.error('Failed to clean FMCG metadata from follow-up notes.', error);
  process.exitCode = 1;
});
