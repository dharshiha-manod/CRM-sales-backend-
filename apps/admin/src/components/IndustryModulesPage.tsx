import { useState } from 'react';
import { INDUSTRY_CONFIGS } from '../industry/mockData';
import { INDUSTRY_MODULES } from '../industry/moduleDefs';
import { IndustryModuleDetail } from '../industry/IndustryModuleDetail';
import type { IndustryKey } from '../industry/types';
import type { ModuleDef } from '../industry/moduleDefs';
import './IndustryModulesPage.css';

const INDUSTRY_ORDER: IndustryKey[] = ['fmcg', 'school', 'textile', 'pharma', 'trading', 'vehicle'];

export function IndustryModulesPage() {
  const [active, setActive] = useState<IndustryKey>('fmcg');
  const [openModule, setOpenModule] = useState<ModuleDef | null>(null);
  const config = INDUSTRY_CONFIGS[active];
  const modules = INDUSTRY_MODULES[active];

  function selectIndustry(key: IndustryKey) {
    setActive(key);
    setOpenModule(null);
  }

  return (
    <div className="industry-modules">
      <div className="industry-switcher" role="tablist" aria-label="Industry type">
        {INDUSTRY_ORDER.map((key) => {
          const ind = INDUSTRY_CONFIGS[key];
          return (
            <button
              key={key}
              role="tab"
              aria-selected={key === active}
              className={`industry-tab${key === active ? ' active' : ''}`}
              style={{ '--tab-accent': `var(${ind.colorVar})` } as React.CSSProperties}
              onClick={() => selectIndustry(key)}
            >
              {ind.label}
            </button>
          );
        })}
      </div>

      <section className="industry-header" style={{ '--accent': `var(${config.colorVar})` } as React.CSSProperties}>
        <p className="eyebrow">INDUSTRY MODULES</p>
        <h2>{config.label}</h2>
        <p className="industry-tagline">{config.tagline}</p>
      </section>

      {openModule ? (
        <IndustryModuleDetail
          industryLabel={config.label}
          module={openModule}
          onBack={() => setOpenModule(null)}
        />
      ) : (
        <div className="module-grid">
          {modules.map((mod) => (
            <button key={mod.id} className="module-card" onClick={() => setOpenModule(mod)}>
              <span className="module-card-icon">{mod.icon}</span>
              <span className="module-card-label">{mod.label}</span>
              <span className="module-card-desc">{mod.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}