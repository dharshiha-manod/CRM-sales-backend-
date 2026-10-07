

// FILE: admin/src/lib/markets.ts
// Country + currency reference data for multi-country selling (currently used by the FMCG industry).
// Country NAMES come from the browser's built-in Intl.DisplayNames, so this file only stores the
// ISO 3166-1 alpha-2 code -> ISO 4217 default currency pairs. The default is only a suggestion:
// forms let the user pick a different currency (e.g. a market that trades in USD).

const COUNTRY_CURRENCY: Record<string, string> = {
  AF: 'AFN', AL: 'ALL', DZ: 'DZD', AD: 'EUR', AO: 'AOA', AG: 'XCD', AR: 'ARS', AM: 'AMD', AU: 'AUD', AT: 'EUR',
  AZ: 'AZN', BS: 'BSD', BH: 'BHD', BD: 'BDT', BB: 'BBD', BY: 'BYN', BE: 'EUR', BZ: 'BZD', BJ: 'XOF', BT: 'BTN',
  BO: 'BOB', BA: 'BAM', BW: 'BWP', BR: 'BRL', BN: 'BND', BG: 'EUR', BF: 'XOF', BI: 'BIF', CV: 'CVE', KH: 'KHR',
  CM: 'XAF', CA: 'CAD', CF: 'XAF', TD: 'XAF', CL: 'CLP', CN: 'CNY', CO: 'COP', KM: 'KMF', CG: 'XAF', CD: 'CDF',
  CR: 'CRC', CI: 'XOF', HR: 'EUR', CU: 'CUP', CY: 'EUR', CZ: 'CZK', DK: 'DKK', DJ: 'DJF', DM: 'XCD', DO: 'DOP',
  EC: 'USD', EG: 'EGP', SV: 'USD', GQ: 'XAF', ER: 'ERN', EE: 'EUR', SZ: 'SZL', ET: 'ETB', FJ: 'FJD', FI: 'EUR',
  FR: 'EUR', GA: 'XAF', GM: 'GMD', GE: 'GEL', DE: 'EUR', GH: 'GHS', GR: 'EUR', GD: 'XCD', GT: 'GTQ', GN: 'GNF',
  GW: 'XOF', GY: 'GYD', HT: 'HTG', HN: 'HNL', HK: 'HKD', HU: 'HUF', IS: 'ISK', IN: 'INR', ID: 'IDR', IR: 'IRR',
  IQ: 'IQD', IE: 'EUR', IL: 'ILS', IT: 'EUR', JM: 'JMD', JP: 'JPY', JO: 'JOD', KZ: 'KZT', KE: 'KES', KI: 'AUD',
  KP: 'KPW', KR: 'KRW', XK: 'EUR', KW: 'KWD', KG: 'KGS', LA: 'LAK', LV: 'EUR', LB: 'LBP', LS: 'LSL', LR: 'LRD',
  LY: 'LYD', LI: 'CHF', LT: 'EUR', LU: 'EUR', MO: 'MOP', MG: 'MGA', MW: 'MWK', MY: 'MYR', MV: 'MVR', ML: 'XOF',
  MT: 'EUR', MH: 'USD', MR: 'MRU', MU: 'MUR', MX: 'MXN', FM: 'USD', MD: 'MDL', MC: 'EUR', MN: 'MNT', ME: 'EUR',
  MA: 'MAD', MZ: 'MZN', MM: 'MMK', NA: 'NAD', NR: 'AUD', NP: 'NPR', NL: 'EUR', NZ: 'NZD', NI: 'NIO', NE: 'XOF',
  NG: 'NGN', MK: 'MKD', NO: 'NOK', OM: 'OMR', PK: 'PKR', PW: 'USD', PA: 'PAB', PG: 'PGK', PY: 'PYG', PE: 'PEN',
  PH: 'PHP', PL: 'PLN', PT: 'EUR', QA: 'QAR', RO: 'RON', RU: 'RUB', RW: 'RWF', KN: 'XCD', LC: 'XCD', VC: 'XCD',
  WS: 'WST', SM: 'EUR', ST: 'STN', SA: 'SAR', SN: 'XOF', RS: 'RSD', SC: 'SCR', SL: 'SLE', SG: 'SGD', SK: 'EUR',
  SI: 'EUR', SB: 'SBD', SO: 'SOS', ZA: 'ZAR', SS: 'SSP', ES: 'EUR', LK: 'LKR', SD: 'SDG', SR: 'SRD', SE: 'SEK',
  CH: 'CHF', SY: 'SYP', TW: 'TWD', TJ: 'TJS', TZ: 'TZS', TH: 'THB', TL: 'USD', TG: 'XOF', TO: 'TOP', TT: 'TTD',
  TN: 'TND', TR: 'TRY', TM: 'TMT', TV: 'AUD', UG: 'UGX', UA: 'UAH', AE: 'AED', GB: 'GBP', US: 'USD', UY: 'UYU',
  UZ: 'UZS', VU: 'VUV', VA: 'EUR', VE: 'VES', VN: 'VND', YE: 'YER', ZM: 'ZMW', ZW: 'ZWG',
};

export interface Market { code: string; name: string; currency: string }

function regionName(code: string): string {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code; } catch { return code; }
}

/** Every supported country, sorted by display name. */
export const MARKETS: Market[] = Object.entries(COUNTRY_CURRENCY)
  .map(([code, currency]) => ({ code, name: regionName(code), currency }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Every currency used by at least one supported country, sorted by code. */
export const CURRENCIES: string[] = [...new Set(Object.values(COUNTRY_CURRENCY))].sort();

export function marketName(countryCode?: string | null): string {
  if (!countryCode) return '';
  return MARKETS.find((m) => m.code === countryCode.toUpperCase())?.name ?? countryCode.toUpperCase();
}

/** The currency a country normally uses, or '' when the country is unknown. */
export function defaultCurrencyFor(countryCode?: string | null): string {
  return countryCode ? COUNTRY_CURRENCY[countryCode.toUpperCase()] ?? '' : '';
}