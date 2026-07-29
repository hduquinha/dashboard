/**
 * Tipos do registro de auditoria da Gestao Financeira. Separados de
 * `lib/financeAudit` para que a tela (client component) importe sem puxar o
 * driver do Postgres.
 */

/**
 * `purge` é a remoção de um evento do próprio registro: fica gravada como
 * evento e, ao contrário dos outros, não pode ser apagada (bloqueada por
 * trigger no Postgres).
 */
export type FinanceAuditAction = "create" | "update" | "delete" | "attach" | "status" | "purge";

export interface FinanceAuditFieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface FinanceAuditEvent {
  id: number;
  entity: string;
  entityLabel: string;
  entityId: number | null;
  action: FinanceAuditAction;
  /** Rótulo legível do item ("Receita · Mensalidade João · R$ 1.200,00"). */
  label: string | null;
  note: string | null;
  actorName: string | null;
  actorEmail: string | null;
  changes: FinanceAuditFieldChange[];
  /** Estado completo: só vem no detalhe de um evento, não na listagem. */
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

export interface FinanceAuditFilters {
  from?: string | null; // YYYY-MM-DD
  to?: string | null; // YYYY-MM-DD
  entities?: string[];
  actions?: FinanceAuditAction[];
  actorEmail?: string | null;
  search?: string | null;
}

export interface FinanceAuditSummary {
  totalEvents: number;
  itemsAffected: number;
  activeActors: number;
  byAction: Array<{ action: FinanceAuditAction; count: number }>;
  byEntity: Array<{ entity: string; entityLabel: string; count: number }>;
  byActor: Array<{ actorEmail: string | null; actorName: string | null; count: number }>;
}

export interface FinanceAuditFilterOptions {
  actors: Array<{ email: string; name: string | null; count: number }>;
  entities: Array<{ entity: string; entityLabel: string; count: number }>;
}

export interface FinanceAuditResponse {
  events: FinanceAuditEvent[];
  hasMore: boolean;
  summary: FinanceAuditSummary;
  options: FinanceAuditFilterOptions;
}
