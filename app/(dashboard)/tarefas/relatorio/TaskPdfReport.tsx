"use client";

import { Printer } from "lucide-react";
import type { BoardData, TaskCard } from "@/lib/tasks";

interface Member {
  id: number;
  name: string;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR");
}

function assigneeNames(task: TaskCard, memberById: Map<number, string>): string[] {
  return task.assigneeIds
    .map((id) => memberById.get(id))
    .filter((name): name is string => Boolean(name));
}

/** A leitura do relatório segue a prioridade operacional pedida pela equipe. */
function sortTasksByAssignee(tasks: TaskCard[], memberById: Map<number, string>): TaskCard[] {
  const priority = (task: TaskCard) => {
    const names = assigneeNames(task, memberById);
    if (names.includes("Lauro")) return 0;
    if (names.includes("Henrique")) return 1;
    return 2;
  };

  return [...tasks].sort((left, right) => {
    const byPriority = priority(left) - priority(right);
    if (byPriority !== 0) return byPriority;
    const byName = (assigneeNames(left, memberById)[0] ?? "Sem responsável").localeCompare(
      assigneeNames(right, memberById)[0] ?? "Sem responsável",
      "pt-BR"
    );
    return byName !== 0 ? byName : left.title.localeCompare(right.title, "pt-BR");
  });
}

export default function TaskPdfReport({ board, members }: { board: BoardData; members: Member[] }) {
  const memberById = new Map(members.map((member) => [member.id, member.name]));

  return (
    <main className="mx-auto max-w-[1600px] bg-slate-100 p-4 text-slate-900 sm:p-8 print:max-w-none print:bg-white print:p-0">
      <style jsx global>{`
        @page { size: landscape; margin: 10mm; }
      `}</style>
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 print:rounded-none print:p-0 print:shadow-none print:ring-0">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-700">Relatório de tarefas</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">{board.board.name}</h1>
            {board.board.description && <p className="mt-1 text-sm text-slate-600">{board.board.description}</p>}
            <p className="mt-2 text-xs text-slate-500">
              {board.tasks.length} {board.tasks.length === 1 ? "card" : "cards"} · gerado em {new Date().toLocaleDateString("pt-BR")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white hover:bg-slate-700 print:hidden"
          >
            <Printer className="size-4" /> Imprimir / Salvar como PDF
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4 print:grid-cols-4 print:gap-3">
          {board.columns.map((column) => {
            const tasks = sortTasksByAssignee(board.tasks.filter((task) => task.columnId === column.id), memberById);
            if (tasks.length === 0) return null;
            return (
              <section key={column.id} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/70 p-3 print:break-inside-auto print:p-2">
                <h2 className="mb-3 flex items-center gap-2 border-b border-slate-200 pb-2 text-sm font-black uppercase tracking-wide text-slate-800">
                  <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: column.color ?? "#64748b" }} />
                  <span className="min-w-0 truncate">{column.name}</span>
                  <span className="ml-auto shrink-0 font-semibold text-slate-400">({tasks.length})</span>
                </h2>
                <div className="grid gap-2">
                  {tasks.map((task) => {
                    const assignees = assigneeNames(task, memberById);
                    return (
                      <article
                        key={task.id}
                        className="break-inside-avoid rounded-xl border-2 border-slate-200 border-t-[4px] bg-white p-3 shadow-sm print:p-2 print:shadow-none"
                        style={{ borderTopColor: column.color ?? "#64748b" }}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <h3 className="text-[15px] font-black leading-5 text-slate-950">{task.title}</h3>
                          {task.completedAt && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Concluída em {formatDate(task.completedAt)}</span>}
                        </div>
                        <div className="mt-3 rounded-lg border border-cyan-100 bg-cyan-50 px-2.5 py-2 text-xs">
                          <p className="text-[10px] font-black uppercase tracking-wide text-cyan-700">Responsável</p>
                          <p className="mt-0.5 text-sm font-black text-slate-900">{assignees.join(", ") || "Sem responsável"}</p>
                        </div>
                        <p className="mt-2 text-xs text-slate-700"><span className="font-bold text-slate-600">Período:</span> {formatDate(task.startDate)} até {formatDate(task.dueDate)}</p>
                        <div className="mt-2 border-t border-slate-100 pt-2">
                          <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Descrição</p>
                          <p className="mt-1 whitespace-pre-wrap text-[13px] leading-5 text-slate-700">{task.description || "Sem descrição."}</p>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </section>
    </main>
  );
}
