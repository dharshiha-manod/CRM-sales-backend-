// One-shot hand-over of a draft from a Lead to a Vehicle form (Test drive / Booking), same sessionStorage pattern as
// tradeDocumentHandoff.ts. The target page's `consumePendingDraft` reads it once and opens its "new" form pre-filled.
export type VehicleDraftKind = 'test-drive' | 'booking' | 'insurance';
const key = (kind: VehicleDraftKind) => `vehicle-draft-${kind}`;

export function queueVehicleDraft(kind: VehicleDraftKind, values: Record<string, string>): void {
  try { sessionStorage.setItem(key(kind), JSON.stringify(values)); } catch { /* the user can still fill the form by hand */ }
  window.location.hash = `industry:vehicle:${kind}`;
}

export function consumeVehicleDraft(kind: VehicleDraftKind): Record<string, string> | null {
  try {
    const raw = sessionStorage.getItem(key(kind));
    if (!raw) return null;
    sessionStorage.removeItem(key(kind));
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : null;
  } catch { return null; }
}