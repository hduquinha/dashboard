"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, Plus, RefreshCw, Repeat, Trash2 } from "lucide-react";

/**
 * Bloco de produção de uma tarefa recorrente, dentro do card.
 *
 * A regra do módulo: UMA rotina = UMA tarefa + VÁRIOS registros. Por isso aqui
 * não existe "concluir" — existe "registrar a produção de hoje". A tarefa
 * "Responder o Instagram" nunca sai do quadro; o que cresce é o histórico.
 *
 * Os números NÃO vão para a descrição da tarefa de propósito: descrição não é
 * somável nem filtrável, e cresceria para sempre.
 */

interface Metric {
  id: number;
  name: string;
  unit: "inteiro" | "decimal" | "texto" | "duracao" | "moeda" | "checagem";
  dailyTarget: number | null;
}

interface EntryValue {
  metricId: number;
  metricName: string;
  unit: Metric["unit"];
  numeric: number | null;
  text: string | null;
}

interface Entry {
  id: number;
  entryDate: string;
  memberId: number | null;
  memberName: string | null;
  note: string | null;
  createdByName: string | null;
  updatedAt: string;
  values: EntryValue[];
}

interface Props {
  taskId: number;
}

const UNIT_LABELS: Record<Metric["unit"], string> = {
  inteiro: "Número inteiro",
  decimal: "Número decimal",
  texto: "Texto",
  duracao: "Duração (min)",
  moeda: "Valor (R$)",
  checagem: "Checagem (sim/não)",
};

/** Hoje no fuso de São Paulo — o mesmo critério do resto da agenda. */
function hojeSaoPaulo(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

function formatarValor(value: EntryValue): string {
  if (value.unit === "texto") return value.text ?? "—";
  if (value.unit === "checagem") return value.numeric ? "Sim" : "Não";
  if (value.numeric === null) return "—";
  if (value.unit === "moeda") {
    return value.numeric.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  if (value.unit === "duracao") return `${value.numeric} min`;
  return value.numeric.toLocaleString("pt-BR");
}

export function TaskProductionSection({ taskId }: Props) {
  /** Vem da API junto com os dados — evita propagar permissão por várias camadas de props. */
  const [canManageAny, setCanManageAny] = useState(false);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [memberId, setMemberId] = useState<number | null>(null);
  const [meuNome, setMeuNome] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [data, setData] = useState(hojeSaoPaulo);
  const [valores, setValores] = useState<Record<number, string>>({});
  const [nota, setNota] = useState("");

  const [novoIndicador, setNovoIndicador] = useState("");
  const [novaUnidade, setNovaUnidade] = useState<Metric["unit"]>("inteiro");
  const [mostrarNovo, setMostrarNovo] = useState(false);

  const load = useCallback(
    async (offset = 0) => {
      setLoading(true);
      try {
        const response = await fetch(`/api/tasks/production?taskId=${taskId}&offset=${offset}`);
        const payload = (await response.json().catch(() => ({}))) as {
          metrics?: Metric[];
          entries?: Entry[];
          total?: number;
          memberId?: number | null;
          memberName?: string | null;
          canManageAny?: boolean;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error ?? "Falha ao carregar a produção.");
        setMetrics(payload.metrics ?? []);
        setEntries(offset === 0 ? payload.entries ?? [] : (atual) => [...atual, ...(payload.entries ?? [])]);
        setTotal(payload.total ?? 0);
        setMemberId(payload.memberId ?? null);
        setMeuNome(payload.memberName ?? null);
        setCanManageAny(Boolean(payload.canManageAny));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Falha ao carregar a produção.");
      } finally {
        setLoading(false);
      }
    },
    [taskId]
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  /**
   * Ao trocar a data, carrega o que já foi lançado naquele dia. É o que faz o
   * segundo registro do mesmo dia virar edição em vez de duplicata — o usuário
   * vê os números que já estão lá antes de salvar por cima.
   */
  useEffect(() => {
    const existente = entries.find((entry) => entry.entryDate === data && entry.memberId === memberId);
    if (!existente) {
      setValores({});
      setNota("");
      setAviso(null);
      return;
    }
    const preenchido: Record<number, string> = {};
    for (const value of existente.values) {
      preenchido[value.metricId] =
        value.unit === "texto"
          ? value.text ?? ""
          : value.unit === "checagem"
            ? value.numeric
              ? "1"
              : ""
            : String(value.numeric ?? "");
    }
    setValores(preenchido);
    setNota(existente.note ?? "");
    setAviso(`Já existe registro seu em ${formatarData(data)} — salvar vai atualizá-lo.`);
  }, [data, entries, memberId]);

  async function salvar() {
    setSaving(true);
    try {
      const response = await fetch("/api/tasks/production", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, entryDate: data, note: nota, values: valores }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; created?: boolean };
      if (!response.ok) throw new Error(payload.error ?? "Falha ao registrar.");
      setError(null);
      await load(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao registrar.");
    } finally {
      setSaving(false);
    }
  }

  async function criarIndicador() {
    const name = novoIndicador.trim();
    if (!name) return;
    setSaving(true);
    try {
      const response = await fetch("/api/tasks/production", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, action: "metric", name, unit: novaUnidade }),
      });
      const payload = (await response.json().catch(() => ({}))) as { metrics?: Metric[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Falha ao criar o indicador.");
      setMetrics(payload.metrics ?? []);
      setNovoIndicador("");
      setMostrarNovo(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar o indicador.");
    } finally {
      setSaving(false);
    }
  }

  async function remover(entryId: number) {
    setSaving(true);
    try {
      const response = await fetch(`/api/tasks/production?entryId=${entryId}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Falha ao remover.");
      await load(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao remover.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Histórico agrupado por dia, e dentro do dia uma linha por pessoa.
   *
   * Numa rotina compartilhada pela equipe o mesmo dia tem vários lançamentos;
   * uma lista corrida faria a pessoa caçar o próprio registro no meio dos
   * outros. A data aparece uma vez, como cabeçalho do bloco.
   */
  const porDia = useMemo(() => {
    const mapa = new Map<string, Entry[]>();
    for (const entry of entries) {
      mapa.set(entry.entryDate, [...(mapa.get(entry.entryDate) ?? []), entry]);
    }
    return [...mapa.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([dia, lista]) => [dia, [...lista].sort((a, b) => (a.memberName ?? "").localeCompare(b.memberName ?? ""))] as const);
  }, [entries]);

  /** Totais do que está carregado — o número fechado do período vive no relatório. */
  const resumo = useMemo(() => {
    const porMetrica = new Map<number, { nome: string; unit: Metric["unit"]; soma: number; dias: number }>();
    for (const entry of entries) {
      for (const value of entry.values) {
        if (value.unit === "texto" || value.numeric === null) continue;
        const atual = porMetrica.get(value.metricId) ?? {
          nome: value.metricName,
          unit: value.unit,
          soma: 0,
          dias: 0,
        };
        atual.soma += value.numeric;
        atual.dias += 1;
        porMetrica.set(value.metricId, atual);
      }
    }
    return [...porMetrica.values()];
  }, [entries]);

  return (
    <section className="space-y-4">
      <header className="flex items-center gap-2">
        <Repeat className="h-4 w-4 text-cyan-600" />
        <h3 className="text-sm font-bold text-neutral-900">Registrar produção</h3>
        <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-bold uppercase text-cyan-700">
          Rotina
        </span>
      </header>

      {error && (
        <p className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      {metrics.length === 0 && !loading ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Esta rotina ainda não tem indicadores. Crie pelo menos um (ex.: &quot;Pessoas
          respondidas&quot;) para poder registrar a produção do dia.
        </p>
      ) : null}

      <div className="grid gap-3 rounded-xl border border-neutral-200 p-3">
        <label className="grid gap-1 text-[11px] font-semibold text-neutral-500">
          Data
          <input
            type="date"
            value={data}
            max={hojeSaoPaulo()}
            onChange={(event) => setData(event.target.value)}
            className="w-40 rounded-lg border border-neutral-200 px-2 py-1.5 text-xs text-neutral-800 focus:border-cyan-400 focus:outline-none"
          />
        </label>

        {aviso && <p className="text-[11px] font-semibold text-amber-700">{aviso}</p>}

        {/* Quem registra é quem fica no registro, mesmo que a rotina seja de
            outra pessoa: se o Albert abrir a escola no lugar da Andrea, o
            histórico do dia tem que dizer Albert. */}
        {meuNome && (
          <p className="text-[11px] text-neutral-500">
            Registrando como <span className="font-semibold text-neutral-700">{meuNome}</span>
          </p>
        )}

        {metrics.map((metric) =>
          /* Checagem é caixa de marcar: a rotina de presença ("a escola foi
             aberta?") não tem número para digitar, e obrigar um campo numérico
             ali só produziria o hábito de teclar 1 todo dia. */
          metric.unit === "checagem" ? (
            <label
              key={metric.id}
              className="flex items-center gap-2 text-xs font-semibold text-neutral-700"
            >
              <input
                type="checkbox"
                checked={valores[metric.id] === "1"}
                onChange={(event) =>
                  setValores((atual) => ({ ...atual, [metric.id]: event.target.checked ? "1" : "" }))
                }
                className="size-4 accent-cyan-600"
              />
              {metric.name}
            </label>
          ) : (
            <label key={metric.id} className="grid gap-1 text-[11px] font-semibold text-neutral-500">
              {metric.name}
              <span className="flex items-center gap-2">
                <input
                  type={metric.unit === "texto" ? "text" : "number"}
                  step={metric.unit === "decimal" || metric.unit === "moeda" ? "0.01" : "1"}
                  min={metric.unit === "texto" ? undefined : "0"}
                  value={valores[metric.id] ?? ""}
                  onChange={(event) =>
                    setValores((atual) => ({ ...atual, [metric.id]: event.target.value }))
                  }
                  className="w-40 rounded-lg border border-neutral-200 px-2 py-1.5 text-xs text-neutral-800 focus:border-cyan-400 focus:outline-none"
                />
                <span className="text-[10px] font-normal text-neutral-400">{UNIT_LABELS[metric.unit]}</span>
              </span>
            </label>
          )
        )}

        <label className="grid gap-1 text-[11px] font-semibold text-neutral-500">
          Observação
          <textarea
            value={nota}
            rows={2}
            onChange={(event) => setNota(event.target.value)}
            placeholder="Opcional"
            className="rounded-lg border border-neutral-200 px-2 py-1.5 text-xs text-neutral-800 focus:border-cyan-400 focus:outline-none"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={salvar}
            disabled={saving || metrics.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
            Salvar registro
          </button>

          {mostrarNovo ? (
            <span className="flex flex-wrap items-center gap-1.5">
              <input
                value={novoIndicador}
                onChange={(event) => setNovoIndicador(event.target.value)}
                placeholder="Nome do indicador"
                className="rounded-lg border border-neutral-200 px-2 py-1.5 text-xs focus:border-cyan-400 focus:outline-none"
              />
              <select
                value={novaUnidade}
                onChange={(event) => setNovaUnidade(event.target.value as Metric["unit"])}
                className="rounded-lg border border-neutral-200 px-2 py-1.5 text-xs"
              >
                {Object.entries(UNIT_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={criarIndicador}
                disabled={saving}
                className="rounded-lg bg-cyan-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700 disabled:opacity-50"
              >
                Criar
              </button>
              <button
                type="button"
                onClick={() => setMostrarNovo(false)}
                className="text-xs text-neutral-500 hover:underline"
              >
                Cancelar
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setMostrarNovo(true)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-700 hover:underline"
            >
              <Plus className="h-3.5 w-3.5" />
              Novo indicador
            </button>
          )}
        </div>
      </div>

      <header className="flex items-center gap-2 pt-1">
        <BarChart3 className="h-4 w-4 text-neutral-400" />
        <h3 className="text-sm font-bold text-neutral-900">Histórico de produção</h3>
        <span className="text-[11px] text-neutral-400">{total} registro(s)</span>
      </header>

      {resumo.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {resumo.map((item) => (
            <span
              key={item.nome}
              className="rounded-lg bg-neutral-100 px-2.5 py-1 text-[11px] font-semibold text-neutral-700"
            >
              {item.nome}: {item.soma.toLocaleString("pt-BR")} em {item.dias} dia(s) · média{" "}
              {(item.soma / item.dias).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
            </span>
          ))}
        </div>
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-xs text-neutral-400">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Carregando…
        </p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-neutral-400">Nenhuma produção registrada ainda.</p>
      ) : (
        <div className="space-y-3">
          {porDia.map(([dia, registros]) => (
            <div key={dia} className="rounded-lg border border-neutral-200">
              <p className="border-b border-neutral-100 bg-neutral-50 px-3 py-1.5 text-[11px] font-bold text-neutral-700">
                {formatarData(dia)}
                <span className="ml-1.5 font-normal text-neutral-400">
                  {registros.length === 1 ? "1 lançamento" : `${registros.length} lançamentos`}
                </span>
              </p>
              <ul className="divide-y divide-neutral-100">
                {registros.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2 text-xs">
                    <span className="min-w-[7rem] font-semibold text-neutral-800">
                      {entry.memberName ?? "Sem responsável"}
                    </span>
                    <span className="min-w-0 flex-1 text-neutral-700">
                      {entry.values.length === 0
                        ? "—"
                        : entry.values.map((value) => (
                            <span key={value.metricId} className="mr-2.5 inline-block whitespace-nowrap">
                              <span className="text-neutral-500">{value.metricName}:</span>{" "}
                              <span className="font-semibold">{formatarValor(value)}</span>
                            </span>
                          ))}
                      {entry.note && <span className="block text-[11px] text-neutral-400">{entry.note}</span>}
                    </span>
                    {(canManageAny || entry.memberId === memberId) && (
                      <button
                        type="button"
                        onClick={() => remover(entry.id)}
                        disabled={saving}
                        title="Remover este lançamento"
                        aria-label={`Remover o lançamento de ${entry.memberName ?? "sem responsável"} em ${formatarData(entry.entryDate)}`}
                        className="rounded p-1 text-neutral-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {entries.length < total && (
            <button
              type="button"
              onClick={() => void load(entries.length)}
              className="mt-2 text-xs font-semibold text-cyan-700 hover:underline"
            >
              Carregar mais ({total - entries.length} restantes)
            </button>
          )}
        </div>
      )}
    </section>
  );
}
