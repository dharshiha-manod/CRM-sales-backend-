import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { logger } from '../lib/logger.js';

type Line = { quantity: number; unit_price: number; subtotal: number; colour?: string | null; products?: { product_name?: string | null; unit?: string | null } | null };
// Textile lines carry a colour; their name and quantity then read "Premium Cotton Poplin - Navy Blue" and "300 m". Other lines are unchanged.
const lineName = (line: Line) => `${line.products?.product_name ?? 'Product'}${line.colour ? ` - ${line.colour}` : ''}`;
const lineQty = (line: Line) => `${line.quantity}${line.colour && line.products?.unit ? ` ${line.products.unit}` : ''}`;
export type DeliveredQuotation = { quotation_number: string; total_amount: number; tax_amount?: number | null; currency_code?: string | null; valid_until?: string | null; clients?: { client_name?: string | null; email?: string | null } | null; organizations?: { name?: string | null } | null; quotation_items?: Line[] | null };
export type DeliveryResult = { messageId: string; accepted: string[]; rejected: string[] };
type EmailTemplate = { logo_url?: string | null; subject: string; body: string; footer?: string | null } | null;

const escapePdf = (value: unknown) => String(value ?? '').replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7E]/g, '?');
const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const currencyOf = (quote: { currency_code?: string | null }) => String(quote.currency_code || 'INR').toUpperCase();
const fmtNumber = (value: number, code: string) => Number(value || 0).toLocaleString(code === 'INR' ? 'en-IN' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Plain text / PDF (Helvetica has no rupee sign): "PKR 350.00". */
const moneyIn = (code: string) => (value: number) => `${code} ${fmtNumber(value, code)}`;
/** Email HTML: rupee sign for INR, currency code for everything else. */
const moneyHtmlIn = (code: string) => (value: number) => (code === 'INR' ? `&#8377;${fmtNumber(value, code)}` : `${code}&nbsp;${fmtNumber(value, code)}`);

function quotationPdf(quote: DeliveredQuotation): Buffer {
  const money = moneyIn(currencyOf(quote));
  const rows = [`${quote.organizations?.name ?? 'Sales CRM'} - QUOTATION`, `Quotation: ${quote.quotation_number}`, `Prepared for: ${quote.clients?.client_name ?? 'Client'}`, quote.valid_until ? `Valid until: ${quote.valid_until}` : '', '', 'Item                                      Qty       Unit price       Amount', ...(quote.quotation_items ?? []).map((line) => `${lineName(line).slice(0, 38).padEnd(40)} ${lineQty(line).padEnd(8)} ${money(line.unit_price).padEnd(16)} ${money(line.subtotal)}`), '', `Total: ${money(quote.total_amount)}`].filter(Boolean);
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
  const code = currencyOf(quote); const money = moneyIn(code); const moneyHtml = moneyHtmlIn(code);
  const total = Number(quote.total_amount || 0); const tax = Number(quote.tax_amount || 0); const subtotal = total - tax;
  const replacements: Record<string, string> = { client_name: clientName, quotation_no: quote.quotation_number, total: money(total), valid_until: quote.valid_until ?? '', company_name: company };
  const interpolate = (value: string) => value.replace(/{{(client_name|quotation_no|total|valid_until|company_name)}}/g, (_match, key: string) => escapeHtml(replacements[key]));
  const logoUrl = template?.logo_url ?? env.COMPANY_LOGO_URL;
  const logo = logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(company)}" style="max-height:48px;max-width:180px;display:block;border:0">` : `<span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:.3px">${escapeHtml(company)}</span>`;
  const th = 'padding:12px 14px;background:#f1f5f9;color:#475569;font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;border-bottom:1px solid #e2e8f0';
  const td = 'padding:14px;border-bottom:1px solid #eef2f7;font-size:14px;color:#1f2937';
  const items = (quote.quotation_items ?? []).map((line) => `<tr><td style="${td}">${escapeHtml(lineName(line))}</td><td align="center" style="${td}">${escapeHtml(lineQty(line))}</td><td align="right" style="${td}">${moneyHtml(line.unit_price)}</td><td align="right" style="${td};font-weight:600">${moneyHtml(line.subtotal)}</td></tr>`).join('');
  const defaultBody = `<p style="margin:0 0 12px">Dear {{client_name}},</p><p style="margin:0 0 12px">Thank you for your interest. Please find your quotation below. You can review the full details and accept or decline it online using the button at the bottom of this email.</p>`;
  const body = interpolate(template?.body ?? defaultBody);
  const validLine = quote.valid_until ? `<tr><td style="padding:2px 0;color:#64748b;font-size:13px">Valid until</td><td style="padding:2px 0 2px 16px;font-size:13px;font-weight:600;color:#0f172a">${escapeHtml(quote.valid_until)}</td></tr>` : '';
  const taxRow = tax > 0 ? `<tr><td style="padding:6px 0;color:#64748b;font-size:14px">Tax (GST)</td><td align="right" style="padding:6px 0;font-size:14px;color:#1f2937">${moneyHtml(tax)}</td></tr>` : '';
  const footer = template?.footer ? interpolate(template.footer) : `Thank you,<br><strong>${escapeHtml(company)}</strong>`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f6f8">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">Quotation ${escapeHtml(quote.quotation_number)} from ${escapeHtml(company)} &mdash; total ${moneyHtml(total)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e5e9ef;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1f2937">
  <tr><td style="background:#0f172a;padding:22px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td>${logo}</td><td align="right" style="color:#f59e0b;font-size:12px;font-weight:700;letter-spacing:2px">QUOTATION</td></tr></table></td></tr>
  <tr><td style="padding:28px 28px 8px">
    <h1 style="margin:0 0 4px;font-size:22px;color:#0f172a">${escapeHtml(quote.quotation_number)}</h1>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr><td style="padding:2px 0;color:#64748b;font-size:13px">Prepared for</td><td style="padding:2px 0 2px 16px;font-size:13px;font-weight:600;color:#0f172a">${escapeHtml(clientName)}</td></tr>${validLine}<tr><td style="padding:2px 0;color:#64748b;font-size:13px">Currency</td><td style="padding:2px 0 2px 16px;font-size:13px;font-weight:600;color:#0f172a">${escapeHtml(code)}</td></tr></table>
    <div style="font-size:14px;line-height:1.6;color:#334155">${body}</div>
  </td></tr>
  <tr><td style="padding:8px 28px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;overflow:hidden">
      <thead><tr><th align="left" style="${th}">Item</th><th align="center" style="${th}">Qty</th><th align="right" style="${th}">Unit price</th><th align="right" style="${th}">Amount</th></tr></thead>
      <tbody>${items}</tbody>
    </table>
  </td></tr>
  <tr><td style="padding:12px 28px 0"><table role="presentation" width="260" align="right" cellpadding="0" cellspacing="0">
    <tr><td style="padding:6px 0;color:#64748b;font-size:14px">Subtotal</td><td align="right" style="padding:6px 0;font-size:14px;color:#1f2937">${moneyHtml(subtotal)}</td></tr>${taxRow}
    <tr><td style="padding:12px 0 0;border-top:2px solid #0f172a;font-size:16px;font-weight:700;color:#0f172a">Total</td><td align="right" style="padding:12px 0 0;border-top:2px solid #0f172a;font-size:18px;font-weight:700;color:#0f172a">${moneyHtml(total)}</td></tr>
  </table></td></tr>
  <tr><td align="center" style="padding:36px 28px 8px"><a href="${escapeHtml(publicLink)}" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:700;font-size:15px;text-decoration:none;padding:14px 34px;border-radius:8px">View &amp; Respond to Quotation</a></td></tr>
  <tr><td align="center" style="padding:6px 28px 24px;font-size:12px;color:#94a3b8">Or copy this link: <a href="${escapeHtml(publicLink)}" style="color:#64748b">${escapeHtml(publicLink)}</a></td></tr>
  <tr><td style="padding:20px 28px;background:#f8fafc;border-top:1px solid #e5e9ef;font-size:13px;line-height:1.6;color:#475569">${footer}<div style="margin-top:10px;font-size:11px;color:#94a3b8">A PDF copy of this quotation is attached.</div></td></tr>
</table></td></tr></table></body></html>`;
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