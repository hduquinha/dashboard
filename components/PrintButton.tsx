"use client";

import { useSearchParams } from "next/navigation";

interface PrintButtonProps {
  className?: string;
}

export default function PrintButton({ className }: PrintButtonProps) {
  const searchParams = useSearchParams();

  const handlePrint = () => {
    // Construir URL de impressão com os mesmos filtros
    const printParams = new URLSearchParams();

    [
      "nome",
      "telefone",
      "cidade",
      "indicacao",
      "treinamento",
      "data_treinamento",
      "tamanho_camiseta",
      "presenca",
      "orderBy",
      "orderDirection",
    ].forEach((key) => {
      const value = searchParams.get(key);
      if (value) {
        printParams.set(key, value);
      }
    });
    
    const query = printParams.toString();
    const printUrl = query ? `/api/print?${query}` : "/api/print";
    
    // Abrir em nova aba para impressão
    window.open(printUrl, "_blank");
  };

  return (
    <button
      type="button"
      onClick={handlePrint}
      className={className}
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
      </svg>
      Imprimir / PDF
    </button>
  );
}

