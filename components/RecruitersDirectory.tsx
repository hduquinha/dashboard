"use client";

import Link from "next/link";
import { FormEvent, useEffect, useId, useMemo, useState } from "react";
import type { RecruiterDirectoryEntry } from "@/app/(dashboard)/recrutadores/page";
import type { InscricaoItem } from "@/types/inscricao";
import { RECRUITERS_BASE_URL } from "@/lib/recruiters";

interface RecruitersDirectoryProps {
  recruiters: RecruiterDirectoryEntry[];
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
    name: inscricao.nome ?? `Recrutador ${code || inscricao.id}`,
    code: code || String(inscricao.id),
    url,
    isVirtual: Boolean(inscricao.isVirtual),
    telefone: inscricao.telefone ?? null,
    cidade: inscricao.cidade ?? null,
  };
}

export default function RecruitersDirectory({ recruiters }: RecruitersDirectoryProps) {
  const [entries, setEntries] = useState<RecruiterDirectoryEntry[]>(() => recruiters.slice());
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<FormMode>('create');
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

  const nextSuggestedCode = useMemo(() => computeNextCode(entries), [entries]);

  const parentCodeDatalistId = useId();

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

  function resetForm() {
    setName('');
    setCode('');
    setTelefone('');
    setCidade('');
    setParentCode('');
    setParentInscricaoId('');
    setExistingInscricaoId('');
    setNivel('');
  }

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
      payload.name = name.trim() || `Recrutador ${normalizedCode}`;
    } else {
      if (!existingInscricaoId.trim()) {
        setErrorMessage('Informe o ID da inscrição que será promovida.');
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
        setErrorMessage(data?.error ?? 'Não foi possível criar o recrutador.');
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
          ? 'Recrutador criado com sucesso.'
          : 'Inscrição promovida para recrutador com sucesso.'
      );
      resetForm();
    } catch (error) {
      console.error('Failed to create recruiter', error);
      setErrorMessage('Erro inesperado ao criar o recrutador.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <header className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-neutral-900">Cadastrar recrutador</h2>
          <p className="text-sm text-neutral-600">
            Gere um novo código ou promova uma inscrição existente para o papel de recrutador.
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

        <form className="mt-4 grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700">
              Ação
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as FormMode)}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
              >
                <option value="create">Criar nova inscrição</option>
                <option value="link">Promover inscrição existente</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700">
              Código do recrutador
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder={nextSuggestedCode}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
              />
            </label>
            {mode === 'link' ? (
              <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700">
                ID da inscrição existente
                <input
                  value={existingInscricaoId}
                  onChange={(event) => setExistingInscricaoId(event.target.value)}
                  placeholder="Ex.: 123"
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                />
              </label>
            ) : (
              <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700">
                Nome do recrutador
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Digite o nome"
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                />
              </label>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {mode === 'link' ? (
              <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700">
                Nome do recrutador (opcional)
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Atualize o nome, se necessário"
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                />
              </label>
            ) : null}
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
                Use o código do recrutador responsável (opcional).
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

          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Processando...' : mode === 'create' ? 'Criar recrutador' : 'Promover inscrição'}
            </button>
          </div>
        </form>
        <div className="mt-3 text-xs text-neutral-500">
          Sugestão automática: <span className="font-semibold">{nextSuggestedCode}</span>
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-neutral-900">Lista de recrutadores</h2>
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
                <th className="px-4 py-3 text-left">Recrutador</th>
                <th className="px-4 py-3 text-left">Contato</th>
                <th className="px-4 py-3 text-left">Link</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {filteredEntries.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-neutral-500" colSpan={5}>
                    Nenhum recrutador encontrado.
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
    </div>
  );
}
