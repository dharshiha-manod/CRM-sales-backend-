import { useCallback, useEffect, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { AppButton } from '../src/components/AppButton';
import { ScreenShell, cardStyles as s } from '../src/components/ScreenShell';
import { api } from '../src/lib/api';
import { scheduleFollowUpReminders } from '../src/lib/notifications';
import { flushOutbox, sendOrQueue } from '../src/lib/outbox';
import { colors } from '../src/lib/theme';

type FollowUp = {
  id: string; title: string; due_at: string; status: 'pending' | 'in_progress' | 'completed' | 'cancelled'; priority: string;
  follow_up_type?: string | null; notes?: string | null;
  clients?: { client_name?: string } | null; leads?: { company_name?: string | null } | null;
};
const OUTCOMES = [
  { value: 'connected', label: 'Connected' }, { value: 'no_answer', label: 'No answer' }, { value: 'promised_payment', label: 'Promised payment' },
  { value: 'visit_needed', label: 'Visit needed' }, { value: 'not_interested', label: 'Not interested' }, { value: 'other', label: 'Other' },
];
const fmt = (iso: string) => new Date(iso).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function FollowUpsScreen() {
  const [items, setItems] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState('connected');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      await flushOutbox();
      const result = await api<{ data: FollowUp[] }>('/follow-ups/mine');
      const open = (result.data ?? []).filter((item) => item.status === 'pending' || item.status === 'in_progress');
      setItems(open);
      void scheduleFollowUpReminders(open);
    } catch (cause) {
      setMessage({ tone: 'error', text: (cause as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function run(id: string, label: string, path: string, body: unknown, done: string) {
    setBusy(id);
    setMessage(null);
    try {
      const { queued } = await sendOrQueue(label, path, 'PATCH', body);
      if (queued) {
        setItems((current) => current.filter((item) => item.id !== id));
        setMessage({ tone: 'warn', text: 'No network. Saved on your phone and will upload automatically.' });
      } else {
        setMessage({ tone: 'ok', text: done });
        await load();
      }
      setOpenId(null);
      setNote('');
    } catch (cause) {
      setMessage({ tone: 'error', text: (cause as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const complete = (item: FollowUp) => run(item.id, 'Complete follow-up', `/follow-ups/mine/${item.id}`, { status: 'completed', outcome, completionNote: note.trim() || null }, 'Follow-up completed.');
  const postpone = (item: FollowUp, days: number) => run(item.id, 'Reschedule follow-up', `/follow-ups/mine/${item.id}/reschedule`, { dueAt: new Date(new Date(item.due_at).getTime() + days * 86400000).toISOString(), reason: 'Rescheduled from the mobile app' }, `Moved by ${days} day${days === 1 ? '' : 's'}.`);

  const now = Date.now();
  return (
    <ScreenShell title="Follow-ups" refreshing={loading} onRefresh={() => void load()}>
      {message ? <Text style={s[message.tone]}>{message.text}</Text> : null}
      {!loading && items.length === 0 ? <Text style={s.empty}>No open follow-ups. 🎉</Text> : null}
      {items.map((item) => {
        const overdue = new Date(item.due_at).getTime() < now;
        const name = item.clients?.client_name ?? item.leads?.company_name ?? null;
        return (
          <View key={item.id} style={[s.card, overdue && { borderLeftWidth: 4, borderLeftColor: colors.danger }]}>
            <Text style={s.title}>{item.title}</Text>
            <Text style={s.meta}>{name ? `${name} · ` : ''}{item.follow_up_type ?? 'follow-up'} · {item.priority}</Text>
            <Text style={overdue ? s.error : s.meta}>{overdue ? 'Overdue · ' : 'Due '}{fmt(item.due_at)}</Text>
            {item.notes ? <Text style={s.meta} numberOfLines={2}>{item.notes}</Text> : null}
            {openId === item.id ? (
              <View style={{ gap: 8 }}>
                <Text style={s.label}>Outcome</Text>
                <View style={s.chipRow}>
                  {OUTCOMES.map((entry) => (
                    <TouchableOpacity key={entry.value} style={[s.chip, outcome === entry.value && s.chipActive]} onPress={() => setOutcome(entry.value)}>
                      <Text style={[s.chipText, outcome === entry.value && s.chipTextActive]}>{entry.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput style={s.input} placeholder="Note (optional)" placeholderTextColor={colors.muted} value={note} onChangeText={setNote} multiline />
                <View style={s.row}>
                  <AppButton title="Save as done" compact loading={busy === item.id} disabled={busy !== null} onPress={() => void complete(item)} />
                  <AppButton title="Cancel" variant="ghost" compact onPress={() => setOpenId(null)} />
                </View>
              </View>
            ) : (
              <View style={s.row}>
                <AppButton title="Done" compact disabled={busy !== null} onPress={() => { setOpenId(item.id); setOutcome('connected'); }} />
                <AppButton title="+1 day" variant="secondary" compact disabled={busy !== null} onPress={() => void postpone(item, 1)} />
                <AppButton title="+3 days" variant="secondary" compact disabled={busy !== null} onPress={() => void postpone(item, 3)} />
              </View>
            )}
          </View>
        );
      })}
    </ScreenShell>
  );
}