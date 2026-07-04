"use client";

import { Fragment, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  Activity,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Columns3,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  UserCheck,
  Users,
} from "lucide-react";
import ProductivityCharts from "./ProductivityCharts";
import { KanbanSection } from "./KanbanSection";
import { TeamManagementSection, type TeamMemberRow } from "./TeamManagementSection";
import {
  CLOSING_NO_SHOW_ROWS,
  CLOSING_PRODUCTION_ROWS,
  DAILY_PRODUCTIVITY_ROWS,
  DAILY_PRODUCTIVITY_SECTIONS,
  PRODUCTIVITY_CHANNELS,
  createEmptyMetricMatrix,
  normalizeMetricMatrix,
  sumMetricMatrix,
  type MetricMatrix,
  type MetricRowDefinition,
  type MetricSectionDefinition,
  type ProductivityChannelKey,
} from "@/lib/productivityConfig";
import type {
  ProductivityClosingBoard,
  ProductivityDailyBoard,
  ProductivityDistributionState,
  ProductivityKanbanSnapshot,
  ProductivityLeadAgent,
  ProductivityWorkspace,
} from "@/types/productivity";

interface ProductivityClientProps {
  initialWorkspace: ProductivityWorkspace;
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyDaily(): MetricMatrix {
  return createEmptyMetricMatrix(DAILY_PRODUCTIVITY_ROWS);
}

function emptyNoShow(): MetricMatrix {
  return createEmptyMetricMatrix(CLOSING_NO_SHOW_ROWS);
}

function emptyProduction(): MetricMatrix {
  return createEmptyMetricMatrix(CLOSING_PRODUCTION_ROWS);
}

function boardKey(email: string, date: string): string {
  return `${email.toLowerCase()}::${date}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const [year, month, day] = value.slice(0, 10).split("-");
  return day && month && year ? `${day}/${month}/${year}` : value;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Pendente";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function numberValue(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function MetricInputTable({
  title,
  sections,
  rows,
  matrix,
  onChange,
}: {
  title: string;
  sections?: MetricSectionDefinition[];
  rows?: MetricRowDefinition[];
  matrix: MetricMatrix;
  onChange: (rowKey: string, channelKey: ProductivityChannelKey, value: number) => void;
}) {
  const rowGroups = sections ?? [{ key: title, label: title, rows: rows ?? [] }];

  return (
    <section className="overflow-hidden rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
      <div className="flex min-h-11 items-center justify-between border-b border-[rgb(var(--border-weak))] px-4">
        <h2 className="text-sm font-semibold text-[rgb(var(--slate-12))]">{title}</h2>
        <span className="text-xs text-[rgb(var(--slate-10))]">{sumMetricMatrix(matrix).toLocaleString("pt-BR")} total</span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[1060px] table-fixed border-collapse">
          <thead>
            <tr className="bg-[rgb(var(--slate-2))]">
              <th className="w-48 border-b border-r border-[rgb(var(--border-weak))] px-3 py-2 text-left text-xs font-semibold text-[rgb(var(--slate-11))]">
                Modalidade / Canal
              </th>
              {PRODUCTIVITY_CHANNELS.map((channel) => (
                <th
                  key={channel.key}
                  className="w-28 border-b border-r border-[rgb(var(--border-weak))] px-2 py-2 text-center text-[11px] font-semibold leading-tight text-[rgb(var(--slate-11))]"
                >
                  {channel.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowGroups.map((group) => (
              <Fragment key={group.key}>
                {sections ? (
                  <tr key={`${group.key}-section`}>
                    <td
                      colSpan={PRODUCTIVITY_CHANNELS.length + 1}
                      className="border-b border-[rgb(var(--border-weak))] bg-[rgb(var(--blue-2))] px-3 py-2 text-center text-sm font-semibold text-[rgb(var(--blue-11))]"
                    >
                      {group.label}
                    </td>
                  </tr>
                ) : null}
                {group.rows.map((row) => (
                  <tr key={row.key} className="hover:bg-[rgb(var(--slate-1))]">
                    <th className="border-b border-r border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-2))] px-3 py-2 text-left text-xs font-semibold text-[rgb(var(--slate-12))]">
                      <span className="flex items-center gap-1.5">
                        {row.label}
                        {row.automatic && (
                          <span
                            title="Calculado automaticamente a partir do Kanban"
                            className="rounded-full bg-[rgb(var(--blue-3))] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[rgb(var(--blue-11))]"
                          >
                            Auto
                          </span>
                        )}
                      </span>
                    </th>
                    {PRODUCTIVITY_CHANNELS.map((channel) => (
                      <td key={channel.key} className="border-b border-r border-[rgb(var(--border-weak))] p-1">
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={matrix[row.key]?.[channel.key] ?? 0}
                          onChange={(event) => onChange(row.key, channel.key, numberValue(event.target.value))}
                          disabled={row.automatic}
                          aria-label={`${row.label} - ${channel.label}`}
                          className={`h-9 w-full rounded-md border border-transparent px-2 text-center text-sm outline-none transition ${
                            row.automatic
                              ? "bg-[rgb(var(--slate-2))] text-[rgb(var(--slate-10))]"
                              : "bg-transparent text-[rgb(var(--slate-12))] focus:border-[rgb(var(--blue-7))] focus:bg-white focus:ring-2 focus:ring-[rgb(var(--blue-3))]"
                          }`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-4 py-3 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
      <p className="text-xs font-medium text-[rgb(var(--slate-10))]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-[rgb(var(--slate-12))]">{value}</p>
    </div>
  );
}

const STAGE_COLORS: Record<string, string> = {
  novo: "#64748B",
  primeiro_contato: "#7C3AED",
  em_atendimento: "#0EA5E9",
  agendado: "#F59E0B",
  fechamento: "#22C55E",
  ganho: "#16A34A",
  perdido: "#EF4444",
  no_show: "#F97316",
};

function KanbanPanel({ kanban }: { kanban: ProductivityKanbanSnapshot }) {
  const maxStageTotal = Math.max(1, ...kanban.stageMetrics.map((stage) => stage.total));
  const topConsultants = kanban.consultantMetrics.slice(0, 8);

  return (
    <section className="space-y-4 rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-[rgb(var(--slate-12))]">
          <Columns3 className="h-4 w-4 text-[rgb(var(--blue-9))]" />
          Kanban e produtividade
        </h2>
        <p className="text-sm text-[rgb(var(--slate-10))]">
          Carga atual por etapa, responsavel e movimentacao do periodo selecionado.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Leads" value={kanban.totalLeads.toLocaleString("pt-BR")} />
        <MetricCard label="Sem responsavel" value={kanban.unassignedLeads.toLocaleString("pt-BR")} />
        <MetricCard label="Movimentados" value={kanban.updatedInPeriod.toLocaleString("pt-BR")} />
        <MetricCard label="Distribuidos" value={kanban.distributedInPeriod.toLocaleString("pt-BR")} />
      </div>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-[rgb(var(--blue-9))]" />
            <h3 className="text-sm font-semibold text-[rgb(var(--slate-12))]">Etapas</h3>
          </div>
          <div className="space-y-2">
            {kanban.stageMetrics.map((stage) => (
              <div key={stage.stage} className="rounded-lg border border-[rgb(var(--border-weak))] px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[rgb(var(--slate-12))]">{stage.stageName}</p>
                    <p className="truncate text-xs text-[rgb(var(--slate-10))]">
                      {stage.unassigned} sem responsavel
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-[rgb(var(--slate-12))]">{stage.total}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[rgb(var(--slate-3))]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(4, Math.round((stage.total / maxStageTotal) * 100))}%`,
                      backgroundColor: STAGE_COLORS[stage.stage] ?? "#64748B",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-[rgb(var(--blue-9))]" />
            <h3 className="text-sm font-semibold text-[rgb(var(--slate-12))]">Consultores</h3>
          </div>
          <div className="overflow-hidden rounded-lg border border-[rgb(var(--border-weak))]">
            <table className="w-full table-fixed">
              <thead className="bg-[rgb(var(--slate-2))]">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[rgb(var(--slate-11))]">Nome</th>
                  <th className="w-20 px-2 py-2 text-right text-xs font-semibold text-[rgb(var(--slate-11))]">Total</th>
                  <th className="w-24 px-2 py-2 text-right text-xs font-semibold text-[rgb(var(--slate-11))]">Producao</th>
                  <th className="w-24 px-2 py-2 text-right text-xs font-semibold text-[rgb(var(--slate-11))]">Periodo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgb(var(--border-weak))]">
                {topConsultants.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-sm text-[rgb(var(--slate-10))]">
                      Nenhuma movimentacao encontrada no periodo.
                    </td>
                  </tr>
                ) : (
                  topConsultants.map((consultant) => (
                    <tr key={consultant.teamMemberId ?? consultant.email ?? "unassigned"} className="hover:bg-[rgb(var(--slate-1))]">
                      <td className="min-w-0 px-3 py-2">
                        <p className="truncate text-sm font-semibold text-[rgb(var(--slate-12))]">{consultant.name}</p>
                        <p className="truncate text-xs text-[rgb(var(--slate-10))]">{consultant.email}</p>
                      </td>
                      <td className="px-2 py-2 text-right text-sm font-semibold text-[rgb(var(--slate-12))]">{consultant.total}</td>
                      <td className="px-2 py-2 text-right text-sm text-[rgb(var(--slate-11))]">{consultant.producao}</td>
                      <td className="px-2 py-2 text-right text-sm text-[rgb(var(--slate-11))]">{consultant.updatedInPeriod}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {kanban.recentCards.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-[rgb(var(--slate-12))]">Ultimas movimentacoes</h3>
          <div className="grid gap-2 lg:grid-cols-2">
            {kanban.recentCards.slice(0, 6).map((card) => (
              <div
                key={card.inscricaoId}
                className="grid grid-cols-[1fr_auto] gap-3 rounded-lg border border-[rgb(var(--border-weak))] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[rgb(var(--slate-12))]">
                    {card.contactName || `Lead #${card.inscricaoId}`}
                  </p>
                  <p className="truncate text-xs text-[rgb(var(--slate-10))]">
                    {card.stageName} - {card.assigneeName || "Sem responsavel"}
                  </p>
                </div>
                <span className="self-center rounded-md bg-[rgb(var(--slate-2))] px-2 py-1 text-xs font-semibold text-[rgb(var(--slate-11))]">
                  #{card.inscricaoId}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function VerificationBadge({ board }: { board?: ProductivityDailyBoard | ProductivityClosingBoard | null }) {
  if (!board) {
    return <span className="rounded-full bg-[rgb(var(--slate-3))] px-2.5 py-1 text-xs font-semibold text-[rgb(var(--slate-11))]">Nao salvo</span>;
  }

  return board.verifiedAt ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
      <CheckCircle2 className="h-3.5 w-3.5" />
      Verificado
    </span>
  ) : (
    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">Pendente</span>
  );
}

function DistributionPanel({
  distribution,
  onDistributionChange,
}: {
  distribution: ProductivityDistributionState;
  onDistributionChange: (distribution: ProductivityDistributionState) => void;
}) {
  const [agents, setAgents] = useState(distribution.agents);
  const [limit, setLimit] = useState(5);
  const [saving, setSaving] = useState(false);
  const [distributing, setDistributing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setAgents(distribution.agents);
  }, [distribution.agents]);

  function updateAgent(id: number, changes: Partial<ProductivityLeadAgent>) {
    setAgents((current) =>
      current.map((agent) =>
        agent.chatwootUserId === id ? { ...agent, ...changes } : agent
      )
    );
  }

  async function saveOrder() {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/productivity/distribution", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agents: agents.map((agent) => ({
            chatwootUserId: agent.chatwootUserId,
            active: agent.active,
            position: agent.position,
          })),
        }),
      });
      const data = (await response.json()) as { distribution?: ProductivityDistributionState; error?: string };
      if (!response.ok || !data.distribution) {
        throw new Error(data.error ?? "Falha ao salvar ordem.");
      }
      onDistributionChange(data.distribution);
      setMessage("Ordem salva.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao salvar ordem.");
    } finally {
      setSaving(false);
    }
  }

  async function distribute() {
    setDistributing(true);
    setMessage(null);
    try {
      const response = await fetch("/api/productivity/distribution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit }),
      });
      const data = (await response.json()) as { distribution?: ProductivityDistributionState; error?: string };
      if (!response.ok || !data.distribution) {
        throw new Error(data.error ?? "Falha ao distribuir leads.");
      }
      onDistributionChange(data.distribution);
      setMessage(`${data.distribution.lastAssignments.length} lead(s) distribuido(s).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao distribuir leads.");
    } finally {
      setDistributing(false);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-[rgb(var(--slate-12))]">
            <Send className="h-4 w-4 text-[rgb(var(--blue-9))]" />
            Distribuicao de leads
          </h2>
          <p className="text-sm text-[rgb(var(--slate-10))]">
            Ordem dos usuarios que recebem leads novos sem responsavel.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={1}
            max={50}
            value={limit}
            onChange={(event) => setLimit(Math.max(1, Math.min(50, numberValue(event.target.value))))}
            className="h-9 w-20 rounded-lg border border-[rgb(var(--border-strong))] px-2 text-sm"
            title="Quantidade de leads"
            aria-label="Quantidade de leads para distribuir"
          />
          <button
            type="button"
            onClick={distribute}
            disabled={distributing || distribution.queue.length === 0}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[rgb(var(--blue-9))] px-3 text-sm font-semibold text-white transition hover:bg-[rgb(var(--blue-10))] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {distributing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Distribuir
          </button>
        </div>
      </div>

      {message ? <p className="rounded-lg bg-[rgb(var(--slate-2))] px-3 py-2 text-sm text-[rgb(var(--slate-11))]">{message}</p> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(340px,1.1fr)]">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[rgb(var(--slate-12))]">Usuarios na ordem</h3>
            <button
              type="button"
              onClick={saveOrder}
              disabled={saving}
              className="inline-flex h-8 items-center gap-2 rounded-lg border border-[rgb(var(--border-strong))] px-3 text-xs font-semibold text-[rgb(var(--slate-11))] transition hover:bg-[rgba(var(--alpha-2))] disabled:opacity-50"
            >
              {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Salvar
            </button>
          </div>
          <div className="overflow-hidden rounded-lg border border-[rgb(var(--border-weak))]">
            {agents.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-[rgb(var(--slate-10))]">
                Nenhum integrante da equipe cadastrado.
              </p>
            ) : (
              <div className="max-h-[330px] overflow-y-auto">
                {agents.map((agent) => (
                  <div
                    key={agent.chatwootUserId}
                    className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-[rgb(var(--border-weak))] px-3 py-2 last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      checked={agent.active}
                      onChange={(event) => updateAgent(agent.chatwootUserId, { active: event.target.checked })}
                      className="h-4 w-4 rounded border-[rgb(var(--border-strong))]"
                      title="Ativo na distribuicao"
                      aria-label={`Ativar ${agent.name} na distribuicao`}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[rgb(var(--slate-12))]">{agent.name}</p>
                      <p className="truncate text-xs text-[rgb(var(--slate-10))]">{agent.email}</p>
                    </div>
                    <input
                      type="number"
                      min={1}
                      value={agent.position}
                      onChange={(event) => updateAgent(agent.chatwootUserId, { position: numberValue(event.target.value) || 1 })}
                      className="h-8 w-16 rounded-md border border-[rgb(var(--border-strong))] px-2 text-center text-sm"
                      title="Posicao na fila"
                      aria-label={`Posicao de ${agent.name} na fila`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[rgb(var(--slate-12))]">Fila sem responsavel</h3>
            <span className="text-xs text-[rgb(var(--slate-10))]">{distribution.queue.length} leads</span>
          </div>
          <div className="overflow-hidden rounded-lg border border-[rgb(var(--border-weak))]">
            {distribution.queue.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-[rgb(var(--slate-10))]">
                Nenhum lead novo sem responsavel.
              </p>
            ) : (
              <div className="max-h-[330px] overflow-y-auto">
                {distribution.queue.map((item) => (
                  <div key={item.inscricaoId} className="border-b border-[rgb(var(--border-weak))] px-3 py-2 last:border-b-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[rgb(var(--slate-12))]">
                          {item.name || `Lead #${item.inscricaoId}`}
                        </p>
                        <p className="truncate text-xs text-[rgb(var(--slate-10))]">
                          {item.phone || "Sem telefone"} {item.trainingLabel ? `- ${item.trainingLabel}` : ""}
                        </p>
                      </div>
                      <span className="rounded-md bg-[rgb(var(--slate-2))] px-2 py-1 text-xs font-semibold text-[rgb(var(--slate-11))]">
                        #{item.inscricaoId}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function ProductivityClient({ initialWorkspace }: ProductivityClientProps) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [selectedDate, setSelectedDate] = useState(todayDate());
  const [rangeFrom, setRangeFrom] = useState(initialWorkspace.dateFrom);
  const [rangeTo, setRangeTo] = useState(initialWorkspace.dateTo);
  const [dailyMetrics, setDailyMetrics] = useState<MetricMatrix>(emptyDaily);
  const [noShowMetrics, setNoShowMetrics] = useState<MetricMatrix>(emptyNoShow);
  const [productionMetrics, setProductionMetrics] = useState<MetricMatrix>(emptyProduction);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [specialistSignature, setSpecialistSignature] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingPeriod, setLoadingPeriod] = useState(false);
  const [verifying, setVerifying] = useState<"daily" | "closing" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Selecao unica ("meus dados" / "geral" / colaborador especifico) que
  // controla o Kanban E os 3 relatorios ao mesmo tempo — usuario comum fica
  // travado em "mine" (a API ja garante isso, mas nem mostramos o seletor).
  const [kanbanMode, setKanbanMode] = useState<"mine" | "all" | "member">("mine");
  const [kanbanMemberEmail, setKanbanMemberEmail] = useState("");
  const [channelMetrics, setChannelMetrics] = useState<Record<string, Record<string, number>>>({});

  const scopeEmail = !workspace.isManager
    ? workspace.currentUser.email
    : kanbanMode === "mine"
      ? workspace.currentUser.email
      : kanbanMode === "member"
        ? kanbanMemberEmail || workspace.currentUser.email
        : null; // "all" => Geral, sem filtro

  const dailyByKey = useMemo(() => {
    const map = new Map<string, ProductivityDailyBoard>();
    for (const board of workspace.dailyBoards) {
      map.set(boardKey(board.consultantEmail, board.reportDate), board);
    }
    return map;
  }, [workspace.dailyBoards]);

  const closingByKey = useMemo(() => {
    const map = new Map<string, ProductivityClosingBoard>();
    for (const board of workspace.closingBoards) {
      map.set(boardKey(board.consultantEmail, board.reportDate), board);
    }
    return map;
  }, [workspace.closingBoards]);

  // Alvo para os campos manuais (indicacoes/avaliacao/pastas): segue a MESMA
  // selecao do Kanban (scopeEmail). Quando o admin escolhe "Geral", nao ha
  // uma pessoa unica para editar — os campos manuais ficam desabilitados
  // (ver isManualEditable abaixo).
  const selectedConsultant = useMemo(() => {
    const targetEmail = scopeEmail ?? workspace.currentUser.email;
    return (
      workspace.consultants.find((consultant) => consultant.email === targetEmail) ??
      workspace.consultants[0] ?? {
        userId: workspace.currentUser.id,
        email: targetEmail,
        name: workspace.currentUser.name,
      }
    );
  }, [scopeEmail, workspace.consultants, workspace.currentUser]);

  const isManualEditable = scopeEmail !== null;

  const currentDailyBoard = dailyByKey.get(boardKey(selectedConsultant.email, selectedDate)) ?? null;
  const currentClosingBoard = closingByKey.get(boardKey(selectedConsultant.email, selectedDate)) ?? null;

  // Metrica do Kanban para o escopo selecionado — soma de todo mundo quando
  // "Geral" (scopeEmail === null), ou so da pessoa escolhida.
  const scopedKanbanMetric = useMemo(() => {
    const zero = { tentativas: 0, conexoes: 0, agendamentos: 0, consultorias: 0, noShow: 0, producao: 0 };
    if (scopeEmail === null) {
      return workspace.kanban.consultantMetrics.reduce((acc, m) => ({
        tentativas: acc.tentativas + m.tentativas,
        conexoes: acc.conexoes + m.conexoes,
        agendamentos: acc.agendamentos + m.agendamentos,
        consultorias: acc.consultorias + m.consultorias,
        noShow: acc.noShow + m.noShow,
        producao: acc.producao + m.producao,
      }), zero);
    }
    return workspace.kanban.consultantMetrics.find((m) => m.email === scopeEmail) ?? zero;
  }, [workspace.kanban.consultantMetrics, scopeEmail]);

  // Busca a distribuicao (estimada) por canal de aquisicao para o mesmo
  // escopo/periodo — usada so para preencher as celulas das linhas
  // automaticas; o total oficial de cada metrica e sempre scopedKanbanMetric.
  useEffect(() => {
    const params = new URLSearchParams({ dateFrom: rangeFrom, dateTo: rangeTo });
    if (scopeEmail) params.set("sellerEmail", scopeEmail);
    fetch(`/api/productivity/channel-metrics?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { matrix?: Record<string, Record<string, number>> } | null) => {
        setChannelMetrics(data?.matrix ?? {});
      })
      .catch(() => setChannelMetrics({}));
  }, [rangeFrom, rangeTo, scopeEmail]);

  function withAutomaticRow(rowKey: string, total: number): Record<ProductivityChannelKey, number> {
    const base = normalizeMetricMatrix(channelMetrics, [{ key: rowKey, label: rowKey }])[rowKey];
    const classifiedTotal = Object.values(base).reduce((sum, value) => sum + value, 0);
    // Sobra nao classificada pelo estimador entra na primeira coluna, so pra
    // o total da linha nunca ficar visivelmente menor que o numero oficial.
    const remainder = Math.max(0, total - classifiedTotal);
    const firstChannel = PRODUCTIVITY_CHANNELS[0]?.key;
    if (remainder > 0 && firstChannel) {
      return { ...base, [firstChannel]: base[firstChannel] + remainder };
    }
    return base;
  }

  // Linhas automaticas (ver MetricRowDefinition.automatic) sao sempre
  // recalculadas ao vivo a partir do Kanban — nunca vem de um valor salvo.
  // Linhas manuais continuam vindo do board salvo (ou vazias, editaveis).
  useEffect(() => {
    const closing = closingByKey.get(boardKey(selectedConsultant.email, selectedDate));

    setDailyMetrics({
      tentativas: withAutomaticRow("tentativas", scopedKanbanMetric.tentativas),
      conexoes: withAutomaticRow("conexoes", scopedKanbanMetric.conexoes),
      agendamentos: withAutomaticRow("agendamentos", scopedKanbanMetric.agendamentos),
      consultorias: withAutomaticRow("consultorias", scopedKanbanMetric.consultorias),
    });

    setNoShowMetrics({
      nao_comparecimentos: withAutomaticRow("nao_comparecimentos", scopedKanbanMetric.noShow),
    });

    const manualProduction = closing
      ? normalizeMetricMatrix(closing.productionMetrics, CLOSING_PRODUCTION_ROWS)
      : emptyProduction();
    setProductionMetrics({
      ...manualProduction,
      tentativas: withAutomaticRow("tentativas", scopedKanbanMetric.tentativas),
      conexoes: withAutomaticRow("conexoes", scopedKanbanMetric.conexoes),
      agendamentos: withAutomaticRow("agendamentos", scopedKanbanMetric.agendamentos),
      consultorias: withAutomaticRow("consultorias", scopedKanbanMetric.consultorias),
      producao: withAutomaticRow("producao", scopedKanbanMetric.producao),
    });

    setDeliveryDate(closing?.deliveryDate ?? "");
    setSpecialistSignature(closing?.specialistSignature ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closingByKey, selectedConsultant.email, selectedDate, scopedKanbanMetric, channelMetrics]);

  function updateMatrix(
    setter: Dispatch<SetStateAction<MetricMatrix>>,
    rowKey: string,
    channelKey: ProductivityChannelKey,
    value: number
  ) {
    setter((current) => ({
      ...current,
      [rowKey]: {
        ...current[rowKey],
        [channelKey]: value,
      },
    }));
  }

  async function refreshWorkspace(dateFrom = rangeFrom, dateTo = rangeTo) {
    setLoadingPeriod(true);
    setMessage(null);
    try {
      const params = new URLSearchParams({ dateFrom, dateTo });
      const response = await fetch(`/api/productivity/reports?${params.toString()}`, { method: "GET" });
      const data = (await response.json()) as { workspace?: ProductivityWorkspace; error?: string };
      if (!response.ok || !data.workspace) {
        throw new Error(data.error ?? "Falha ao atualizar periodo.");
      }
      setWorkspace(data.workspace);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao atualizar periodo.");
    } finally {
      setLoadingPeriod(false);
    }
  }

  async function saveBoards() {
    setSaving(true);
    setMessage(null);
    const effectiveRangeFrom = selectedDate < rangeFrom ? selectedDate : rangeFrom;
    const effectiveRangeTo = selectedDate > rangeTo ? selectedDate : rangeTo;
    try {
      const response = await fetch("/api/productivity/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportDate: selectedDate,
          consultantUserId: selectedConsultant.userId,
          consultantEmail: selectedConsultant.email,
          consultantName: selectedConsultant.name,
          dailyMetrics,
          noShowMetrics,
          productionMetrics,
          deliveryDate: deliveryDate || null,
          specialistSignature: specialistSignature || null,
          dateFrom: effectiveRangeFrom,
          dateTo: effectiveRangeTo,
        }),
      });
      const data = (await response.json()) as { workspace?: ProductivityWorkspace; error?: string };
      if (!response.ok || !data.workspace) {
        throw new Error(data.error ?? "Falha ao salvar.");
      }
      setWorkspace(data.workspace);
      setRangeFrom(effectiveRangeFrom);
      setRangeTo(effectiveRangeTo);
      setMessage("Produtividade salva.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function verify(model: "daily" | "closing") {
    const board = model === "daily" ? currentDailyBoard : currentClosingBoard;
    if (!board) {
      setMessage("Salve a tabela antes de verificar.");
      return;
    }

    setVerifying(model);
    setMessage(null);
    try {
      const response = await fetch(`/api/productivity/reports/${model}/${board.id}/verify`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom: rangeFrom, dateTo: rangeTo }),
      });
      const data = (await response.json()) as { workspace?: ProductivityWorkspace; error?: string };
      if (!response.ok || !data.workspace) {
        throw new Error(data.error ?? "Falha ao verificar.");
      }
      setWorkspace(data.workspace);
      setMessage("Registro verificado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao verificar.");
    } finally {
      setVerifying(null);
    }
  }

  return (
    <main className="space-y-5">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-3 py-1 text-xs font-semibold text-[rgb(var(--slate-11))]">
            <ClipboardList className="h-3.5 w-3.5 text-[rgb(var(--blue-9))]" />
            Diario de bordo
          </div>
          <h1 className="text-2xl font-semibold text-[rgb(var(--slate-12))]">Produtividade Vox Tatuape</h1>
          <p className="mt-1 text-sm text-[rgb(var(--slate-10))]">
            Preenchimento diario por consultor, verificacao de gestores, Kanban e distribuicao de leads da equipe.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[150px_150px_auto]">
          <label className="grid gap-1 text-xs font-semibold text-[rgb(var(--slate-10))]">
            De
            <input
              type="date"
              value={rangeFrom}
              onChange={(event) => setRangeFrom(event.target.value)}
              className="h-10 rounded-lg border border-[rgb(var(--border-strong))] bg-white px-3 text-sm text-[rgb(var(--slate-12))]"
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-[rgb(var(--slate-10))]">
            Ate
            <input
              type="date"
              value={rangeTo}
              onChange={(event) => setRangeTo(event.target.value)}
              className="h-10 rounded-lg border border-[rgb(var(--border-strong))] bg-white px-3 text-sm text-[rgb(var(--slate-12))]"
            />
          </label>
          <button
            type="button"
            onClick={() => refreshWorkspace()}
            disabled={loadingPeriod}
            className="mt-auto inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[rgb(var(--border-strong))] bg-[rgb(var(--surface-1))] px-4 text-sm font-semibold text-[rgb(var(--slate-11))] transition hover:bg-[rgba(var(--alpha-2))] disabled:opacity-50"
          >
            {loadingPeriod ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
            Aplicar
          </button>
        </div>
      </header>

      {message ? (
        <div className="rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-4 py-3 text-sm text-[rgb(var(--slate-11))]">
          {message}
        </div>
      ) : null}

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Tentativas" value={scopedKanbanMetric.tentativas.toLocaleString("pt-BR")} />
        <MetricCard label="Conexoes" value={scopedKanbanMetric.conexoes.toLocaleString("pt-BR")} />
        <MetricCard label="Agendamentos" value={scopedKanbanMetric.agendamentos.toLocaleString("pt-BR")} />
        <MetricCard label="Consultorias" value={scopedKanbanMetric.consultorias.toLocaleString("pt-BR")} />
        <MetricCard label="Bolos" value={scopedKanbanMetric.noShow.toLocaleString("pt-BR")} />
        <MetricCard label="Pendencias" value={workspace.summary.pendingVerification.toLocaleString("pt-BR")} />
      </section>

      {workspace.isManager ? <KanbanPanel kanban={workspace.kanban} /> : null}

      <KanbanSection
        isManager={workspace.isManager}
        currentUserEmail={workspace.currentUser.email}
        teamMembers={workspace.distribution.agents}
        mode={kanbanMode}
        memberEmail={kanbanMemberEmail}
        onModeChange={setKanbanMode}
        onMemberEmailChange={setKanbanMemberEmail}
        onLeadMoved={refreshWorkspace}
      />

      <section className="space-y-4 rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,0.7fr)_minmax(160px,0.4fr)_auto] lg:items-end">
          <label className="grid gap-1 text-xs font-semibold text-[rgb(var(--slate-10))]">
            Colaborador (campos manuais)
            <div className="flex h-10 items-center rounded-lg border border-[rgb(var(--border-strong))] bg-[rgb(var(--slate-2))] px-3 text-sm text-[rgb(var(--slate-12))]">
              {isManualEditable ? selectedConsultant.name : "Geral — selecione um colaborador no Kanban para editar"}
            </div>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-[rgb(var(--slate-10))]">
            Data
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              className="h-10 rounded-lg border border-[rgb(var(--border-strong))] bg-white px-3 text-sm text-[rgb(var(--slate-12))]"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <VerificationBadge board={currentDailyBoard} />
            <VerificationBadge board={currentClosingBoard} />
            <button
              type="button"
              onClick={saveBoards}
              disabled={saving || !isManualEditable}
              title={isManualEditable ? undefined : "Selecione um colaborador (nao 'Geral') para salvar campos manuais"}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[rgb(var(--slate-12))] px-4 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-50"
            >
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar
            </button>
          </div>
        </div>

        {workspace.isManager ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[rgb(var(--slate-2))] px-3 py-2">
            <ShieldCheck className="h-4 w-4 text-[rgb(var(--blue-9))]" />
            <span className="text-sm font-medium text-[rgb(var(--slate-12))]">Verificacao do gestor</span>
            <button
              type="button"
              disabled={!currentDailyBoard || verifying !== null}
              onClick={() => verify("daily")}
              className="inline-flex h-8 items-center gap-2 rounded-lg border border-[rgb(var(--border-strong))] bg-white px-3 text-xs font-semibold text-[rgb(var(--slate-11))] transition hover:bg-[rgba(var(--alpha-2))] disabled:opacity-50"
            >
              {verifying === "daily" ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Diario
            </button>
            <button
              type="button"
              disabled={!currentClosingBoard || verifying !== null}
              onClick={() => verify("closing")}
              className="inline-flex h-8 items-center gap-2 rounded-lg border border-[rgb(var(--border-strong))] bg-white px-3 text-xs font-semibold text-[rgb(var(--slate-11))] transition hover:bg-[rgba(var(--alpha-2))] disabled:opacity-50"
            >
              {verifying === "closing" ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Fechamento
            </button>
            <span className="text-xs text-[rgb(var(--slate-10))]">
              Ultima verificacao: {formatDateTime(currentDailyBoard?.verifiedAt ?? currentClosingBoard?.verifiedAt)}
            </span>
          </div>
        ) : null}
      </section>

      <MetricInputTable
        title="Diario de Bordo - Minha Produtividade"
        sections={DAILY_PRODUCTIVITY_SECTIONS}
        matrix={dailyMetrics}
        onChange={(rowKey, channelKey, value) => updateMatrix(setDailyMetrics, rowKey, channelKey, value)}
      />

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <MetricInputTable
          title="Nao Comparecimentos (bolos)"
          rows={CLOSING_NO_SHOW_ROWS}
          matrix={noShowMetrics}
          onChange={(rowKey, channelKey, value) => updateMatrix(setNoShowMetrics, rowKey, channelKey, value)}
        />
        <section className="space-y-4">
          <MetricInputTable
            title="Fechamento e Producao Diaria"
            rows={CLOSING_PRODUCTION_ROWS}
            matrix={productionMetrics}
            onChange={(rowKey, channelKey, value) => updateMatrix(setProductionMetrics, rowKey, channelKey, value)}
          />
          <div className="grid gap-3 rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_2px_rgba(28,32,36,0.04)] md:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-[rgb(var(--slate-10))]">
              Data de Entrega
              <input
                type="date"
                value={deliveryDate}
                onChange={(event) => setDeliveryDate(event.target.value)}
                className="h-10 rounded-lg border border-[rgb(var(--border-strong))] bg-white px-3 text-sm text-[rgb(var(--slate-12))]"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-[rgb(var(--slate-10))]">
              Assinatura Especialista
              <input
                type="text"
                value={specialistSignature}
                onChange={(event) => setSpecialistSignature(event.target.value)}
                className="h-10 rounded-lg border border-[rgb(var(--border-strong))] bg-white px-3 text-sm text-[rgb(var(--slate-12))]"
                placeholder={selectedConsultant.name}
              />
            </label>
          </div>
        </section>
      </div>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-[rgb(var(--blue-9))]" />
          <h2 className="text-base font-semibold text-[rgb(var(--slate-12))]">Graficos</h2>
        </div>
        <ProductivityCharts charts={workspace.charts} />
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-[rgb(var(--blue-9))]" />
          <h2 className="text-base font-semibold text-[rgb(var(--slate-12))]">
            Registros do periodo
          </h2>
        </div>
        <div className="overflow-hidden rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
          <div className="overflow-x-auto">
            <table className="min-w-[860px] table-fixed">
              <thead className="bg-[rgb(var(--slate-2))]">
                <tr>
                  <th className="w-36 px-4 py-3 text-left text-xs font-semibold text-[rgb(var(--slate-11))]">Data</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[rgb(var(--slate-11))]">Consultor</th>
                  <th className="w-32 px-4 py-3 text-right text-xs font-semibold text-[rgb(var(--slate-11))]">Diario</th>
                  <th className="w-32 px-4 py-3 text-right text-xs font-semibold text-[rgb(var(--slate-11))]">Producao</th>
                  <th className="w-40 px-4 py-3 text-left text-xs font-semibold text-[rgb(var(--slate-11))]">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgb(var(--border-weak))]">
                {workspace.dailyBoards.length === 0 && workspace.closingBoards.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-[rgb(var(--slate-10))]">
                      Nenhum registro no periodo.
                    </td>
                  </tr>
                ) : (
                  workspace.dailyBoards.map((daily) => {
                    const closing = closingByKey.get(boardKey(daily.consultantEmail, daily.reportDate));
                    return (
                      <tr key={`${daily.consultantEmail}-${daily.reportDate}`} className="hover:bg-[rgb(var(--slate-1))]">
                        <td className="px-4 py-3 text-sm text-[rgb(var(--slate-11))]">{formatDate(daily.reportDate)}</td>
                        <td className="px-4 py-3">
                          <p className="truncate text-sm font-semibold text-[rgb(var(--slate-12))]">{daily.consultantName}</p>
                          <p className="truncate text-xs text-[rgb(var(--slate-10))]">{daily.consultantEmail}</p>
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-[rgb(var(--slate-12))]">
                          {sumMetricMatrix(daily.metrics).toLocaleString("pt-BR")}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-[rgb(var(--slate-12))]">
                          {closing ? sumMetricMatrix(closing.productionMetrics).toLocaleString("pt-BR") : "-"}
                        </td>
                        <td className="px-4 py-3">
                          <VerificationBadge board={daily} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {workspace.isManager ? (
        <DistributionPanel
          distribution={workspace.distribution}
          onDistributionChange={(distribution) => setWorkspace((current) => ({ ...current, distribution }))}
        />
      ) : null}

      {workspace.isManager ? (
        <TeamManagementSection
          currentUserId={workspace.currentUser.id ?? -1}
          initialMembers={workspace.distribution.agents.map((agent): TeamMemberRow => ({
            id: agent.chatwootUserId,
            email: agent.email,
            name: agent.name,
            role: agent.role,
            active: agent.active,
            institutoUpOnly: agent.institutoUpOnly,
          }))}
        />
      ) : null}
    </main>
  );
}
