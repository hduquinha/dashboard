"use client";

import { useCallback, useMemo, useState } from "react";
import {
  HandCoins,
  Megaphone,
  Pencil,
  Plus,
  RefreshCw,
  Tag,
  Trash2,
  TrendingUp,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import IconTile, { type IconTileTone } from "@/components/IconTile";
import {
  FINANCE_BUSINESS_UNITS,
  FINANCE_BUSINESS_UNIT_LABELS,
  normalizeBusinessUnit,
  type FinanceBusinessUnit,
} from "@/lib/financeBusinessUnits";
import type { TrainingCatalogItem } from "@/lib/trainingCatalog";
import type { SalesOriginReport } from "@/lib/salesReport";

interface CatalogClientProps {
  initialTrainings: TrainingCatalogItem[];
  initialReport: SalesOriginReport;
  canManage: boolean;
}

const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

/** "1.497,50" e "1497.50" viram 1497.5; vazio vira null. */
function parseAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number.parseFloat(trimmed.replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function toInput(value: number | null): string {
  return value === null ? "" : value.toFixed(2).replace(".", ",");
}

interface TrainingDraft {
  id: number | null;
  name: string;
  durationLabel: string;
  description: string;
  defaultPrice: string;
  minPrice: string;
  defaultInstallments: number;
  /** Empresa dona do curso — decide em qual lado do Financeiro a venda entra. */
  businessUnit: FinanceBusinessUnit;
  /** Vazio = comissão do vendedor; "0" = curso que não paga comissão. */
  commissionPct: string;
  /** Aulas do curso — gera o quadro da turma e a carga horária do contrato. */
  lessonsCount: string;
  lessonHours: string;
  lessonsPerWeek: number;
  /** Rateio do item 4 do contrato; o curso é o valor que sobra. */
  enrollmentFee: string;
  materialFee: string;
  active: boolean;
}

function emptyDraft(): TrainingDraft {
  return {
    id: null,
    name: "",
    durationLabel: "",
    description: "",
    defaultPrice: "",
    minPrice: "",
    defaultInstallments: 1,
    businessUnit: "vozup",
    commissionPct: "",
    lessonsCount: "",
    lessonHours: "",
    lessonsPerWeek: 1,
    enrollmentFee: "",
    materialFee: "",
    active: true,
  };
}

function draftFrom(training: TrainingCatalogItem): TrainingDraft {
  return {
    id: training.id,
    name: training.name,
    durationLabel: training.durationLabel ?? "",
    description: training.description ?? "",
    defaultPrice: toInput(training.defaultPrice),
    minPrice: toInput(training.minPrice),
    defaultInstallments: training.defaultInstallments,
    businessUnit: training.businessUnit,
    commissionPct: training.commissionPct === null ? "" : toInput(training.commissionPct),
    lessonsCount: training.lessonsCount === null ? "" : String(training.lessonsCount),
    lessonHours: training.lessonHours === null ? "" : String(training.lessonHours).replace(".", ","),
    lessonsPerWeek: training.lessonsPerWeek,
    enrollmentFee: training.enrollmentFee > 0 ? toInput(training.enrollmentFee) : "",
    materialFee: training.materialFee > 0 ? toInput(training.materialFee) : "",
    active: training.active,
  };
}

/**
 * Tabela de preços dos treinamentos e o retorno de cada um.
 *
 * As duas metades da tela respondem perguntas diferentes e não se somam: em
 * cima, por quanto cada treinamento é vendido; embaixo, quanto as vendas
 * fechadas pelo CRM geraram e de qual campanha vieram. O relatório só enxerga
 * vendas registradas a partir de um lead — matrícula lançada direto no
 * Financeiro não tem origem para atribuir.
 */
export function CatalogClient({ initialTrainings, initialReport, canManage }: CatalogClientProps) {
  const [trainings, setTrainings] = useState(initialTrainings);
  const [report, setReport] = useState(initialReport);
  const [from, setFrom] = useState(initialReport.from);
  const [to, setTo] = useState(initialReport.to);
  const [loadingReport, setLoadingReport] = useState(false);
  const [draft, setDraft] = useState<TrainingDraft | null>(null);
  // Carga horária total = nº de aulas × horas por aula. É este número que vai
  // para o item 3 do contrato, então ele aparece já somado no formulário.
  const totalHours = useMemo(() => {
    if (!draft) return null;
    const hours = parseAmount(draft.lessonHours);
    if (!hours || hours <= 0) return null;
    const lessons = Number(draft.lessonsCount);
    // Sem nº de aulas o curso é imersão: as horas informadas já são o total.
    if (!draft.lessonsCount.trim() || !Number.isFinite(lessons) || lessons <= 0) {
      return Math.round(hours * 10) / 10;
    }
    return Math.round(lessons * hours * 10) / 10;
  }, [draft]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeCount = useMemo(() => trainings.filter((item) => item.active).length, [trainings]);

  const refresh = useCallback(
    async (nextFrom: string, nextTo: string) => {
      setLoadingReport(true);
      setError(null);
      try {
        const response = await fetch(`/api/catalog/report?from=${nextFrom}&to=${nextTo}`);
        const data = (await response.json().catch(() => ({}))) as {
          report?: SalesOriginReport;
          trainings?: TrainingCatalogItem[];
          error?: string;
        };
        if (!response.ok) throw new Error(data.error ?? "Falha ao atualizar o relatório.");
        if (data.report) setReport(data.report);
        if (data.trainings) setTrainings(data.trainings);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Falha ao atualizar o relatório.");
      } finally {
        setLoadingReport(false);
      }
    },
    []
  );

  async function saveTraining() {
    if (!draft) return;
    if (!draft.name.trim()) {
      setError("Informe o nome do treinamento.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: draft.name.trim(),
        durationLabel: draft.durationLabel.trim() || null,
        description: draft.description.trim() || null,
        defaultPrice: parseAmount(draft.defaultPrice),
        minPrice: parseAmount(draft.minPrice),
        defaultInstallments: draft.defaultInstallments,
        businessUnit: draft.businessUnit,
        commissionPct: parseAmount(draft.commissionPct),
        lessonsCount: draft.lessonsCount.trim() ? Number(draft.lessonsCount) : null,
        lessonHours: parseAmount(draft.lessonHours),
        lessonsPerWeek: draft.lessonsPerWeek,
        enrollmentFee: parseAmount(draft.enrollmentFee) ?? 0,
        materialFee: parseAmount(draft.materialFee) ?? 0,
        active: draft.active,
      };
      const response = await fetch(
        draft.id ? `/api/catalog/trainings/${draft.id}` : "/api/catalog/trainings",
        {
          method: draft.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Falha ao salvar o treinamento.");
      setDraft(null);
      await refresh(from, to);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar o treinamento.");
    } finally {
      setSaving(false);
    }
  }

  async function removeTraining(training: TrainingCatalogItem) {
    const message =
      training.sales > 0
        ? `"${training.name}" já tem ${training.sales} venda(s) registrada(s) e será apenas desativado, para o histórico de faturamento continuar íntegro. Continuar?`
        : `Excluir "${training.name}" do catálogo?`;
    if (!window.confirm(message)) return;

    setError(null);
    try {
      const response = await fetch(`/api/catalog/trainings/${training.id}`, { method: "DELETE" });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Falha ao excluir o treinamento.");
      await refresh(from, to);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir o treinamento.");
    }
  }

  const inputClass =
    "w-full rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-sm text-neutral-900 focus:border-cyan-400 focus:outline-none";
  const labelClass = "mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400";

  return (
    <main className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Cursos</h1>
          <p className="text-sm text-neutral-500">
            Preço, aulas e como o valor aparece no contrato — mais o retorno de cada curso por origem.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setDraft(emptyDraft())}
            className="inline-flex h-10 items-center gap-2 self-start rounded-lg bg-neutral-900 px-4 text-sm font-bold text-white hover:bg-neutral-800"
          >
            <Plus className="h-4 w-4" /> Novo treinamento
          </button>
        )}
      </header>

      {error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard icon={Tag} tone="teal" label="Cursos ativos" value={String(activeCount)} />
        <SummaryCard icon={TrendingUp} tone="teal" label="Vendas no período" value={String(report.totals.sales)} />
        <SummaryCard icon={Wallet} tone="brand" label="Contratado" value={money(report.totals.contracted)} hint="Valor fechado, pago ou não" />
        <SummaryCard icon={HandCoins} tone="amber" label="Recebido" value={money(report.totals.received)} hint="Dinheiro que já entrou" />
      </div>

      {/* ── Catálogo ─────────────────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-100 px-5 py-4">
          <h2 className="text-sm font-bold text-neutral-900">Tabela de preços</h2>
          <p className="text-xs text-neutral-500">
            O valor padrão vem preenchido no fechamento e continua editável — a diferença é registrada como desconto.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-400">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Treinamento</th>
                <th className="px-4 py-2 text-right font-semibold">Valor padrão</th>
                <th className="px-4 py-2 text-right font-semibold">Piso</th>
                <th className="px-4 py-2 text-center font-semibold">Parcelas</th>
                <th className="px-4 py-2 text-right font-semibold">Vendas</th>
                <th className="px-4 py-2 text-right font-semibold">Contratado</th>
                <th className="px-4 py-2 text-right font-semibold">Ticket médio</th>
                {canManage && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {trainings.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 8 : 7} className="px-4 py-10 text-center text-sm text-neutral-400">
                    Nenhum treinamento cadastrado ainda.
                  </td>
                </tr>
              ) : (
                trainings.map((training) => (
                  <tr key={training.id} className={training.active ? "" : "bg-neutral-50/60 text-neutral-400"}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-neutral-900">
                        {training.name}
                        {!training.active && (
                          <span className="ml-2 rounded-md bg-neutral-200 px-1.5 py-0.5 text-[10px] font-bold text-neutral-500">
                            inativo
                          </span>
                        )}
                      </p>
                      {training.businessUnit === "instituto" && (
                        <span className="mt-0.5 inline-block rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">
                          {FINANCE_BUSINESS_UNIT_LABELS.instituto}
                        </span>
                      )}
                      {training.durationLabel && (
                        <p className="text-xs text-neutral-400">{training.durationLabel}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-neutral-900">
                      {training.defaultPrice === null ? "—" : money(training.defaultPrice)}
                    </td>
                    <td className="px-4 py-3 text-right text-neutral-500">
                      {training.minPrice === null ? "—" : money(training.minPrice)}
                    </td>
                    <td className="px-4 py-3 text-center text-neutral-500">{training.defaultInstallments}x</td>
                    <td className="px-4 py-3 text-right text-neutral-700">{training.sales}</td>
                    <td className="px-4 py-3 text-right text-neutral-700">{money(training.contracted)}</td>
                    <td className="px-4 py-3 text-right">
                      {training.averageTicket === null ? (
                        <span className="text-neutral-300">—</span>
                      ) : (
                        <span
                          className={
                            training.defaultPrice !== null && training.averageTicket < training.defaultPrice
                              ? "font-semibold text-amber-600"
                              : "text-neutral-700"
                          }
                        >
                          {money(training.averageTicket)}
                        </span>
                      )}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setDraft(draftFrom(training))}
                            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                            aria-label={`Editar ${training.name}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeTraining(training)}
                            className="rounded-lg p-1.5 text-neutral-400 hover:bg-rose-50 hover:text-rose-600"
                            aria-label={`Excluir ${training.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Retorno por origem ───────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-neutral-100 px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-neutral-900">
              <Megaphone className="h-4 w-4 text-neutral-400" /> De onde veio o faturamento
            </h2>
            <p className="text-xs text-neutral-500">
              Somente vendas registradas a partir de um lead do CRM — é o que tem origem rastreável.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label className={labelClass}>De</label>
              <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Até</label>
              <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className={inputClass} />
            </div>
            <button
              type="button"
              onClick={() => refresh(from, to)}
              disabled={loadingReport}
              className="inline-flex h-[34px] items-center gap-2 rounded-lg bg-neutral-900 px-3 text-xs font-bold text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {loadingReport ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
              Aplicar
            </button>
          </div>
        </div>

        <div className="grid gap-0 lg:grid-cols-2 lg:divide-x lg:divide-neutral-100">
          <OriginTable title="Por campanha / origem" rows={report.byOrigin} />
          <OriginTable title="Por treinamento" rows={report.byTraining} />
        </div>

        <div className="border-t border-neutral-100">
          <p className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-neutral-400">
            Vendas no período ({report.rows.length})
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-400">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Data</th>
                  <th className="px-4 py-2 text-left font-semibold">Aluno</th>
                  <th className="px-4 py-2 text-left font-semibold">Treinamento</th>
                  <th className="px-4 py-2 text-left font-semibold">Veio de</th>
                  <th className="px-4 py-2 text-right font-semibold">Contratado</th>
                  <th className="px-4 py-2 text-right font-semibold">Recebido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {report.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-neutral-400">
                      Nenhuma venda registrada pelo CRM neste período.
                    </td>
                  </tr>
                ) : (
                  report.rows.map((row) => (
                    <tr key={row.enrollmentId}>
                      <td className="px-4 py-2.5 text-neutral-500">
                        {row.saleDate.split("-").reverse().join("/")}
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-neutral-900">{row.student}</td>
                      <td className="px-4 py-2.5 text-neutral-600">{row.courseName ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <OriginBadge row={row} />
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-neutral-900">{money(row.amount)}</td>
                      <td className="px-4 py-2.5 text-right text-neutral-600">{money(row.received)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Modal de treinamento ─────────────────────────── */}
      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-100 px-6 py-4">
              <p className="text-sm font-bold text-neutral-900">
                {draft.id ? "Editar treinamento" : "Novo treinamento"}
              </p>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 px-6 py-4">
              <div>
                <label className={labelClass}>Nome *</label>
                <input
                  autoFocus
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="Ex.: Curso de Oratória 6 meses"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Empresa *</label>
                <select
                  value={draft.businessUnit}
                  onChange={(event) =>
                    setDraft({ ...draft, businessUnit: normalizeBusinessUnit(event.target.value) })
                  }
                  className={inputClass}
                >
                  {FINANCE_BUSINESS_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {FINANCE_BUSINESS_UNIT_LABELS[unit]}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-neutral-400">
                  A venda deste curso entra no Financeiro desta empresa — receita, parcelas e
                  comissão. O contrato e o fechamento no CRM são os mesmos dos dois lados.
                </p>
              </div>
              <div>
                <label className={labelClass}>Duração</label>
                <input
                  value={draft.durationLabel}
                  onChange={(event) => setDraft({ ...draft, durationLabel: event.target.value })}
                  placeholder="Ex.: 6 meses · 24 encontros"
                  className={inputClass}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Valor padrão (R$)</label>
                  <input
                    inputMode="decimal"
                    value={draft.defaultPrice}
                    onChange={(event) => setDraft({ ...draft, defaultPrice: event.target.value })}
                    placeholder="Ex.: 5000,00"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Piso de desconto (R$)</label>
                  <input
                    inputMode="decimal"
                    value={draft.minPrice}
                    onChange={(event) => setDraft({ ...draft, minPrice: event.target.value })}
                    placeholder="Opcional"
                    className={inputClass}
                  />
                </div>
              </div>
              <p className="text-[11px] text-neutral-400">
                O piso não bloqueia a venda: só avisa o vendedor quando o valor fechado fica abaixo dele.
              </p>

              {/* ── AULAS ──────────────────────────────────────────
                  É daqui que sai o quadro de aulas da turma (uma linha por
                  data, pulando feriado) e a carga horária do contrato. */}
              <div className="rounded-xl border border-cyan-200 bg-cyan-50/40 p-3">
                <p className="text-xs font-bold text-neutral-900">Aulas</p>
                <p className="mb-2 text-[11px] text-neutral-500">
                  A turma gera o quadro de aulas a partir daqui, e o contrato recebe a carga
                  horária pronta. <strong>Imersão:</strong> deixe o nº de aulas vazio e informe a
                  carga horária total no campo de horas — o contrato sai só com o tempo.
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={labelClass}>Nº de aulas</label>
                    <input
                      inputMode="numeric"
                      value={draft.lessonsCount}
                      onChange={(event) => setDraft({ ...draft, lessonsCount: event.target.value })}
                      placeholder="Ex.: 24"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Horas por aula (ou total)</label>
                    <input
                      inputMode="decimal"
                      value={draft.lessonHours}
                      onChange={(event) => setDraft({ ...draft, lessonHours: event.target.value })}
                      placeholder="Ex.: 2"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Aulas por semana</label>
                    <select
                      value={draft.lessonsPerWeek}
                      onChange={(event) =>
                        setDraft({ ...draft, lessonsPerWeek: Number(event.target.value) })
                      }
                      className={inputClass}
                    >
                      {[1, 2, 3].map((n) => (
                        <option key={n} value={n}>
                          {n}x por semana
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {totalHours !== null && (
                  <p className="mt-1 text-[11px] font-semibold text-cyan-800">
                    Carga horária total: {totalHours} horas
                  </p>
                )}
              </div>

              {/* ── CONTRATO ───────────────────────────────────────
                  Item 4: o que não for matrícula nem material vira CURSO. */}
              <div className="rounded-xl border border-neutral-200 p-3">
                <p className="text-xs font-bold text-neutral-900">Como aparece no contrato</p>
                <p className="mb-2 text-[11px] text-neutral-500">
                  Valores sugeridos na venda. O que sobrar do valor fechado vira a linha CURSO.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Matrícula (R$)</label>
                    <input
                      inputMode="decimal"
                      value={draft.enrollmentFee}
                      onChange={(event) => setDraft({ ...draft, enrollmentFee: event.target.value })}
                      placeholder="Ex.: 500,00"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Material didático (R$)</label>
                    <input
                      inputMode="decimal"
                      value={draft.materialFee}
                      onChange={(event) => setDraft({ ...draft, materialFee: event.target.value })}
                      placeholder="Ex.: 800,00"
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>
              <div>
                <label className={labelClass}>Comissão do vendedor (%)</label>
                <input
                  inputMode="decimal"
                  value={draft.commissionPct}
                  onChange={(event) => setDraft({ ...draft, commissionPct: event.target.value })}
                  placeholder="Vazio: usa o percentual do vendedor"
                  className={inputClass}
                />
                <p className="mt-1 text-[11px] text-neutral-400">
                  Preencha só quando este curso paga diferente do resto. <strong>0</strong> = a venda
                  não gera comissão automática.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Parcelas sugeridas</label>
                  <select
                    value={draft.defaultInstallments}
                    onChange={(event) => setDraft({ ...draft, defaultInstallments: Number(event.target.value) })}
                    className={inputClass}
                  >
                    {Array.from({ length: 24 }, (_, index) => index + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}x
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Situação</label>
                  <select
                    value={draft.active ? "1" : "0"}
                    onChange={(event) => setDraft({ ...draft, active: event.target.value === "1" })}
                    className={inputClass}
                  >
                    <option value="1">Ativo</option>
                    <option value="0">Inativo</option>
                  </select>
                </div>
              </div>
              <div>
                <label className={labelClass}>Descrição</label>
                <textarea
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  rows={2}
                  className={inputClass}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-neutral-100 px-6 py-4">
              <button
                type="button"
                onClick={() => setDraft(null)}
                disabled={saving}
                className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={saveTraining}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function SummaryCard({
  icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  tone: IconTileTone;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <IconTile icon={icon} tone={tone} size="lg" solid />
      <div className="min-w-0">
        <p className="text-sm font-medium text-neutral-500">{label}</p>
        <p className="truncate text-xl font-bold text-neutral-900">{value}</p>
        {hint && <p className="text-[10px] text-neutral-400">{hint}</p>}
      </div>
    </div>
  );
}

function OriginTable({ title, rows }: { title: string; rows: SalesOriginReport["byOrigin"] }) {
  return (
    <div>
      <p className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-neutral-400">{title}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-400">
            <tr>
              <th className="px-5 py-2 text-left font-semibold">Origem</th>
              <th className="px-4 py-2 text-right font-semibold">Vendas</th>
              <th className="px-4 py-2 text-right font-semibold">Contratado</th>
              <th className="px-5 py-2 text-right font-semibold">Recebido</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-sm text-neutral-400">
                  Sem dados no período.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.key}>
                  <td className="max-w-[240px] truncate px-5 py-2.5 text-neutral-700" title={row.label}>
                    {row.label}
                  </td>
                  <td className="px-4 py-2.5 text-right text-neutral-500">{row.sales}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-neutral-900">{money(row.contracted)}</td>
                  <td className="px-5 py-2.5 text-right text-neutral-600">{money(row.received)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OriginBadge({ row }: { row: SalesOriginReport["rows"][number] }) {
  if (row.campaignName) {
    return (
      <span className="inline-flex flex-col">
        <span className="w-fit rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">
          Anúncio
        </span>
        <span className="mt-0.5 max-w-[220px] truncate text-[11px] text-neutral-500" title={row.campaignName}>
          {row.campaignName}
          {row.adName ? ` · ${row.adName}` : ""}
        </span>
      </span>
    );
  }
  if (row.origem) {
    return <span className="text-[11px] text-neutral-500">{row.origem}</span>;
  }
  return <span className="text-[11px] text-neutral-300">Sem origem</span>;
}
