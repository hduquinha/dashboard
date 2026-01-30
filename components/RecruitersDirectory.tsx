"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import InscricaoDetails from "@/components/InscricaoDetails";
import type { RecruiterDirectoryEntry } from "@/app/(dashboard)/recrutadores/page";
import type { InscricaoItem } from "@/types/inscricao";
import type { TrainingOption } from "@/types/training";
import { RECRUITERS_BASE_URL, type Recruiter } from "@/lib/recruiters";
import type { AnamneseResposta } from "@/lib/anamnese";

interface RecruitersDirectoryProps {
  recruiters: RecruiterDirectoryEntry[];
  trainingOptions: TrainingOption[];
  recruiterOptions: Recruiter[];
  unlinkedAnamneses: AnamneseResposta[];
}

type FormMode = 'create' | 'link';


function normalizeCodeInput(value: string): string {
  const digits = value.replace(/\D+/g, '');
  if (!digits) {
    return '';
  }
  const numeric = Number.parseInt(digits, 10);
  if (Number.isNaN(numeric)) {
    return '';
  }
  return String(numeric).padStart(2, '0');
}

async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch (error) {
    console.error('Failed to copy text', error);
  }
}

function computeNextCode(entries: RecruiterDirectoryEntry[]): string {
  const codes = entries
    .map((item) => Number.parseInt(item.code, 10))
    .filter((value) => Number.isFinite(value));
  const nextNumeric = codes.length ? Math.max(...codes) + 1 : 1;
  return String(nextNumeric).padStart(2, '0');
}

type InscricaoLike = Pick<
  InscricaoItem,
  | 'id'
  | 'nome'
  | 'codigoProprio'
  | 'recrutadorCodigo'
  | 'recrutadorUrl'
  | 'telefone'
  | 'cidade'
  | 'isVirtual'
>;

function isInscricaoLike(value: unknown): value is InscricaoLike {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Partial<InscricaoLike>;
  return typeof record.id === 'number';
}

function mapInscricaoToEntry(inscricao: InscricaoLike): RecruiterDirectoryEntry {
  const code = inscricao.codigoProprio ?? inscricao.recrutadorCodigo ?? '';
  const url = inscricao.recrutadorUrl ?? (code ? `${RECRUITERS_BASE_URL}${code}` : `${RECRUITERS_BASE_URL}`);
  return {
    id: inscricao.id,
    inscricaoId: inscricao.id > 0 ? inscricao.id : null,
    name: inscricao.nome ?? `Cluster ${code || inscricao.id}`,
    code: code || String(inscricao.id),
    url,
    isVirtual: Boolean(inscricao.isVirtual),
    telefone: inscricao.telefone ?? null,
    cidade: inscricao.cidade ?? null,
  };
}

export default function RecruitersDirectory({ recruiters, trainingOptions, recruiterOptions, unlinkedAnamneses }: RecruitersDirectoryProps) {
  const [entries, setEntries] = useState<RecruiterDirectoryEntry[]>(() => recruiters.slice());
  const [anamneses, setAnamneses] = useState<AnamneseResposta[]>(unlinkedAnamneses);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<FormMode>('link');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [telefone, setTelefone] = useState('');
  const [cidade, setCidade] = useState('');
  const [parentCode, setParentCode] = useState('');
  const [parentInscricaoId, setParentInscricaoId] = useState('');
  const [existingInscricaoId, setExistingInscricaoId] = useState('');
  const [nivel, setNivel] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [selectedInscricao, setSelectedInscricao] = useState<InscricaoItem | null>(null);
  const [isDetailsLoading, setIsDetailsLoading] = useState(false);
  const [pendingEditId, setPendingEditId] = useState<number | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [existingSearchTerm, setExistingSearchTerm] = useState('');
  const [existingSuggestions, setExistingSuggestions] = useState<InscricaoLike[]>([]);
  const [isSearchingExisting, setIsSearchingExisting] = useState(false);
  const [selectedExisting, setSelectedExisting] = useState<InscricaoLike | null>(null);
  const [linkingContext, setLinkingContext] = useState<string | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchTimeoutRef = useRef<number | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const nextSuggestedCode = useMemo(() => computeNextCode(entries), [entries]);

  const parentCodeDatalistId = useId();
  const suggestionListId = useId();

  const filteredEntries = useMemo(() => {
    if (!query.trim()) {
      return entries;
    }
    const term = query.trim().toLowerCase();
    return entries.filter((item) =>
      item.name.toLowerCase().includes(term) || item.code.toLowerCase().includes(term)
    );
  }, [entries, query]);

  useEffect(() => {
    setEntries(recruiters.slice());
  }, [recruiters]);

  useEffect(() => {
    if (mode !== 'link') {
      setExistingSuggestions([]);
      setIsSearchingExisting(false);
      return;
    }

    const term = existingSearchTerm.trim();
    if (term.length < 2) {
      searchAbortRef.current?.abort();
      if (searchTimeoutRef.current !== null) {
        window.clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }
      setExistingSuggestions([]);
      setIsSearchingExisting(false);
      return;
    }

    searchAbortRef.current?.abort();
    if (searchTimeoutRef.current !== null) {
      window.clearTimeout(searchTimeoutRef.current);
    }

    const controller = new AbortController();
    searchAbortRef.current = controller;

    const timeoutId = window.setTimeout(async () => {
      setIsSearchingExisting(true);
      try {
        const response = await fetch(`/api/inscricoes/search?q=${encodeURIComponent(term)}&limit=8`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error('Não foi possível buscar as inscrições.');
        }
        const data = (await response.json()) as { results?: unknown };
        const parsed = Array.isArray(data?.results)
          ? (data.results.filter(isInscricaoLike) as InscricaoLike[])
          : [];
        setExistingSuggestions(parsed);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        console.error('Failed to search inscrições', error);
      } finally {
        setIsSearchingExisting(false);
      }
    }, 250);

    searchTimeoutRef.current = timeoutId;

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [existingSearchTerm, mode]);

  const resetForm = useCallback(() => {
    searchAbortRef.current?.abort();
    if (searchTimeoutRef.current !== null) {
      window.clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }
    setName('');
    setCode('');
    setTelefone('');
    setCidade('');
    setParentCode('');
    setParentInscricaoId('');
    setExistingInscricaoId('');
    setNivel('');
    setExistingSearchTerm('');
    setExistingSuggestions([]);
    setSelectedExisting(null);
    setLinkingContext(null);
    setIsSearchingExisting(false);
  }, []);

  const handleModeChange = useCallback((nextMode: FormMode) => {
    if (mode !== nextMode) {
      setMode(nextMode);
    }
    resetForm();
  }, [mode, resetForm]);

  const handleExistingSuggestionSelect = useCallback((suggestion: InscricaoLike) => {
    setSelectedExisting(suggestion);
    setExistingInscricaoId(String(suggestion.id));
    setExistingSearchTerm(suggestion.nome ?? `Inscrição #${suggestion.id}`);
    setExistingSuggestions([]);
    setCode((current) => current || nextSuggestedCode);
    if (!name) {
      setName(suggestion.nome ?? '');
    }
    if (!telefone && suggestion.telefone) {
      setTelefone(suggestion.telefone);
    }
    if (!cidade && suggestion.cidade) {
      setCidade(suggestion.cidade);
    }
  }, [cidade, name, nextSuggestedCode, telefone]);

  const handleExistingSearchChange = useCallback((value: string) => {
    setExistingSearchTerm(value);
    setExistingInscricaoId('');
    setSelectedExisting(null);
  }, []);

  const startLinkingForRecruiter = useCallback((recruiterEntry: RecruiterDirectoryEntry) => {
    if (mode !== 'link') {
      setMode('link');
    }
    resetForm();
    setCode(recruiterEntry.code);
    setLinkingContext(`Reatribuindo o código ${recruiterEntry.code} · ${recruiterEntry.name}`);
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      searchInputRef.current?.focus();
    });
  }, [mode, resetForm]);

  const handleLinkAnamnese = async (anamneseId: number, recruiterCode: string) => {
    try {
      const response = await fetch('/api/anamnese/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anamneseId, recruiterCode }),
      });

      if (!response.ok) {
        throw new Error('Failed to link anamnese');
      }

      setAnamneses(prev => prev.filter(a => a.id !== anamneseId));
      setSuccessMessage('Anamnese vinculada com sucesso!');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (error) {
      console.error(error);
      setErrorMessage('Erro ao vincular anamnese.');
      setTimeout(() => setErrorMessage(null), 3000);
    }
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const normalizedCode = normalizeCodeInput(code) || nextSuggestedCode;
    const payload: Record<string, unknown> = {
      mode,
      code: normalizedCode,
    };

    if (mode === 'create') {
      payload.name = name.trim() || `Cluster ${normalizedCode}`;
    } else {
      if (!existingInscricaoId.trim()) {
        setErrorMessage('Selecione um cadastro existente pelo nome antes de promover.');
        setIsSubmitting(false);
        return;
      }
      payload.existingInscricaoId = existingInscricaoId.trim();
      if (name.trim()) {
        payload.name = name.trim();
      }
    }

    if (telefone.trim()) {
      payload.telefone = telefone.trim();
    }

    if (cidade.trim()) {
      payload.cidade = cidade.trim();
    }

    if (parentCode.trim()) {
      const normalizedParent = normalizeCodeInput(parentCode.trim()) || parentCode.trim();
      payload.parentCode = normalizedParent;
    }

    if (parentInscricaoId.trim()) {
      payload.parentInscricaoId = parentInscricaoId.trim();
    }

    if (nivel.trim()) {
      payload.nivel = nivel.trim();
    }

    try {
      const response = await fetch('/api/recruiters', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(data?.error ?? 'Não foi possível criar o cluster.');
        return;
      }

      const responseBody = (await response.json()) as { inscricao?: unknown } | null;
      if (!responseBody?.inscricao || !isInscricaoLike(responseBody.inscricao)) {
        setErrorMessage('Resposta inválida do servidor.');
        return;
      }

      const recruiterEntry = mapInscricaoToEntry(responseBody.inscricao);

      setEntries((previous) => {
        const next = previous.filter((item) => item.code !== recruiterEntry.code);
        next.push(recruiterEntry);
        return next
          .slice()
          .sort((a, b) => {
            const codeA = Number.parseInt(a.code, 10);
            const codeB = Number.parseInt(b.code, 10);
            if (Number.isFinite(codeA) && Number.isFinite(codeB)) {
              return codeA - codeB;
            }
            return a.code.localeCompare(b.code);
          });
      });

      setSuccessMessage(
        mode === 'create'
          ? 'Cluster criado com sucesso.'
          : 'Inscrição promovida para cluster com sucesso.';
      );
      resetForm();
    } catch (error) {
      console.error('Failed to create recruiter', error);
      setErrorMessage('Erro inesperado ao criar o cluster.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const openInscricaoDetails = useCallback(
    async (inscricaoId: number | null) => {
      if (!inscricaoId) {
        setDetailsError('Este cluster ainda não está vinculado a uma inscrição editável.');
        setSelectedInscricao(null);
        return;
      }

      setDetailsError(null);
      setIsDetailsLoading(true);
      setPendingEditId(inscricaoId);

      try {
        const response = await fetch(`/api/inscricoes/${inscricaoId}`);
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          setDetailsError(payload?.error ?? 'Não foi possível carregar o cadastro.');
          setSelectedInscricao(null);
          return;
        }
        const data = (await response.json()) as { inscricao?: InscricaoItem };
        setSelectedInscricao(data.inscricao ?? null);
      } catch (error) {
        console.error('Failed to open inscrição', error);
        setDetailsError('Erro inesperado ao abrir o cadastro.');
      } finally {
        setIsDetailsLoading(false);
        setPendingEditId(null);
      }
    },
    []
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <header className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-neutral-900">Cadastrar cluster</h2>
          <p className="text-sm text-neutral-600">
            Gere um novo código ou promova uma inscrição existente para o papel de cluster.
          </p>
        </header>

        {errorMessage ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p>
        ) : null}
        {successMessage ? (
          <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {successMessage}
          </p>
        ) : null}

        <form ref={formRef} className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleModeChange('link')}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                mode === 'link'
                  ? 'border-neutral-900 bg-neutral-900 text-white'
                  : 'border-neutral-300 text-neutral-700 hover:border-neutral-500 hover:text-neutral-900'
              }`}
            >
              Vincular um existente
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('create')}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                mode === 'create'
                  ? 'border-neutral-900 bg-neutral-900 text-white'
                  : 'border-neutral-300 text-neutral-700 hover:border-neutral-500 hover:text-neutral-900'
              }`}
            >
              Criar cluster
            </button>
          </div>
          <p className="text-sm text-neutral-600">
            {mode === 'create'
              ? 'Crie um novo cluster e gere automaticamente o cadastro no CRM.'
              : 'Localize um cadastro existente no CRM. A tela abre focada na busca para agilizar a vinculação.'}
          </p>

          {mode === 'link' ? (
            <div className="space-y-4">
              {linkingContext ? (
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{linkingContext}</p>
              ) : null}
              <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700">
                Buscar no CRM
                <div className="relative">
                  <input
                    ref={searchInputRef}
                    value={existingSearchTerm}
                    onChange={(event) => handleExistingSearchChange(event.target.value)}
                    placeholder="Digite pelo menos 2 letras"
                    className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                    aria-controls={suggestionListId}
                    aria-expanded={existingSuggestions.length > 0}
                  />
                  {isSearchingExisting ? (
                    <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-neutral-500">Buscando...</span>
                  ) : null}
                  {existingSuggestions.length > 0 ? (
                    <ul
                      id={suggestionListId}
                      className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-lg"
                    >
                      {existingSuggestions.map((suggestion) => (
                        <li key={`suggestion-${suggestion.id}`}>
                          <button
                            type="button"
                            onClick={() => handleExistingSuggestionSelect(suggestion)}
                            className="flex w-full flex-col items-start px-3 py-2 text-left text-sm text-neutral-800 transition hover:bg-neutral-100"
                          >
                            <span className="font-semibold">{suggestion.nome ?? `Inscrição #${suggestion.id}`}</span>
                            <span className="text-xs text-neutral-500">
                              ID #{suggestion.id}
                              {suggestion.cidade ? ` · ${suggestion.cidade}` : ''}
                              {suggestion.telefone ? ` · ${suggestion.telefone}` : ''}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <span className="text-xs text-neutral-500">
                  {selectedExisting
                    ? 'Cadastro selecionado. Ajuste as informações abaixo e confirme.'
                    : 'Comece digitando para localizar um cadastro importado.'}
                </span>
              </label>

              {selectedExisting ? (
                <>
                  <div className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="font-semibold text-neutral-900">{selectedExisting.nome ?? `Inscrição #${selectedExisting.id}`}</p>
                      <p className="text-xs text-neutral-500">
                        ID #{selectedExisting.id}
                        {selectedExisting.cidade ? ` · ${selectedExisting.cidade}` : ''}
                        {selectedExisting.telefone ? ` · ${selectedExisting.telefone}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="text-xs font-semibold text-neutral-600 underline"
                      onClick={() => handleExistingSearchChange('')}
                    >
                      Trocar seleção
                    </button>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700">
                      Código do cluster
                      <input
                        value={code}
                        onChange={(event) => setCode(event.target.value)}
                        placeholder={nextSuggestedCode}
                        className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700">
                      Nome (opcional)
                      <input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="Atualize o nome, se necessário"
                        className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                      />
                    </label>
                  </div>
                </>
              ) : (
                <p className="text-xs text-neutral-500">Selecione um cadastro para habilitar o vínculo.</p>
              )}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700">
                Código do cluster
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder={nextSuggestedCode}
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700">
                Nome do cluster
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Digite o nome"
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                />
              </label>
            </div>
          )}

          {(mode === 'create' || selectedExisting) && (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700">
                  Telefone (opcional)
                  <input
                    value={telefone}
                    onChange={(event) => setTelefone(event.target.value)}
                    placeholder="DDD + número"
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700">
                  Cidade (opcional)
                  <input
                    value={cidade}
                    onChange={(event) => setCidade(event.target.value)}
                    placeholder="Cidade"
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700">
                  Nível (opcional)
                  <input
                    value={nivel}
                    onChange={(event) => setNivel(event.target.value)}
                    placeholder="0"
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                  />
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700">
                  Indicador (código)
                  <input
                    value={parentCode}
                    onChange={(event) => setParentCode(event.target.value)}
                    placeholder="Digite o código do indicador"
                    list={parentCodeDatalistId}
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                  />
                  <datalist id={parentCodeDatalistId}>
                    {entries.map((item) => (
                      <option key={`parent-code-${item.code}`} value={item.code}>
                        {item.name}
                      </option>
                    ))}
                  </datalist>
                  <span className="text-xs text-neutral-500">
                    Use o código do cluster responsável (opcional).
                  </span>
                </label>
                <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700">
                  ID do indicador (opcional)
                  <input
                    value={parentInscricaoId}
                    onChange={(event) => setParentInscricaoId(event.target.value)}
                    placeholder="Ex.: 45"
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                  />
                </label>
              </div>
            </>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting || (mode === 'link' && !existingInscricaoId)}
            >
              {isSubmitting
                ? 'Processando...'
                : mode === 'create'
                ? 'Criar cluster'
                : 'Vincular selecionado'}
            </button>
          </div>
        </form>
        <div className="mt-3 text-xs text-neutral-500">
          Sugestão automática: <span className="font-semibold">{nextSuggestedCode}</span>
        </div>
      </section>

      {detailsError ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {detailsError}
        </p>
      ) : null}

      {anamneses.length > 0 && (
        <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <header className="flex flex-col gap-1 mb-4">
            <h2 className="text-lg font-semibold text-neutral-900">Anamneses Pendentes</h2>
            <p className="text-sm text-neutral-600">
              Respostas de anamnese que precisam ser vinculadas a um cluster.
            </p>
          </header>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {anamneses.map((anamnese) => (
              <div key={anamnese.id} className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4">
                <div>
                  <h3 className="font-semibold text-neutral-900">{anamnese.nome || "Sem nome"}</h3>
                  <p className="text-xs text-neutral-500">
                    {anamnese.cidade} • {anamnese.telefone}
                  </p>
                  <p className="text-xs text-neutral-400 mt-1">
                    Enviado em: {anamnese.data_envio ? new Date(anamnese.data_envio).toLocaleDateString() : '-'}
                  </p>
                </div>
                <div className="mt-auto">
                  <label className="text-xs font-medium text-neutral-700">Vincular a:</label>
                  <select
                    className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                    onChange={(e) => {
                      if (e.target.value) {
                        if (confirm(`Vincular anamnese de ${anamnese.nome} ao cluster ${e.target.options[e.target.selectedIndex].text}?`)) {
                          handleLinkAnamnese(anamnese.id, e.target.value);
                        } else {
                          e.target.value = "";
                        }
                      }
                    }}
                    defaultValue=""
                  >
                    <option value="" disabled>Selecione...</option>
                    {entries.map(recruiter => (
                      <option key={recruiter.code} value={recruiter.code}>
                        {recruiter.code} - {recruiter.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-neutral-900">Lista de clusters</h2>
            <p className="text-sm text-neutral-600">
              Consulte rapidamente os códigos de indicação e seus respectivos links.
            </p>
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nome ou código"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200 sm:max-w-xs"
          />
        </header>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <thead className="bg-neutral-100 text-xs font-semibold uppercase tracking-wide text-neutral-600">
              <tr>
                <th className="px-4 py-3 text-left">Código</th>
                <th className="px-4 py-3 text-left">Cluster</th>
                <th className="px-4 py-3 text-left">Contato</th>
                <th className="px-4 py-3 text-left">Link</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {filteredEntries.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-neutral-500" colSpan={5}>
                    Nenhum cluster encontrado.
                  </td>
                </tr>
              ) : (
                filteredEntries.map((recruiter) => (
                  <tr key={`${recruiter.code}-${recruiter.id}`} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 font-mono text-neutral-700">{recruiter.code}</td>
                    <td className="px-4 py-3 text-neutral-700">
                      <div className="flex flex-col gap-1">
                        <span className="font-semibold text-neutral-900">{recruiter.name}</span>
                        <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-wide">
                          {recruiter.inscricaoId ? (
                            <span className="inline-flex items-center rounded-full bg-neutral-900/10 px-2 py-0.5 text-neutral-700">
                              ID #{recruiter.inscricaoId}
                            </span>
                          ) : null}
                          {recruiter.isVirtual ? (
                            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">
                              Virtual
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">
                              Ativo
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-neutral-700">
                      <div className="flex flex-col gap-1">
                        {recruiter.telefone ? <span>{recruiter.telefone}</span> : null}
                        {recruiter.cidade ? <span className="text-xs text-neutral-500">{recruiter.cidade}</span> : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-neutral-700">
                      <a
                        href={recruiter.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all text-neutral-900 underline"
                      >
                        {recruiter.url}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Link
                          href={`/recrutadores/${recruiter.code}`}
                          className="rounded-md border border-sky-200 px-3 py-1 text-xs font-semibold text-sky-700 transition hover:border-sky-400 hover:text-sky-900"
                        >
                          Ver árvore
                        </Link>
                        <button
                          type="button"
                          onClick={() => startLinkingForRecruiter(recruiter)}
                          className="rounded-md border border-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-700 transition hover:border-emerald-400 hover:text-emerald-900"
                        >
                          Trocar vínculo
                        </button>
                        <button
                          type="button"
                          onClick={() => openInscricaoDetails(recruiter.inscricaoId)}
                          className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-700 transition hover:border-neutral-400 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={isDetailsLoading && pendingEditId === recruiter.inscricaoId}
                        >
                          Editar cadastro
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-700 transition hover:border-neutral-400 hover:text-neutral-900"
                          onClick={() => copyToClipboard(recruiter.url)}
                        >
                          Copiar link
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <InscricaoDetails
        inscricao={selectedInscricao}
        onClose={() => setSelectedInscricao(null)}
        onUpdate={(updated) => {
          setSelectedInscricao(updated);
          setEntries((previous) =>
            previous.map((entry) =>
              entry.inscricaoId === updated.id
                ? {
                    ...entry,
                    name: updated.nome ?? entry.name,
                    telefone: updated.telefone ?? entry.telefone,
                    cidade: updated.cidade ?? entry.cidade,
                  }
                : entry
            )
          );
        }}
        trainingOptions={trainingOptions}
        recruiterOptions={recruiterOptions}
      />
    </div>
  );
}
