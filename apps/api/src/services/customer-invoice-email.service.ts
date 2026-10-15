import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { logger } from '../lib/logger.js';

export type DeliveryResult = { messageId: string; accepted: string[]; rejected: string[] };

const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const money = (currency: unknown, value: unknown) =>
  `${currency ? `${String(currency)} ` : ''}${(Number(value) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

function mailTransport() {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS || !env.MAIL_FROM) {
    throw new AppError(503, 'EMAIL_NOT_CONFIGURED', 'Email is not configured. Add SMTP_HOST, SMTP_USER, SMTP_PASS, and MAIL_FROM to the API environment.');
  }
  return nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } });
}

export async function sendCustomerInvoiceEmail(input: {
  invoice: Record<string, unknown>;
  recipients: string[];
  companyName: string;
  note?: string;
}): Promise<DeliveryResult> {
  const inv = input.invoice;
  const invoiceNumber = String(inv.invoice_number ?? '');
  const cur = inv.currency;
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 10px;background:#f3f4f6"><strong>${escapeHtml(label)}</strong></td><td style="padding:6px 10px">${escapeHtml(value)}</td></tr>`;
  const note = input.note ? `<p>${escapeHtml(input.note).replace(/\n/g, '<br>')}</p>` : '';
  const html = `<div style="font-family:Arial,sans-serif;color:#1f2937;max-width:680px;margin:auto">
    <h2>Invoice ${escapeHtml(invoiceNumber)}</h2>
    <p>Dear ${escapeHtml(inv.customer_name || 'Sir / Madam')},</p>
    <p>${escapeHtml(input.companyName)} has raised the following invoice for shipment <strong>${escapeHtml(inv.shipment_number)}</strong>.</p>
    ${note}
    <table style="border-collapse:collapse;width:100%" border="1" cellpadding="0">
      ${row('Invoice no.', invoiceNumber)}
      ${row('Shipment', String(inv.shipment_number ?? '—'))}
      ${row('Invoice date', String(inv.invoice_date ?? '—').slice(0, 10))}
      ${row('Due date', String(inv.due_date ?? '—').slice(0, 10))}
      ${row('Subtotal', money(cur, inv.subtotal))}
      ${row(`Tax (${Number(inv.tax_percent) || 0}%)`, money(cur, inv.tax_amount))}
      ${row('Invoice total', money(cur, inv.total_amount))}
      ${row('Paid so far', money(cur, inv.paid_amount))}
      ${row('Balance due', money(cur, inv.balance_amount))}
    </table>
    <p style="margin-top:24px">Thank you,<br>${escapeHtml(input.companyName)}</p>
  </div>`;
  try {
    const result = await mailTransport().sendMail({ from: env.MAIL_FROM, to: input.recipients.join(', '), subject: `Invoice ${invoiceNumber} from ${input.companyName}`, html });
    const accepted = result.accepted.map(String);
    const rejected = result.rejected.map(String);
    logger.info({ invoiceNumber, messageId: result.messageId, accepted, rejected }, 'Customer invoice email accepted by SMTP');
    if (accepted.length === 0 || rejected.length > 0) throw new AppError(502, 'EMAIL_NOT_ACCEPTED', `The mail server did not accept delivery to ${rejected.join(', ') || input.recipients.join(', ')}.`);
    return { messageId: result.messageId, accepted, rejected };
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    logger.error({ err: cause, invoiceNumber }, 'Customer invoice email failed');
    throw new AppError(502, 'EMAIL_DELIVERY_FAILED', 'The invoice could not be delivered by SMTP. Check the API log for the mail-server response.');
  }
}