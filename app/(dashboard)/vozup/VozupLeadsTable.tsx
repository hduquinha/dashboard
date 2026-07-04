"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LeadProfileModal } from "@/components/LeadProfileModal";
import type { TrainingOption } from "@/types/training";
import type { VozupLead } from "./page";

interface RecruiterOption {
  code: string;
  name: string;
}

interface Props {
  leads: VozupLead[];
  total: number;
  page: number;
  totalPages: number;
  sourceKey: string;
  search?: string;
  sort?: string;
  dir?: "asc" | "desc";
  trainingOptions: TrainingOption[];
  recruiterOptions: RecruiterOption[];
}

function dateLabel(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function phoneLink(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  const full = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${full}`;
}

function buildUrl(sourceKey: string, params: Record<string, string | undefined>): string {
  const u = new URLSearchParams({ fonte: sourceKey });
  for (const [k, v] of Object.entries(params)) {
    if (v) u.set(k, v);
  }
  return `/vozup?${u.toString()}`;
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) {
    return (
      <svg className="ml-1 inline h-3 w-3 opacity-30" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 3l3 4H5l3-4zM8 13L5 9h6l-3 4z"/>
      </svg>
    );
  }
  return dir === "asc" ? (
    <svg className="ml-1 inline h-3 w-3 text-[#a78bfa]" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 3l3 4H5l3-4z"/>
    </svg>
  ) : (
    <svg className="ml-1 inline h-3 w-3 text-[#a78bfa]" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 13L5 9h6l-3 4z"/>
    </svg>
  );
}

function SortHeader({
  sourceKey, search, sort, dir, col, label,
}: {
  sourceKey: string; search?: string; sort?: string; dir: "asc" | "desc"; col: string; label: string;
}) {
  const isActive = (sort ?? "criado_em") === col;
  const nextDir = isActive ? (dir === "asc" ? "desc" : "asc") : "desc";
  const href = buildUrl(sourceKey, { q: search, sort: col, dir: nextDir });
  return (
    <a href={href} className="inline-flex items-center hover:text-[#a78bfa] transition-colors">
      {label}
      <SortIcon active={isActive} dir={dir} />
    </a>
  );
}

// ── Main Table ────────────────────────────────────────────────────────────────

export default function VozupLeadsTable({
  leads,
  total,
  page,
  totalPages,
  sourceKey,
  search,
  sort,
  dir = "desc",
  trainingOptions,
  recruiterOptions,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);

  function refresh() {
    startTransition(() => router.refresh());
  }

  if (leads.length === 0) {
    return (
      <div className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-6 py-20 text-center text-sm text-[rgb(var(--slate-10))]">
        Nenhum lead encontrado para esta origem.
      </div>
    );
  }

  const prevUrl = page > 1 ? buildUrl(sourceKey, { q: search, page: String(page - 1), sort, dir }) : null;
  const nextUrl = page < totalPages ? buildUrl(sourceKey, { q: search, page: String(page + 1), sort, dir }) : null;

  return (
    <>
      <LeadProfileModal
        leadId={selectedLeadId}
        onClose={() => setSelectedLeadId(null)}
        onUpdate={() => refresh()}
        onDelete={() => { setSelectedLeadId(null); refresh(); }}
        trainingOptions={trainingOptions}
        recruiterOptions={recruiterOptions}
      />

      <div className="space-y-3">
        <p className="text-xs text-[rgb(var(--slate-10))]">
          Mostrando {leads.length} de {total} lead(s)
          {totalPages > 1 ? ` · Página ${page} de ${totalPages}` : ""}
        </p>

        <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] shadow-[0_1px_3px_rgba(28,32,36,0.06)]">
          <div className="overflow-x-auto">
            <table className="min-w-[700px] w-full border-collapse text-sm">
              <thead className="bg-[rgb(var(--slate-1))] text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-10))]">
                <tr>
                  <th className="px-4 py-3 text-left"><SortHeader sourceKey={sourceKey} search={search} sort={sort} dir={dir} col="nome" label="Lead" /></th>
                  <th className="px-4 py-3 text-left"><SortHeader sourceKey={sourceKey} search={search} sort={sort} dir={dir} col="telefone" label="WhatsApp" /></th>
                  <th className="px-4 py-3 text-left">Objetivo / Interesse</th>
                  <th className="px-4 py-3 text-left"><SortHeader sourceKey={sourceKey} search={search} sort={sort} dir={dir} col="cidade" label="Cidade" /></th>
                  <th className="px-4 py-3 text-left"><SortHeader sourceKey={sourceKey} search={search} sort={sort} dir={dir} col="criado_em" label="Entrada" /></th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => {
                  const wa = phoneLink(lead.telefone);
                  return (
                    <tr
                      key={lead.id}
                      onClick={() => setSelectedLeadId(lead.id)}
                      className="cursor-pointer border-t border-[rgb(var(--border-weak))] transition-colors hover:bg-[rgb(var(--slate-1))]"
                    >
                      <td className="max-w-48 px-4 py-3">
                        <p className="truncate font-semibold text-[rgb(var(--slate-12))]">{lead.nome}</p>
                        <p className="text-xs text-[rgb(var(--slate-10))]">#{lead.id}</p>
                        {lead.email && (
                          <p className="truncate text-xs text-[rgb(var(--slate-9))]">{lead.email}</p>
                        )}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        {lead.telefone ? (
                          <a
                            href={wa}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-full bg-[#25D366] px-3 py-1 text-xs font-semibold text-white hover:bg-[#128C7E] transition-colors"
                          >
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                              <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.124 1.535 5.856L.057 23.885a.5.5 0 0 0 .608.608l6.063-1.49A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.98 0-3.84-.576-5.404-1.57l-.387-.235-4.006.984.998-3.974-.25-.4A9.956 9.956 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
                            </svg>
                            {lead.telefone}
                          </a>
                        ) : (
                          <span className="text-[rgb(var(--slate-10))]">—</span>
                        )}
                      </td>
                      <td className="max-w-52 px-4 py-3">
                        <p className="truncate text-[rgb(var(--slate-11))]">{lead.objetivo || "—"}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-[rgb(var(--slate-11))]">
                        {lead.cidade || "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-[rgb(var(--slate-10))]">
                        {dateLabel(lead.criado_em)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <a
              href={prevUrl ?? "#"}
              aria-disabled={!prevUrl}
              className={`rounded-lg border border-[rgb(var(--border-weak))] px-3 py-1.5 text-sm font-medium transition ${
                prevUrl
                  ? "text-[rgb(var(--slate-11))] hover:bg-[rgba(var(--alpha-2))]"
                  : "pointer-events-none opacity-40 text-[rgb(var(--slate-9))]"
              }`}
            >
              ← Anterior
            </a>
            <span className="text-xs text-[rgb(var(--slate-10))]">
              Página {page} de {totalPages}
            </span>
            <a
              href={nextUrl ?? "#"}
              aria-disabled={!nextUrl}
              className={`rounded-lg border border-[rgb(var(--border-weak))] px-3 py-1.5 text-sm font-medium transition ${
                nextUrl
                  ? "text-[rgb(var(--slate-11))] hover:bg-[rgba(var(--alpha-2))]"
                  : "pointer-events-none opacity-40 text-[rgb(var(--slate-9))]"
              }`}
            >
              Próxima →
            </a>
          </div>
        )}
      </div>
    </>
  );
}
