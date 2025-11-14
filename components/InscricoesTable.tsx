'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import InscricaoDetails from '@/components/InscricaoDetails';
import type { InscricaoItem, OrderDirection, OrderableField } from '@/types/inscricao';
import type { TrainingOption } from '@/types/training';
import type { Recruiter } from '@/lib/recruiters';

interface InscricoesTableProps {
  inscricoes: InscricaoItem[];
  page: number;
  pageSize: number;
  total: number;
  orderBy: OrderableField;
  orderDirection: OrderDirection;
  trainingOptions: TrainingOption[];
  recruiterOptions: Recruiter[];
}

interface ColumnConfig {
  key: OrderableField;
  label: string;
  sortable: boolean;
  align?: 'left' | 'center' | 'right';
}

const COLUMNS: ColumnConfig[] = [
  { key: 'id', label: 'ID', sortable: true },
  { key: 'nome', label: 'Nome', sortable: true },
  { key: 'telefone', label: 'Telefone', sortable: true },
  { key: 'cidade', label: 'Cidade', sortable: true },
  { key: 'treinamento', label: 'Treinamento', sortable: true },
  { key: 'recrutador', label: 'Indicador', sortable: true },
];

function formatTrainingDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export default function InscricoesTable({
  inscricoes,
  page,
  pageSize,
  total,
  orderBy,
  orderDirection,
  trainingOptions,
  recruiterOptions,
}: InscricoesTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [selectedInscricao, setSelectedInscricao] = useState<InscricaoItem | null>(null);
  const [records, setRecords] = useState<InscricaoItem[]>(inscricoes);

  useEffect(() => {
    setRecords(inscricoes);
  }, [inscricoes]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const queryFromState = useMemo(() => {
    return new URLSearchParams(searchParams);
  }, [searchParams]);

  const trainingById = useMemo(() => {
    return trainingOptions.reduce<Record<string, TrainingOption>>((accumulator, option) => {
      accumulator[option.id] = option;
      return accumulator;
    }, {});
  }, [trainingOptions]);

  function syncRecord(updated: InscricaoItem) {
    setRecords((previous) => previous.map((entry) => (entry.id === updated.id ? { ...entry, ...updated } : entry)));
    setSelectedInscricao((previous) =>
      previous && previous.id === updated.id ? { ...previous, ...updated } : previous
    );
  }

  function updateQuery(updates: Record<string, string | null>) {
    const params = new URLSearchParams(queryFromState.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });
    const next = params.toString();
    const target = next.length ? `${pathname}?${next}` : pathname;
    startTransition(() => router.push(target));
  }

  function handleSort(column: OrderableField) {
    const nextDirection: OrderDirection = orderBy === column && orderDirection === 'asc' ? 'desc' : 'asc';
    updateQuery({
      orderBy: column,
      orderDirection: nextDirection,
      page: '1',
    });
  }

  function goToPage(requestedPage: number) {
    const safePage = Math.min(Math.max(1, requestedPage), totalPages);
    updateQuery({ page: String(safePage) });
  }


  return (
    <div className="relative">
      {isPending && (
        <div className="absolute inset-x-0 top-0 z-10 flex justify-center">
          <span className="mt-2 inline-flex items-center rounded-md bg-neutral-900 px-3 py-1 text-xs font-semibold text-white shadow">
            Carregando...
          </span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-neutral-200">
          <thead className="bg-neutral-100">
            <tr>
              {COLUMNS.map((column) => {
                const isActive = orderBy === column.key;
                const label = `${column.label}${isActive ? ` (${orderDirection.toUpperCase()})` : ''}`;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-600 ${
                      column.align === 'right'
                        ? 'text-right'
                        : column.align === 'center'
                        ? 'text-center'
                        : 'text-left'
                    }`}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        className={`inline-flex items-center gap-1 text-neutral-700 hover:text-neutral-900 ${
                          isActive ? 'font-bold' : ''
                        }`}
                        onClick={() => handleSort(column.key)}
                      >
                        {label}
                      </button>
                    ) : (
                      <span>{column.label}</span>
                    )}
                  </th>
                );
              })}
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-600">
                Ações
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200 bg-white">
            {records.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-4 py-12 text-center text-sm text-neutral-500">
                  Nenhuma inscrição encontrada.
                </td>
              </tr>
            ) : (
              records.map((inscricao) => (
                <tr key={inscricao.id} className="hover:bg-neutral-50">
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-neutral-900">
                    #{inscricao.id}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-neutral-700">
                    <span className="mr-2 font-medium text-neutral-900">
                      {inscricao.nome ?? 'Indisponível'}
                      {inscricao.tipo === 'recrutador' && inscricao.codigoProprio ? (
                        <span className="ml-2 text-xs font-normal text-neutral-500">Código {inscricao.codigoProprio}</span>
                      ) : null}
                    </span>
                    <span className="inline-flex gap-1">
                      {inscricao.tipo === 'recrutador' ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                          Recrutador
                        </span>
                      ) : null}
                      {inscricao.isVirtual ? (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                          Virtual
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-neutral-700">
                    {inscricao.telefone ?? 'Indisponível'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-neutral-700">
                    {inscricao.cidade ?? 'Indisponível'}
                  </td>
                  <td className="px-4 py-3 text-sm text-neutral-700">
                    {(() => {
                      const trainingInfo = inscricao.treinamentoId
                        ? trainingById[inscricao.treinamentoId]
                        : undefined;
                      const trainingRawDate = inscricao.treinamentoData ?? trainingInfo?.startsAt ?? null;
                      const trainingDate = formatTrainingDate(trainingRawDate ?? inscricao.treinamentoId);
                      const displayText =
                        trainingDate ??
                        inscricao.treinamentoNome ??
                        trainingInfo?.label ??
                        inscricao.treinamentoId ??
                        null;

                      if (!displayText) {
                        return <span className="text-neutral-400">Sem treinamento selecionado</span>;
                      }

                      return (
                        <span
                          className="inline-flex w-max items-center rounded-md bg-neutral-900 px-3 py-1 text-xs font-semibold text-white shadow-sm"
                          title={trainingRawDate ?? undefined}
                        >
                          {displayText}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-sm text-neutral-700">
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-neutral-800">
                        {inscricao.recrutadorNome ?? 'Sem indicador'}
                      </span>
                      {inscricao.recrutadorCodigo ? (
                        <span className="inline-flex w-max items-center rounded-full bg-neutral-900/5 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-700">
                          Código {inscricao.recrutadorCodigo}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
                    <button
                      type="button"
                      className="rounded-md border border-neutral-300 px-3 py-1 text-sm font-semibold text-neutral-700 transition hover:border-neutral-400 hover:text-neutral-900"
                      onClick={() => setSelectedInscricao(inscricao)}
                    >
                      Ver detalhes
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 border-t border-neutral-200 px-4 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span className="text-neutral-600">
          Página {page} de {totalPages}
        </span>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-neutral-300 px-3 py-1 font-semibold text-neutral-700 transition hover:border-neutral-400 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1 || isPending}
          >
            Anterior
          </button>
          <button
            type="button"
            className="rounded-md border border-neutral-300 px-3 py-1 font-semibold text-neutral-700 transition hover:border-neutral-400 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages || isPending}
          >
            Próxima
          </button>
        </div>
      </div>

      <InscricaoDetails
        inscricao={selectedInscricao}
        onClose={() => setSelectedInscricao(null)}
        onUpdate={syncRecord}
        trainingOptions={trainingOptions}
        recruiterOptions={recruiterOptions}
        onDelete={(deletedId: number) => {
          setRecords((previous) => previous.filter((entry) => entry.id !== deletedId));
          setSelectedInscricao(null);
        }}
      />
    </div>
  );
}
