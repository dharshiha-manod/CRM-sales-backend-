import { describe, expect, it } from 'vitest';
import { validateIndustryDetails } from '../src/lib/industry-profile.js';

describe('textile industry profile', () => {
  it.each(['Wholesaler', 'Retailer', 'Distributor', 'Agent', 'Trader'])('accepts the %s unit type', (unitType) => {
    expect(validateIndustryDetails('TEXTILE', { unitType })).toEqual({ unitType });
  });
  it('still requires a unit type', () => {
    expect(() => validateIndustryDetails('TEXTILE', {})).toThrow(/required/i);
  });
  it('rejects an unknown unit type', () => {
    expect(() => validateIndustryDetails('textile', { unitType: 'Spaceship' })).toThrow(/one of/i);
  });
  it('validates the IEC code', () => {
    expect(() => validateIndustryDetails('TEXTILE', { unitType: 'Wholesaler', iecCode: '123' })).toThrow(/10 digits/);
  });
});