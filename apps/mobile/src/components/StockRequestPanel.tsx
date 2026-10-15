import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { AppButton } from './AppButton';
import { QtyStepper } from './QtyStepper';
import { api } from '../lib/api';

type Holding = { product_id: string; product_name: string; assigned: number; returned: number; sold: number; balance: number };
type Product = { id: string; product_name: string; product_code: string };
type StockRequest = { id: string; quantity: number; reason: string | null; status: 'pending' | 'approved' | 'rejected' | 'fulfilled'; decision_note: string | null; created_at: string; products?: { product_name?: string } | null };

const STATUS_LABEL: Record<StockRequest['status'], string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', fulfilled: 'Stock given' };
const STATUS_COLOR: Record<StockRequest['status'], string> = { pending: '#b45309', approved: '#1d4ed8', rejected: '#b91c1c', fulfilled: '#15803d' };

export function StockRequestPanel() {
  const [stock, setStock] = useState<Holding[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [requests, setRequests] = useState<StockRequest[]>([]);
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(10);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        api<{ data: Holding[] }>('/inventory/my-stock'),
        api<{ data: StockRequest[] }>('/inventory/requests'),
      ]);
      setStock(s.data ?? []);
      setRequests(r.data ?? []);
    } catch (cause) {
      setMessage((cause as Error).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function openForm() {
    setMessage('');
    setOpen(true);
    if (products.length === 0) {
      try {
        const res = await api<{ data: Product[] }>('/inventory/request-products');
        setProducts(res.data ?? []);
        if (res.data?.[0]) setProductId(res.data[0].id);
      } catch (cause) {
        setMessage((cause as Error).message);
      }
    }
  }

  async function submit() {
    if (!productId || quantity < 1) { setMessage('Choose a product and a quantity.'); return; }
    setSaving(true);
    setMessage('');
    try {
      await api('/inventory/requests', { method: 'POST', body: { productId, quantity, reason: reason.trim() || null } });
      setOpen(false);
      setReason('');
      setQuantity(10);
      setMessage('Request sent. Your manager will review it.');
      await load();
    } catch (cause) {
      setMessage((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.title}>My stock</Text>
        <AppButton title="Request stock" variant="secondary" onPress={() => void openForm()} />
      </View>
      {stock.length === 0 ? <Text style={styles.muted}>No stock assigned to you yet.</Text> : stock.map((h) => (
        <View key={h.product_id} style={styles.item}>
          <Text style={styles.itemName}>{h.product_name}</Text>
          <Text style={styles.muted}>Assigned {h.assigned} · Sold {h.sold} · Returned {h.returned}</Text>
          <Text style={styles.balance}>{h.balance} with you</Text>
        </View>
      ))}

      {open ? (
        <View style={styles.form}>
          <Text style={styles.label}>Product</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {products.map((p) => (
              <TouchableOpacity key={p.id} onPress={() => setProductId(p.id)} style={[styles.chip, productId === p.id && styles.chipOn]}>
                <Text style={[styles.chipText, productId === p.id && styles.chipTextOn]}>{p.product_name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={styles.label}>Quantity</Text>
          <QtyStepper value={quantity} onChange={setQuantity} />
          <Text style={styles.label}>Reason (optional)</Text>
          <TextInput value={reason} onChangeText={setReason} placeholder="Why do you need it?" style={styles.input} maxLength={500} />
          <View style={styles.row}>
            <AppButton title="Cancel" variant="ghost" onPress={() => setOpen(false)} />
            <AppButton title="Send request" onPress={() => void submit()} loading={saving} />
          </View>
        </View>
      ) : null}

      {message ? <Text style={styles.message}>{message}</Text> : null}

      {requests.length > 0 ? <Text style={styles.title}>My requests</Text> : null}
      {requests.map((r) => (
        <View key={r.id} style={styles.item}>
          <View style={styles.row}>
            <Text style={styles.itemName}>{r.products?.product_name ?? 'Product'} × {r.quantity}</Text>
            <Text style={[styles.status, { color: STATUS_COLOR[r.status] }]}>{STATUS_LABEL[r.status]}</Text>
          </View>
          {r.reason ? <Text style={styles.muted}>{r.reason}</Text> : null}
          {r.decision_note ? <Text style={styles.muted}>Note: {r.decision_note}</Text> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginBottom: 20 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  title: { fontSize: 18, fontWeight: '700' },
  muted: { color: '#64748b' },
  item: { backgroundColor: '#fff', padding: 14, borderRadius: 10, gap: 3 },
  itemName: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  balance: { fontWeight: '700', color: '#0f172a' },
  status: { fontWeight: '700' },
  form: { backgroundColor: '#fff', padding: 14, borderRadius: 10, gap: 8 },
  label: { color: '#475569', fontWeight: '600' },
  chips: { gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#cbd5e1' },
  chipOn: { backgroundColor: '#0f172a', borderColor: '#0f172a' },
  chipText: { color: '#0f172a', fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: '#fff' },
  message: { color: '#475569' },
});