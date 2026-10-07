// FILE: admin/src/components/FmcgMarketFields.tsx
// Country + Currency fields for FMCG clients and leads (multi-country selling). Type to search.
// Used ONLY by the FMCG branches of the client and lead forms — no other industry ever mounts this.
// Country: type a name, code or common short name (USA, UK, UAE) and pick from the list.
// Picking a country suggests that country's usual currency; the user can still change it.
import { useEffect, useId, useState } from 'react';
import { CURRENCIES, MARKETS, defaultCurrencyFor, marketName } from '../lib/markets';

const currencyNames = (() => {
  try { return new Intl.DisplayNames(['en'], { type: 'currency' }); } catch { return null; }
})();
const currencyLabel = (code: string) => (code ? `${code} — ${currencyNames?.of(code) ?? code}` : '');

const COUNTRY_ALIASES: Record<string, string> = { USA: 'US', 'U.S.A.': 'US', AMERICA: 'US', 'UNITED STATES OF AMERICA': 'US', UK: 'GB', ENGLAND: 'GB', 'GREAT BRITAIN': 'GB', UAE: 'AE', EMIRATES: 'AE', 'SOUTH KOREA': 'KR', RUSSIA: 'RU', IVORY: 'CI' };

function findCountry(text: string) {
  const t = text.trim().toUpperCase();
  if (!t) return null;
  const code = COUNTRY_ALIASES[t] ?? (t.length === 2 ? t : null);
  return (code ? MARKETS.find((m) => m.code === code) : null) ?? MARKETS.find((m) => m.name.toUpperCase() === t) ?? null;
}
function findCurrency(text: string): string | null {
  const t = text.trim().toUpperCase();
  const code = t.slice(0, 3);
  return /^[A-Z]{3}$/.test(code) && (t.length === 3 || t.startsWith(`${code} `) || t.startsWith(`${code}—`)) ? code : null;
}

interface FmcgMarketFieldsProps {
  /** ISO 3166-1 alpha-2, upper case, or '' when not set. */
  countryCode: string;
  /** ISO 4217, upper case, or '' when not set. */
  currencyCode: string;
  onChange: (countryCode: string, currencyCode: string) => void;
}

export function FmcgMarketFields({ countryCode, currencyCode, onChange }: FmcgMarketFieldsProps) {
  const id = useId();
  const [countryText, setCountryText] = useState(marketName(countryCode));
  const [currencyText, setCurrencyText] = useState(currencyLabel(currencyCode));
  // Re-sync when a different record is opened (edit form) or the value is changed from outside.
  useEffect(() => { setCountryText(marketName(countryCode)); }, [countryCode]);
  useEffect(() => { setCurrencyText(currencyLabel(currencyCode)); }, [currencyCode]);

  // A saved currency outside the standard list must stay selectable instead of silently disappearing.
  const extraCurrency = currencyCode && !CURRENCIES.includes(currencyCode) ? currencyCode : null;
  const countryUnmatched = countryText.trim() !== '' && !findCountry(countryText);
  const currencyUnmatched = currencyText.trim() !== '' && !findCurrency(currencyText);

  return (
    <>
      <label>Country
        <input
          list={`${id}-countries`}
          value={countryText}
          placeholder="Type to search — e.g. United States, USA, UAE"
          onChange={(e) => {
            const text = e.target.value;
            setCountryText(text);
            if (!text.trim()) { onChange('', ''); return; }
            const match = findCountry(text);
            if (match) onChange(match.code, defaultCurrencyFor(match.code));
          }}
          // Clear on focus so the browser lists EVERY country (it filters the list by what is typed); restore on blur.
          onFocus={() => setCountryText('')}
          onBlur={() => { const match = findCountry(countryText); setCountryText(match ? match.name : marketName(countryCode)); }}
        />
        <datalist id={`${id}-countries`}>
          {MARKETS.map((market) => <option key={market.code} value={market.name}>{market.code}</option>)}
        </datalist>
        {countryUnmatched && <small className="lead-code">No matching country — pick one from the list.</small>}
      </label>
      <label>Currency
        <input
          list={`${id}-currencies`}
          value={currencyText}
          placeholder="Type to search — e.g. USD, Dollar"
          onChange={(e) => {
            const text = e.target.value;
            setCurrencyText(text);
            if (!text.trim()) { onChange(countryCode, ''); return; }
            const code = findCurrency(text);
            if (code) onChange(countryCode, code);
          }}
          onFocus={() => setCurrencyText('')}
          onBlur={() => setCurrencyText(currencyLabel(currencyCode))}
        />
        <datalist id={`${id}-currencies`}>
          {extraCurrency && <option value={currencyLabel(extraCurrency)} />}
          {CURRENCIES.map((code) => <option key={code} value={currencyLabel(code)} />)}
        </datalist>
        {currencyUnmatched && <small className="lead-code">Pick a currency from the list (for example USD).</small>}
      </label>
    </>
  );
}