// NEW — full file
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { logger } from '../lib/logger.js';

export type PurchaseEnquiryForEmail = {
  enquiry_number: string;
  product_name?: string | null;
  quantity?: number | null;
  unit?: string | null;
  specification?: string | null;
  required_by_date?: string | null;
  delivery_location?: string | null;
  delivery_terms?: string | null;
  payment_terms?: string | null;
};
export type DeliveryResult = { messageId: string; accepted: string[]; rejected: string[] };

const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function mailTransport() {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS || !env.MAIL_FROM) {
    throw new AppError(503, 'EMAIL_NOT_CONFIGURED', 'Purchase enquiry email is not configured. Add SMTP_HOST, SMTP_USER, SMTP_PASS, and MAIL_FROM to the API environment.');
  }
  return nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } });
}

export async function sendPurchaseEnquiryEmail(
  enquiry: PurchaseEnquiryForEmail,
  supplierName: string,
  supplierEmail: string,
  companyName: string,
): Promise<DeliveryResult> {
  const recipient = supplierEmail.trim();
  if (!recipient) throw new AppError(422, 'SUPPLIER_EMAIL_REQUIRED', 'This supplier has no saved email address. Add one before sending the enquiry.');

  const rows: Array<[string, string]> = [
    ['Product', enquiry.product_name ?? '—'],
    ['Quantity', `${enquiry.quantity ?? '—'} ${enquiry.unit ?? ''}`.trim()],
    ['Required by', enquiry.required_by_date ?? '—'],
    ['Delivery location', enquiry.delivery_location ?? '—'],
    ['Delivery terms', enquiry.delivery_terms ?? '—'],
    ['Payment terms', enquiry.payment_terms ?? '—'],
  ];
  const rowsHtml = rows
    .map(([label, value]) => `<tr><td style="padding:6px 10px;color:#555">${escapeHtml(label)}</td><td style="padding:6px 10px"><strong>${escapeHtml(value)}</strong></td></tr>`)
    .join('');
  const specHtml = enquiry.specification
    ? `<p><strong>Specification:</strong><br>${escapeHtml(enquiry.specification).replace(/\n/g, '<br>')}</p>`
    : '';
  const html = `<div style="font-family:Arial,sans-serif;color:#1f2937;max-width:640px;margin:auto">
    <h2>Purchase Enquiry ${escapeHtml(enquiry.enquiry_number)}</h2>
    <p>Dear ${escapeHtml(supplierName)},</p>
    <p>${escapeHtml(companyName)} would like to request your best rate for the following:</p>
    <table style="border-collapse:collapse;width:100%" border="1" cellpadding="0">${rowsHtml}</table>
    ${specHtml}
    <p style="margin-top:24px">Please reply to this email with your quoted rate at your earliest convenience.</p>
    <p>Thank you,<br>${escapeHtml(companyName)}</p>
  </div>`;

  try {
    const result = await mailTransport().sendMail({
      from: env.MAIL_FROM,
      to: recipient,
      subject: `Purchase Enquiry ${enquiry.enquiry_number} from ${companyName}`,
      html,
    });
    const accepted = result.accepted.map(String);
    const rejected = result.rejected.map(String);
    logger.info({ enquiryNumber: enquiry.enquiry_number, messageId: result.messageId, accepted, rejected }, 'Purchase enquiry email accepted by SMTP');
    if (!accepted.includes(recipient) || rejected.length > 0) throw new AppError(502, 'EMAIL_NOT_ACCEPTED', `The mail server did not accept delivery to ${recipient}.`);
    return { messageId: result.messageId, accepted, rejected };
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    logger.error({ err: cause, enquiryNumber: enquiry.enquiry_number, recipient }, 'Purchase enquiry email delivery failed');
    throw new AppError(502, 'EMAIL_DELIVERY_FAILED', 'The purchase enquiry could not be delivered by SMTP. Check the API log for the mail-server response.');
  }
}