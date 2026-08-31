"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlertTriangle,
  DollarSign,
  Eye,
  MousePointerClick,
  Search,
  Target,
  UserCheck,
} from "lucide-react";
import { formatCurrency, formatDayShort, formatNullableCurrency, formatNumber, formatPercent } from "@/lib/campaignFormat";
import type { GoogleAdsReport } from "@/lib/googleAdsReport";

// Mesmas cores do resto do dashboard (app/globals.css).
const COLOR_SPEND = "#2781F6"; // --blue-9
const COLOR_CRM = "#12A594"; // --teal-9
const COLOR_GOOGLE = "#F5A524"; // âmbar: o que o Google declara, não o que chegou

/** Rótulos legíveis para os enums crus da API. */
const STATUS_LABEL: Record<string, string> = {
  ENABLED: "Ativa",
  PAUSED: "Pausada",
  REMOVED: "Removida",
  UNKNOWN: "—",
};

const CHANNEL_LABEL: Record<string, string> = {
  SEARCH: "Rede de Pesquisa",
  DISPLAY: "Display",
  PERFORMANCE_MAX: "Performance Max",
  VIDEO: "Vídeo",
  SHOPPING: "Shopping",
  DEMAND_GEN: "Demand Gen",
};

function StatusPill({ status }: { status: string | null }) {
  const key = status ?? "UNKNOWN";
  const tone =
    key === "ENABLED"
      ? "bg-[rgb(var(--blue-3))] text-[rgb(var(--blue-11))]"
      : key === "PAUSED"
        ? "bg-[rgb(var(--slate-3))] text-[rgb(var(--slate-11))]"
        : "bg-[rgb(var(--slate-2))] text-[rgb(var(--slate-9))]";
  return (
    <span className={`inline-flex flex-none items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone}`}>
      {STATUS_LABEL[key] ?? key}
    </span>
  );
}

interface GoogleAdsTabProps {
  report: GoogleAdsReport;
  from: string;
  to: string;
}

export default function GoogleAdsTab({ report, from, to }: GoogleAdsTabProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Recharts mede o container no DOM real — mesmo padrão das outras abas.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const { totals, campaigns, ads, daily, leads } = report;

  const chartData = useMemo(
    () =>
      daily.map((point) => ({
        date: formatDayShort(point.date),
        gasto: Number(point.costBrl.toFixed(2)),
        cliques: point.clicks,
        google: point.conversions,
        crm: point.crmLeads,
      })),
    [daily]
  );

  /** A diferença que importa: o que o Google declara × o que virou lead aqui. */
  const gap = totals.conversions - totals.crmLeads;
  const hasGap = Math.abs(gap) >= 1;

  if (!report.hasData) {
    return (
      <div className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-8 text-center">
        <Search className="mx-auto h-8 w-8 text-[rgb(var(--slate-8))]" />
        <h2 className="mt-3 text-base font-semibold text-[rgb(var(--slate-12))]">Nenhuma campanha do Google sincronizada</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-[rgb(var(--slate-9))]">
          A sincronização roda a cada 15 minutos. Se esta tela continuar vazia, confira as credenciais
          <code className="mx-1 rounded bg-[rgb(var(--slate-3))] px-1 py-0.5 text-xs">GOOGLE_ADS_*</code>
          e o passo a passo em <span className="font-medium">docs/google-ads-integracao.md</span>.
        </p>
      </div>
    );
  }

  const kpiCards = [
    {
      label: "Investimento",
      value: formatCurrency(totals.costBrl),
      hint: `${formatNumber(campaigns.filter((c) => c.costBrl > 0).length)} campanha(s) com gasto`,
      icon: DollarSign,
    },
    {
      label: "Custo por lead real",
      value: formatNullableCurrency(totals.costPerCrmLeadBrl),
      hint:
        totals.crmLeads === 0
          ? "nenhum lead do Google no CRM no período"
          : `${formatCurrency(totals.costBrl)} ÷ ${formatNumber(totals.crmLeads)} lead(s) do CRM`,
      icon: UserCheck,
      strong: true,
    },
    {
      label: "Cliques",
      value: formatNumber(totals.clicks),
      hint: totals.cpcBrl === null ? "sem cliques" : `${formatNullableCurrency(totals.cpcBrl)} por clique`,
      icon: MousePointerClick,
    },
    {
      label: "Impressões",
      value: formatNumber(totals.impressions),
      hint: `CTR ${formatPercent(totals.ctr)}`,
      icon: Eye,
    },
    {
      label: "Conversões (Google)",
      value: formatNumber(totals.conversions),
      hint: "coluna oficial da conta, não 'todas as conv.'",
      icon: Target,
    },
    {
      label: "Leads no CRM",
      value: formatNumber(totals.crmLeads),
      hint: "pessoas que realmente entraram na base",
      icon: UserCheck,
    },
  ];

  return (
    <div className="space-y-6">
      <section aria-labelledby="google-kpis-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 id="google-kpis-heading" className="text-base font-semibold text-[rgb(var(--slate-12))]">
              Google Ads — {from} a {to}
            </h2>
            <p className="text-xs text-[rgb(var(--slate-9))]">
              Rede de Pesquisa não tem criativo nem alcance como a Meta: a unidade aqui é campanha → grupo → anúncio.
            </p>
          </div>
          {report.lastSyncedAt && (
            <span className="text-[11px] text-[rgb(var(--slate-9))]">
              sincronizado {new Date(report.lastSyncedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          {kpiCards.map((card) => (
            <div
              key={card.label}
              className={`rounded-xl border bg-[rgb(var(--surface-1))] p-3 ${
                card.strong ? "border-[rgb(var(--blue-7))]" : "border-[rgb(var(--border-weak))]"
              }`}
            >
              <div className="flex items-center gap-1.5 text-[rgb(var(--slate-9))]">
                <card.icon className="h-3.5 w-3.5" />
                <span className="text-[11px] font-semibold uppercase tracking-wide">{card.label}</span>
              </div>
              <p className="mt-1 text-xl font-bold tabular-nums text-[rgb(var(--slate-12))]">{card.value}</p>
              {card.hint && <p className="mt-0.5 text-[11px] leading-snug text-[rgb(var(--slate-9))]">{card.hint}</p>}
            </div>
          ))}
        </div>
      </section>

      {hasGap && (
        <section
          aria-labelledby="google-gap-heading"
          className="rounded-xl border border-[rgb(240_224_170)] bg-[rgb(255_247_224)] p-4"
        >
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-[rgb(139_94_0)]" />
            <div className="min-w-0">
              <h3 id="google-gap-heading" className="text-sm font-semibold text-[rgb(139_94_0)]">
                O Google conta {formatNumber(totals.conversions)} conversão(ões); o CRM tem {formatNumber(totals.crmLeads)} lead(s)
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-[rgb(120_82_0)]">
                {gap > 0
                  ? "Conversão do Google não é pessoa: a mesma pessoa pode disparar o evento mais de uma vez, e ações importadas do GA4 chegam a contar clique em botão como envio de formulário. O número que paga a conta é o do CRM."
                  : "Há mais leads no CRM do que conversões atribuídas. Normalmente é lead que chegou por outro caminho (busca orgânica, indicação) e ficou com origem de Google, ou clique fora da janela de atribuição."}
              </p>
            </div>
          </div>
        </section>
      )}

      <section aria-labelledby="google-daily-heading" className="space-y-2">
        <h2 id="google-daily-heading" className="text-base font-semibold text-[rgb(var(--slate-12))]">
          Dia a dia
        </h2>
        <div className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-3">
          <div className="h-72 w-full">
            {mounted && chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--slate-5))" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="rgb(var(--slate-9))" />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} stroke="rgb(var(--slate-9))" />
                  <YAxis yAxisId="right" orientation="right" allowDecimals={false} tick={{ fontSize: 11 }} stroke="rgb(var(--slate-9))" />
                  <Tooltip
                    formatter={(value: number, name: string) =>
                      name === "Gasto" ? formatCurrency(value) : formatNumber(value)
                    }
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey="gasto" name="Gasto" fill={COLOR_SPEND} radius={[3, 3, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="google" name="Conv. Google" stroke={COLOR_GOOGLE} strokeWidth={2} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="crm" name="Leads no CRM" stroke={COLOR_CRM} strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : chartData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-[rgb(var(--slate-9))]">
                Sem gasto registrado no período.
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section aria-labelledby="google-campaigns-heading" className="space-y-2">
        <h2 id="google-campaigns-heading" className="text-base font-semibold text-[rgb(var(--slate-12))]">
          Campanhas
        </h2>
        <div className="overflow-x-auto rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))]">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="border-b border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-2))] text-[11px] uppercase tracking-wide text-[rgb(var(--slate-9))]">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Campanha</th>
                <th className="px-3 py-2 text-right font-semibold">Gasto</th>
                <th className="px-3 py-2 text-right font-semibold">Impressões</th>
                <th className="px-3 py-2 text-right font-semibold">Cliques</th>
                <th className="px-3 py-2 text-right font-semibold">CTR</th>
                <th className="px-3 py-2 text-right font-semibold">CPC</th>
                <th className="px-3 py-2 text-right font-semibold">Conv.</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((row) => (
                <tr key={row.campaignId} className="border-b border-[rgb(var(--border-weak))] last:border-0">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <StatusPill status={row.status} />
                      <span className="font-medium text-[rgb(var(--slate-12))]">{row.campaignName}</span>
                    </div>
                    {row.channelType && (
                      <span className="mt-0.5 block text-[11px] text-[rgb(var(--slate-9))]">
                        {CHANNEL_LABEL[row.channelType] ?? row.channelType}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatCurrency(row.costBrl)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.impressions)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.clicks)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatPercent(row.ctr)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNullableCurrency(row.cpcBrl)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.conversions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="google-ads-heading" className="space-y-2">
        <h2 id="google-ads-heading" className="text-base font-semibold text-[rgb(var(--slate-12))]">
          Anúncios
        </h2>
        <div className="overflow-x-auto rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))]">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="border-b border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-2))] text-[11px] uppercase tracking-wide text-[rgb(var(--slate-9))]">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Anúncio / grupo</th>
                <th className="px-3 py-2 text-left font-semibold">Destino</th>
                <th className="px-3 py-2 text-right font-semibold">Gasto</th>
                <th className="px-3 py-2 text-right font-semibold">Cliques</th>
                <th className="px-3 py-2 text-right font-semibold">Conv.</th>
              </tr>
            </thead>
            <tbody>
              {ads.map((row) => (
                <tr key={row.adId} className="border-b border-[rgb(var(--border-weak))] last:border-0">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <StatusPill status={row.adStatus} />
                      <span className="font-medium text-[rgb(var(--slate-12))]">{row.adGroupName}</span>
                    </div>
                    <span className="mt-0.5 block text-[11px] text-[rgb(var(--slate-9))]">{row.campaignName}</span>
                  </td>
                  <td className="max-w-[18rem] truncate px-3 py-2 text-[11px] text-[rgb(var(--slate-10))]">
                    {row.finalUrl ? (
                      <a href={row.finalUrl} target="_blank" rel="noreferrer" className="hover:underline" title={row.finalUrl}>
                        {row.finalUrl.replace(/^https?:\/\//, "")}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatCurrency(row.costBrl)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.clicks)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.conversions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="google-leads-heading" className="space-y-2">
        <h2 id="google-leads-heading" className="text-base font-semibold text-[rgb(var(--slate-12))]">
          Leads que chegaram pelo Google
        </h2>
        {leads.length === 0 ? (
          <p className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 text-sm text-[rgb(var(--slate-9))]">
            Nenhum lead com origem de Google Ads no período.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))]">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="border-b border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-2))] text-[11px] uppercase tracking-wide text-[rgb(var(--slate-9))]">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Pessoa</th>
                  <th className="px-3 py-2 text-left font-semibold">Origem</th>
                  <th className="px-3 py-2 text-left font-semibold">Entrada</th>
                  <th className="px-3 py-2 text-center font-semibold">gclid</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} className="border-b border-[rgb(var(--border-weak))] last:border-0">
                    <td className="px-3 py-2">
                      <a href={`/inscricoes/${lead.id}`} className="font-medium text-[rgb(var(--blue-11))] hover:underline">
                        {lead.nome || "(sem nome)"}
                      </a>
                      {lead.telefone && (
                        <span className="mt-0.5 block text-[11px] text-[rgb(var(--slate-9))]">{lead.telefone}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-[rgb(var(--slate-10))]">{lead.origem || "—"}</td>
                    <td className="px-3 py-2 text-[11px] tabular-nums text-[rgb(var(--slate-10))]">
                      {new Date(lead.criadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {lead.hasGclid ? (
                        <span
                          title="clique pago identificado"
                          className="inline-flex items-center rounded bg-[rgb(var(--blue-3))] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[rgb(var(--blue-11))]"
                        >
                          sim
                        </span>
                      ) : (
                        <span className="text-[11px] text-[rgb(var(--slate-9))]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
