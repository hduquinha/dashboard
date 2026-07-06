"use client";

import { useState } from "react";
import { BadgeCheck, RefreshCw, X, XCircle } from "lucide-react";

export interface CloseLeadTarget {
  id: number;
  nome: string | null;
}

interface CloseLeadModalProps {
  lead: CloseLeadTarget;
  onClosed: (leadId: number) => void;
  onCancel: () => void;
}

type CloseReason = "curso_fechado" | "sem_continuidade";

/**
 * Fecha o lead e ele sai do Kanban: ou fechou um curso (informa qual e o
 * valor pago) ou nao quis dar continuidade. O historico fica preservado e o
 * lead pode voltar ao Kanban se for redistribuido.
 */
export function CloseLeadModal({ lead, onClosed, onCancel }: CloseLeadModalProps) {
  const [reason, setReason] = useState<CloseReason>("curso_fechado");
  const [courseName, setCourseName] = useState("");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (reason === "curso_fechado" && !courseName.trim()) {
      setError("Informe o nome do curso que o lead fechou.");
      return;
    }

    const parsedValue = value.trim()
      ? Number.parseFloat(value.replace(/\./g, "").replace(",", "."))
      : null;
    if (value.trim() && (!Number.isFinite(parsedValue) || (parsedValue as number) < 0)) {
      setError("Valor invalido. Use por exemplo 1497,00.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/commercial/leads/${lead.id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason,
          courseName: reason === "curso_fechado" ? courseName.trim() : null,
          value: reason === "curso_fechado" ? parsedValue : null,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Falha ao fechar o lead.");
      }
      onClosed(lead.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao fechar o lead.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-100 px-6 py-4">
          <div>
            <p className="text-sm font-bold text-neutral-900">Fechar lead</p>
            <p className="text-xs text-neutral-400">{lead.nome ?? `Lead #${lead.id}`} sai do Kanban — pode voltar se for redistribuído</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100"
            aria-label="Cancelar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-6 py-4">
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

          <button
            type="button"
            onClick={() => setReason("curso_fechado")}
            className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${
              reason === "curso_fechado"
                ? "border-emerald-400 bg-emerald-50"
                : "border-neutral-200 hover:border-neutral-300"
            }`}
          >
            <BadgeCheck className={`mt-0.5 h-5 w-5 flex-shrink-0 ${reason === "curso_fechado" ? "text-emerald-600" : "text-neutral-300"}`} />
            <span>
              <span className="block text-sm font-bold text-neutral-900">Fechou curso</span>
              <span className="block text-xs text-neutral-500">O lead comprou — informe o curso e o valor pago.</span>
            </span>
          </button>

          {reason === "curso_fechado" && (
            <div className="space-y-2 rounded-xl bg-neutral-50 p-3">
              <div>
                <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                  Nome do curso *
                </label>
                <input
                  type="text"
                  autoFocus
                  value={courseName}
                  onChange={(event) => setCourseName(event.target.value)}
                  placeholder="Ex.: MPI, Curso de Oratória…"
                  className="w-full rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-sm text-neutral-900 focus:border-cyan-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                  Valor pago (R$)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder="Ex.: 1497,00"
                  className="w-full rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-sm text-neutral-900 focus:border-cyan-400 focus:outline-none"
                />
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setReason("sem_continuidade")}
            className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${
              reason === "sem_continuidade"
                ? "border-rose-400 bg-rose-50"
                : "border-neutral-200 hover:border-neutral-300"
            }`}
          >
            <XCircle className={`mt-0.5 h-5 w-5 flex-shrink-0 ${reason === "sem_continuidade" ? "text-rose-500" : "text-neutral-300"}`} />
            <span>
              <span className="block text-sm font-bold text-neutral-900">Não quis dar continuidade</span>
              <span className="block text-xs text-neutral-500">Dispensado / descartado — fechado sem compra.</span>
            </span>
          </button>
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-100 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${
              reason === "curso_fechado" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"
            }`}
          >
            {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
            Fechar lead
          </button>
        </div>
      </div>
    </div>
  );
}
