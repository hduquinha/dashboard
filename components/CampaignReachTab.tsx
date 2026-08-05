"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Eye, Megaphone, PlayCircle, Repeat2, Users } from "lucide-react";
import CampaignScopeSelect from "@/components/CampaignScopeSelect";
import CreativeLightbox from "@/components/CreativeLightbox";
import CreativeThumb from "@/components/CreativeThumb";
import InstagramFollowersPanel from "@/components/InstagramFollowersPanel";
import { formatCurrency, formatDayShort, formatDayWithWeekday, formatNullableCurrency, formatNumber, formatPercent } from "@/lib/campaignFormat";
import { PURPOSE_DESCRIPTIONS, PURPOSE_LABELS, readableObjective } from "@/lib/campaignObjectives";
import { scopeAds } from "@/lib/campaignScope";
import { groupAdsByCreative } from "@/lib/creativeGroups";
import {
  addEngagement,
  costPerEngagement,
  emptyEngagement,
  ENGAGEMENT_METRIC_DEFS,
  landingPageCompletion,
} from "@/lib/metaAdsEngagement";
import { readableCampaignName } from "@/lib/metaAdsLabels";
import { reachHint, resolveCampaignReach, resolveScopeReach } from "@/lib/periodReach";
import type { InstagramProfileSeries } from "@/lib/instagramProfiles";
import type {
  AdRow,
  CampaignGroup,
  CampaignPurpose,
  DailySeriesPoint,
  EngagementMetrics,
  PeriodReachData,
} from "@/types/metaAds";

interface CampaignReachTabProps {
  hierarchy: CampaignGroup[];
  series: DailySeriesPoint[];
  instagramProfiles: InstagramProfileSeries[];
  selectedCampaignId: string | null;
  selectedAdsetId: string | null;
  /** Alcance deduplicado da Meta para a janela (ver lib/periodReach.ts). */
  periodReach: PeriodReachData;
  periodReachExact: boolean;
  onCampaignChange: (campaignId: string | null) => void;
  onAdsetChange: (adsetId: string | null) => void;
}

const COLOR_MAIN = "#2781F6";
const COLOR_AXIS = "#60646c";
const COLOR_GRID = "#f0f0f3";

type SeriesMetric = "impressions" | "reach" | "videoViews";

const SERIES_OPTIONS: Array<{ key: SeriesMetric; label: string }> = [
  { key: "impressions", label: "Impressões" },
  { key: "reach", label: "Pessoas alcançadas" },
  { key: "videoViews", label: "Visualizações de vídeo" },
];

function sumEngagement(ads: AdRow[]): EngagementMetrics {
  const totals = emptyEngagement();
  for (const ad of ads) addEngagement(totals, ad);
  return totals;
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Eye;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
      <div className="mb-2 flex items-center gap-1.5">
        <Icon className="h-4 w-4 text-[rgb(var(--blue-9))]" />
        <span className="text-xs font-medium text-[rgb(var(--slate-10))]">{label}</span>
      </div>
      <p className="text-lg font-semibold tabular-nums text-[rgb(var(--slate-12))]">{value}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-[rgb(var(--slate-9))]">{hint}</p>
    </div>
  );
}

function DeliveryChart({ points, metric }: { points: DailySeriesPoint[]; metric: SeriesMetric }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  if (!mounted) return <div className="h-[240px] w-full rounded-md bg-[rgb(var(--slate-3))]" />;

  const label = SERIES_OPTIONS.find((option) => option.key === metric)?.label ?? "";

  return (
    <div className="h-[240px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 5, right: 20, left: 8, bottom: 5 }}>
          <defs>
            <linearGradient id="reachFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLOR_MAIN} stopOpacity={0.28} />
              <stop offset="100%" stopColor={COLOR_MAIN} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={COLOR_GRID} />
          <XAxis dataKey="date" tickFormatter={formatDayShort} stroke={COLOR_AXIS} fontSize={12} tickLine={false} axisLine={false} />
          <YAxis
            stroke={COLOR_AXIS}
            fontSize={12}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={(value: number) => formatNumber(value)}
          />
          <Tooltip
            labelFormatter={(value) => formatDayWithWeekday(String(value))}
            contentStyle={{ backgroundColor: "#fff", borderRadius: "8px", border: "1px solid #eaeaea", fontSize: 12 }}
            formatter={(value: number) => [formatNumber(value), label]}
          />
          <Area type="monotone" dataKey={metric} stroke={COLOR_MAIN} strokeWidth={2} fill="url(#reachFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function PurposeSection({
  purpose,
  campaigns,
  periodReach,
  periodReachExact,
  onOpenCreative,
}: {
  purpose: CampaignPurpose;
  campaigns: CampaignGroup[];
  periodReach: PeriodReachData;
  periodReachExact: boolean;
  onOpenCreative: (ad: AdRow) => void;
}) {
  if (campaigns.length === 0) return null;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-[rgb(var(--slate-12))]">{PURPOSE_LABELS[purpose]}</h3>
        <p className="text-xs text-[rgb(var(--slate-9))]">{PURPOSE_DESCRIPTIONS[purpose]}</p>
      </div>
      {campaigns.map((campaign) => (
        <CampaignReachCard
          key={campaign.campaignId}
          campaign={campaign}
          periodReach={periodReach}
          periodReachExact={periodReachExact}
          onOpenCreative={onOpenCreative}
        />
      ))}
    </div>
  );
}

function CampaignReachCard({
  campaign,
  periodReach,
  periodReachExact,
  onOpenCreative,
}: {
  campaign: CampaignGroup;
  periodReach: PeriodReachData;
  periodReachExact: boolean;
  onOpenCreative: (ad: AdRow) => void;
}) {
  const ads = useMemo(() => campaign.adsets.flatMap((adset) => adset.ads), [campaign]);
  const creatives = useMemo(
    () => groupAdsByCreative(ads).sort((a, b) => b.card.impressions - a.card.impressions),
    [ads]
  );
  const totals = campaign.totals;
  const completion = landingPageCompletion(totals);
  const campaignReach = resolveCampaignReach({
    periodReach,
    exactScope: periodReachExact,
    campaignId: campaign.campaignId,
    summedReach: totals.reach,
    impressions: totals.impressions,
  });

  return (
    <article className="overflow-hidden rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold text-[rgb(var(--slate-12))]" title={campaign.campaignName}>
            {readableCampaignName(campaign.campaignName)}
          </h4>
          <p className="text-[11px] text-[rgb(var(--slate-9))]">
            Objetivo: {readableObjective(campaign.objective)} · {formatCurrency(totals.spend)} investidos ·{" "}
            {campaign.adsets.length} conjunto{campaign.adsets.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-right">
          <div className="rounded-lg bg-[rgb(var(--slate-2))] px-3 py-1.5">
            <p className="text-[10px] uppercase tracking-wide text-[rgb(var(--slate-9))]">Impressões</p>
            <p className="text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">
              {formatNumber(totals.impressions)}
            </p>
          </div>
          <div className="rounded-lg bg-[rgb(var(--slate-2))] px-3 py-1.5" title={reachHint(campaignReach)}>
            <p className="text-[10px] uppercase tracking-wide text-[rgb(var(--slate-9))]">
              {campaignReach.exact ? "Pessoas" : "Pessoas (soma)"}
            </p>
            <p className="text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">{formatNumber(campaignReach.reach)}</p>
          </div>
          <div className="rounded-lg bg-[rgb(var(--slate-2))] px-3 py-1.5" title="Quantas vezes, em média, a mesma pessoa viu o anúncio.">
            <p className="text-[10px] uppercase tracking-wide text-[rgb(var(--slate-9))]">Frequência</p>
            <p className="text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">
              {campaignReach.frequency?.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) ?? "—"}
            </p>
          </div>
          <div className="rounded-lg bg-[rgb(var(--blue-2))] px-3 py-1.5" title="Investimento ÷ interações com a publicação.">
            <p className="text-[10px] uppercase tracking-wide text-[rgb(var(--blue-11))]">Custo/interação</p>
            <p className="text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">
              {formatNullableCurrency(costPerEngagement(totals.spend, totals))}
            </p>
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 border-t border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-1))] px-4 py-3 sm:grid-cols-3 lg:grid-cols-5">
        {ENGAGEMENT_METRIC_DEFS.map((def) => (
          <div key={def.key} title={def.hint}>
            <dt className="truncate text-[10px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-9))]">
              {def.label}
            </dt>
            <dd className="text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">
              {formatNumber(totals[def.key])}
            </dd>
          </div>
        ))}
        <div title="Dos cliques no link, quantos realmente abriram a página.">
          <dt className="truncate text-[10px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-9))]">
            Clique → página
          </dt>
          <dd className="text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">{formatPercent(completion)}</dd>
        </div>
      </dl>

      {creatives.length > 0 ? (
        <div className="overflow-x-auto border-t border-[rgb(var(--border-weak))]">
          <table className="w-full min-w-[44rem]">
            <thead className="bg-[rgb(var(--slate-2))] text-[10px] uppercase tracking-wide text-[rgb(var(--slate-9))]">
              <tr>
                <th scope="col" className="px-4 py-2 text-left font-semibold">Criativo</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Impressões</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Pessoas</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Vídeo (3s)</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Interações</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Reações</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">CTR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgb(var(--border-weak))]">
              {creatives.map((creative) => {
                const metrics = sumEngagement(creative.members);
                return (
                  <tr key={creative.key}>
                    <td className="px-4 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <CreativeThumb creative={creative.card} onOpen={() => onOpenCreative(creative.card)} />
                        <span className="truncate text-sm text-[rgb(var(--slate-11))]" title={creative.key}>
                          {creative.key}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums">{formatNumber(creative.card.impressions)}</td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums">{formatNumber(creative.card.reach)}</td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums">{formatNumber(metrics.videoViews)}</td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums">{formatNumber(metrics.postEngagement)}</td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums">{formatNumber(metrics.reactions)}</td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums">{formatPercent(creative.card.ctr)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </article>
  );
}

export default function CampaignReachTab({
  hierarchy,
  series,
  instagramProfiles,
  selectedCampaignId,
  selectedAdsetId,
  periodReach,
  periodReachExact,
  onCampaignChange,
  onAdsetChange,
}: CampaignReachTabProps) {
  const [seriesMetric, setSeriesMetric] = useState<SeriesMetric>("impressions");
  const [lightboxAd, setLightboxAd] = useState<AdRow | null>(null);

  const scopedAds = useMemo(
    () => scopeAds(hierarchy, selectedCampaignId, selectedAdsetId),
    [hierarchy, selectedAdsetId, selectedCampaignId]
  );
  const scopedCampaigns = useMemo(
    () =>
      hierarchy
        .filter((campaign) => !selectedCampaignId || campaign.campaignId === selectedCampaignId)
        .filter((campaign) => campaign.totals.impressions > 0 || campaign.totals.spend > 0)
        .sort((a, b) => b.totals.impressions - a.totals.impressions),
    [hierarchy, selectedCampaignId]
  );

  const totals = useMemo(() => sumEngagement(scopedAds), [scopedAds]);
  const impressions = scopedAds.reduce((total, ad) => total + ad.impressions, 0);
  const spend = scopedAds.reduce((total, ad) => total + ad.spend, 0);
  // Pessoas não se somam: quem viu dois anúncios é uma pessoa só (ver periodReach).
  const scopeReach = resolveScopeReach({
    periodReach,
    exactScope: periodReachExact,
    selectedCampaignId,
    selectedAdsetId,
    summedReach: scopedAds.reduce((total, ad) => total + ad.reach, 0),
    impressions,
  });

  return (
    <section aria-labelledby="campaign-reach-heading" className="space-y-5">
      <div>
        <h2 id="campaign-reach-heading" className="text-lg font-semibold text-[rgb(var(--slate-12))]">
          Alcance e engajamento
        </h2>
        <p className="text-sm text-[rgb(var(--slate-10))]">
          Quantas pessoas viram, quantas vezes viram e o que fizeram — as linhas que o gerenciador da Meta mostra e que
          faltavam aqui. É por esta aba que se avalia a campanha de engajamento, que não tem formulário nenhum.
        </p>
      </div>

      <CampaignScopeSelect
        hierarchy={hierarchy}
        selectedCampaignId={selectedCampaignId}
        selectedAdsetId={selectedAdsetId}
        onCampaignChange={onCampaignChange}
        onAdsetChange={onAdsetChange}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat
          icon={Eye}
          label="Impressões"
          value={formatNumber(impressions)}
          hint="Quantas vezes o anúncio apareceu na tela de alguém."
        />
        <Stat
          icon={Users}
          label={scopeReach.exact ? "Pessoas alcançadas" : "Pessoas alcançadas (soma)"}
          value={formatNumber(scopeReach.reach)}
          hint={reachHint(scopeReach)}
        />
        <Stat
          icon={Repeat2}
          label="Frequência"
          value={scopeReach.frequency?.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) ?? "—"}
          hint="Vezes que a mesma pessoa viu, em média. Acima de 3 costuma cansar."
        />
        <Stat
          icon={PlayCircle}
          label="Visualizações de vídeo"
          value={formatNumber(totals.videoViews)}
          hint="Assistiram pelo menos 3 segundos."
        />
        <Stat
          icon={Megaphone}
          label="Interações"
          value={formatNumber(totals.postEngagement)}
          hint={`Custo por interação: ${formatNullableCurrency(costPerEngagement(spend, totals))}`}
        />
      </div>

      {series.length > 0 ? (
        <div className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-5 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-[rgb(var(--slate-12))]">Entrega dia a dia</h3>
              <p className="text-xs text-[rgb(var(--slate-9))]">
                Uma medida por vez — troque no seletor ao lado.
                {seriesMetric === "reach"
                  ? " A curva de pessoas soma os anúncios de cada dia: serve para ver a tendência, não para bater com o total do período."
                  : ""}
              </p>
            </div>
            <div className="flex gap-1 rounded-md bg-[rgb(var(--slate-3))] p-1">
              {SERIES_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={seriesMetric === option.key}
                  onClick={() => setSeriesMetric(option.key)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                    seriesMetric === option.key
                      ? "bg-[rgb(var(--surface-1))] text-[rgb(var(--slate-12))] shadow-sm"
                      : "text-[rgb(var(--slate-10))] hover:text-[rgb(var(--slate-12))]"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <DeliveryChart points={series} metric={seriesMetric} />
        </div>
      ) : null}

      <InstagramFollowersPanel profiles={instagramProfiles} spend={spend} />

      <PurposeSection
        purpose="engajamento"
        campaigns={scopedCampaigns.filter((campaign) => campaign.purpose === "engajamento")}
        periodReach={periodReach}
        periodReachExact={periodReachExact}
        onOpenCreative={setLightboxAd}
      />
      <PurposeSection
        purpose="captacao"
        campaigns={scopedCampaigns.filter((campaign) => campaign.purpose === "captacao")}
        periodReach={periodReach}
        periodReachExact={periodReachExact}
        onOpenCreative={setLightboxAd}
      />
      <PurposeSection
        purpose="outro"
        campaigns={scopedCampaigns.filter((campaign) => campaign.purpose === "outro")}
        periodReach={periodReach}
        periodReachExact={periodReachExact}
        onOpenCreative={setLightboxAd}
      />

      {scopedCampaigns.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-10 text-center text-sm text-[rgb(var(--slate-10))]">
          Nenhuma campanha com entrega neste recorte e período.
        </div>
      ) : null}

      {lightboxAd ? <CreativeLightbox key={lightboxAd.adId} ad={lightboxAd} onClose={() => setLightboxAd(null)} /> : null}
    </section>
  );
}
