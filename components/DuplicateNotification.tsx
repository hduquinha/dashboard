'use client';

import Link from 'next/link';
import { AlertTriangle, X, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { DuplicateReason } from '@/types/inscricao';

interface DuplicateNotificationProps {
  totalGroups: number;
  topReasons: Array<{ reason: DuplicateReason; count: number }>;
}

function formatReasonLabel(reason: DuplicateReason): string {
  switch (reason) {
    case 'telefone':
      return 'telefone igual';
    case 'email':
      return 'e-mail repetido';
    case 'nome-dia':
      return 'nome similar no mesmo dia';
    case 'payload':
      return 'dados idênticos';
    default:
      return 'possível duplicado';
  }
}

function formatReasonsSummary(topReasons: Array<{ reason: DuplicateReason; count: number }>): string {
  if (topReasons.length === 0) {
    return '';
  }
  const parts = topReasons.map(({ reason, count }) => `${count} por ${formatReasonLabel(reason)}`);
  return parts.join(', ');
}

export default function DuplicateNotification({ totalGroups, topReasons }: DuplicateNotificationProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || totalGroups === 0) {
    return null;
  }

  const reasonsSummary = formatReasonsSummary(topReasons);

  return (
    <div className="relative rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-4 shadow-sm">
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="absolute right-3 top-3 rounded-full p-1 text-amber-600 transition hover:bg-amber-100 hover:text-amber-800"
        aria-label="Dispensar notificação"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-start gap-3 pr-8">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-100">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-amber-900">
              Possíveis duplicados detectados
            </h3>
            <span className="inline-flex items-center justify-center rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-bold text-white">
              {totalGroups}
            </span>
          </div>

          <p className="mt-1 text-sm text-amber-700">
            Encontramos <strong>{totalGroups} grupo{totalGroups > 1 ? 's' : ''}</strong> de registros 
            que podem ser duplicados
            {reasonsSummary && (
              <span className="text-amber-600"> ({reasonsSummary})</span>
            )}
            . Revise para manter sua base organizada.
          </p>

          <Link
            href="/duplicados"
            className="mt-3 inline-flex items-center gap-1 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-700"
          >
            Revisar duplicados
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
