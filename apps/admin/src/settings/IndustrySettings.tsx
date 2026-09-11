import type { IndustryFieldRow } from './types';
import { Field, SubSection } from './ui';
import { INDUSTRY_CONFIGS } from '../industry/mockData';
import type { IndustryKey } from '../industry/types';

export function IndustrySpecificSection({ industry, rows, onChange }: { industry: IndustryKey; rows: IndustryFieldRow[]; onChange: (next: IndustryFieldRow[]) => void }) {
  const update = (label: string, fieldValue: string) => onChange(rows.map((r) => (r.label === label ? { ...r, value: fieldValue } : r)));
  return (
    <SubSection
      title={`${INDUSTRY_CONFIGS[industry].label}-specific Settings`}
      description="Only the active industry's configuration is shown here. Core and Global settings are not duplicated per industry, and this configuration is preserved when you switch industries."
    >
      <div className="settings-form-grid">
        {rows.map((row) => (
          <Field key={row.label} label={row.label}>
            <input value={row.value} onChange={(e) => update(row.label, e.target.value)} />
          </Field>
        ))}
      </div>
    </SubSection>
  );
}
