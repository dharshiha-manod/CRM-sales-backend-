// When two or more suppliers have replied for the same product, move those enquiries
// to "Under Comparison" so the team knows they are ready to be compared.
//
// Only enquiries currently "Supplier Responded" are moved. Ones already Under
// Comparison count towards the two, so a third supplier replying later is picked up
// too. Finished ones (Approved, Rejected, Converted to Deal, Closed) are never touched.
// Failures are logged and swallowed: this is a convenience and must never make a save
// or a reply-filing fail.
import { supabaseAdmin } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

const READY_STATUSES = ['Supplier Responded', 'Under Comparison'];

/** Returns the ids of the enquiries that were moved to Under Comparison. */
export async function promoteEnquiriesToComparison(org: string, enquiry: Record<string, unknown>): Promise<string[]> {
  try {
    const product = String(enquiry.product_name ?? '').trim().toLowerCase();
    if (!product) return [];
    let query = supabaseAdmin
      .from('trading_purchase_enquiries')
      .select('id, product_name, status')
      .eq('organization_id', org)
      .in('status', READY_STATUSES);
    const industry = enquiry.industry_type_id;
    if (typeof industry === 'string' && industry) query = query.eq('industry_type_id', industry);
    const { data, error } = await query;
    if (error) throw error;

    const sameProduct = (data ?? []).filter((row) => String(row.product_name ?? '').trim().toLowerCase() === product);
    if (sameProduct.length < 2) return [];
    const toMove = sameProduct.filter((row) => row.status === 'Supplier Responded').map((row) => String(row.id));
    if (toMove.length === 0) return [];

    const { error: updateError } = await supabaseAdmin
      .from('trading_purchase_enquiries')
      .update({ status: 'Under Comparison' })
      .eq('organization_id', org)
      .in('id', toMove);
    if (updateError) throw updateError;
    logger.info({ product, moved: toMove.length }, 'Purchase enquiries moved to Under Comparison');
    return toMove;
  } catch (err) {
    logger.error({ err }, 'Could not move purchase enquiries to Under Comparison');
    return [];
  }
}