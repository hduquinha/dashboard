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

const STATUS_COLUMN_KEY = 'status' as const;
type ColumnKey = OrderableField | typeof STATUS_COLUMN_KEY;

interface ColumnConfig {
  key: ColumnKey;
  label: string;
  sortable: boolean;
  align?: 'left' | 'center' | 'right';
}

const COLUMNS: ColumnConfig[] = [
  { key: 'id', label: '#', sortable: false },
  { key: 'nome', label: 'Nome', sortable: true },
  { key: 'telefone', label: 'Telefone', sortable: true },
  { key: 'cidade', label: 'Cidade', sortable: true },
  { key: STATUS_COLUMN_KEY, label: 'Status', sortable: false, align: 'center' },
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


  const getStatusInfo = (inscricao: InscricaoItem) => {
    if (inscricao.tipo === 'recrutador') {
      return { label: 'Recrutador', badgeClass: 'bg-emerald-100 text-emerald-800' };
    }
    if (inscricao.isVirtual) {
      return { label: 'Virtual', badgeClass: 'bg-amber-100 text-amber-800' };
    }

    switch (inscricao.status) {
      case 'aprovado':
        return { label: 'Aprovado', badgeClass: 'bg-emerald-100 text-emerald-800' };
      case 'rejeitado':
        return { label: 'Rejeitado', badgeClass: 'bg-rose-100 text-rose-700' };
      default:
        return { label: 'Aguardando', badgeClass: 'bg-amber-100 text-amber-800' };
    }
  };

  return (
    <div className="relative rounded-2xl border border-neutral-200 bg-white shadow-xl">
      {isPending && (
        <div className="absolute inset-x-0 top-0 z-10 flex justify-center">
          <span className="mt-2 inline-flex items-center rounded-md bg-neutral-900 px-3 py-1 text-xs font-semibold text-white shadow">
            Carregando...
          </span>
        </div>
      )}

      <div className="overflow-x-auto lg:overflow-visible">
        <table className="min-w-full divide-y divide-neutral-200">
          <thead className="bg-neutral-100">
            <tr>
              {COLUMNS.map((column) => {
                const isActive = column.sortable && orderBy === column.key;
                const label = column.sortable && isActive ? `${column.label} (${orderDirection.toUpperCase()})` : column.label;
                // Esconder colunas menos importantes em mobile
                const hiddenOnMobile = column.key === 'cidade' || column.key === 'profissao';
                const hiddenOnTablet = column.key === 'telefone';
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={`px-3 py-3 text-xs font-semibold uppercase tracking-wide text-neutral-600 ${
                      column.align === 'right'
                        ? 'text-right'
                        : column.align === 'center'
                        ? 'text-center'
                        : 'text-left'
                    } ${hiddenOnMobile ? 'hidden md:table-cell' : ''} ${hiddenOnTablet ? 'hidden lg:table-cell' : ''}`}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        className={`inline-flex items-center gap-1 text-neutral-700 hover:text-neutral-900 ${
                          isActive ? 'font-bold' : ''
                        }`}
                        onClick={() => handleSort(column.key as OrderableField)}
                      >
                        {label}
                      </button>
                    ) : (
                      <span>{column.label}</span>
                    )}
                  </th>
                );
              })}
              <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-600">
                Ações
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {records.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-4 py-12 text-center text-sm text-neutral-500">
                  Nenhuma inscrição encontrada.
                </td>
              </tr>
            ) : (
              records.map((inscricao, index) => (
                <tr 
                  key={inscricao.id} 
                  className={`transition-colors hover:bg-cyan-50/50 ${index % 2 === 0 ? 'bg-white' : 'bg-neutral-50/50'}`}
                >
                  <td className="whitespace-nowrap px-3 py-3 text-sm font-medium text-neutral-500">
                    {index + 1}
                  </td>
                  <td className="px-3 py-3 text-sm text-neutral-700">
                    <div className="flex flex-col">
                      <span className="font-medium text-neutral-900">
                        {inscricao.nome ?? 'Indisponível'}
                      </span>
                      {inscricao.tipo === 'recrutador' && inscricao.codigoProprio ? (
                        <span className="text-xs text-neutral-500">Código {inscricao.codigoProprio}</span>
                      ) : null}
                      {/* Mostrar telefone inline em mobile com link WhatsApp */}
                      {inscricao.telefone ? (
                        <a
                          href={`https://wa.me/55${inscricao.telefone.replace(/\D/g, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline lg:hidden"
                        >
                          <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                          </svg>
                          {inscricao.telefone}
                        </a>
                      ) : null}
                    </div>
                    <span className="mt-1 inline-flex flex-wrap gap-1">
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
                  <td className="hidden px-3 py-3 text-sm text-neutral-700 lg:table-cell">
                    {inscricao.telefone ? (
                      <a
                        href={`https://wa.me/55${inscricao.telefone.replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700 hover:underline"
                      >
                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                        </svg>
                        {inscricao.telefone}
                      </a>
                    ) : '—'}
                  </td>
                  <td className="hidden px-3 py-3 text-sm text-neutral-700 md:table-cell">
                    {inscricao.cidade ?? '—'}
                  </td>
                  <td className="px-3 py-3 text-center text-sm">
                    {(() => {
                      const status = getStatusInfo(inscricao);
                      return (
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide sm:px-3 sm:py-1 sm:text-xs ${status.badgeClass}`}>
                          {status.label}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-3 text-sm text-neutral-700">
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
                        return <span className="text-xs text-neutral-400">—</span>;
                      }

                      return (
                        <span
                          className="inline-flex w-max items-center rounded-md bg-neutral-900 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm sm:px-3 sm:py-1 sm:text-xs"
                          title={trainingRawDate ?? undefined}
                        >
                          {displayText}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-3 text-sm text-neutral-700">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-medium text-neutral-800 sm:text-sm">
                        {inscricao.recrutadorNome ?? 'Sem indicador'}
                      </span>
                      {inscricao.recrutadorCodigo ? (
                        <span className="inline-flex w-max items-center rounded-full bg-neutral-900/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">
                          {inscricao.recrutadorCodigo}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right text-sm">
                    <button
                      type="button"
                      className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-semibold text-neutral-700 transition hover:border-cyan-400 hover:bg-cyan-50 hover:text-cyan-700 sm:px-3 sm:text-sm"
                      onClick={() => setSelectedInscricao(inscricao)}
                    >
                      <span className="hidden sm:inline">Ver detalhes</span>
                      <span className="sm:hidden">Ver</span>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="border-t border-neutral-200 px-4 py-3 text-sm text-neutral-600">
        Total: {total} inscrições
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
