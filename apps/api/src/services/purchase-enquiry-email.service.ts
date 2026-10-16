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

// The blank form the supplier fills in. The labels are fixed so the CRM can read the reply.
const QUOTE_FIELDS = ['Quoted rate', 'Currency', 'Discount %', 'Discount amount', 'Tax %', 'Delivery terms', 'Payment terms'];

export async function sendPurchaseEnquiryEmail(
  enquiry: PurchaseEnquiryForEmail,
  supplierName: string,
  supplierEmail: string,
  companyName: string,
): Promise<DeliveryResult> {
  const recipient = supplierEmail.trim();
  if (!recipient) throw new AppError(422, 'SUPPLIER_EMAIL_REQUIRED', 'This supplier has no saved email address. Add one before sending the enquiry.');

  const subject = `Purchase Enquiry ${enquiry.enquiry_number} from ${companyName}`;
  const quantity = `${enquiry.quantity ?? '—'} ${enquiry.unit ?? ''}`.trim();
  const rows: Array<[string, string]> = [
    ['Product', enquiry.product_name ?? '—'],
    ['Quantity', quantity],
    ['Required by', enquiry.required_by_date ?? '—'],
    ['Delivery location', enquiry.delivery_location ?? '—'],
    ['Delivery terms', enquiry.delivery_terms ?? '—'],
    ['Payment terms', enquiry.payment_terms ?? '—'],
  ];

  // Text pre-filled when the supplier taps "Reply with my quote".
  const replyBody = [
    `Hello ${companyName},`,
    '',
    `Our quote for ${enquiry.enquiry_number} (${enquiry.product_name ?? 'product'}, ${quantity}):`,
    '',
    ...QUOTE_FIELDS.map((f) => `${f}: `),
    '',
    'Thank you,',
    supplierName,
  ].join('\r\n');
  const replyTo = env.MAIL_FROM!;
  const mailto = `mailto:${replyTo}?subject=${encodeURIComponent(`Re: ${subject}`)}&body=${encodeURIComponent(replyBody)}`;

  const rowsHtml = rows
    .map(([label, value], i) => `<tr style="background:${i % 2 ? '#ffffff' : '#f8fafc'}">
      <td style="padding:10px 14px;color:#64748b;font-size:13px;width:38%;border-bottom:1px solid #e2e8f0">${escapeHtml(label)}</td>
      <td style="padding:10px 14px;color:#0f172a;font-size:14px;font-weight:600;border-bottom:1px solid #e2e8f0">${escapeHtml(value)}</td>
    </tr>`)
    .join('');
  const specHtml = enquiry.specification
    ? `<p style="margin:18px 0 0;font-size:13px;color:#475569"><strong style="color:#0f172a">Specification</strong><br>${escapeHtml(enquiry.specification).replace(/\n/g, '<br>')}</p>`
    : '';
  const formHtml = QUOTE_FIELDS
    .map((f) => `<tr><td style="padding:6px 0;font-size:13px;color:#334155;width:40%">${escapeHtml(f)}:</td><td style="padding:6px 0;border-bottom:1px dashed #94a3b8;font-size:13px;color:#94a3b8">&nbsp;</td></tr>`)
    .join('');

  const html = `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
      <tr><td style="background:#0f172a;padding:22px 28px">
        <div style="color:#f59e0b;font-size:11px;letter-spacing:2px;font-weight:700">REQUEST FOR QUOTATION</div>
        <div style="color:#ffffff;font-size:20px;font-weight:700;margin-top:4px">${escapeHtml(companyName)}</div>
        <div style="color:#cbd5e1;font-size:13px;margin-top:6px">Reference: <strong style="color:#ffffff">${escapeHtml(enquiry.enquiry_number)}</strong></div>
      </td></tr>
      <tr><td style="padding:26px 28px">
        <p style="margin:0 0 6px;font-size:15px;color:#0f172a">Dear ${escapeHtml(supplierName)},</p>
        <p style="margin:0 0 18px;font-size:14px;color:#475569;line-height:1.5">We would like your best rate for the item below. Please reply with your quote.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;overflow:hidden">${rowsHtml}</table>
        ${specHtml}
        <div style="text-align:center;margin:28px 0 8px">
          <a href="${escapeHtml(mailto)}" style="background:#f59e0b;color:#0f172a;text-decoration:none;font-weight:700;font-size:15px;padding:13px 28px;border-radius:8px;display:inline-block">Reply with my quote</a>
        </div>
        <p style="margin:0 0 22px;text-align:center;font-size:12px;color:#94a3b8">Tap the button, fill the blanks after each colon, and press Send.</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px">
          <div style="font-size:12px;font-weight:700;color:#0f172a;margin-bottom:6px">Or simply reply to this email with: <span style="font-weight:400;color:#64748b">(Discount: fill % or amount, either one)</span></div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${formHtml}</table>
        </div>
      </td></tr>
      <tr><td style="background:#f8fafc;padding:14px 28px;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0">
        Thank you, ${escapeHtml(companyName)} · Please keep "${escapeHtml(enquiry.enquiry_number)}" in the subject when you reply.
      </td></tr>
    </table>
  </td></tr></table></body></html>`;

  const text = [
    `Purchase Enquiry ${enquiry.enquiry_number}`,
    `Dear ${supplierName},`,
    `${companyName} would like your best rate for:`,
    ...rows.map(([l, v]) => `- ${l}: ${v}`),
    enquiry.specification ? `Specification: ${enquiry.specification}` : '',
    '',
    'Please reply to this email with:',
    ...QUOTE_FIELDS.map((f) => `${f}: `),
    '',
    `Thank you, ${companyName}`,
  ].filter((l) => l !== '' || true).join('\n');

  try {
    const result = await mailTransport().sendMail({
      from: env.MAIL_FROM,
      to: recipient,
      replyTo,
      subject,
      text,
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