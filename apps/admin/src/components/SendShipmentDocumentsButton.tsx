// "Send documents": emails a shipment's VERIFIED documents (Commercial Invoice, Packing List, Bill of Lading ...)
// to the customer. Leave the address empty to use the email saved on the customer; type one to send somewhere else
// (the customer's bank, the shipping line ...). Only Verified documents are ever sent - the server enforces it.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';

type SendResult = { sent_to: string[]; documents: string[] };

export const SEND_SHIPMENT_DOCS_EVENT = 'send-shipment-documents';

// Item for the list's ⋮ menu. It only asks the page to open the dialog: the menu closes on any outside click,
// so the dialog itself must not live inside it.
export function SendShipmentDocumentsMenuItem({ shipment }: { shipment: Record<string, unknown> }) {
  return (
    <button
      type="button"
      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, borderRadius: 4, whiteSpace: 'nowrap' }}
      onClick={() => window.dispatchEvent(new CustomEvent(SEND_SHIPMENT_DOCS_EVENT, { detail: shipment }))}
    >
      ✉ Send documents
    </button>
  );
}

export function SendShipmentDocumentsButton({ shipment, autoOpen = false, onClose }: { shipment: Record<string, unknown>; autoOpen?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(autoOpen);
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [noEmail, setNoEmail] = useState(false);

  // When the dialog opens, fill the box with the customer's saved email (deal's customer first, then by name).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLookingUp(true);
    setNoEmail(false);
    void Promise.all([
      api<{ data: Array<Record<string, unknown>> }>('/trading/deals'),
      api<{ data: Array<Record<string, unknown>> }>('/clients'),
    ])
      .then(([deals, clients]) => {
        if (cancelled) return;
        const deal = (deals.data ?? []).find((d) => d.deal_number === shipment.deal_number);
        const list = clients.data ?? [];
        const hasEmail = (c: Record<string, unknown>) => String(c.email ?? '').trim() !== '';
        const name = String(shipment.customer_name ?? '').trim().toLowerCase();
        const client =
          (deal?.customer_id ? list.find((c) => String(c.id) === String(deal.customer_id) && hasEmail(c)) : undefined) ??
          list.find((c) => String(c.client_name ?? '').trim().toLowerCase() === name && hasEmail(c));
        const email = client ? String(client.email).trim() : '';
        if (email) setTo((prev) => prev || email);
        else setNoEmail(true);
      })
      .catch(() => { /* leave the box empty; the server still falls back to the customer's saved email */ })
      .finally(() => { if (!cancelled) setLookingUp(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
        if (sending) return;
    setOpen(false);
    onClose?.();
    setError(null);
    setResult(null);
    setTo('');
    setNote('');
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await api<{ data: SendResult }>(`/trading/shipments/${String(shipment.id)}/send-documents`, {
        method: 'POST',
        body: JSON.stringify({ to: to.trim(), message: note.trim() }),
      });
      setResult(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the documents.');
    } finally {
      setSending(false);
    }
  };


  const label = { display: 'grid', gap: 6, fontSize: 13, fontWeight: 600, color: '#334155' } as const;
  const box = { padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: 8, font: 'inherit', fontWeight: 400, background: '#fff', width: '100%', boxSizing: 'border-box' } as const;
  const summaryRow = { display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 13, padding: '4px 0' } as const;

  const dialog = (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div role="dialog" aria-modal="true" style={{ width: '100%', maxWidth: 480, background: '#fff', borderRadius: 14, boxShadow: '0 20px 50px rgba(15,23,42,0.3)', overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: '#64748b' }}>SHIPMENT DOCUMENTS</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>{result ? 'Documents sent' : 'Send documents by email'}</div>
          </div>
          <button type="button" aria-label="Close" onClick={close} style={{ border: 'none', background: 'transparent', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#64748b' }}>×</button>
        </div>

        {result ? (
          <div style={{ padding: 22, display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 14, borderRadius: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534' }}>
              <span style={{ fontSize: 20, lineHeight: 1 }}>✓</span>
              <span style={{ fontSize: 14, lineHeight: 1.45 }}>
                <strong>{result.documents.length}</strong> document(s) sent to <strong>{result.sent_to.join(', ')}</strong>.
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="primary-action" onClick={close}>Close</button>
            </div>
          </div>
        ) : (
          <div style={{ padding: 22, display: 'grid', gap: 16 }}>
            <div style={{ padding: '10px 14px', borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
              <div style={summaryRow}><span style={{ color: '#64748b' }}>Shipment</span><strong>{String(shipment.shipment_number ?? '—')}</strong></div>
              <div style={summaryRow}><span style={{ color: '#64748b' }}>Customer</span><strong>{String(shipment.customer_name ?? '—')}</strong></div>
              <div style={summaryRow}><span style={{ color: '#64748b' }}>Product</span><strong>{String(shipment.product_name ?? '—')}</strong></div>
            </div>
            <label style={label}>
              Send to (email)
              <input style={box} type="text" value={to} onChange={(e) => setTo(e.target.value)} placeholder={lookingUp ? 'Looking up customer email…' : 'Type the email address'} autoFocus />
              {noEmail && !to.trim()
                ? <small style={{ fontWeight: 400, color: '#b45309' }}>No email is saved for this customer. Type one here, or add it on the customer record.</small>
                : <small style={{ fontWeight: 400, color: '#64748b' }}>Auto-filled from the customer record. You can change it. Separate several addresses with commas.</small>}
            </label>
            <label style={label}>
              Message (optional)
              <textarea style={{ ...box, minHeight: 80, resize: 'vertical' }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Please find the shipping documents below." />
            </label>
            <small style={{ color: '#64748b' }}>Only Verified documents are sent, as secure download links.</small>
            {error && <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 13, lineHeight: 1.4 }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="quiet-button" disabled={sending} onClick={close}>Cancel</button>
              <button type="button" className="primary-action" disabled={sending} onClick={() => void send()}>{sending ? 'Sending…' : 'Send documents'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>      {!autoOpen && <button type="button" className="quiet-button" onClick={() => setOpen(true)}>Send documents</button>}
      {open && createPortal(dialog, document.body)}
    </>
  );
}