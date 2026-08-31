import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import {
  getAcademicRegistrationRules,
  getRosterSummary,
  listStudents,
  listUnlinkedAcademicEnrollments,
} from "@/lib/academicStudents";
import { listClasses } from "@/lib/academicClasses";
import { AlunosClient } from "./AlunosClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Alunos • Dashboard",
  description: "Alunos matriculados, responsavel legal e alocacao em turma.",
};

export default async function AlunosPage() {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);

  if (!session || !hasPermission(session.user, "view.students")) {
    redirect("/");
  }

  const [students, classes, roster, registrationRules, unlinkedEnrollments] = await Promise.all([
    listStudents(),
    listClasses(),
    getRosterSummary(),
    getAcademicRegistrationRules(),
    listUnlinkedAcademicEnrollments(),
  ]);

  return (
    <AlunosClient
      initialStudents={students}
      classes={classes.map((turma) => ({ id: turma.id, name: turma.name, seatsLeft: turma.seatsLeft }))}
      roster={roster}
      initialRegistrationRules={registrationRules}
      initialUnlinkedEnrollments={unlinkedEnrollments}
      canManage={hasPermission(session.user, "students.manage")}
      canDelete={hasPermission(session.user, "students.delete")}
      canViewFinance={hasPermission(session.user, "view.finance")}
    />
  );
}
