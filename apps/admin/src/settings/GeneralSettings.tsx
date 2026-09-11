import { useState } from 'react';
import type { OrganizationSettings, LocalizationSettings, WorkingHoursSettings } from './types';  
import { Field, SubSection } from './ui';
import { INDUSTRY_ORDER } from '../industry/IndustryContext';
import { INDUSTRY_CONFIGS } from '../industry/mockData';
import type { IndustryKey } from '../industry/types';

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function OrganizationSection({ value, onChange }: { value: OrganizationSettings; onChange: (next: OrganizationSettings) => void }) {
  return (
    <SubSection title="Organization" description="Core details used across the CRM, invoices and reports.">
      <div className="settings-form-grid">
        <Field label="Organization name"><input value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} /></Field>
        <Field label="Organization code"><input value={value.code} onChange={(e) => onChange({ ...value, code: e.target.value })} /></Field>
        <Field label="Logo" hint="Shown as initials until a logo file is uploaded.">
          <div className="settings-logo-row">
            <span className="settings-logo-preview">{value.logoInitials}</span>
            <input value={value.logoInitials} maxLength={3} onChange={(e) => onChange({ ...value, logoInitials: e.target.value.toUpperCase() })} />
          </div>
        </Field>
        <Field label="Email"><input type="email" value={value.email} onChange={(e) => onChange({ ...value, email: e.target.value })} /></Field>
        <Field label="Phone"><input value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} /></Field>
        <Field label="Country"><input value={value.country} onChange={(e) => onChange({ ...value, country: e.target.value })} /></Field>
        <Field label="Time zone"><input value={value.timeZone} onChange={(e) => onChange({ ...value, timeZone: e.target.value })} /></Field>
        <Field label="Currency"><input value={value.currency} onChange={(e) => onChange({ ...value, currency: e.target.value })} /></Field>
        <Field label="Date format">
          <select value={value.dateFormat} onChange={(e) => onChange({ ...value, dateFormat: e.target.value })}>
            <option>DD/MM/YYYY</option><option>MM/DD/YYYY</option><option>YYYY-MM-DD</option>
          </select>
        </Field>
        <Field label="Address" inline><textarea rows={2} value={value.address} onChange={(e) => onChange({ ...value, address: e.target.value })} /></Field>
      </div>
      <p className="settings-last-updated">Last updated {value.lastUpdated}</p>
    </SubSection>
  );
}

export function IndustryConfigurationSection({ activeIndustry, onChangeIndustry }: { activeIndustry: IndustryKey; onChangeIndustry: (key: IndustryKey) => void }) {
  return (
    <SubSection title="Industry Configuration" description="Industry configuration controls the data and industry-specific modules displayed across the CRM.">
      <div className="settings-form-grid">
        <Field label="Current industry" hint="Core and Global modules stay the same for every industry. Only industry-specific data and configuration change.">
          <select value={activeIndustry} onChange={(e) => onChangeIndustry(e.target.value as IndustryKey)}>
            {INDUSTRY_ORDER.map((key) => <option key={key} value={key}>{INDUSTRY_CONFIGS[key].label}</option>)}
          </select>
        </Field>
      </div>
      <div className="settings-note">
        Changing the industry does not delete or overwrite data. It determines which industry-specific modules, product
        fields, customer fields, inventory fields, target configuration, order fields, reports and dashboard data are shown.
        Each industry keeps its own configuration state, so switching back later restores it exactly as you left it.
      </div>
      <table className="settings-mini-table">
        <thead><tr><th>Layer</th><th>Behaviour when industry changes</th></tr></thead>
        <tbody>
          <tr><td>Core CRM modules</td><td>Unchanged — common to every industry</td></tr>
          <tr><td>Global settings</td><td>Unchanged — common to every industry</td></tr>
          <tr><td>Industry-specific configuration</td><td>Switches to the selected industry's own saved configuration</td></tr>
        </tbody>
      </table>
    </SubSection>
  );
}

export function LocalizationSection({ value, onChange }: { value: LocalizationSettings; onChange: (next: LocalizationSettings) => void }) {
  return (
    <SubSection title="Localization" description="Formatting used throughout the CRM for numbers, dates and currency.">
      <div className="settings-form-grid">
        <Field label="Currency"><input value={value.currency} onChange={(e) => onChange({ ...value, currency: e.target.value })} /></Field>
        <Field label="Time zone"><input value={value.timeZone} onChange={(e) => onChange({ ...value, timeZone: e.target.value })} /></Field>
        <Field label="Date format">
          <select value={value.dateFormat} onChange={(e) => onChange({ ...value, dateFormat: e.target.value })}>
            <option>DD/MM/YYYY</option><option>MM/DD/YYYY</option><option>YYYY-MM-DD</option>
          </select>
        </Field>
        <Field label="Time format">
          <select value={value.timeFormat} onChange={(e) => onChange({ ...value, timeFormat: e.target.value as '12-hour' | '24-hour' })}>
            <option value="12-hour">12-hour</option><option value="24-hour">24-hour</option>
          </select>
        </Field>
        <Field label="Number format"><input value={value.numberFormat} onChange={(e) => onChange({ ...value, numberFormat: e.target.value })} /></Field>
        <Field label="Language">
          <select value={value.language} onChange={(e) => onChange({ ...value, language: e.target.value })}>
            <option>English</option><option>Tamil</option><option>Hindi</option>
          </select>
        </Field>
      </div>
    </SubSection>
  );
}

export function WorkingHoursSection({ value, onChange }: { value: WorkingHoursSettings; onChange: (next: WorkingHoursSettings) => void }) {
  const toggleDay = (day: string) => {
    const has = value.workingDays.includes(day);
    onChange({ ...value, workingDays: has ? value.workingDays.filter((d) => d !== day) : [...value.workingDays, day] });
  };
  const [newDate, setNewDate] = useState('');
  const [newLabel, setNewLabel] = useState('');
  function addHoliday() {
    if (!newDate || !newLabel.trim()) return;
    const formatted = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(newDate));
    onChange({ ...value, holidays: [...value.holidays, { date: formatted, label: newLabel.trim() }] });
    setNewDate('');
    setNewLabel('');
  }
  function updateHoliday(index: number, patch: Partial<{ date: string; label: string }>) {
    onChange({ ...value, holidays: value.holidays.map((h, i) => (i === index ? { ...h, ...patch } : h)) });
  }
  function removeHoliday(index: number) {
    onChange({ ...value, holidays: value.holidays.filter((_, i) => i !== index) });
  }
  return (
    <SubSection title="Working Hours" description="Field-sales working hours used for shift, attendance and visit scheduling.">
      <Field label="Working days">
        <div className="settings-day-picker">
          {ALL_DAYS.map((day) => (
            <button key={day} type="button" className={value.workingDays.includes(day) ? 'active' : ''} onClick={() => toggleDay(day)}>{day}</button>
          ))}
        </div>
      </Field>
      <div className="settings-form-grid">
        <Field label="Start time"><input value={value.startTime} onChange={(e) => onChange({ ...value, startTime: e.target.value })} /></Field>
        <Field label="End time"><input value={value.endTime} onChange={(e) => onChange({ ...value, endTime: e.target.value })} /></Field>
        <Field label="Break start"><input value={value.breakStart} onChange={(e) => onChange({ ...value, breakStart: e.target.value })} /></Field>
        <Field label="Break end"><input value={value.breakEnd} onChange={(e) => onChange({ ...value, breakEnd: e.target.value })} /></Field>
      </div>
      <SubSection title="Holidays" description="Dates the field team is not scheduled to work.">
        <table className="settings-mini-table">
          <thead><tr><th>Date</th><th>Occasion</th><th></th></tr></thead>
          <tbody>
            {value.holidays.map((h, i) => (
              <tr key={`${h.date}-${i}`}>
                <td><input value={h.date} onChange={(e) => updateHoliday(i, { date: e.target.value })} /></td>
                <td><input value={h.label} onChange={(e) => updateHoliday(i, { label: e.target.value })} /></td>
                <td><button type="button" className="icon-action" aria-label="Remove holiday" onClick={() => removeHoliday(i)}>×</button></td>
              </tr>
            ))}
            <tr>
              <td><input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} /></td>
              <td><input value={newLabel} placeholder="Occasion" onChange={(e) => setNewLabel(e.target.value)} /></td>
              <td><button type="button" className="quiet-button" onClick={addHoliday} disabled={!newDate || !newLabel.trim()}>+ Add</button></td>
            </tr>
          </tbody>
        </table>
      </SubSection>
    </SubSection>
  );
} 
