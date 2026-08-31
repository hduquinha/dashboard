import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import ProducaoClient from "./ProducaoClient";

export const metadata: Metadata = {
  title: "Produção • Tarefas",
  description: "Produção registrada nas rotinas do Kanban, por período, usuário e tarefa.",
};

export const dynamic = "force-dynamic";

/**
 * Reusa a permissão `view.tasks` do módulo — o recorte de QUEM cada um enxerga
 * (só a própria produção, ou a da equipe) é aplicado na API, não aqui.
 */
export default async function ProducaoPage() {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (session && !hasPermission(session.user, "view.tasks")) redirect("/");

  return <ProducaoClient />;
}
