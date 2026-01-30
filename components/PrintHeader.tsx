"use client";

import { useEffect, useState } from "react";

interface PrintHeaderProps {
  title: string;
  totalRecords: number;
}

export default function PrintHeader({ title, totalRecords }: PrintHeaderProps) {
  const [dateStr, setDateStr] = useState("");

  useEffect(() => {
    const now = new Date();
    setDateStr(
      `${now.toLocaleDateString("pt-BR")} às ${now.toLocaleTimeString("pt-BR")}`
    );
  }, []);

  return (
    <div className="hidden print:block print:mb-4">
      <h1 className="text-xl font-bold text-neutral-900">{title}</h1>
      <p className="text-sm text-neutral-500">
        {totalRecords} registros{dateStr && ` • Gerado em ${dateStr}`}
      </p>
    </div>
  );
}
