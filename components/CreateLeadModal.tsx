"use client";

import { useEffect, useMemo, useState } from "react";
import type { InscricaoItem } from "@/types/inscricao";
import { LEAD_FIELD_CATEGORY_LABELS, addableLeadFields, type LeadFieldCategory } from "@/lib/leadFields";
import { aulaBlockToLeadFields } from "@/lib/aulaBlocks";

export interface CreateLeadSellerOption {
  id: number;
  name: string;
  email: string;
}

/** Contexto fixo quando o modal é aberto a partir de um bloco (formulário) da área VozUP. */
export interface CreateLeadContext {
  produto: "instituto" | "vozup";
  /** Origem gravada no payload — garante que o lead apareça na listagem do bloco. */
  origem: string;
  /** Nome exibido do bloco/formulário. */
  label: string;
  /** Campos extras pré-definidos pelo bloco (ex.: campaign_name da Meta). */
  extraFields?: Record<string, string>;
  /** Permite criar o lead SEM dono (vai pra Chegada de Leads p/ um SDR distribuir). */
  allowUnassigned?: boolean;
}

interface CreateLeadModalProps {
  onCreated: (result: { inscricao: InscricaoItem; merged: boolean }) => void;
  onClose: () => void;
  /** Colaboradores disponíveis — a seleção do responsável é obrigatória. */
  sellers: CreateLeadSellerOption[];
  currentUser?: { email: string; isSupervisor: boolean } | null;
  context?: CreateLeadContext | null;
}

export function CreateLeadModal({ onCreated, onClose, sellers, currentUser, context }: CreateLeadModalProps) {
  // Quem não é supervisor só pode atribuir o lead a si mesmo (mesma regra do repasse no CRM).
  const selectableSellers = useMemo(() => {
    if (currentUser && !currentUser.isSupervisor) {
      const own = sellers.filter(
        (s) => s.email.trim().toLowerCase() === currentUser.email.trim().toLowerCase()
      );
      return own.length > 0 ? own : sellers;
    }
    return sellers;
  }, [sellers, currentUser]);

  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  // Pré-seleciona o próprio usuário — na maioria das vezes quem insere o
  // lead manualmente atribui para si mesmo.
  const [sellerId, setSellerId] = useState<string>(() => {
    // Modo Chegada (sem dono): começa vazio de propósito — o padrão é não atribuir.
    if (context?.allowUnassigned) return "";
    const ownEmail = currentUser?.email.trim().toLowerCase();
    const own = ownEmail
      ? selectableSellers.find((s) => s.email.trim().toLowerCase() === ownEmail)
      : undefined;
    if (own) return String(own.id);
    return selectableSellers.length === 1 ? String(selectableSellers[0].id) : "";
  });
  const [produto, setProduto] = useState<"instituto" | "vozup">(context?.produto ?? "instituto");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cadastro fora de um bloco (ex.: CRM): lead VozUP pode ser atrelado a uma
  // aula existente — as opções vêm do banco (mesmos blocos de VozUP · Leads).
  const [aula, setAula] = useState("");
  const [aulaOptions, setAulaOptions] = useState<{ value: string; count: number }[] | null>(null);
  useEffect(() => {
    if (context || produto !== "vozup" || aulaOptions !== null) return;
    let cancelled = false;
    fetch("/api/vozup/aulas")
      .then((res) => (res.ok ? res.json() : { aulas: [] }))
      .then((data: { aulas?: { value: string; count: number }[] }) => {
        if (!cancelled) setAulaOptions(Array.isArray(data.aulas) ? data.aulas : []);
      })
      .catch(() => {
        if (!cancelled) setAulaOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [context, produto, aulaOptions]);

  const lockedKeys = useMemo(() => {
    const keys = new Set(["nome", "telefone"]);
    if (context) {
      keys.add("origem");
      for (const key of Object.keys(context.extraFields ?? {})) keys.add(key);
    }
    return keys;
  }, [context]);

  const extraFields = useMemo(
    () => addableLeadFields().filter((f) => !lockedKeys.has(f.key)),
    [lockedKeys]
  );
  const categories = useMemo(
    () => Array.from(new Set(extraFields.map((f) => f.category))) as LeadFieldCategory[],
    [extraFields]
  );

  const handleSubmit = async () => {
    const trimmedNome = nome.trim();
    if (!trimmedNome) {
      setError("Informe o nome completo do lead.");
      return;
    }
    const trimmedTelefone = telefone.trim();
    if (!trimmedTelefone) {
      setError("Informe o telefone / WhatsApp do lead.");
      return;
    }
    if (!sellerId && !context?.allowUnassigned) {
      setError("Selecione o colaborador responsável pelo lead.");
      return;
    }

    setSaving(true);
    setError(null);

    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(fieldValues)) {
      const trimmed = value.trim();
      if (trimmed) fields[key] = trimmed;
    }
    if (context) {
      fields.origem = context.origem;
      for (const [key, value] of Object.entries(context.extraFields ?? {})) {
        fields[key] = value;
      }
    } else if (produto === "vozup" && aula) {
      // A aula escolhida define origem + data_treinamento (sobrepõe origem
      // digitada à mão) — é o que faz o lead cair no bloco certo em VozUP · Leads.
      const aulaFields = aulaBlockToLeadFields(aula);
      fields.origem = aulaFields.origem;
      if (aulaFields.data_treinamento) fields.data_treinamento = aulaFields.data_treinamento;
    }

    try {
      const res = await fetch("/api/inscricoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: trimmedNome,
          telefone: trimmedTelefone,
          produto,
          sellerId: sellerId ? Number(sellerId) : null,
          fields,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? "Erro ao criar lead");
      }

      onCreated(data as { inscricao: InscricaoItem; merged: boolean });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-neutral-100 px-6 py-4">
          <div>
            <p className="text-sm font-bold text-neutral-900">Novo lead</p>
            <p className="text-xs text-neutral-400">Mesmo telefone de um lead existente será mesclado automaticamente</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

          {context ? (
            <div className="rounded-lg border border-cyan-100 bg-cyan-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-600">Formulário</p>
              <p className="text-sm font-bold text-cyan-800">{context.label}</p>
            </div>
          ) : (
            <div className="flex gap-2">
              {(["instituto", "vozup"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProduto(p)}
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                    produto === p
                      ? "border-cyan-400 bg-cyan-50 text-cyan-700"
                      : "border-neutral-200 text-neutral-500 hover:bg-neutral-50"
                  }`}
                >
                  {p === "instituto" ? "Instituto UP" : "Voz UP"}
                </button>
              ))}
            </div>
          )}

          {!context && produto === "vozup" && (
            <div>
              <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                Aula (opcional)
              </label>
              <select
                value={aula}
                onChange={(e) => setAula(e.target.value)}
                className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-sm text-neutral-900 focus:border-cyan-400 focus:outline-none focus:bg-white"
              >
                <option value="">
                  {aulaOptions === null ? "Carregando aulas…" : "Sem aula específica"}
                </option>
                {(aulaOptions ?? []).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.value}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-neutral-400">
                Atrela o lead à aula escolhida — ele aparece no bloco dessa aula em VozUP · Leads.
              </p>
            </div>
          )}

          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
              Nome completo *
            </label>
            <input
              type="text"
              autoFocus
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-sm text-neutral-900 focus:border-cyan-400 focus:outline-none focus:bg-white"
            />
          </div>

          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
              Telefone / WhatsApp *
            </label>
            <input
              type="text"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              placeholder="(00) 00000-0000"
              className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-sm text-neutral-900 focus:border-cyan-400 focus:outline-none focus:bg-white"
            />
          </div>

          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
              Colaborador responsável {context?.allowUnassigned ? "(opcional)" : "*"}
            </label>
            <select
              value={sellerId}
              onChange={(e) => setSellerId(e.target.value)}
              className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-sm text-neutral-900 focus:border-cyan-400 focus:outline-none focus:bg-white"
            >
              <option value="">
                {context?.allowUnassigned ? "Sem dono — SDR distribui depois" : "Selecione o colaborador…"}
              </option>
              {selectableSellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {context?.allowUnassigned && (
              <p className="mt-1 text-[10px] text-neutral-400">
                Deixe &quot;Sem dono&quot; para o lead entrar na Chegada de Leads e um SDR distribuir depois.
              </p>
            )}
            {!context?.allowUnassigned && selectableSellers.length === 0 && (
              <p className="mt-1 text-[10px] text-rose-500">
                Nenhum colaborador ativo encontrado — cadastre a equipe em Equipe.
              </p>
            )}
          </div>

          {categories.map((category) => (
            <div key={category}>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-neutral-400">
                {LEAD_FIELD_CATEGORY_LABELS[category]}
              </p>
              <div className="space-y-2">
                {extraFields.filter((f) => f.category === category).map((f) => (
                  <div key={f.key}>
                    <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                      {f.label}
                    </label>
                    <input
                      type="text"
                      value={fieldValues[f.key] ?? ""}
                      onChange={(e) => setFieldValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-900 focus:border-cyan-400 focus:outline-none focus:bg-white"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 justify-end gap-2 border-t border-neutral-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="rounded-lg bg-cyan-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700 disabled:opacity-50"
          >
            {saving ? "Criando…" : "Criar lead"}
          </button>
        </div>
      </div>
    </div>
  );
}
