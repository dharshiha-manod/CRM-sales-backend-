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
  const alreadySent = enquiry.status !== 'Draft' && !message;

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
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button type="button" className="quiet-button" disabled={sending} onClick={() => void send()}>
        {sending ? 'Sending…' : confirmingResend ? 'Confirm resend' : 'Send to supplier'}
      </button>
      {confirmingResend && !sending && (
        <button type="button" className="quiet-button" onClick={() => setConfirmingResend(false)}>
          Cancel
        </button>
      )}
      {message && <span style={{ fontSize: 12, color: isError ? '#b91c1c' : '#15803d' }}>{message}</span>}
    </span>
  );
}