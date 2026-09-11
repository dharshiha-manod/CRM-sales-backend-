import type { ReactNode } from 'react';

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`settings-toggle ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-toggle-knob" />
    </button>
  );
}

export function Field({ label, hint, children, inline }: { label: string; hint?: string; children: ReactNode; inline?: boolean }) {
  return (
    <label className={`settings-field ${inline ? 'inline' : ''}`}>
      <span className="settings-field-label">{label}</span>
      {children}
      {hint && <small className="settings-field-hint">{hint}</small>}
    </label>
  );
}

export function SubSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="settings-subsection">
      <div className="settings-subsection-head">
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      <div className="settings-subsection-body">{children}</div>
    </section>
  );
}

export function EmptyGate({ text }: { text: string }) {
  return (
    <section className="settings-subsection settings-gate">
      <p>{text}</p>
    </section>
  );
}
