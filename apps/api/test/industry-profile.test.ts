import { describe, expect, it } from 'vitest';
import { validateIndustryDetails } from '../src/lib/industry-profile.js';

describe('validateIndustryDetails', () => {
  it('keeps FMCG fields whatever the case of the stored industry code', () => {
    const input = { outletCategory: 'General trade', fssaiNumber: '12345678901234' };
    expect(validateIndustryDetails('FMCG', input)).toEqual(input);
    expect(validateIndustryDetails('fmcg', input)).toEqual(input);
    expect(validateIndustryDetails('Fmcg', input)).toEqual(input);
  });

  it('still drops fields that do not belong to the industry', () => {
    expect(validateIndustryDetails('fmcg', { outletCategory: 'General trade', drugLicenseNumber: 'X-12345' })).toEqual({ outletCategory: 'General trade' });
  });

  it('still rejects bad values', () => {
    expect(() => validateIndustryDetails('fmcg', { fssaiNumber: '123' })).toThrow('FSSAI number must be 14 digits');
    expect(() => validateIndustryDetails('fmcg', { outletCategory: 'Kirana' })).toThrow();
  });
});

describe('pharma customer licence rule', () => {
  it('lets a hospital be saved without a drug licence', () => {
    expect(validateIndustryDetails('pharma', { pharmaCustomerType: 'hospital' })).toEqual({ pharmaCustomerType: 'hospital' });
  });
  it('still requires a licence for a pharmacy or an untyped customer', () => {
    expect(() => validateIndustryDetails('pharma', { pharmaCustomerType: 'chain_pharmacy' })).toThrow(/license/i);
    expect(() => validateIndustryDetails('PHARMA', {})).toThrow(/license/i);
  });
  it('keeps the customer type when the client is edited', () => {
    const out = validateIndustryDetails('pharma', { pharmaCustomerType: 'clinic', drugLicenseNumber: 'KL-12345', licenseValidTill: '2030-01-01' });
    expect(out.pharmaCustomerType).toBe('clinic');
  });
});
