/**
 * Vehicle's config-driven modules reuse the same generic engine as
 * Textile, Pharma and Trading — nothing vehicle-specific lives in the
 * engine itself. Add a new module by adding a config file below;
 * never duplicate TextileMasterPage.tsx.
 */
export { TextileMasterPage as VehicleMasterPage } from './TextileMasterPage';
export type {
  TextileModuleConfig as VehicleModuleConfig,
  TextileRecord as VehicleRecord,
  FieldDef,
  KpiDef,
  FieldType,
} from './TextileMasterPage';