"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarCheck2,
  ChevronDown,
  ChevronRight,
  Download,
  Filter,
  MessageCircle,
  RotateCcw,
  Target,
  TrendingDown,
  Users,
  X,
} from "lucide-react";
import { useOpenLeadProfile } from "@/components/LeadProfileLauncher";
import { formatNumber, formatPercent } from "@/lib/campaignFormat";
import {
  BASIS_HINT,
  BASIS_LABEL,
  buildOriginBreakdown,
  buildSellerBreakdown,
  buildStageRows,
  formatDuration,
  leadReachedStage,
  NO_CARD_KEY,
  NO_CARD_LABEL,
  SCHEDULED_STAGE_KEY,
  summarize,
  type LeadYieldBasis,
  type LeadYieldLead,
  type LeadYieldStageDef,
} from "@/lib/leadYieldAnalysis";
import { buildWhatsAppWebUrl, humanizeName, openWhatsAppOnMobile } from "@/lib/utils";
import type { CommercialStageKind } from "@/types/inscricao";
import type { Funnel } from "@/types/funnel";

interface LeadYieldResponse {
  leads: LeadYieldLead[];
  funnels: Funnel[];
  originGroups: Array<{ key: string; label: string; emoji: string }>;
  truncated: boolean;
}

interface CampaignLeadYieldTabProps {
  from: string;
  to: string;
}

/** Origem que a tela abre marcada. O pedido nasceu de "quero ver só o que o
 * Meta trouxe" — as duas origens que a operação chama de Meta (o formulário
 * nativo "Facebook Lead Ads" e as páginas de tráfego pago "Meta Ads VozUP …")
 * caem as duas na pasta `meta` da régua de origem. */
const DEFAULT_ORIGINS = ["meta"];

const STAGE_KIND_BAR: Record<CommercialStageKind, string> = {
  entry: "bg-[rgb(var(--slate-9))]",
  normal: "bg-[rgb(var(--blue-9))]",
  won: "bg-[rgb(var(--teal-9))]",
  lost: "bg-[rgb(var(--ruby-9))]",
};

const STAGE_KIND_CHIP: Record<CommercialStageKind, string> = {
  entry: "bg-[rgb(var(--slate-3))] text-[rgb(var(--slate-11))]",
  normal: "bg-[rgb(var(--blue-3))] text-[rgb(var(--blue-11))]",
  won: "bg-[rgb(224_248_243)] text-[rgb(var(--teal-9))]",
  lost: "bg-[rgb(var(--ruby-3))] text-[rgb(var(--ruby-11))]",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "Parados em Conexão" -> "parados-em-conexao", para o nome do CSV. */
function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
}

function csvCell(value: string | number | null): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof Target;
  tone?: "won" | "lost";
}) {
  const iconColor =
    tone === "won"
      ? "text-[rgb(var(--teal-9))]"
      : tone === "lost"
        ? "text-[rgb(var(--ruby-9))]"
        : "text-[rgb(var(--blue-9))]";
  return (
    <div className="rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
      <div className="mb-2 flex items-center gap-1.5">
        <Icon className={`h-4 w-4 ${iconColor}`} />
        <span className="text-xs font-medium text-[rgb(var(--slate-10))]">{label}</span>
      </div>
      <p className="text-lg font-semibold tabular-nums text-[rgb(var(--slate-12))]">{value}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-[rgb(var(--slate-9))]">{hint}</p>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
        active
          ? "border-[rgb(var(--blue-7))] bg-[rgb(var(--blue-3))] text-[rgb(var(--blue-11))]"
          : "border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] text-[rgb(var(--slate-10))] hover:bg-[rgb(var(--slate-2))]"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * As pessoas por trás de um número. Usada nos dois lugares em que a tela
 * responde "quem são": a lista do recorte inteiro, no fim da página, e o modal
 * que abre ao clicar em qualquer contagem. Uma implementação só — a linha do
 * lead precisa ser a mesma nos dois, incluindo a trilha.
 */
function LeadRows({
  leads,
  stageLabel,
  originLabel,
  openLead,
  emptyLabel,
}: {
  leads: LeadYieldLead[];
  stageLabel: (key: string | null) => string;
  originLabel: (key: string) => string;
  openLead: ((leadId: number) => void) | null;
  emptyLabel: string;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (leads.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-[rgb(var(--slate-9))]">{emptyLabel}</p>;
  }

  return (
    <ul className="divide-y divide-[rgb(var(--border-weak))]">
      {leads.map((lead) => {
        const isOpen = expanded === lead.id;
        const agendamento = lead.trail.find((step) => step.key === SCHEDULED_STAGE_KEY);
        const whatsappUrl = lead.telefone ? buildWhatsAppWebUrl(lead.telefone) : null;
        return (
          <li key={lead.id} className="px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : lead.id)}
                className="flex items-center gap-1 text-[rgb(var(--slate-9))] hover:text-[rgb(var(--slate-12))]"
                aria-label={isOpen ? "Fechar caminho" : "Ver caminho"}
              >
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>

              {openLead ? (
                <button
                  type="button"
                  onClick={() => openLead(lead.id)}
                  className="text-left text-sm font-medium text-[rgb(var(--slate-12))] underline-offset-2 hover:text-[rgb(var(--blue-11))] hover:underline"
                  title="Abrir a ficha completa deste lead"
                >
                  {humanizeName(lead.nome) || "Sem nome"}
                </button>
              ) : (
                <span className="text-sm font-medium text-[rgb(var(--slate-12))]">
                  {humanizeName(lead.nome) || "Sem nome"}
                </span>
              )}

              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  lead.stageKind ? STAGE_KIND_CHIP[lead.stageKind] : "bg-[rgb(var(--slate-3))] text-[rgb(var(--slate-11))]"
                }`}
              >
                {stageLabel(lead.stageKey)}
              </span>

              <span className="text-[11px] text-[rgb(var(--slate-9))]">{originLabel(lead.originGroup)}</span>

              {agendamento ? (
                <span className="flex items-center gap-1 text-[11px] font-medium text-[rgb(var(--teal-9))]">
                  <CalendarCheck2 className="h-3.5 w-3.5" />
                  agendou em {formatDateTime(agendamento.at)}
                </span>
              ) : null}

              <span className="ml-auto text-[11px] tabular-nums text-[rgb(var(--slate-9))]">
                chegou {formatDateTime(lead.criadoEm)}
              </span>

              <span className="text-[11px] text-[rgb(var(--slate-10))]">{lead.sellerName ?? "sem dono"}</span>

              {whatsappUrl ? (
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => openWhatsAppOnMobile(event, lead.telefone ?? "")}
                  className="text-[rgb(var(--teal-9))] hover:opacity-80"
                  title="Abrir conversa no WhatsApp"
                >
                  <MessageCircle className="h-4 w-4" />
                </a>
              ) : null}
            </div>

            {isOpen ? (
              <div className="mt-2 space-y-2 rounded-lg bg-[rgb(var(--slate-2))] px-3 py-2">
                <p className="text-[11px] text-[rgb(var(--slate-10))]">
                  <strong>Origem:</strong> {lead.origem}
                  {lead.campaignName ? ` · campanha ${lead.campaignName}` : ""}
                  {lead.adName ? ` · anúncio ${lead.adName}` : ""} · {lead.contactAttempts} tentativa(s) de contato
                  registradas
                  {lead.closedReason ? ` · motivo: ${lead.closedReason}` : ""}
                </p>
                {lead.trail.length === 0 ? (
                  <p className="text-[11px] text-[rgb(var(--slate-9))]">
                    Sem movimentação registrada — a pessoa nunca entrou no funil.
                  </p>
                ) : (
                  <ol className="space-y-1">
                    {lead.trail.map((step, index) => {
                      const previous = index === 0 ? lead.criadoEm : lead.trail[index - 1].at;
                      const gap = (new Date(step.at).getTime() - new Date(previous).getTime()) / 3_600_000;
                      return (
                        <li key={`${step.key}-${step.at}`} className="flex flex-wrap items-center gap-2 text-[11px]">
                          <span className="w-4 text-right tabular-nums text-[rgb(var(--slate-9))]">{index + 1}.</span>
                          <span className="font-medium text-[rgb(var(--slate-12))]">{stageLabel(step.key)}</span>
                          <span className="tabular-nums text-[rgb(var(--slate-10))]">{formatDateTime(step.at)}</span>
                          <span className="text-[rgb(var(--slate-9))]">
                            ({index === 0 ? "após a chegada" : "depois"} · {formatDuration(gap)})
                          </span>
                          {step.actor ? <span className="text-[rgb(var(--slate-9))]">por {step.actor}</span> : null}
                          {step.inWindow ? (
                            <span className="rounded bg-[rgb(var(--blue-3))] px-1.5 py-0.5 text-[10px] text-[rgb(var(--blue-11))]">
                              dentro do período
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Número clicável. Existe como componente porque a tela inteira segue a mesma
 * promessa: todo número abre as pessoas que ele conta. */
function CountButton({
  value,
  onClick,
  title,
  strong,
  muted,
  tone,
}: {
  value: number;
  onClick: () => void;
  title: string;
  strong?: boolean;
  muted?: boolean;
  tone?: "won" | "lost";
}) {
  // Zero não abre nada: um botão que abre lista vazia só frustra o clique.
  if (value === 0) {
    return <span className="px-1.5 tabular-nums text-[rgb(var(--slate-8))]">0</span>;
  }

  const color =
    tone === "won"
      ? "font-semibold text-[rgb(var(--teal-9))]"
      : tone === "lost"
        ? "text-[rgb(var(--ruby-11))]"
        : strong
          ? "font-semibold text-[rgb(var(--slate-12))]"
          : muted
            ? "text-[rgb(var(--slate-10))]"
            : "text-[rgb(var(--slate-11))]";

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded px-1.5 py-0.5 tabular-nums underline decoration-dotted underline-offset-2 transition hover:bg-[rgb(var(--blue-3))] hover:text-[rgb(var(--blue-11))] hover:decoration-solid ${color}`}
    >
      {formatNumber(value)}
    </button>
  );
}

/** Modal com as pessoas de um número clicado. */
function LeadDetailModal({
  title,
  hint,
  leads,
  stageLabel,
  originLabel,
  openLead,
  onExport,
  onClose,
}: {
  title: string;
  hint: string;
  leads: LeadYieldLead[];
  stageLabel: (key: string | null) => string;
  originLabel: (key: string) => string;
  openLead: ((leadId: number) => void) | null;
  onExport: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-[rgb(var(--surface-1))] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[rgb(var(--border-weak))] px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[rgb(var(--slate-12))]">
              {title} <span className="tabular-nums text-[rgb(var(--slate-9))]">({formatNumber(leads.length)})</span>
            </h3>
            <p className="mt-0.5 text-xs text-[rgb(var(--slate-9))]">
              {hint} Abra uma linha para ver o caminho completo.
            </p>
          </div>
          <div className="flex flex-none items-center gap-2">
            <button
              type="button"
              onClick={onExport}
              className="flex items-center gap-1.5 rounded-md border border-[rgb(var(--border-weak))] px-2.5 py-1 text-xs font-medium text-[rgb(var(--slate-11))] hover:bg-[rgb(var(--slate-2))]"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="rounded-md p-1 text-[rgb(var(--slate-10))] hover:bg-[rgb(var(--slate-3))]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>
        <div className="overflow-y-auto">
          <LeadRows
            leads={leads}
            stageLabel={stageLabel}
            originLabel={originLabel}
            openLead={openLead}
            emptyLabel="Nenhuma pessoa aqui."
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Rendimento do lead: onde as pessoas de um recorte pararam no funil.
 *
 * A tela existe porque o Kanban é um quadro só — Meta, landing page e aula
 * exclusiva dividem as mesmas colunas — e "27 em Conexão" não responde quantos
 * desses o anúncio pagou. Aqui a origem é escolhida primeiro e TODA a
 * contagem é feita sobre o recorte.
 *
 * Os dados chegam uma vez por período (uma pessoa por linha, com a trilha de
 * etapas) e todo o resto — origem, funil, vendedor, etapa, busca — é filtrado
 * no navegador, para cruzar filtro sem esperar o servidor.
 */
export default function CampaignLeadYieldTab({ from, to }: CampaignLeadYieldTabProps) {
  const openLead = useOpenLeadProfile();

  const [basis, setBasis] = useState<LeadYieldBasis>("chegada");
  const [data, setData] = useState<LeadYieldResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [origins, setOrigins] = useState<string[]>(DEFAULT_ORIGINS);
  const [funnelId, setFunnelId] = useState<number | "all">("all");
  const [sellers, setSellers] = useState<string[]>([]);
  const [includeNoCard, setIncludeNoCard] = useState(true);
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  /** Recorte aberto por um clique em número — ver openDetail. */
  const [detail, setDetail] = useState<{ title: string; hint: string; leads: LeadYieldLead[] } | null>(null);

  useEffect(() => {
    let active = true;
    // Trocar período ou base de data troca o conjunto inteiro: voltar ao
    // esqueleto é o comportamento certo, e é o mesmo das outras abas.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    fetch(`/api/campanhas/rendimento?from=${from}&to=${to}&base=${basis}`)
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok) throw new Error(json?.error ?? "Falha ao carregar.");
        return json as LeadYieldResponse;
      })
      .then((json) => {
        if (!active) return;
        setData(json);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [from, to, basis]);

  const allLeads = useMemo(() => data?.leads ?? [], [data]);

  // As etapas mostradas são as do funil escolhido; em "todos os funis" o funil
  // padrão manda, porque é onde praticamente todo card vive — e a tela avisa
  // quando existe card em outro funil dentro do recorte.
  const funnelForStages = useMemo(() => {
    if (!data) return null;
    if (funnelId !== "all") return data.funnels.find((funnel) => funnel.id === funnelId) ?? null;
    return data.funnels.find((funnel) => funnel.isDefault) ?? data.funnels[0] ?? null;
  }, [data, funnelId]);

  const stages: LeadYieldStageDef[] = useMemo(
    () =>
      (funnelForStages?.stages ?? []).map((stage) => ({
        key: stage.key,
        label: stage.label,
        kind: stage.kind,
        position: stage.position,
      })),
    [funnelForStages]
  );

  const sellerOptions = useMemo(() => {
    const names = new Set<string>();
    for (const lead of allLeads) if (lead.sellerName) names.add(lead.sellerName);
    return Array.from(names).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [allLeads]);

  /** Recorte sem o filtro de origem — é a base da matriz "mix de origens", que
   * só faz sentido comparando as origens entre si. */
  const leadsIgnoringOrigin = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allLeads.filter((lead) => {
      if (lead.stageKey === null && !includeNoCard) return false;
      if (funnelId !== "all" && lead.stageKey !== null && lead.funnelId !== funnelId) return false;
      if (sellers.length > 0 && !sellers.includes(lead.sellerName ?? "Sem dono")) return false;
      if (term) {
        const haystack = `${lead.nome ?? ""} ${lead.telefone ?? ""} ${lead.origem} ${lead.campaignName ?? ""} ${lead.adName ?? ""}`;
        if (!haystack.toLowerCase().includes(term)) return false;
      }
      return true;
    });
  }, [allLeads, funnelId, includeNoCard, search, sellers]);

  const leads = useMemo(
    () => leadsIgnoringOrigin.filter((lead) => origins.length === 0 || origins.includes(lead.originGroup)),
    [leadsIgnoringOrigin, origins]
  );

  const stageRows = useMemo(() => buildStageRows(leads, stages), [leads, stages]);
  const summary = useMemo(() => summarize(leads, stages), [leads, stages]);
  const originRows = useMemo(
    () => buildOriginBreakdown(leadsIgnoringOrigin, stages),
    [leadsIgnoringOrigin, stages]
  );
  const sellerRows = useMemo(() => buildSellerBreakdown(leads, stages), [leads, stages]);
  const entryStageKeys = useMemo(
    () => new Set(stages.filter((stage) => stage.kind === "entry").map((stage) => stage.key)),
    [stages]
  );

  const originLabel = useMemo(() => {
    const map = new Map((data?.originGroups ?? []).map((group) => [group.key, group]));
    return (key: string) => {
      const group = map.get(key);
      return group ? `${group.emoji} ${group.label}` : key;
    };
  }, [data]);

  const stageLabel = useMemo(() => {
    const map = new Map(stages.map((stage) => [stage.key, stage.label]));
    return (key: string | null) => (key === null ? NO_CARD_LABEL : (map.get(key) ?? key));
  }, [stages]);

  const sortedList = useMemo(
    () => [...leads].sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime()),
    [leads]
  );
  const visibleList = showAll ? sortedList : sortedList.slice(0, 40);

  const cardsInOtherFunnels = useMemo(() => {
    if (funnelId !== "all" || !funnelForStages) return 0;
    return leads.filter((lead) => lead.stageKey !== null && lead.funnelId !== funnelForStages.id).length;
  }, [funnelForStages, funnelId, leads]);

  function toggleOrigin(key: string) {
    setOrigins((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    );
  }

  function toggleSeller(name: string) {
    setSellers((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name]
    );
  }

  function resetFilters() {
    setOrigins(DEFAULT_ORIGINS);
    setFunnelId("all");
    setSellers([]);
    setIncludeNoCard(true);
    setSearch("");
  }

  /** Todo número da tela abre as pessoas por trás dele. Sem isto, "23 em
   * Conexão" continua sendo um número que ninguém consegue conferir — e o
   * primeiro reflexo de quem lê é clicar. */
  function openDetail(title: string, hint: string, subset: LeadYieldLead[]) {
    setDetail({
      title,
      hint,
      leads: [...subset].sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime()),
    });
  }

  function exportCsv(rows: LeadYieldLead[], suffix: string) {
    const header = [
      "Nome",
      "Telefone",
      "Origem",
      "Grupo de origem",
      "Chegada",
      "Etapa atual",
      "Vendedor",
      "Tentativas de contato",
      "Agendou",
      "Data do agendamento",
      "Campanha",
      "Anúncio",
      "Trilha",
    ];
    const lines = rows.map((lead) => {
      const agendamento = lead.trail.find((step) => step.key === SCHEDULED_STAGE_KEY);
      const trilha = lead.trail
        .map((step) => `${stageLabel(step.key)} em ${formatDateTime(step.at)}${step.actor ? ` (${step.actor})` : ""}`)
        .join(" → ");
      return [
        lead.nome ?? "",
        lead.telefone ?? "",
        lead.origem,
        originLabel(lead.originGroup),
        formatDateTime(lead.criadoEm),
        stageLabel(lead.stageKey),
        lead.sellerName ?? "Sem dono",
        lead.contactAttempts,
        agendamento ? "sim" : "não",
        agendamento ? formatDateTime(agendamento.at) : "",
        lead.campaignName ?? "",
        lead.adName ?? "",
        trilha,
      ]
        .map(csvCell)
        .join(",");
    });

    const csv = [header.map(csvCell).join(","), ...lines].join("\n");
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `rendimento-${suffix}-${from}-a-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return <div className="h-96 animate-pulse rounded-xl bg-[rgb(var(--slate-3))]" />;
  }

  if (error) {
    return (
      <div className="rounded-xl border border-[rgb(var(--ruby-6))] bg-[rgb(var(--ruby-3))] p-4 text-sm text-[rgb(var(--ruby-11))]">
        {error}
      </div>
    );
  }

  const maxStageCount = Math.max(...stageRows.map((row) => row.alcancaram), summary.semCard, 1);

  return (
    <div className="space-y-4">
      {/* ── Filtros da aba ─────────────────────────────────────────── */}
      <section
        aria-label="Filtros do rendimento"
        className="space-y-3 rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-[rgb(var(--slate-11))]">
            <Filter className="h-3.5 w-3.5" />
            {basis === "tudo" ? (
              <>
                Ignorando o período ({from.split("-").reverse().join("/")} –{" "}
                {to.split("-").reverse().join("/")}) — contando por
              </>
            ) : (
              <>
                O período ({from.split("-").reverse().join("/")} – {to.split("-").reverse().join("/")}) conta por
              </>
            )}
          </span>
          <div className="flex gap-1 rounded-md bg-[rgb(var(--slate-3))] p-1">
            {(["chegada", "movimentacao", "tudo"] as LeadYieldBasis[]).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={basis === option}
                title={BASIS_HINT[option]}
                onClick={() => setBasis(option)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                  basis === option
                    ? "bg-[rgb(var(--surface-1))] text-[rgb(var(--slate-12))] shadow-sm"
                    : "text-[rgb(var(--slate-10))] hover:text-[rgb(var(--slate-12))]"
                }`}
              >
                {BASIS_LABEL[option]}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={resetFilters}
            className="ml-auto flex items-center gap-1.5 rounded-md border border-[rgb(var(--border-weak))] px-2.5 py-1 text-xs font-medium text-[rgb(var(--slate-10))] hover:bg-[rgb(var(--slate-2))]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Limpar filtros
          </button>
        </div>

        <p className="text-[11px] leading-snug text-[rgb(var(--slate-9))]">{BASIS_HINT[basis]}</p>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-9))]">
            Origem
          </span>
          {(data?.originGroups ?? []).map((group) => {
            const total = allLeads.filter((lead) => lead.originGroup === group.key).length;
            if (total === 0 && !origins.includes(group.key)) return null;
            return (
              <Chip
                key={group.key}
                active={origins.includes(group.key)}
                onClick={() => toggleOrigin(group.key)}
                title={`${total} pessoa(s) desta origem no período`}
              >
                {group.emoji} {group.label}
                <span className="ml-1 tabular-nums opacity-70">{total}</span>
              </Chip>
            );
          })}
          {origins.length === 0 ? (
            <span className="text-[11px] text-[rgb(var(--slate-9))]">nenhuma marcada = todas</span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-[rgb(var(--slate-11))]">
            Funil
            <select
              value={funnelId === "all" ? "all" : String(funnelId)}
              onChange={(event) =>
                setFunnelId(event.target.value === "all" ? "all" : Number(event.target.value))
              }
              className="rounded-md border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-2 py-1 text-xs"
            >
              <option value="all">Todos os funis</option>
              {(data?.funnels ?? []).map((funnel) => (
                <option key={funnel.id} value={funnel.id}>
                  {funnel.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-xs text-[rgb(var(--slate-11))]">
            <input
              type="checkbox"
              checked={includeNoCard}
              onChange={(event) => setIncludeNoCard(event.target.checked)}
              className="h-3.5 w-3.5"
            />
            Incluir quem nunca entrou no funil
          </label>

          <label className="ml-auto flex min-w-[12rem] flex-1 items-center gap-1.5 text-xs sm:max-w-xs">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar pessoa, telefone, campanha…"
              className="w-full rounded-md border border-[rgb(var(--border-weak))] px-2.5 py-1.5 text-xs"
            />
          </label>
        </div>

        {sellerOptions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-9))]">
              Vendedor
            </span>
            {sellerOptions.map((name) => (
              <Chip key={name} active={sellers.includes(name)} onClick={() => toggleSeller(name)}>
                {name}
              </Chip>
            ))}
            <Chip active={sellers.includes("Sem dono")} onClick={() => toggleSeller("Sem dono")}>
              Sem dono
            </Chip>
          </div>
        ) : null}

        {data?.truncated ? (
          <p className="rounded-md bg-[rgb(var(--amber-3,var(--slate-3)))] px-2 py-1 text-[11px] text-[rgb(var(--slate-11))]">
            Período muito longo: a tela está mostrando as 6.000 pessoas mais recentes. Reduza o intervalo para
            uma contagem completa.
          </p>
        ) : null}
      </section>

      {/* ── Indicadores do recorte ─────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={Users}
          label="Pessoas no recorte"
          value={formatNumber(summary.total)}
          hint={`${formatNumber(summary.comCard)} entraram no funil · ${formatNumber(summary.semCard)} nunca entraram`}
        />
        <KpiCard
          icon={Target}
          label="Avançaram do primeiro contato"
          value={formatNumber(summary.avancaram)}
          hint={`${formatPercent(summary.total > 0 ? (summary.avancaram / summary.total) * 100 : null)} de quem entrou no recorte saiu da etapa de entrada`}
        />
        {/* Em "movimentação" a pergunta é "quantos agendaram NESTE período";
            em "chegada" é "quantos daquela leva agendaram, em qualquer
            momento". Mostrar o mesmo número nos dois modos responderia errado
            em um deles. */}
        <KpiCard
          icon={CalendarCheck2}
          label={basis === "movimentacao" ? "Agendaram no período" : "Agendaram"}
          value={formatNumber(basis === "movimentacao" ? summary.agendaramNoPeriodo : summary.agendaram)}
          hint={
            basis === "movimentacao"
              ? `${formatNumber(summary.agendaram)} já passaram por agendamento em algum momento · mediana de ${formatDuration(summary.horasAteAgendar)} entre chegar e agendar`
              : `${formatPercent(summary.total > 0 ? (summary.agendaram / summary.total) * 100 : null)} do recorte · mediana de ${formatDuration(summary.horasAteAgendar)} entre chegar e agendar`
          }
          tone="won"
        />
        <KpiCard
          icon={TrendingDown}
          label="Perdidos"
          value={formatNumber(summary.perderam)}
          hint={`${formatNumber(summary.ganharam)} em etapa de ganho · ${formatNumber(summary.semDono)} sem vendedor responsável`}
          tone="lost"
        />
      </div>

      {/* ── Onde pararam ───────────────────────────────────────────── */}
      <section className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))]">
        <header className="border-b border-[rgb(var(--border-weak))] px-4 py-3">
          <h3 className="text-sm font-semibold text-[rgb(var(--slate-12))]">
            Onde pararam — {funnelForStages?.name ?? "funil"}
          </h3>
          <p className="mt-0.5 text-xs text-[rgb(var(--slate-9))]">
            <strong>Pararam</strong> é a etapa em que a pessoa está hoje (as linhas somam o total do recorte).{" "}
            <strong>Passaram</strong> conta quem esteve na etapa em algum momento — é o funil de conversão.
            Clique em qualquer número para ver as pessoas.
          </p>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="bg-[rgb(var(--slate-2))] text-[11px] uppercase tracking-wide text-[rgb(var(--slate-9))]">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Etapa</th>
                <th className="px-3 py-2 text-right font-semibold">Pararam</th>
                <th className="px-3 py-2 text-right font-semibold">Passaram</th>
                <th className="px-3 py-2 text-right font-semibold">% do recorte</th>
                <th
                  className="px-3 py-2 text-right font-semibold"
                  title="Sobre a maior etapa anterior — etapas opcionais no meio do funil (no-show, compra futura) não servem de base."
                >
                  Conversão
                </th>
                <th
                  className="px-3 py-2 text-right font-semibold"
                  title={`Entraram nesta etapa entre ${from.split("-").reverse().join("/")} e ${to.split("-").reverse().join("/")}, mesmo no modo "Tudo".`}
                >
                  Entraram no período
                </th>
                <th className="px-3 py-2 text-right font-semibold">Tempo até chegar</th>
                <th className="px-4 py-2 text-left font-semibold">Distribuição</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgb(var(--border-weak))]">
              {stageRows.map((row) => (
                <tr key={row.key} className="hover:bg-[rgb(var(--slate-2))]">
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_KIND_CHIP[row.kind]}`}>
                      {row.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <CountButton
                      value={row.pararam}
                      strong
                      title={`Ver quem está parado em ${row.label}`}
                      onClick={() =>
                        openDetail(
                          `Parados em ${row.label}`,
                          "Etapa em que estas pessoas estão hoje.",
                          leads.filter((lead) => lead.stageKey === row.key)
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <CountButton
                      value={row.alcancaram}
                      title={`Ver quem passou por ${row.label}`}
                      onClick={() =>
                        openDetail(
                          `Passaram por ${row.label}`,
                          "Estiveram nesta etapa em algum momento, mesmo que hoje estejam em outra.",
                          leads.filter((lead) => leadReachedStage(lead, row, stages))
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-[rgb(var(--slate-10))]">
                    {formatPercent(row.doTotal)}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-[rgb(var(--slate-10))]">
                    {row.conversao !== null ? formatPercent(row.conversao) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <CountButton
                      value={row.noPeriodo}
                      muted
                      title={`Ver quem entrou em ${row.label} dentro do período`}
                      onClick={() =>
                        openDetail(
                          `Entraram em ${row.label} no período`,
                          `Entraram nesta etapa entre ${from.split("-").reverse().join("/")} e ${to.split("-").reverse().join("/")}.`,
                          leads.filter((lead) =>
                            lead.trail.some((step) => step.key === row.key && step.inWindow)
                          )
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-[rgb(var(--slate-10))]">
                    {formatDuration(row.horasMedianas)}
                  </td>
                  <td className="px-4 py-2">
                    <div className="h-2.5 w-full overflow-hidden rounded bg-[rgb(var(--slate-3))]">
                      <div
                        className={`h-full rounded ${STAGE_KIND_BAR[row.kind]}`}
                        style={{ width: `${row.alcancaram > 0 ? Math.max((row.alcancaram / maxStageCount) * 100, 2) : 0}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}

              {summary.semCard > 0 ? (
                <tr className="bg-[rgb(var(--slate-1))] hover:bg-[rgb(var(--slate-2))]">
                  <td className="px-4 py-2">
                    <span className="rounded-full bg-[rgb(var(--slate-3))] px-2 py-0.5 text-xs font-medium text-[rgb(var(--slate-11))]">
                      {NO_CARD_LABEL}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <CountButton
                      value={summary.semCard}
                      strong
                      title="Ver quem nunca entrou no funil"
                      onClick={() =>
                        openDetail(
                          NO_CARD_LABEL,
                          "Nunca foram distribuídas — não têm card em funil nenhum.",
                          leads.filter((lead) => lead.stageKey === null)
                        )
                      }
                    />
                  </td>
                  <td colSpan={6} className="px-3 py-2 text-xs text-[rgb(var(--slate-9))]">
                    Nunca foram distribuídas — não têm card em funil nenhum.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {cardsInOtherFunnels > 0 ? (
          <p className="border-t border-[rgb(var(--border-weak))] px-4 py-2 text-[11px] text-[rgb(var(--slate-9))]">
            {formatNumber(cardsInOtherFunnels)} pessoa(s) deste recorte têm card em outro funil; as etapas acima
            são as de {funnelForStages?.name}. Use o seletor de funil para vê-las separadamente.
          </p>
        ) : null}
      </section>

      {/* ── Mix de origens (o problema do Kanban, à vista) ──────────── */}
      <section className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))]">
        <header className="border-b border-[rgb(var(--border-weak))] px-4 py-3">
          <h3 className="text-sm font-semibold text-[rgb(var(--slate-12))]">Mistura de origens no funil</h3>
          <p className="mt-0.5 text-xs text-[rgb(var(--slate-9))]">
            Cada linha é um formulário de origem e cada coluna, a etapa em que as pessoas dele estão paradas —
            ignora o filtro de origem de propósito, para mostrar o que está dividindo as colunas do Kanban com o
            Meta. Clique no nome da origem para trocar o recorte, ou em qualquer número para ver quem são.
          </p>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="bg-[rgb(var(--slate-2))] text-[11px] uppercase tracking-wide text-[rgb(var(--slate-9))]">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Origem</th>
                <th className="px-3 py-2 text-right font-semibold">Pessoas</th>
                {stages.map((stage) => (
                  <th key={stage.key} className="px-2 py-2 text-right font-semibold">
                    {stage.label}
                  </th>
                ))}
                <th className="px-2 py-2 text-right font-semibold">Sem card</th>
                <th className="px-3 py-2 text-right font-semibold">Agendaram</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgb(var(--border-weak))]">
              {originRows.map((row) => (
                <tr
                  key={row.originGroup}
                  className={origins.includes(row.originGroup) ? "bg-[rgb(var(--blue-3))]/30" : ""}
                >
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => setOrigins([row.originGroup])}
                      className="text-left text-xs font-medium text-[rgb(var(--slate-12))] underline-offset-2 hover:underline"
                      title="Ver só esta origem"
                    >
                      {originLabel(row.originGroup)}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <CountButton
                      value={row.total}
                      strong
                      title={`Ver as pessoas de ${originLabel(row.originGroup)}`}
                      onClick={() =>
                        openDetail(
                          originLabel(row.originGroup),
                          "Todas as pessoas desta origem no recorte atual.",
                          leadsIgnoringOrigin.filter((lead) => lead.originGroup === row.originGroup)
                        )
                      }
                    />
                  </td>
                  {stages.map((stage) => (
                    <td key={stage.key} className="px-2 py-2 text-right">
                      <CountButton
                        value={row.porEtapa[stage.key] ?? 0}
                        muted
                        title={`Ver quem de ${originLabel(row.originGroup)} está em ${stage.label}`}
                        onClick={() =>
                          openDetail(
                            `${originLabel(row.originGroup)} · ${stage.label}`,
                            "Pessoas desta origem paradas nesta etapa.",
                            leadsIgnoringOrigin.filter(
                              (lead) => lead.originGroup === row.originGroup && lead.stageKey === stage.key
                            )
                          )
                        }
                      />
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right">
                    <CountButton
                      value={row.porEtapa[NO_CARD_KEY] ?? 0}
                      muted
                      title={`Ver quem de ${originLabel(row.originGroup)} nunca entrou no funil`}
                      onClick={() =>
                        openDetail(
                          `${originLabel(row.originGroup)} · ${NO_CARD_LABEL}`,
                          "Nunca foram distribuídas — não têm card em funil nenhum.",
                          leadsIgnoringOrigin.filter(
                            (lead) => lead.originGroup === row.originGroup && lead.stageKey === null
                          )
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <CountButton
                      value={row.agendaram}
                      tone="won"
                      title={`Ver quem de ${originLabel(row.originGroup)} agendou`}
                      onClick={() =>
                        openDetail(
                          `${originLabel(row.originGroup)} · agendaram`,
                          "Passaram pela etapa de agendamento em algum momento.",
                          leadsIgnoringOrigin.filter(
                            (lead) =>
                              lead.originGroup === row.originGroup &&
                              lead.trail.some((step) => step.key === SCHEDULED_STAGE_KEY)
                          )
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Por vendedor ───────────────────────────────────────────── */}
      {sellerRows.length > 0 ? (
        <section className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))]">
          <header className="border-b border-[rgb(var(--border-weak))] px-4 py-3">
            <h3 className="text-sm font-semibold text-[rgb(var(--slate-12))]">Por vendedor, dentro do recorte</h3>
            <p className="mt-0.5 text-xs text-[rgb(var(--slate-9))]">
              Só as pessoas que passam pelos filtros acima — não é a carteira inteira do vendedor.
            </p>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="bg-[rgb(var(--slate-2))] text-[11px] uppercase tracking-wide text-[rgb(var(--slate-9))]">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Vendedor</th>
                  <th className="px-3 py-2 text-right font-semibold">Pessoas</th>
                  <th className="px-3 py-2 text-right font-semibold">Avançaram</th>
                  <th className="px-3 py-2 text-right font-semibold">Agendaram</th>
                  <th className="px-3 py-2 text-right font-semibold">Ganho</th>
                  <th className="px-3 py-2 text-right font-semibold">Perdidos</th>
                  <th className="px-3 py-2 text-right font-semibold">% agendamento</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgb(var(--border-weak))]">
                {sellerRows.map((row) => (
                  <tr key={row.seller} className="hover:bg-[rgb(var(--slate-2))]">
                    <td className="px-4 py-2 text-xs font-medium text-[rgb(var(--slate-12))]">{row.seller}</td>
                    <td className="px-3 py-2 text-right">
                      <CountButton
                        value={row.total}
                        strong
                        title={`Ver as pessoas de ${row.seller} no recorte`}
                        onClick={() =>
                          openDetail(
                            row.seller,
                            "Pessoas deste vendedor dentro dos filtros atuais.",
                            leads.filter((lead) => (lead.sellerName ?? "Sem dono") === row.seller)
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <CountButton
                        value={row.avancaram}
                        muted
                        title={`Ver quem ${row.seller} tirou da etapa de entrada`}
                        onClick={() =>
                          openDetail(
                            `${row.seller} · avançaram`,
                            "Saíram da etapa de entrada do funil.",
                            leads.filter(
                              (lead) =>
                                (lead.sellerName ?? "Sem dono") === row.seller &&
                                lead.stageKey !== null &&
                                !entryStageKeys.has(lead.stageKey)
                            )
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <CountButton
                        value={row.agendaram}
                        tone="won"
                        title={`Ver quem ${row.seller} levou a agendamento`}
                        onClick={() =>
                          openDetail(
                            `${row.seller} · agendaram`,
                            "Passaram pela etapa de agendamento em algum momento.",
                            leads.filter(
                              (lead) =>
                                (lead.sellerName ?? "Sem dono") === row.seller &&
                                lead.trail.some((step) => step.key === SCHEDULED_STAGE_KEY)
                            )
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <CountButton
                        value={row.ganharam}
                        muted
                        title={`Ver os leads em etapa de ganho com ${row.seller}`}
                        onClick={() =>
                          openDetail(
                            `${row.seller} · etapa de ganho`,
                            "Estão hoje na etapa que o funil marca como ganho.",
                            leads.filter(
                              (lead) => (lead.sellerName ?? "Sem dono") === row.seller && lead.stageKind === "won"
                            )
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <CountButton
                        value={row.perderam}
                        tone="lost"
                        title={`Ver os leads perdidos com ${row.seller}`}
                        onClick={() =>
                          openDetail(
                            `${row.seller} · perdidos`,
                            "Estão hoje na etapa que o funil marca como perdido.",
                            leads.filter(
                              (lead) => (lead.sellerName ?? "Sem dono") === row.seller && lead.stageKind === "lost"
                            )
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums text-[rgb(var(--slate-10))]">
                      {formatPercent(row.total > 0 ? (row.agendaram / row.total) * 100 : null)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* ── Quem são as pessoas ────────────────────────────────────── */}
      <section className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))]">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[rgb(var(--border-weak))] px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-[rgb(var(--slate-12))]">
              Pessoas do recorte{" "}
              <span className="tabular-nums text-[rgb(var(--slate-9))]">({formatNumber(sortedList.length)})</span>
            </h3>
            <p className="mt-0.5 text-xs text-[rgb(var(--slate-9))]">
              Abra uma linha para ver o caminho completo: de onde veio, quem atendeu e quando entrou em cada
              etapa.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => exportCsv(sortedList, "recorte")}
              className="flex items-center gap-1.5 rounded-md border border-[rgb(var(--border-weak))] px-2.5 py-1 text-xs font-medium text-[rgb(var(--slate-11))] hover:bg-[rgb(var(--slate-2))]"
            >
              <Download className="h-3.5 w-3.5" />
              Exportar CSV
            </button>
          </div>
        </header>

        <LeadRows
          leads={visibleList}
          stageLabel={stageLabel}
          originLabel={originLabel}
          openLead={openLead}
          emptyLabel="Nenhuma pessoa com esses filtros no período."
        />

        {sortedList.length > visibleList.length ? (
          <div className="border-t border-[rgb(var(--border-weak))] px-4 py-2 text-center">
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="text-xs font-medium text-[rgb(var(--blue-11))] hover:underline"
            >
              Ver as {formatNumber(sortedList.length - visibleList.length)} restantes
            </button>
          </div>
        ) : null}
      </section>

      {detail ? (
        <LeadDetailModal
          title={detail.title}
          hint={detail.hint}
          leads={detail.leads}
          stageLabel={stageLabel}
          originLabel={originLabel}
          openLead={openLead}
          onExport={() => exportCsv(detail.leads, slugify(detail.title))}
          onClose={() => setDetail(null)}
        />
      ) : null}
    </div>
  );
}
