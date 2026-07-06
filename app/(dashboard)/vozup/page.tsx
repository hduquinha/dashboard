import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  ChevronDown,
  Command,
  Folder,
  FolderOpen,
  Search,
  Users,
} from "lucide-react";
import { listRecruitersWithDbNames, listTrainingFilterOptions } from "@/lib/db";
import { listCommercialSellers } from "@/lib/commercial";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import {
  getVozupFolder,
  listMetaCreativeOptions,
  listVozupBlockStats,
  listVozupLeadsByBlock,
  META_FALLBACK_BLOCK,
  SEM_ORIGEM_BLOCK,
  VOZUP_FOLDERS,
  VOZUP_PAGE_SIZE,
  type VozupBlockStats,
  type VozupFolderDef,
} from "@/lib/vozupFolders";
import { aulaBlockToLeadFields } from "@/lib/aulaBlocks";
import type { CreateLeadContext } from "@/components/CreateLeadModal";
import VozupLeadsTable from "./VozupLeadsTable";

export type { VozupLead } from "@/lib/vozupFolders";

export const metadata: Metadata = {
  title: "VozUP — Leads",
  description: "Leads captados pelas páginas da VozUP, organizados por pasta e formulário.",
};

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>;
}

function pick(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function dateLabel(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Contexto do cadastro manual: o lead criado recebe a origem do bloco para
// aparecer na mesma listagem, como qualquer lead vindo do formulário.
function buildCreateContext(folder: VozupFolderDef, bloco: string): CreateLeadContext {
  if (folder.blockKind === "meta-form") {
    return {
      produto: "vozup",
      origem: "Facebook Lead Ads",
      label: `${folder.label} · ${bloco}`,
      extraFields: bloco !== META_FALLBACK_BLOCK ? { campaign_name: bloco } : undefined,
    };
  }
  if (folder.blockKind === "aula") {
    // O bloco é uma aula específica: grava origem + data_treinamento para o
    // lead cair exatamente nessa aula.
    const aulaFields = aulaBlockToLeadFields(bloco);
    return {
      produto: "vozup",
      origem: aulaFields.origem,
      label: bloco,
      extraFields: aulaFields.data_treinamento
        ? { data_treinamento: aulaFields.data_treinamento }
        : undefined,
    };
  }
  return {
    produto: "vozup",
    origem: bloco === SEM_ORIGEM_BLOCK ? "Cadastro manual" : bloco,
    label: bloco,
  };
}

// ── Cards ───────────────────────────────────────────────────────────────────

function StatsRow({ total, mes, semana }: { total: number; mes: number; semana: number }) {
  return (
    <div className="mt-5 grid grid-cols-3 gap-3 border-t border-[#e4edf5] pt-4">
      <div className="text-center">
        <p className="text-2xl font-bold text-slate-950">{total}</p>
        <p className="text-[11px] font-medium text-slate-500">Total</p>
      </div>
      <div className="text-center">
        <p className="text-2xl font-bold text-[#0086b8]">{mes}</p>
        <p className="text-[11px] font-medium text-slate-500">30 dias</p>
      </div>
      <div className="text-center">
        <p className="text-2xl font-bold text-slate-950">{semana}</p>
        <p className="text-[11px] font-medium text-slate-500">7 dias</p>
      </div>
    </div>
  );
}

function FolderCard({
  folder,
  blocks,
}: {
  folder: VozupFolderDef;
  blocks: VozupBlockStats[];
}) {
  const total = blocks.reduce((s, b) => s + b.total, 0);
  const mes = blocks.reduce((s, b) => s + b.mes, 0);
  const semana = blocks.reduce((s, b) => s + b.semana, 0);

  return (
    <div className="group rounded-[20px] border border-[#dce8f2] bg-white p-6 shadow-[var(--dashboard-card-shadow)] transition hover:-translate-y-0.5 hover:border-[#54c4ed]">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e5f8ff] text-xl">
            {folder.emoji}
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-950">{folder.label}</h3>
            <p className="text-xs font-medium text-slate-400">{folder.description}</p>
          </div>
        </div>
        <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-[#e5f8ff] px-2.5 py-1 text-xs font-bold text-[#0086b8]">
          <Folder size={12} />
          {folder.blockKind === "aula"
            ? `${blocks.length} ${blocks.length === 1 ? "aula" : "aulas"}`
            : `${blocks.length} ${blocks.length === 1 ? "formulário" : "formulários"}`}
        </span>
      </div>

      <StatsRow total={total} mes={mes} semana={semana} />

      <div className="mt-4">
        <Link
          href={`/vozup?pasta=${encodeURIComponent(folder.key)}`}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0086b8] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#006f99]"
        >
          <FolderOpen size={15} />
          Abrir pasta
          <ArrowRight size={15} />
        </Link>
      </div>
    </div>
  );
}

function BlockCard({ folder, block }: { folder: VozupFolderDef; block: VozupBlockStats }) {
  return (
    <div className="group rounded-[20px] border border-[#dce8f2] bg-white p-6 shadow-[var(--dashboard-card-shadow)] transition hover:-translate-y-0.5 hover:border-[#54c4ed]">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e5f8ff] text-[#0086b8]">
            <Users size={22} />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-950">{block.bloco}</h3>
            <p className="text-xs font-medium text-slate-400">
              Última conversão: {dateLabel(block.ultimaConversao)}
            </p>
          </div>
        </div>
        {block.mes > 0 && (
          <span className="inline-flex flex-shrink-0 items-center rounded-full bg-[#e5f8ff] px-2.5 py-1 text-xs font-bold text-[#0086b8]">
            +{block.mes} este mês
          </span>
        )}
      </div>

      <StatsRow total={block.total} mes={block.mes} semana={block.semana} />

      <div className="mt-4">
        <Link
          href={`/vozup?pasta=${encodeURIComponent(folder.key)}&bloco=${encodeURIComponent(block.bloco)}`}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0086b8] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#006f99]"
        >
          <Users size={15} />
          Ver leads
          <ArrowRight size={15} />
        </Link>
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

// Compatibilidade com links antigos (?fonte=...) da estrutura anterior.
const LEGACY_FONTE_TO_PASTA: Record<string, string> = {
  workshop: "workshop",
  landing: "landing-pages",
  "meta-ads": "meta",
};

export default async function VozupPage({ searchParams }: PageProps) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (session?.user.institutoUpOnly) {
    redirect("/");
  }

  const resolved = await Promise.resolve(searchParams);

  const legacyFonte = pick(resolved.fonte);
  if (legacyFonte) {
    const pasta = legacyFonte.startsWith("aula-experimental")
      ? "aula-experimental"
      : LEGACY_FONTE_TO_PASTA[legacyFonte];
    redirect(pasta ? `/vozup?pasta=${encodeURIComponent(pasta)}` : "/vozup");
  }

  const pastaKey = pick(resolved.pasta);
  const bloco = pick(resolved.bloco);
  const search = pick(resolved.q) || undefined;
  const page = Number(pick(resolved.page)) || 1;
  const sort = pick(resolved.sort) || undefined;
  const dir = pick(resolved.dir) === "asc" ? "asc" : "desc";
  const activeCriativo = pick(resolved.criativo) || undefined;

  const folder = getVozupFolder(pastaKey);

  // ── Nível 3: listagem de leads de um bloco (formulário) ──────────────────
  if (folder && bloco) {
    const [{ leads, total }, trainingOptions, recruiterOptions, sellers, creativeOptions] =
      await Promise.all([
        listVozupLeadsByBlock(folder.key, bloco, {
          search,
          page,
          sort,
          dir,
          criativo: folder.blockKind === "meta-form" ? activeCriativo ?? null : null,
        }),
        listTrainingFilterOptions(),
        listRecruitersWithDbNames(),
        listCommercialSellers(),
        folder.blockKind === "meta-form" ? listMetaCreativeOptions(bloco) : Promise.resolve([]),
      ]);
    const visibleLeads = leads.map((lead) => ({
      ...lead,
      telefone:
        session && !hasPermission(session.user, "field.view.phone")
          ? ""
          : lead.telefone,
      email:
        session && !hasPermission(session.user, "field.view.email")
          ? ""
          : lead.email,
    }));
    const totalPages = Math.ceil(total / VOZUP_PAGE_SIZE);

    const blockHref = (params: Record<string, string | undefined>) => {
      const u = new URLSearchParams({ pasta: folder.key, bloco });
      for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
      return `/vozup?${u.toString()}`;
    };

    return (
      <main className="min-h-full bg-[#f3f6fa]">
        <div className="flex min-h-[76px] items-center justify-between gap-4 border-b border-slate-200/80 bg-white/80 px-4 backdrop-blur sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href={`/vozup?pasta=${encodeURIComponent(folder.key)}`}
              className="flex size-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-cyan-50 hover:text-cyan-700"
              aria-label={`Voltar para a pasta ${folder.label}`}
            >
              <ArrowLeft size={17} />
            </Link>
            <div className="flex size-10 items-center justify-center rounded-full border border-cyan-100 bg-cyan-50 text-cyan-700">
              <Users size={20} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-black text-slate-950">{bloco}</h1>
              <p className="truncate text-xs font-semibold text-slate-500">
                VozUP · Leads · {folder.label} · {total} leads
              </p>
            </div>
          </div>

          <div className="hidden min-w-0 flex-1 justify-end gap-5 lg:flex">
            <label className="relative block w-full max-w-[390px]">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                placeholder="Buscar no CRM..."
                className="h-11 w-full rounded-lg border border-slate-200 bg-white/70 pl-11 pr-14 text-sm font-medium text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:bg-white focus:ring-4 focus:ring-cyan-100/70"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-500">
                <Command size={11} /> K
              </span>
            </label>
            <button type="button" className="relative flex size-11 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white hover:text-slate-800">
              <Bell size={20} />
              <span className="absolute right-1.5 top-1.5 grid size-5 place-content-center rounded-full bg-cyan-700 text-[10px] font-black text-white">
                2
              </span>
            </button>
            <button type="button" className="flex size-11 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white hover:text-slate-800">
              <ChevronDown size={18} />
            </button>
          </div>
        </div>

        <div className="space-y-4 p-4 sm:p-8">
          {folder.blockKind === "meta-form" && creativeOptions.length > 0 && (
            <div className="flex min-w-0 flex-wrap gap-2">
              <a
                href={blockHref({})}
                className={`inline-flex h-9 items-center rounded-lg px-3 text-xs font-bold shadow-sm transition ${
                  !activeCriativo
                    ? "border border-cyan-200 bg-cyan-50 text-cyan-700"
                    : "border border-slate-200 bg-white/70 text-slate-500 hover:bg-white hover:text-slate-800"
                }`}
              >
                Todos os criativos
              </a>
              {creativeOptions.map((opt) => {
                const isActive = activeCriativo === opt.value;
                return (
                  <a
                    key={opt.value}
                    href={blockHref({ criativo: opt.value })}
                    className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-bold shadow-sm transition ${
                      isActive
                        ? "border border-cyan-200 bg-cyan-50 text-cyan-700"
                        : "border border-slate-200 bg-white/70 text-slate-500 hover:bg-white hover:text-slate-800"
                    }`}
                  >
                    {opt.value}
                    <span className={isActive ? "text-cyan-600" : "text-slate-400"}>
                      {opt.count}
                    </span>
                  </a>
                );
              })}
            </div>
          )}

          <VozupLeadsTable
            leads={visibleLeads}
            total={total}
            page={page}
            totalPages={totalPages}
            pasta={folder.key}
            bloco={bloco}
            search={search}
            sort={sort}
            dir={dir}
            trainingOptions={trainingOptions}
            recruiterOptions={recruiterOptions}
            sourceLabel={bloco}
            criativo={folder.blockKind === "meta-form" ? activeCriativo : undefined}
            responsibleName={session?.user.name || "Henrique"}
            sellers={sellers.map((s) => ({ id: s.chatwootUserId, name: s.name, email: s.email ?? "" }))}
            currentUser={
              session
                ? {
                    email: session.user.email,
                    isSupervisor: session.user.isSupervisor,
                    role: session.user.role,
                    permissions: session.user.permissions,
                    institutoUpOnly: session.user.institutoUpOnly,
                  }
                : null
            }
            createContext={buildCreateContext(folder, bloco)}
          />
        </div>
      </main>
    );
  }

  const allBlocks = await listVozupBlockStats();

  // ── Nível 2: blocos (formulários) de uma pasta ────────────────────────────
  if (folder) {
    const blocks = allBlocks.filter((b) => b.folderKey === folder.key);
    const total = blocks.reduce((s, b) => s + b.total, 0);
    const mes = blocks.reduce((s, b) => s + b.mes, 0);
    const semana = blocks.reduce((s, b) => s + b.semana, 0);

    return (
      <main className="min-h-full space-y-6 bg-[#f5f8fb] p-4 sm:p-6">
        <header>
          <div className="flex items-center gap-3">
            <Link
              href="/vozup"
              className="flex size-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-cyan-50 hover:text-cyan-700"
              aria-label="Voltar para as pastas"
            >
              <ArrowLeft size={17} />
            </Link>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#b8e8f8] bg-[#e5f8ff] px-3 py-1 text-[11px] font-bold text-[#0086b8]">
              <FolderOpen size={13} />
              VozUP · Leads
            </div>
          </div>
          <h1 className="mt-3 text-3xl font-bold text-slate-950">
            {folder.emoji} {folder.label}
          </h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            {folder.description} Escolha {folder.blockKind === "aula" ? "uma aula" : "um formulário"} para ver os leads.
          </p>
        </header>

        {/* Aggregate stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total na pasta", value: total },
            { label: "Último mês", value: mes },
            { label: "Última semana", value: semana },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-[18px] border border-[#dce8f2] bg-white p-5 shadow-[var(--dashboard-card-shadow)]"
            >
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{s.label}</p>
              <p className="mt-2 text-3xl font-bold text-slate-950">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Block cards */}
        {blocks.length === 0 ? (
          <div className="rounded-[20px] border border-[#dce8f2] bg-white p-10 text-center shadow-[var(--dashboard-card-shadow)]">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-cyan-50 text-cyan-700">
              <Folder size={24} />
            </div>
            <p className="mt-4 text-sm font-bold text-slate-700">Nenhum formulário nesta pasta ainda</p>
            <p className="mt-1 text-xs font-medium text-slate-500">
              Assim que um lead chegar por um formulário desta categoria, o bloco aparece aqui automaticamente.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {blocks.map((block) => (
              <BlockCard key={block.bloco} folder={folder} block={block} />
            ))}
          </div>
        )}
      </main>
    );
  }

  // ── Nível 1: pastas ────────────────────────────────────────────────────────
  const grandTotal = allBlocks.reduce((s, b) => s + b.total, 0);
  const grandMes = allBlocks.reduce((s, b) => s + b.mes, 0);
  const grandSemana = allBlocks.reduce((s, b) => s + b.semana, 0);

  return (
    <main className="min-h-full space-y-6 bg-[#f5f8fb] p-4 sm:p-6">
      <header>
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#b8e8f8] bg-[#e5f8ff] px-3 py-1 text-[11px] font-bold text-[#0086b8]">
          <Users size={13} />
          VozUP
        </div>
        <h1 className="text-3xl font-bold text-slate-950">Leads</h1>
        <p className="mt-1 text-sm font-medium text-slate-500">
          Escolha uma pasta, depois um formulário, para ver os leads correspondentes.
        </p>
      </header>

      {/* Aggregate stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total geral", value: grandTotal },
          { label: "Último mês", value: grandMes },
          { label: "Última semana", value: grandSemana },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-[18px] border border-[#dce8f2] bg-white p-5 shadow-[var(--dashboard-card-shadow)]"
          >
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{s.label}</p>
            <p className="mt-2 text-3xl font-bold text-slate-950">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Folder cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {VOZUP_FOLDERS.map((f) => (
          <FolderCard key={f.key} folder={f} blocks={allBlocks.filter((b) => b.folderKey === f.key)} />
        ))}
      </div>
    </main>
  );
}
