// Field definitions for the structured `clients.industry_details` JSONB bag.
// Keyed by industry_types.code (see the seed data in
// supabase/migrations/20260829120000_client_industry_profile.sql). The admin
// UI mirrors this list to render the right inputs per industry; this copy is
// the one the API actually enforces against, so client-supplied fields can
// never smuggle in data that doesn't belong to the selected industry.
export type IndustryFieldType = 'text' | 'number' | 'select';
export type IndustryFieldDef = { key: string; label: string; type: IndustryFieldType; required?: boolean; options?: string[]; pattern?: RegExp; patternMessage?: string; min?: number; max?: number };

export const INDUSTRY_FIELD_DEFS: Record<string, IndustryFieldDef[]> = {
  FMCG: [
    { key: 'fssaiNumber', label: 'FSSAI license number', type: 'text', pattern: /^[0-9]{14}$/, patternMessage: 'FSSAI number must be 14 digits' },
    { key: 'outletCategory', label: 'Outlet category', type: 'select', options: ['General trade', 'Modern trade', 'HoReCa', 'Institutional'] }
  ],
  SCHOOL: [
    { key: 'boardAffiliation', label: 'Board affiliation', type: 'select', required: true, options: ['CBSE', 'ICSE', 'State Board', 'IB', 'Other'] },
    { key: 'udiseCode', label: 'UDISE+ code', type: 'text', pattern: /^[0-9]{11}$/, patternMessage: 'UDISE+ code must be 11 digits' },
    { key: 'studentStrength', label: 'Approx. student strength', type: 'number', min: 0, max: 200000 }
  ],
  TEXTILE: [
    { key: 'unitType', label: 'Unit type', type: 'select', required: true, options: ['Powerloom', 'Handloom', 'Composite mill', 'Garment unit', 'Trader'] },
    { key: 'iecCode', label: 'Import Export Code (IEC)', type: 'text', pattern: /^[0-9]{10}$/, patternMessage: 'IEC must be 10 digits' }
  ],
  PHARMA: [
    { key: 'drugLicenseNumber', label: 'Drug license number', type: 'text', required: true, pattern: /^[A-Za-z0-9/-]{5,30}$/, patternMessage: 'Enter a valid drug license number' },
    { key: 'licenseValidTill', label: 'License valid till', type: 'text', pattern: /^\d{4}-\d{2}-\d{2}$/, patternMessage: 'Use date format YYYY-MM-DD' }
  ],
  TRADING: [
    { key: 'businessType', label: 'Business type', type: 'select', required: true, options: ['Import', 'Export', 'Import & Export', 'Domestic trading'] },
    { key: 'iecCode', label: 'Import Export Code (IEC)', type: 'text', pattern: /^[0-9]{10}$/, patternMessage: 'IEC must be 10 digits' }
  ]
};

// Validates a client's industryDetails against the field set for the given
// industry code. Returns a cleaned object (unknown keys dropped) or throws a
// plain Error with a message safe to surface to the caller.
export function validateIndustryDetails(industryCode: string | null | undefined, details: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const input = details ?? {};
  if (!industryCode) {
    if (Object.keys(input).length > 0) throw new Error('Select an industry before adding industry-specific details.');
    return {};
  }
  const fields = INDUSTRY_FIELD_DEFS[industryCode];
  if (!fields) return {};
  const cleaned: Record<string, unknown> = {};
  for (const field of fields) {
    const value = input[field.key];
    if (value === undefined || value === null || value === '') {
      if (field.required) throw new Error(`${field.label} is required for this industry.`);
      continue;
    }
    if (field.type === 'number') {
      const num = Number(value);
      if (Number.isNaN(num)) throw new Error(`${field.label} must be a number.`);
      if (field.min != null && num < field.min) throw new Error(`${field.label} must be at least ${field.min}.`);
      if (field.max != null && num > field.max) throw new Error(`${field.label} must be at most ${field.max}.`);
      cleaned[field.key] = num;
    } else if (field.type === 'select') {
      if (!field.options?.includes(String(value))) throw new Error(`${field.label} must be one of: ${field.options?.join(', ')}.`);
      cleaned[field.key] = value;
    } else {
      const text = String(value).trim();
      if (field.pattern && !field.pattern.test(text)) throw new Error(field.patternMessage ?? `${field.label} is invalid.`);
      cleaned[field.key] = text;
    }
  }
  return cleaned;
}