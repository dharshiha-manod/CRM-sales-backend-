/**
 * Pharma's 6 modules (Sample, Batch & Expiry, Product Promotion, Hospital
 * Engagement, Medicine Return, Recall) are config-driven, same as Textile.
 * The underlying engine has nothing textile-specific in it — reuse it here
 * instead of duplicating ~370 lines. Add a new module by adding a config
 * file below; never duplicate TextileMasterPage.tsx.
 */
export { TextileMasterPage as PharmaMasterPage } from './TextileMasterPage';
export type {
  TextileModuleConfig as PharmaModuleConfig,
  TextileRecord as PharmaRecord,
  FieldDef,
  KpiDef,
  FieldType,
} from './TextileMasterPage';