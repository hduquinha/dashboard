import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AuditoriaClient from "./AuditoriaClient";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { getAuditFilterOptions } from "@/lib/auditLog";
import { hasPermission } from "@/lib/permissions";

export const metadata: Metadata = {
  title: "Registro de Auditoria",
  description: "Histórico completo de mudanças em qualquer lead — quem alterou, o quê e quando.",
};

export const dynamic = "force-dynamic";

export default async function AuditoriaPage() {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (session && !hasPermission(session.user, "admin.audit")) {
    redirect("/");
  }

  const options = await getAuditFilterOptions();

  return <AuditoriaClient options={options} />;
}
