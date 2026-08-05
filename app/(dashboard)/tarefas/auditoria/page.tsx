import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getTaskAuditFilterOptions, getTaskAuditScope } from "@/lib/tasksAudit";
import TaskAuditClient from "./TaskAuditClient";

export const metadata: Metadata = {
  title: "Auditoria de tarefas",
  description: "Histórico consolidado de mudanças nos cards e quadros de tarefas.",
};

export const dynamic = "force-dynamic";

export default async function TaskAuditPage() {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (session && !hasPermission(session.user, "view.tasks")) redirect("/");

  const scope = await getTaskAuditScope(session?.user ?? null);
  const options = await getTaskAuditFilterOptions(scope);
  return <TaskAuditClient options={options} />;
}
