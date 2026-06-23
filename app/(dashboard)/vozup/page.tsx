import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Users } from "lucide-react";
import { getPool } from "@/lib/db";
import VozupLeadsTable from "./VozupLeadsTable";

export const metadata: Metadata = {
  title: "VozUP — Leads",
  description: "Leads captados pelas páginas da VozUP.",
};

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export interface VozupLead {
  id: number;
  nome: string;
  telefone: string;
  objetivo: string;
  origem: string;
  cidade: string;
  criado_em: string;
}

export interface VozupSource {
  key: string;
  label: string;
  emoji: string;
  origens: string[];
  crmSearch: string;
  total: number;
  semana: number;
  mes: number;
}

interface PageProps {
  searchParams:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>;
}

function pick(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

// VozUP sources
const VOZUP_SOURCES: Pick<VozupSource, "key" | "label" | "emoji" | "origens" | "crmSearch">[] = [
  {
    key: "workshop",
    label: "Workshop VozUP",
    emoji: "🎙️",
    origens: ["Workshop VozUP", "workshop vozup", "vozup workshop"],
    crmSearch: "Workshop VozUP",
  },
  {
    key: "landing",
    label: "Landing Page VozUP",
    emoji: "🌐",
    origens: ["Landing Page VozUP", "landing page vozup", "VozUP Landing", "vozup landing"],
    crmSearch: "VozUP Landing",
  },
  {
    key: "aula-experimental",
    label: "Aula Experimental",
    emoji: "🧪",
    origens: ["Aula Experimental", "aula experimental", "aula-experimental"],
    crmSearch: "Aula Experimental",
  },
];

const BASE_VOZUP_WHERE = `(
  LOWER(COALESCE(payload->>'unidade_negocio', '')) LIKE '%voz%'
  OR LOWER(COALESCE(payload->>'origem', '')) LIKE '%vozup%'
  OR LOWER(COALESCE(payload->>'origem', '')) LIKE '%voz up%'
  OR LOWER(COALESCE(payload->>'lead_setor', '')) LIKE '%voz%'
)
AND LOWER(TRIM(COALESCE(payload->>'_final', ''))) IN ('true', '1', 'sim', 'yes')`;

async function getSourceStats(): Promise<VozupSource[]> {
  const pool = getPool();

  const result = await pool.query<{
    origem: string;
    total: string;
    semana: string;
    mes: string;
  }>(`
    SELECT
      COALESCE(NULLIF(TRIM(payload->>'origem'), ''), 'Sem origem') AS origem,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE criado_em >= NOW() - INTERVAL '7 days') AS semana,
      COUNT(*) FILTER (WHERE criado_em >= NOW() - INTERVAL '30 days') AS mes
    FROM inscricoes.inscricoes
    WHERE ${BASE_VOZUP_WHERE}
    GROUP BY origem
  `);

  return VOZUP_SOURCES.map((src) => {
    const matching = result.rows.filter((r) =>
      src.origens.some((o) => r.origem.toLowerCase() === o.toLowerCase())
    );
    return {
      ...src,
      total: matching.reduce((s, r) => s + Number(r.total), 0),
      semana: matching.reduce((s, r) => s + Number(r.semana), 0),
      mes: matching.reduce((s, r) => s + Number(r.mes), 0),
    };
  });
}

async function listLeadsBySource(
  sourceKey: string,
  opts: { search?: string; page?: number }
): Promise<{ leads: VozupLead[]; total: number }> {
  const pool = getPool();
  const src = VOZUP_SOURCES.find((s) => s.key === sourceKey);
  if (!src) return { leads: [], total: 0 };

  const page = Math.max(1, opts.page ?? 1);
  const offset = (page - 1) * PAGE_SIZE;

  const originConditions = src.origens
    .map((o) => `LOWER(COALESCE(payload->>'origem', '')) = LOWER('${o.replace(/'/g, "''")}')`)
    .join(" OR ");

  const params: unknown[] = [];
  let searchClause = "";
  if (opts.search) {
    params.push(`%${opts.search.toLowerCase()}%`);
    searchClause = `AND (LOWER(COALESCE(payload->>'nome', '')) LIKE $1 OR LOWER(COALESCE(payload->>'telefone', '')) LIKE $1)`;
  }

  const result = await pool.query<VozupLead & { total: string }>(
    `SELECT
      id,
      COALESCE(NULLIF(TRIM(payload->>'nome'), ''), NULLIF(TRIM(payload->>'name'), ''), 'Sem nome') AS nome,
      COALESCE(NULLIF(TRIM(payload->>'telefone'), ''), NULLIF(TRIM(payload->>'whatsapp'), ''), '') AS telefone,
      COALESCE(NULLIF(TRIM(payload->>'objetivo'), ''), NULLIF(TRIM(payload->>'interesse_workshop'), ''), '') AS objetivo,
      COALESCE(NULLIF(TRIM(payload->>'origem'), ''), '') AS origem,
      COALESCE(NULLIF(TRIM(payload->>'cidade'), ''), '') AS cidade,
      COALESCE(payload->>'timestamp', criado_em::text) AS criado_em,
      COUNT(*) OVER () AS total
    FROM inscricoes.inscricoes
    WHERE ${BASE_VOZUP_WHERE}
      AND (${originConditions})
      ${searchClause}
    ORDER BY criado_em DESC
    LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    params
  );

  return {
    leads: result.rows.map(({ total: _t, ...row }) => row),
    total: result.rows[0] ? Number(result.rows[0].total) : 0,
  };
}

// ── Overview: cards per source ──────────────────────────────────────────────

function SourceCard({ src }: { src: VozupSource }) {
  return (
    <div className="group rounded-2xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-6 shadow-[0_1px_3px_rgba(28,32,36,0.06)] transition hover:border-[#a78bfa]/50 hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#3b1d8a]/10 text-2xl">
            {src.emoji}
          </div>
          <div>
            <h3 className="text-base font-semibold text-[rgb(var(--slate-12))]">{src.label}</h3>
            {src.total === 0 && (
              <p className="text-xs text-[rgb(var(--slate-9))]">Nenhum lead ainda</p>
            )}
          </div>
        </div>
        {src.mes > 0 && (
          <span className="inline-flex items-center rounded-full bg-[#3b1d8a]/10 px-2.5 py-0.5 text-xs font-semibold text-[#a78bfa]">
            +{src.mes} este mês
          </span>
        )}
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3 border-t border-[rgb(var(--border-weak))] pt-4">
        <div className="text-center">
          <p className="text-2xl font-bold text-[rgb(var(--slate-12))]">{src.total}</p>
          <p className="text-[11px] text-[rgb(var(--slate-10))]">Total</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-[#a78bfa]">{src.mes}</p>
          <p className="text-[11px] text-[rgb(var(--slate-10))]">30 dias</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-[rgb(var(--slate-12))]">{src.semana}</p>
          <p className="text-[11px] text-[rgb(var(--slate-10))]">7 dias</p>
        </div>
      </div>

      <div className="mt-4">
        <Link
          href={`/crm?produto=vozup&q=${encodeURIComponent(src.crmSearch)}`}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#6d28d9] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#5b21b6]"
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

export default async function VozupPage({ searchParams }: PageProps) {
  const resolved = await Promise.resolve(searchParams);
  const fonte = pick(resolved.fonte);   // "workshop" | "landing" | ""
  const search = pick(resolved.q) || undefined;
  const page = Number(pick(resolved.page)) || 1;

  const activeSource = VOZUP_SOURCES.find((s) => s.key === fonte);

  // Table view (fonte selected)
  if (activeSource) {
    const { leads, total } = await listLeadsBySource(activeSource.key, { search, page });
    const totalPages = Math.ceil(total / PAGE_SIZE);

    return (
      <main className="space-y-6">
        <header className="flex items-center gap-3">
          <Link
            href="/vozup"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] text-[rgb(var(--slate-10))] transition hover:bg-[rgba(var(--alpha-2))] hover:text-[rgb(var(--slate-12))]"
          >
            ←
          </Link>
          <div>
            <div className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-[#3b1d8a]/30 bg-[#3b1d8a]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[#a78bfa]">
              🎤 VozUP
            </div>
            <h1 className="text-xl font-bold text-[rgb(var(--slate-12))]">
              {activeSource.emoji} {activeSource.label}
            </h1>
            <p className="mt-0.5 text-sm text-[rgb(var(--slate-10))]">
              {total} lead(s) captado(s)
            </p>
          </div>
        </header>

        {/* Search */}
        <form method="GET" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="fonte" value={activeSource.key} />
          <input
            type="text"
            name="q"
            defaultValue={search}
            placeholder="Buscar por nome ou telefone…"
            className="h-9 min-w-48 flex-1 rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-3 text-sm text-[rgb(var(--slate-12))] placeholder:text-[rgb(var(--slate-9))] focus:outline-none focus:ring-2 focus:ring-[#a78bfa]/40"
          />
          <button
            type="submit"
            className="h-9 rounded-lg bg-[#6d28d9] px-4 text-sm font-semibold text-white transition hover:bg-[#5b21b6]"
          >
            Buscar
          </button>
          {search && (
            <a
              href={`/vozup?fonte=${activeSource.key}`}
              className="h-9 content-center rounded-lg px-3 text-sm text-[rgb(var(--slate-10))] hover:text-[rgb(var(--slate-12))]"
            >
              Limpar
            </a>
          )}
        </form>

        <VozupLeadsTable
          leads={leads}
          total={total}
          page={page}
          totalPages={totalPages}
          sourceKey={activeSource.key}
          search={search}
        />
      </main>
    );
  }

  // Overview cards
  const sources = await getSourceStats();
  const grandTotal = sources.reduce((s, src) => s + src.total, 0);
  const grandMes = sources.reduce((s, src) => s + src.mes, 0);
  const grandSemana = sources.reduce((s, src) => s + src.semana, 0);

  return (
    <main className="space-y-6">
      <header>
        <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-[#3b1d8a]/30 bg-[#3b1d8a]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[#a78bfa]">
          🎤 VozUP
        </div>
        <h1 className="text-2xl font-bold text-[rgb(var(--slate-12))]">VozUP</h1>
        <p className="mt-0.5 text-sm text-[rgb(var(--slate-10))]">
          Leads captados pelas páginas da VozUP, divididos por origem
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
            className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_3px_rgba(28,32,36,0.06)]"
          >
            <p className="text-xs font-medium text-[rgb(var(--slate-10))]">{s.label}</p>
            <p className="mt-1 text-3xl font-bold text-[rgb(var(--slate-12))]">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Source cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {sources.map((src) => (
          <SourceCard key={src.key} src={src} />
        ))}
      </div>
    </main>
  );
}
