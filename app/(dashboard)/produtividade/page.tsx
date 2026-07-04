import type { Metadata } from "next";
import { cookies } from "next/headers";
import ProductivityClient from "./ProductivityClient";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { getProductivityWorkspace } from "@/lib/productivity";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Produtividade • Dashboard",
  description: "Diario de bordo, fechamento diario e distribuicao de leads.",
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
  const workspace = await getProductivityWorkspace(session?.user ?? null, {
    dateFrom: pickDate(searchParams?.dateFrom),
    dateTo: pickDate(searchParams?.dateTo),
  });

  return <ProductivityClient initialWorkspace={workspace} />;
}
