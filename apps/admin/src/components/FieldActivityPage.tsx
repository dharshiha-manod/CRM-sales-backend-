import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import './FieldActivityPage.css';

type Client = { id: string; client_code: string; client_name: string; city?: string | null };
type NearbyClient = Client & { distanceMeters: number };
type Visit = { id: string; status: string; check_in_time: string; notes?: string | null; outcome?: string | null; clients?: { client_name?: string } | null; sales_representatives?: { employee_code?: string; user_profiles?: { display_name?: string | null } | null } | null };
type Position = { latitude: number; longitude: number; accuracyMeters?: number | null };
type MeetingActivity = { personMet: string; designation: string; purpose: string; requirements: string; expectedQuantity: string; expectedValue: string; notes: string };
type SavedActivity = { id: string; person_met?: string | null; designation?: string | null; purpose?: string | null; requirements?: string | null; expected_quantity?: number | null; expected_value?: number | null; notes?: string | null; created_at: string };
type Product = { id: string; product_code: string; product_name: string; selling_price: number };
type OrderLine = { productId: string; quantity: string; discountPercent: string };
type ExistingOrder = { id: string; visit_id: string; order_number: string };

export function FieldActivityPage() {
  const [mode, setMode] = useState<'rep' | 'admin' | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [nearbyClients, setNearbyClients] = useState<NearbyClient[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [savedActivities, setSavedActivities] = useState<SavedActivity[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orderLines, setOrderLines] = useState<OrderLine[]>([{ productId: '', quantity: '1', discountPercent: '0' }]);
  const [orderNotes, setOrderNotes] = useState('');
  const [followUpTitle, setFollowUpTitle] = useState('');
  const [followUpDueAt, setFollowUpDueAt] = useState('');
  const [collectionAmount, setCollectionAmount] = useState('');
  const [collectionMode, setCollectionMode] = useState('cash');
  const [collectionReference, setCollectionReference] = useState('');
  const [currentVisitOrderId, setCurrentVisitOrderId] = useState<string | null>(null);
  const [activeVisit, setActiveVisit] = useState<Visit | null>(null);
  const [completedVisit, setCompletedVisit] = useState<Visit | null>(null);
  const [clientId, setClientId] = useState('');
  const [unlistedClientName, setUnlistedClientName] = useState('');
  const [notes, setNotes] = useState('');
  const [outcome, setOutcome] = useState('follow_up_needed');
  const [activity, setActivity] = useState<MeetingActivity>({ personMet: '', designation: '', purpose: '', requirements: '', expectedQuantity: '', expectedValue: '', notes: '' });
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const watchId = useRef<number | null>(null);
  const lastPing = useRef(0);

  const location = () => new Promise<Position>((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location services are not available in this browser.'));
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy }),
      () => reject(new Error('Location permission is required to check in. Enable location access and try again.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 }
    );
  });

  useEffect(() => {
    void (async () => {
      try {
        const [assigned, mine, orders] = await Promise.all([api<{ data: Client[] }>('/field-visits/my-clients'), api<{ data: Visit[] }>('/field-visits/mine'), api<{ data: ExistingOrder[] }>('/orders/mine')]);
        const currentActiveVisit = mine.data.find((visit) => visit.status !== 'checked_out') ?? null;
        setMode('rep'); setClients(assigned.data); setVisits(mine.data); setActiveVisit(currentActiveVisit); setCompletedVisit(mine.data.find((visit) => visit.status === 'checked_out') ?? null);
        setCurrentVisitOrderId(orders.data.find((order) => order.visit_id === currentActiveVisit?.id)?.id ?? null);
      } catch {
        try { const all = await api<{ data: Visit[] }>('/field-visits'); setMode('admin'); setVisits(all.data); }
        catch (error) { setMessage((error as Error).message); }
      }
    })();
    return () => { if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current); };
  }, []);

  useEffect(() => { if (!activeVisit || mode !== 'rep') { setSavedActivities([]); return; } void api<{ data: SavedActivity[] }>(`/field-visits/${activeVisit.id}/activities`).then((result) => setSavedActivities(result.data)).catch((error: unknown) => setMessage(error instanceof Error ? `Could not load saved meeting activity: ${error.message}` : 'Could not load saved meeting activity.')); }, [activeVisit?.id, mode]);
  useEffect(() => { if (!activeVisit || mode !== 'rep') { setProducts([]); return; } void api<{ data: Product[] }>('/products?status=active').then((result) => setProducts(result.data)).catch((error: unknown) => setMessage(error instanceof Error ? `Could not load products: ${error.message}` : 'Could not load products.')); }, [activeVisit?.id, mode]);

  const beginPings = (visitId: string) => {
    if (!navigator.geolocation) return;
    watchId.current = navigator.geolocation.watchPosition((position) => {
      if (Date.now() - lastPing.current < 120000) return;
      lastPing.current = Date.now();
      void api(`/field-visits/${visitId}/pings`, { method: 'POST', body: JSON.stringify({ location: { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy } }) }).catch((error: unknown) => setMessage(error instanceof Error ? `Location update failed: ${error.message}` : 'Location update failed. Check your connection and keep the visit open.'));
    }, () => undefined, { enableHighAccuracy: true, maximumAge: 30000 });
  };

  async function findNearby() {
    setWorking(true); setMessage('');
    try {
      const current = await location();
      const query = new URLSearchParams({ latitude: String(current.latitude), longitude: String(current.longitude), radiusMeters: '5000' });
      const result = await api<{ data: NearbyClient[] }>(`/field-visits/nearby?${query}`);
      setNearbyClients(result.data);
      setMessage(result.data.length ? `${result.data.length} assigned client(s) found within 5 km.` : 'No assigned clients were found within 5 km.');
    } catch (error) { setMessage((error as Error).message); } finally { setWorking(false); }
  }

  async function checkIn() {
    setWorking(true); setMessage('');
    try {
      const current = await location();
      const result = await api<{ data: Visit }>('/field-visits/check-in', { method: 'POST', body: JSON.stringify({ clientId: clientId || null, unlistedClientName: unlistedClientName || null, notes: notes || null, location: current }) });
      setActiveVisit(result.data); setCompletedVisit(null); setCurrentVisitOrderId(null); setVisits((currentVisits) => [result.data, ...currentVisits]); beginPings(result.data.id);
      setMessage('Checked in successfully. Your location is being updated while this visit is active.');
    } catch (error) { setMessage((error as Error).message); } finally { setWorking(false); }
  }

  async function checkOut() {
    if (!activeVisit) return;
    setWorking(true); setMessage('');
    try {
      const current = await location();
      const result = await api<{ data: Visit }>(`/field-visits/${activeVisit.id}/check-out`, { method: 'PATCH', body: JSON.stringify({ location: current, notes: notes || null, outcome }) });
      setVisits((currentVisits) => currentVisits.map((visit) => visit.id === result.data.id ? result.data : visit)); setCompletedVisit(result.data); setActiveVisit(null); setCurrentVisitOrderId(null);
      if (watchId.current !== null) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null; }
      setMessage('Visit checked out successfully.');
    } catch (error) { setMessage((error as Error).message); } finally { setWorking(false); }
  }

  async function saveActivity() {
    if (!activeVisit) return;
    setWorking(true); setMessage('');
    try {
      const result = await api<{ data: SavedActivity }>(`/field-visits/${activeVisit.id}/activities`, { method: 'POST', body: JSON.stringify({ ...activity, expectedQuantity: activity.expectedQuantity ? Number(activity.expectedQuantity) : null, expectedValue: activity.expectedValue ? Number(activity.expectedValue) : null }) });
      setSavedActivities((current) => [result.data, ...current]);
      setActivity({ personMet: '', designation: '', purpose: '', requirements: '', expectedQuantity: '', expectedValue: '', notes: '' });
      setMessage('Meeting activity saved successfully.');
    } catch (error) { setMessage((error as Error).message); } finally { setWorking(false); }
  }

  const lineTotal = (line: OrderLine) => { const product = products.find((item) => item.id === line.productId); const gross = Number(product?.selling_price ?? 0) * Number(line.quantity || 0); return gross - gross * Number(line.discountPercent || 0) / 100; };
  const orderTotal = orderLines.reduce((total, line) => total + lineTotal(line), 0);
  async function createOrder() {
    if (!activeVisit) return;
    setWorking(true); setMessage('');
    try {
      const result = await api<{ data: { id: string; order_number: string } }>(`/field-visits/${activeVisit.id}/orders`, { method: 'POST', body: JSON.stringify({ items: orderLines.map((line) => ({ productId: line.productId, quantity: Number(line.quantity), discountPercent: Number(line.discountPercent || 0) })), notes: orderNotes || null }) });
      setOrderLines([{ productId: '', quantity: '1', discountPercent: '0' }]); setOrderNotes('');
      setCurrentVisitOrderId(result.data.id);
      setMessage(`Order ${result.data.order_number} created successfully.`);
    } catch (error) { setMessage((error as Error).message); } finally { setWorking(false); }
  }
  async function createFollowUp() { if (!completedVisit) return; setWorking(true); setMessage(''); try { await api(`/field-visits/${completedVisit.id}/follow-ups`, { method: 'POST', body: JSON.stringify({ title: followUpTitle, dueAt: new Date(followUpDueAt).toISOString(), priority: 'normal' }) }); setFollowUpTitle(''); setFollowUpDueAt(''); setMessage('Follow-up scheduled successfully.'); } catch (error) { setMessage((error as Error).message); } finally { setWorking(false); } }
  async function createCollection() { if (!activeVisit) return; setWorking(true); setMessage(''); try { await api(`/field-visits/${activeVisit.id}/collections`, { method: 'POST', body: JSON.stringify({ amount: Number(collectionAmount), mode: collectionMode, referenceNo: collectionReference || null, saleOrderId: currentVisitOrderId }) }); setCollectionAmount(''); setCollectionReference(''); setMessage('Collection recorded successfully.'); } catch (error) { setMessage((error as Error).message); } finally { setWorking(false); } }

  const success = message.includes('successfully') || message.includes('found within') || message.includes('No assigned clients');
  return <>
    {mode === 'rep' && <section className="field-action">
      <p className="eyebrow">FIELD ACTIVITY</p><h2>{activeVisit ? 'Visit in progress' : 'Start a client visit'}</h2>
      <p>GPS is captured when you check in and check out. Keep browser location permission enabled while you are visiting.</p>
      {!activeVisit ? <div className="visit-form">
        <button className="secondary-action" disabled={working} onClick={() => void findNearby()}>Find nearby assigned clients</button>
        {nearbyClients.length > 0 && <div className="nearby-list">{nearbyClients.map((client) => <button key={client.id} type="button" onClick={() => { setClientId(client.id); setUnlistedClientName(''); }}><strong>{client.client_name}</strong><span>{client.client_code} · {client.distanceMeters} m away</span></button>)}</div>}
        <select value={clientId} onChange={(e) => { setClientId(e.target.value); setUnlistedClientName(''); }}><option value="">Select assigned client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.client_code} — {client.client_name}</option>)}</select>
        <input value={unlistedClientName} disabled={Boolean(clientId)} placeholder="Or enter unlisted client name" onChange={(e) => setUnlistedClientName(e.target.value)} />
        <textarea value={notes} placeholder="Visit notes (optional)" onChange={(e) => setNotes(e.target.value)} />
        <button disabled={working || (!clientId && !unlistedClientName)} onClick={() => void checkIn()}>{working ? 'Capturing location…' : 'Check in with location'}</button>
      </div> : <div className="visit-form">
        <p className="active-visit">Active since {new Date(activeVisit.check_in_time).toLocaleTimeString()}</p>
        <input value={activity.personMet} placeholder="Person met" onChange={(e) => setActivity({ ...activity, personMet: e.target.value })} />
        <input value={activity.designation} placeholder="Designation" onChange={(e) => setActivity({ ...activity, designation: e.target.value })} />
        <input value={activity.purpose} placeholder="Meeting purpose" onChange={(e) => setActivity({ ...activity, purpose: e.target.value })} />
        <textarea value={activity.requirements} placeholder="Client requirement / products discussed" onChange={(e) => setActivity({ ...activity, requirements: e.target.value })} />
        <div className="activity-values"><input inputMode="decimal" value={activity.expectedQuantity} placeholder="Expected quantity" onChange={(e) => setActivity({ ...activity, expectedQuantity: e.target.value })} /><input inputMode="decimal" value={activity.expectedValue} placeholder="Expected value" onChange={(e) => setActivity({ ...activity, expectedValue: e.target.value })} /></div>
        <textarea value={activity.notes} placeholder="Meeting notes" onChange={(e) => setActivity({ ...activity, notes: e.target.value })} />
        <button className="secondary-action" disabled={working || !(activity.personMet || activity.purpose || activity.requirements || activity.notes)} onClick={() => void saveActivity()}>Save meeting activity</button>
        {savedActivities.length > 0 && <div className="saved-activities"><strong>Recorded meeting activity</strong>{savedActivities.map((item) => <article key={item.id}><b>{item.person_met ?? item.purpose ?? 'Visit activity'}</b>{item.designation && <span>{item.designation}</span>}{item.requirements && <p>{item.requirements}</p>}{item.expected_value != null && <small>Expected value: {item.expected_value}</small>}</article>)}</div>}
        <div className="order-builder"><strong>Create sale order</strong>{orderLines.map((line, index) => <div className="order-line" key={index}><select value={line.productId} onChange={(e) => setOrderLines(orderLines.map((current, currentIndex) => currentIndex === index ? { ...current, productId: e.target.value } : current))}><option value="">Select product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.product_code} — {product.product_name} (₹{Number(product.selling_price).toFixed(2)})</option>)}</select><input type="number" min="0.01" step="0.01" value={line.quantity} aria-label="Quantity" onChange={(e) => setOrderLines(orderLines.map((current, currentIndex) => currentIndex === index ? { ...current, quantity: e.target.value } : current))} /><input type="number" min="0" max="100" step="0.01" value={line.discountPercent} aria-label="Discount percent" onChange={(e) => setOrderLines(orderLines.map((current, currentIndex) => currentIndex === index ? { ...current, discountPercent: e.target.value } : current))} /><span>₹{lineTotal(line).toFixed(2)}</span>{orderLines.length > 1 && <button type="button" className="text-action" onClick={() => setOrderLines(orderLines.filter((_, currentIndex) => currentIndex !== index))}>Remove</button>}</div>)}<button type="button" className="secondary-action" onClick={() => setOrderLines([...orderLines, { productId: '', quantity: '1', discountPercent: '0' }])}>Add product</button><textarea value={orderNotes} placeholder="Order notes (optional)" onChange={(e) => setOrderNotes(e.target.value)} /><div className="order-total"><strong>Order total</strong><b>₹{orderTotal.toFixed(2)}</b></div><button disabled={working || orderLines.some((line) => !line.productId || Number(line.quantity) <= 0)} onClick={() => void createOrder()}>Create confirmed order</button></div>
        <div className="order-builder"><strong>Record collection</strong>{!currentVisitOrderId && <p className="inline-help">Create an order for this active visit before recording a collection.</p>}<div className="activity-values"><input type="number" min="0.01" step="0.01" value={collectionAmount} placeholder="Amount received" onChange={(e) => setCollectionAmount(e.target.value)} /><select value={collectionMode} onChange={(e) => setCollectionMode(e.target.value)}><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="cheque">Cheque</option><option value="other">Other</option></select></div><input value={collectionReference} placeholder="Payment reference / cheque number (optional)" onChange={(e) => setCollectionReference(e.target.value)} /><button className="secondary-action" disabled={working || !currentVisitOrderId || Number(collectionAmount) <= 0} onClick={() => void createCollection()}>Record collection</button></div>
        <textarea value={notes} placeholder="Visit notes" onChange={(e) => setNotes(e.target.value)} />
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)}><option value="sale_made">Sale made</option><option value="follow_up_needed">Follow-up needed</option><option value="no_interest">No interest</option><option value="other">Other</option></select>
        <button disabled={working} onClick={() => void checkOut()}>{working ? 'Capturing location…' : 'Check out'}</button>
      </div>}
      {message && <p role="status" className={success ? 'success' : 'error'}>{message}</p>}
    </section>}
    {mode === 'rep' && completedVisit && <section className="field-action completed-follow-up">
      <p className="eyebrow">VISIT COMPLETED</p><h2>Schedule a follow-up</h2><p>Create the next action for this completed visit. Follow-ups cannot be added until after checkout.</p>
      <div className="visit-form"><input value={followUpTitle} placeholder="Next action, e.g. send quotation" onChange={(e) => setFollowUpTitle(e.target.value)} /><input type="datetime-local" value={followUpDueAt} onChange={(e) => setFollowUpDueAt(e.target.value)} /><button className="secondary-action" disabled={working || !followUpTitle || !followUpDueAt} onClick={() => void createFollowUp()}>Schedule follow-up</button></div>
    </section>}
    {mode === 'admin' && <section className="field-action admin-field-notice"><p className="eyebrow">REPRESENTATIVE WORKSPACE</p><h2>Check-in is available to Sales Representatives</h2><p>You are viewing live team activity as an administrator. To perform a GPS check-in, create a Sales Representative user, add them under Sales representatives, then sign in with that representative account.</p></section>}
    <section><div className="table-toolbar"><div><p className="eyebrow">{mode === 'admin' ? 'LIVE TRACKING' : 'MY HISTORY'}</p><h2>{mode === 'admin' ? 'Latest field visits' : 'Recent visits'}</h2></div><span className="visit-count">{visits.length} visits</span></div>
      <table><thead><tr><th>Representative</th><th>Client</th><th>Check-in</th><th>Status</th><th>Outcome</th></tr></thead><tbody>
        {visits.map((visit) => <tr key={visit.id}><td>{visit.sales_representatives?.user_profiles?.display_name ?? visit.sales_representatives?.employee_code ?? 'You'}</td><td>{visit.clients?.client_name ?? 'Unlisted client'}</td><td>{new Date(visit.check_in_time).toLocaleString()}</td><td><span className={`status-badge ${visit.status}`}>{visit.status.replace('_', ' ')}</span></td><td>{visit.outcome?.replace('_', ' ') ?? '—'}</td></tr>)}
        {!visits.length && <tr><td colSpan={5} className="empty-row">No field visits recorded yet.</td></tr>}
      </tbody></table>
    </section>
  </>;
}
