import { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { AppButton } from '../src/components/AppButton';
import { ScreenShell, cardStyles as s } from '../src/components/ScreenShell';
import { api } from '../src/lib/api';
import { flushOutbox, sendOrQueue } from '../src/lib/outbox';
import { colors } from '../src/lib/theme';

type Order = { id: string; order_number: string; status: string; total_amount: number; returns_credit?: number; refunded_amount?: number; clients?: { client_name?: string } | null };
type Collection = { id: string; sale_order_id: string | null; amount: number; mode: string; collected_at: string; sale_orders?: { order_number?: string } | null; clients?: { client_name?: string } | null };
const MODES = [
  { value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' }, { value: 'other', label: 'Other' },
];
const money = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 2 });

export default function CollectionsScreen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('cash');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      await flushOutbox();
      const [o, c] = await Promise.all([api<{ data: Order[] }>('/orders/mine'), api<{ data: Collection[] }>('/collections/mine')]);
      setOrders(o.data ?? []);
      setCollections(c.data ?? []);
    } catch (cause) {
      setMessage({ tone: 'error', text: (cause as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Outstanding = order total - approved return credit - money collected (+ refunded). The server re-checks this on save.
  const pending = useMemo(() => {
    const paid = new Map<string, number>();
    for (const row of collections) if (row.sale_order_id) paid.set(row.sale_order_id, (paid.get(row.sale_order_id) ?? 0) + Number(row.amount));
    return orders
      .filter((order) => !['cancelled', 'rejected', 'pending_approval', 'draft'].includes(order.status))
      .map((order) => ({ order, balance: Number(order.total_amount) - Number(order.returns_credit ?? 0) - ((paid.get(order.id) ?? 0) - Number(order.refunded_amount ?? 0)) }))
      .filter((entry) => entry.balance > 0.009);
  }, [orders, collections]);

  async function save(order: Order, balance: number) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) { setMessage({ tone: 'error', text: 'Enter a valid amount.' }); return; }
    if (value > balance + 0.009) { setMessage({ tone: 'error', text: `Amount is more than the balance (${money(balance)}).` }); return; }
    setSaving(true);
    setMessage(null);
    try {
      const { queued } = await sendOrQueue('Record payment', '/collections/mine', 'POST', { orderId: order.id, amount: value, mode, referenceNo: reference.trim() || null });
      setMessage(queued ? { tone: 'warn', text: 'No network. Payment saved on your phone and will upload automatically.' } : { tone: 'ok', text: 'Payment recorded.' });
      setOpenId(null); setAmount(''); setReference('');
      if (!queued) await load();
    } catch (cause) {
      setMessage({ tone: 'error', text: (cause as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScreenShell title="Collections" refreshing={loading} onRefresh={() => void load()}>
      {message ? <Text style={s[message.tone]}>{message.text}</Text> : null}
      <Text style={s.label}>Pending payments</Text>
      {!loading && pending.length === 0 ? <Text style={s.empty}>No pending payments.</Text> : null}
      {pending.map(({ order, balance }) => (
        <View key={order.id} style={s.card}>
          <Text style={s.title}>{order.order_number} · {order.clients?.client_name ?? 'Client'}</Text>
          <Text style={s.meta}>Total {money(Number(order.total_amount))}</Text>
          <Text style={s.warn}>Balance {money(balance)}</Text>
          {openId === order.id ? (
            <View style={{ gap: 8 }}>
              <TextInput style={s.input} keyboardType="decimal-pad" placeholder="Amount" placeholderTextColor={colors.muted} value={amount} onChangeText={setAmount} />
              <View style={s.chipRow}>
                {MODES.map((entry) => (
                  <TouchableOpacity key={entry.value} style={[s.chip, mode === entry.value && s.chipActive]} onPress={() => setMode(entry.value)}>
                    <Text style={[s.chipText, mode === entry.value && s.chipTextActive]}>{entry.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {mode !== 'cash' ? <TextInput style={s.input} placeholder="Reference / UTR / cheque no." placeholderTextColor={colors.muted} value={reference} onChangeText={setReference} /> : null}
              <View style={s.row}>
                <AppButton title="Save payment" compact loading={saving} onPress={() => void save(order, balance)} />
                <AppButton title="Cancel" variant="ghost" compact onPress={() => setOpenId(null)} />
              </View>
            </View>
          ) : (
            <AppButton title="Record payment" compact onPress={() => { setOpenId(order.id); setAmount(String(Math.round(balance * 100) / 100)); setMode('cash'); setReference(''); }} />
          )}
        </View>
      ))}
      <Text style={s.label}>Recent payments</Text>
      {collections.slice(0, 15).map((row) => (
        <View key={row.id} style={s.card}>
          <Text style={s.title}>{money(Number(row.amount))} · {row.mode.replace('_', ' ')}</Text>
          <Text style={s.meta}>{row.clients?.client_name ?? ''}{row.sale_orders?.order_number ? ` · ${row.sale_orders.order_number}` : ''} · {new Date(row.collected_at).toLocaleDateString()}</Text>
        </View>
      ))}
    </ScreenShell>
  );
}