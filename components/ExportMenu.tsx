'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, Printer, Users } from 'lucide-react';

interface ExportMenuProps {
  /** URL to CSV download (GET, triggers browser download) */
  exportUrl: string;
  /** URL to print-friendly page — opens in new tab; user Ctrl+P to PDF */
  printUrl?: string;
  /** URL to /distribuicao with pre-filled filters */
  distribuirUrl?: string;
  /** Optional record count to show in button */
  total?: number;
}

export function ExportMenu({ exportUrl, printUrl, distribuirUrl, total }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function handlePrint() {
    setOpen(false);
    if (printUrl) {
      window.open(printUrl, '_blank', 'noopener,noreferrer');
    } else {
      window.print();
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-600 transition hover:border-neutral-300 hover:bg-neutral-50"
      >
        <Download className="h-3.5 w-3.5" />
        Exportar
        <ChevronDown className="h-3 w-3 opacity-50" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-56 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl ring-1 ring-black/5">
          {/* Header */}
          <div className="border-b border-neutral-100 px-4 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">
              {total !== undefined ? `${total.toLocaleString()} registros` : 'Exportar'}
            </p>
          </div>

          {/* CSV */}
          <a
            href={exportUrl}
            download
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-4 py-3 text-neutral-700 transition hover:bg-neutral-50"
          >
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-6m0 6l-2-2m2 2l2-2M3 7l7-4 7 4M4 6v12a1 1 0 001 1h14a1 1 0 001-1V6" />
              </svg>
            </span>
            <div>
              <p className="text-xs font-semibold text-neutral-800">CSV / Excel</p>
              <p className="text-[11px] text-neutral-400">Baixa arquivo compatível com Excel</p>
            </div>
          </a>

          {/* PDF / Print */}
          <button
            type="button"
            onClick={handlePrint}
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-neutral-700 transition hover:bg-neutral-50"
          >
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Printer className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-semibold text-neutral-800">Imprimir / PDF</p>
              <p className="text-[11px] text-neutral-400">Abre visualização para imprimir</p>
            </div>
          </button>

          {/* Distribution — only if URL provided */}
          {distribuirUrl && (
            <>
              <div className="mx-4 border-t border-neutral-100" />
              <a
                href={distribuirUrl}
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-3 text-neutral-700 transition hover:bg-neutral-50"
              >
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                  <Users className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-xs font-semibold text-neutral-800">Distribuir leads</p>
                  <p className="text-[11px] text-neutral-400">Atribuir leads a vendedores</p>
                </div>
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}
