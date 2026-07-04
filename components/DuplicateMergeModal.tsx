"use client";

import { useCallback, useEffect, useState } from "react";
import type { InscricaoItem } from "@/types/inscricao";

/* ─── helpers (same as MergeLeadsModal) ─── */

const SYSTEM_KEYS = new Set([
  "_final", "_step", "_meta", "_id", "id",
  "dashboard_status", "dashboard_status_at", "dashboard_status_whatsapp",
  "dashboard_notes", "dashboard_stars", "dashboard_search", "dashboard_not_duplicate",
  "dashboard_merged_into", "dashboard_nome_sugestoes", "dashboard_email_sugestoes",
  "clientId", "client_id", "aguarda_distribuicao",
]);

// Training/enrollment fields should NOT be shown as conflicts —
// all form submissions from both leads are preserved automatically in the CRM
// because fetchEnrollmentsByPersonKeys does not filter by dashboard_merged_into
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

interface DuplicateMergeModalProps {
  primary: InscricaoItem;
  secondary: InscricaoItem;
  onMerged: (result: InscricaoItem) => void;
  onClose: () => void;
}

/* ─── component ─── */

export function DuplicateMergeModal({ primary, secondary, onMerged, onClose }: DuplicateMergeModalProps) {
  const pPayload = (primary.payload ?? {}) as Record<string, unknown>;
  const sPayload = (secondary.payload ?? {}) as Record<string, unknown>;
  const allKeys = getAllKeys(pPayload, sPayload);

  // Origin fields: prefer the OLDEST record (first contact), not the primary
  const ORIGIN_KEYS = new Set(["origem", "lead_origem", "campaign_source", "source", "traffic_source"]);

  const primaryIsOlder =
    new Date(primary.criadoEm).getTime() <= new Date(secondary.criadoEm).getTime();

  // Default: prefer primary for non-empty fields; fall back to secondary.
  // Exception: origin fields default to whichever record is oldest.
  const [choices, setChoices] = useState<Record<string, "primary" | "secondary">>(() => {
    const initial: Record<string, "primary" | "secondary"> = {};
    for (const key of allKeys) {
      const pVal = toStr(pPayload[key]).trim();
      const sVal = toStr(sPayload[key]).trim();
      if (ORIGIN_KEYS.has(key) && pVal && sVal) {
        initial[key] = primaryIsOlder ? "primary" : "secondary";
      } else {
        initial[key] = pVal ? "primary" : "secondary";
      }
    }
    return initial;
  });
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const buildMergedPayload = useCallback((): Record<string, unknown> => {
    const merged: Record<string, unknown> = {};
    // Copy all system fields from primary
    for (const key of Object.keys(pPayload)) {
      if (isSystemKey(key)) merged[key] = pPayload[key];
    }
    // Merge user fields by choice
    for (const key of allKeys) {
      const source = choices[key] === "secondary" ? sPayload : pPayload;
      const value = source[key];
      if (value !== undefined && value !== null && toStr(value).trim()) {
        merged[key] = value;
      }
    }
    return merged;
  }, [pPayload, sPayload, allKeys, choices]);

  const handleMerge = async () => {
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

  // Fields where both leads have different non-empty values — highlight in UI
  // Training/enrollment fields are excluded: they're preserved automatically
  const conflictKeys = allKeys.filter((key) => {
    if (isTrainingKey(key)) return false;
    const pVal = toStr(pPayload[key]).trim();
    const sVal = toStr(sPayload[key]).trim();
    return pVal && sVal && pVal !== sVal;
  });

  const onlyInPrimary = allKeys.filter((key) => {
    if (isTrainingKey(key)) return false;
    const pVal = toStr(pPayload[key]).trim();
    const sVal = toStr(sPayload[key]).trim();
    return pVal && !sVal;
  });

  const onlyInSecondary = allKeys.filter((key) => {
    if (isTrainingKey(key)) return false;
    const pVal = toStr(pPayload[key]).trim();
    const sVal = toStr(sPayload[key]).trim();
    return !pVal && sVal;
  });

  // Build enrollment cards from each lead's direct fields
  interface EnrollmentCard {
    leadId: number;
    leadNome: string | null;
    role: "Primário" | "Secundário";
    treinamentoNome: string | null;
    treinamentoData: string | null;
    produto: string | null;
    criadoEm: string;
    formNome: string | null;
  }

  const buildEnrollmentCard = (lead: InscricaoItem, role: "Primário" | "Secundário"): EnrollmentCard => {
    const p = lead.payload as Record<string, unknown>;
    const formNome = toStr(p.formName ?? p.form_name ?? p.origemFormulario ?? p.origem_formulario ?? "").trim() || null;
    const produto = toStr(p.unidade_negocio ?? p.lead_produto ?? p.produto_interesse ?? "").trim() || null;
    return {
      leadId: lead.id,
      leadNome: lead.nome,
      role,
      treinamentoNome: lead.treinamentoNome,
      treinamentoData: lead.treinamentoData,
      produto,
      criadoEm: lead.criadoEm,
      formNome,
    };
  };

  const enrollmentCards: EnrollmentCard[] = [
    buildEnrollmentCard(primary, "Primário"),
    buildEnrollmentCard(secondary, "Secundário"),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl">

        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-neutral-100 px-6 py-4">
          <div>
            <p className="text-sm font-bold text-neutral-900">Unificar leads duplicados</p>
            <p className="text-xs text-neutral-400">
              {conflictKeys.length > 0
                ? `${conflictKeys.length} campo(s) com valores diferentes — escolha qual manter`
                : "Dados pessoais idênticos — inscrições preservadas automaticamente"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Leads header row */}
        <div className="flex flex-shrink-0 border-b border-neutral-100">
          <div className="flex-1 border-r border-neutral-100 bg-cyan-50 px-5 py-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-600">Primário (vai ficar)</p>
            <p className="text-sm font-semibold text-neutral-900">{primary.nome ?? "Sem nome"} <span className="font-normal text-neutral-400">#{primary.id}</span></p>
            <p className="text-xs text-neutral-500">{primary.telefone ?? "—"}</p>
            <p className="text-xs text-neutral-400">{primary.criadoEm ? new Date(primary.criadoEm).toLocaleDateString("pt-BR") : "—"}</p>
          </div>
          <div className="flex-1 bg-amber-50 px-5 py-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">Secundário (vai ser arquivado)</p>
            <p className="text-sm font-semibold text-neutral-900">{secondary.nome ?? "Sem nome"} <span className="font-normal text-neutral-400">#{secondary.id}</span></p>
            <p className="text-xs text-neutral-500">{secondary.telefone ?? "—"}</p>
            <p className="text-xs text-neutral-400">{secondary.criadoEm ? new Date(secondary.criadoEm).toLocaleDateString("pt-BR") : "—"}</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">

          {/* Campos conflitantes — precisam de escolha */}
          {conflictKeys.length > 0 && (
            <div className="mb-5">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-rose-600">Campos com valores diferentes</p>
              <div className="space-y-2">
                {conflictKeys.map((key) => {
                  const pVal = toStr(pPayload[key]);
                  const sVal = toStr(sPayload[key]);
                  const choice = choices[key] ?? "primary";
                  return (
                    <div key={key} className="overflow-hidden rounded-xl border border-rose-100 bg-rose-50/30">
                      <p className="border-b border-rose-100 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-rose-700">{humanLabel(key)}</p>
                      <div className="grid grid-cols-2 divide-x divide-rose-100">
                        <button
                          type="button"
                          onClick={() => setChoices((c) => ({ ...c, [key]: "primary" }))}
                          className={`p-3 text-left text-xs transition ${choice === "primary" ? "bg-cyan-100 font-semibold text-cyan-900 ring-1 ring-inset ring-cyan-400" : "text-neutral-600 hover:bg-neutral-50"}`}
                        >
                          <span className={`mb-1 block text-[9px] font-bold uppercase tracking-wide ${choice === "primary" ? "text-cyan-600" : "text-neutral-400"}`}>
                            {choice === "primary" ? "✓ Manter (primário)" : "Primário"}
                          </span>
                          {pVal}
                        </button>
                        <button
                          type="button"
                          onClick={() => setChoices((c) => ({ ...c, [key]: "secondary" }))}
                          className={`p-3 text-left text-xs transition ${choice === "secondary" ? "bg-amber-100 font-semibold text-amber-900 ring-1 ring-inset ring-amber-400" : "text-neutral-600 hover:bg-neutral-50"}`}
                        >
                          <span className={`mb-1 block text-[9px] font-bold uppercase tracking-wide ${choice === "secondary" ? "text-amber-600" : "text-neutral-400"}`}>
                            {choice === "secondary" ? "✓ Manter (secundário)" : "Secundário"}
                          </span>
                          {sVal}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Campos que só existem em um lado — serão preservados automaticamente */}
          {(onlyInPrimary.length > 0 || onlyInSecondary.length > 0) && (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-neutral-400">Campos únicos — preservados automaticamente</p>
              <div className="grid grid-cols-2 gap-2">
                {onlyInPrimary.map((key) => (
                  <div key={key} className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-neutral-400">{humanLabel(key)} · primário</p>
                    <p className="truncate text-xs text-neutral-700">{toStr(pPayload[key])}</p>
                  </div>
                ))}
                {onlyInSecondary.map((key) => (
                  <div key={key} className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-neutral-400">{humanLabel(key)} · secundário</p>
                    <p className="truncate text-xs text-neutral-700">{toStr(sPayload[key])}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Histórico de inscrições — sempre exibido, preservado automaticamente */}
          <div className="mt-4">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-emerald-700">Inscrições preservadas automaticamente</p>
            <p className="mb-3 text-[11px] text-neutral-500">
              Todos os formulários preenchidos e histórico de eventos de ambos os leads continuarão visíveis no CRM após a unificação.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {enrollmentCards.map((card) => (
                <div
                  key={card.leadId}
                  className={`rounded-xl border px-4 py-3 ${card.role === "Primário" ? "border-cyan-200 bg-cyan-50/60" : "border-amber-200 bg-amber-50/60"}`}
                >
                  <p className={`mb-1 text-[9px] font-bold uppercase tracking-wide ${card.role === "Primário" ? "text-cyan-600" : "text-amber-600"}`}>
                    {card.role} · #{card.leadId}
                  </p>
                  <p className="text-xs font-semibold text-neutral-800 truncate">{card.leadNome ?? "Sem nome"}</p>
                  {(card.treinamentoNome ?? card.produto) && (
                    <p className="mt-1 text-xs text-neutral-600 truncate">
                      {card.treinamentoNome ?? card.produto}
                    </p>
                  )}
                  {card.treinamentoData && (
                    <p className="text-[11px] text-neutral-400">{card.treinamentoData}</p>
                  )}
                  {card.formNome && (
                    <p className="mt-0.5 text-[10px] text-neutral-400 truncate">Formulário: {card.formNome}</p>
                  )}
                  <p className="mt-1 text-[10px] text-neutral-400">
                    Inscrito em {new Date(card.criadoEm).toLocaleDateString("pt-BR")}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {conflictKeys.length === 0 && onlyInPrimary.length === 0 && onlyInSecondary.length === 0 && (
            <p className="py-4 text-center text-sm text-neutral-400">Os dados pessoais dos dois leads são iguais — a unificação vai arquivar o secundário sem alterações.</p>
          )}

          {error && (
            <div className="mt-4 rounded-lg bg-rose-50 px-3 py-2">
              <p className="text-xs text-rose-700">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-t border-neutral-100 px-6 py-4">
          <p className="text-xs text-neutral-400">
            Lead <strong>#{secondary.id}</strong> será arquivado. <strong>#{primary.id}</strong> fica visível no CRM.
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={merging} className="rounded-lg border border-neutral-200 px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleMerge}
              disabled={merging}
              className="rounded-lg bg-cyan-600 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-700 disabled:opacity-50"
            >
              {merging ? "Unificando…" : `Unificar → manter #${primary.id}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
