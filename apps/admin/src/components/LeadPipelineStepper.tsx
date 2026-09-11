type StageKey = 'qualification' | 'customer' | 'requirement' | 'quotation' | 'order' | 'followup';

const STAGES: { key: StageKey; label: string }[] = [
  { key: 'qualification', label: 'Lead qualification' },
  { key: 'customer', label: 'Customer creation' },
  { key: 'requirement', label: 'Requirement / need analysis' },
  { key: 'quotation', label: 'Quotation' },
  { key: 'order', label: 'Sales order' },
  { key: 'followup', label: 'After-sales follow-up' },
];

interface Props {
  leadStatus: string;
  hasConvertedClient: boolean;
}

function currentStageIndex(leadStatus: string, hasConvertedClient: boolean): number {
  if (leadStatus === 'lost' || leadStatus === 'unqualified') return -1;
  if (!hasConvertedClient) return 0;
  // Once converted, we don't yet know (frontend-only) whether a requirement/quotation/order
  // exists for this client — stage 1 (customer creation) is the furthest we can confirm here.
  return 1;
}

export function LeadPipelineStepper({ leadStatus, hasConvertedClient }: Props) {
  const activeIndex = currentStageIndex(leadStatus, hasConvertedClient);
  if (activeIndex === -1) {
    return <p className="pipeline-ended">Lead closed — {leadStatus === 'lost' ? 'lost' : 'unqualified'}.</p>;
  }
  return (
    <ol className="lead-pipeline-stepper">
      {STAGES.map((stage, i) => (
        <li key={stage.key} className={i < activeIndex ? 'done' : i === activeIndex ? 'current' : 'pending'}>
          <span className="pipeline-dot" />
          <span className="pipeline-label">{stage.label}</span>
        </li>
      ))}
    </ol>
  );
}