// Maker-checker for Trade Documents + the evidence a customs record needs before it can be "Cleared".
// Pure functions only (no database), same style as dispatch-gates.ts: the repository loads the rows,
// these decide what is allowed and say what is wrong in plain words.
import { AppError } from '../errors/app-error.js';
import { isGlobalRole } from './industry-scope.js';

type Row = Record<string, unknown>;
const text = (v: unknown): string => (v == null ? '' : String(v).trim());

export interface ReviewActor { id: string; name: string; role: string }

/** Who is acting, taken from the verified login token (never from the request body). */
export function actorFromAuth(auth: Row, role: string): ReviewActor {
  const meta = (auth.user_metadata && typeof auth.user_metadata === 'object' ? auth.user_metadata : {}) as Row;
  const name = text(meta.full_name) || text(meta.display_name) || text(auth.email) || text(auth.sub);
  return { id: text(auth.sub), name, role };
}

const REVIEW_STATES = new Set(['Pending Verification', 'Verified', 'Rejected']);

/** The ordinary create/edit form may never move a document INTO a review state: only Submit / Approve / Reject can,
 *  because those record who did it. Saving a form that merely re-sends the current value is fine. */
export function assertNoDirectReviewChange(payload: Row, existing: Row = {}): void {
  for (const key of ['status', 'verification_status']) {
    if (!(key in payload)) continue;
    const next = text(payload[key]);
    if (REVIEW_STATES.has(next) && next !== text(existing[key])) {
      throw new AppError(403, 'USE_REVIEW_ACTION', 'Verification can only be changed with Submit for verification / Approve / Reject, so the system records who did it.');
    }
  }
}

/** Replacing the file of a document that was already submitted or approved voids that approval. */
export function resetApprovalOnNewFile(payload: Row, existing: Row): void {
  if (!('file_reference' in payload) || text(payload.file_reference) === text(existing.file_reference)) return;
  if (!['Pending Verification', 'Verified', 'Rejected'].includes(text(existing.status))) return;
  Object.assign(payload, {
    status: 'Uploaded', verification_status: null,
    submitted_by: null, submitted_by_id: null, submitted_at: null,
    verified_by: null, verified_by_id: null, verified_at: null, rejection_reason: null, verification_note: null,
  });
}

/** What a Submit / Approve / Reject does to the row, or an AppError saying why it is not allowed. */
export function planDocumentReview(doc: Row, action: string, actor: ReviewActor, input: Row): Row {
  const status = text(doc.status) || 'Draft';
  const now = new Date().toISOString();

  if (action === 'submit') {
    if (!text(doc.file_reference)) throw new AppError(422, 'FILE_REQUIRED', 'Attach the document file before submitting it for verification.');
    if (!['Uploaded', 'Rejected'].includes(status)) throw new AppError(409, 'INVALID_TRANSITION', `A document that is "${status}" cannot be submitted for verification.`);
    return {
      status: 'Pending Verification', verification_status: 'Pending Verification',
      submitted_by: actor.name, submitted_by_id: actor.id, submitted_at: now,
      verified_by: null, verified_by_id: null, verified_at: null, rejection_reason: null, verification_note: null,
    };
  }

  if (status !== 'Pending Verification') {
    throw new AppError(409, 'INVALID_TRANSITION', `Only a document that is "Pending Verification" can be approved or rejected (this one is "${status}").`);
  }

  if (action === 'reject') {
    const reason = text(input.reason);
    if (reason.length < 3) throw new AppError(422, 'REASON_REQUIRED', 'Give the reason for rejecting this document so the uploader knows what to fix.');
    return { status: 'Rejected', verification_status: 'Rejected', verified_by: actor.name, verified_by_id: actor.id, verified_at: now, rejection_reason: reason, verification_note: null };
  }

  // approve
  if (!text(doc.file_reference)) throw new AppError(422, 'FILE_REQUIRED', 'This document has no file attached, so there is nothing to verify.');
  let note: string | null = null;
  const isMaker = text(doc.submitted_by_id) !== '' && text(doc.submitted_by_id) === actor.id;
  if (isMaker) {
    const canOverride = isGlobalRole(actor.role);
    const why = text(input.override_reason);
    if (!canOverride) {
      throw new AppError(409, 'SELF_APPROVAL_BLOCKED', 'You submitted this document, so a different person must verify it (maker-checker rule).', { selfApproval: true, canOverride: false });
    }
    if (why.length < 5) {
      throw new AppError(409, 'SELF_APPROVAL_BLOCKED', 'You submitted this document yourself. An admin can approve it only with a written override reason, which is kept in the audit trail.', { selfApproval: true, canOverride: true });
    }
    note = `Self-approval override by ${actor.name}: ${why}`;
  }
  return { status: 'Verified', verification_status: 'Verified', verified_by: actor.name, verified_by_id: actor.id, verified_at: now, rejection_reason: null, verification_note: note };
}

/** A customs record cannot be "Cleared" on a dropdown alone: it needs the declaration and the stamped proof. */
export function assertCanClear(row: Row): void {
  const missing: string[] = [];
  if (!(Number(row.declared_value) > 0)) missing.push('declared value');
  if (!text(row.declaration_number)) missing.push('shipping bill / GD number');
  if (!text(row.clearance_date)) missing.push('clearance date (LEO / out-of-charge date)');
  if (!text(row.clearance_document)) missing.push('stamped clearance copy (file)');
  if (missing.length > 0) {
    throw new AppError(422, 'CLEARANCE_EVIDENCE_REQUIRED', `Customs ${text(row.customs_reference)} cannot be marked Cleared yet. Missing: ${missing.join(', ')}.`.replace('  ', ' '));
  }
  const cleared = text(row.clearance_date).slice(0, 10);
  if (cleared > new Date().toISOString().slice(0, 10)) throw new AppError(422, 'VALIDATION_ERROR', 'Clearance date cannot be in the future.');
  const declared = text(row.declaration_date).slice(0, 10);
  if (declared && declared > cleared) throw new AppError(422, 'VALIDATION_ERROR', 'Clearance date cannot be before the declaration date.');
}