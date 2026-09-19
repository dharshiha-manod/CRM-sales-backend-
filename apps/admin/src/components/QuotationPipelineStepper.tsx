type StageKey = 'sent' | 'client_accepted' | 'accepted' | 'order';

const STAGES: { key: StageKey; label: string }[] = [
  { key: 'sent', label: 'Quotation sent' },
  { key: 'client_accepted', label: 'Client accepted' },
  { key: 'accepted', label: 'Manager approved' },
  { key: 'order', label: 'Sales order created' },
];

interface Props {
  status: 'draft' | 'sent' | 'client_accepted' | 'accepted' | 'rejected' | 'expired' | 'converted';
}

function currentStageIndex(status: Props['status']): number {
  if (status === 'sent') return 0;
  if (status === 'client_accepted') return 1;
  if (status === 'accepted') return 2;
  if (status === 'converted') return 3;
  return -1; // rejected or expired — closed without an order
}

export function QuotationPipelineStepper({ status }: Props) {
  const activeIndex = currentStageIndex(status);
  if (activeIndex === -1) {
    return <p className="pipeline-ended">Quotation closed — {status}.</p>;
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
