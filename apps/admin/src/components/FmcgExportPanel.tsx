// FILE: admin/src/components/FmcgExportPanel.tsx
// Trade terms (incoterm + ports) of an International client's order, plus a read-only paperwork status per shipment.
// The document checklist now lives in Trade Documents; the proof is the verified file, not a tick box.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];

export type ExportOrder = { id: string; incoterm?: string | null; port_of_loading?: string | null; port_of_discharge?: string | null; export_docs?: Record<string, boolean> | null };
type Saved = Pick<ExportOrder, 'incoterm' | 'port_of_loading' | 'port_of_discharge' | 'export_docs'>;
type Paper = { order_id: string; shipment_no: string; status: string; paperwork: { docs_verified: number; docs_required: number; customs: string } | null };

export function FmcgExportPanel({ order, onSaved }: { order: ExportOrder; onSaved: (saved: Saved) => void }) {
  const [incoterm, setIncoterm] = useState(order.incoterm ?? '');
  const [loading, setLoading] = useState(order.port_of_loading ?? '');
  const [discharge, setDischarge] = useState(order.port_of_discharge ?? '');
  const [shipments, setShipments] = useState<Paper[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const complete = Boolean(incoterm && loading.trim() && discharge.trim());
  const dirty = incoterm !== (order.incoterm ?? '') || loading !== (order.port_of_loading ?? '') || discharge !== (order.port_of_discharge ?? '');

  useEffect(() => {
    let live = true;
    api<{ data: Paper[] }>('/fmcg/shipments')
      .then((res) => { if (live) setShipments(res.data.filter((s) => s.order_id === order.id && s.status !== 'cancelled')); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [order.id]);

  async function save() {
    setSaving(true); setMessage('');
    try {
      const res = await api<{ data: Saved }>(`/orders/${order.id}/export-details`, { method: 'PATCH', body: JSON.stringify({ incoterm: incoterm || null, portOfLoading: loading.trim() || null, portOfDischarge: discharge.trim() || null }) });
      onSaved(res.data);
      setMessage('Trade terms saved.');
    } catch (err) { setMessage((err as Error).message); } finally { setSaving(false); }
  }

  return (
    <div className="qd-panel">
      <div className="qd-panel-head">
        <span>Trade terms (international)</span>
        <span className={`qd-pill ${complete ? 'ok' : 'warn'}`}>{complete ? 'Complete' : 'Incoterm and ports needed before dispatch'}</span>
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
      {shipments.length > 0 && (
        <div style={{ display: 'grid', gap: 6, margin: '12px 0' }}>
          {shipments.map((s) => (
            <div key={s.shipment_no} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <a href="#industry:fmcg:shipment"><strong>{s.shipment_no}</strong></a>
              {s.paperwork ? (
                <>
                  <a className={`qd-pill ${s.paperwork.docs_verified >= s.paperwork.docs_required ? 'ok' : 'warn'}`} href="#industry:fmcg:trade-documents">Documents {s.paperwork.docs_verified}/{s.paperwork.docs_required} verified</a>
                  <a className={`qd-pill ${s.paperwork.customs === 'Cleared' ? 'ok' : 'warn'}`} href="#industry:fmcg:customs-clearance">Customs: {s.paperwork.customs}</a>
                </>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {message && <p className={message.includes('saved') ? 'success-message' : 'error-message'}>{message}</p>}
      <button className="primary-action" type="button" onClick={() => void save()} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save trade terms'}</button>
    </div>
  );
}