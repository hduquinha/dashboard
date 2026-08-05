import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getBoardData, userCanAccessBoard } from "@/lib/tasks";
import { listTeamMembers } from "@/lib/teamAuth";
import TaskPdfReport from "./TaskPdfReport";

export const metadata: Metadata = { title: "Relatório de tarefas" };
export const dynamic = "force-dynamic";

export default async function TaskReportPage({ searchParams }: { searchParams: Promise<{ board?: string }> }) {
  const boardId = Number((await searchParams).board);
  if (!Number.isInteger(boardId) || boardId <= 0) notFound();

  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (session && !hasPermission(session.user, "view.tasks")) redirect("/");
  if (!(await userCanAccessBoard(session?.user ?? null, boardId))) notFound();

  const [board, members] = await Promise.all([getBoardData(boardId), listTeamMembers({ activeOnly: false })]);
  if (!board) notFound();

  return <TaskPdfReport board={board} members={members.map((member) => ({ id: member.id, name: member.name }))} />;
}
