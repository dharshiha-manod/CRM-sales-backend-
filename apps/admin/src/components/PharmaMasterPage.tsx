/**
 * Pharma's 6 modules reuse the config-driven engine in TextileMasterPage (nothing textile-specific in it).
 * This wrapper only switches OFF the demo rows: Pharma shows real database records, never fake samples.
 * Textile itself is untouched.
 */
import { TextileMasterPage } from './TextileMasterPage';
import type { TextileModuleConfig } from './TextileMasterPage';

export function PharmaMasterPage({ config }: { config: TextileModuleConfig }) {
  return <TextileMasterPage config={{ ...config, sampleRecords: undefined }} />;
}
export type {
  TextileModuleConfig as PharmaModuleConfig,
  TextileRecord as PharmaRecord,
  FieldDef,
  KpiDef,
  FieldType,
} from './TextileMasterPage';