// FILE: admin/src/components/FmcgExportPanel.tsx
// Export details for an International client's order: incoterm, ports and the document checklist.
// Rendered by OrdersPage only when the order's client is outside India (FMCG); nothing else mounts it.
import { useState } from 'react';
import { api } from '../lib/api';

const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];
const DOCS: Array<[string, string]> = [
  ['commercial_invoice', 'Commercial invoice'], ['packing_list', 'Packing list'], ['bill_of_lading', 'Bill of lading / airway bill'],
  ['certificate_of_origin', 'Certificate of origin'], ['health_certificate', 'Health / FSSAI export certificate'],
  ['shipping_bill', 'Shipping bill'], ['insurance_certificate', 'Insurance certificate'],
];

export type ExportOrder = { id: string; incoterm?: string | null; port_of_loading?: string | null; port_of_discharge?: string | null; export_docs?: Record<string, boolean> | null };
type Saved = Pick<ExportOrder, 'incoterm' | 'port_of_loading' | 'port_of_discharge' | 'export_docs'>;

export function FmcgExportPanel({ order, onSaved }: { order: ExportOrder; onSaved: (saved: Saved) => void }) {
  const [incoterm, setIncoterm] = useState(order.incoterm ?? '');
  const [loading, setLoading] = useState(order.port_of_loading ?? '');
  const [discharge, setDischarge] = useState(order.port_of_discharge ?? '');
  const [docs, setDocs] = useState<Record<string, boolean>>(order.export_docs ?? {});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const done = DOCS.filter(([key]) => docs[key]).length;

  async function save() {
    setSaving(true); setMessage('');
    try {
      const res = await api<{ data: Saved }>(`/orders/${order.id}/export-details`, { method: 'PATCH', body: JSON.stringify({ incoterm: incoterm || null, portOfLoading: loading || null, portOfDischarge: discharge || null, exportDocs: docs }) });
      onSaved(res.data);
      setMessage('Export details saved.');
    } catch (err) { setMessage((err as Error).message); } finally { setSaving(false); }
  }

  return (
    <div className="qd-panel">
      <div className="qd-panel-head">
        <span>Export details (international)</span>
        <span className={`qd-pill ${done === DOCS.length ? 'ok' : 'warn'}`}>{done}/{DOCS.length} documents ready</span>
      </div>
      <div className="master-modal-form" style={{ padding: 0 }}>
        <label>Incoterm
          <select value={incoterm} onChange={(e) => setIncoterm(e.target.value)}>
            <option value="">Not set</option>
            {INCOTERMS.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        </label>
        <label>Port of loading<input value={loading} onChange={(e) => setLoading(e.target.value)} placeholder="e.g. Chennai (INMAA)" /></label>
        <label>Port of discharge<input value={discharge} onChange={(e) => setDischarge(e.target.value)} placeholder="e.g. Jebel Ali (AEJEA)" /></label>
      </div>
      <div style={{ display: 'grid', gap: 6, margin: '12px 0' }}>
        {DOCS.map(([key, label]) => (
          <label key={key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={!!docs[key]} onChange={(e) => setDocs({ ...docs, [key]: e.target.checked })} />
            {label}
          </label>
        ))}
      </div>
      {message && <p className={message.includes('saved') ? 'success-message' : 'error-message'}>{message}</p>}
      <button className="primary-action" type="button" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save export details'}</button>
    </div>
  );
}