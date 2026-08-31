"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, Download, FileText, RefreshCw } from "lucide-react";

/**
 * Relatório de produção das rotinas.
 *
 * A agregação vem pronta do banco (`getProductionSummary`): a tela não soma
 * nada em cima de milhares de registros, só apresenta. Os mesmos filtros são
 * repassados à exportação, para o arquivo conter exatamente o que está à vista.
 */

interface SummaryRow {
  memberId: number | null;
  memberName: string;
  taskId: number;
  taskTitle: string;
  metricId: number;
  metricName: string;
  unit: string;
  total: number;
  days: number;
  average: number;
  max: number;
  min: number;
}

interface EntryValue {
  metricId: number;
  metricName: string;
  unit: string;
  numeric: number | null;
  text: string | null;
}

interface Entry {
  id: number;
  entryDate: string;
  memberName: string | null;
  taskTitle: string;
  note: string | null;
  values: EntryValue[];
}

interface Payload {
  summary: SummaryRow[];
  entries: Entry[];
  tasks: Array<{ id: number; title: string }>;
  members: Array<{ id: number; name: string }>;
  canSeeEveryone: boolean;
}

function primeiroDiaDoMes(): string {
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  return `${hoje.slice(0, 7)}-01`;
}

function hoje(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

function formatarValor(unit: string, numeric: number | null, text: string | null): string {
  if (unit === "texto") return text ?? "—";
  if (unit === "checagem") return numeric ? "Sim" : "Não";
  if (numeric === null) return "—";
  if (unit === "moeda") return numeric.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (unit === "duracao") return `${numeric.toLocaleString("pt-BR")} min`;
  return numeric.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export default function ProducaoClient() {
  const [dados, setDados] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [from, setFrom] = useState(primeiroDiaDoMes);
  const [to, setTo] = useState(hoje);
  const [memberId, setMemberId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [aba, setAba] = useState<"resumo" | "usuarios" | "dia">("resumo");

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (memberId) params.set("memberId", memberId);
    if (taskId) params.set("taskId", taskId);
    return params.toString();
  }, [from, to, memberId, taskId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/tasks/production/report?${query}`);
      const payload = (await response.json().catch(() => ({}))) as Payload & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Falha ao carregar o relatório.");
      setDados(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar o relatório.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  // useMemo para a referência não mudar a cada render — os useMemo abaixo
  // dependem dela e recalculariam sempre.
  const summary = useMemo(() => dados?.summary ?? [], [dados]);

  /** Ranking por pessoa — soma de tudo que ela produziu no recorte. */
  const porUsuario = useMemo(() => {
    const mapa = new Map<string, { usuario: string; total: number; dias: number; indicadores: number }>();
    for (const row of summary) {
      const atual = mapa.get(row.memberName) ?? { usuario: row.memberName, total: 0, dias: 0, indicadores: 0 };
      atual.total += row.total;
      atual.dias = Math.max(atual.dias, row.days);
      atual.indicadores += 1;
      mapa.set(row.memberName, atual);
    }
    return [...mapa.values()].sort((a, b) => b.total - a.total);
  }, [summary]);

  /** Visão diária: o que cada pessoa produziu em cada dia. */
  const porDia = useMemo(() => {
    const mapa = new Map<string, Entry[]>();
    for (const entry of dados?.entries ?? []) {
      mapa.set(entry.entryDate, [...(mapa.get(entry.entryDate) ?? []), entry]);
    }
    return [...mapa.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [dados]);

  const totalRegistros = dados?.entries.length ?? 0;

  /**
   * Números do topo. Só o que os dados sustentam: nada de "taxa de conversão"
   * sem ter as duas pontas medidas — número inventado em relatório gerencial é
   * pior que número ausente.
   */
  const resumoGeral = useMemo(() => {
    const dias = new Set((dados?.entries ?? []).map((entry) => entry.entryDate));
    const pessoas = new Set(porUsuario.map((row) => row.usuario));
    const rotinas = new Set(summary.map((row) => row.taskTitle));
    const lider = porUsuario[0] ?? null;
    return {
      registros: totalRegistros,
      dias: dias.size,
      pessoas: pessoas.size,
      rotinas: rotinas.size,
      lider,
    };
  }, [dados, porUsuario, summary, totalRegistros]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <BarChart3 className="size-5 text-cyan-600" />
        <h1 className="text-2xl font-semibold text-[rgb(var(--slate-12))]">Produção</h1>
        <p className="w-full text-sm text-[rgb(var(--slate-10))]">
          Produção registrada nas rotinas do Kanban — total, média e comparação por pessoa.
        </p>
      </header>

      <section className="flex flex-wrap items-end gap-2 rounded-xl border border-neutral-200 bg-white p-3">
        <label className="grid gap-1 text-[11px] font-semibold text-neutral-500">
          De
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="rounded-lg border border-neutral-200 px-2 py-1.5 text-xs"
          />
        </label>
        <label className="grid gap-1 text-[11px] font-semibold text-neutral-500">
          Até
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="rounded-lg border border-neutral-200 px-2 py-1.5 text-xs"
          />
        </label>

        {dados?.canSeeEveryone && (
          <label className="grid gap-1 text-[11px] font-semibold text-neutral-500">
            Usuário
            <select
              value={memberId}
              onChange={(event) => setMemberId(event.target.value)}
              className="rounded-lg border border-neutral-200 px-2 py-1.5 text-xs"
            >
              <option value="">Todos</option>
              {dados.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="grid gap-1 text-[11px] font-semibold text-neutral-500">
          Tarefa
          <select
            value={taskId}
            onChange={(event) => setTaskId(event.target.value)}
            className="rounded-lg border border-neutral-200 px-2 py-1.5 text-xs"
          >
            <option value="">Todas as rotinas</option>
            {(dados?.tasks ?? []).map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>
        </label>

        <span className="ml-auto flex items-center gap-2">
          <a
            href={`/api/tasks/production/export?${query}&format=xlsx`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            <Download className="size-3.5" /> Excel
          </a>
          <a
            href={`/api/tasks/production/export?${query}&format=pdf`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            <FileText className="size-3.5" /> PDF
          </a>
        </span>
      </section>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => void load()} className="font-semibold hover:underline">
            Tentar de novo
          </button>
        </div>
      )}

      {!loading && summary.length > 0 && (
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Registros", resumoGeral.registros.toLocaleString("pt-BR")],
            ["Dias com produção", resumoGeral.dias.toLocaleString("pt-BR")],
            ["Pessoas", resumoGeral.pessoas.toLocaleString("pt-BR")],
            ["Rotinas medidas", resumoGeral.rotinas.toLocaleString("pt-BR")],
          ].map(([label, valor]) => (
            <div key={label} className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">{label}</p>
              <p className="text-xl font-bold text-neutral-900">{valor}</p>
            </div>
          ))}
          {resumoGeral.lider && (
            <div className="col-span-2 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2.5 sm:col-span-4">
              <p className="text-[10px] font-bold uppercase tracking-wide text-cyan-700">
                Maior produção no período
              </p>
              <p className="text-sm font-bold text-cyan-900">
                {resumoGeral.lider.usuario} — {resumoGeral.lider.total.toLocaleString("pt-BR")} somados em{" "}
                {resumoGeral.lider.dias} dia(s)
              </p>
            </div>
          )}
        </section>
      )}

      <nav className="flex gap-1">
        {(
          [
            ["resumo", "Por indicador"],
            ["usuarios", "Por usuário"],
            ["dia", "Por dia"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setAba(key)}
            aria-pressed={aba === key}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              aba === key ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto self-center text-[11px] text-neutral-400">{totalRegistros} registro(s)</span>
      </nav>

      {loading ? (
        <p className="flex items-center gap-2 py-6 text-sm text-neutral-400">
          <RefreshCw className="size-4 animate-spin" /> Carregando…
        </p>
      ) : summary.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-200 py-8 text-center text-sm text-neutral-400">
          Nenhuma produção registrada no período. Registre pela rotina, no card do Kanban.
        </p>
      ) : (
        <section className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          {aba === "resumo" && (
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-3 py-2">Usuário</th>
                  <th className="px-3 py-2">Tarefa</th>
                  <th className="px-3 py-2">Indicador</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Dias</th>
                  <th className="px-3 py-2 text-right">Média</th>
                  <th className="px-3 py-2 text-right">Maior</th>
                  <th className="px-3 py-2 text-right">Menor</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((row) => (
                  <tr key={`${row.memberId}-${row.taskId}-${row.metricId}`} className="border-t border-neutral-100">
                    <td className="px-3 py-2 font-semibold text-neutral-800">{row.memberName}</td>
                    <td className="px-3 py-2 text-neutral-600">{row.taskTitle}</td>
                    <td className="px-3 py-2 text-neutral-600">{row.metricName}</td>
                    <td className="px-3 py-2 text-right font-bold text-neutral-900">
                      {formatarValor(row.unit, row.total, null)}
                    </td>
                    <td className="px-3 py-2 text-right text-neutral-600">{row.days}</td>
                    <td className="px-3 py-2 text-right text-neutral-600">
                      {row.average.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
                    </td>
                    <td className="px-3 py-2 text-right text-neutral-600">{row.max.toLocaleString("pt-BR")}</td>
                    <td className="px-3 py-2 text-right text-neutral-600">{row.min.toLocaleString("pt-BR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {aba === "usuarios" && (
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Usuário</th>
                  <th className="px-3 py-2 text-right">Total somado</th>
                  <th className="px-3 py-2 text-right">Dias registrados</th>
                  <th className="px-3 py-2 text-right">Indicadores</th>
                </tr>
              </thead>
              <tbody>
                {porUsuario.map((row, index) => (
                  <tr key={row.usuario} className="border-t border-neutral-100">
                    <td className="px-3 py-2 text-neutral-400">{index + 1}</td>
                    <td className="px-3 py-2 font-semibold text-neutral-800">{row.usuario}</td>
                    <td className="px-3 py-2 text-right font-bold text-neutral-900">
                      {row.total.toLocaleString("pt-BR")}
                    </td>
                    <td className="px-3 py-2 text-right text-neutral-600">{row.dias}</td>
                    <td className="px-3 py-2 text-right text-neutral-600">{row.indicadores}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {aba === "dia" && (
            <div className="divide-y divide-neutral-100">
              {porDia.map(([dia, registros]) => (
                <div key={dia} className="px-3 py-2.5">
                  <p className="mb-1.5 text-xs font-bold text-neutral-800">{formatarData(dia)}</p>
                  <ul className="space-y-1">
                    {registros.map((entry) => (
                      <li key={entry.id} className="text-[11px] text-neutral-600">
                        <span className="font-semibold text-neutral-800">{entry.memberName ?? "—"}</span>
                        {" · "}
                        {entry.taskTitle}
                        {entry.values.length > 0 && " · "}
                        {entry.values
                          .map((value) => `${value.metricName}: ${formatarValor(value.unit, value.numeric, value.text)}`)
                          .join(" · ")}
                        {entry.note && <span className="text-neutral-400"> ({entry.note})</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
