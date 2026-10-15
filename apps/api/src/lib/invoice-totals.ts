// Customer invoice maths, kept in one place so the API never trusts totals typed in the browser.
// total = subtotal + tax; balance = total - paid; the status follows the money and the due date.
// "Draft" and "Cancelled" are chosen by the user and are never overwritten.

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const round2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

export interface InvoiceFigures {
  subtotal?: unknown;
  tax_percent?: unknown;
  paid_amount?: unknown;
  due_date?: unknown;
  status?: unknown;
}

export function computeInvoiceTotals(f: InvoiceFigures, today: string = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })) {
  const subtotal = round2(Math.max(0, n(f.subtotal)));
  const tax = round2(subtotal * Math.max(0, n(f.tax_percent)) / 100);
  const total = round2(subtotal + tax);
  const paid = round2(Math.max(0, n(f.paid_amount)));
  const balance = round2(total - paid);
  const current = String(f.status ?? '');
  let status = current;
  if (current !== 'Draft' && current !== 'Cancelled') {
    const due = f.due_date ? String(f.due_date).slice(0, 10) : '';
    if (total > 0 && balance <= 0) status = 'Paid';
    else if (paid > 0) status = due && due < today ? 'Overdue' : 'Partially Paid';
    else status = due && due < today ? 'Overdue' : 'Sent';
  }
  return { tax_amount: tax, total_amount: total, balance_amount: balance, status };
}
