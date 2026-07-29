import type { Metadata } from "next";
import { cookies } from "next/headers";
import DistributionClient from "./DistributionClient";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { getCommercialWorkspace } from "@/lib/commercial";
import {
  type ManualDistributionFolderOption,
  listManualDistributionCandidates,
  normalizeManualDistributionFilters,
} from "@/lib/manualDistribution";
import { listTrainingFilterOptions, listRecruitersWithDbNames } from "@/lib/db";
import { listVozupBlockStats, VOZUP_FOLDERS } from "@/lib/vozupFolders";
import { hasPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Chegada de Leads - CRM",
  description: "Novos leads do Meta e das landing pages, prontos para distribuir.",
};

interface DistributionPageProps {
  searchParams:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>;
}

function flattenSearchParams(
  searchParams: Record<string, string | string[] | undefined>
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      flat[key] = value[value.length - 1];
    } else {
      flat[key] = value;
    }
  }
  return flat;
}

function parseLimit(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return 120;
  return Math.max(1, Math.min(500, parsed));
}

function buildFolderOptions(
  stats: Awaited<ReturnType<typeof listVozupBlockStats>>
): ManualDistributionFolderOption[] {
  return VOZUP_FOLDERS.map((folder) => {
    const blocks = stats
      .filter((item) => item.folderKey === folder.key)
      .map((item) => ({
        bloco: item.bloco,
        subpasta: item.subpasta,
        total: item.total,
        semana: item.semana,
        mes: item.mes,
        ultimaConversao: item.ultimaConversao,
      }));

    return {
      key: folder.key,
      label: folder.label,
      emoji: folder.emoji,
      description: folder.description,
      blocks,
    };
  }).filter((folder) => folder.blocks.length > 0);
}

export default async function DistributionPage(props: DistributionPageProps) {
  const [cookieStore, rawSearchParams, trainingOptions, recruiterOptions] = await Promise.all([
    cookies(),
    props.searchParams,
    listTrainingFilterOptions(),
    listRecruitersWithDbNames(),
  ]);
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  const commercial = await getCommercialWorkspace(session?.user ?? null);
  const flatParams = flattenSearchParams(rawSearchParams);
  const filters = normalizeManualDistributionFilters(flatParams);
  const limit = parseLimit(flatParams.limit);
  const [candidateResult, folderOptions] = commercial.isSupervisor
    ? await Promise.all([
        listManualDistributionCandidates(filters, limit),
        listVozupBlockStats().then(buildFolderOptions),
      ])
    : [{ candidates: [], total: 0, limit }, [] as ManualDistributionFolderOption[]];
  const sellers = commercial.sellers
    .filter((seller) => seller.email && seller.name)
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));

  return (
    <DistributionClient
      candidates={candidateResult.candidates}
      total={candidateResult.total}
      limit={candidateResult.limit}
      filters={filters}
      folderOptions={folderOptions}
      sellers={sellers}
      trainingOptions={trainingOptions}
      recruiterOptions={recruiterOptions}
      isSupervisor={commercial.isSupervisor}
      canAddArrival={Boolean(session && hasPermission(session.user, "distribution.add_lead"))}
      currentUser={
        session ? { email: session.user.email, isSupervisor: commercial.isSupervisor } : null
      }
      profileUser={session?.user ?? null}
    />
  );
}
