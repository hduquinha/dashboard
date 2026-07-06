"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

interface CopyPhoneButtonProps {
  phone: string | null | undefined;
  /** Tamanho do icone (px). */
  size?: number;
  className?: string;
  /** Mostra o texto "Copiar"/"Copiado" ao lado do icone. */
  withLabel?: boolean;
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // clipboard API bloqueada (ex.: http sem TLS) — cai no fallback abaixo.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Botao de copiar o numero de WhatsApp do lead. Seguro para usar dentro de
 * cards arrastaveis (Kanban) e linhas clicaveis: bloqueia a propagacao de
 * pointer/click para nao iniciar drag nem acionar o clique da linha.
 */
export function CopyPhoneButton({ phone, size = 14, className = "", withLabel = false }: CopyPhoneButtonProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return null;

  async function handleCopy() {
    const ok = await copyText(digits);
    if (!ok) return;
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 1600);
  }

  // <span role="button"> em vez de <button>: o componente aparece dentro de
  // cards que ja sao <button> (lista mobile do CRM) e de cards arrastaveis —
  // button aninhado e HTML invalido e quebra a hidratacao.
  return (
    <span
      role="button"
      tabIndex={0}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        void handleCopy();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.stopPropagation();
          event.preventDefault();
          void handleCopy();
        }
      }}
      title={copied ? "Número copiado!" : "Copiar número de WhatsApp"}
      aria-label={copied ? "Número copiado" : "Copiar número de WhatsApp"}
      className={`inline-flex cursor-pointer items-center gap-1 rounded-md transition ${
        copied ? "text-emerald-600" : "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
      } ${className}`}
    >
      {copied ? <Check size={size} /> : <Copy size={size} />}
      {withLabel ? (
        <span className="text-xs font-bold">{copied ? "Copiado" : "Copiar"}</span>
      ) : null}
    </span>
  );
}
