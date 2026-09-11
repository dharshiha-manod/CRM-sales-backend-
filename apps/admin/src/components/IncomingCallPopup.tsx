// NEW
// Renders nothing until a call with status "ringing" arrives over Supabase
// Realtime, then shows a popup with the matched Lead/Client (or "Potential
// lead" if the number isn't in the CRM yet). Mount this ONCE near the top of
// App.tsx so it can appear no matter which page the user is looking at.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import './MasterDataPages.css';

type RingingCall = {
  id: string;
  phone_number: string;
  direction: string;
  client_id: string | null;
  lead_id: string | null;
};

export function IncomingCallPopup() {
  const [call, setCall] = useState<RingingCall | null>(null);

  useEffect(() => {
    if (!supabase) return; // Supabase not configured — stay silent, same as the rest of the app.
    const client = supabase;
    const channel = client
      .channel('telephony_calls_incoming')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'telephony_calls' },
        (payload) => {
          const row = payload.new as RingingCall & { status?: string; direction?: string };
          if (row?.status === 'ringing' && row.direction === 'inbound') {
            setCall(row);
          }
          // Once the call moves past ringing (answered/completed/etc.) on the
          // SAME row, auto-dismiss the popup.
          if (row?.status && row.status !== 'ringing' && call && row.id === call.id) {
            setCall(null);
          }
        },
      )
      .subscribe();
    return () => { void client.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!call) return null;

  return (
    <div className="modal-backdrop" style={{ alignItems: 'flex-start', paddingTop: '48px' }}>
      <div className="master-modal detail-panel" role="alertdialog" aria-modal="true" style={{ maxWidth: '380px' }}>
        <div className="modal-heading">
          <div><p className="eyebrow">INCOMING CALL</p><h3>{call.phone_number}</h3></div>
        </div>
        <p>
          {call.client_id || call.lead_id
            ? 'This number matches an existing record in the CRM.'
            : <span className="status-badge status-new">Potential lead</span>}
        </p>
        <div className="master-actions" style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
          <button type="button" className="primary-button" onClick={() => setCall(null)}>Answer / View</button>
          <button type="button" className="quiet-button" onClick={() => setCall(null)}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}
