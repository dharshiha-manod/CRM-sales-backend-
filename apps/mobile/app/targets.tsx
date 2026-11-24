import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { ScreenShell, cardStyles as s } from '../src/components/ScreenShell';
import { api } from '../src/lib/api';
import { colors } from '../src/lib/theme';

type Target = {
  id: string; target_type: string; period_label: string; period_start: string; period_end: string; target_value: number; achieved_value: number;
  industry_types?: { name?: string } | null; products?: { product_name?: string } | null;
};
const label = (type: string) => type.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const isMoney = (type: string) => /amount|value|fee/.test(type);
const fmt = (type: string, value: number) => (isMoney(type) ? `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : Number(value).toLocaleString('en-IN', { maximumFractionDigits: 1 }));

export default function TargetsScreen() {
  const [items, setItems] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const result = await api<{ data: Target[] }>('/targets/mine');
      setItems(result.data ?? []);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <ScreenShell title="My targets" refreshing={loading} onRefresh={() => void load()}>
      {error ? <Text style={s.error}>{error}</Text> : null}
      {!loading && !error && items.length === 0 ? <Text style={s.empty}>No active targets. Your manager can set one.</Text> : null}
      {items.map((item) => {
        const target = Number(item.target_value);
        const achieved = Number(item.achieved_value);
        const percent = target > 0 ? Math.min(100, Math.round((achieved / target) * 100)) : 0;
        const tone = percent >= 100 ? colors.success : percent >= 60 ? colors.brand : colors.warn;
        return (
          <View key={item.id} style={s.card}>
            <Text style={s.title}>{label(item.target_type)}{item.products?.product_name ? ` · ${item.products.product_name}` : ''}</Text>
            <Text style={s.meta}>{item.period_label} · {item.industry_types?.name ?? ''}</Text>
            <View style={{ height: 10, borderRadius: 5, backgroundColor: '#e2e8f0', overflow: 'hidden' }}>
              <View style={{ width: `${percent}%`, height: 10, backgroundColor: tone }} />
            </View>
            <Text style={{ color: tone, fontWeight: '800' }}>{percent}%  ·  {fmt(item.target_type, achieved)} of {fmt(item.target_type, target)}</Text>
          </View>
        );
      })}
    </ScreenShell>
  );
}