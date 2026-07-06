'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Eye, MessageCircle } from 'lucide-react';
import { CopyPhoneButton } from '@/components/CopyPhoneButton';
import { LeadProfileModal } from '@/components/LeadProfileModal';
import { TagBadge, TagOverflowBadge } from '@/components/TagBadge';
import type { InscricaoItem, OrderDirection, OrderableField } from '@/types/inscricao';
import type { TrainingOption } from '@/types/training';
import { buildOperationalTags } from '@/lib/participantTags';
import { buildWhatsAppWebUrl, humanizeName, openWhatsAppOnMobile } from '@/lib/utils';

interface RecruiterOption {
  code: string;
  name: string;
}

interface InscricoesTableProps {
  inscricoes: InscricaoItem[];
  page: number;
  pageSize: number;
  total: number;
  orderBy: OrderableField;
  orderDirection: OrderDirection;
  trainingOptions: TrainingOption[];
  recruiterOptions: RecruiterOption[];
  showUpDayColumns?: boolean;
}

function formatTrainingDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

const WA_ICON = (
  <svg className="h-3.5 w-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

export default function InscricoesTable({
  inscricoes,
  page,
  pageSize,
  total,
  orderBy,
  orderDirection,
  trainingOptions,
  recruiterOptions,
  showUpDayColumns = true,
}: InscricoesTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [records, setRecords] = useState<InscricaoItem[]>(inscricoes);

  useEffect(() => { setRecords(inscricoes); }, [inscricoes]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const trainingById = useMemo(
    () => trainingOptions.reduce<Record<string, TrainingOption>>((acc, o) => { acc[o.id] = o; return acc; }, {}),
    [trainingOptions],
  );

  function syncRecord(updated: InscricaoItem) {
    setRecords((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
  }

  const queryFromState = useMemo(() => new URLSearchParams(searchParams), [searchParams]);

  function updateQuery(updates: Record<string, string | null>) {
    const params = new URLSearchParams(queryFromState.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) params.delete(k); else params.set(k, v);
    }
    const q = params.toString();
    startTransition(() => router.push(q ? `${pathname}?${q}` : pathname));
  }

  function handleSort(col: OrderableField) {
    const dir: OrderDirection = orderBy === col && orderDirection === 'asc' ? 'desc' : 'asc';
    updateQuery({ orderBy: col, orderDirection: dir, page: '1' });
  }

  function goToPage(p: number) {
    updateQuery({ page: String(Math.min(Math.max(1, p), totalPages)) });
  }

  function getTrainingLabel(inscricao: InscricaoItem): string | null {
    const info = inscricao.treinamentoId ? trainingById[inscricao.treinamentoId] : undefined;
    const rawDate = inscricao.treinamentoData ?? info?.startsAt ?? null;
    const date = formatTrainingDate(rawDate ?? inscricao.treinamentoId);
    const name = inscricao.treinamentoNome ?? info?.label ?? null;
    if (name && date && !name.includes(date)) return `${name} · ${date}`;
    return name ?? date ?? inscricao.treinamentoId ?? null;
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      {isPending && <div className="absolute inset-x-0 top-0 z-20 h-0.5 animate-pulse bg-cyan-400" />}

      {/* ── TOOLBAR ─────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-100 px-4 py-2">
        <span className="text-xs text-neutral-500">
          <span className="font-bold text-neutral-900">{total.toLocaleString()}</span> inscrições
        </span>
      </div>

      {/* ── MOBILE CARDS ────────────────────── */}
      <div className="divide-y divide-neutral-50 md:hidden">
        {records.length === 0 ? (
          <p className="py-16 text-center text-sm text-neutral-400">Nenhuma inscrição encontrada.</p>
        ) : records.map((ins) => {
          const tags = buildOperationalTags(ins);
          const label = getTrainingLabel(ins);
          return (
            <div key={ins.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-neutral-900">{humanizeName(ins.nome) ?? 'Indisponível'}</p>
                  {ins.telefone && (
                    <p className="mt-0.5 flex items-center gap-1.5 text-[13px] font-semibold text-neutral-700">
                      <span className="truncate">{ins.telefone}</span>
                      <CopyPhoneButton phone={ins.telefone} size={13} className="h-5 w-5 flex-shrink-0 justify-center" />
                    </p>
                  )}
                  {tags.slice(0, 3).length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {tags.slice(0, 3).map((tag) => <TagBadge key={`${ins.id}-m-${tag.key}`} tag={tag} size="xs" />)}
                      <TagOverflowBadge count={Math.max(0, tags.length - 3)} title={tags.slice(3).map((t) => t.label).join('\n')} />
                    </div>
                  )}
                </div>
                {label && <span className="mt-0.5 shrink-0 rounded-md bg-neutral-900 px-2 py-0.5 text-[10px] font-bold text-white">{label}</span>}
              </div>
              <div className="mt-2.5 flex gap-2">
                {ins.telefone && (
                  <a href={buildWhatsAppWebUrl(ins.telefone)} target="_blank" rel="noopener noreferrer"
                    onClick={(e) => openWhatsAppOnMobile(e, ins.telefone)}
                    className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#25D366] text-xs font-semibold text-white">
                    {WA_ICON} WhatsApp
                  </a>
                )}
                <button type="button" onClick={() => setSelectedLeadId(ins.id)}
                  className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-neutral-200 text-xs font-semibold text-neutral-700">
                  <Eye className="h-3.5 w-3.5" /> Ver detalhes
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── DESKTOP TABLE — 7 columns, no horizontal scroll ── */}
      <div className="hidden md:block">
        <table className="w-full table-fixed">
          <colgroup>
            <col className="w-10" />          {/* # */}
            <col className="w-[30%]" />        {/* Nome */}
            <col className="w-28" />           {/* Cadastro */}
            <col className="w-[22%]" />        {/* Treinamento */}
            <col className="w-[18%]" />        {/* Indicador */}
            <col className="w-20" />           {/* Presença */}
            <col className="w-20" />           {/* Ações */}
          </colgroup>
          <thead className="border-b border-neutral-100 bg-neutral-50/80">
            <tr>
              <th className={TH}>#</th>
              <SortTh col="nome" label="Nome" orderBy={orderBy} orderDirection={orderDirection} onSort={handleSort} />
              <SortTh col="criado_em" label="Cadastro" orderBy={orderBy} orderDirection={orderDirection} onSort={handleSort} extraClass="text-center" />
              <SortTh col="treinamento" label="Treinamento" orderBy={orderBy} orderDirection={orderDirection} onSort={handleSort} />
              <SortTh col="recrutador" label="Indicador" orderBy={orderBy} orderDirection={orderDirection} onSort={handleSort} />
              <th className={`${TH} text-center`}>Presença</th>
              <th className={`${TH} text-right`}>Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-50">
            {records.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-20 text-center text-sm text-neutral-400">
                  Nenhuma inscrição encontrada.
                </td>
              </tr>
            ) : records.map((ins, index) => {
              const tags = buildOperationalTags(ins);
              const visibleTags = tags.slice(0, 2);
              const overflow = Math.max(0, tags.length - 2);
              const label = getTrainingLabel(ins);
              const date = new Date(ins.criadoEm);
              const dateOk = !Number.isNaN(date.getTime());

              return (
                <tr
                  key={ins.id}
                  className={`cursor-pointer transition-colors hover:bg-cyan-50/40 ${index % 2 !== 0 ? 'bg-neutral-50/30' : ''}`}
                  onClick={() => setSelectedLeadId(ins.id)}
                >
                  {/* # */}
                  <td className={TD}>
                    <span className="text-[11px] text-neutral-400">{index + 1 + (page - 1) * pageSize}</span>
                  </td>

                  {/* Nome + telefone + tags */}
                  <td className={TD} onClick={(e) => e.stopPropagation()}>
                    <div className="min-w-0">
                      <button
                        type="button"
                        className="block w-full truncate text-left text-sm font-semibold text-neutral-900 hover:text-cyan-700"
                        onClick={() => setSelectedLeadId(ins.id)}
                      >
                        {humanizeName(ins.nome) ?? 'Indisponível'}
                      </button>
                      {ins.telefone && (
                        <span className="mt-0.5 flex items-center gap-1.5">
                          <a
                            href={buildWhatsAppWebUrl(ins.telefone)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => openWhatsAppOnMobile(e, ins.telefone)}
                            className="inline-flex min-w-0 items-center gap-1 text-[13px] font-semibold text-[#128C4B] hover:underline"
                            title="Abrir no WhatsApp"
                          >
                            {WA_ICON}
                            <span className="truncate">{ins.telefone}</span>
                          </a>
                          <CopyPhoneButton phone={ins.telefone} size={13} className="h-5 w-5 flex-shrink-0 justify-center" />
                        </span>
                      )}
                      {visibleTags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {visibleTags.map((tag) => (
                            <TagBadge key={`${ins.id}-${tag.key}`} tag={tag} size="xs" />
                          ))}
                          <TagOverflowBadge count={overflow} title={tags.slice(2).map((t) => t.label).join('\n')} />
                        </div>
                      )}
                    </div>
                  </td>

                  {/* Cadastro */}
                  <td className={`${TD} text-center`}>
                    {dateOk ? (
                      <>
                        <p className="text-[11px] font-medium text-neutral-700">
                          {date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                        </p>
                        <p className="text-[10px] text-neutral-400">
                          {date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </>
                    ) : <span className="text-xs text-neutral-300">—</span>}
                  </td>

                  {/* Treinamento */}
                  <td className={TD}>
                    {label ? (
                      <span className="inline-block max-w-full truncate rounded-lg bg-neutral-900 px-2.5 py-1 text-[10px] font-bold text-white" title={label}>
                        {label}
                      </span>
                    ) : <span className="text-xs text-neutral-300">—</span>}
                  </td>

                  {/* Indicador */}
                  <td className={TD}>
                    <p className="truncate text-xs font-semibold text-neutral-800">
                      {humanizeName(ins.recrutadorNome) ?? '—'}
                    </p>
                    {ins.recrutadorCodigo && (
                      <span className="mt-0.5 inline-block rounded-full bg-neutral-100 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-neutral-500">
                        {ins.recrutadorCodigo}
                      </span>
                    )}
                  </td>

                  {/* Presença */}
                  <td className={`${TD} text-center`}>
                    {ins.presencaValidada ? (
                      ins.presencaAprovada ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                          OK
                        </span>
                      ) : (
                        <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                          Parcial
                        </span>
                      )
                    ) : <span className="text-[10px] text-neutral-300">—</span>}
                  </td>

                  {/* Ações */}
                  <td className={`${TD} text-right`} onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex items-center gap-1.5">
                      {ins.telefone && (
                        <a
                          href={buildWhatsAppWebUrl(ins.telefone)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => openWhatsAppOnMobile(e, ins.telefone)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#25D366] text-white transition hover:opacity-90"
                          title="Abrir no WhatsApp"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => setSelectedLeadId(ins.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-500 transition hover:border-cyan-300 hover:text-cyan-700"
                        title="Ver detalhes"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── PAGINATION ───────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 bg-white px-4 py-2.5">
        <span className="text-xs text-neutral-400">
          Total: <span className="font-semibold text-neutral-700">{total}</span> inscrições
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-1.5">
            <button type="button" disabled={page <= 1} onClick={() => goToPage(page - 1)}
              className="h-7 rounded-lg border border-neutral-200 px-3 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-40">
              ← Anterior
            </button>
            <span className="px-2 text-xs text-neutral-400">Página {page} de {totalPages}</span>
            <button type="button" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}
              className="h-7 rounded-lg border border-neutral-200 px-3 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-40">
              Próxima →
            </button>
          </div>
        )}
      </div>

      {/* ── DETAIL MODAL ────────────────────── */}
      <LeadProfileModal
        leadId={selectedLeadId}
        onClose={() => setSelectedLeadId(null)}
        onUpdate={syncRecord}
        trainingOptions={trainingOptions}
        recruiterOptions={recruiterOptions}
        onDelete={(id) => {
          setRecords((prev) => prev.filter((r) => r.id !== id));
          setSelectedLeadId(null);
        }}
      />
    </div>
  );
}

/* ── Local helpers ─────────────────────────────── */

const TH = 'px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-neutral-400';
const TD = 'px-3 py-2.5 align-middle';

function SortTh({
  col,
  label,
  orderBy,
  orderDirection,
  onSort,
  extraClass = '',
}: {
  col: OrderableField;
  label: string;
  orderBy: OrderableField;
  orderDirection: OrderDirection;
  onSort: (col: OrderableField) => void;
  extraClass?: string;
}) {
  const active = orderBy === col;
  return (
    <th className={`${TH} ${extraClass}`}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 hover:text-neutral-700 ${active ? 'text-cyan-600' : ''}`}
      >
        {label}
        {active && <span>{orderDirection === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </th>
  );
}
