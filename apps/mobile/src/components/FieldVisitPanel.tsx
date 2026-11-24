import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { accuracyLevel, formatDistance } from '../lib/geo';
import { getCurrentLocation, type GpsReading } from '../lib/location';
import { sendOrQueue } from '../lib/outbox';
import { takeVisitPhoto } from '../lib/photo';
import { colors, radius, shadow } from '../lib/theme';
import { ensureWorkDayStarted, isTrackingRunning, setActiveVisitId } from '../lib/tracking';
import { AppButton } from './AppButton';
import { ProductPickerModal, type CatalogCartItem, type PendingProductRequest } from './ProductPickerModal';
import { QtyStepper } from './QtyStepper';

const PING_INTERVAL_MS = 120000;

export type AssignedClient = {
  id: string;
  client_code: string;
  client_name: string;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};
type LocationStatus = 'saved' | 'weak_gps' | 'already_set' | 'failed' | null;
type Visit = {
  id: string;
  status: 'checked_in' | 'in_progress' | 'checked_out';
  client_id: string | null;
  unlisted_client_name?: string | null;
  check_in_time: string;
  check_out_time?: string | null;
  check_in_distance_meters?: number | null;
  check_in_within_geofence?: boolean | null;
  clients?: { client_name?: string } | null;
  client_location_status?: LocationStatus;
};
type Notice = { tone: 'ok' | 'warn' | 'error'; text: string };

const OUTCOMES = [
  { value: 'sale_made', label: 'Sale made' },
  { value: 'follow_up_needed', label: 'Follow-up needed' },
  { value: 'no_interest', label: 'No interest' },
  { value: 'other', label: 'Other' },
];

const elapsed = (sinceIso: string) => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(sinceIso).getTime()) / 60000));
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

const lowAccuracyMessage = (location: GpsReading) =>
  location.accuracyMeters != null && accuracyLevel(location.accuracyMeters) === 'low'
    ? `GPS is weak (±${Math.round(location.accuracyMeters)} m). Move to an open area and try again.`
    : null;

function resultNotice(action: string, status: LocationStatus | undefined, accuracy: number | null): Notice {
  const gps = accuracy != null ? ` GPS ±${Math.round(accuracy)} m.` : '';
  if (status === 'saved') return { tone: 'ok', text: `${action}. Client location saved, so future visits are verified.${gps}` };
  if (status === 'weak_gps') return { tone: 'warn', text: `${action}, but GPS was too weak to save the client location.${gps} It is tried again at check-out; stand in the open for best results.` };
  if (status === 'failed') return { tone: 'warn', text: `${action}, but the client location could not be saved. Tell your admin.` };
  return { tone: 'ok', text: `${action}.${gps}` };
}

export function FieldVisitPanel({ clients, refreshKey = 0, onChanged }: { clients: AssignedClient[]; refreshKey?: number; onChanged?: () => void }) {
  const router = useRouter();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [gpsText, setGpsText] = useState('');
  const [notes, setNotes] = useState('');
  const [outcome, setOutcome] = useState('follow_up_needed');
  const [cart, setCart] = useState<CatalogCartItem[]>([]);
  const [pendingRequests, setPendingRequests] = useState<PendingProductRequest[]>([]);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [, forceTick] = useState(0);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeVisit = visits.find((visit) => visit.status !== 'checked_out') ?? null;
  const activeVisitId = activeVisit?.id;

  const loadVisits = useCallback(async () => {
    try {
      const result = await api<{ data: Visit[] }>('/field-visits/mine');
      setVisits(result.data ?? []);
    } catch (cause) {
      setNotice({ tone: 'error', text: (cause as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadVisits(); }, [loadVisits, refreshKey]);

  // Success messages fade away by themselves; warnings and errors stay until the next action.
  useEffect(() => {
    if (notice?.tone !== 'ok') return;
    const id = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    if (!activeVisitId) return;
    const id = setInterval(() => forceTick((current) => current + 1), 30000);
    return () => clearInterval(id);
  }, [activeVisitId]);

  // Location ping while a visit is active (fallback only; the work-day tracker normally records the route).
  useEffect(() => {
    if (!activeVisitId) {
      if (pingTimer.current) { clearInterval(pingTimer.current); pingTimer.current = null; }
      return;
    }
    const ping = async () => {
      try {
        if (await isTrackingRunning()) return;
        const location = await getCurrentLocation();
        await api(`/field-visits/${activeVisitId}/pings`, { method: 'POST', body: { location } });
      } catch { /* A background ping is non-blocking. */ }
    };
    void ping();
    pingTimer.current = setInterval(() => void ping(), PING_INTERVAL_MS);
    return () => {
      if (pingTimer.current) { clearInterval(pingTimer.current); pingTimer.current = null; }
    };
  }, [activeVisitId]);

  useEffect(() => {
    if (pendingRequests.length > 0) setOutcome('follow_up_needed');
  }, [pendingRequests.length]);

  useEffect(() => { void setActiveVisitId(activeVisitId ?? null); }, [activeVisitId]);

  function openClientMap(client: AssignedClient) {
    if (client.latitude == null || client.longitude == null) return;
    router.push({ pathname: '/client-map', params: { clientName: client.client_name, latitude: String(client.latitude), longitude: String(client.longitude) } } as never);
  }

  async function addPhoto() {
    if (!activeVisit) return;
    setPhotoBusy(true);
    try {
      const dataUrl = await takeVisitPhoto();
      if (!dataUrl) return;
      const { queued } = await sendOrQueue('Visit photo', `/field-visits/${activeVisit.id}/photos`, 'POST', { dataUrl });
      setNotice(queued ? { tone: 'warn', text: 'No network. Photo saved on your phone and will upload automatically.' } : { tone: 'ok', text: 'Photo added to this visit.' });
    } catch (cause) {
      setNotice({ tone: 'error', text: (cause as Error).message });
    } finally {
      setPhotoBusy(false);
    }
  }

  function addProduct(product: { id: string; product_name: string }) {
    setCart((current) => current.some((item) => item.productId === product.id) ? current : [...current, { productId: product.id, name: product.product_name, quantity: 1 }]);
  }

  function changeCartQuantity(productId: string, quantity: number) {
    setCart((current) => current.map((item) => item.productId === productId ? { ...item, quantity } : item));
  }

  const showProgress = (accuracy: number | null) => setGpsText(accuracy != null ? `Getting GPS fix… ±${Math.round(accuracy)} m` : 'Getting GPS fix…');

  async function checkIn(clientId: string) {
    setWorking(clientId);
    setNotice(null);
    setGpsText('Getting GPS fix…');
    try {
      const location = await getCurrentLocation({ onProgress: showProgress });
      const tooLow = lowAccuracyMessage(location);
      if (tooLow) { setNotice({ tone: 'error', text: tooLow }); return; }
      await ensureWorkDayStarted(location); // never throws; the work day must exist before the visit so the route trail includes it
      const result = await api<{ data: Visit }>('/field-visits/check-in', { method: 'POST', body: { clientId, location } });
      setVisits((current) => [result.data, ...current]);
      setNotice(resultNotice('Checked in', result.data.client_location_status, location.accuracyMeters));
      onChanged?.();
    } catch (cause) {
      setNotice({ tone: 'error', text: (cause as Error).message });
    } finally {
      setWorking(null);
      setGpsText('');
    }
  }

  async function checkOut() {
    if (!activeVisit) return;
    setWorking(activeVisit.id);
    setNotice(null);
    setGpsText('Getting GPS fix…');
    // If check-out fails, a retry must NOT send the order / requirements again, so each list is cleared as soon as it is saved.
    let saved = '';
    try {
      const location = await getCurrentLocation({ onProgress: showProgress });
      const tooLow = lowAccuracyMessage(location);
      if (tooLow) { setNotice({ tone: 'error', text: tooLow }); return; }

      if (cart.length > 0) {
        await api(`/field-visits/${activeVisit.id}/orders`, { method: 'POST', body: { items: cart.map(({ productId, quantity }) => ({ productId, quantity })) } });
        setCart([]);
        saved += 'Order saved. ';
      }

      if (pendingRequests.length > 0) {
        if (!activeVisit.client_id) throw new Error('Unlisted product requests need a client linked to this visit.');
        await api('/requirements', {
          method: 'POST',
          body: {
            clientId: activeVisit.client_id,
            visitId: activeVisit.id,
            title: `Visit requirements - ${activeVisit.clients?.client_name ?? activeVisit.unlisted_client_name ?? 'client'}`,
            urgency: 'normal',
            items: pendingRequests.map(({ freeTextItem, quantity, notes: requestNotes }) => ({ freeTextItem, quantity, notes: requestNotes })),
          },
        });
        setPendingRequests([]);
        saved += 'Requirements saved. ';
      }

      const result = await api<{ data: Visit }>(`/field-visits/${activeVisit.id}/check-out`, { method: 'PATCH', body: { location, notes: notes || null, outcome } });
      setVisits((current) => current.map((visit) => visit.id === result.data.id ? { ...visit, ...result.data } : visit));
      setNotes('');
      setNotice(resultNotice('Checked out', result.data.client_location_status, location.accuracyMeters));
      onChanged?.();
      void loadVisits();
    } catch (cause) {
      setNotice({ tone: 'error', text: `${saved}${(cause as Error).message}` });
    } finally {
      setWorking(null);
      setGpsText('');
    }
  }

  if (loading) return <ActivityIndicator style={styles.loading} />;

  const noticeBox = notice ? (
    <View style={[styles.notice, notice.tone === 'ok' ? styles.noticeOk : notice.tone === 'warn' ? styles.noticeWarn : styles.noticeError]}>
      <Ionicons name={notice.tone === 'ok' ? 'checkmark-circle' : notice.tone === 'warn' ? 'warning' : 'alert-circle'} size={18} color={notice.tone === 'ok' ? colors.success : notice.tone === 'warn' ? colors.warn : colors.danger} />
      <Text style={[styles.noticeText, { color: notice.tone === 'ok' ? colors.success : notice.tone === 'warn' ? colors.warn : colors.danger }]}>{notice.text}</Text>
    </View>
  ) : null;
  const gpsBox = gpsText ? (
    <View style={styles.gpsBox}>
      <ActivityIndicator size="small" color={colors.brand} />
      <Text style={styles.gpsText}>{gpsText}</Text>
    </View>
  ) : null;

  // ── Active visit: this becomes the main card ──
  if (activeVisit) {
    return (
      <View style={styles.container}>
        {noticeBox}
        {gpsBox}
        <View style={styles.activeCard}>
          <View style={styles.activeHead}>
            <View style={styles.liveDot} />
            <View style={styles.flex1}>
              <Text style={styles.activeTitle} numberOfLines={1}>{activeVisit.clients?.client_name ?? activeVisit.unlisted_client_name ?? 'Unlisted client'}</Text>
              <Text style={styles.activeMeta}>Checked in {hhmm(activeVisit.check_in_time)} · {elapsed(activeVisit.check_in_time)}</Text>
            </View>
          </View>
          {activeVisit.check_in_within_geofence === false ? <Text style={styles.warning}>Check-in was outside the client&apos;s verification radius.</Text> : null}
          {activeVisit.check_in_distance_meters != null ? (
            <Text style={activeVisit.check_in_within_geofence ? styles.verified : styles.warning}>
              {activeVisit.check_in_within_geofence ? 'Location verified · ' : ''}{formatDistance(activeVisit.check_in_distance_meters)} from the client at check-in
            </Text>
          ) : null}

          <View style={styles.productsSection}>
            <View style={styles.sectionHeader}>
              <Text style={styles.label}>Products</Text>
              <AppButton title="+ Add product" variant="secondary" compact onPress={() => setPickerVisible(true)} />
            </View>
            {cart.length === 0 && pendingRequests.length === 0 ? <Text style={styles.hint}>Add products ordered or requested in this visit (optional).</Text> : null}
            {cart.map((item) => (
              <View key={item.productId} style={styles.cartRow}>
                <Text style={styles.itemName}>{item.name}</Text>
                <QtyStepper value={item.quantity} onChange={(quantity) => changeCartQuantity(item.productId, quantity)} />
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove ${item.name}`} onPress={() => setCart((current) => current.filter((entry) => entry.productId !== item.productId))} style={styles.remove}>
                  <Ionicons name="close" size={18} color={colors.danger} />
                </TouchableOpacity>
              </View>
            ))}
            {pendingRequests.length > 0 ? (
              <View style={styles.pendingList}>
                <Text style={styles.pendingHeading}>Pending - needs review</Text>
                {pendingRequests.map((item, index) => (
                  <View key={`${item.freeTextItem}-${index}`} style={styles.pendingRow}>
                    <View style={styles.pendingText}>
                      <Text style={styles.itemName}>{item.freeTextItem}</Text>
                      <Text style={styles.pendingMeta}>Qty {item.quantity}{item.notes ? ` · ${item.notes}` : ''}</Text>
                    </View>
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove ${item.freeTextItem}`} onPress={() => setPendingRequests((current) => current.filter((_, entryIndex) => entryIndex !== index))} style={styles.remove}>
                      <Ionicons name="close" size={18} color={colors.danger} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

                <AppButton title="📷 Add visit photo" variant="secondary" compact loading={photoBusy} disabled={photoBusy || working !== null} onPress={() => void addPhoto()} />

          <Text style={styles.label}>Outcome</Text>
          <View style={styles.outcomeRow}>
            {OUTCOMES.map((item) => (
              <TouchableOpacity key={item.value} style={[styles.outcomeChip, outcome === item.value && styles.outcomeChipActive]} onPress={() => setOutcome(item.value)}>
                <Text style={[styles.outcomeChipText, outcome === item.value && styles.outcomeChipTextActive]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {pendingRequests.length > 0 ? <Text style={styles.outcomeHelper}>Auto-set: {pendingRequests.length} requested item{pendingRequests.length === 1 ? '' : 's'} need follow-up.</Text> : null}
          <TextInput style={styles.input} value={notes} onChangeText={setNotes} placeholder="Visit notes (optional)" placeholderTextColor={colors.muted} multiline />
          <AppButton title="Check out" loading={working === activeVisit.id} disabled={working !== null} onPress={() => void checkOut()} />
          <ProductPickerModal
            visible={pickerVisible}
            cart={cart}
            onClose={() => setPickerVisible(false)}
            onAddProduct={addProduct}
            onQuantityChange={changeCartQuantity}
            onAddRequest={(request) => setPendingRequests((current) => [...current, request])}
          />
        </View>
      </View>
    );
  }

  // ── No active visit: today's client list ──
  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Clients to visit</Text>
      {noticeBox}
      {gpsBox}
      {clients.length === 0 ? (
        <Text style={styles.empty}>No active client assignments yet - ask your admin to assign clients to you.</Text>
      ) : clients.map((client) => {
        const hasLocation = client.latitude != null && client.longitude != null;
        const done = visits.find((visit) => visit.client_id === client.id && visit.status === 'checked_out' && isToday(visit.check_in_time));
        return (
          <View key={client.id} style={styles.clientCard}>
            <View style={styles.clientTop}>
              <View style={styles.clientInitial}><Text style={styles.clientInitialText}>{client.client_name.trim().charAt(0).toUpperCase()}</Text></View>
              <View style={styles.flex1}>
                <Text style={styles.clientName} numberOfLines={1}>{client.client_name}</Text>
                <Text style={styles.clientMeta} numberOfLines={1}>{client.client_code}{client.city ? ` · ${client.city}` : ''}</Text>
              </View>
              {hasLocation ? (
                <Pressable onPress={() => openClientMap(client)} hitSlop={10} style={styles.mapChip} accessibilityLabel="View on map">
                  <Ionicons name="location" size={16} color={colors.success} />
                  <Text style={styles.mapChipText}>Map</Text>
                </Pressable>
              ) : null}
            </View>
            {done ? (
              <View style={styles.doneRow}>
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                <Text style={styles.doneText}>Visited today · {hhmm(done.check_in_time)}{done.check_out_time ? ` – ${hhmm(done.check_out_time)}` : ''}</Text>
                <AppButton title="Visit again" variant="secondary" compact loading={working === client.id} disabled={working !== null} onPress={() => void checkIn(client.id)} />
              </View>
            ) : (
              <AppButton title="Check in" loading={working === client.id} disabled={working !== null} onPress={() => void checkIn(client.id)} />
            )}
            {!hasLocation ? <Text style={styles.hint}>Client location is not saved yet. It is saved automatically on your first good-GPS check-in, so stand outside the client&apos;s place.</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { marginVertical: 20 },
  flex1: { flex: 1 },
  container: { gap: 10 },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '800', marginTop: 4 },
  empty: { color: colors.muted },
  hint: { color: colors.muted, fontSize: 12 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: radius.md },
  noticeOk: { backgroundColor: colors.successSoft },
  noticeWarn: { backgroundColor: colors.warnSoft },
  noticeError: { backgroundColor: colors.dangerSoft },
  noticeText: { flex: 1, fontSize: 13, fontWeight: '600' },
  gpsBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.brandSoft, padding: 12, borderRadius: radius.md },
  gpsText: { color: colors.brand, fontWeight: '700', fontSize: 13 },
  clientCard: { backgroundColor: colors.card, padding: 14, borderRadius: radius.lg, gap: 12, ...shadow },
  clientTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  clientInitial: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  clientInitialText: { color: colors.brand, fontSize: 18, fontWeight: '800' },
  clientName: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  clientMeta: { color: colors.muted, fontSize: 13, marginTop: 1 },
  mapChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.successSoft, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill },
  mapChipText: { color: colors.success, fontWeight: '700', fontSize: 12 },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.successSoft, padding: 10, borderRadius: radius.md },
  doneText: { flex: 1, color: colors.success, fontWeight: '700', fontSize: 13 },
  activeCard: { backgroundColor: colors.card, padding: 16, borderRadius: radius.lg, gap: 10, borderWidth: 2, borderColor: colors.success, ...shadow },
  activeHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  liveDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.success },
  activeTitle: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  activeMeta: { color: colors.muted, fontSize: 13, marginTop: 1 },
  verified: { color: colors.success, fontWeight: '600', fontSize: 13 },
  warning: { color: colors.warn, fontWeight: '600', fontSize: 13 },
  productsSection: { backgroundColor: '#f8fafc', borderRadius: radius.md, padding: 12, gap: 10 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  label: { color: colors.ink, fontWeight: '700', marginTop: 2 },
  cartRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 8, padding: 10 },
  itemName: { color: colors.ink, fontWeight: '600', flex: 1 },
  remove: { height: 36, width: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: colors.dangerSoft },
  pendingList: { borderLeftWidth: 4, borderLeftColor: colors.warn, backgroundColor: colors.warnSoft, padding: 10, borderRadius: 8, gap: 8 },
  pendingHeading: { color: '#92400e', fontWeight: '700', fontSize: 13 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pendingText: { flex: 1, gap: 2 },
  pendingMeta: { color: '#92400e', fontSize: 12 },
  outcomeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  outcomeChip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: '#f1f5f9' },
  outcomeChipActive: { backgroundColor: colors.ink },
  outcomeChipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  outcomeChipTextActive: { color: '#fff' },
  outcomeHelper: { color: colors.warn, fontSize: 12, fontWeight: '600', marginTop: -4 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 10, minHeight: 60, textAlignVertical: 'top', color: colors.ink },
});
