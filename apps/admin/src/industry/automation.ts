// ============ NEW FILE (src/industry/automation.ts) ============
import type { IndustryConfig, AutomationAlert } from './types';

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

function tryParseDate(value?: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

export function computeAutomationAlerts(config: IndustryConfig, now: Date = new Date()): AutomationAlert[] {
  const alerts: AutomationAlert[] = [];
  const rules = config.automationRules ?? [];

  for (const rule of rules) {
    if (rule.trigger === 'low_stock') {
      for (const item of config.catalog) {
        const threshold = item.reorderLevel ?? rule.thresholdValue;
        if (item.stock <= threshold) {
          alerts.push({
            id: `lowstock-${item.id}`,
            ruleId: rule.id,
            severity: item.stock === 0 ? 'critical' : 'warn',
            message: `${item.name}: only ${item.stock} left (reorder level ${threshold}) — ${rule.action}`,
            relatedItemId: item.id,
          });
        }
      }
    }

    if (rule.trigger === 'expiry_window') {
      for (const item of config.catalog) {
        const expiry = tryParseDate(item.expiryDate);
        if (!expiry) continue;
        const daysLeft = daysBetween(expiry, now);
        const windowDays = item.expiryAlertDays ?? rule.thresholdValue;
        if (daysLeft <= windowDays) {
          alerts.push({
            id: `expiry-${item.id}`,
            ruleId: rule.id,
            severity: daysLeft <= 7 ? 'critical' : 'warn',
            message: `${item.name}: expires in ${daysLeft} day(s) — ${rule.action}`,
            relatedItemId: item.id,
          });
        }
      }
    }

    if (rule.trigger === 'overdue_payment') {
      for (const party of config.parties) {
        if (party.outstanding <= 0) continue;
        const lastOrder = tryParseDate(party.lastOrderDate);
        if (!lastOrder) continue;
        const termsDays = party.paymentTermsDays ?? 15;
        const daysOverdue = daysBetween(now, lastOrder) - termsDays;
        if (daysOverdue >= rule.thresholdValue) {
          alerts.push({
            id: `overdue-${party.id}`,
            ruleId: rule.id,
            severity: daysOverdue >= rule.thresholdValue * 2 ? 'critical' : 'warn',
            message: `${party.name}: ₹${party.outstanding.toLocaleString('en-IN')} overdue by ~${daysOverdue} day(s) — ${rule.action}`,
            relatedPartyId: party.id,
          });
        }
      }
    }

      if (rule.trigger === 'no_visit_days') {
      for (const party of config.parties) {
        const lastOrder = tryParseDate(party.lastOrderDate);
        if (!lastOrder) continue;
        const daysSince = daysBetween(now, lastOrder);
        if (daysSince >= rule.thresholdValue) {
          alerts.push({
            id: `novisit-${party.id}`,
            ruleId: rule.id,
            severity: 'info',
            message: `${party.name}: no order in ${daysSince} day(s) — ${rule.action}`,
            relatedPartyId: party.id,
          });
        }
      }
    }

     if (rule.trigger === 'recall') {
      for (const item of config.catalog) {
        if (item.isRecalled) {
          alerts.push({
            id: `recall-${item.id}`,
            ruleId: rule.id,
            severity: 'critical',
            message: `${item.name} (Batch): RECALLED${item.recallReason ? ` — ${item.recallReason}` : ''} — ${rule.action}`,
            relatedItemId: item.id,
          });
        }
      }
    }

     if (rule.trigger === 'lc_expiry') {
      for (const party of config.parties) {
        const lcExpiry = tryParseDate(party.lcExpiryDate);
        if (!lcExpiry) continue;
        const daysLeft = daysBetween(lcExpiry, now);
        if (daysLeft <= rule.thresholdValue) {
          alerts.push({
            id: `lcexpiry-${party.id}`,
            ruleId: rule.id,
            severity: daysLeft <= 7 ? 'critical' : 'warn',
            message: `${party.name}: LC expires in ${daysLeft} day(s) — ${rule.action}`,
            relatedPartyId: party.id,
          });
        }
      }
    }

    if (rule.trigger === 'quality_hold') {
      for (const item of config.catalog) {
        if (item.qcStatus === 'failed') {
          alerts.push({
            id: `qcfail-${item.id}`,
            ruleId: rule.id,
            severity: 'critical',
            message: `${item.name}: FAILED quality inspection — ${rule.action}`,
            relatedItemId: item.id,
          });
        } else if (item.qcStatus === 'pending') {
          alerts.push({
            id: `qcpending-${item.id}`,
            ruleId: rule.id,
            severity: 'info',
            message: `${item.name}: awaiting quality inspection before dispatch — ${rule.action}`,
            relatedItemId: item.id,
          });
        }
      }
    }

    if (rule.trigger === 'term_rollover') {
      for (const party of config.parties) {
        const termEnd = tryParseDate(party.termEndDate);
        if (!termEnd) continue;
        const daysLeft = daysBetween(termEnd, now);
        if (daysLeft <= rule.thresholdValue) {
          alerts.push({
            id: `termend-${party.id}`,
            ruleId: rule.id,
            severity: daysLeft <= 7 ? 'critical' : 'warn',
            message: `${party.name}: current term ends in ${daysLeft} day(s) — ${rule.action}`,
            relatedPartyId: party.id,
          });
        }
      }
    }
  }

  return alerts;
}