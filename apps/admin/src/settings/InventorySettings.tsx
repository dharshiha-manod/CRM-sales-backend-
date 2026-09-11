import type { ExpiryBatchConfig, InventoryConfigSettings, StockRulesConfig } from './types';
import { Field, SubSection, Toggle } from './ui';

export function InventoryConfigurationSection({ value, onChange }: { value: InventoryConfigSettings; onChange: (next: InventoryConfigSettings) => void }) {
  return (
    <SubSection title="Inventory Configuration" description="Stock thresholds and alerting used across every industry catalog.">
      <div className="settings-form-grid">
        <Field label="Minimum stock threshold"><input type="number" value={value.minStockThreshold} onChange={(e) => onChange({ ...value, minStockThreshold: Number(e.target.value) })} /></Field>
        <Field label="Expiry warning (days)"><input type="number" value={value.expiryWarningDays} onChange={(e) => onChange({ ...value, expiryWarningDays: Number(e.target.value) })} /></Field>
        <Field label="Low-stock alert" inline><Toggle checked={value.lowStockAlert} onChange={(next) => onChange({ ...value, lowStockAlert: next })} /></Field>
        <Field label="Expiry alert" inline><Toggle checked={value.expiryAlert} onChange={(next) => onChange({ ...value, expiryAlert: next })} /></Field>
        <Field label="Batch tracking" inline><Toggle checked={value.batchTracking} onChange={(next) => onChange({ ...value, batchTracking: next })} /></Field>
        <Field label="Allow stock adjustment" inline><Toggle checked={value.allowStockAdjustment} onChange={(next) => onChange({ ...value, allowStockAdjustment: next })} /></Field>
        <Field label="Allow stock transfer" inline><Toggle checked={value.allowStockTransfer} onChange={(next) => onChange({ ...value, allowStockTransfer: next })} /></Field>
        <Field label="Sales rep stock assignment" inline><Toggle checked={value.repStockAssignment} onChange={(next) => onChange({ ...value, repStockAssignment: next })} /></Field>
      </div>
    </SubSection>
  );
}

export function StockRulesSection({ value, onChange }: { value: StockRulesConfig; onChange: (next: StockRulesConfig) => void }) {
  return (
    <SubSection title="Stock Rules" description="How stock is valued and whether it can go negative.">
      <div className="settings-form-grid">
        <Field label="Valuation method">
          <select value={value.valuationMethod} onChange={(e) => onChange({ ...value, valuationMethod: e.target.value as StockRulesConfig['valuationMethod'] })}>
            <option>FIFO</option><option>LIFO</option><option>Weighted Average</option>
          </select>
        </Field>
        <Field label="Allow negative stock" inline><Toggle checked={value.negativeStockAllowed} onChange={(next) => onChange({ ...value, negativeStockAllowed: next })} /></Field>
        <Field label="Auto-suggest reorder quantity" inline><Toggle checked={value.reorderAutoSuggest} onChange={(next) => onChange({ ...value, reorderAutoSuggest: next })} /></Field>
      </div>
    </SubSection>
  );
}

export function ExpiryBatchSection({ value, onChange }: { value: ExpiryBatchConfig; onChange: (next: ExpiryBatchConfig) => void }) {
  return (
    <SubSection title="Expiry & Batch Rules" description="Whether batch and expiry data are required, and how close to expiry a sale is blocked.">
      <div className="settings-form-grid">
        <Field label="Batch mandatory on SKUs" inline><Toggle checked={value.batchMandatory} onChange={(next) => onChange({ ...value, batchMandatory: next })} /></Field>
        <Field label="Expiry mandatory on SKUs" inline><Toggle checked={value.expiryMandatory} onChange={(next) => onChange({ ...value, expiryMandatory: next })} /></Field>
        <Field label="Block sale within (days) of expiry"><input type="number" value={value.blockSaleWithinDaysOfExpiry} onChange={(e) => onChange({ ...value, blockSaleWithinDaysOfExpiry: Number(e.target.value) })} /></Field>
      </div>
    </SubSection>
  );
}
