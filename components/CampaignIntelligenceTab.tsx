"use client";

import { useMemo } from "react";
import { AlertTriangle, BadgeDollarSign, CircleCheck, Eye, FileBarChart } from "lucide-react";
import CampaignScopeSelect from "@/components/CampaignScopeSelect";
import { formatCurrency, formatNullableCurrency, formatNumber, formatPercent } from "@/lib/campaignFormat";
import { scopeAds } from "@/lib/campaignScope";
import { groupAdsByCreative } from "@/lib/creativeGroups";
import { costPerEngagement, landingPageCompletion } from "@/lib/metaAdsEngagement";
import { reachHint, resolveScopeReach } from "@/lib/periodReach";
import type { CampaignGroup, EngagementMetrics, PeriodReachData } from "@/types/metaAds";

interface CampaignIntelligenceTabProps {
  hierarchy: CampaignGroup[];
  selectedCampaignId: string | null;
  selectedAdsetId: string | null;
  /** Alcance deduplicado da Meta para a janela (ver lib/periodReach.ts). */
  periodReach: PeriodReachData;
  periodReachExact: boolean;
  onCampaignChange: (campaignId: string | null) => void;
  onAdsetChange: (adsetId: string | null) => void;
}

interface Totals extends EngagementMetrics {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  cadastros: number;
  contatos: number;
  qualificados: number;
  vendas: number;
  valorFechado: number;
}

const EMPTY_TOTALS: Totals = {
  spend: 0,
  impressions: 0,
  reach: 0,
  clicks: 0,
  cadastros: 0,
  contatos: 0,
  qualificados: 0,
  vendas: 0,
  valorFechado: 0,
  videoViews: 0,
  linkClicks: 0,
  landingPageViews: 0,
  postEngagement: 0,
  pageEngagement: 0,
  reactions: 0,
  comments: 0,
  shares: 0,
  saves: 0,
  messagingStarted: 0,
};

function percent(numerator: number, denominator: number): number | null {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

function MetricCard({ label, value, hint, tone = "blue" }: { label: string; value: string; hint: string; tone?: "blue" | "teal" | "amber" }) {
  const toneClass = tone === "teal" ? "text-[rgb(var(--teal-9))]" : tone === "amber" ? "text-amber-700" : "text-[rgb(var(--blue-9))]";
  return (
    <div className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
      <p className="text-xs font-medium text-[rgb(var(--slate-10))]">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      <p className="mt-1 text-[11px] leading-snug text-[rgb(var(--slate-9))]">{hint}</p>
    </div>
  );
}

function FunnelStep({ label, value, previous, accent }: { label: string; value: number; previous: number | null; accent: string }) {
  const conversion = previous === null ? null : percent(value, previous);
  const width = previous && previous > 0 ? Math.max(8, (value / previous) * 100) : value > 0 ? 100 : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[rgb(var(--slate-12))]">{label}</p>
          <p className="text-xs text-[rgb(var(--slate-9))]">{conversion === null ? "Início do funil" : `${formatPercent(conversion)} avançaram da etapa anterior`}</p>
        </div>
        <p className="text-base font-semibold tabular-nums text-[rgb(var(--slate-12))]">{formatNumber(value)}</p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[rgb(var(--slate-3))]">
        <div className={`h-full rounded-full ${accent}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function AlertItem({ title, detail, tone }: { title: string; detail: string; tone: "warning" | "info" }) {
  return (
    <li className={`rounded-lg border p-3 ${tone === "warning" ? "border-amber-200 bg-amber-50" : "border-blue-200 bg-blue-50"}`}>
      <p className="text-sm font-semibold text-[rgb(var(--slate-12))]">{title}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-[rgb(var(--slate-10))]">{detail}</p>
    </li>
  );
}

export default function CampaignIntelligenceTab({
  hierarchy,
  selectedCampaignId,
  selectedAdsetId,
  periodReach,
  periodReachExact,
  onCampaignChange,
  onAdsetChange,
}: CampaignIntelligenceTabProps) {
  const ads = useMemo(
    () => scopeAds(hierarchy, selectedCampaignId, selectedAdsetId),
    [hierarchy, selectedAdsetId, selectedCampaignId]
  );

  const totals = useMemo(() => {
    const total = { ...EMPTY_TOTALS };
    for (const ad of ads) {
      total.spend += ad.spend;
      total.impressions += ad.impressions;
      total.reach += ad.reach;
      total.clicks += ad.clicks;
      total.cadastros += ad.cadastrosCrm;
      total.contatos += ad.novos;
      total.qualificados += ad.leadsQualificados;
      total.vendas += ad.leadsFechados;
      total.valorFechado += ad.valorFechado;
      total.videoViews += ad.videoViews;
      total.linkClicks += ad.linkClicks;
      total.landingPageViews += ad.landingPageViews;
      total.postEngagement += ad.postEngagement;
      total.pageEngagement += ad.pageEngagement;
      total.reactions += ad.reactions;
      total.comments += ad.comments;
      total.shares += ad.shares;
      total.saves += ad.saves;
      total.messagingStarted += ad.messagingStarted;
    }
    return total;
  }, [ads]);

  const creatives = useMemo(
    () =>
      groupAdsByCreative(ads)
        .filter((creative) => creative.card.spend > 0 || creative.card.cadastrosCrm > 0)
        .sort((left, right) => {
          const leftScore = left.card.valorFechado > 0 ? left.card.valorFechado / Math.max(left.card.spend, 1) : left.card.leadsCrm / Math.max(left.card.spend, 1);
          const rightScore = right.card.valorFechado > 0 ? right.card.valorFechado / Math.max(right.card.spend, 1) : right.card.leadsCrm / Math.max(right.card.spend, 1);
          return rightScore - leftScore;
        })
        .slice(0, 5),
    [ads]
  );

  const alerts = useMemo(() => {
    const result: Array<{ title: string; detail: string; tone: "warning" | "info" }> = [];
    const withoutRegistrations = ads.filter((ad) => ad.spend > 0 && ad.cadastrosCrm === 0).sort((a, b) => b.spend - a.spend)[0];
    if (withoutRegistrations) {
      result.push({
        title: "Investimento sem cadastro",
        detail: `${withoutRegistrations.adName} consumiu ${formatCurrency(withoutRegistrations.spend)} sem cadastro confirmado no CRM. Revise criativo, público e destino.`,
        tone: "warning",
      });
    }
    const saturated = ads.filter((ad) => (ad.frequency ?? 0) >= 3).sort((a, b) => (b.frequency ?? 0) - (a.frequency ?? 0))[0];
    if (saturated) {
      result.push({
        title: "Frequência alta",
        detail: `${saturated.adName} está com frequência ${saturated.frequency?.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}. Considere renovar a peça ou ampliar o público.`,
        tone: "info",
      });
    }
    const completion = landingPageCompletion(totals);
    if (completion !== null && completion < 70) {
      result.push({
        title: "Perda entre clique e página",
        detail: `Só ${formatPercent(completion)} dos cliques no link abriram a página. Vale revisar velocidade, link e experiência mobile da landing page.`,
        tone: "warning",
      });
    }
    if (result.length === 0) {
      result.push({
        title: "Sem alerta crítico neste recorte",
        detail: "Continue acompanhando custo por contato, qualificação e vendas antes de aumentar o orçamento.",
        tone: "info",
      });
    }
    return result;
  }, [ads, totals]);

  const ctr = percent(totals.clicks, totals.impressions);
  const scopeReach = resolveScopeReach({
    periodReach,
    exactScope: periodReachExact,
    selectedCampaignId,
    selectedAdsetId,
    summedReach: totals.reach,
    impressions: totals.impressions,
  });
  const frequency = scopeReach.frequency;
  const roas = totals.spend > 0 ? totals.valorFechado / totals.spend : null;
  const lpCompletion = landingPageCompletion(totals);

  return (
    <section aria-labelledby="campaign-intelligence-heading" className="space-y-6">
      <div>
        <h2 id="campaign-intelligence-heading" className="text-lg font-semibold text-[rgb(var(--slate-12))]">Painel completo de campanhas</h2>
        <p className="text-sm text-[rgb(var(--slate-10))]">Uma leitura única da entrega da Meta até o resultado comercial no CRM.</p>
      </div>

      <CampaignScopeSelect
        hierarchy={hierarchy}
        selectedCampaignId={selectedCampaignId}
        selectedAdsetId={selectedAdsetId}
        onCampaignChange={onCampaignChange}
        onAdsetChange={onAdsetChange}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
        <MetricCard label="Investimento" value={formatCurrency(totals.spend)} hint="Total aplicado no período." />
        <MetricCard
          label={scopeReach.exact ? "Alcance" : "Alcance (soma)"}
          value={formatNumber(scopeReach.reach)}
          hint={`${formatNumber(totals.impressions)} impressões · frequência ${frequency?.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) ?? "—"}. ${reachHint(scopeReach)}`}
        />
        <MetricCard label="CTR e CPC" value={formatPercent(ctr)} hint={`CPC: ${formatNullableCurrency(totals.clicks > 0 ? totals.spend / totals.clicks : null)}.`} />
        <MetricCard label="Cadastros" value={formatNumber(totals.cadastros)} hint={`Custo: ${formatNullableCurrency(totals.cadastros > 0 ? totals.spend / totals.cadastros : null)}.`} tone="teal" />
        <MetricCard label="Contatos qualificados" value={formatNumber(totals.qualificados)} hint={`${formatPercent(percent(totals.qualificados, totals.contatos))} das pessoas novas.`} tone="teal" />
        <MetricCard label="ROAS real" value={roas === null ? "—" : `${roas.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×`} hint={`${formatCurrency(totals.valorFechado)} em valor fechado.`} tone={roas !== null && roas < 1 ? "amber" : "teal"} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
        <article className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-5 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
          <div className="mb-5 flex items-center gap-2">
            <FileBarChart className="h-5 w-5 text-[rgb(var(--blue-9))]" />
            <div>
              <h3 className="font-semibold text-[rgb(var(--slate-12))]">Funil de aquisição e venda</h3>
              <p className="text-xs text-[rgb(var(--slate-9))]">Cada etapa mostra a taxa de avanço da anterior.</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FunnelStep label="Impressões" value={totals.impressions} previous={null} accent="bg-blue-500" />
            <FunnelStep label="Cliques" value={totals.clicks} previous={totals.impressions} accent="bg-sky-500" />
            <FunnelStep label="Cliques no link" value={totals.linkClicks} previous={totals.clicks} accent="bg-cyan-500" />
            <FunnelStep label="Página carregada" value={totals.landingPageViews} previous={totals.linkClicks} accent="bg-teal-500" />
            <FunnelStep label="Cadastros no CRM" value={totals.cadastros} previous={totals.landingPageViews || totals.linkClicks} accent="bg-emerald-500" />
            <FunnelStep label="Qualificados" value={totals.qualificados} previous={totals.contatos} accent="bg-violet-500" />
            <FunnelStep label="Vendas fechadas" value={totals.vendas} previous={totals.contatos} accent="bg-fuchsia-500" />
          </div>
        </article>

        <article className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-5 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
          <div className="mb-4 flex items-center gap-2">
            <Eye className="h-5 w-5 text-[rgb(var(--blue-9))]" />
            <div>
              <h3 className="font-semibold text-[rgb(var(--slate-12))]">Entrega e engajamento</h3>
              <p className="text-xs text-[rgb(var(--slate-9))]">Sinais para julgar criativo antes mesmo da venda.</p>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-4 text-sm">
            <div><dt className="text-xs text-[rgb(var(--slate-9))]">Vídeo (3s)</dt><dd className="font-semibold tabular-nums">{formatNumber(totals.videoViews)}</dd></div>
            <div><dt className="text-xs text-[rgb(var(--slate-9))]">Interações</dt><dd className="font-semibold tabular-nums">{formatNumber(totals.postEngagement)}</dd></div>
            <div><dt className="text-xs text-[rgb(var(--slate-9))]">Custo/interação</dt><dd className="font-semibold tabular-nums">{formatNullableCurrency(costPerEngagement(totals.spend, totals))}</dd></div>
            <div><dt className="text-xs text-[rgb(var(--slate-9))]">Clique → página</dt><dd className="font-semibold tabular-nums">{formatPercent(lpCompletion)}</dd></div>
            <div><dt className="text-xs text-[rgb(var(--slate-9))]">Reações e comentários</dt><dd className="font-semibold tabular-nums">{formatNumber(totals.reactions + totals.comments)}</dd></div>
            <div><dt className="text-xs text-[rgb(var(--slate-9))]">Compartilhamentos/salvos</dt><dd className="font-semibold tabular-nums">{formatNumber(totals.shares + totals.saves)}</dd></div>
          </dl>
        </article>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <article className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-5 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
          <div className="mb-4 flex items-center gap-2"><BadgeDollarSign className="h-5 w-5 text-[rgb(var(--teal-9))]" /><h3 className="font-semibold text-[rgb(var(--slate-12))]">Criativos com melhor retorno</h3></div>
          {creatives.length === 0 ? <p className="text-sm text-[rgb(var(--slate-9))]">Ainda não há entrega neste recorte.</p> : (
            <ol className="space-y-3">
              {creatives.map((creative, index) => {
                const ad = creative.card;
                const creativeRoas = ad.spend > 0 ? ad.valorFechado / ad.spend : null;
                return <li key={creative.key} className="flex items-center gap-3 rounded-lg bg-[rgb(var(--slate-2))] p-3">
                  <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[rgb(var(--surface-1))] text-xs font-bold text-[rgb(var(--blue-9))]">{index + 1}</span>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-[rgb(var(--slate-12))]" title={creative.key}>{creative.key}</p><p className="text-xs text-[rgb(var(--slate-9))]">{formatCurrency(ad.spend)} · {formatNumber(ad.novos)} novos · {formatNumber(ad.leadsFechados)} vendas</p></div>
                  <p className="text-right text-sm font-semibold tabular-nums text-[rgb(var(--teal-9))]">{creativeRoas === null ? formatNullableCurrency(ad.cplReal) : `${creativeRoas.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×`}</p>
                </li>;
              })}
            </ol>
          )}
        </article>

        <article className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-5 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
          <div className="mb-4 flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" /><h3 className="font-semibold text-[rgb(var(--slate-12))]">Alertas e oportunidades</h3></div>
          <ul className="space-y-3">{alerts.map((alert) => <AlertItem key={alert.title} {...alert} />)}</ul>
        </article>
      </div>

      <article className="rounded-xl border border-dashed border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-1))] p-4">
        <div className="flex items-start gap-3"><CircleCheck className="mt-0.5 h-5 w-5 flex-none text-[rgb(var(--teal-9))]" /><div><h3 className="text-sm font-semibold text-[rgb(var(--slate-12))]">Cobertura de dados</h3><p className="mt-1 text-xs leading-relaxed text-[rgb(var(--slate-10))]">Esta visão já reúne entrega, custo, alcance, frequência, cliques, vídeo, engajamento, landing page, cadastros, qualificação, vendas e valor fechado. Público por idade/gênero, posicionamento e retenção 25–100% de vídeo só aparecerão após incluirmos essas quebras na sincronização da API Meta; não serão exibidos números estimados.</p></div></div>
      </article>
    </section>
  );
}
