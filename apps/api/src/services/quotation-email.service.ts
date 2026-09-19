import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { logger } from '../lib/logger.js';

type Line = { quantity: number; unit_price: number; subtotal: number; products?: { product_name?: string | null } | null };
export type DeliveredQuotation = { quotation_number: string; total_amount: number; valid_until?: string | null; clients?: { client_name?: string | null; email?: string | null } | null; organizations?: { name?: string | null } | null; quotation_items?: Line[] | null };
export type DeliveryResult = { messageId: string; accepted: string[]; rejected: string[] };
type EmailTemplate = { logo_url?: string | null; subject: string; body: string; footer?: string | null } | null;

const escapePdf = (value: unknown) => String(value ?? '').replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7E]/g, '?');
const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (value: number) => `INR ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function quotationPdf(quote: DeliveredQuotation): Buffer {
  const rows = [`${quote.organizations?.name ?? 'Sales CRM'} - QUOTATION`, `Quotation: ${quote.quotation_number}`, `Prepared for: ${quote.clients?.client_name ?? 'Client'}`, quote.valid_until ? `Valid until: ${quote.valid_until}` : '', '', 'Item                                      Qty       Unit price       Amount', ...(quote.quotation_items ?? []).map((line) => `${(line.products?.product_name ?? 'Product').slice(0, 38).padEnd(40)} ${String(line.quantity).padEnd(8)} ${money(line.unit_price).padEnd(16)} ${money(line.subtotal)}`), '', `Total: ${money(quote.total_amount)}`].filter(Boolean);
  const stream = `BT\n/F1 12 Tf\n50 780 Td\n${rows.map((row, index) => `${index ? '0 -18 Td\n' : ''}(${escapePdf(row)}) Tj`).join('\n')}\nET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [0]; objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf); pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'ascii');
}

function mailTransport() {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS || !env.MAIL_FROM) throw new AppError(503, 'EMAIL_NOT_CONFIGURED', 'Quotation email is not configured. Add SMTP_HOST, SMTP_USER, SMTP_PASS, and MAIL_FROM to the API environment.');
  return nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } });
}

export async function sendQuotationEmail(quote: DeliveredQuotation, publicLink: string, template: EmailTemplate = null): Promise<DeliveryResult> {
  const recipient = quote.clients?.email?.trim();
  if (!recipient) throw new AppError(422, 'CLIENT_EMAIL_REQUIRED', 'This client has no saved email address. Add one before sending the quotation.');
  const company = quote.organizations?.name ?? 'Sales CRM'; const clientName = quote.clients?.client_name ?? 'Customer';
  const replacements: Record<string, string> = { client_name: clientName, quotation_no: quote.quotation_number, total: money(quote.total_amount), valid_until: quote.valid_until ?? '', company_name: company };
  const interpolate = (value: string) => value.replace(/{{(client_name|quotation_no|total|valid_until|company_name)}}/g, (_match, key: string) => escapeHtml(replacements[key]));
  const logoUrl = template?.logo_url ?? env.COMPANY_LOGO_URL;
  const logo = logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(company)}" style="max-height:54px;max-width:180px">` : `<strong>${escapeHtml(company)}</strong>`;
  const items = (quote.quotation_items ?? []).map((line) => `<tr><td>${escapeHtml(line.products?.product_name ?? 'Product')}</td><td>${line.quantity}</td><td>${money(line.unit_price)}</td><td>${money(line.subtotal)}</td></tr>`).join('');
  const defaultBody = `<h2>Your quotation {{quotation_no}}</h2><p>Dear {{client_name}},</p><p>Please review the attached quotation and respond using the button below.</p><p>Total: {{total}}</p><p>Valid until: {{valid_until}}</p>`;
  const html = `<div style="font-family:Arial,sans-serif;color:#1f2937;max-width:680px;margin:auto">${logo}${interpolate(template?.body ?? defaultBody)}<table style="border-collapse:collapse;width:100%" border="1" cellpadding="8"><thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>${items}</tbody></table><p style="margin:28px 0"><a href="${escapeHtml(publicLink)}" style="background:#2563eb;color:#fff;padding:12px 20px;text-decoration:none;border-radius:5px">View &amp; Respond</a></p>${template?.footer ? `<div>${interpolate(template.footer)}</div>` : `<p>Thank you,<br>${escapeHtml(company)}</p>`}</div>`;
  try {
    const result = await mailTransport().sendMail({ from: env.MAIL_FROM, to: recipient, subject: interpolate(template?.subject ?? 'Quotation {{quotation_no}} from {{company_name}}'), html, attachments: [{ filename: `${quote.quotation_number}.pdf`, content: quotationPdf(quote), contentType: 'application/pdf' }] });
    const accepted = result.accepted.map(String); const rejected = result.rejected.map(String);
    logger.info({ quotationNumber: quote.quotation_number, messageId: result.messageId, accepted, rejected }, 'Quotation email accepted by SMTP');
    if (!accepted.includes(recipient) || rejected.length > 0) throw new AppError(502, 'EMAIL_NOT_ACCEPTED', `The mail server did not accept delivery to ${recipient}.`);
    return { messageId: result.messageId, accepted, rejected };
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    logger.error({ err: cause, quotationNumber: quote.quotation_number, recipient }, 'Quotation email delivery failed');
    throw new AppError(502, 'EMAIL_DELIVERY_FAILED', 'The quotation could not be delivered by SMTP. Check the API log for the mail-server response.');
  }
}
