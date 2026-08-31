"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, GraduationCap, Loader2, RefreshCw, Wand2 } from "lucide-react";

/**
 * A fila de regularização: toda matrícula e o que falta nela.
 *
 * Existe porque a informação estava espalhada em três telas que nunca se
 * encontravam — `/contratos` sabia quem não tinha contrato, `/alunos` sabia quem
 * não tinha ficha e `/matriculas` sabia quem não tinha turma. Com o quadro
 * partido, "a turma começa hoje e o diário está vazio" não tinha onde ser
 * respondido, porque a resposta ("as matrículas apontam para a turma, mas
 * ninguém criou a ficha, e quem entra no diário é a ficha") depende das três.
 */

export type EnrollmentGap = "ficha" | "turma" | "diario" | "estranho" | "contrato";

export interface EnrollmentPendency {
  enrollmentId: number;
  student: string;
  courseId: number | null;
  courseName: string | null;
  businessUnit: string;
  saleDate: string | null;
  amount: number;
  leadInscricaoId: number | null;
  studentId: number | null;
  classId: number | null;
  className: string | null;
  contractStatus: string | null;
  peopleCount: number;
  seatedCount: number;
  strayCount: number;
  missing: EnrollmentGap[];
}

const GAP_LABEL: Record<EnrollmentGap, string> = {
  ficha: "sem ficha de aluno",
  turma: "sem turma",
  diario: "fora do diário",
  estranho: "gente a mais no diário",
  contrato: "sem contrato",
};

const GAP_TONE: Record<EnrollmentGap, string> = {
  ficha: "bg-rose-100 text-rose-700",
  turma: "bg-amber-100 text-amber-800",
  diario: "bg-orange-100 text-orange-800",
  estranho: "bg-fuchsia-100 text-fuchsia-800",
  contrato: "bg-violet-100 text-violet-700",
};

const FILTERS: Array<{ key: "todas" | EnrollmentGap; label: string }> = [
  { key: "todas", label: "Todas as pendências" },
  { key: "diario", label: "Fora do diário" },
  { key: "estranho", label: "Gente a mais" },
  { key: "ficha", label: "Sem ficha" },
  { key: "turma", label: "Sem turma" },
  { key: "contrato", label: "Sem contrato" },
];

function money(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function RegularizarPanel({
  canManage,
  onCompletar,
  onChanged,
}: {
  canManage: boolean;
  /** Abre o assistente já preso a esta matrícula, para completar o quadro. */
  onCompletar: (pendency: EnrollmentPendency) => void;
  onChanged: () => void;
}) {
  const [pendencies, setPendencies] = useState<EnrollmentPendency[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"todas" | EnrollmentGap>("todas");
  const [working, setWorking] = useState<number | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "erro"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/contracts/intake?pendencias=1");
      const data = (await response.json().catch(() => ({}))) as { pendencies?: EnrollmentPendency[] };
      setPendencies(data.pendencies ?? []);
    } catch {
      setPendencies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pendentes = useMemo(() => pendencies.filter((item) => item.missing.length > 0), [pendencies]);
  const visiveis = useMemo(
    () => (filter === "todas" ? pendentes : pendentes.filter((item) => item.missing.includes(filter))),
    [pendentes, filter]
  );

  const contagem = useMemo(() => {
    const base: Record<EnrollmentGap, number> = { ficha: 0, turma: 0, diario: 0, estranho: 0, contrato: 0 };
    for (const item of pendentes) for (const gap of item.missing) base[gap] += 1;
    return base;
  }, [pendentes]);

  /**
   * Resolve só o dedutível. NÃO preenche CPF/RG/endereço: esses dados não estão
   * em lugar nenhum do sistema, e inventá-los colocaria número errado dentro de
   * um documento assinado — por isso o contrato costuma continuar pendente
   * depois desta ação, e a tela diz exatamente o que ficou faltando.
   */
  async function regularizarRapido(pendency: EnrollmentPendency) {
    setWorking(pendency.enrollmentId);
    setMessage(null);
    try {
      const response = await fetch("/api/contracts/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modo: "rapido", enrollmentId: pendency.enrollmentId }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        seated?: boolean;
        contractId?: number | null;
        contractError?: string | null;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível regularizar.");

      const partes = [
        "Ficha criada",
        data.seated ? "aluno no diário da turma" : null,
        data.contractId ? "contrato gerado" : null,
      ].filter(Boolean);
      setMessage({
        tone: data.contractError ? "erro" : "ok",
        text: data.contractError
          ? `${partes.join(", ")}. O contrato não saiu: ${data.contractError}`
          : `${partes.join(", ")}.`,
      });
      await load();
      onChanged();
    } catch (err) {
      setMessage({ tone: "erro", text: err instanceof Error ? err.message : "Falha ao regularizar." });
    } finally {
      setWorking(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-neutral-100 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-bold text-neutral-900">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Regularizar — {pendentes.length} matrícula(s) com pendência
          </h2>
          <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-neutral-500">
            Toda matrícula precisa de ficha de aluno, cadeira na turma e contrato. Quem entra no diário de
            classe é a <strong>ficha</strong> — matrícula que aponta para a turma sem ficha criada deixa a
            chamada vazia no dia da aula.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-9 flex-none items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-700 hover:bg-neutral-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-neutral-100 px-5 py-3">
        {FILTERS.map((option) => {
          const total = option.key === "todas" ? pendentes.length : contagem[option.key];
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => setFilter(option.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                filter === option.key
                  ? "bg-neutral-900 text-white"
                  : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
              }`}
            >
              {option.label} · {total}
            </button>
          );
        })}
      </div>

      {message && (
        <p
          role="status"
          className={`px-5 py-3 text-xs font-semibold ${
            message.tone === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"
          }`}
        >
          {message.text}
        </p>
      )}

      {loading ? (
        <p className="px-5 py-8 text-sm text-neutral-500">Carregando matrículas…</p>
      ) : visiveis.length === 0 ? (
        <p className="flex items-center gap-2 px-5 py-8 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" /> Nenhuma pendência neste filtro.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-neutral-50 text-left text-[11px] uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-5 py-2 font-semibold">Aluno</th>
                <th className="px-3 py-2 font-semibold">Treinamento</th>
                <th className="px-3 py-2 font-semibold">Turma</th>
                <th className="px-3 py-2 font-semibold">No diário</th>
                <th className="px-3 py-2 font-semibold">Contrato</th>
                <th className="px-3 py-2 font-semibold">O que falta</th>
                <th className="px-5 py-2 font-semibold text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {visiveis.map((item) => (
                <tr key={item.enrollmentId} className="align-top">
                  <td className="px-5 py-3">
                    <p className="font-semibold text-neutral-900">{item.student}</p>
                    <p className="text-xs text-neutral-500">
                      #{item.enrollmentId} · {money(item.amount)}
                      {item.saleDate ? ` · ${item.saleDate.split("-").reverse().join("/")}` : ""}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-xs text-neutral-600">{item.courseName ?? "—"}</td>
                  <td className="px-3 py-3 text-xs text-neutral-600">
                    {item.className ? (
                      <Link href={`/turmas?turma=${item.classId}`} className="font-semibold text-cyan-700 hover:underline">
                        {item.className}
                      </Link>
                    ) : (
                      <span className="text-neutral-400">definir</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
                        item.seatedCount >= item.peopleCount
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-orange-100 text-orange-800"
                      }`}
                    >
                      <GraduationCap className="h-3 w-3" />
                      {item.seatedCount}/{item.peopleCount}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {item.contractStatus === "assinado" ? (
                      <span className="font-bold text-emerald-700">assinado</span>
                    ) : item.contractStatus === "pendente" ? (
                      <span className="font-bold text-amber-700">aguardando assinatura</span>
                    ) : (
                      <span className="font-bold text-rose-700">nenhum</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1">
                      {item.missing.map((gap) => (
                        <span
                          key={gap}
                          className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${GAP_TONE[gap]}`}
                        >
                          {GAP_LABEL[gap]}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {canManage && (
                      <div className="inline-flex flex-col items-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onCompletar(item)}
                          className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-neutral-800"
                        >
                          Completar
                        </button>
                        {/* Só aparece quando há o que deduzir: sem ficha, ou com
                            turma apontada e ninguém sentado nela. */}
                        {(item.missing.includes("ficha") || item.missing.includes("diario")) && (
                          <button
                            type="button"
                            disabled={working === item.enrollmentId}
                            onClick={() => void regularizarRapido(item)}
                            title="Cria a ficha com o nome que já está na matrícula e coloca o aluno no diário da turma. Não preenche CPF nem endereço."
                            className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-bold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                          >
                            {working === item.enrollmentId ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Wand2 className="h-3 w-3" />
                            )}
                            Ficha + diário
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
