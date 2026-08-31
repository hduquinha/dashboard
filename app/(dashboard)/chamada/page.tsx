import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { listLessonsInRange } from "@/lib/academicClasses";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Chamada • Dashboard",
  description: "Aulas do dia e presenca dos alunos.",
};

const WEEKDAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function isoOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return isoOf(date);
}

function formatDayLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${WEEKDAY[weekday]}, ${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
}

/**
 * Chamada do dia — a porta de entrada do diário.
 *
 * O diário mora dentro da turma, e isso serve para consultar. Para LANÇAR não
 * serve: quem vai marcar presença pensa em "as aulas de hoje", não em "a turma
 * de quarta". Esta tela junta as aulas de todas as turmas do dia, diz quais
 * ainda estão sem chamada e leva direto para a aula certa.
 *
 * É renderizada no servidor de propósito: são links e uma consulta, e a data
 * viaja na URL — assim o link de um dia específico pode ser mandado para o
 * professor no WhatsApp.
 */
export default async function ChamadaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session || !hasPermission(session.user, "view.classes")) {
    redirect("/");
  }

  const params = await searchParams;
  const rawDay = Array.isArray(params.dia) ? params.dia[0] : params.dia;
  const day = rawDay && /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : isoOf(new Date());
  const semana = (Array.isArray(params.modo) ? params.modo[0] : params.modo) === "semana";
  const to = semana ? shiftDays(day, 6) : day;

  const lessons = await listLessonsInRange(day, to);
  const pendentes = lessons.filter(
    (lesson) => lesson.marked === 0 && lesson.status !== "cancelada"
  ).length;

  const linkFor = (targetDay: string, targetMode: boolean) =>
    `/chamada?dia=${targetDay}${targetMode ? "&modo=semana" : ""}`;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-[rgb(var(--slate-12))]">Chamada</h1>
          <p className="text-xs text-[rgb(var(--slate-9))]">
            {semana ? "Aulas dos próximos 7 dias" : `Aulas de ${formatDayLabel(day)}`} ·{" "}
            {lessons.length} aula(s)
            {pendentes > 0 ? ` · ${pendentes} sem chamada` : " · tudo lançado"}
          </p>
        </div>

        <nav className="flex items-center gap-1">
          <Link
            href={linkFor(shiftDays(day, -1), semana)}
            aria-label="Dia anterior"
            className="grid h-8 w-8 place-items-center rounded-lg border border-[rgb(var(--border-weak))] text-[rgb(var(--slate-11))]"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <Link
            href={linkFor(isoOf(new Date()), false)}
            className="inline-flex h-8 items-center rounded-lg border border-[rgb(var(--border-weak))] px-3 text-xs font-semibold text-[rgb(var(--slate-11))]"
          >
            Hoje
          </Link>
          <Link
            href={linkFor(shiftDays(day, 1), semana)}
            aria-label="Próximo dia"
            className="grid h-8 w-8 place-items-center rounded-lg border border-[rgb(var(--border-weak))] text-[rgb(var(--slate-11))]"
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
          <Link
            href={linkFor(day, !semana)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold ${
              semana
                ? "bg-[rgb(var(--slate-12))] text-white"
                : "border border-[rgb(var(--border-weak))] text-[rgb(var(--slate-11))]"
            }`}
          >
            <CalendarDays className="h-3.5 w-3.5" /> Semana
          </Link>
        </nav>
      </header>

      {lessons.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-[rgb(var(--border-weak))] p-10 text-center text-xs text-[rgb(var(--slate-9))]">
          Nenhuma aula {semana ? "nos próximos 7 dias" : "neste dia"}. As aulas vêm do quadro de cada
          turma — se faltar alguma, gere o quadro em Turmas → Grade e aulas.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {lessons.map((lesson) => {
            const total = lesson.activeStudents + lesson.visitors;
            const lançada = lesson.marked > 0;
            return (
              <li key={lesson.lessonId}>
                <Link
                  href={`/turmas?turma=${lesson.classId}&aba=diario&aula=${lesson.lessonId}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-3 hover:border-[rgb(var(--slate-9))]"
                >
                  <span className="flex w-16 flex-none flex-col text-[11px] text-[rgb(var(--slate-9))]">
                    {semana ? (
                      <span className="font-semibold text-[rgb(var(--slate-12))]">
                        {formatDayLabel(lesson.date).split(",")[1]?.trim()}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {lesson.startTime ?? "—"}
                    </span>
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-[rgb(var(--slate-12))]">
                      {lesson.className}
                    </span>
                    <span className="block truncate text-[11px] text-[rgb(var(--slate-9))]">
                      {lesson.status === "reposicao" ? "Reposição" : `Aula ${lesson.sequence}`}
                      {lesson.courseName ? ` · ${lesson.courseName}` : ""}
                      {lesson.teacherName ? ` · ${lesson.teacherName}` : ""}
                      {lesson.roomName ? ` · ${lesson.roomName}` : ""}
                      {lesson.visitors > 0 ? ` · ${lesson.visitors} em reposição` : ""}
                    </span>
                  </span>

                  {lesson.status === "cancelada" ? (
                    <span className="flex-none rounded-md bg-neutral-200 px-2 py-1 text-[11px] font-bold text-neutral-600">
                      cancelada
                    </span>
                  ) : lançada ? (
                    <span className="inline-flex flex-none items-center gap-1 rounded-md bg-emerald-100 px-2 py-1 text-[11px] font-bold text-emerald-800">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {lesson.presentes} de {lesson.marked} presentes
                    </span>
                  ) : (
                    <span className="flex-none rounded-md bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-900">
                      lançar chamada · {total} aluno(s)
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
