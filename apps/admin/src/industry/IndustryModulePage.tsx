import type { ModuleDef } from './moduleDefs';

interface Props {
  industryLabel: string;
  module: ModuleDef;
}

export function IndustryModulePage({ industryLabel, module }: Props) {
  return (
    <div className="module-page">
      <p className="eyebrow">{industryLabel.toUpperCase()}</p>
      <h2>{module.label}</h2>
      <p className="module-page-placeholder">Build the {module.label} workflow here.</p>
    </div>
  );
}