// Pharma compliance: a customer whose drug licence has expired cannot be sold to.
// Only Pharma clients are checked; every other industry returns immediately.
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from './supabase.js';
import { industryCodeOf } from './fmcg-market.js';
import { licenseProblem } from './pharma-rules.js';

export async function assertPharmaLicenseValid(organizationId: string, clientId: string | null | undefined): Promise<void> {
  if (!clientId) return;
  const { data, error } = await supabaseAdmin.from('clients').select('client_name, industry_type_id, industry_details').eq('organization_id', organizationId).eq('id', clientId).maybeSingle();
  if (error) throw error;
  const c = data as { client_name?: string | null; industry_type_id?: string | null; industry_details?: unknown } | null;
  if (!c || (await industryCodeOf(organizationId, c.industry_type_id)) !== 'pharma') return;
  const problem = licenseProblem(c.industry_details);
  if (problem) throw new AppError(422, 'DRUG_LICENSE_EXPIRED', `${c.client_name ?? 'This customer'}: ${problem}`);
}
