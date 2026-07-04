import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Flame,
  Send,
  Target,
  TrendingUp,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import type {
  CommercialDashboardStats,
  CommercialStageDashboardStat,
} from "@/lib/db";
import type { CommercialStage } from "@/types/inscricao";

interface CommercialCommandCenterProps {
  stats: CommercialDashboardStats;
}

const STAGE_COLORS: Record<CommercialStage, { bar: string; dot: string; text: string }> = {
  novo: {
    bar: "bg-slate-500",
    dot: "bg-slate-500",
    text: "text-slate-700",
  },
  primeiro_contato: {
    bar: "bg-cyan-500",
    dot: "bg-cyan-500",
    text: "text-cyan-700",
  },
  em_atendimento: {
    bar: "bg-blue-500",
    dot: "bg-blue-500",
    text: "text-blue-700",
  },
  agendado: {
    bar: "bg-violet-500",
    dot: "bg-violet-500",
    text: "text-violet-700",
  },
  fechamento: {
    bar: "bg-amber-500",
    dot: "bg-amber-500",
    text: "text-amber-700",
  },
  ganho: {
    bar: "bg-emerald-500",
    dot: "bg-emerald-500",
    text: "text-emerald-700",
  },
  perdido: {
    bar: "bg-rose-500",
    dot: "bg-rose-500",
    text: "text-rose-700",
  },
  no_show: {
    bar: "bg-orange-500",
    dot: "bg-orange-500",
    text: "text-orange-700",
  },
};

function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR");
}

function formatPercent(value: number): string {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function stageHref(stage: CommercialStageDashboardStat): string {
  return `/crm?commercialStage=${stage.key}`;
}

function MetricCard({
  label,
  value,
  detail,
  href,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  href: string;
  icon: LucideIcon;
  tone: "blue" | "amber" | "emerald" | "rose";
}) {
  const toneClass = {
    blue: "bg-blue-50 text-blue-700 border-blue-100",
    amber: "bg-amber-50 text-amber-700 border-amber-100",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-100",
    rose: "bg-rose-50 text-rose-700 border-rose-100",
  }[tone];

  return (
    <Link
      href={href}
      className="group rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_2px_rgba(28,32,36,0.04)] transition hover:border-[rgb(var(--border-strong))]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className={`flex size-9 flex-shrink-0 items-center justify-center rounded-lg border ${toneClass}`}>
          <Icon className="size-4" />
        </div>
        <ArrowRight className="size-4 text-[rgb(var(--slate-9))] transition group-hover:translate-x-0.5 group-hover:text-[rgb(var(--slate-12))]" />
      </div>
      <p className="mt-4 text-xs font-medium text-[rgb(var(--slate-10))]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-[rgb(var(--slate-12))]">{value}</p>
      <p className="mt-1 text-xs text-[rgb(var(--slate-10))]">{detail}</p>
    </Link>
  );
}

export default function CommercialCommandCenter({ stats }: CommercialCommandCenterProps) {
  const actionItems = [
    {
      label: "Sem vendedor",
      value: stats.unassignedLeads,
      href: "/crm?unassignedOnly=1",
      icon: UserPlus,
    },
    {
      label: "Parados ha 48h",
      value: stats.staleLeads,
      href: "/crm",
      icon: Clock3,
    },
    {
      label: "Em fechamento",
      value: stats.closingLeads,
      href: "/crm?commercialStage=fechamento",
      icon: Target,
    },
    {
      label: "Leads quentes",
      value: stats.hotLeads,
      href: "/crm?stars=5",
      icon: Flame,
    },
  ];

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Leads ativos"
          value={formatNumber(stats.activeLeads)}
          detail={`${formatNumber(stats.newLeadsToday)} novos hoje`}
          href="/crm"
          icon={Users}
          tone="blue"
        />
        <MetricCard
          label="Taxa de ganho"
          value={formatPercent(stats.winRate)}
          detail={`${formatNumber(stats.wonLeads)} ganhos / ${formatNumber(stats.lostLeads)} perdidos`}
          href="/crm?commercialStage=ganho"
          icon={TrendingUp}
          tone="emerald"
        />
        <MetricCard
          label="Distribuidos hoje"
          value={formatNumber(stats.assignedToday)}
          detail={`${formatNumber(stats.unassignedLeads)} aguardando repasse`}
          href="/distribuicao"
          icon={Send}
          tone="amber"
        />
        <MetricCard
          label="No-show"
          value={formatNumber(stats.noShowLeads)}
          detail="Recuperacao e reagendamento"
          href="/crm?commercialStage=no_show"
          icon={AlertTriangle}
          tone="rose"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.9fr)]">
        <section className="rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[rgb(var(--slate-12))]">Funil comercial</h2>
              <p className="text-xs text-[rgb(var(--slate-10))]">{formatNumber(stats.totalLeads)} leads no recorte atual</p>
            </div>
            <Link
              href="/crm"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[rgb(var(--border-weak))] px-2.5 text-xs font-semibold text-[rgb(var(--slate-11))] transition hover:bg-[rgba(var(--alpha-2))] hover:text-[rgb(var(--slate-12))]"
            >
              Abrir CRM
              <ArrowRight className="size-3.5" />
            </Link>
          </div>

          <div className="grid gap-2">
            {stats.stageSummary.map((stage) => {
              const colors = STAGE_COLORS[stage.key];
              const width = `${Math.max(stage.percentage, stage.count > 0 ? 4 : 0)}%`;
              return (
                <Link
                  key={stage.key}
                  href={stageHref(stage)}
                  className="grid min-h-11 grid-cols-[minmax(120px,180px)_minmax(0,1fr)_72px] items-center gap-3 rounded-lg px-2 py-1.5 transition hover:bg-[rgb(var(--slate-2))]"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={`size-2.5 flex-shrink-0 rounded-full ${colors.dot}`} />
                    <span className={`truncate text-sm font-semibold ${colors.text}`}>{stage.label}</span>
                  </span>
                  <span className="h-2 overflow-hidden rounded-full bg-[rgb(var(--slate-3))]">
                    <span className={`block h-full rounded-full ${colors.bar}`} style={{ width }} />
                  </span>
                  <span className="text-right text-xs font-semibold text-[rgb(var(--slate-11))]">
                    {formatNumber(stage.count)}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-[rgb(var(--slate-12))]">Acoes prioritarias</h2>
            <p className="text-xs text-[rgb(var(--slate-10))]">Fila operacional do comercial</p>
          </div>
          <div className="grid gap-2">
            {actionItems.map((item) => {
              const ActionIcon = item.icon;
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className="group flex min-h-12 items-center justify-between gap-3 rounded-lg border border-[rgb(var(--border-weak))] px-3 py-2 transition hover:bg-[rgb(var(--slate-2))]"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="flex size-8 flex-shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--slate-2))] text-[rgb(var(--slate-11))]">
                      <ActionIcon className="size-4" />
                    </span>
                    <span className="truncate text-sm font-semibold text-[rgb(var(--slate-12))]">{item.label}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[rgb(var(--slate-12))]">{formatNumber(item.value)}</span>
                    <ArrowRight className="size-4 text-[rgb(var(--slate-9))] transition group-hover:translate-x-0.5" />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-[rgb(var(--slate-12))]">Campanhas</h2>
            <span className="text-xs text-[rgb(var(--slate-10))]">Top entradas</span>
          </div>
          {stats.topCampaigns.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[rgb(var(--border-weak))] py-8 text-center text-sm text-[rgb(var(--slate-10))]">
              Sem campanhas no recorte.
            </p>
          ) : (
            <div className="divide-y divide-[rgb(var(--border-weak))]">
              {stats.topCampaigns.map((campaign) => (
                <div key={`${campaign.source}-${campaign.name ?? ""}`} className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[rgb(var(--slate-12))]">{campaign.source}</p>
                    <p className="truncate text-xs text-[rgb(var(--slate-10))]">{campaign.name ?? "Sem nome de campanha"}</p>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="rounded-md bg-blue-50 px-2 py-1 font-semibold text-blue-700">{formatNumber(campaign.leads)} leads</span>
                    <span className="rounded-md bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">{formatNumber(campaign.won)} ganhos</span>
                    <span className="rounded-md bg-amber-50 px-2 py-1 font-semibold text-amber-700">{formatNumber(campaign.hot)} quentes</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-[rgb(var(--slate-12))]">Carteira da equipe</h2>
            <span className="text-xs text-[rgb(var(--slate-10))]">Carga ativa</span>
          </div>
          {stats.sellerWorkload.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[rgb(var(--border-weak))] py-8 text-center text-sm text-[rgb(var(--slate-10))]">
              Sem vendedores no recorte.
            </p>
          ) : (
            <div className="divide-y divide-[rgb(var(--border-weak))]">
              {stats.sellerWorkload.map((seller) => (
                <div key={`${seller.name}-${seller.email ?? ""}`} className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[rgb(var(--slate-12))]">{seller.name}</p>
                    <p className="truncate text-xs text-[rgb(var(--slate-10))]">{seller.email ?? "Sem email vinculado"}</p>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="rounded-md bg-slate-100 px-2 py-1 font-semibold text-slate-700">{formatNumber(seller.active)} ativos</span>
                    <span className="rounded-md bg-amber-50 px-2 py-1 font-semibold text-amber-700">{formatNumber(seller.closing)} fech.</span>
                    <span className="rounded-md bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">
                      <CheckCircle2 className="mr-1 inline size-3" />
                      {formatNumber(seller.won)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
