import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import UserAdminClient, { type AdminTeamMember } from "./UserAdminClient";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { listTeamMembers } from "@/lib/teamAuth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Usuarios • Dashboard",
  description: "Administracao de usuarios e permissoes.",
};

export default async function UsuariosPage() {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);

  if (!session || !hasPermission(session.user, "admin.users")) {
    redirect("/");
  }

  const members = await listTeamMembers();
  const initialMembers: AdminTeamMember[] = members
    .map((member) => ({
      id: member.id,
      email: member.email,
      name: member.name,
      role: member.role,
      active: member.active,
      priorityLevel: member.priorityLevel,
      permissions: member.permissions,
      institutoUpOnly: member.institutoUpOnly,
    }))
    .sort((a, b) => b.priorityLevel - a.priorityLevel || a.name.localeCompare(b.name));

  return (
    <UserAdminClient
      initialMembers={initialMembers}
      currentUserId={session.user.id}
    />
  );
}
