import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import TarefasClient from "./TarefasClient";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission, isSuperMaster } from "@/lib/permissions";
import { listSectorsForUser, listTeams } from "@/lib/tasks";
import { listTeamMembers } from "@/lib/teamAuth";

export const metadata: Metadata = {
  title: "Tarefas",
  description: "Setores, quadros kanban e tarefas da equipe.",
};

export const dynamic = "force-dynamic";

export default async function TarefasPage() {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (session && !hasPermission(session.user, "view.tasks")) {
    redirect("/");
  }
  const isAdmin = !session || hasPermission(session.user, "tasks.admin");
  // Só o super master monta setores/equipes (quem vê o quê). Admin comum segue
  // podendo criar quadros e colunas dentro das áreas que enxerga.
  const isMaster = !session || isSuperMaster(session.user);

  const [sectors, teams, members] = await Promise.all([
    listSectorsForUser(session?.user ?? null),
    isMaster ? listTeams() : Promise.resolve([]),
    listTeamMembers({ activeOnly: true }),
  ]);

  return (
    <TarefasClient
      initialSectors={sectors}
      teams={teams}
      members={members.map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role }))}
      isAdmin={isAdmin}
      isMaster={isMaster}
    />
  );
}
