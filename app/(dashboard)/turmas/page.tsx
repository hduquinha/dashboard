import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { listCalendarDays, listClasses, listRooms, listTeacherOptions } from "@/lib/academicClasses";
import { listStudents, listUnlinkedAcademicEnrollments } from "@/lib/academicStudents";
import { listTrainingCatalog } from "@/lib/trainingCatalog";
import { TurmasClient } from "./TurmasClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Turmas • Dashboard",
  description: "Turmas, grade de horario, sala e alunos alocados.",
};

export default async function TurmasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);

  if (!session || !hasPermission(session.user, "view.classes")) {
    redirect("/");
  }

  // A fila de contratos sem ficha só é carregada para quem pode cadastrar aluno: é
  // dado de outra área (Financeiro + cadastro), não da grade de horário.
  const canManageStudents = hasPermission(session.user, "students.manage");
  const [classes, rooms, calendarDays, students, unlinkedEnrollments, courses, teacherOptions] =
    await Promise.all([
      listClasses(),
      listRooms(),
      listCalendarDays(),
      listStudents(),
      canManageStudents ? listUnlinkedAcademicEnrollments().catch(() => []) : Promise.resolve([]),
      // Curso e professores entraram no cadastro da turma: o curso diz quantas
      // aulas o quadro terá, e a turma passou a aceitar titular + auxiliares.
      listTrainingCatalog().catch(() => []),
      // Professores = usuários marcados como professor em /usuarios.
      listTeacherOptions().catch(() => []),
    ]);

  // `?turma=` abre direto a turma escolhida: é o link que a coordenação manda para o
  // professor e o que faz o botão "voltar" do navegador devolver a mesma tela.
  const params = await searchParams;
  const rawClassId = Array.isArray(params.turma) ? params.turma[0] : params.turma;
  const parsedClassId = Number.parseInt(rawClassId ?? "", 10);
  const initialClassId =
    Number.isFinite(parsedClassId) && classes.some((turma) => turma.id === parsedClassId) ? parsedClassId : null;

  // `?aba=diario&aula=` é o link da tela de Chamada: abre a turma já no diário,
  // na aula que a pessoa clicou.
  const rawTab = Array.isArray(params.aba) ? params.aba[0] : params.aba;
  const rawLessonId = Array.isArray(params.aula) ? params.aula[0] : params.aula;
  const parsedLessonId = Number.parseInt(rawLessonId ?? "", 10);

  return (
    <TurmasClient
      initialClasses={classes}
      initialRooms={rooms}
      initialCalendarDays={calendarDays}
      initialClassId={initialClassId}
      initialTab={rawTab === "diario" ? "diario" : null}
      initialLessonId={Number.isFinite(parsedLessonId) && parsedLessonId > 0 ? parsedLessonId : null}
      unlinkedEnrollments={unlinkedEnrollments}
      students={students.map((student) => ({
        id: student.id,
        name: student.fullName,
        cpf: student.cpf,
        phone: student.phone,
        activeClasses: student.classes
          .filter((link) => link.status === "ativa")
          .map((link) => ({ classId: link.classId, className: link.className })),
        contractsCount: student.contractsCount,
      }))}
      courses={courses
        .filter((course) => course.active)
        .map((course) => ({
          id: course.id,
          name: course.name,
          lessonsCount: course.lessonsCount,
          lessonsPerWeek: course.lessonsPerWeek,
        }))}
      teachers={teacherOptions}
      canManage={hasPermission(session.user, "classes.manage")}
      canManageStudents={canManageStudents}
      canDeleteStudents={hasPermission(session.user, "students.delete")}
    />
  );
}
