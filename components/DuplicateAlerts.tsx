'use client';

import { useState } from 'react';
import type { DuplicateGroup, DuplicateReasonDetail } from '@/types/inscricao';

interface DuplicateAlertsProps {
  groups: DuplicateGroup[];
}

interface AlertState extends DuplicateGroup {
  selectedId: number | null;
  isDeleting: boolean;
  error: string | null;
}

function formatReasonLabel(reason: DuplicateReasonDetail['reason']): string {
  switch (reason) {
    case 'telefone':
      return 'Telefone idêntico';
    case 'email':
      return 'E-mail repetido';
    case 'nome-dia':
      return 'Nome e data semelhantes';
    case 'payload':
      return 'Payload duplicado';
    default:
      return 'Possível duplicado';
  }
}

function formatEntrySubtitle(entry: DuplicateGroup['entries'][number]): string {
  const parts: string[] = [];
  if (entry.telefone) {
    parts.push(entry.telefone);
  }
  if (entry.cidade) {
    parts.push(entry.cidade);
  }
  const createdAt = new Date(entry.criadoEm);
  if (!Number.isNaN(createdAt.getTime())) {
    parts.push(createdAt.toLocaleString('pt-BR'));
  }
  return parts.join(' • ');
}

function initializeState(groups: DuplicateGroup[]): AlertState[] {
  return groups.map((group) => ({
    ...group,
    selectedId: group.entries[0]?.id ?? null,
    isDeleting: false,
    error: null,
  }));
}

export default function DuplicateAlerts({ groups }: DuplicateAlertsProps) {
  const [alerts, setAlerts] = useState<AlertState[]>(() => initializeState(groups));

  if (alerts.length === 0) {
    return null;
  }

  const handleSelect = (groupId: string, entryId: number) => {
    setAlerts((previous) =>
      previous.map((group) =>
        group.id === groupId ? { ...group, selectedId: entryId, error: null } : group
      )
    );
  };

  const handleDismiss = async (groupId: string) => {
    const group = alerts.find((item) => item.id === groupId);
    if (!group) return;

    // Persist dismissal to DB so it doesn't reappear on refresh
    const ids = group.entries.map((e) => e.id);
    try {
      const res = await fetch("/api/inscricoes/dismiss-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        console.error("Failed to persist dismissal");
      }
    } catch (e) {
      console.error("Failed to persist dismissal", e);
    }

    // Remove from UI regardless
    setAlerts((previous) => previous.filter((item) => item.id !== groupId));
  };

  const handleDelete = async (groupId: string) => {
    const group = alerts.find((item) => item.id === groupId);
    const entryId = group?.selectedId;
    if (!group || !entryId) {
      setAlerts((previous) =>
        previous.map((item) =>
          item.id === groupId ? { ...item, error: 'Selecione uma inscrição para excluir.' } : item
        )
      );
      return;
    }

    setAlerts((previous) =>
      previous.map((item) =>
        item.id === groupId ? { ...item, isDeleting: true, error: null } : item
      )
    );

    try {
      const response = await fetch(`/api/inscricoes/${entryId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? 'Não foi possível excluir a inscrição.');
      }

      setAlerts((previous) => {
        const next = previous
          .map((item) => {
            if (item.id !== groupId) {
              return item;
            }
            const filteredEntries = item.entries.filter((entry) => entry.id !== entryId);
            if (filteredEntries.length < 2) {
              return null;
            }
            return {
              ...item,
              entries: filteredEntries,
              selectedId: filteredEntries[0]?.id ?? null,
              score: filteredEntries.length,
              isDeleting: false,
              error: null,
            } as AlertState;
          })
          .filter((item): item is AlertState => Boolean(item));
        return next;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao excluir inscrição.';
      setAlerts((previous) =>
        previous.map((item) =>
          item.id === groupId
            ? {
                ...item,
                isDeleting: false,
                error: message,
              }
            : item
        )
      );
    }
  };

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 px-6 py-5 shadow-sm">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-amber-900">
          Suspeitas de duplicidade ({alerts.length})
        </h2>
        <p className="text-sm text-amber-800">
          Revise as inscrições abaixo e confirme se alguma deve ser excluída antes de continuar.
        </p>
      </header>
      <div className="space-y-4">
        {alerts.map((group) => (
          <article
            key={group.id}
            className="rounded-md border border-amber-300 bg-white/70 px-4 py-3 shadow-sm"
          >
            <div className="flex flex-col gap-2 border-b border-amber-100 pb-3 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-amber-900">
                  {group.entries.length} registro{group.entries.length > 1 ? 's' : ''} relacionados
                </p>
                {group.reasons.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {group.reasons.map((detail, index) => (
                      <span
                        key={`${group.id}-reason-${index}`}
                        className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800"
                      >
                        {formatReasonLabel(detail.reason)}
                        {detail.matchValue ? (
                          <span className="text-[10px] font-normal normal-case text-amber-700">
                            {detail.matchValue}
                          </span>
                        ) : null}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-amber-700">Duplicidade identificada automaticamente.</p>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-amber-700">
                <span className="rounded-full bg-amber-100 px-3 py-1 font-semibold">
                  {group.entries.length} registro{group.entries.length > 1 ? 's' : ''}
                </span>
                <button
                  type="button"
                  className="text-amber-700 underline-offset-4 hover:underline"
                  onClick={() => handleDismiss(group.id)}
                >
                  Manter todos
                </button>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {group.entries.map((entry) => (
                <label
                  key={entry.id}
                  className="flex flex-col gap-1 rounded-md border border-neutral-200 bg-white p-3 text-sm shadow-sm transition hover:border-neutral-400 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <p className="font-semibold text-neutral-900">
                      {entry.nome ?? `Inscrição #${entry.id}`}
                    </p>
                    <p className="text-xs text-neutral-500">{formatEntrySubtitle(entry)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`duplicate-${group.id}`}
                      value={entry.id}
                      checked={group.selectedId === entry.id}
                      onChange={() => handleSelect(group.id, entry.id)}
                      className="h-4 w-4 text-neutral-900"
                    />
                    <span className="text-xs text-neutral-600">Excluir esta</span>
                  </div>
                </label>
              ))}
            </div>
            {group.error ? (
              <p className="mt-2 text-sm text-red-600">{group.error}</p>
            ) : null}
            <div className="mt-3 flex flex-col gap-2 text-sm md:flex-row md:items-center md:justify-between">
              <button
                type="button"
                onClick={() => handleDelete(group.id)}
                disabled={group.isDeleting || !group.selectedId}
                className="rounded-md bg-amber-700 px-4 py-2 font-semibold text-white transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {group.isDeleting ? 'Excluindo...' : 'Excluir inscrição selecionada'}
              </button>
              <p className="text-xs text-neutral-500">
                A exclusão é permanente. Confirme antes de continuar.
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
