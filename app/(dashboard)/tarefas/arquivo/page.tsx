import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getTaskArchiveScope, listArchiveMonths } from "@/lib/tasksArchive";
import { listTeamMembers } from "@/lib/teamAuth";
import ArquivoClient from "./ArquivoClient";

export const metadata: Metadata = {
  title: "Arquivo mensal de tarefas",
  description: "Tarefas concluídas guardadas por mês, fora do kanban.",
};

export const dynamic = "force-dynamic";

export default async function TaskArchivePage() {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (session && !hasPermission(session.user, "view.tasks")) redirect("/");

  const scope = await getTaskArchiveScope(session?.user ?? null);
  const [months, members] = await Promise.all([
    listArchiveMonths(scope),
    listTeamMembers({ activeOnly: false }),
  ]);

  return (
    <ArquivoClient
      boards={scope.boards}
      months={months}
      members={members.map((member) => ({ id: member.id, name: member.name }))}
    />
  );
}
