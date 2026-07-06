"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Seção "Vínculos" da ficha do lead: lista os atributos (aulas, treinamentos,
 * landing pages, campanhas) do cadastro único e permite adicionar, trocar ou
 * remover cada vínculo — sem nunca criar outro cadastro da mesma pessoa.
 */

interface Vinculo {
  eventId: number;
  isPrimary: boolean;
  pasta: string;
  pastaLabel: string;
  pastaEmoji: string;
  bloco: string;
  criadoEm: string;
  manual: boolean;
}

interface PastaOptions {
  pasta: string;
  label: string;
  emoji: string;
  blocks: { value: string; label: string; count?: number }[];
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function VinculoPicker({
  options,
  busy,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  options: PastaOptions[] | null;
  busy: boolean;
  confirmLabel: string;
  onConfirm: (pasta: string, bloco: string) => void;
  onCancel: () => void;
}) {
  const [pasta, setPasta] = useState("");
  const [bloco, setBloco] = useState("");
  const activePasta = options?.find((p) => p.pasta === pasta) ?? null;

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-cyan-100 bg-cyan-50/60 p-3">
      <select
        value={pasta}
        onChange={(e) => {
          setPasta(e.target.value);
          setBloco("");
        }}
        className="w-full rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-900 focus:border-cyan-400 focus:outline-none"
      >
        <option value="">{options === null ? "Carregando pastas…" : "Escolha a pasta…"}</option>
        {(options ?? []).map((p) => (
          <option key={p.pasta} value={p.pasta}>
            {p.emoji} {p.label}
          </option>
        ))}
      </select>
      {activePasta && (
        <select
          value={bloco}
          onChange={(e) => setBloco(e.target.value)}
          className="w-full rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-900 focus:border-cyan-400 focus:outline-none"
        >
          <option value="">Escolha {activePasta.pasta === "instituto" ? "o treinamento" : "o formulário/aula"}…</option>
          {activePasta.blocks.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
              {typeof b.count === "number" ? ` (${b.count})` : ""}
            </option>
          ))}
        </select>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg border border-neutral-200 bg-white px-3 py-1 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={busy || !pasta || !bloco}
          onClick={() => onConfirm(pasta, bloco)}
          className="rounded-lg bg-cyan-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-cyan-700 disabled:opacity-50"
        >
          {busy ? "Salvando…" : confirmLabel}
        </button>
      </div>
    </div>
  );
}

export function LeadVinculosSection({
  leadId,
  onChanged,
}: {
  leadId: number;
  /** Chamado após qualquer mutação, para a ficha/listagens recarregarem. */
  onChanged?: () => void;
}) {
  const [vinculos, setVinculos] = useState<Vinculo[] | null>(null);
  const [options, setOptions] = useState<PastaOptions[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [replacingId, setReplacingId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/inscricoes/${leadId}/vinculos`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Erro ao carregar vínculos"))))
      .then((data: { vinculos?: Vinculo[] }) => {
        if (!cancelled) setVinculos(Array.isArray(data.vinculos) ? data.vinculos : []);
      })
      .catch(() => {
        if (!cancelled) {
          setVinculos([]);
          setError("Não foi possível carregar os vínculos.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  const ensureOptions = useCallback(() => {
    if (options !== null) return;
    fetch("/api/vinculos/opcoes")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("erro"))))
      .then((data: { pastas?: PastaOptions[] }) => {
        setOptions(Array.isArray(data.pastas) ? data.pastas : []);
      })
      .catch(() => setOptions([]));
  }, [options]);

  const mutate = useCallback(
    async (input: { method: "POST" | "PATCH" | "DELETE"; url: string; body?: unknown }) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(input.url, {
          method: input.method,
          headers: input.body !== undefined ? { "Content-Type": "application/json" } : undefined,
          body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
        });
        const data = (await res.json().catch(() => ({}))) as { vinculos?: Vinculo[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Erro ao salvar vínculo");
        setVinculos(Array.isArray(data.vinculos) ? data.vinculos : []);
        setAdding(false);
        setReplacingId(null);
        onChanged?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro desconhecido");
      } finally {
        setBusy(false);
      }
    },
    [onChanged]
  );

  const handleRemove = (vinculo: Vinculo) => {
    if ((vinculos?.length ?? 0) <= 1) {
      setError("Não é possível excluir o único vínculo do lead. Apague o lead da pipeline.");
      return;
    }
    const alvo = `${vinculo.bloco} (${vinculo.pastaLabel})`;
    if (!window.confirm(`Remover o vínculo "${alvo}" deste lead? O cadastro do lead permanece.`)) return;
    void mutate({ method: "DELETE", url: `/api/inscricoes/${leadId}/vinculos/${vinculo.eventId}` });
  };

  return (
    <div>
      {error && (
        <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">{error}</p>
      )}

      {vinculos === null ? (
        <p className="text-xs text-neutral-400">Carregando vínculos…</p>
      ) : vinculos.length === 0 ? (
        <p className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-400 ring-1 ring-neutral-100">
          Nenhum vínculo ativo — adicione abaixo.
        </p>
      ) : (
        <div className="space-y-2">
          {vinculos.map((v) => (
            <div key={v.eventId} className="rounded-xl border border-neutral-100 bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-neutral-800">
                    <span className="mr-1">{v.pastaEmoji}</span>
                    {v.bloco}
                  </p>
                  <p className="text-[10px] font-medium text-neutral-400">
                    {v.pastaLabel} · {formatDate(v.criadoEm)}
                    {v.manual ? " · adicionado manualmente" : ""}
                  </p>
                </div>
                <div className="flex flex-shrink-0 gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      ensureOptions();
                      setAdding(false);
                      setReplacingId((prev) => (prev === v.eventId ? null : v.eventId));
                    }}
                    className="rounded-lg border border-neutral-200 px-2 py-1 text-[10px] font-semibold text-neutral-600 hover:bg-neutral-50"
                  >
                    Trocar
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleRemove(v)}
                    className="rounded-lg border border-rose-200 px-2 py-1 text-[10px] font-semibold text-rose-600 hover:bg-rose-50"
                  >
                    Remover
                  </button>
                </div>
              </div>
              {replacingId === v.eventId && (
                <VinculoPicker
                  options={options}
                  busy={busy}
                  confirmLabel="Trocar vínculo"
                  onCancel={() => setReplacingId(null)}
                  onConfirm={(pasta, bloco) =>
                    void mutate({
                      method: "PATCH",
                      url: `/api/inscricoes/${leadId}/vinculos/${v.eventId}`,
                      body: { pasta, bloco },
                    })
                  }
                />
              )}
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <VinculoPicker
          options={options}
          busy={busy}
          confirmLabel="Adicionar vínculo"
          onCancel={() => setAdding(false)}
          onConfirm={(pasta, bloco) =>
            void mutate({
              method: "POST",
              url: `/api/inscricoes/${leadId}/vinculos`,
              body: { pasta, bloco },
            })
          }
        />
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            ensureOptions();
            setReplacingId(null);
            setAdding(true);
          }}
          className="mt-2 w-full rounded-xl border border-dashed border-cyan-300 bg-cyan-50/40 px-3 py-2 text-xs font-semibold text-cyan-700 hover:bg-cyan-50"
        >
          + Adicionar vínculo (aula, treinamento, origem…)
        </button>
      )}
    </div>
  );
}
