"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarCheck2, ChevronRight, FileText, Globe, HelpCircle, Link2, Users } from "lucide-react";
import AdLeadList from "@/components/AdLeadList";
import CampaignScopeSelect from "@/components/CampaignScopeSelect";
import CreativeLightbox from "@/components/CreativeLightbox";
import CreativeThumb from "@/components/CreativeThumb";
import { buildAdDestinationGroups, classifyAdDestination, costPer, summarizeByKind } from "@/lib/adDestinationGroups";
import { formatCurrency, formatNullableCurrency, formatNumber, formatPercent } from "@/lib/campaignFormat";
import { scopeAds } from "@/lib/campaignScope";
import { groupAdsByCreative } from "@/lib/creativeGroups";
import {
  groupLeadsByDestination,
  summarizeArrival,
  type DestinationLeadGroup,
} from "@/lib/leadArrivalAnalysis";
import type {
  AdDestinationGroup,
  AdDestinationKind,
  AdLeadDetail,
  AdRow,
  CampaignGroup,
} from "@/types/metaAds";

interface CampaignGroupsTabProps {
  hierarchy: CampaignGroup[];
  /** Leads de anúncio do recorte, um por pessoa — cada grupo analisa os seus. */
  leads: AdLeadDetail[];
  selectedCampaignId: string | null;
  selectedAdsetId: string | null;
  onCampaignChange: (campaignId: string | null) => void;
  onAdsetChange: (adsetId: string | null) => void;
}

// Mesmo azul dos outros gráficos da tela (--blue-9). Custo por lead é UMA
// medida de magnitude, então todas as barras usam a mesma cor: o que distingue
// os grupos é o rótulo do eixo, não a matiz.
const COLOR_BAR = "#2781F6";
const COLOR_AXIS = "#60646c";
const COLOR_GRID = "#f0f0f3";

const KIND_ICONS: Record<AdDestinationKind, typeof Globe> = {
  native_form: FileText,
  landing_page: Globe,
  unknown: HelpCircle,
};

const KIND_DESCRIPTIONS: Record<AdDestinationKind, string> = {
  native_form: "A pessoa preenche o formulário dentro do Instagram/Facebook, sem sair do app.",
  landing_page: "O clique abre uma página do escolavozup.com e o cadastro acontece lá.",
  unknown:
    "A Meta não informou página de destino. Normalmente é anúncio de engajamento (sem formulário); se for de captação, confira o criativo no gerenciador.",
};

/** Custo médio por lead com a conta à mostra ("R$ 400,00 ÷ 50 cadastros"), que
 * é como o gestor confere se o número faz sentido. */
function CostPerLead({
  spend,
  count,
  countLabel,
  size = "md",
}: {
  spend: number;
  count: number;
  countLabel: string;
  size?: "md" | "lg";
}) {
  const cost = costPer(spend, count);
  return (
    <div>
      <p
        className={`font-semibold tabular-nums text-[rgb(var(--slate-12))] ${size === "lg" ? "text-2xl" : "text-lg"}`}
      >
        {formatNullableCurrency(cost)}
      </p>
      <p className="text-[11px] leading-snug text-[rgb(var(--slate-9))]">
        {cost === null
          ? `sem ${countLabel} no período`
          : `${formatCurrency(spend)} ÷ ${formatNumber(count)} ${countLabel}`}
      </p>
    </div>
  );
}

function Metric({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-[rgb(var(--slate-2))] px-2.5 py-2" title={title}>
      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-9))]">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">{value}</p>
    </div>
  );
}

/** Barra de participação no investimento — dá a proporção do grupo sem gastar
 * um gráfico inteiro numa única razão. */
function SpendShare({ share }: { share: number }) {
  const percent = Math.round(share * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[rgb(var(--slate-4))]">
        <div className="h-full rounded-full bg-[rgb(var(--blue-9))]" style={{ width: `${Math.max(percent, 2)}%` }} />
      </div>
      <span className="text-[11px] font-medium tabular-nums text-[rgb(var(--slate-10))]">{percent}% do gasto</span>
    </div>
  );
}

/** Um número do funil dos leads do grupo, com o rótulo em cima. */
function LeadStat({ label, value, tone, title }: { label: string; value: string; tone?: "teal"; title?: string }) {
  return (
    <div title={title}>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-9))]">{label}</dt>
      <dd
        className={`text-sm font-semibold tabular-nums ${
          tone === "teal" ? "text-[rgb(var(--teal-9))]" : "text-[rgb(var(--slate-12))]"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function GroupCard({
  group,
  leadGroup,
  totalSpend,
  onOpenCreative,
}: {
  group: AdDestinationGroup;
  /** Os leads que este grupo trouxe; ausente quando ele não trouxe nenhum. */
  leadGroup: DestinationLeadGroup | null;
  totalSpend: number;
  onOpenCreative: (creative: AdRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [leadsOpen, setLeadsOpen] = useState(false);
  const creatives = useMemo(() => groupAdsByCreative(group.ads), [group.ads]);
  const Icon = KIND_ICONS[group.kind];
  const leads = leadGroup?.leads ?? [];

  return (
    <article className="overflow-hidden rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start gap-2.5">
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--blue-3))]">
              <Icon className="h-4 w-4 text-[rgb(var(--blue-11))]" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-[rgb(var(--slate-12))]">
                {group.label}
                {group.detail && group.kind === "landing_page" ? (
                  <span className="ml-1.5 font-normal text-[rgb(var(--slate-10))]">· {group.detail}</span>
                ) : null}
              </h3>
              <p className="text-[11px] leading-snug text-[rgb(var(--slate-9))]">
                {group.creativeCount} criativo{group.creativeCount === 1 ? "" : "s"} · {group.ads.length} anúncio
                {group.ads.length === 1 ? "" : "s"} em {group.adsetCount} conjunto{group.adsetCount === 1 ? "" : "s"} ·{" "}
                {group.campaignCount} campanha{group.campaignCount === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          {group.url ? (
            <a
              href={group.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-[rgb(var(--blue-3))] px-2.5 py-1.5 text-[11px] font-medium text-[rgb(var(--blue-11))] hover:underline"
            >
              <Link2 className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">{group.url.replace(/^https?:\/\//, "")}</span>
            </a>
          ) : (
            <p className="text-[11px] text-[rgb(var(--slate-9))]">{KIND_DESCRIPTIONS[group.kind]}</p>
          )}

          <SpendShare share={totalSpend > 0 ? group.spend / totalSpend : 0} />
        </div>

        <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 lg:w-[26rem] lg:flex-shrink-0">
          <Metric label="Investido" value={formatCurrency(group.spend)} />
          <Metric label="Cliques" value={formatNumber(group.clicks)} />
          <Metric label="CTR" value={formatPercent(group.ctr)} title="Exibições que geraram algum clique." />
          <Metric
            label="Meta marcou"
            value={formatNumber(group.leadsMeta)}
            title="Eventos de Lead atribuídos pela Meta."
          />
          <Metric
            label="Cadastros"
            value={formatNumber(group.cadastrosCrm)}
            title="Pessoas trazidas: as inéditas mais as que já eram da base e voltaram."
          />
          <Metric
            label="Novos"
            value={formatNumber(group.novos)}
            title="Pessoas inéditas no CRM."
          />
        </div>

        <div className="flex w-full flex-shrink-0 flex-col gap-3 rounded-lg border border-[rgb(var(--blue-5))] bg-[rgb(var(--blue-2))] p-3 lg:w-56">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[rgb(var(--blue-11))]">
              Custo médio por lead
            </p>
            <CostPerLead spend={group.spend} count={group.cadastrosCrm} countLabel="cadastros" size="lg" />
          </div>
          <div className="border-t border-[rgb(var(--blue-5))] pt-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[rgb(var(--blue-11))]">
              Custo por pessoa nova
            </p>
            <CostPerLead spend={group.spend} count={group.novos} countLabel="pessoas novas" />
          </div>
        </div>
      </div>

      {group.leadsQualificados > 0 || group.leadsFechados > 0 ? (
        <dl className="grid grid-cols-2 gap-3 border-t border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-1))] px-4 py-2.5 sm:grid-cols-4">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-9))]">Qualificados</dt>
            <dd className="text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">
              {formatNumber(group.leadsQualificados)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-9))]">Vendas</dt>
            <dd className="text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">
              {formatNumber(group.leadsFechados)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-9))]">Valor fechado</dt>
            <dd className="text-sm font-semibold tabular-nums text-[rgb(var(--teal-9))]">
              {formatCurrency(group.valorFechado)}
            </dd>
          </div>
          <div title="Investimento ÷ vendas fechadas deste grupo.">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-9))]">Custo/venda</dt>
            <dd className="text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">
              {formatNullableCurrency(group.custoPorVenda)}
            </dd>
          </div>
        </dl>
      ) : null}

      {/* Leads próprios do grupo: o que aconteceu com as PESSOAS que esta
          página (ou o formulário nativo) trouxe — cadastro sozinho não diz se
          a página traz gente que agenda. */}
      <div className="border-t border-[rgb(var(--border-weak))] bg-[rgb(var(--blue-2))] px-4 py-2.5">
        <div className="mb-2 flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-[rgb(var(--blue-11))]" />
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--blue-11))]">
            Leads deste grupo
          </h4>
        </div>
        {leadGroup ? (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <LeadStat
              label="Pessoas"
              value={formatNumber(leadGroup.cadastros)}
              title="Quem se cadastrou por este destino no período: as pessoas inéditas mais as que já eram da base e voltaram. Mesma definição da coluna Cadastros do resto da tela."
            />
            <LeadStat
              label="Novos"
              value={formatNumber(leadGroup.contatosNovos)}
              title="Pessoas inéditas no CRM — o resto já era da base."
            />
            <LeadStat
              label="Agendaram"
              value={formatNumber(leadGroup.agendaram)}
              tone="teal"
              title="Passaram pela etapa Agendado em algum momento."
            />
            <LeadStat
              label="Taxa de agendamento"
              value={formatPercent(leadGroup.taxaAgendamento)}
              title="Agendaram ÷ pessoas que este grupo trouxe."
            />
            <LeadStat label="Ganhos" value={formatNumber(leadGroup.ganhos)} tone="teal" />
            <LeadStat label="Sem dono" value={formatNumber(leadGroup.semDono)} title="Ainda não distribuídos." />
          </dl>
        ) : (
          <p className="text-xs text-[rgb(var(--slate-10))]">
            Nenhum lead deste grupo no período — só investimento sem cadastro.
          </p>
        )}
      </div>

      {leads.length > 0 ? (
        <>
          <button
            type="button"
            onClick={() => setLeadsOpen((value) => !value)}
            aria-expanded={leadsOpen}
            className="flex w-full items-center gap-2 border-t border-[rgb(var(--border-weak))] px-4 py-2.5 text-left text-xs font-semibold text-[rgb(var(--slate-11))] transition hover:bg-[rgb(var(--slate-2))]"
          >
            <ChevronRight className={`h-4 w-4 transition-transform ${leadsOpen ? "rotate-90" : ""}`} />
            Quem chegou por aqui ({leads.length})
            {leadGroup && leadGroup.agendaram > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-[rgb(224_248_243)] px-1.5 py-0.5 text-[10px] font-medium text-[rgb(var(--teal-9))]">
                <CalendarCheck2 className="h-3 w-3" /> {formatNumber(leadGroup.agendaram)} agendaram
              </span>
            ) : null}
          </button>
          {leadsOpen ? (
            <div className="border-t border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-1))]">
              <AdLeadList leads={leads} />
            </div>
          ) : null}
        </>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 border-t border-[rgb(var(--border-weak))] px-4 py-2.5 text-left text-xs font-semibold text-[rgb(var(--slate-11))] transition hover:bg-[rgb(var(--slate-2))]"
      >
        <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
        Criativos deste grupo ({creatives.length})
      </button>

      {open ? (
        <div className="border-t border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-1))]">
          {[...creatives]
            .sort((a, b) => b.card.spend - a.card.spend)
            .map((creative) => (
              <div
                key={creative.key}
                className="flex flex-col gap-2 border-b border-[rgb(var(--border-weak))] px-4 py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <CreativeThumb creative={creative.card} size="md" onOpen={() => onOpenCreative(creative.card)} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[rgb(var(--slate-12))]" title={creative.key}>
                      {creative.key}
                    </p>
                    <p className="text-[11px] text-[rgb(var(--slate-9))]">
                      {creative.adsetCount} conjunto{creative.adsetCount === 1 ? "" : "s"} · clique na imagem para ver em
                      tela cheia
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-x-4 text-right sm:grid-cols-4">
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] uppercase tracking-wide text-[rgb(var(--slate-9))]">Investido</span>
                    <span className="text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">
                      {formatCurrency(creative.card.spend)}
                    </span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] uppercase tracking-wide text-[rgb(var(--slate-9))]">Cadastros</span>
                    <span className="text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">
                      {formatNumber(creative.card.cadastrosCrm)}
                    </span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] uppercase tracking-wide text-[rgb(var(--slate-9))]">Custo/lead</span>
                    <span className="text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">
                      {formatNullableCurrency(costPer(creative.card.spend, creative.card.cadastrosCrm))}
                    </span>
                  </div>
                  <div className="hidden flex-col items-end sm:flex">
                    <span className="text-[10px] uppercase tracking-wide text-[rgb(var(--slate-9))]">Contatos</span>
                    <span className="text-sm font-semibold tabular-nums text-[rgb(var(--teal-9))]">
                      {formatNumber(creative.card.leadsCrm)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
        </div>
      ) : null}
    </article>
  );
}

interface CostChartPoint {
  label: string;
  custoPorCadastro: number;
  spend: number;
  cadastros: number;
}

function CostComparisonChart({ points, average }: { points: CostChartPoint[]; average: number | null }) {
  // Recharts mede o container no DOM real; renderizar só depois do mount evita
  // divergência entre o HTML do servidor e o primeiro paint (mesmo padrão da
  // Visão Geral).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-[280px] w-full rounded-md bg-[rgb(var(--slate-3))]" />;
  }

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} layout="vertical" margin={{ top: 5, right: 24, left: 8, bottom: 5 }} barCategoryGap={10}>
          <CartesianGrid horizontal={false} stroke={COLOR_GRID} />
          <XAxis
            type="number"
            stroke={COLOR_AXIS}
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => formatCurrency(value)}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={150}
            stroke={COLOR_AXIS}
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{ fill: "rgba(39,129,246,0.06)" }}
            contentStyle={{ backgroundColor: "#fff", borderRadius: "8px", border: "1px solid #eaeaea", fontSize: 12 }}
            formatter={(value: number, _name, item) => {
              const point = item?.payload as CostChartPoint | undefined;
              return [
                `${formatCurrency(value)} por lead${
                  point ? ` (${formatCurrency(point.spend)} ÷ ${formatNumber(point.cadastros)})` : ""
                }`,
                "Custo médio",
              ];
            }}
          />
          {average !== null ? (
            <ReferenceLine
              x={average}
              stroke={COLOR_AXIS}
              strokeDasharray="4 4"
              label={{ value: `média ${formatCurrency(average)}`, position: "top", fontSize: 11, fill: COLOR_AXIS }}
            />
          ) : null}
          <Bar dataKey="custoPorCadastro" fill={COLOR_BAR} radius={[0, 4, 4, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function CampaignGroupsTab({
  hierarchy,
  leads,
  selectedCampaignId,
  selectedAdsetId,
  onCampaignChange,
  onAdsetChange,
}: CampaignGroupsTabProps) {
  const [lightboxAd, setLightboxAd] = useState<AdRow | null>(null);
  const scopedAds = useMemo(() => scopeAds(hierarchy, selectedCampaignId, selectedAdsetId), [
    hierarchy,
    selectedAdsetId,
    selectedCampaignId,
  ]);
  const groups = useMemo(() => buildAdDestinationGroups(scopedAds), [scopedAds]);
  const kindSummaries = useMemo(() => summarizeByKind(groups), [groups]);
  const leadsByDestination = useMemo(() => groupLeadsByDestination(leads), [leads]);
  // Mesmo rollup nativo × landing pages dos cards de cima, mas contando
  // pessoas: é onde se vê que um caminho traz mais cadastro e o outro traz
  // mais agendamento.
  const leadOutcomesByKind = useMemo(() => {
    const byKind = new Map<AdDestinationKind, AdLeadDetail[]>();
    for (const lead of leads) {
      const kind = classifyAdDestination(lead.landingUrl).kind;
      const list = byKind.get(kind);
      if (list) list.push(lead);
      else byKind.set(kind, [lead]);
    }
    return new Map(
      Array.from(byKind.entries()).map(([kind, kindLeads]) => [kind, summarizeArrival(kindLeads)])
    );
  }, [leads]);

  const totalSpend = groups.reduce((total, group) => total + group.spend, 0);
  const totalCadastros = groups.reduce((total, group) => total + group.cadastrosCrm, 0);
  const averageCost = costPer(totalSpend, totalCadastros);

  const chartPoints = useMemo<CostChartPoint[]>(
    () =>
      groups
        .filter((group) => group.custoPorCadastro !== null)
        .map((group) => ({
          label: group.detail && group.kind === "landing_page" ? `${group.label} (${group.detail})` : group.label,
          custoPorCadastro: group.custoPorCadastro ?? 0,
          spend: group.spend,
          cadastros: group.cadastrosCrm,
        }))
        .sort((a, b) => a.custoPorCadastro - b.custoPorCadastro),
    [groups]
  );

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-10 text-center text-sm text-[rgb(var(--slate-10))]">
        Nenhum anúncio neste recorte para o período selecionado.
      </div>
    );
  }

  return (
    <section aria-labelledby="campaign-groups-heading" className="space-y-5">
      <div>
        <h2 id="campaign-groups-heading" className="text-lg font-semibold text-[rgb(var(--slate-12))]">
          Grupos de anúncios por destino
        </h2>
        <p className="text-sm text-[rgb(var(--slate-10))]">
          Junta os anúncios pelo lugar em que a pessoa se cadastra: o formulário nativo do Meta ou cada landing page do
          site. É a comparação que mostra qual caminho traz lead mais barato.
        </p>
      </div>

      <CampaignScopeSelect
        hierarchy={hierarchy}
        selectedCampaignId={selectedCampaignId}
        selectedAdsetId={selectedAdsetId}
        onCampaignChange={onCampaignChange}
        onAdsetChange={onAdsetChange}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {kindSummaries.map((summary) => {
          const Icon = KIND_ICONS[summary.kind];
          return (
            <div
              key={summary.kind}
              className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_2px_rgba(28,32,36,0.04)]"
            >
              <div className="mb-2 flex items-center gap-2">
                <Icon className="h-4 w-4 text-[rgb(var(--blue-9))]" />
                <h3 className="text-sm font-semibold text-[rgb(var(--slate-12))]">{summary.label}</h3>
              </div>
              <p className="mb-3 text-[11px] leading-snug text-[rgb(var(--slate-9))]">
                {KIND_DESCRIPTIONS[summary.kind]}
              </p>
              <CostPerLead spend={summary.spend} count={summary.cadastrosCrm} countLabel="cadastros" size="lg" />
              <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-[rgb(var(--border-weak))] pt-3 text-center">
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-[rgb(var(--slate-9))]">Investido</dt>
                  <dd className="text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">
                    {formatCurrency(summary.spend)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-[rgb(var(--slate-9))]">Cadastros</dt>
                  <dd className="text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">
                    {formatNumber(summary.cadastrosCrm)}
                  </dd>
                </div>
                <div title="Pessoas que passaram pela etapa Agendado em algum momento. O total de pessoas inclui quem já existia no CRM e voltou a se cadastrar — por isso pode ser maior que a coluna Cadastros.">
                  <dt className="text-[10px] uppercase tracking-wide text-[rgb(var(--slate-9))]">Agendaram</dt>
                  <dd className="text-sm font-semibold tabular-nums text-[rgb(var(--teal-9))]">
                    {formatNumber(leadOutcomesByKind.get(summary.kind)?.agendaram ?? 0)}
                    <span className="ml-1 text-[11px] font-normal text-[rgb(var(--slate-9))]">
                      de {formatNumber(leadOutcomesByKind.get(summary.kind)?.cadastros ?? 0)}
                    </span>
                  </dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>

      {chartPoints.length > 1 ? (
        <div className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-5 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
          <h3 className="text-base font-semibold text-[rgb(var(--slate-12))]">Custo médio por lead em cada grupo</h3>
          <p className="mb-4 text-xs text-[rgb(var(--slate-9))]">
            Investimento do grupo dividido pelos cadastros que ele gerou no período — quanto menor, melhor. A linha
            tracejada é a média geral do recorte.
          </p>
          <CostComparisonChart points={chartPoints} average={averageCost} />
        </div>
      ) : null}

      <div className="space-y-3">
        {groups.map((group) => (
          <GroupCard
            key={group.key}
            group={group}
            leadGroup={leadsByDestination.get(group.key) ?? null}
            totalSpend={totalSpend}
            onOpenCreative={setLightboxAd}
          />
        ))}
      </div>

      {lightboxAd ? (
        <CreativeLightbox key={lightboxAd.adId} ad={lightboxAd} onClose={() => setLightboxAd(null)} />
      ) : null}
    </section>
  );
}
