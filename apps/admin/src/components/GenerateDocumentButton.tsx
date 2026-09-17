// FILE: admin/src/components/GenerateDocumentButton.tsx
import { queueTradeDocumentDraft } from '../lib/tradeDocumentHandoff';

export function GenerateDocumentButton({
  docTypes,
  buildDraft,
  label = 'Generate document',
}: {
  docTypes: string[];
  buildDraft: (documentType: string) => Record<string, string>;
  label?: string;
}) {
  return (
    <select
      className="icon-action"
      style={{ width: 'auto', maxWidth: 170 }}
      title={label}
      aria-label={label}
      value=""
      onChange={(e) => {
        const documentType = e.target.value;
        if (!documentType) return;
        queueTradeDocumentDraft(buildDraft(documentType));
      }}
    >
      <option value="">{label}…</option>
      {docTypes.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}