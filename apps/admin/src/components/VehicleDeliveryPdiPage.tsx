import { useEffect, useState } from 'react';
import { VehicleMasterPage, VehicleModuleConfig } from './VehicleMasterPage';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useIndustryScope } from '../industry/useIndustryScope';
import { HandoverData, openHandoverNote } from '../lib/vehicleHandover';
import { orderPicker } from '../lib/vehicleOrderFill';
import { queueVehicleDraft } from '../lib/vehicleDraftHandoff';
import { openRecord } from '../lib/recordFocus';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const UNAVAILABLE_UNIT = ['Delivered', 'Sold', 'Damaged', 'Returned', 'Under Service', 'In Transit'];
const isClosed = (r: { status?: unknown }) => r.status === 'Delivered' || r.status === 'Cancelled';
const STATUSES = ['Preparation', 'PDI Pending', 'Documentation Pending', 'Payment Pending', 'Ready for Delivery', 'Delivered', 'Cancelled'];

const config: VehicleModuleConfig = {
  resource: '/vehicle/deliveries',
  eyebrowModule: 'VEHICLE DELIVERY / PDI',
  title: 'Vehicle delivery / PDI',
  description: 'Pre-delivery inspection and handover. A vehicle only becomes Ready for Delivery once PDI, documentation, registration/insurance (where applicable) and required payment are all complete. Delivery marks the VIN as Delivered, completes the Core order, opens the registration file and starts the warranty. Insurance must be Complete (or Not Applicable) and accessories Fitted (or Not Applicable). A failed PDI or a cancelled delivery needs its reason in Remarks. The customer is messaged when the vehicle is ready and when it is delivered.',
  icon: '▣',
  emptyIcon: '▣',
  codeField: 'delivery_number',
  nameField: 'client_name',
  statusOptions: STATUSES,
  searchableKeys: ['delivery_number', 'client_name', 'vin', 'engine_number', 'order_number', 'booking_number', 'dealer_name', 'sales_rep'],
  fields: [
    { key: 'delivery_number', label: 'Delivery number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'DLV' },
    { key: 'client_name', label: 'Client', type: 'text', required: true, listColumn: true },
    { key: 'client_id', label: 'Client (pick to link)', type: 'lookup', group: 'Link', lookupResource: '/clients', lookupLabelKey: 'client_name', autoFillMap: { client_name: 'client_name' } },
    { key: 'order_id', label: 'Core order', type: 'lookup', group: 'Link', ...orderPicker({ vin: 'vin' }), autoFillMap: { order_number: 'order_number' } },
    { key: 'order_number', label: 'Order number (auto-filled)', type: 'text', readOnly: true, group: 'Link' },
    { key: 'booking_number', label: 'Booking number (auto-linked)', type: 'text', readOnly: true, group: 'Link' },
    {
      key: 'vin', label: 'VIN', type: 'lookup', listColumn: true, group: 'Vehicle', lookupResource: '/vehicle/units', lookupLabelKey: 'vin', lookupSecondaryLabelKey: 'model_name', lookupValueKey: 'vin',
      lookupFilter: (o) => !UNAVAILABLE_UNIT.includes(String(o.status ?? '')),
      autoFillMap: { engine_number: 'engine_number' },
      helpText: 'Only vehicles that can still be delivered are listed (not Delivered, Sold, Damaged, Returned, Under Service or In Transit). One vehicle can be on one open delivery only.',
    },
    { key: 'engine_number', label: 'Engine number', type: 'text', group: 'Vehicle' },
    { key: 'sales_order_reference', label: 'Sales order reference (Core Orders)', type: 'text', group: 'Vehicle' },
    // no Dealer picker: the buyer is the client. A dealer saved earlier is only shown, never asked for.
    { key: 'dealer_name', label: 'Dealer', type: 'text', readOnly: true, group: 'Vehicle', visibleIf: (f) => Boolean(f.dealer_name) },
    { key: 'sales_rep', label: 'Sales representative', type: 'text', group: 'Schedule' },
    { key: 'delivery_date', label: 'Delivery date', type: 'date', listColumn: true, group: 'Schedule', helpText: 'Planned handover date. It becomes today\u2019s date automatically when the vehicle is marked Delivered early.' },
    { key: 'delivery_location', label: 'Delivery location', type: 'text', group: 'Schedule' },
    { key: 'odometer', label: 'Odometer', type: 'number', group: 'Handover' },
    { key: 'fuel_level', label: 'Fuel / battery level', type: 'text', group: 'Handover' },
    { key: 'pdi_status', label: 'PDI status', type: 'select', options: ['Not Started', 'In Progress', 'Passed', 'Failed'], listColumn: true, group: 'Readiness', helpText: 'Failed needs the reason in Remarks.' },
    { key: 'documentation_status', label: 'Documentation status', type: 'select', options: ['Pending', 'Complete'], group: 'Readiness', helpText: 'Follows the Documents checklist by itself once a checklist exists (use the Documents button on the row).' },
    { key: 'payment_status', label: 'Payment status', type: 'select', options: ['Pending', 'Complete'], group: 'Readiness' },
    { key: 'registration_status', label: 'Registration status', type: 'select', options: ['Pending', 'Complete', 'Not Applicable'], group: 'Readiness' },
    { key: 'insurance_status', label: 'Insurance status', type: 'select', options: ['Pending', 'Complete', 'Not Applicable'], group: 'Readiness' },
    { key: 'accessories_status', label: 'Accessories status', type: 'select', options: ['Pending', 'Fitted', 'Not Applicable'], group: 'Readiness', helpText: 'Must be Fitted or Not Applicable before the vehicle can be Delivered.' },
    { key: 'customer_acknowledgement', label: 'Customer acknowledgement', type: 'select', options: ['Yes', 'No'], group: 'Readiness', helpText: 'The customer must acknowledge the handover before Delivered.' },
    { key: 'remarks', label: 'Remarks (reason if PDI Failed / Cancelled)', type: 'textarea', group: 'Readiness' },
    { key: 'status', label: 'Delivery status', type: 'select', options: STATUSES, listColumn: true, group: 'Readiness' },
  ],
  kpis: [
    { icon: '▣', iconClass: 'kpi-icon-ink', label: 'Total deliveries', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'PDI / docs pending', value: (r) => String(r.filter((x) => x.status === 'PDI Pending' || x.status === 'Documentation Pending').length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Ready for delivery', value: (r) => String(r.filter((x) => x.status === 'Ready for Delivery').length) },
     { icon: '↗', iconClass: 'kpi-icon-school', label: 'Delivered', value: (r) => String(r.filter((x) => x.status === 'Delivered').length) },
    { icon: '₹', iconClass: 'kpi-icon-amber', label: 'Payment pending', value: (r) => String(r.filter((x) => !isClosed(x) && x.payment_status !== 'Complete').length) },
    { icon: '!', iconClass: 'kpi-icon-ink', label: 'PDI failed', value: (r) => String(r.filter((x) => !isClosed(x) && x.pdi_status === 'Failed').length) },
    { icon: '⏰', iconClass: 'kpi-icon-amber', label: 'Overdue', value: (r) => String(r.filter((x) => !isClosed(x) && typeof x.delivery_date === 'string' && x.delivery_date.slice(0, 10) < today()).length) },
  ],
  sampleRecords: [],
};
function HandoverButton({ id }: { id: string }) {
  const { activeIndustryTypeId } = useIndustryScope();
  return (
    <button
      type="button"
      className="quiet-button"
      onClick={async () => {
        try {
          const q = activeIndustryTypeId ? `?industryTypeId=${activeIndustryTypeId}` : '';
          const res = await api<{ data: HandoverData }>(`/vehicle/deliveries/${id}/handover${q}`);
          openHandoverNote(res.data);
        } catch (e) { window.alert(e instanceof Error ? e.message : 'Could not open the handover note'); }
      }}
    >Handover note</button>
  );
}

function PdiButtons({ r }: { r: Record<string, unknown> }) {
  const { activeIndustryTypeId } = useIndustryScope();
  const [busy, setBusy] = useState(false);
  if (isClosed(r) || typeof r.id !== 'string') return null;
  const id = r.id;
  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const q = activeIndustryTypeId ? `?industryTypeId=${activeIndustryTypeId}` : '';
      await api(`/vehicle/deliveries/${id}${q}`, { method: 'PATCH', body: JSON.stringify(body) });
      window.location.reload();
    } catch (e) { window.alert(e instanceof Error ? e.message : 'Could not update the delivery'); setBusy(false); }
  };
  const pass = () => { if (window.confirm('Mark PDI as Passed for this vehicle?')) void send({ pdi_status: 'Passed' }); };
  const fail = () => {
    const reason = window.prompt('Why did the PDI fail? (saved in Remarks)');
    if (reason && reason.trim()) void send({ pdi_status: 'Failed', remarks: reason.trim() });
  };
  // The vehicle may already have an insurance file (e.g. opened by the scheme's free insurance): open THAT policy; only start a new one when there is none.
  const addInsurance = async () => {
    try {
      const res = await api<{ data: Record<string, unknown>[] }>('/vehicle/insurance-policies');
      const p = (res.data ?? []).filter((x) => x.vin === r.vin && x.status !== 'Cancelled').sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0];
      if (p && p.policy_number) { openRecord('industry:vehicle:insurance', { resource: '/vehicle/insurance-policies', field: 'policy_number', value: String(p.policy_number) }); return; }
    } catch { /* fall through to a new policy */ }
    queueVehicleDraft('insurance', { vin: String(r.vin ?? ''), ...(r.client_id ? { client_id: String(r.client_id) } : {}), client_name: String(r.client_name ?? ''), policy_type: 'Comprehensive' });
  };
  const deliver = () => {
    if (window.confirm('Customer has acknowledged the handover and the vehicle is being delivered now?')) void send({ customer_acknowledgement: 'Yes', status: 'Delivered' });
  };
  return (
    <>
      {r.pdi_status !== 'Passed' && r.vin ? <button type="button" className="quiet-button" style={{ padding: '4px 10px', fontSize: 12 }} disabled={busy} onClick={pass}>PDI passed</button> : null}
      {r.pdi_status !== 'Passed' && r.pdi_status !== 'Failed' && r.vin ? <button type="button" className="quiet-button" style={{ padding: '4px 10px', fontSize: 12 }} disabled={busy} onClick={fail}>PDI failed</button> : null}
      {r.vin && r.insurance_status === 'Pending' ? <button type="button" className="quiet-button" style={{ padding: '4px 10px', fontSize: 12 }} disabled={busy} onClick={() => void addInsurance()} title="Open this vehicle's insurance (or add one if it has none)">Insurance</button> : null}
      {r.status === 'Ready for Delivery' ? <button type="button" className="quiet-button" style={{ padding: '4px 10px', fontSize: 12 }} disabled={busy} onClick={deliver}>Deliver</button> : null}
    </>
  );
}

// What is still missing before this vehicle can be handed over, at a glance.
function ReadinessChips({ r }: { r: Record<string, unknown> }) {
  if (r.status === 'Cancelled') return null;
  const docs = Array.isArray(r.document_checklist) ? (r.document_checklist as DeliveryDoc[]) : [];
  const docsDone = docs.length ? docs.every((d) => d.status !== 'Pending') : r.documentation_status === 'Complete';
  const ok = (v: boolean) => (v ? '\u2713' : '\u2717');
  const okOrNa = (v: unknown, good: string[]) => good.includes(String(v ?? ''));
  const items: [string, boolean][] = [
    ['PDI', r.pdi_status === 'Passed'],
    ['Docs', docsDone],
    ['Pay', r.payment_status === 'Complete'],
    ['Ins', okOrNa(r.insurance_status, ['Complete', 'Not Applicable'])],
    ['Acc', okOrNa(r.accessories_status, ['Fitted', 'Not Applicable'])],
    ['Ack', r.customer_acknowledgement === 'Yes'],
  ];
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', fontSize: 11 }} title="PDI, documents, payment, insurance, accessories, customer acknowledgement">
      {items.map(([label, done]) => (
        <span key={label} style={{ borderRadius: 999, padding: '1px 7px', background: done ? '#dcfce7' : '#fef3c7', color: done ? '#166534' : '#92400e', whiteSpace: 'nowrap' }}>{label} {ok(done)}</span>
      ))}
    </span>
  );
}

type DocStatus = 'Pending' | 'Received' | 'Not Applicable';
type DeliveryDoc = { name: string; status: DocStatus; received_date: string | null; remarks: string | null; file_path?: string | null; file_name?: string | null; uploaded_at?: string | null };
type DocsResponse = { data: { delivery_number: string; client_name: string; status: string; locked: boolean; saved: boolean; documents: DeliveryDoc[] } };
const DOC_STATUS_OPTIONS: DocStatus[] = ['Pending', 'Received', 'Not Applicable'];
const NO_FILE = { file_path: null, file_name: null, uploaded_at: null };

function DocumentsModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { activeIndustryTypeId } = useIndustryScope();
  const query = activeIndustryTypeId ? `?industryTypeId=${activeIndustryTypeId}` : '';
  const [info, setInfo] = useState<DocsResponse['data'] | null>(null);
  const [docs, setDocs] = useState<DeliveryDoc[]>([]);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // name of the document being uploaded
  const [changed, setChanged] = useState(false);
  const [openName, setOpenName] = useState<string | null>(null); // only one document is open at a time
  const [previews, setPreviews] = useState<Record<string, string>>({});

  useEffect(() => {
    api<DocsResponse>(`/vehicle/deliveries/${id}/documents${query}`)
      .then((res) => { setInfo(res.data); setDocs(res.data.documents); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the documents'));
  }, [id, query]);

  const update = (index: number, change: Partial<DeliveryDoc>) => setDocs((list) => list.map((d, i) => (i === index ? { ...d, ...change } : d)));
  const setStatus = (index: number, status: DocStatus) => update(index, { status, received_date: status === 'Received' ? (docs[index]?.received_date ?? today()) : null });
  const addDoc = () => {
    const name = newName.trim();
    if (!name) return;
    if (docs.some((d) => d.name.toLowerCase() === name.toLowerCase())) { setError(`"${name}" is already in the list.`); return; }
    setError(''); setDocs((list) => [...list, { name, status: 'Pending', received_date: null, remarks: null, ...NO_FILE }]); setNewName('');
  };
  const closeModal = () => { if (changed) window.location.reload(); else onClose(); };
  const save = async () => {
    setSaving(true); setError('');
    try {
      await api(`/vehicle/deliveries/${id}/documents${query}`, { method: 'PUT', body: JSON.stringify({ documents: docs }) });
      window.location.reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the documents'); setSaving(false); }
  };

  // Upload: the API approves the file, the browser sends it to private storage, then the list is saved straight away.
  const upload = async (index: number, file: File) => {
    const target = docs[index];
    if (!target) return;
    setBusy(target.name); setError('');
    try {
      if (!supabase) throw new Error('File storage is not configured for this environment.');
      const ticket = await api<{ data: { bucket: string; path: string; token: string } }>(`/vehicle/deliveries/${id}/documents/upload-url${query}`, {
        method: 'POST', body: JSON.stringify({ name: target.name, contentType: file.type, size: file.size }),
      });
      const { error: uploadError } = await supabase.storage.from(ticket.data.bucket).uploadToSignedUrl(ticket.data.path, ticket.data.token, file, { contentType: file.type });
      if (uploadError) throw uploadError;
      const next = docs.map((d, i) => (i === index ? { ...d, status: 'Received' as DocStatus, received_date: d.received_date ?? today(), file_path: ticket.data.path, file_name: file.name.slice(0, 120), uploaded_at: new Date().toISOString() } : d));
      await api(`/vehicle/deliveries/${id}/documents${query}`, { method: 'PUT', body: JSON.stringify({ documents: next }) });
      setDocs(next); setChanged(true); setOpenName(target.name); loadPreview(ticket.data.path);
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed'); }
    setBusy(null);
  };
  const fileUrl = (path: string) => api<{ data: { url: string } }>(`/vehicle/deliveries/${id}/documents/file${query ? `${query}&` : '?'}path=${encodeURIComponent(path)}`);
  const loadPreview = (path: string) => {
    if (!/\.(jpe?g|png|webp)$/i.test(path) || previews[path]) return; // photos get a small preview; PDFs open with View file
    fileUrl(path).then((res) => setPreviews((p) => ({ ...p, [path]: res.data.url }))).catch(() => undefined);
  };
  const toggle = (d: DeliveryDoc) => {
    const opening = openName !== d.name;
    setOpenName(opening ? d.name : null);
    if (opening && d.file_path) loadPreview(d.file_path);
  };
  const view = async (path: string) => {
    const tab = window.open('', '_blank'); // opened first so a phone browser does not block it
    try {
      const res = await fileUrl(path);
      if (tab) tab.location.href = res.data.url; else window.location.href = res.data.url;
    } catch (e) { tab?.close(); setError(e instanceof Error ? e.message : 'Could not open the file'); }
  };

  const received = docs.filter((d) => d.status !== 'Pending').length;
  const locked = info?.locked ?? true;
  const field = { padding: '6px 8px', border: '1px solid #d6d3cc', borderRadius: 6, font: 'inherit', background: '#fff' } as const;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }} onClick={closeModal}>
      <div style={{ background: '#fff', borderRadius: 12, width: 'min(680px, 100%)', maxHeight: '92vh', overflow: 'auto', padding: 16 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: 1, color: '#78746b' }}>DELIVERY DOCUMENTS</div>
            <h3 style={{ margin: '4px 0 0' }}>{info ? `${info.delivery_number} · ${info.client_name}` : 'Loading...'}</h3>
            {info && <div style={{ marginTop: 4, color: '#57534e' }}>{received} of {docs.length} documents ready{docs.length > 0 && received === docs.length ? ' - documentation will be Complete' : ''}</div>}
          </div>
          <button type="button" className="quiet-button" onClick={closeModal}>Close</button>
        </div>
        {info && !info.saved && !locked && <div style={{ background: '#fef3c7', padding: 8, borderRadius: 6, marginBottom: 10 }}>This is the standard list for this customer. Change it if needed, then Save.</div>}
        {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 8, borderRadius: 6, marginBottom: 10 }}>{error}</div>}
        {docs.map((d, i) => {
          const open = openName === d.name;
          const chip = d.status === 'Received' ? { bg: '#dcfce7', fg: '#166534' } : d.status === 'Not Applicable' ? { bg: '#e7e5e4', fg: '#57534e' } : { bg: '#fef3c7', fg: '#92400e' };
          return (
            <div key={d.name} style={{ borderBottom: '1px solid #eee' }}>
              <div role="button" tabIndex={0} onClick={() => toggle(d)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(d); } }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 2px', cursor: 'pointer' }}>
                <span style={{ width: 14, color: '#78746b' }}>{open ? '▾' : '▸'}</span>
                <span style={{ flex: 1, fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{d.name}</span>
                {d.file_path && <span title="File uploaded">📎</span>}
                <span style={{ background: chip.bg, color: chip.fg, borderRadius: 999, padding: '2px 10px', fontSize: 12, whiteSpace: 'nowrap' }}>{d.status}</span>
              </div>
              {open && (
                <div style={{ padding: '0 2px 12px 22px' }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <select style={field} value={d.status} disabled={locked} onChange={(e) => setStatus(i, e.target.value as DocStatus)}>
                      {DOC_STATUS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                    {d.status === 'Received' && <span style={{ fontSize: 12, color: '#57534e' }}>Received on {d.received_date}</span>}
                  </div>
                  {d.file_path && previews[d.file_path] && (
                    <img src={previews[d.file_path]} alt={d.name} style={{ display: 'block', marginTop: 8, maxWidth: '100%', maxHeight: 180, borderRadius: 6, border: '1px solid #e7e5e4' }} />
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
                    {d.file_path ? (
                      <>
                        <button type="button" className="quiet-button" onClick={() => view(d.file_path as string)}>View file</button>
                        <span style={{ fontSize: 12, color: '#57534e', overflowWrap: 'anywhere' }}>{d.file_name ?? 'uploaded file'}</span>
                      </>
                    ) : <span style={{ fontSize: 12, color: '#78746b' }}>No file uploaded</span>}
                  </div>
                  {!locked && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
                      <label className="quiet-button" style={{ cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1, display: 'inline-flex', alignItems: 'center' }}>
                        {busy === d.name ? 'Uploading...' : d.file_path ? 'Replace file' : 'Upload / take photo'}
                        <input type="file" accept="image/*,application/pdf" disabled={!!busy} style={{ display: 'none' }}
                          onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void upload(i, file); }} />
                      </label>
                      {d.file_path && <button type="button" className="quiet-button" disabled={!!busy} onClick={() => update(i, { status: 'Pending', received_date: null, ...NO_FILE })}>Remove file</button>}
                      <button type="button" className="quiet-button" disabled={!!busy} onClick={() => setDocs((list) => list.filter((_, n) => n !== i))}>Remove document</button>
                    </div>
                  )}
                  <input style={{ ...field, width: '100%', marginTop: 8, fontSize: 12 }} placeholder="Remarks (optional)" value={d.remarks ?? ''} disabled={locked} onChange={(e) => update(i, { remarks: e.target.value })} />
                </div>
              )}
            </div>
          );
        })}
        {!locked && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input style={{ ...field, flex: 1, minWidth: 0 }} placeholder="Add another document" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addDoc(); }} />
            <button type="button" className="quiet-button" onClick={addDoc}>Add</button>
          </div>
        )}
        {locked && info && <div style={{ marginTop: 12, color: '#57534e' }}>This delivery is {info.status.toLowerCase()}, so the documents are read only.</div>}
        {!locked && info && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="button" className="primary-action" disabled={saving || !!busy} onClick={save}>{saving ? 'Saving...' : 'Save documents'}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function DocumentsButton({ id, list }: { id: string; list: unknown }) {
  const [open, setOpen] = useState(false);
  const docs = Array.isArray(list) ? (list as DeliveryDoc[]) : [];
  const done = docs.filter((d) => d.status !== 'Pending').length;
  return (
    <>
      <button type="button" className="quiet-button" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setOpen(true)}>{docs.length ? `Documents ${done}/${docs.length}` : 'Documents'}</button>
      {open && <DocumentsModal id={id} onClose={() => setOpen(false)} />}
    </>
  );
}

export function VehicleDeliveryPdiPage() {
  return <VehicleMasterPage config={{ ...config, fitToScreen: true, inlineActions: (r) => (typeof r.id === 'string' && !r.id.startsWith('demo-') ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start', minWidth: 0, maxWidth: 260 }}>
      <ReadinessChips r={r} />
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <DocumentsButton id={r.id} list={r.document_checklist} />
        <PdiButtons r={r} />
      </div>
    </div>
  ) : null), rowActions: (r) => (typeof r.id === 'string' && !r.id.startsWith('demo-') ? <HandoverButton id={r.id} /> : null) }} />;
}