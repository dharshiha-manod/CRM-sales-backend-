/**
 * Trading's modules are config-driven, same as Pharma and Textile.
 * The underlying engine has nothing trading-specific in it — reuse it
 * here instead of duplicating ~370 lines. Add a new module by adding a
 * config file below; never duplicate TextileMasterPage.tsx.
 */
export { TextileMasterPage as TradingMasterPage } from './TextileMasterPage';
export type {
  TextileModuleConfig as TradingModuleConfig,
  TextileRecord as TradingRecord,
  FieldDef,
  KpiDef,
  FieldType,
} from './TextileMasterPage';