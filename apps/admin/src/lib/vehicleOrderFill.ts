// Vehicle only: shared behaviour of the "Core order" picker on Returns / Finance / Exchange / Delivery.
//  - the picker lists "SO-2026-3336 — Client name" and, when a client is already chosen, only that client's orders;
//  - picking an order fills the client and (when the order has exactly one booked vehicle) the VIN and booking number.
// The API repeats the same filling when the record is saved, so a record is complete even if this step is skipped.
import { api } from './api';

type Obj = Record<string, unknown>;
type SetForm = (updater: (prev: Record<string, string>) => Record<string, string>) => void;
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Spread into the order field of a config: { key: 'order_id', ...orderPicker({ vin: 'vin', booking: 'booking_reference' }), ... } */
export function orderPicker(fill: { vin?: string; booking?: string }) {
  return {
    lookupResource: '/orders',
    lookupLabelKey: 'order_number',
    lookupSecondaryLabelKey: 'clients.client_name',
    lookupFilter: (o: Obj, f: Record<string, string>) => !f.client_id || !o.client_id || String(o.client_id) === f.client_id,
    onLookupChange: (order: Obj, setForm: SetForm) => {
      const client = order.clients as { client_name?: string } | undefined;
      setForm((prev) => ({
        ...prev,
        ...(order.client_id ? { client_id: s(order.client_id) } : {}),
        ...(client?.client_name ? { client_name: client.client_name } : {}),
      }));
      void api<{ data: Obj[] }>('/vehicle/bookings')
        .then((res) => {
          const mine = (res.data ?? []).filter((b) => s(b.order_id) === s(order.id) && b.status !== 'Cancelled');
          const withVin = mine.filter((b) => b.vin);
          const one = withVin.length === 1 ? withVin[0]! : mine.length === 1 ? mine[0]! : null; // several vehicles on the order: the user picks the VIN
          if (!one) return;
          setForm((prev) => ({
            ...prev,
            ...(fill.vin && one.vin && !prev[fill.vin] ? { [fill.vin]: s(one.vin) } : {}),
            ...(fill.booking && !prev[fill.booking] ? { [fill.booking]: s(one.booking_number) } : {}),
          }));
        })
        .catch(() => { /* the user can still pick the vehicle by hand */ });
    },
  };
}