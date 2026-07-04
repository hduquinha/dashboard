import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ArrowRight, Users } from "lucide-react";
import { getPool, listRecruitersWithDbNames, listTrainingFilterOptions } from "@/lib/db";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
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
  email: string;
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
  dataTreinamento?: string;
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

// Sub-filtros disponíveis dentro do bloco "Landing Page VozUP".
// Cada entrada representa uma landing page específica identificada por sua origem.
// Para adicionar uma nova LP: acrescente uma entrada aqui e em landingpage-vozup/src/lib/landingPages.ts.
const LANDING_SUB_SOURCES = [
  { key: "all", label: "Todos os Leads", origemExata: null },
  { key: "principal", label: "Landing Page Principal", origemExata: "Landing Page VozUP" },
  { key: "advogados", label: "Landing Page Advogados", origemExata: "Vozup Landing Page Advogados" },
  { key: "empresarios", label: "Landing Page Empresários", origemExata: "Vozup Landing Page Empresários" },
  { key: "corretores", label: "Landing Page Corretores de Imóveis", origemExata: "Vozup Landing Page Corretores de Imóveis" },
  { key: "autoridade-digital", label: "Landing Page Autoridade Digital", origemExata: "Vozup Landing Page Autoridade Digital" },
] as const;

type LandingSubKey = (typeof LANDING_SUB_SOURCES)[number]["key"];

// VozUP sources (static — Aula Experimental is loaded dynamically per turma)
const VOZUP_SOURCES: Pick<VozupSource, "key" | "label" | "emoji" | "origens" | "dataTreinamento">[] = [
  {
    key: "workshop",
    label: "Workshop VozUP",
    emoji: "🎙️",
    origens: ["Workshop VozUP", "workshop vozup", "vozup workshop"],
  },
  {
    key: "landing",
    label: "Landing Page VozUP",
    emoji: "🌐",
    // Inclui todas as origens das landing pages — principal + por perfil.
    // Ao criar uma nova LP, adicione a origem aqui e em LANDING_SUB_SOURCES acima.
    origens: [
      "Landing Page VozUP",
      "landing page vozup",
      "VozUP Landing",
      "vozup landing",
      "Vozup Landing Page Advogados",
      "Vozup Landing Page Empresários",
      "Vozup Landing Page Corretores de Imóveis",
      "Vozup Landing Page Autoridade Digital",
    ],
  },
  {
    key: "meta-ads",
    label: "Formulário Meta (Tráfego Pago)",
    emoji: "📣",
    // Origens agrupadas neste card.
    origens: ["Facebook Lead Ads"],
  },
];

// Sub-filtro por criativo dentro do bloco "Formulário Meta (Tráfego Pago)".
// Ao contrário das LPs (fixas), os criativos mudam com frequência — por isso
// essa lista vem do banco (payload->>'ad_name') em vez de ser hardcoded aqui.
async function getMetaAdsCreativeOptions(): Promise<{ value: string; count: number }[]> {
  const pool = getPool();
  const result = await pool.query<{ ad_name: string; count: string }>(`
    SELECT
      COALESCE(NULLIF(TRIM(payload->>'ad_name'), ''), 'Sem criativo identificado') AS ad_name,
      COUNT(*)::text AS count
    FROM inscricoes.inscricoes
    WHERE LOWER(TRIM(COALESCE(payload->>'origem', ''))) = 'facebook lead ads'
      AND LOWER(TRIM(COALESCE(payload->>'_final', ''))) IN ('true', '1', 'sim', 'yes')
      AND COALESCE(payload->>'dashboard_excluido', '') != 'true'
    GROUP BY ad_name
    ORDER BY count DESC
  `);
  return result.rows.map((r) => ({ value: r.ad_name, count: Number(r.count) }));
}

const AULA_EXPERIMENTAL_ORIGENS = [
  "Aula Experimental", "aula experimental", "aula-experimental",
  "Aula Exclusiva", "aula exclusiva", "aula-exclusiva",
];

const BASE_VOZUP_WHERE = `(
  LOWER(COALESCE(payload->>'unidade_negocio', '')) LIKE '%voz%'
  OR LOWER(COALESCE(payload->>'origem', '')) LIKE '%vozup%'
  OR LOWER(COALESCE(payload->>'origem', '')) LIKE '%voz up%'
  OR LOWER(COALESCE(payload->>'lead_setor', '')) LIKE '%voz%'
)
AND LOWER(TRIM(COALESCE(payload->>'_final', ''))) IN ('true', '1', 'sim', 'yes')
AND COALESCE(payload->>'dashboard_merged_into', '') = ''
AND COALESCE(payload->>'dashboard_excluido', '') != 'true'`;

const BASE_VOZUP_WHERE_TURMA = `(
  LOWER(COALESCE(payload->>'unidade_negocio', '')) LIKE '%voz%'
  OR LOWER(COALESCE(payload->>'origem', '')) LIKE '%vozup%'
  OR LOWER(COALESCE(payload->>'origem', '')) LIKE '%voz up%'
  OR LOWER(COALESCE(payload->>'lead_setor', '')) LIKE '%voz%'
)
AND LOWER(TRIM(COALESCE(payload->>'_final', ''))) IN ('true', '1', 'sim', 'yes')
AND COALESCE(payload->>'dashboard_excluido', '') != 'true'`;

async function getAulaExperimentalTurmas(): Promise<VozupSource[]> {
  const pool = getPool();
  const origensLike = AULA_EXPERIMENTAL_ORIGENS.map(
    (o) => `LOWER(COALESCE(payload->>'origem', '')) = LOWER('${o.replace(/'/g, "''")}')`
  ).join(" OR ");

  const result = await pool.query<{ turma: string; total: string; semana: string; mes: string }>(`
    WITH base AS (
      SELECT
        COALESCE(NULLIF(TRIM(payload->>'data_treinamento'), ''), 'Sem turma') AS turma,
        CASE
          WHEN LENGTH(REGEXP_REPLACE(
            COALESCE(NULLIF(TRIM(payload->>'telefone'), ''), NULLIF(TRIM(payload->>'whatsapp'), '')),
            '\\D', '', 'g'
          )) >= 10
            THEN 'phone:' || REGEXP_REPLACE(
              COALESCE(NULLIF(TRIM(payload->>'telefone'), ''), NULLIF(TRIM(payload->>'whatsapp'), '')),
              '\\D', '', 'g'
            )
          WHEN LOWER(TRIM(COALESCE(payload->>'email', ''))) LIKE '%@%'
            THEN 'email:' || LOWER(TRIM(payload->>'email'))
          ELSE 'row:' || id::text
        END AS person_key,
        criado_em
      FROM inscricoes.inscricoes
      WHERE (${origensLike})
        AND LOWER(TRIM(COALESCE(payload->>'_final', ''))) IN ('true', '1', 'sim', 'yes')
        AND COALESCE(payload->>'dashboard_excluido', '') != 'true'
    ),
    unique_leads AS (
      SELECT DISTINCT ON (person_key, turma) turma, criado_em
      FROM base
      ORDER BY person_key, turma, criado_em DESC
    )
    SELECT
      turma,
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE criado_em >= NOW() - INTERVAL '7 days')::text AS semana,
      COUNT(*) FILTER (WHERE criado_em >= NOW() - INTERVAL '30 days')::text AS mes
    FROM unique_leads
    WHERE turma LIKE 'Aula Experimental %' OR turma LIKE 'Aula Exclusiva %'
    GROUP BY turma
    ORDER BY turma DESC
  `);

  return result.rows.map((row) => ({
    key: `aula-experimental::${row.turma}`,
    label: row.turma,
    emoji: "🧪",
    origens: AULA_EXPERIMENTAL_ORIGENS,
    dataTreinamento: row.turma,
    total: Number(row.total),
    semana: Number(row.semana),
    mes: Number(row.mes),
  }));
}

async function getSourceStats(): Promise<VozupSource[]> {
  const pool = getPool();

  // Deduplicate by person (same logic as CRM): phone > email > row id.
  // This ensures the count here matches what the CRM shows.
  const result = await pool.query<{
    origem: string;
    total: string;
    semana: string;
    mes: string;
  }>(`
    WITH unique_leads AS (
      SELECT DISTINCT ON (
        CASE
          WHEN LENGTH(REGEXP_REPLACE(
            COALESCE(NULLIF(TRIM(payload->>'telefone'), ''), NULLIF(TRIM(payload->>'whatsapp'), '')),
            '\\D', '', 'g'
          )) >= 10
            THEN 'phone:' || REGEXP_REPLACE(
              COALESCE(NULLIF(TRIM(payload->>'telefone'), ''), NULLIF(TRIM(payload->>'whatsapp'), '')),
              '\\D', '', 'g'
            )
          WHEN LOWER(TRIM(COALESCE(payload->>'email', ''))) LIKE '%@%'
            THEN 'email:' || LOWER(TRIM(payload->>'email'))
          ELSE 'row:' || id::text
        END,
        LOWER(TRIM(COALESCE(payload->>'origem', '')))
      )
      id,
      COALESCE(NULLIF(TRIM(payload->>'origem'), ''), 'Sem origem') AS origem,
      criado_em
      FROM inscricoes.inscricoes
      WHERE ${BASE_VOZUP_WHERE}
      ORDER BY
        CASE
          WHEN LENGTH(REGEXP_REPLACE(
            COALESCE(NULLIF(TRIM(payload->>'telefone'), ''), NULLIF(TRIM(payload->>'whatsapp'), '')),
            '\\D', '', 'g'
          )) >= 10
            THEN 'phone:' || REGEXP_REPLACE(
              COALESCE(NULLIF(TRIM(payload->>'telefone'), ''), NULLIF(TRIM(payload->>'whatsapp'), '')),
              '\\D', '', 'g'
            )
          WHEN LOWER(TRIM(COALESCE(payload->>'email', ''))) LIKE '%@%'
            THEN 'email:' || LOWER(TRIM(payload->>'email'))
          ELSE 'row:' || id::text
        END,
        LOWER(TRIM(COALESCE(payload->>'origem', ''))),
        criado_em DESC
    )
    SELECT
      origem,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE criado_em >= NOW() - INTERVAL '7 days') AS semana,
      COUNT(*) FILTER (WHERE criado_em >= NOW() - INTERVAL '30 days') AS mes
    FROM unique_leads
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

const SORT_COLUMNS: Record<string, string> = {
  nome: "LOWER(COALESCE(NULLIF(TRIM(payload->>'nome'), ''), NULLIF(TRIM(payload->>'name'), ''), 'zzz'))",
  telefone: "COALESCE(NULLIF(TRIM(payload->>'telefone'), ''), '')",
  cidade: "LOWER(COALESCE(NULLIF(TRIM(payload->>'cidade'), ''), 'zzz'))",
  criado_em: "criado_em",
};

async function listLeadsBySource(
  sourceKey: string,
  opts: {
    search?: string;
    page?: number;
    dataTreinamento?: string;
    sort?: string;
    dir?: string;
    subOrigem?: string | null;
    subCriativo?: string | null;
  },
  allSources?: VozupSource[]
): Promise<{ leads: VozupLead[]; total: number }> {
  const pool = getPool();
  const src = (allSources ?? []).find((s) => s.key === sourceKey)
    ?? VOZUP_SOURCES.find((s) => s.key === sourceKey);
  if (!src) return { leads: [], total: 0 };

  const page = Math.max(1, opts.page ?? 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Quando um sub-filtro está ativo (ex: "Advogados"), restringe pela origem exata.
  // Caso contrário usa todas as origens do source.
  const origensParaFiltrar = opts.subOrigem
    ? [opts.subOrigem]
    : src.origens;

  const originConditions = origensParaFiltrar
    .map((o) => `LOWER(COALESCE(payload->>'origem', '')) = LOWER('${o.replace(/'/g, "''")}')`)
    .join(" OR ");

  // Verifica também origens acumuladas de mesclagens anteriores.
  // Ex: um lead que entrou pelo Workshop e depois pela Landing Page ainda
  // aparece na aba "Landing Page VozUP" via dashboard_origens_adicionais.
  const extraOriginsConditions = origensParaFiltrar
    .map((o) => `COALESCE(payload->>'dashboard_origens_adicionais', '') ILIKE '%${o.replace(/'/g, "''")}%'`)
    .join(" OR ");

  const dataTreinamento = opts.dataTreinamento ?? src.dataTreinamento;
  const treinamentoClause = dataTreinamento
    ? `AND TRIM(COALESCE(payload->>'data_treinamento', '')) = '${dataTreinamento.replace(/'/g, "''")}'`
    : "";

  // Sub-filtro por criativo, disponível apenas no card "Formulário Meta (Tráfego Pago)".
  const criativoClause = opts.subCriativo
    ? `AND COALESCE(NULLIF(TRIM(payload->>'ad_name'), ''), 'Sem criativo identificado') = '${opts.subCriativo.replace(/'/g, "''")}'`
    : "";

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
      COALESCE(NULLIF(TRIM(payload->>'email'), ''), '') AS email,
      COALESCE(NULLIF(TRIM(payload->>'objetivo'), ''), NULLIF(TRIM(payload->>'interesse_workshop'), ''), '') AS objetivo,
      COALESCE(NULLIF(TRIM(payload->>'origem'), ''), '') AS origem,
      COALESCE(NULLIF(TRIM(payload->>'cidade'), ''), '') AS cidade,
      COALESCE(payload->>'timestamp', criado_em::text) AS criado_em,
      COUNT(*) OVER () AS total
    FROM inscricoes.inscricoes
    WHERE ${dataTreinamento ? BASE_VOZUP_WHERE_TURMA : BASE_VOZUP_WHERE}
      AND ((${originConditions}) OR (${extraOriginsConditions}))
      ${treinamentoClause}
      ${criativoClause}
      ${searchClause}
    ORDER BY ${SORT_COLUMNS[opts.sort ?? ""] ?? SORT_COLUMNS.criado_em} ${opts.dir === "asc" ? "ASC" : "DESC"}, id DESC
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
          href={`/vozup?fonte=${encodeURIComponent(src.key)}`}
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
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (session?.user.institutoUpOnly) {
    redirect("/");
  }

  const resolved = await Promise.resolve(searchParams);
  const fonte = pick(resolved.fonte);
  const search = pick(resolved.q) || undefined;
  const page = Number(pick(resolved.page)) || 1;
  const sort = pick(resolved.sort) || undefined;
  const dir = pick(resolved.dir) === "asc" ? "asc" : "desc";
  const rawSub = pick(resolved.sub);
  const activeSub = (LANDING_SUB_SOURCES.find((s) => s.key === rawSub)?.key ?? "all") as LandingSubKey;
  const activeSubSource = LANDING_SUB_SOURCES.find((s) => s.key === activeSub)!;
  const activeCriativo = pick(resolved.criativo) || undefined;

  const aulaExperimentalTurmas = await getAulaExperimentalTurmas();
  const allSources = [...VOZUP_SOURCES.map((s) => ({ ...s, total: 0, semana: 0, mes: 0 })), ...aulaExperimentalTurmas];

  const activeSource = allSources.find((s) => s.key === fonte);

  // Table view (fonte selected)
  if (activeSource) {
    const subOrigem = activeSource.key === "landing" && activeSubSource.origemExata
      ? activeSubSource.origemExata
      : null;
    const subCriativo = activeSource.key === "meta-ads" ? activeCriativo ?? null : null;
    const [{ leads, total }, trainingOptions, recruiterOptions, creativeOptions] = await Promise.all([
      listLeadsBySource(activeSource.key, { search, page, sort, dir, subOrigem, subCriativo }, allSources),
      listTrainingFilterOptions(),
      listRecruitersWithDbNames(),
      activeSource.key === "meta-ads" ? getMetaAdsCreativeOptions() : Promise.resolve([]),
    ]);
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

        {/* Sub-filtro por Landing Page (visível apenas no fonte=landing) */}
        {activeSource.key === "landing" && (
          <div className="flex flex-wrap gap-2">
            {LANDING_SUB_SOURCES.map((sub) => {
              const isActive = activeSub === sub.key;
              const href = `/vozup?fonte=landing${sub.key !== "all" ? `&sub=${sub.key}` : ""}`;
              return (
                <a
                  key={sub.key}
                  href={href}
                  className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold transition ${
                    isActive
                      ? "bg-[#6d28d9] text-white"
                      : "border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] text-[rgb(var(--slate-10))] hover:bg-[rgba(var(--alpha-2))] hover:text-[rgb(var(--slate-12))]"
                  }`}
                >
                  {sub.label}
                </a>
              );
            })}
          </div>
        )}

        {/* Sub-filtro por Criativo (visível apenas no fonte=meta-ads) */}
        {activeSource.key === "meta-ads" && creativeOptions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <a
              href="/vozup?fonte=meta-ads"
              className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold transition ${
                !activeCriativo
                  ? "bg-[#6d28d9] text-white"
                  : "border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] text-[rgb(var(--slate-10))] hover:bg-[rgba(var(--alpha-2))] hover:text-[rgb(var(--slate-12))]"
              }`}
            >
              Todos os criativos
            </a>
            {creativeOptions.map((opt) => {
              const isActive = activeCriativo === opt.value;
              return (
                <a
                  key={opt.value}
                  href={`/vozup?fonte=meta-ads&criativo=${encodeURIComponent(opt.value)}`}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition ${
                    isActive
                      ? "bg-[#6d28d9] text-white"
                      : "border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] text-[rgb(var(--slate-10))] hover:bg-[rgba(var(--alpha-2))] hover:text-[rgb(var(--slate-12))]"
                  }`}
                >
                  {opt.value}
                  <span className={isActive ? "text-white/70" : "text-[rgb(var(--slate-9))]"}>
                    {opt.count}
                  </span>
                </a>
              );
            })}
          </div>
        )}

        {/* Search */}
        <form method="GET" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="fonte" value={activeSource.key} />
          {activeSource.key === "landing" && activeSub !== "all" && (
            <input type="hidden" name="sub" value={activeSub} />
          )}
          {activeSource.key === "meta-ads" && activeCriativo && (
            <input type="hidden" name="criativo" value={activeCriativo} />
          )}
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
              href={`/vozup?fonte=${activeSource.key}${activeSource.key === "landing" && activeSub !== "all" ? `&sub=${activeSub}` : ""}${activeSource.key === "meta-ads" && activeCriativo ? `&criativo=${encodeURIComponent(activeCriativo)}` : ""}`}
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
          sort={sort}
          dir={dir}
          trainingOptions={trainingOptions}
          recruiterOptions={recruiterOptions}
        />
      </main>
    );
  }

  // Overview cards
  const staticSources = await getSourceStats();
  const sources = [...staticSources, ...aulaExperimentalTurmas];
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
