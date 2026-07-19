"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRight, Database, DollarSign, Eye, MousePointerClick, Target, TrendingUp, UserPlus } from "lucide-react";
import CampaignFunnel from "@/components/CampaignFunnel";
import CampaignSetNavigator from "@/components/CampaignSetNavigator";
import type { CampaignGroup, DailySeriesPoint, FunnelStagePoint, KpiTotals } from "@/types/metaAds";

// Mesmas cores usadas em todo o resto do dashboard (ver app/globals.css:
// --blue-9, --teal-9, --slate-9) — mantém a tela consistente com o resto do
// produto em vez de inventar uma paleta nova.
const COLOR_SPEND = "#2781F6"; // --blue-9
const COLOR_LEADS_CRM = "#12A594"; // --teal-9
const COLOR_REGISTRATIONS_CRM = "#7C3AED";

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
}

function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR");
}

function formatNullableCurrency(value: number | null): string {
  return value === null ? "—" : formatCurrency(value);
}

function formatDateShort(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

interface CampaignOverviewTabProps {
  hierarchy: CampaignGroup[];
  kpis: KpiTotals;
  series: DailySeriesPoint[];
  initialFunnel: FunnelStagePoint[];
  selectedCampaignId: string | null;
  selectedAdsetId: string | null;
  onCampaignChange: (campaignId: string | null) => void;
  onAdsetChange: (adsetId: string | null) => void;
}

export default function CampaignOverviewTab({
  hierarchy,
  kpis,
  series,
  initialFunnel,
  selectedCampaignId,
  selectedAdsetId,
  onCampaignChange,
  onAdsetChange,
}: CampaignOverviewTabProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Recharts mede o container via DOM real; renderizar só depois do mount
    // evita divergência entre o HTML do servidor e o primeiro paint no cliente.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const costPerRegistration = kpis.cadastrosCrm > 0 ? kpis.spend / kpis.cadastrosCrm : null;

  const kpiCards = [
    { label: "Investimento", value: formatCurrency(kpis.spend), icon: DollarSign },
    { label: "Custo por cadastro", value: formatNullableCurrency(costPerRegistration), icon: Database },
    { label: "Custo por contato novo", value: formatNullableCurrency(kpis.cplReal), icon: UserPlus },
    { label: "Qualificados", value: formatNumber(kpis.leadsQualificados), icon: Target },
    { label: "Vendas fechadas", value: formatNumber(kpis.leadsFechados), icon: Target },
    { label: "Valor fechado", value: formatCurrency(kpis.valorFechado), icon: DollarSign },
  ];

  const flowSteps = [
    { label: "Exibições", value: formatNumber(kpis.impressions), description: "vezes que os anúncios apareceram", icon: Eye },
    { label: "Cliques", value: formatNumber(kpis.clicks), description: "cliques reportados pela Meta", icon: MousePointerClick },
    { label: "Meta marcou", value: formatNumber(kpis.leadsMeta), description: "eventos de conversão atribuídos", icon: TrendingUp },
    { label: "Cadastros salvos", value: formatNumber(kpis.cadastrosCrm), description: "envios confirmados no banco", icon: Database },
    { label: "Contatos novos", value: formatNumber(kpis.leadsCrm), description: "pessoas novas criadas no CRM", icon: UserPlus },
  ];

  return (
    <div className="space-y-6">
      <section aria-labelledby="scope-picker-heading" className="space-y-2">
        <div>
          <h2 id="scope-picker-heading" className="text-base font-semibold text-[rgb(var(--slate-12))]">
            Escolha o que deseja analisar
          </h2>
          <p className="text-xs text-[rgb(var(--slate-9))]">
            Os números abaixo (KPIs, funil e gráficos) recalculam pro recorte escolhido — vale pras abas Tabela e Anúncios também.
          </p>
        </div>
        <CampaignSetNavigator
          hierarchy={hierarchy}
          selectedCampaignId={selectedCampaignId}
          selectedAdsetId={selectedAdsetId}
          onCampaignChange={onCampaignChange}
          onAdsetChange={onAdsetChange}
        />
      </section>

      <section
        aria-labelledby="campaign-reading-heading"
        className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_2px_rgba(28,32,36,0.04)]"
      >
        <div className="mb-4">
          <h2 id="campaign-reading-heading" className="text-base font-semibold text-[rgb(var(--slate-12))]">
            Leitura rápida do período
          </h2>
          <p className="text-xs text-[rgb(var(--slate-9))]">Do anúncio exibido até a pessoa nova criada no CRM.</p>
        </div>
        <div className="grid grid-cols-2 items-stretch gap-2 sm:grid-cols-3 lg:flex lg:items-center">
          {flowSteps.map((step, index) => (
            <div key={step.label} className="contents">
              <div
                className={`flex min-w-0 flex-1 items-start gap-3 rounded-lg bg-[rgb(var(--slate-2))] p-3 ${
                  index === flowSteps.length - 1 ? "col-span-2 sm:col-span-1" : ""
                }`}
              >
                <step.icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-[rgb(var(--blue-9))]" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[rgb(var(--slate-10))]">{step.label}</p>
                  <p className="text-xl font-semibold text-[rgb(var(--slate-12))]">{step.value}</p>
                  <p className="text-[11px] leading-snug text-[rgb(var(--slate-9))]">{step.description}</p>
                </div>
              </div>
              {index < flowSteps.length - 1 ? (
                <ArrowRight aria-hidden="true" className="hidden h-4 w-4 flex-shrink-0 text-[rgb(var(--slate-8))] lg:block" />
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <div className="flex items-start gap-3 rounded-xl border border-[rgb(var(--blue-5))] bg-[rgb(var(--blue-2))] p-4">
        <TrendingUp className="mt-0.5 h-5 w-5 flex-shrink-0 text-[rgb(var(--blue-10))]" />
        <div className="text-sm text-[rgb(var(--blue-12))]">
          <p className="font-semibold">CTR médio: {kpis.ctr !== null ? `${kpis.ctr.toFixed(2)}%` : "—"}</p>
          <p className="mt-0.5 text-xs leading-relaxed">
            CTR é a porcentagem de exibições que gerou algum clique no anúncio. Exemplo: CTR de 2% significa cerca de 2 cliques a
            cada 100 exibições. CTR não é quantidade de leads.
          </p>
        </div>
      </div>

      <section aria-labelledby="campaign-business-heading" className="space-y-3">
        <div>
          <h2 id="campaign-business-heading" className="text-lg font-semibold text-[rgb(var(--slate-12))]">
            Resultado comercial
          </h2>
          <p className="text-sm text-[rgb(var(--slate-10))]">Custos e avanço dos contatos novos dentro do CRM.</p>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
          {kpiCards.map((metric) => (
            <div
              key={metric.label}
              className="rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_2px_rgba(28,32,36,0.04)]"
            >
              <div className="mb-2 flex items-center gap-1.5">
                <metric.icon className="h-4 w-4 text-[rgb(var(--blue-9))]" />
                <span className="text-xs font-medium text-[rgb(var(--slate-10))]">{metric.label}</span>
              </div>
              <p className="text-lg font-semibold text-[rgb(var(--slate-12))]">{metric.value}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-5 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
        <h3 className="mb-1 text-base font-semibold text-[rgb(var(--slate-12))]">Onde os contatos novos estão no funil</h3>
        <p className="mb-4 text-xs text-[rgb(var(--slate-9))]">Cadastros repetidos não duplicam a mesma pessoa nesta visão comercial.</p>
        <CampaignFunnel stages={initialFunnel} />
      </div>

      {/* Série temporal: dois gráficos de eixo único (gasto tem escala muito
          diferente de contagem de leads — juntar num eixo duplo distorce a
          leitura) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-5 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
          <h3 className="mb-4 text-base font-semibold text-[rgb(var(--slate-12))]">Gasto por dia</h3>
          <div className="h-[240px] w-full">
            {mounted ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f3" />
                  <XAxis dataKey="date" tickFormatter={formatDateShort} stroke="#60646c" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#60646c" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip
                    labelFormatter={(label) => formatDateShort(String(label))}
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{ backgroundColor: "#fff", borderRadius: "8px", border: "1px solid #eaeaea" }}
                  />
                  <Line type="linear" dataKey="spend" stroke={COLOR_SPEND} strokeWidth={2} name="Gasto (R$)" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full w-full rounded-md bg-[rgb(var(--slate-3))]" />
            )}
          </div>
        </div>

        <div className="rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-5 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
          <h3 className="mb-1 text-base font-semibold text-[rgb(var(--slate-12))]">Cadastros recebidos por dia</h3>
          <p className="mb-4 text-xs text-[rgb(var(--slate-9))]">Cadastros salvos e quantos eram contatos novos.</p>
          <div className="h-[240px] w-full">
            {mounted ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f3" />
                  <XAxis dataKey="date" tickFormatter={formatDateShort} stroke="#60646c" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#60646c" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    labelFormatter={(label) => formatDateShort(String(label))}
                    contentStyle={{ backgroundColor: "#fff", borderRadius: "8px", border: "1px solid #eaeaea" }}
                  />
                  <Line
                    type="linear"
                    dataKey="cadastrosCrm"
                    stroke={COLOR_REGISTRATIONS_CRM}
                    strokeWidth={2}
                    name="Cadastros salvos"
                    dot={false}
                  />
                  <Line type="linear" dataKey="leadsCrm" stroke={COLOR_LEADS_CRM} strokeWidth={2} name="Contatos novos" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full w-full rounded-md bg-[rgb(var(--slate-3))]" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
