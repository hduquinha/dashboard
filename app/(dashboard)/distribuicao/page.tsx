import type { Metadata } from "next";
import { cookies } from "next/headers";
import DistributionClient from "./DistributionClient";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { getCommercialWorkspace } from "@/lib/commercial";
import {
  listManualDistributionCandidates,
  normalizeManualDistributionFilters,
} from "@/lib/manualDistribution";
import { listTrainingFilterOptions } from "@/lib/db";

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

export default async function DistributionPage(props: DistributionPageProps) {
  const [cookieStore, rawSearchParams, trainingOptions] = await Promise.all([
    cookies(),
    props.searchParams,
    listTrainingFilterOptions(),
  ]);
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  const commercial = await getCommercialWorkspace(session?.user ?? null);
  const flatParams = flattenSearchParams(rawSearchParams);
  const filters = normalizeManualDistributionFilters(flatParams);
  const limit = parseLimit(flatParams.limit);
  const candidateResult = commercial.isSupervisor
    ? await listManualDistributionCandidates(filters, limit)
    : { candidates: [], total: 0, limit };
  const sellers = commercial.sellers
    .filter((seller) => seller.email && seller.name)
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));

  return (
    <DistributionClient
      candidates={candidateResult.candidates}
      total={candidateResult.total}
      limit={candidateResult.limit}
      filters={filters}
      sellers={sellers}
      trainingOptions={trainingOptions}
      isSupervisor={commercial.isSupervisor}
      currentUser={
        session ? { email: session.user.email, isSupervisor: commercial.isSupervisor } : null
      }
    />
  );
}
