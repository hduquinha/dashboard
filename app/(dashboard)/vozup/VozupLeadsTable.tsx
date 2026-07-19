"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Filter,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Search,
  SlidersHorizontal,
  UserPlus,
} from "lucide-react";
import { CopyPhoneButton } from "@/components/CopyPhoneButton";
import { LeadProfileModal } from "@/components/LeadProfileModal";
import {
  CreateLeadModal,
  type CreateLeadContext,
  type CreateLeadSellerOption,
} from "@/components/CreateLeadModal";
import type { TrainingOption } from "@/types/training";
import { hasPermission, type PermissionUser } from "@/lib/permissions";
import type { VozupLead } from "@/lib/vozupFolders";
import { buildWhatsAppWebUrl, openWhatsAppOnMobile } from "@/lib/utils";

interface RecruiterOption {
  code: string;
  name: string;
}

interface Props {
  leads: VozupLead[];
  total: number;
  page: number;
  totalPages: number;
  pasta: string;
  bloco: string;
  /** Subpasta (tema) de onde veio a navegação — só existe em pastas com hasSubfolders. */
  subpasta?: string;
  search?: string;
  sort?: string;
  dir?: "asc" | "desc";
  trainingOptions: TrainingOption[];
  recruiterOptions: RecruiterOption[];
  sourceLabel?: string;
  criativo?: string;
  responsibleName?: string;
  sellers: CreateLeadSellerOption[];
  currentUser?: ({ email: string; isSupervisor: boolean } & PermissionUser) | null;
  createContext: CreateLeadContext;
}

const STATUS_TABS = [
  { key: "todos", label: "Todos", color: "cyan" },
  { key: "aguardando", label: "Aguardando", color: "amber" },
  { key: "contato", label: "Contato realizado", color: "blue" },
  { key: "qualificado", label: "Qualificado", color: "emerald" },
  { key: "convertido", label: "Convertido", color: "cyan" },
  { key: "perdido", label: "Perdido", color: "rose" },
] as const;

function dateLabel(value: string): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function dateTimeLabel(value: string): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function phoneLabel(phone: string): string {
  return phone || "-";
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

function buildUrl(
  pasta: string,
  bloco: string,
  params: Record<string, string | undefined>,
  scopedParams: Record<string, string | undefined> = {}
): string {
  const u = new URLSearchParams({ pasta, bloco });
  for (const [k, v] of Object.entries(scopedParams)) {
    if (v) u.set(k, v);
  }
  for (const [k, v] of Object.entries(params)) {
    if (v) u.set(k, v);
  }
  return `/vozup?${u.toString()}`;
}

function FilterButton({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="flex h-12 min-w-[180px] items-center justify-between gap-3 rounded-lg border border-slate-200/80 bg-white/70 px-4 text-left shadow-sm transition hover:border-cyan-200 hover:bg-white"
    >
      <span className="flex min-w-0 items-center gap-3">
        {icon ? <span className="text-slate-500">{icon}</span> : null}
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold text-slate-500">{label}</span>
          <span className="block truncate text-sm font-bold text-slate-800">{value}</span>
        </span>
      </span>
      <ChevronDown size={16} className="flex-shrink-0 text-slate-400" />
    </button>
  );
}

function StatusBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">
      Aguardando
    </span>
  );
}

function MobileInfoItem({
  label,
  value,
  children,
  className = "",
}: {
  label: string;
  value?: string | null;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200/80 ${className}`}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      {children ?? (
        <p className="mt-1 whitespace-normal break-words text-[13px] font-semibold leading-snug text-slate-800">
          {value || "-"}
        </p>
      )}
    </div>
  );
}

export default function VozupLeadsTable({
  leads,
  total,
  page,
  totalPages,
  pasta,
  bloco,
  subpasta,
  search,
  sort,
  dir = "desc",
  trainingOptions,
  recruiterOptions,
  sourceLabel = "Todos",
  criativo,
  responsibleName = "Henrique",
  sellers,
  currentUser,
  createContext,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const scopedParams = { criativo, subpasta };
  const prevUrl = page > 1 ? buildUrl(pasta, bloco, { q: search, page: String(page - 1), sort, dir }, scopedParams) : null;
  const nextUrl = page < totalPages ? buildUrl(pasta, bloco, { q: search, page: String(page + 1), sort, dir }, scopedParams) : null;
  const clearUrl = buildUrl(pasta, bloco, {}, scopedParams);
  const canCreateLead = !currentUser || hasPermission(currentUser, "crm.create_leads");

  function refresh() {
    startTransition(() => router.refresh());
  }

  return (
    <>
      <LeadProfileModal
        leadId={selectedLeadId}
        onClose={() => setSelectedLeadId(null)}
        onUpdate={() => refresh()}
        onDelete={() => { setSelectedLeadId(null); refresh(); }}
        trainingOptions={trainingOptions}
        recruiterOptions={recruiterOptions}
        currentUser={currentUser}
      />

      {showCreateModal && canCreateLead && (
        <CreateLeadModal
          sellers={sellers}
          currentUser={currentUser}
          context={createContext}
          onCreated={({ inscricao }) => {
            setShowCreateModal(false);
            setSelectedLeadId(inscricao.id);
            refresh();
          }}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      <section className="space-y-4">
        <div className="grid gap-3 xl:grid-cols-[minmax(300px,1fr)_repeat(6,auto)]">
          <form method="GET" className="min-w-0">
            <input type="hidden" name="pasta" value={pasta} />
            <input type="hidden" name="bloco" value={bloco} />
            {subpasta ? <input type="hidden" name="subpasta" value={subpasta} /> : null}
            {criativo ? <input type="hidden" name="criativo" value={criativo} /> : null}
            {sort ? <input type="hidden" name="sort" value={sort} /> : null}
            {dir ? <input type="hidden" name="dir" value={dir} /> : null}
            <label className="relative block">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                name="q"
                defaultValue={search}
                placeholder="Buscar por nome ou telefone..."
                className="h-12 w-full rounded-lg border border-slate-200/80 bg-white/70 pl-11 pr-4 text-sm font-medium text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:bg-white focus:ring-4 focus:ring-cyan-100/80"
              />
            </label>
          </form>
          <FilterButton label="Origem do lead" value={sourceLabel} />
          <FilterButton label="Status" value="Todos os status" icon={<span className="block size-2 rounded-full bg-blue-600" />} />
          <FilterButton label="Data de cadastro" value="Selecione" icon={<CalendarDays size={17} />} />
          <button
            type="button"
            className="flex h-12 items-center justify-center gap-2 rounded-lg border border-slate-200/80 bg-white/70 px-4 text-sm font-bold text-slate-700 shadow-sm transition hover:border-cyan-200 hover:bg-white"
          >
            <Filter size={16} />
            Mais filtros
          </button>
          <FilterButton label="Ordenação" value={dir === "asc" ? "Mais antigos" : "Mais recentes"} icon={<SlidersHorizontal size={17} />} />
          {canCreateLead ? (
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="flex h-12 items-center justify-center gap-2 rounded-lg bg-[#0086b8] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#006f99]"
            >
              <UserPlus size={16} />
              Novo Lead
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-3">
          {STATUS_TABS.map((tab) => {
            const isActive = tab.key === "todos";
            const count = tab.key === "todos" || tab.key === "aguardando" ? total : 0;
            return (
              <button
                key={tab.key}
                type="button"
                className={`inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-sm font-bold shadow-sm transition ${
                  isActive
                    ? "border-cyan-200 bg-cyan-50 text-cyan-700"
                    : "border-slate-200/80 bg-white/70 text-slate-600 hover:bg-white"
                }`}
              >
                {tab.key === "todos" ? <Check size={14} /> : <span className={`size-2 rounded-full ${tab.color === "amber" ? "bg-amber-500" : tab.color === "blue" ? "bg-blue-500" : tab.color === "emerald" ? "bg-emerald-500" : tab.color === "rose" ? "bg-rose-500" : "bg-cyan-500"}`} />}
                {tab.label}
                <span className={isActive ? "text-cyan-600" : "text-slate-500"}>{count}</span>
              </button>
            );
          })}
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white/80 shadow-[0_18px_50px_rgba(15,23,42,0.06)] backdrop-blur">
          <div className="divide-y divide-slate-200/80 lg:hidden">
            {leads.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-cyan-50 text-cyan-700">
                  <Search size={24} />
                </div>
                <p className="mt-4 text-sm font-bold text-slate-700">Nenhum lead encontrado</p>
                <p className="mt-1 text-xs font-medium text-slate-500">
                  Ajuste a busca ou volte para todos os registros.
                </p>
                {search ? (
                  <a href={clearUrl} className="mt-4 inline-flex text-xs font-bold text-cyan-700 hover:underline">
                    Limpar busca
                  </a>
                ) : null}
              </div>
            ) : (
              leads.map((lead, index) => {
                const selected = selectedLeadId === lead.id;
                const origem = lead.origem || sourceLabel;
                return (
                  <article
                    key={lead.id}
                    className={`px-4 py-4 transition ${selected || index === 0 ? "bg-cyan-50/70" : "bg-white/60"}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex size-11 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-black text-slate-600">
                        {initials(lead.nome)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="break-words text-base font-black leading-tight text-slate-950">
                              {lead.nome || "Sem nome"}
                            </h3>
                            <p className="mt-1 text-[11px] font-semibold text-slate-400">Lead #{lead.id}</p>
                          </div>
                          <StatusBadge />
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <MobileInfoItem label="Telefone / WhatsApp">
                        <div className="mt-1 flex min-w-0 items-center gap-1.5">
                          <span className="whitespace-normal break-words text-[13px] font-semibold leading-snug text-slate-800">
                            {phoneLabel(lead.telefone)}
                          </span>
                          {lead.telefone && (
                            <CopyPhoneButton phone={lead.telefone} size={13} className="h-5 w-5 flex-shrink-0 justify-center" />
                          )}
                        </div>
                      </MobileInfoItem>
                      <MobileInfoItem label="E-mail" value={lead.email || "-"} />
                      <MobileInfoItem label="Cidade" value={lead.cidade || "-"} />
                      <MobileInfoItem label="Responsável" value={responsibleName} />
                      <MobileInfoItem label="Origem" value={origem} className="sm:col-span-2" />
                      <MobileInfoItem label="Objetivo" value={lead.objetivo || "-"} className="sm:col-span-2" />
                      <MobileInfoItem label="Data de cadastro" value={dateTimeLabel(lead.criado_em)} className="sm:col-span-2" />
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {lead.telefone ? (
                        <a
                          href={buildWhatsAppWebUrl(lead.telefone)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(event) => openWhatsAppOnMobile(event, lead.telefone)}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#25D366] px-3 text-sm font-bold text-white transition hover:opacity-90"
                        >
                          <MessageCircle size={16} />
                          WhatsApp
                        </a>
                      ) : null}
                      {lead.email ? (
                        <a
                          href={`mailto:${lead.email}`}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                        >
                          <Mail size={16} />
                          E-mail
                        </a>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setSelectedLeadId(lead.id)}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-cyan-200 bg-cyan-50 px-3 text-sm font-bold text-cyan-700 transition hover:bg-cyan-100"
                      >
                        <Eye size={16} />
                        Ver detalhes
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>

          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[1050px] border-collapse text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-bold text-slate-500">
                <tr>
                  <th className="w-14 px-5 py-4 text-left">
                    <span className="block size-5 rounded border border-slate-300 bg-white" />
                  </th>
                  <th className="px-4 py-4 text-left">Lead</th>
                  <th className="px-4 py-4 text-left">Origem</th>
                  <th className="px-4 py-4 text-left">Status</th>
                  <th className="px-4 py-4 text-left">Data de cadastro</th>
                  <th className="px-4 py-4 text-left">Responsável</th>
                  <th className="w-14 px-4 py-4 text-right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80">
                {leads.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-16 text-center">
                      <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-cyan-50 text-cyan-700">
                        <Search size={24} />
                      </div>
                      <p className="mt-4 text-sm font-bold text-slate-700">Nenhum lead encontrado</p>
                      <p className="mt-1 text-xs font-medium text-slate-500">
                        Ajuste a busca ou volte para todos os registros.
                      </p>
                      {search ? (
                        <a href={clearUrl} className="mt-4 inline-flex text-xs font-bold text-cyan-700 hover:underline">
                          Limpar busca
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ) : (
                  leads.map((lead, index) => {
                    const selected = selectedLeadId === lead.id;
                    return (
                      <tr
                        key={lead.id}
                        onClick={() => setSelectedLeadId(lead.id)}
                        className={`cursor-pointer transition hover:bg-cyan-50/50 ${selected || index === 0 ? "bg-cyan-50/70" : "bg-white/60"}`}
                      >
                        <td className="px-5 py-4">
                          <span className={`grid size-5 place-content-center rounded border ${selected || index === 0 ? "border-cyan-600 bg-cyan-600 text-white" : "border-slate-300 bg-white text-transparent"}`}>
                            <Check size={13} />
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex size-10 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-black text-slate-600">
                              {initials(lead.nome)}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-bold text-slate-950">{lead.nome}</p>
                              <p className="mt-1 flex items-center gap-1.5">
                                <span className="truncate text-[13px] font-semibold text-slate-600">
                                  {phoneLabel(lead.telefone)}
                                </span>
                                {lead.telefone && (
                                  <CopyPhoneButton phone={lead.telefone} size={13} className="h-5 w-5 flex-shrink-0 justify-center" />
                                )}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="max-w-[220px] px-4 py-4">
                          <p className="truncate font-semibold text-slate-700">{lead.origem || sourceLabel}</p>
                          {lead.objetivo ? <p className="mt-1 truncate text-xs text-slate-400">{lead.objetivo}</p> : null}
                        </td>
                        <td className="px-4 py-4">
                          <StatusBadge />
                        </td>
                        <td className="px-4 py-4">
                          <p className="font-semibold text-slate-700">{dateTimeLabel(lead.criado_em)}</p>
                          <p className="mt-1 text-xs text-slate-400">{dateLabel(lead.criado_em)}</p>
                        </td>
                        <td className="px-4 py-4 font-semibold text-slate-700">{responsibleName}</td>
                        <td className="px-4 py-4 text-right">
                          <button
                            type="button"
                            className="inline-flex size-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                            aria-label={`Mais ações para ${lead.nome}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedLeadId(lead.id);
                            }}
                          >
                            <MoreHorizontal size={17} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white/70 px-6 py-4">
            <p className="text-sm font-medium text-slate-500">
              Mostrando {leads.length > 0 ? (page - 1) * 50 + 1 : 0} a {Math.min(page * 50, total)} de {total} leads
            </p>
            {totalPages > 1 ? (
              <div className="flex items-center gap-2">
                <a
                  href={prevUrl ?? "#"}
                  aria-disabled={!prevUrl}
                  className={`flex size-10 items-center justify-center rounded-lg border border-slate-200 transition ${
                    prevUrl ? "bg-white text-slate-600 hover:bg-cyan-50 hover:text-cyan-700" : "pointer-events-none opacity-40 text-slate-400"
                  }`}
                >
                  <ChevronLeft size={18} />
                </a>
                <span className="grid size-10 place-content-center rounded-lg bg-cyan-700 text-sm font-black text-white">
                  {page}
                </span>
                {page + 1 <= totalPages ? (
                  <a href={buildUrl(pasta, bloco, { q: search, page: String(page + 1), sort, dir }, scopedParams)} className="grid size-10 place-content-center rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-100">
                    {page + 1}
                  </a>
                ) : null}
                {page + 2 <= totalPages ? (
                  <a href={buildUrl(pasta, bloco, { q: search, page: String(page + 2), sort, dir }, scopedParams)} className="grid size-10 place-content-center rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-100">
                    {page + 2}
                  </a>
                ) : null}
                {totalPages > page + 3 ? <span className="px-2 text-slate-400">...</span> : null}
                {totalPages > page + 2 ? (
                  <a href={buildUrl(pasta, bloco, { q: search, page: String(totalPages), sort, dir }, scopedParams)} className="grid size-10 place-content-center rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-100">
                    {totalPages}
                  </a>
                ) : null}
                <a
                  href={nextUrl ?? "#"}
                  aria-disabled={!nextUrl}
                  className={`flex size-10 items-center justify-center rounded-lg border border-slate-200 transition ${
                    nextUrl ? "bg-white text-slate-600 hover:bg-cyan-50 hover:text-cyan-700" : "pointer-events-none opacity-40 text-slate-400"
                  }`}
                >
                  <ChevronRight size={18} />
                </a>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </>
  );
}
