"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, LayoutGrid, Search } from "lucide-react";
import CreativeThumb from "@/components/CreativeThumb";
import { formatCurrency, formatNumber } from "@/lib/campaignFormat";
import type { CreativeVisual } from "@/types/metaAds";

export interface CreativeOption {
  /** Valor do filtro (hoje o nome do criativo, que agrupa os `ad_id`). */
  value: string;
  label: string;
  spend: number;
  cadastros: number;
  creative: CreativeVisual;
}

interface CreativePickerProps {
  options: CreativeOption[];
  /** null = "todos os anúncios". */
  value: string | null;
  onChange: (value: string | null) => void;
  /** Abre o criativo em tela cheia (o pai controla o lightbox). */
  onOpenCreative: (creative: CreativeVisual) => void;
  allLabel?: string;
}

/**
 * Seletor de anúncio COM a imagem do criativo. Um `<select>` nativo só mostra
 * texto, e o gestor não reconhece a peça pelo código do nome — então aqui cada
 * opção traz miniatura, gasto e cadastros, e a miniatura abre o criativo em
 * tela cheia sem precisar selecionar. Fecha no Esc e no clique fora.
 */
export default function CreativePicker({
  options,
  value,
  onChange,
  onOpenCreative,
  allLabel = "Todos os anúncios",
}: CreativePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const selected = value ? (options.find((option) => option.value === value) ?? null) : null;

  const visibleOptions = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("pt-BR");
    if (!term) return options;
    return options.filter((option) => option.label.toLocaleLowerCase("pt-BR").includes(term));
  }, [options, query]);

  function select(next: string | null) {
    onChange(next);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex min-h-9 w-full min-w-[15rem] max-w-[22rem] items-center gap-2 rounded-md border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-2 py-1.5 text-left text-xs font-medium text-[rgb(var(--slate-12))] hover:bg-[rgb(var(--slate-2))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--blue-8))]"
      >
        {selected ? (
          <CreativeThumb creative={selected.creative} onOpen={() => onOpenCreative(selected.creative)} />
        ) : (
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded bg-[rgb(var(--slate-3))]">
            <LayoutGrid className="h-4 w-4 text-[rgb(var(--slate-9))]" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate">{selected ? selected.label : `${allLabel} (${formatNumber(options.length)})`}</span>
          <span className="block truncate text-[10px] font-normal text-[rgb(var(--slate-9))]">
            {selected
              ? `${formatCurrency(selected.spend)} · ${formatNumber(selected.cadastros)} cadastros`
              : "clique para escolher um criativo"}
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 flex-shrink-0 text-[rgb(var(--slate-9))] transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Escolher anúncio"
          className="absolute left-0 z-30 mt-1 max-h-[22rem] w-[min(26rem,90vw)] overflow-y-auto rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-1.5 shadow-lg"
        >
          <div className="mb-1 flex items-center gap-1.5 rounded-md bg-[rgb(var(--slate-2))] px-2">
            <Search className="h-3.5 w-3.5 flex-shrink-0 text-[rgb(var(--slate-9))]" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar criativo…"
              aria-label="Buscar criativo"
              className="min-h-8 w-full bg-transparent py-1 text-xs text-[rgb(var(--slate-12))] focus-visible:outline-none"
            />
          </div>

          <button
            type="button"
            role="option"
            aria-selected={!selected}
            onClick={() => select(null)}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-medium transition hover:bg-[rgb(var(--slate-2))] ${
              !selected ? "bg-[rgb(var(--blue-2))] text-[rgb(var(--blue-11))]" : "text-[rgb(var(--slate-12))]"
            }`}
          >
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded bg-[rgb(var(--slate-3))]">
              <LayoutGrid className="h-4 w-4 text-[rgb(var(--slate-9))]" />
            </span>
            <span className="min-w-0 flex-1 truncate">
              {allLabel} ({formatNumber(options.length)})
            </span>
            {!selected ? <Check className="h-4 w-4 flex-shrink-0" /> : null}
          </button>

          {visibleOptions.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => select(option.value)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition hover:bg-[rgb(var(--slate-2))] ${
                  active ? "bg-[rgb(var(--blue-2))]" : ""
                }`}
              >
                <CreativeThumb creative={option.creative} onOpen={() => onOpenCreative(option.creative)} />
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-xs font-medium ${
                      active ? "text-[rgb(var(--blue-11))]" : "text-[rgb(var(--slate-12))]"
                    }`}
                    title={option.label}
                  >
                    {option.label}
                  </span>
                  <span className="block truncate text-[10px] text-[rgb(var(--slate-9))]">
                    {formatCurrency(option.spend)} · {formatNumber(option.cadastros)} cadastros
                  </span>
                </span>
                {active ? <Check className="h-4 w-4 flex-shrink-0 text-[rgb(var(--blue-11))]" /> : null}
              </button>
            );
          })}

          {visibleOptions.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-[rgb(var(--slate-9))]">Nenhum criativo com esse nome.</p>
          ) : null}

          <p className="mt-1 border-t border-[rgb(var(--border-weak))] px-2 pt-1.5 text-[10px] leading-snug text-[rgb(var(--slate-9))]">
            Clique na miniatura para ver o criativo em tela cheia; clique na linha para filtrar por ele.
          </p>
        </div>
      ) : null}
    </div>
  );
}
