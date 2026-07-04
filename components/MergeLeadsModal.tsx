"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InscricaoItem } from "@/types/inscricao";

/* ─── helpers ─── */

const SYSTEM_KEYS = new Set([
  "_final", "_step", "_meta", "_id", "id",
  "dashboard_status", "dashboard_status_at", "dashboard_status_whatsapp",
  "dashboard_notes", "dashboard_stars", "dashboard_search", "dashboard_not_duplicate",
  "dashboard_merged_into", "dashboard_nome_sugestoes", "dashboard_email_sugestoes",
  "clientId", "client_id", "aguarda_distribuicao",
]);

// Training/enrollment fields should NOT be shown as conflicts to resolve —
// all form submissions from both leads are preserved automatically in the CRM
const TRAINING_KEYS = new Set([
  "treinamento", "treinamento_nome", "treinamentoNome",
  "data_treinamento", "data_treinamento_extenso",
  "treinamentoData", "treinamentoInicio", "treinamento_inicio",
  "training_date", "nome_evento",
  "origemFormulario", "origem_formulario",
  "form_name", "formName", "form_id", "formId",
]);

const FIELD_LABELS: Record<string, string> = {
  nome: "Nome", name: "Nome",
  telefone: "Telefone", phone: "Telefone", celular: "Celular", whatsapp: "WhatsApp",
  email: "E-mail",
  cidade: "Cidade", city: "Cidade",
  estado: "Estado",
  profissao: "Profissão", profissao_area: "Área de atuação",
  objetivo: "Objetivo", interesse_workshop: "Interesse no workshop",
  treinamento: "Treinamento", treinamento_nome: "Treinamento",
  data_treinamento: "Data do treinamento",
  unidade_negocio: "Produto", lead_setor: "Setor",
  origem: "Origem", lead_origem: "Origem", campaign_source: "Fonte",
  campaign_name: "Campanha", traffic_source: "Indicador",
  tamanho_camiseta: "Camiseta", cpf: "CPF",
};

function isSystemKey(key: string): boolean {
  if (SYSTEM_KEYS.has(key)) return true;
  if (key.startsWith("_")) return true;
  if (key.startsWith("dashboard_")) return true;
  if (key.startsWith("presenca_")) return true;
  return false;
}

function isTrainingKey(key: string): boolean {
  return TRAINING_KEYS.has(key);
}

function humanLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/_/g, " ").replace(/([A-Z])/g, " $1").trim();
}

function toStr(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function getAllKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !isSystemKey(k));
}

/* ─── types ─── */

interface MergeLeadsModalProps {
  primary: InscricaoItem;
  onMerged: (result: InscricaoItem) => void;
  onClose: () => void;
}

interface SearchResult {
  id: number;
  nome: string | null;
  telefone: string | null;
  treinamento: string | null;
  criadoEm: string;
}

/* ─── component ─── */

export function MergeLeadsModal({ primary, onMerged, onClose }: MergeLeadsModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [secondary, setSecondary] = useState<InscricaoItem | null>(null);
  const [loadingSecondary, setLoadingSecondary] = useState(false);
  // For each field key: "primary" | "secondary"
  const [choices, setChoices] = useState<Record<string, "primary" | "secondary">>({});
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!q.trim()) { setSearchResults([]); return; }
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/inscricoes/search?q=${encodeURIComponent(q)}&limit=8`);
        if (!res.ok) return;
        const data = await res.json() as { results?: SearchResult[] };
        setSearchResults((data.results ?? []).filter((r) => r.id !== primary.id));
      } finally {
        setSearching(false);
      }
    }, 350);
  }, [primary.id]);

  const selectSecondary = useCallback(async (id: number) => {
    setLoadingSecondary(true);
    setSearchResults([]);
    setSearchQuery("");
    try {
      const res = await fetch(`/api/inscricoes/${id}`);
      if (!res.ok) throw new Error("Erro ao carregar lead");
      const data = await res.json() as { inscricao: InscricaoItem };
      setSecondary(data.inscricao);
      // Default: prefer primary for all fields.
      // Exception: origin fields default to the oldest record (first contact).
      const ORIGIN_KEYS = new Set(["origem", "lead_origem", "campaign_source", "source", "traffic_source"]);
      const pPayload = (primary.payload ?? {}) as Record<string, unknown>;
      const sPayload = (data.inscricao.payload ?? {}) as Record<string, unknown>;
      const keys = getAllKeys(pPayload, sPayload);
      const primaryIsOlder =
        new Date(primary.criadoEm).getTime() <= new Date(data.inscricao.criadoEm).getTime();
      const initial: Record<string, "primary" | "secondary"> = {};
      for (const key of keys) {
        const pVal = toStr(pPayload[key]).trim();
        const sVal = toStr(sPayload[key]).trim();
        if (ORIGIN_KEYS.has(key) && pVal && sVal) {
          initial[key] = primaryIsOlder ? "primary" : "secondary";
        } else {
          initial[key] = pVal ? "primary" : "secondary";
        }
      }
      setChoices(initial);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      setLoadingSecondary(false);
    }
  }, [primary]);

  const buildMergedPayload = useCallback((): Record<string, unknown> => {
    if (!secondary) return {};
    const pPayload = (primary.payload ?? {}) as Record<string, unknown>;
    const sPayload = (secondary.payload ?? {}) as Record<string, unknown>;
    const keys = getAllKeys(pPayload, sPayload);
    const merged: Record<string, unknown> = {};

    // Copy all system fields from primary
    for (const key of Object.keys(pPayload)) {
      if (isSystemKey(key)) merged[key] = pPayload[key];
    }
    // Merge user fields by choice
    for (const key of keys) {
      const source = choices[key] === "secondary" ? sPayload : pPayload;
      const value = source[key];
      if (value !== undefined && value !== null && toStr(value).trim()) {
        merged[key] = value;
      }
    }
    return merged;
  }, [primary, secondary, choices]);

  const handleMerge = async () => {
    if (!secondary) return;
    setMerging(true);
    setError(null);
    try {
      const res = await fetch("/api/inscricoes/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primaryId: primary.id,
          secondaryId: secondary.id,
          mergedPayload: buildMergedPayload(),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? "Erro ao mesclar");
      }
      const d = await res.json() as { inscricao: InscricaoItem };
      onMerged(d.inscricao);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      setMerging(false);
    }
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const pPayload = (primary.payload ?? {}) as Record<string, unknown>;
  const sPayload = secondary ? (secondary.payload ?? {}) as Record<string, unknown> : null;
  const allKeys = secondary ? getAllKeys(pPayload, sPayload!) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl">

        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-neutral-100 px-6 py-4">
          <div>
            <p className="text-sm font-bold text-neutral-900">Mesclar leads</p>
            <p className="text-xs text-neutral-400">O lead primário fica no CRM; o secundário é arquivado</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">

          {/* Primary info */}
          <div className="border-b border-neutral-100 bg-cyan-50 px-6 py-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-600">Primário (vai ficar)</p>
            <p className="text-sm font-semibold text-neutral-900">{primary.nome ?? "Sem nome"} <span className="font-normal text-neutral-500">#{primary.id}</span></p>
            {primary.telefone && <p className="text-xs text-neutral-500">{primary.telefone}</p>}
          </div>

          {/* Search secondary */}
          {!secondary && (
            <div className="px-6 py-4">
              <p className="mb-2 text-xs font-semibold text-neutral-700">Buscar lead secundário para mesclar:</p>
              <div className="relative">
                <input
                  type="text"
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Nome, telefone, e-mail…"
                  className="w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 focus:border-cyan-400 focus:outline-none focus:bg-white"
                />
                {searching && (
                  <p className="mt-2 text-xs text-neutral-400">Buscando…</p>
                )}
                {searchResults.length > 0 && (
                  <div className="mt-1 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg">
                    {searchResults.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => selectSecondary(r.id)}
                        className="flex w-full items-start gap-3 border-b border-neutral-100 px-4 py-3 text-left last:border-0 hover:bg-neutral-50"
                      >
                        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-bold text-neutral-600">
                          {(r.nome ?? "?")[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-neutral-900">{r.nome ?? "Sem nome"} <span className="font-normal text-neutral-400">#{r.id}</span></p>
                          <p className="text-[10px] text-neutral-400">{r.telefone ?? "—"}{r.treinamento ? ` · ${r.treinamento}` : ""}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {loadingSecondary && <p className="mt-2 text-xs text-neutral-400">Carregando…</p>}
            </div>
          )}

          {/* Field selector */}
          {secondary && (
            <div className="px-6 py-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold text-neutral-700">Escolha qual valor fica para cada campo:</p>
                <button
                  type="button"
                  onClick={() => setSecondary(null)}
                  className="text-[10px] text-neutral-400 hover:text-neutral-700 underline"
                >
                  Trocar secundário
                </button>
              </div>

              {/* Secondary info */}
              <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">Secundário (vai ser arquivado)</p>
                <p className="text-sm font-semibold text-neutral-900">{secondary.nome ?? "Sem nome"} <span className="font-normal text-neutral-500">#{secondary.id}</span></p>
                {secondary.telefone && <p className="text-xs text-neutral-500">{secondary.telefone}</p>}
              </div>

              <div className="space-y-1.5">
                {/* Column headers */}
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 pb-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Campo</p>
                  <p className="w-28 text-center text-[10px] font-bold uppercase tracking-widest text-cyan-600">Primário</p>
                  <p className="w-28 text-center text-[10px] font-bold uppercase tracking-widest text-amber-600">Secundário</p>
                </div>
                {allKeys.filter((k) => !isTrainingKey(k)).map((key) => {
                  const pVal = toStr(pPayload[key]);
                  const sVal = toStr(sPayload![key]);
                  if (!pVal && !sVal) return null;
                  const choice = choices[key] ?? "primary";
                  return (
                    <div key={key} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{humanLabel(key)}</p>
                        <p className={`truncate text-xs ${choice === "primary" ? "font-semibold text-neutral-900" : "text-neutral-400"}`}>
                          {pVal || <span className="italic text-neutral-300">vazio</span>}
                        </p>
                      </div>
                      {/* Primary radio */}
                      <button
                        type="button"
                        onClick={() => setChoices((c) => ({ ...c, [key]: "primary" }))}
                        className={`flex h-7 w-28 items-center justify-center rounded-lg border text-[10px] font-semibold transition ${
                          choice === "primary"
                            ? "border-cyan-500 bg-cyan-500 text-white"
                            : "border-neutral-200 bg-white text-neutral-400 hover:border-cyan-300"
                        }`}
                      >
                        {pVal ? pVal.slice(0, 14) + (pVal.length > 14 ? "…" : "") : "vazio"}
                      </button>
                      {/* Secondary radio */}
                      <button
                        type="button"
                        onClick={() => setChoices((c) => ({ ...c, [key]: "secondary" }))}
                        className={`flex h-7 w-28 items-center justify-center rounded-lg border text-[10px] font-semibold transition ${
                          choice === "secondary"
                            ? "border-amber-500 bg-amber-500 text-white"
                            : "border-neutral-200 bg-white text-neutral-400 hover:border-amber-300"
                        }`}
                      >
                        {sVal ? sVal.slice(0, 14) + (sVal.length > 14 ? "…" : "") : "vazio"}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Enrollment cards — always preserved automatically */}
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-emerald-700">Inscrições preservadas automaticamente</p>
                <p className="mb-3 text-[11px] text-neutral-500">
                  Todos os formulários e histórico de eventos de ambos os leads continuarão visíveis no CRM.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { lead: primary, role: "Primário", colorClass: "border-cyan-200 bg-cyan-50" },
                    { lead: secondary, role: "Secundário", colorClass: "border-amber-200 bg-amber-50" },
                  ] as { lead: InscricaoItem; role: string; colorClass: string }[]).map(({ lead, role, colorClass }) => {
                    const p = (lead.payload ?? {}) as Record<string, unknown>;
                    const produto = toStr(p.unidade_negocio ?? p.lead_produto ?? p.produto_interesse ?? "").trim() || null;
                    const formNome = toStr(p.formName ?? p.form_name ?? p.origemFormulario ?? p.origem_formulario ?? "").trim() || null;
                    return (
                      <div key={lead.id} className={`rounded-xl border px-3 py-2.5 ${colorClass}`}>
                        <p className={`mb-1 text-[9px] font-bold uppercase tracking-wide ${role === "Primário" ? "text-cyan-600" : "text-amber-600"}`}>
                          {role} · #{lead.id}
                        </p>
                        <p className="text-xs font-semibold text-neutral-800 truncate">{lead.nome ?? "Sem nome"}</p>
                        {(lead.treinamentoNome ?? produto) && (
                          <p className="mt-0.5 text-xs text-neutral-600 truncate">{lead.treinamentoNome ?? produto}</p>
                        )}
                        {lead.treinamentoData && (
                          <p className="text-[11px] text-neutral-400">{lead.treinamentoData}</p>
                        )}
                        {formNome && (
                          <p className="mt-0.5 text-[10px] text-neutral-400 truncate">Formulário: {formNome}</p>
                        )}
                        <p className="mt-1 text-[10px] text-neutral-400">
                          Inscrito em {new Date(lead.criadoEm).toLocaleDateString("pt-BR")}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="px-6 pb-4">
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {secondary && (
          <div className="flex flex-shrink-0 items-center justify-end gap-3 border-t border-neutral-100 px-6 py-4">
            <button type="button" onClick={onClose} disabled={merging} className="rounded-lg border border-neutral-200 px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleMerge}
              disabled={merging}
              className="rounded-lg bg-cyan-600 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-700 disabled:opacity-50"
            >
              {merging ? "Mesclando…" : `Mesclar → manter #${primary.id}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
