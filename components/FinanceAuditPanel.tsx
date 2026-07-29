"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  FilePlus2,
  FileSignature,
  Loader2,
  Lock,
  Paperclip,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldX,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  FinanceAuditAction,
  FinanceAuditEvent,
  FinanceAuditFilterOptions,
  FinanceAuditResponse,
  FinanceAuditSummary,
} from "@/types/financeAudit";

const PAGE_SIZE = 50;

const ACTION_META: Record<
  FinanceAuditAction,
  { label: string; icon: typeof FilePlus2; tone: string }
> = {
  create: { label: "Criado", icon: FilePlus2, tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  update: { label: "Editado", icon: FileSignature, tone: "border-amber-200 bg-amber-50 text-amber-700" },
  delete: { label: "Excluído", icon: Trash2, tone: "border-rose-200 bg-rose-50 text-rose-700" },
  attach: { label: "Comprovante", icon: Paperclip, tone: "border-sky-200 bg-sky-50 text-sky-700" },
  status: { label: "Status", icon: ShieldCheck, tone: "border-violet-200 bg-violet-50 text-violet-700" },
  purge: { label: "Evento removido", icon: ShieldX, tone: "border-slate-300 bg-slate-100 text-slate-700" },
};

/** Rótulos das colunas do banco. Coluna sem entrada aqui aparece pelo nome cru. */
const FIELD_LABELS: Record<string, string> = {
  id: "ID",
  date: "Data",
  description: "Descrição",
  category_id: "Categoria",
  origin: "Origem",
  student: "Aluno",
  course_id: "Curso",
  branch_id: "Filial",
  payment_method_id: "Forma de pagamento",
  payment_method: "Forma de pagamento",
  seller_id: "Vendedor",
  amount: "Valor",
  fee_amount: "Taxa (R$)",
  fee_pct: "Taxa (%)",
  net_amount: "Valor líquido",
  status: "Status",
  enrollment_id: "Matrícula",
  installment_number: "Parcela",
  installments: "Parcelas",
  notes: "Observações",
  invoice_url: "Link do comprovante",
  invoice_filename: "Arquivo do comprovante",
  invoice_mime: "Tipo do arquivo",
  created_at: "Criado em",
  updated_at: "Atualizado em",
  revenue_id: "Receita",
  payment_date: "Data do pagamento",
  card_brand_id: "Bandeira",
  commission_pct: "Comissão (%)",
  commission_amount: "Comissão (R$)",
  commission_status: "Status da comissão",
  commission_paid_at: "Comissão paga em",
  created_by_name: "Lançado por",
  month: "Mês",
  due_date: "Vencimento",
  benefits_amount: "Benefícios",
  paid_at: "Pago em",
  employee_id: "Funcionário",
  kind: "Tipo",
  recurring_locked: "Recorrência travada",
  recurring_key: "Chave da recorrência",
  recurring_due_day: "Dia de vencimento",
  total_amount: "Valor total",
  first_month: "Primeiro mês",
  sale_date: "Data da venda",
  rate_pct: "Taxa (%)",
  sale_amount: "Valor da venda",
  percent: "Percentual",
  total_commission: "Comissão total",
  commission_id: "Comissão",
  item: "Item",
  category: "Categoria",
  supplier: "Fornecedor",
  cost_kind: "Tipo de custo",
  phase: "Fase",
  name: "Nome",
  active: "Ativo",
  default_price: "Preço padrão",
  default_pct: "Percentual padrão",
  city: "Cidade",
  role: "Cargo",
  salary: "Salário",
  benefits: "Benefícios",
  key: "Chave",
  value: "Valor",
  saldo_inicial: "Saldo inicial",
  boleto_fee: "Taxa de boleto",
  evento_removido: "Evento removido",
  acao: "Ação",
  tipo: "Tipo do item",
  item_id: "ID do item",
  autor_original: "Autor original",
  registrado_em: "Registrado em",
  campos_alterados: "Campos alterados",
  observacao_original: "Observação original",
};

const CURRENCY_FIELDS = new Set([
  "amount",
  "fee_amount",
  "net_amount",
  "commission_amount",
  "total_amount",
  "total_commission",
  "sale_amount",
  "benefits_amount",
  "salary",
  "benefits",
  "default_price",
  "saldo_inicial",
  "boleto_fee",
]);
const PERCENT_FIELDS = new Set(["fee_pct", "commission_pct", "rate_pct", "percent", "default_pct"]);

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/_/g, " ");
}

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sim" : "Não";

  if (CURRENCY_FIELDS.has(field)) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    }
  }
  if (PERCENT_FIELDS.has(field)) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return `${numeric.toLocaleString("pt-BR")}%`;
  }

  if (typeof value === "string") {
    // Datas (YYYY-MM-DD) e timestamps ISO viram formato brasileiro.
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split("-");
      return `${day}/${month}/${year}`;
    }
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      }
    }
    return value;
  }

  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

interface FinanceAuditPanelProps {
  /** Permite remover eventos do registro (permissão `admin.audit`). */
  canDelete?: boolean;
}

/**
 * O período aqui começa vazio de propósito: o filtro de mês do cabeçalho do
 * financeiro é sobre a data do lançamento, e a auditoria é sobre a data da
 * AÇÃO — uma edição feita hoje num lançamento de janeiro sumiria da tela se
 * herdasse aquele recorte.
 */
export default function FinanceAuditPanel({ canDelete = false }: FinanceAuditPanelProps) {
  const [events, setEvents] = useState<FinanceAuditEvent[]>([]);
  const [summary, setSummary] = useState<FinanceAuditSummary | null>(null);
  const [options, setOptions] = useState<FinanceAuditFilterOptions>({ actors: [], entities: [] });
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FinanceAuditEvent | null>(null);
  const [isPurging, setIsPurging] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [action, setAction] = useState<"" | FinanceAuditAction>("");
  const [entity, setEntity] = useState("");
  const [actor, setActor] = useState("");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (action) params.set("actions", action);
    if (entity) params.set("entities", entity);
    if (actor) params.set("actor", actor);
    if (appliedSearch) params.set("search", appliedSearch);
    params.set("limit", String(PAGE_SIZE));
    return params;
  }, [from, to, action, entity, actor, appliedSearch]);

  const load = useCallback(
    async (nextOffset: number, append: boolean) => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams(query);
        params.set("offset", String(nextOffset));
        const response = await fetch(`/api/finance/audit?${params.toString()}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Falha ao carregar o registro.");

        const data = (await response.json()) as FinanceAuditResponse;
        setEvents((current) => (append ? [...current, ...data.events] : data.events));
        setSummary(data.summary);
        setOptions(data.options);
        setHasMore(data.hasMore);
        setOffset(nextOffset);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Falha ao carregar o registro.");
      } finally {
        setIsLoading(false);
      }
    },
    [query]
  );

  useEffect(() => {
    void load(0, false);
  }, [load]);

  const purge = useCallback(
    async (event: FinanceAuditEvent, reason: string) => {
      setIsPurging(true);
      setPurgeError(null);
      try {
        const response = await fetch(`/api/finance/audit/${event.id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || "Falha ao remover o evento.");
        }
        setPendingDelete(null);
        await load(0, false);
      } catch (deleteError) {
        setPurgeError(deleteError instanceof Error ? deleteError.message : "Falha ao remover o evento.");
      } finally {
        setIsPurging(false);
      }
    },
    [load]
  );

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">De</span>
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-cyan-400"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Até</span>
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-cyan-400"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Ação</span>
            <select
              value={action}
              onChange={(event) => setAction(event.target.value as "" | FinanceAuditAction)}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-cyan-400"
            >
              <option value="">Todas</option>
              {(Object.keys(ACTION_META) as FinanceAuditAction[]).map((key) => (
                <option key={key} value={key}>
                  {ACTION_META[key].label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Tipo</span>
            <select
              value={entity}
              onChange={(event) => setEntity(event.target.value)}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-cyan-400"
            >
              <option value="">Todos</option>
              {options.entities.map((item) => (
                <option key={item.entity} value={item.entity}>
                  {item.entityLabel} ({item.count})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Autor</span>
            <select
              value={actor}
              onChange={(event) => setActor(event.target.value)}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-cyan-400"
            >
              <option value="">Todos</option>
              {options.actors.map((item) => (
                <option key={item.email} value={item.email}>
                  {item.name || item.email} ({item.count})
                </option>
              ))}
            </select>
          </label>

          <form
            className="flex flex-1 items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setAppliedSearch(search.trim());
            }}
          >
            <label className="flex min-w-[180px] flex-1 flex-col gap-1">
              <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Buscar</span>
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Descrição, aluno, #id..."
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-800 outline-none focus:border-cyan-400"
                />
              </div>
            </label>
            <button
              type="submit"
              className="h-10 rounded-lg border border-cyan-300 bg-cyan-50 px-4 text-sm font-black text-cyan-800 transition hover:bg-cyan-100"
            >
              Filtrar
            </button>
            <button
              type="button"
              onClick={() => void load(0, false)}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 transition hover:border-cyan-200 hover:text-cyan-700"
            >
              <RefreshCw size={15} className={cn(isLoading ? "animate-spin" : "")} />
              Atualizar
            </button>
          </form>
        </div>
      </div>

      {summary ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryCard label="Ações no período" value={summary.totalEvents} />
          <SummaryCard label="Itens afetados" value={summary.itemsAffected} />
          <SummaryCard label="Pessoas envolvidas" value={summary.activeActors} />
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {events.length === 0 && !isLoading ? (
          <div className="p-10 text-center">
            <ShieldCheck className="mx-auto size-6 text-slate-400" />
            <p className="mt-3 text-sm font-bold text-slate-600">Nenhuma ação registrada neste recorte.</p>
            <p className="mt-1 text-xs text-slate-500">
              Toda criação, edição e exclusão feita na Gestão Financeira passa a aparecer aqui.
            </p>
          </div>
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y divide-slate-100 p-0">
            {events.map((event) => {
              const meta = ACTION_META[event.action] ?? ACTION_META.update;
              const Icon = meta.icon;
              return (
                <li key={event.id} className="flex items-start gap-3 p-4">
                  <span
                    className={cn(
                      "flex size-9 flex-shrink-0 items-center justify-center rounded-lg border",
                      meta.tone
                    )}
                  >
                    <Icon size={16} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("rounded-md border px-2 py-0.5 text-[11px] font-black", meta.tone)}>
                        {meta.label}
                      </span>
                      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                        {event.entityLabel}
                        {event.entityId ? ` #${event.entityId}` : ""}
                      </span>
                      <span className="text-xs text-slate-400">{formatDateTime(event.createdAt)}</span>
                    </div>

                    <p className="mt-1 truncate text-sm font-bold text-slate-800">{event.label ?? "—"}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {event.actorName || event.actorEmail || "Autor não identificado"}
                      {event.note ? ` · ${event.note}` : ""}
                      {event.changes.length > 0
                        ? ` · ${event.changes.length} ${event.changes.length === 1 ? "campo alterado" : "campos alterados"}`
                        : ""}
                    </p>
                  </div>

                  <div className="flex flex-shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDetailId(event.id)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-black text-slate-600 transition hover:border-cyan-300 hover:text-cyan-700"
                    >
                      Ver alterações
                      <ArrowRight size={14} />
                    </button>

                    {event.action === "purge" ? (
                      <span
                        className="flex size-9 items-center justify-center rounded-lg border border-slate-200 text-slate-400"
                        title="Registro de remoção — não pode ser excluído"
                      >
                        <Lock size={14} />
                      </span>
                    ) : canDelete ? (
                      <button
                        type="button"
                        onClick={() => {
                          setPurgeError(null);
                          setPendingDelete(event);
                        }}
                        className="flex size-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600"
                        aria-label="Remover evento do registro"
                        title="Remover evento do registro"
                      >
                        <Trash2 size={14} />
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 border-t border-slate-100 p-4 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" />
            Carregando...
          </div>
        ) : null}

        {hasMore && !isLoading ? (
          <div className="border-t border-slate-100 p-3 text-center">
            <button
              type="button"
              onClick={() => void load(offset + PAGE_SIZE, true)}
              className="h-9 rounded-lg border border-slate-200 px-4 text-sm font-black text-slate-600 transition hover:border-cyan-300 hover:text-cyan-700"
            >
              Carregar mais
            </button>
          </div>
        ) : null}
      </div>

      {detailId !== null ? (
        <FinanceAuditDetailModal eventId={detailId} onClose={() => setDetailId(null)} />
      ) : null}

      {pendingDelete ? (
        <ConfirmPurgeModal
          event={pendingDelete}
          busy={isPurging}
          error={purgeError}
          onCancel={() => setPendingDelete(null)}
          onConfirm={(reason) => void purge(pendingDelete, reason)}
        />
      ) : null}
    </section>
  );
}

function ConfirmPurgeModal({
  event,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  event: FinanceAuditEvent;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        <h2 className="text-lg font-black text-slate-900">Remover este evento do registro?</h2>
        <p className="mt-2 text-sm text-slate-600">
          <span className="font-bold">{event.label ?? event.entityLabel}</span> — registrado por{" "}
          {event.actorName || event.actorEmail || "autor não identificado"} em {formatDateTime(event.createdAt)}.
        </p>

        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
          A remoção fica gravada no registro como um evento próprio, com seu nome e a data — e esse
          evento de remoção não pode ser apagado por ninguém.
        </div>

        <label className="mt-4 flex flex-col gap-1">
          <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
            Motivo (opcional)
          </span>
          <input
            value={reason}
            onChange={(changeEvent) => setReason(changeEvent.target.value)}
            placeholder="Ex.: lançamento duplicado por engano"
            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-cyan-400"
          />
        </label>

        {error ? (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-10 rounded-lg border border-slate-200 px-4 text-sm font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason)}
            disabled={busy}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-rose-600 px-4 text-sm font-black text-white transition hover:bg-rose-700 disabled:opacity-50"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            Remover evento
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-slate-800">{value.toLocaleString("pt-BR")}</p>
    </div>
  );
}

function FinanceAuditDetailModal({ eventId, onClose }: { eventId: number; onClose: () => void }) {
  const [event, setEvent] = useState<FinanceAuditEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAllFields, setShowAllFields] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/finance/audit/${eventId}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Falha ao carregar o detalhe.");
        const data = (await response.json()) as { event: FinanceAuditEvent };
        if (!cancelled) setEvent(data.event);
      } catch (detailError) {
        if (!cancelled) {
          setError(detailError instanceof Error ? detailError.message : "Falha ao carregar o detalhe.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  useEffect(() => {
    const onEsc = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const meta = event ? ACTION_META[event.action] ?? ACTION_META.update : null;
  // Excluído mostra o que existia; criado mostra o que nasceu; editado mostra o diff.
  const snapshot = event?.action === "delete" ? event.before : event?.after ?? null;
  const snapshotEntries = snapshot
    ? Object.entries(snapshot).filter(([, value]) => value !== null && value !== "")
    : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        <header className="sticky top-0 flex items-start justify-between gap-3 border-b border-slate-100 bg-white p-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {meta ? (
                <span className={cn("rounded-md border px-2 py-0.5 text-[11px] font-black", meta.tone)}>
                  {meta.label}
                </span>
              ) : null}
              {event ? (
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  {event.entityLabel}
                  {event.entityId ? ` #${event.entityId}` : ""}
                </span>
              ) : null}
            </div>
            <h2 className="mt-1 truncate text-lg font-black text-slate-900">{event?.label ?? "Carregando..."}</h2>
            {event ? (
              <p className="mt-0.5 text-xs text-slate-500">
                {event.actorName || event.actorEmail || "Autor não identificado"} ·{" "}
                {formatDateTime(event.createdAt)}
                {event.note ? ` · ${event.note}` : ""}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </header>

        <div className="space-y-5 p-5">
          {error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
              {error}
            </div>
          ) : null}

          {event && event.changes.length > 0 ? (
            <div>
              <h3 className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
                O que mudou ({event.changes.length})
              </h3>
              <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[520px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-[11px] font-black uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-2">Campo</th>
                      <th className="px-3 py-2">Antes</th>
                      <th className="px-3 py-2">Depois</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {event.changes.map((change) => (
                      <tr key={change.field}>
                        <td className="px-3 py-2 font-bold text-slate-700">{fieldLabel(change.field)}</td>
                        <td className="px-3 py-2 text-rose-700 line-through decoration-rose-300">
                          {formatValue(change.field, change.before)}
                        </td>
                        <td className="px-3 py-2 font-bold text-emerald-700">
                          {formatValue(change.field, change.after)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {event && event.changes.length === 0 && event.action === "update" ? (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              A gravação foi registrada, mas nenhum campo mudou de valor.
            </p>
          ) : null}

          {snapshotEntries.length > 0 ? (
            <div>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
                  {event?.action === "delete" ? "Conteúdo do item excluído" : "Estado atual do item"}
                </h3>
                {event && event.changes.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowAllFields((value) => !value)}
                    className="text-xs font-black text-cyan-700 hover:text-cyan-900"
                  >
                    {showAllFields ? "Ocultar" : "Ver todos os campos"}
                  </button>
                ) : null}
              </div>

              {event && event.changes.length > 0 && !showAllFields ? null : (
                <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 rounded-lg border border-slate-200 p-4 sm:grid-cols-2">
                  {snapshotEntries.map(([field, value]) => (
                    <div key={field} className="flex items-baseline justify-between gap-3 border-b border-slate-50 pb-1">
                      <dt className="text-xs font-bold text-slate-500">{fieldLabel(field)}</dt>
                      <dd className="text-right text-sm text-slate-800">{formatValue(field, value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          ) : null}

          {event && !snapshot && event.changes.length === 0 ? (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Este registro não guardou o conteúdo do item.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
