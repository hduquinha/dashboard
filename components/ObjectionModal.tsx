"use client";

import { useState } from "react";
import { MessageCircleWarning, RefreshCw, X } from "lucide-react";

export interface ObjectionTarget {
  id: number;
  nome: string | null;
  /** Quantas vezes este lead já entrou no repique, contando a de agora. */
  repiqueCount?: number;
  /** O que ele alegou da última vez — some do card, mas aqui é o contexto que importa. */
  lastObjection?: string | null;
}

interface ObjectionModalProps {
  lead: ObjectionTarget;
  /**
   * Coluna de "Em espera" do funil (quadro `espera`), quando ela existe.
   * Presente, o vendedor escolhe aqui mesmo se o lead fica no Desinteresse
   * para o repique ou sai do quadro — que é a decisão que ele acabou de tomar
   * na cabeça ao ouvir o "não".
   */
  holdStage?: { key: string; label: string } | null;
  /** `hold` = mandar para a coluna de espera depois de salvar. */
  onSaved: (leadId: number, objection: string, hold: boolean) => void;
  /** Fechar sem registrar: a etiqueta de repique já foi contada de qualquer jeito. */
  onSkip: (hold: boolean) => void;
}

/**
 * Pedido de objeção quando o vendedor manda o lead para o repique (coluna
 * Desinteresse). A lista pronta existe para o motivo virar dado comparável
 * entre vendedores; o campo aberto existe porque nenhuma lista cobre tudo.
 */
const COMMON_OBJECTIONS = [
  "Preço / sem condições agora",
  "Vai pensar / adiar decisão",
  "Sem tempo / agenda",
  "Distância / localização",
  "Precisa falar com cônjuge/família",
  "Já estuda em outro lugar",
  "Não era o perfil / não quer aula",
  "Sumiu / não responde mais",
];

export function ObjectionModal({ lead, holdStage, onSaved, onSkip }: ObjectionModalProps) {
  const [reasons, setReasons] = useState<Set<string>>(() => new Set());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Destino do card. Padrão é continuar no repique — tirar do quadro é a
   *  decisão excepcional e tem que ser marcada. */
  const [hold, setHold] = useState(false);

  const repique = lead.repiqueCount ?? 1;

  function toggle(reason: string) {
    setReasons((current) => {
      const next = new Set(current);
      if (next.has(reason)) next.delete(reason);
      else next.add(reason);
      return next;
    });
  }

  async function submit() {
    if (reasons.size === 0 && !note.trim()) {
      setError("Marque ao menos um motivo ou escreva o que ele alegou.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/commercial/leads/${lead.id}/objection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reasons: [...reasons], note: note.trim() }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; objection?: string };
      if (!response.ok) throw new Error(data.error ?? "Falha ao registrar a objeção.");
      onSaved(lead.id, data.objection ?? "", hold);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao registrar a objeção.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-neutral-100 px-6 py-4">
          <div className="flex items-start gap-2.5">
            <MessageCircleWarning className="mt-0.5 h-5 w-5 flex-shrink-0 text-rose-500" />
            <div>
              <p className="text-sm font-bold text-neutral-900">Por que ele não seguiu?</p>
              <p className="text-xs text-neutral-400">
                {lead.nome ?? `Lead #${lead.id}`} foi para o repique
                {repique > 1 ? ` pela ${repique}ª vez` : ""}.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSkip(false)}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-6 py-4">
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

          {repique > 1 && lead.lastObjection && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              <span className="font-bold">Da última vez:</span> {lead.lastObjection}
            </p>
          )}

          <div className="flex flex-wrap gap-1.5">
            {COMMON_OBJECTIONS.map((reason) => {
              const active = reasons.has(reason);
              return (
                <button
                  key={reason}
                  type="button"
                  onClick={() => toggle(reason)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                    active
                      ? "border-rose-400 bg-rose-50 text-rose-700"
                      : "border-neutral-200 text-neutral-600 hover:border-neutral-300"
                  }`}
                >
                  {reason}
                </button>
              );
            })}
          </div>

          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
              Nas palavras dele (opcional)
            </label>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={400}
              placeholder="Ex.: disse que só consegue depois das férias, pediu pra chamar em janeiro."
              className="w-full resize-none rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm text-neutral-900 focus:border-cyan-400 focus:outline-none"
            />
          </div>

          {holdStage && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                E o card, fica onde?
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setHold(false)}
                  className={`rounded-lg border px-2.5 py-2 text-left transition ${
                    hold
                      ? "border-neutral-200 hover:border-neutral-300"
                      : "border-rose-400 bg-rose-50"
                  }`}
                >
                  <span className="block text-[11px] font-bold text-neutral-800">No Desinteresse</span>
                  <span className="block text-[10px] leading-tight text-neutral-500">
                    continua no quadro para o repique
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setHold(true)}
                  className={`rounded-lg border px-2.5 py-2 text-left transition ${
                    hold
                      ? "border-amber-400 bg-amber-50"
                      : "border-neutral-200 hover:border-neutral-300"
                  }`}
                >
                  <span className="block text-[11px] font-bold text-neutral-800">{holdStage.label}</span>
                  <span className="block text-[10px] leading-tight text-neutral-500">
                    sai do quadro, sem contar repique novo
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-neutral-100 px-6 py-4">
          <button
            type="button"
            onClick={() => onSkip(hold)}
            disabled={saving}
            className="text-xs font-semibold text-neutral-400 hover:text-neutral-600"
          >
            {hold ? "Sem registrar o motivo" : "Agora não"}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${
              hold ? "bg-amber-600 hover:bg-amber-700" : "bg-rose-600 hover:bg-rose-700"
            }`}
          >
            {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
            {hold ? "Registrar e deixar em espera" : "Registrar objeção"}
          </button>
        </div>
      </div>
    </div>
  );
}
