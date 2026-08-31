"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, Download, FileSpreadsheet, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  REVENUE_IMPORT_COLUMNS,
  type RevenueImportPreview,
  type RevenueImportRow,
} from "@/lib/financeRevenueImportModel";
import { dateLabel, money } from "./FinanceiroClient";

/**
 * Importação de receitas por planilha — exclusiva do Instituto UP.
 *
 * A tela repete o contrato do módulo: sobe o arquivo, confere a prévia linha a
 * linha, confirma. O arquivo escolhido fica guardado aqui e é reenviado na
 * confirmação, porque quem grava é o servidor relendo a planilha (ver
 * lib/financeRevenueImport.ts) — a prévia é só para os olhos de quem confere.
 */

/** Mesma rota para baixar o modelo (GET) e enviar a planilha (POST). */
export const REVENUE_IMPORT_HREF = "/api/finance/revenues/import";

/** Colunas da prévia; o resto do que veio na planilha fica no detalhe da linha. */
const PREVIEW_COLUMNS = [
  { key: "date", label: "Data", format: "date" as const },
  { key: "description", label: "Nome da receita" },
  { key: "amount", label: "Valor", format: "money" as const, align: "right" as const },
  { key: "categoryId", label: "Categoria" },
  { key: "origin", label: "Origem" },
  { key: "sellerId", label: "Vendedor" },
];

const STATUS_STYLE: Record<RevenueImportRow["status"], { label: string; className: string }> = {
  ok: { label: "Pronta", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  duplicado: { label: "Duplicada", className: "bg-amber-50 text-amber-800 border-amber-200" },
  erro: { label: "Com erro", className: "bg-rose-50 text-rose-700 border-rose-200" },
};

function previewCell(row: RevenueImportRow, key: string, format?: "date" | "money"): string {
  const raw = row.values[key] ?? "";
  if (!raw) return "—";
  if (format === "date") return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? dateLabel(raw) : raw;
  if (format === "money") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? money(parsed) : raw;
  }
  return raw;
}

export default function RevenueImportModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  /** Chamado depois de gravar: a tela recarrega os dados e mostra o recado. */
  onDone: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<RevenueImportPreview | null>(null);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  // Usada só nas linhas sem data — planilha própria costuma não ter a coluna.
  const [defaultDate, setDefaultDate] = useState("");
  const [busy, setBusy] = useState<"idle" | "preview" | "commit">("idle");
  const [error, setError] = useState<string | null>(null);

  const selectedCount = preview
    ? preview.totals.ok + (includeDuplicates ? preview.totals.duplicated : 0)
    : 0;
  const selectedAmount = preview
    ? preview.rows
        .filter((row) => row.status === "ok" || (includeDuplicates && row.status === "duplicado"))
        .reduce((sum, row) => sum + (row.input?.amount ?? 0), 0)
    : 0;

  async function send(mode: "preview" | "commit") {
    if (!file) return;
    setBusy(mode);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("mode", mode);
      if (defaultDate) body.append("defaultDate", defaultDate);
      if (mode === "commit" && includeDuplicates) body.append("includeDuplicates", "true");
      const response = await fetch(REVENUE_IMPORT_HREF, { method: "POST", body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Falha ao ler a planilha.");
      }
      if (mode === "preview") {
        setPreview(data.preview as RevenueImportPreview);
        setIncludeDuplicates(false);
      } else {
        const created = Number(data.created ?? 0);
        onDone(
          `${created} receita(s) do Instituto UP importada(s). Se alguma não aparecer na lista, confira o período selecionado no topo da tela.`
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao processar a planilha.");
    } finally {
      setBusy("idle");
    }
  }

  function chooseFile(next: File | null) {
    setFile(next);
    setPreview(null);
    setError(null);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Importar receitas do Instituto UP">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-black text-slate-950">Importar receitas · Instituto UP</h2>
            <p className="text-xs font-semibold text-slate-500">
              Baixe o modelo, preencha e envie. Nada é gravado antes da sua confirmação.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="grid size-9 place-content-center rounded-lg hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="rounded-lg border border-cyan-100 bg-cyan-50/70 p-4">
              <p className="text-sm font-black text-slate-950">1. Baixe a planilha modelo</p>
              <p className="mt-1 text-xs font-semibold text-slate-600">
                Já vem com listas suspensas de categoria, origem, curso, unidade e vendedor — preenchidas com o
                que está cadastrado no financeiro agora.
              </p>
              <a
                href={REVENUE_IMPORT_HREF}
                className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg bg-white px-4 text-sm font-black text-cyan-800 shadow-sm ring-1 ring-cyan-200 hover:bg-cyan-50"
              >
                <Download size={16} /> Baixar planilha modelo
              </a>
              <ul className="mt-3 space-y-1 text-[11px] font-semibold text-slate-600">
                <li>· Obrigatórias no arquivo: nome e valor. Sem coluna de data, use a data padrão ao lado.</li>
                <li>· Toda linha entra como Instituto UP, com status Previsto.</li>
                <li>· O recebimento continua sendo lançado em &ldquo;Receber&rdquo;.</li>
              </ul>
            </div>

            <div className="rounded-lg border border-slate-200 p-4">
              <p className="text-sm font-black text-slate-950">2. Envie a planilha preenchida</p>
              <p className="mt-1 text-xs font-semibold text-slate-600">
                Formatos aceitos: .xlsx e .csv, até 8MB. Não precisa ser o modelo: serve qualquer planilha que
                tenha uma coluna de descrição (Nome, Descrição, Item…) e uma de valor (Valor, Preço, Total…).
              </p>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.csv"
                onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
                className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-950 file:px-3 file:py-1.5 file:text-xs file:font-black file:text-white"
              />
              <label className="mt-3 block text-xs font-black text-slate-700">
                Data padrão (usada só nas linhas sem data)
                <input
                  type="date"
                  value={defaultDate}
                  onChange={(event) => {
                    setDefaultDate(event.target.value);
                    // A prévia foi calculada com a data anterior: refazer é mais
                    // honesto do que deixar na tela um resultado que não vale mais.
                    setPreview(null);
                  }}
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-800"
                />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void send("preview")}
                  disabled={!file || busy !== "idle"}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Upload size={16} /> {busy === "preview" ? "Conferindo..." : "Conferir planilha"}
                </button>
                {preview ? (
                  <button
                    type="button"
                    onClick={() => {
                      chooseFile(null);
                      if (inputRef.current) inputRef.current.value = "";
                    }}
                    className="inline-flex h-10 items-center rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
                  >
                    Trocar arquivo
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {error ? (
            <p className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">
              <AlertTriangle size={16} className="mt-0.5 flex-none" /> {error}
            </p>
          ) : null}

          {preview ? (
            <div className="mt-5 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <SummaryCard label="Linhas na planilha" value={String(preview.totals.rows)} icon={FileSpreadsheet} tone="slate" />
                <SummaryCard label="Prontas para importar" value={String(preview.totals.ok)} icon={CheckCircle2} tone="emerald" />
                <SummaryCard label="Possíveis duplicadas" value={String(preview.totals.duplicated)} icon={Copy} tone="amber" />
                <SummaryCard label="Com erro" value={String(preview.totals.errors)} icon={AlertTriangle} tone="rose" />
              </div>

              {preview.totals.duplicated > 0 ? (
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-900">
                  <input
                    type="checkbox"
                    checked={includeDuplicates}
                    onChange={(event) => setIncludeDuplicates(event.target.checked)}
                    className="mt-0.5 size-4 accent-amber-600"
                  />
                  <span>
                    Importar também as {preview.totals.duplicated} linha(s) marcadas como duplicadas. Elas repetem data,
                    descrição e valor de uma receita que já existe — marque só se forem vendas diferentes de mesmo valor.
                  </span>
                </label>
              ) : null}

              {preview.totals.errors > 0 ? (
                <p className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-800">
                  <AlertTriangle size={15} className="mt-0.5 flex-none" />
                  As linhas com erro não são importadas. Corrija na planilha e envie de novo se quiser incluí-las.
                </p>
              ) : null}

              <div className="overflow-hidden rounded-lg border border-slate-200">
                <div className="max-h-[42vh] overflow-auto">
                  <table className="w-full min-w-[54rem] text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Linha</th>
                        <th className="px-3 py-2">Situação</th>
                        {PREVIEW_COLUMNS.map((column) => (
                          <th key={column.key} className={cn("px-3 py-2", column.align === "right" && "text-right")}>
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {preview.rows.map((row) => {
                        const style = STATUS_STYLE[row.status];
                        const notes = [...row.errors, ...row.warnings];
                        return (
                          <tr key={row.line} className={cn(row.status === "erro" && "bg-rose-50/40", row.status === "duplicado" && "bg-amber-50/40")}>
                            <td className="px-3 py-2 font-black text-slate-500">{row.line}</td>
                            <td className="px-3 py-2">
                              <span className={cn("inline-flex rounded-md border px-2 py-0.5 text-[10px] font-black", style.className)}>
                                {style.label}
                              </span>
                              {notes.length > 0 ? (
                                <ul className="mt-1 space-y-0.5 text-[10px] font-semibold text-slate-600">
                                  {notes.map((note, index) => (
                                    <li key={index}>· {note}</li>
                                  ))}
                                </ul>
                              ) : null}
                            </td>
                            {PREVIEW_COLUMNS.map((column) => (
                              <td key={column.key} className={cn("px-3 py-2 font-semibold text-slate-800", column.align === "right" && "text-right")}>
                                {previewCell(row, column.key, column.format)}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="text-[11px] font-semibold text-slate-500">
                Colunas lidas da planilha: {REVENUE_IMPORT_COLUMNS.map((column) => column.header).join(" · ")}.
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50 px-5 py-4">
          <p className="text-xs font-black text-slate-600">
            {preview
              ? `${selectedCount} receita(s) serão importadas · ${money(selectedAmount)}`
              : "Envie a planilha para ver a prévia."}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={busy !== "idle"} className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50">
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void send("commit")}
              disabled={!preview || selectedCount === 0 || busy !== "idle"}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-5 text-sm font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === "commit" ? "Importando..." : `Importar ${selectedCount || ""} receita(s)`.trim()}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: typeof FileSpreadsheet;
  tone: "slate" | "emerald" | "amber" | "rose";
}) {
  const tones: Record<string, string> = {
    slate: "border-slate-200 text-slate-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
  };
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border bg-white p-3", tones[tone])}>
      <Icon size={18} />
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.14em] opacity-70">{label}</p>
        <p className="text-lg font-black">{value}</p>
      </div>
    </div>
  );
}
