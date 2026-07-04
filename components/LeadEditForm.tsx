"use client";

import { useId, useState } from "react";
import type { InscricaoItem } from "@/types/inscricao";
import type { TrainingOption } from "@/types/training";
import { addableLeadFields, leadFieldLabel } from "@/lib/leadFields";

const SYSTEM_KEYS = new Set([
  "_final", "_step", "_meta", "_id",
  "dashboard_status", "dashboard_status_at", "dashboard_status_whatsapp",
  "dashboard_notes", "dashboard_stars", "dashboard_search", "dashboard_not_duplicate",
  "dashboard_merged_into",
  "dashboard_nome_sugestoes", "dashboard_email_sugestoes",
  "presenca_validada", "presenca_aprovada", "presenca_participante_nome",
  "presenca_tempo_total_minutos", "presenca_tempo_dinamica_minutos",
  "presenca_percentual_dinamica", "presenca_validada_em", "presenca_total_dias",
  "presenca_dia_processado", "presenca_dinamica_dias",
  "presenca_dia1_aprovado", "presenca_dia1_participante_nome",
  "presenca_dia2_aprovado", "presenca_dia2_participante_nome",
  "clientId", "client_id", "id",
  "aguarda_distribuicao",
  // Campos nomeados ja cobertos pelo formulario de cima — nao repetir no editor dinamico.
  "nome", "name", "telefone", "cidade", "treinamento", "indicacao",
  "profissao", "empresa", "data_nascimento", "bairro",
  "email", "e_mail", "estado", "state", "cargo", "job_title", "position",
]);

function firstPayloadString(payload: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function isSystemKey(key: string): boolean {
  if (SYSTEM_KEYS.has(key)) return true;
  if (key.startsWith("_")) return true;
  if (key.startsWith("dashboard_")) return true;
  if (key.startsWith("presenca_dia")) return true;
  return false;
}

function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function formatTrainingDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

interface RecruiterOption {
  code: string;
  name: string;
}

interface LeadEditFormProps {
  inscricao: InscricaoItem;
  trainingOptions: TrainingOption[];
  recruiterOptions: RecruiterOption[];
  onSaved: (updated: InscricaoItem) => void;
  onCancel: () => void;
}

const inputClass =
  "w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-cyan-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-cyan-100";

/**
 * Reconcilia os dois editores que existiam antes (o formulario com campos
 * nomeados de InscricaoDetails e o editor dinamico de payload de
 * EditLeadPanel) num unico formulario, enviado numa unica requisicao —
 * a rota PATCH /api/inscricoes/:id ja aceita os campos nomeados e
 * payloadUpdates ao mesmo tempo.
 */
export function LeadEditForm({
  inscricao,
  trainingOptions,
  recruiterOptions,
  onSaved,
  onCancel,
}: LeadEditFormProps) {
  const recruiterFieldId = useId();
  const recruiterDatalistId = `${recruiterFieldId}-recruiters`;
  const payload = (inscricao.payload ?? {}) as Record<string, unknown>;

  const [nome, setNome] = useState(inscricao.nome ?? "");
  const [telefone, setTelefone] = useState(inscricao.telefone ?? "");
  const [cidade, setCidade] = useState(inscricao.cidade ?? "");
  const [treinamento, setTreinamento] = useState(inscricao.treinamentoId ?? "");
  const [indicacao, setIndicacao] = useState(inscricao.recrutadorCodigo ?? "");
  const [profissao, setProfissao] = useState(inscricao.profissao ?? "");
  const [empresa, setEmpresa] = useState(() => firstPayloadString(payload, "empresa", "company"));
  const [bairro, setBairro] = useState(() => firstPayloadString(payload, "bairro", "neighborhood"));
  const [dataNascimento, setDataNascimento] = useState(() =>
    firstPayloadString(payload, "data_nascimento", "dataNascimento", "birth_date")
  );
  const [email, setEmail] = useState(inscricao.parsedPayload.email ?? "");
  const [estado, setEstado] = useState(inscricao.parsedPayload.estado ?? "");
  const [cargo, setCargo] = useState(inscricao.parsedPayload.cargo ?? "");

  const originalFields = Object.entries(payload)
    .filter(([key]) => !isSystemKey(key))
    .map(([key, value]) => ({ key, label: leadFieldLabel(key), value: toDisplayString(value) }));

  const [extraKeys, setExtraKeys] = useState<string[]>([]);
  const [fieldToAdd, setFieldToAdd] = useState("");

  const editableFields = [
    ...originalFields,
    ...extraKeys
      .filter((key) => !originalFields.some((f) => f.key === key))
      .map((key) => ({ key, label: leadFieldLabel(key), value: "" })),
  ];

  const availableToAdd = addableLeadFields().filter(
    (f) => !editableFields.some((field) => field.key === f.key) && !isSystemKey(f.key)
  );

  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(originalFields.map(({ key, value }) => [key, value]))
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasTrainingOption = treinamento ? trainingOptions.some((t) => t.id === treinamento) : false;
  const fallbackTrainingOptionLabel = !hasTrainingOption && treinamento
    ? formatTrainingDate(inscricao.treinamentoData ?? treinamento) ?? treinamento
    : null;

  function handleAddField() {
    if (!fieldToAdd) return;
    setExtraKeys((prev) => [...prev, fieldToAdd]);
    setFieldValues((prev) => ({ ...prev, [fieldToAdd]: prev[fieldToAdd] ?? "" }));
    setFieldToAdd("");
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    const payloadUpdates: Record<string, string | null> = {};
    for (const { key, value: originalValue } of editableFields) {
      const current = fieldValues[key] ?? "";
      const trimmed = current.trim();
      if (trimmed !== originalValue.trim()) {
        payloadUpdates[key] = trimmed.length > 0 ? trimmed : null;
      }
    }

    payloadUpdates.empresa = empresa.trim() || null;
    payloadUpdates.bairro = bairro.trim() || null;
    payloadUpdates.data_nascimento = dataNascimento.trim() || null;
    payloadUpdates.email = email.trim() || null;
    payloadUpdates.estado = estado.trim() || null;
    payloadUpdates.cargo = cargo.trim() || null;

    const body: Record<string, unknown> = {
      nome,
      telefone,
      cidade,
      treinamento,
      indicacao,
      profissao,
      payloadUpdates,
    };

    try {
      const res = await fetch(`/api/inscricoes/${inscricao.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Erro ao salvar");
      }

      const data = (await res.json()) as { inscricao: InscricaoItem };
      onSaved(data.inscricao);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 px-5 py-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Editar lead</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Nome completo</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} disabled={saving} placeholder="Nome" className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Telefone</span>
          <input value={telefone} onChange={(e) => setTelefone(e.target.value)} disabled={saving} placeholder="DDD + número" className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">E-mail</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={saving} placeholder="E-mail" className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Cidade</span>
          <input value={cidade} onChange={(e) => setCidade(e.target.value)} disabled={saving} placeholder="Cidade" className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Estado</span>
          <input value={estado} onChange={(e) => setEstado(e.target.value)} disabled={saving} placeholder="UF" className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Treinamento</span>
          <select value={treinamento} onChange={(e) => setTreinamento(e.target.value)} disabled={saving} className={inputClass}>
            <option value="">Nenhum</option>
            {fallbackTrainingOptionLabel && <option value={treinamento}>{fallbackTrainingOptionLabel}</option>}
            {trainingOptions.map((o) => {
              const d = formatTrainingDate(o.startsAt);
              return <option key={o.id} value={o.id}>{d ?? o.label ?? o.id}</option>;
            })}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Bairro</span>
          <input value={bairro} onChange={(e) => setBairro(e.target.value)} disabled={saving} placeholder="Bairro" className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Data de nascimento</span>
          <input value={dataNascimento} onChange={(e) => setDataNascimento(e.target.value)} disabled={saving} placeholder="DD/MM/AAAA" className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Profissão</span>
          <input value={profissao} onChange={(e) => setProfissao(e.target.value)} disabled={saving} placeholder="Profissão" className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Cargo</span>
          <input value={cargo} onChange={(e) => setCargo(e.target.value)} disabled={saving} placeholder="Cargo" className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Empresa</span>
          <input value={empresa} onChange={(e) => setEmpresa(e.target.value)} disabled={saving} placeholder="Empresa" className={inputClass} />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Indicador</span>
        <input
          value={indicacao}
          onChange={(e) => setIndicacao(e.target.value)}
          disabled={saving}
          placeholder="Código do indicador"
          className={inputClass}
          list={recruiterDatalistId}
        />
        <datalist id={recruiterDatalistId}>
          {recruiterOptions.map((r) => (
            <option key={r.code} value={r.code} label={`${r.name} (${r.code})`} />
          ))}
        </datalist>
        <p className="text-[10px] text-neutral-400">Deixe em branco para remover</p>
      </div>

      <div className="space-y-2 border-t border-neutral-100 pt-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Outros campos</p>
        {editableFields.map(({ key, label }) => (
          <div key={key} className="group">
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{label}</label>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={fieldValues[key] ?? ""}
                onChange={(e) => setFieldValues((prev) => ({ ...prev, [key]: e.target.value }))}
                disabled={saving}
                className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-900 focus:border-cyan-400 focus:outline-none focus:bg-white"
                placeholder="(vazio — será removido ao salvar)"
              />
              {(fieldValues[key] ?? "").length > 0 && (
                <button
                  type="button"
                  title="Apagar campo"
                  disabled={saving}
                  onClick={() => setFieldValues((prev) => ({ ...prev, [key]: "" }))}
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-neutral-300 hover:bg-rose-50 hover:text-rose-500"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {availableToAdd.length > 0 && (
        <div className="flex items-center gap-2 border-t border-neutral-100 pt-3">
          <select
            value={fieldToAdd}
            onChange={(e) => setFieldToAdd(e.target.value)}
            disabled={saving}
            className="flex-1 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-700 focus:border-cyan-400 focus:outline-none"
          >
            <option value="">+ Adicionar campo…</option>
            {availableToAdd.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleAddField}
            disabled={!fieldToAdd || saving}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
          >
            Adicionar
          </button>
        </div>
      )}
    </div>
  );
}
