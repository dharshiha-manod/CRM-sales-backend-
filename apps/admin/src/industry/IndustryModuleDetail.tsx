import type { ModuleDef } from './moduleDefs';

interface Props {
  industryLabel: string;
  module: ModuleDef;
  onBack: () => void;
}

export function IndustryModuleDetail({ industryLabel, module, onBack }: Props) {
  return (
    <div className="module-detail">
      <button className="module-back" onClick={onBack}>← Back to {industryLabel} modules</button>
      <div className="module-detail-header">
        <span className="module-detail-icon">{module.icon}</span>
        <div>
          <h2>{module.label}</h2>
          <p>{module.description}</p>
        </div>
      </div>
      <div className="module-detail-body">
        <p>This module's workflow is not built yet. Implement the {module.label} screens here.</p>
      </div>
    </div>
  );
}