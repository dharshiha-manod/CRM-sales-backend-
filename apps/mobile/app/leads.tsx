import { useCallback, useEffect, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { AppButton } from '../src/components/AppButton';
import { ScreenShell, cardStyles as s } from '../src/components/ScreenShell';
import { api } from '../src/lib/api';
import { flushOutbox, sendOrQueue } from '../src/lib/outbox';
import { colors } from '../src/lib/theme';

type Lead = { id: string; lead_code?: string | null; company_name: string; contact_name?: string | null; phone?: string | null; status: string; priority: string; city?: string | null; created_at: string };
type Industry = { id: string; name: string };
const SOURCES = [
  { value: 'walk_in', label: 'Walk-in' }, { value: 'referral', label: 'Referral' }, { value: 'cold_call', label: 'Cold call' },
  { value: 'exhibition', label: 'Exhibition' }, { value: 'other', label: 'Other' },
];
const PRIORITIES = ['low', 'normal', 'high'] as const;

export default function LeadsScreen() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [industryId, setIndustryId] = useState('');
  const [company, setCompany] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [source, setSource] = useState('walk_in');
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>('normal');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      await flushOutbox();
      const [l, d] = await Promise.all([api<{ data: Lead[] }>('/leads'), api<{ data: { industries?: Industry[] } }>('/mobile/dashboard')]);
      setLeads(l.data ?? []);
      const list = d.data.industries ?? [];
      setIndustries(list);
      setIndustryId((current) => current || list[0]?.id || '');
    } catch (cause) {
      setMessage({ tone: 'error', text: (cause as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!industryId) { setMessage({ tone: 'error', text: 'No industry is assigned to you. Ask your admin.' }); return; }
    if (!company.trim()) { setMessage({ tone: 'error', text: 'Enter the company / shop name.' }); return; }
    if (phone.trim().length < 5) { setMessage({ tone: 'error', text: 'Enter a valid phone number.' }); return; }
    setSaving(true);
    setMessage(null);
    try {
      const body = {
        industryTypeId: industryId, companyName: company.trim(), contactName: contact.trim() || null, phone: phone.trim(),
        city: city.trim() || null, source, priority, notes: notes.trim() || null,
      };
      const { queued } = await sendOrQueue('New lead', '/leads', 'POST', body);
      setMessage(queued ? { tone: 'warn', text: 'No network. Lead saved on your phone and will upload automatically.' } : { tone: 'ok', text: 'Lead created.' });
      setShowForm(false); setCompany(''); setContact(''); setPhone(''); setCity(''); setNotes('');
      if (!queued) await load();
    } catch (cause) {
      setMessage({ tone: 'error', text: (cause as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const chip = (active: boolean, text: string, onPress: () => void) => (
    <TouchableOpacity key={text} style={[s.chip, active && s.chipActive]} onPress={onPress}><Text style={[s.chipText, active && s.chipTextActive]}>{text}</Text></TouchableOpacity>
  );

  return (
    <ScreenShell title="Leads" refreshing={loading} onRefresh={() => void load()}>
      {message ? <Text style={s[message.tone]}>{message.text}</Text> : null}
      {showForm ? (
        <View style={s.card}>
          <Text style={s.title}>New lead</Text>
          {industries.length > 1 ? <View style={s.chipRow}>{industries.map((item) => chip(industryId === item.id, item.name, () => setIndustryId(item.id)))}</View> : null}
          <TextInput style={s.input} placeholder="Company / shop name *" placeholderTextColor={colors.muted} value={company} onChangeText={setCompany} />
          <TextInput style={s.input} placeholder="Contact person" placeholderTextColor={colors.muted} value={contact} onChangeText={setContact} />
          <TextInput style={s.input} placeholder="Phone *" placeholderTextColor={colors.muted} keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
          <TextInput style={s.input} placeholder="City" placeholderTextColor={colors.muted} value={city} onChangeText={setCity} />
          <Text style={s.label}>Source</Text>
          <View style={s.chipRow}>{SOURCES.map((item) => chip(source === item.value, item.label, () => setSource(item.value)))}</View>
          <Text style={s.label}>Priority</Text>
          <View style={s.chipRow}>{PRIORITIES.map((item) => chip(priority === item, item, () => setPriority(item)))}</View>
          <TextInput style={[s.input, { minHeight: 60, textAlignVertical: 'top' }]} placeholder="Notes" placeholderTextColor={colors.muted} multiline value={notes} onChangeText={setNotes} />
          <View style={s.row}>
            <AppButton title="Save lead" compact loading={saving} onPress={() => void save()} />
            <AppButton title="Cancel" variant="ghost" compact onPress={() => setShowForm(false)} />
          </View>
        </View>
      ) : <AppButton title="+ New lead" onPress={() => setShowForm(true)} />}
      {!loading && leads.length === 0 ? <Text style={s.empty}>No leads yet.</Text> : null}
      {leads.map((lead) => (
        <View key={lead.id} style={s.card}>
          <Text style={s.title}>{lead.company_name}</Text>
          <Text style={s.meta}>{lead.lead_code ?? ''}{lead.contact_name ? ` · ${lead.contact_name}` : ''}{lead.phone ? ` · ${lead.phone}` : ''}</Text>
          <Text style={s.meta}>{lead.status} · {lead.priority}{lead.city ? ` · ${lead.city}` : ''}</Text>
        </View>
      ))}
    </ScreenShell>
  );
}