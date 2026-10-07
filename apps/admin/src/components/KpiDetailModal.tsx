import { useEffect } from 'react';
import type { ReactNode } from 'react';
import './MasterDataPages.css';

export type KpiDetailRow = { id: string; cells: ReactNode[] };

type Props = {
  eyebrow: string;
  title: string;
  subtitle?: string;
  columns: string[];
  rows: KpiDetailRow[];
  emptyText?: string;
  onClose: () => void;
};

// Shared read-only popup used by the FMCG module KPI cards whose number
// can't be shown by just filtering the page's own table (e.g. "Outlets assigned").
export function KpiDetailModal({ eyebrow, title, subtitle, columns, rows, emptyText = 'Nothing to show.', onClose }: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="master-modal detail-panel" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h3>{title}</h3>
          </div>
          <button className="icon-action" type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        {subtitle && <p style={{ margin: '0 0 .8rem', fontSize: 13, opacity: 0.75 }}>{subtitle}</p>}
        <div className="data-table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>{row.cells.map((cell, index) => <td key={index}>{cell}</td>)}</tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={columns.length} className="empty-row">{emptyText}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="modal-actions">
          <button type="button" className="primary-action" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}