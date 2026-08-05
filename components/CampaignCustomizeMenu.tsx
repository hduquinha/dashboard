"use client";

import { useEffect, useRef, useState } from "react";
import { Check, RotateCcw, Settings2 } from "lucide-react";

export interface CustomizableItem {
  key: string;
  label: string;
  description: string;
  /** Item que não pode ser escondido (a tela precisa de pelo menos uma aba). */
  locked?: boolean;
}

interface CampaignCustomizeMenuProps {
  items: CustomizableItem[];
  hidden: string[];
  onChange: (hidden: string[]) => void;
  saving?: boolean;
  error?: string | null;
}

/**
 * "Mostre só o que eu uso": escolhe quais abas aparecem. A escolha é da pessoa
 * (salva no servidor por e-mail), então cada um monta a própria tela sem mexer
 * na dos outros.
 */
export default function CampaignCustomizeMenu({ items, hidden, onChange, saving, error }: CampaignCustomizeMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const hiddenSet = new Set(hidden);

  function toggle(key: string) {
    const next = new Set(hiddenSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(Array.from(next));
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="true"
        className="flex min-h-9 items-center gap-1.5 rounded-md border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-2.5 py-1.5 text-xs font-medium text-[rgb(var(--slate-11))] hover:bg-[rgb(var(--slate-2))]"
      >
        <Settings2 className="h-3.5 w-3.5" />
        Personalizar
        {hidden.length > 0 ? (
          <span className="rounded-full bg-[rgb(var(--blue-3))] px-1.5 text-[10px] font-semibold text-[rgb(var(--blue-11))]">
            {hidden.length} oculta{hidden.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-80 rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-2 shadow-lg">
          <div className="flex items-center justify-between px-2 py-1.5">
            <p className="text-xs font-semibold text-[rgb(var(--slate-11))]">Seções desta tela</p>
            {hidden.length > 0 ? (
              <button
                type="button"
                onClick={() => onChange([])}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[rgb(var(--blue-11))] hover:underline"
              >
                <RotateCcw className="h-3 w-3" />
                Mostrar todas
              </button>
            ) : null}
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {items.map((item) => {
              const visible = !hiddenSet.has(item.key);
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    disabled={item.locked}
                    onClick={() => toggle(item.key)}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-[rgb(var(--slate-2))] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span
                      aria-hidden
                      className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                        visible
                          ? "border-[rgb(var(--blue-9))] bg-[rgb(var(--blue-9))] text-white"
                          : "border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))]"
                      }`}
                    >
                      {visible ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-medium text-[rgb(var(--slate-12))]">
                        {item.label}
                        {item.locked ? " (fixa)" : ""}
                      </span>
                      <span className="block text-[11px] leading-snug text-[rgb(var(--slate-9))]">{item.description}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="px-2 pt-1 text-[11px] text-[rgb(var(--slate-9))]">
            {error ? (
              <span className="text-[rgb(var(--ruby-11))]">{error}</span>
            ) : saving ? (
              "Salvando…"
            ) : (
              "Vale só para você, em qualquer aparelho."
            )}
          </p>
        </div>
      ) : null}
    </div>
  );
}
