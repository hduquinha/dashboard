import type { Metadata } from "next";
import { cookies } from "next/headers";
import ProductivityClient from "./ProductivityClient";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { getCommercialWorkspace } from "@/lib/commercial";
import { listRecruitersWithDbNames, listTrainingFilterOptions } from "@/lib/db";
import { getProductivityWorkspace } from "@/lib/productivity";
import { ttlCache } from "@/lib/serverCache";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Kanban • Dashboard",
  description: "Kanban de leads da equipe, diario de bordo e fechamento diario.",
};

interface ProductivityPageProps {
  searchParams:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>;
}

function pickDate(value: string | string[] | undefined): string | null {
  const candidate = (Array.isArray(value) ? value[0] : value) ?? null;
  return candidate && /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null;
}

export default async function ProductivityPage(props: ProductivityPageProps) {
  const [cookieStore, searchParams] = await Promise.all([cookies(), props.searchParams]);
  const token = cookieStore.get(DASHBOARD_COOKIE_NAME)?.value;
  const session = getDashboardSession(token);
  const [workspace, commercial, trainingOptions, recruiterOptions] = await Promise.all([
    getProductivityWorkspace(session?.user ?? null, {
      dateFrom: pickDate(searchParams?.dateFrom),
      dateTo: pickDate(searchParams?.dateTo),
    }),
    getCommercialWorkspace(session?.user ?? null),
    ttlCache("dashboard:training-options", 60_000, () => listTrainingFilterOptions()),
    ttlCache("dashboard:recruiter-options", 60_000, () => listRecruitersWithDbNames()),
  ]);

  return (
    <ProductivityClient
      initialWorkspace={workspace}
      commercial={commercial}
      trainingOptions={trainingOptions}
      recruiterOptions={recruiterOptions}
      currentUser={
        session
          ? {
              email: session.user.email,
              isSupervisor: commercial.isSupervisor,
              role: session.user.role,
              permissions: session.user.permissions,
              institutoUpOnly: session.user.institutoUpOnly,
            }
          : null
      }
    />
  );
}
