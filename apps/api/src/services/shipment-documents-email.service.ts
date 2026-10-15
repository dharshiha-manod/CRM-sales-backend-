import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { logger } from '../lib/logger.js';

export type ShipmentDocumentForEmail = { document_number?: unknown; document_type?: unknown; issue_date?: unknown; file_reference?: unknown };
export type DeliveryResult = { messageId: string; accepted: string[]; rejected: string[] };

const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function mailTransport() {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS || !env.MAIL_FROM) {
    throw new AppError(503, 'EMAIL_NOT_CONFIGURED', 'Email is not configured. Add SMTP_HOST, SMTP_USER, SMTP_PASS, and MAIL_FROM to the API environment.');
  }
  return nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } });
}

/** Emails the shipment's Verified documents as secure download links (the files live in the trade-documents bucket). */
export async function sendShipmentDocumentsEmail(input: {
  shipmentNumber: string;
  customerName: string;
  recipients: string[];
  documents: ShipmentDocumentForEmail[];
  companyName: string;
  note?: string;
  carrier?: string;
  tracking?: string;
  origin?: string;
  destination?: string;
}): Promise<DeliveryResult> {
  const rows = input.documents.map((d) => {
    const link = typeof d.file_reference === 'string' && /^https?:\/\//i.test(d.file_reference) ? `<a href="${escapeHtml(d.file_reference)}">Download</a>` : '<span style="color:#888">Not attached</span>';
    return `<tr><td style="padding:6px 10px">${escapeHtml(d.document_type)}</td><td style="padding:6px 10px"><strong>${escapeHtml(d.document_number)}</strong></td><td style="padding:6px 10px">${escapeHtml(d.issue_date ?? '')}</td><td style="padding:6px 10px">${link}</td></tr>`;
  }).join('');
  const route = input.origin || input.destination ? `<p>Route: <strong>${escapeHtml(input.origin || '—')} → ${escapeHtml(input.destination || '—')}</strong>${input.carrier ? ` &nbsp;|&nbsp; Carrier: <strong>${escapeHtml(input.carrier)}</strong>` : ''}${input.tracking ? ` &nbsp;|&nbsp; Tracking: <strong>${escapeHtml(input.tracking)}</strong>` : ''}</p>` : '';
  const note = input.note ? `<p>${escapeHtml(input.note).replace(/\n/g, '<br>')}</p>` : '';
  const html = `<div style="font-family:Arial,sans-serif;color:#1f2937;max-width:680px;margin:auto">
    <h2>Shipping documents - ${escapeHtml(input.shipmentNumber)}</h2>
    <p>Dear ${escapeHtml(input.customerName || 'Sir / Madam')},</p>
    <p>${escapeHtml(input.companyName)} is sharing the documents for shipment <strong>${escapeHtml(input.shipmentNumber)}</strong>.</p>
    ${route}${note}
    <table style="border-collapse:collapse;width:100%" border="1" cellpadding="0">
      <tr style="background:#f3f4f6"><th align="left" style="padding:6px 10px">Document</th><th align="left" style="padding:6px 10px">Number</th><th align="left" style="padding:6px 10px">Issued</th><th align="left" style="padding:6px 10px">File</th></tr>
      ${rows}
    </table>
    <p style="margin-top:24px">Thank you,<br>${escapeHtml(input.companyName)}</p>
  </div>`;
  try {
    const result = await mailTransport().sendMail({ from: env.MAIL_FROM, to: input.recipients.join(', '), subject: `Shipping documents for ${input.shipmentNumber} from ${input.companyName}`, html });
    const accepted = result.accepted.map(String);
    const rejected = result.rejected.map(String);
    logger.info({ shipmentNumber: input.shipmentNumber, messageId: result.messageId, accepted, rejected }, 'Shipment documents email accepted by SMTP');
    if (accepted.length === 0 || rejected.length > 0) throw new AppError(502, 'EMAIL_NOT_ACCEPTED', `The mail server did not accept delivery to ${rejected.join(', ') || input.recipients.join(', ')}.`);
    return { messageId: result.messageId, accepted, rejected };
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    logger.error({ err: cause, shipmentNumber: input.shipmentNumber }, 'Shipment documents email failed');
    throw new AppError(502, 'EMAIL_DELIVERY_FAILED', 'The documents could not be delivered by SMTP. Check the API log for the mail-server response.');
  }
}