// Rewritten: prevent accidental duplicate sends and let the confirmation
// message actually be seen before it gets wiped by a list refresh.
//
// Previously, clicking "Send to supplier" stayed active forever — even
// right after a successful send — and the confirmation text disappeared
// almost immediately because onSent() reloaded the whole list (remounting
// this component and resetting its local state) before the person had a
// chance to read it. That combination made repeat clicks (and repeat real
// emails to the supplier) very easy to trigger by accident.
import { useState } from 'react';
import { api } from '../lib/api';

export function SendPurchaseEnquiryButton({ enquiry, onSent }: { enquiry: Record<string, unknown>; onSent: () => void }) {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  // Once this enquiry's status is already "Sent" (from a prior send, in
  // this session or a previous one), require an explicit extra click
  // before firing another real email — a plain click on "Resend" alone
  // isn't enough to accidentally re-trigger delivery.
  const [confirmingResend, setConfirmingResend] = useState(false);
  // Anything past "Draft" means this enquiry was sent at least once —
  // not just when status is literally still "Sent". Without this, moving
  // to "Supplier Responded" (or any later status) made the plain "Send to
  // supplier" button reappear, as if it had never gone out.
  // A blank status means it was never sent (sending is what sets it to
  // "Sent"), so blank must count like Draft — otherwise a brand-new enquiry
  // wrongly shows "✓ Sent" and only a Resend button.
  const alreadySent = Boolean(enquiry.status) && enquiry.status !== 'Draft' && !message;

  const send = async () => {
    setSending(true);
    setMessage(null);
    setConfirmingResend(false);
    try {
      await api(`/trading/purchase-enquiries/${enquiry.id}/send`, { method: 'POST' });
      setMessage(`Sent to ${String(enquiry.supplier_name ?? 'the supplier')}.`);
      setIsError(false);
      // Give the person a moment to actually read the confirmation before
      // the parent's reload remounts this row and clears it.
      setTimeout(() => onSent(), 1500);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not send the enquiry.');
      setIsError(true);
    } finally {
      setSending(false);
    }
  };

  const messageLine = message ? (
    <span style={{ fontSize: 12, maxWidth: 240, whiteSpace: 'normal', lineHeight: 1.3, color: isError ? '#b91c1c' : '#15803d' }}>{message}</span>
  ) : null;

  if (alreadySent && !confirmingResend) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: '#15803d', fontWeight: 600 }}>✓ Sent</span>
        <button type="button" className="quiet-button" onClick={() => setConfirmingResend(true)}>
          Resend
        </button>
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <button type="button" className="quiet-button" disabled={sending} onClick={() => void send()}>
          {sending ? 'Sending…' : confirmingResend ? 'Confirm resend' : 'Send to supplier'}
        </button>
        {confirmingResend && !sending && (
          <button type="button" className="quiet-button" onClick={() => setConfirmingResend(false)}>
            Cancel
          </button>
        )}
      </span>
      {messageLine}
    </span>
  );
}

// Bar shown above the enquiry list: emails every enquiry that has not been sent yet
// (status blank or "Draft") in one click. Used after saving several suppliers at once.
// Sends one at a time, keeps going if one fails (e.g. supplier has no email saved),
// and lists exactly which ones failed.
export function SendAllUnsentBar({ rows, onDone }: { rows: Array<Record<string, unknown>>; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: number; failed: string[] } | null>(null);
  const unsent = rows.filter((r) => (!r.status || r.status === 'Draft') && r.supplier_name);

  if (unsent.length === 0 && !result) return null;

  const sendAll = async () => {
    const names = unsent.map((r) => `${String(r.enquiry_number ?? '')} → ${String(r.supplier_name ?? '')}`).join('\n');
    if (!window.confirm(`Send ${unsent.length} enquiry email(s) now?\n\n${names}`)) return;
    setBusy(true);
    setResult(null);
    let ok = 0;
    const failed: string[] = [];
    for (const r of unsent) {
      try {
        await api(`/trading/purchase-enquiries/${r.id}/send`, { method: 'POST' });
        ok += 1;
      } catch (err) {
        failed.push(`${String(r.enquiry_number ?? '')} (${String(r.supplier_name ?? '')}): ${err instanceof Error ? err.message : 'failed'}`);
      }
    }
    setBusy(false);
    setResult({ ok, failed });
    onDone();
  };

  return (
    <div style={{ margin: '12px 0', padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: 10, background: '#f8fafc', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
      {unsent.length > 0 && (
        <>
          <span style={{ fontSize: 13 }}>{unsent.length} enquiry(ies) not sent yet</span>
          <button type="button" className="primary-action" disabled={busy} onClick={() => void sendAll()}>
            {busy ? 'Sending…' : `Send all unsent (${unsent.length})`}
          </button>
        </>
      )}
      {result && (
        <span style={{ fontSize: 12, lineHeight: 1.4, color: result.failed.length ? '#b91c1c' : '#15803d' }}>
          Sent {result.ok}.{result.failed.length ? ` Failed: ${result.failed.join('; ')}` : ''}
        </span>
      )}
    </div>
  );
}