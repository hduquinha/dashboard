"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CalendarClock,
  Check,
  FolderKanban,
  Globe,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type {
  BoardData,
  TaskBoard,
  TaskCard,
  TaskColumn,
  TaskLabel,
  TaskPriority,
  TaskSector,
  TaskTeam,
} from "@/lib/tasks";

interface Member {
  id: number;
  name: string;
  email: string;
  role?: string;
}
interface Props {
  initialSectors: TaskSector[];
  teams: TaskTeam[];
  members: Member[];
  /** Pode criar quadros e colunas dentro dos setores que enxerga. */
  isAdmin: boolean;
  /** Super master: único que monta setores/equipes e decide quem vê o quê. */
  isMaster: boolean;
}

const PRIORITY: Record<TaskPriority, { label: string; dot: string; chip: string }> = {
  baixa: { label: "Baixa", dot: "bg-slate-400", chip: "bg-slate-100 text-slate-600" },
  media: { label: "Média", dot: "bg-blue-500", chip: "bg-blue-100 text-blue-700" },
  alta: { label: "Alta", dot: "bg-amber-500", chip: "bg-amber-100 text-amber-700" },
  urgente: { label: "Urgente", dot: "bg-rose-500", chip: "bg-rose-100 text-rose-700" },
};

function initials(name: string): string {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

const DAY_MS = 86_400_000;

/**
 * Além de vencido, marca o que vence hoje/amanhã: avisar só depois do prazo não
 * ajuda ninguém a agir a tempo.
 */
function dueLabel(due: string | null): { text: string; tone: "overdue" | "soon" | "normal" } | null {
  if (!due) return null;
  const d = new Date(`${due}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / DAY_MS);
  const tone = days < 0 ? "overdue" : days <= 1 ? "soon" : "normal";
  const text =
    days === 0 ? "Hoje" : days === 1 ? "Amanhã" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return { text, tone };
}

const DUE_TONE: Record<"overdue" | "soon" | "normal", string> = {
  overdue: "bg-rose-50 text-rose-700",
  soon: "bg-amber-50 text-amber-700",
  normal: "text-slate-600",
};

export default function TarefasClient({ initialSectors, teams: initialTeams, members, isAdmin, isMaster }: Props) {
  const [sectors, setSectors] = useState<TaskSector[]>(initialSectors);
  const [teams, setTeams] = useState<TaskTeam[]>(initialTeams);
  const [sectorId, setSectorId] = useState<number | null>(initialSectors[0]?.id ?? null);
  const [boards, setBoards] = useState<TaskBoard[]>([]);
  const [boardId, setBoardId] = useState<number | null>(null);
  const [board, setBoard] = useState<BoardData | null>(null);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskCard | null>(null);
  const [modal, setModal] = useState<null | "sector" | "sector-edit" | "board" | "teams" | "labels">(null);

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  // Mouse e toque separados: no celular o arraste só começa com pressão longa
  // (250ms), senão qualquer tentativa de rolar a tela arrastaria um card.
  // Mesmo padrão já usado no kanban do CRM.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 12 } })
  );

  // Carrega quadros do setor selecionado
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (sectorId === null) {
        setBoards([]);
        setBoardId(null);
        return;
      }
      try {
        const d = await fetch(`/api/tasks/boards?sectorId=${sectorId}`).then((r) => r.json());
        if (cancelled) return;
        const list: TaskBoard[] = d.boards ?? [];
        setBoards(list);
        setBoardId((cur) => (list.some((b) => b.id === cur) ? cur : list[0]?.id ?? null));
      } catch {
        if (!cancelled) setBoards([]);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [sectorId]);

  const loadBoard = useCallback(async () => {
    if (boardId === null) {
      setBoard(null);
      return;
    }
    setLoadingBoard(true);
    try {
      const d = await fetch(`/api/tasks/boards/${boardId}`).then((r) => r.json());
      setBoard(d.board ? d : null);
    } catch {
      setBoard(null);
    } finally {
      setLoadingBoard(false);
    }
  }, [boardId]);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  function tasksInColumn(columnId: number): TaskCard[] {
    return (board?.tasks ?? [])
      .filter((t) => t.columnId === columnId)
      .sort((a, b) => a.position - b.position);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || !board) return;
    const taskId = Number(String(active.id).replace("task-", ""));
    const task = board.tasks.find((t) => t.id === taskId);
    if (!task) return;

    // Soltou em cima de outro card (reordena) ou na área vazia da coluna (vai pro fim).
    const overId = String(over.id);
    let targetColumnId: number | null = null;
    let overTaskId: number | null = null;
    if (overId.startsWith("col-")) {
      targetColumnId = Number(overId.replace("col-", ""));
    } else if (overId.startsWith("task-")) {
      overTaskId = Number(overId.replace("task-", ""));
      targetColumnId = board.tasks.find((t) => t.id === overTaskId)?.columnId ?? null;
    }
    if (targetColumnId === null) return;

    const before = tasksInColumn(targetColumnId).map((t) => t.id);
    const without = before.filter((id) => id !== taskId);

    let index = without.length;
    if (overTaskId !== null && overTaskId !== taskId) {
      const at = without.indexOf(overTaskId);
      if (at >= 0) {
        // Descendo dentro da mesma coluna, o card entra DEPOIS do alvo; subindo,
        // ou vindo de outra coluna, entra antes.
        const from = before.indexOf(taskId);
        const to = before.indexOf(overTaskId);
        index = from !== -1 && from < to ? at + 1 : at;
      }
    }
    const ordered = [...without.slice(0, index), taskId, ...without.slice(index)];

    const nothingChanged = task.columnId === targetColumnId && ordered.join(",") === before.join(",");
    if (nothingChanged) return;

    // Otimista: aplica coluna e posições novas antes da resposta do servidor.
    setBoard((cur) =>
      cur
        ? {
            ...cur,
            tasks: cur.tasks.map((t) => {
              const at = ordered.indexOf(t.id);
              if (t.id === taskId) return { ...t, columnId: targetColumnId, position: at };
              return at >= 0 ? { ...t, position: at } : t;
            }),
          }
        : cur
    );

    try {
      const res = await fetch(`/api/tasks/cards/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "move", columnId: targetColumnId, orderedTaskIds: ordered }),
      });
      // Recusa do servidor (403/400) também precisa desfazer — antes só erro de
      // rede era tratado, e o card ficava "movido" na tela sem ter salvo.
      if (!res.ok) await loadBoard();
    } catch {
      await loadBoard();
    }
  }

  const currentSector = sectors.find((s) => s.id === sectorId) ?? null;

  return (
    // Altura no padrão do CRM: no mobile desconta a barra de topo (3.5rem) e usa
    // dvh (100vh conta a barra de endereço do navegador e estoura a tela).
    <main className="flex min-h-[calc(100dvh-3.5rem)] flex-col bg-slate-100 text-slate-900 lg:h-[calc(100vh-4rem)] lg:min-h-0">
      {/* Cabeçalho */}
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-5 py-3.5 shadow-sm">
        <div className="flex items-center gap-2.5 pr-1">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--dashboard-navy)] text-cyan-400 shadow-sm">
            <FolderKanban className="h-4.5 w-4.5" />
          </span>
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-950">Quadro de tarefas</h1>
            <p className="text-[11px] font-medium text-slate-500">Organize e acompanhe o trabalho da equipe</p>
          </div>
        </div>
        {/* A cor do setor já existia no banco e não aparecia em lugar nenhum do
            quadro — aqui ela vira a identidade visual de onde você está. */}
        {currentSector && (
          <span
            className="h-6 w-1.5 flex-shrink-0 rounded-full"
            style={{ backgroundColor: currentSector.color }}
            aria-hidden
          />
        )}
        <select
          value={sectorId ?? ""}
          onChange={(e) => setSectorId(e.target.value ? Number(e.target.value) : null)}
          className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm font-semibold text-slate-800 shadow-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
        >
          {sectors.length === 0 && <option value="">Nenhum setor</option>}
          {sectors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        {/* Quadros do setor */}
        <div className="flex flex-wrap items-center gap-1.5 border-l border-slate-200 pl-3">
          {boards.map((b) => (
            <button
              key={b.id}
              onClick={() => setBoardId(b.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                boardId === b.id
                  ? "bg-slate-900 text-white shadow-sm"
                  : "border border-transparent bg-slate-100 text-slate-700 hover:border-slate-200 hover:bg-white hover:text-slate-950"
              }`}
            >
              {b.name}
            </button>
          ))}
          {isAdmin && sectorId !== null && (
            <button
              onClick={() => setModal("board")}
              className="rounded-lg border border-dashed border-slate-400 px-2.5 py-1.5 text-sm font-semibold text-slate-600 transition hover:border-cyan-400 hover:bg-cyan-50 hover:text-cyan-700"
            >
              <Plus className="inline h-3.5 w-3.5" /> Quadro
            </button>
          )}
          {board && (
            <button
              onClick={() => setModal("labels")}
              title="Criar e editar as etiquetas deste quadro"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
            >
              <Tag className="h-3.5 w-3.5" /> Etiquetas
            </button>
          )}
        </div>

        {isMaster && (
          <div className="ml-auto flex items-center gap-2">
            {currentSector && (
              <button
                onClick={() => setModal("sector-edit")}
                title="Editar setor (nome, cor e quais equipes têm acesso)"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
              >
                <Pencil className="h-3.5 w-3.5" /> Acesso
              </button>
            )}
            <button
              onClick={() => setModal("teams")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm shadow-slate-300 transition hover:bg-slate-800"
            >
              <Users className="h-3.5 w-3.5" /> Equipes e usuários
            </button>
            <button
              onClick={() => setModal("sector")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-700"
            >
              <Plus className="h-3.5 w-3.5" /> Setor
            </button>
          </div>
        )}
      </header>

      {/* Corpo */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {sectors.length === 0 ? (
          <EmptyState
            icon={<FolderKanban className="h-10 w-10 text-slate-300" />}
            title="Nenhum setor ainda"
            hint={isMaster ? "Crie um setor pra começar a organizar os quadros." : "Peça a um super master pra te adicionar a uma equipe."}
            action={isMaster ? { label: "Criar setor", onClick: () => setModal("sector") } : undefined}
          />
        ) : loadingBoard ? (
          <div className="flex h-full items-center justify-center text-slate-400">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando quadro…
          </div>
        ) : !board ? (
          <EmptyState
            icon={<FolderKanban className="h-10 w-10 text-slate-300" />}
            title={boards.length === 0 ? "Nenhum quadro neste setor" : "Selecione um quadro"}
            hint={isAdmin && boards.length === 0 ? "Crie o primeiro quadro deste setor." : ""}
            action={isAdmin && boards.length === 0 ? { label: "Criar quadro", onClick: () => setModal("board") } : undefined}
          />
        ) : (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            {/* snap-x: no celular cada coluna "encaixa" em vez de parar no meio. */}
            <div className="flex h-full snap-x snap-mandatory items-start gap-4 overflow-x-auto p-5 sm:snap-none">
              {board.columns.map((col) => (
                <Column
                  key={col.id}
                  column={col}
                  tasks={tasksInColumn(col.id)}
                  labels={board.labels}
                  memberById={memberById}
                  onOpenTask={setEditingTask}
                  onQuickAdd={async (title) => {
                    const res = await fetch("/api/tasks/cards", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ boardId: board.board.id, columnId: col.id, title }),
                    });
                    if (res.ok) loadBoard();
                  }}
                />
              ))}
              {isAdmin && (
                <AddColumn
                  onAdd={async (name) => {
                    const res = await fetch("/api/tasks/columns", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ boardId: board.board.id, name }),
                    });
                    if (res.ok) loadBoard();
                  }}
                />
              )}
            </div>
          </DndContext>
        )}
      </div>

      {editingTask && (
        <TaskModal
          task={editingTask}
          labels={board?.labels ?? []}
          members={members}
          onClose={() => setEditingTask(null)}
          onSaved={() => {
            setEditingTask(null);
            loadBoard();
          }}
        />
      )}

      {modal === "sector" && (
        <SectorModal
          sector={null}
          teams={teams}
          onClose={() => setModal(null)}
          onSaved={(sector) => {
            setSectors((cur) => [...cur, sector]);
            setSectorId(sector.id);
            setModal(null);
          }}
        />
      )}
      {modal === "sector-edit" && currentSector && (
        <SectorModal
          sector={currentSector}
          teams={teams}
          onClose={() => setModal(null)}
          onSaved={(sector) => {
            setSectors((cur) => cur.map((s) => (s.id === sector.id ? sector : s)));
            setModal(null);
          }}
        />
      )}
      {modal === "board" && sectorId !== null && (
        <BoardModal
          sectorId={sectorId}
          onClose={() => setModal(null)}
          onCreated={(b) => {
            setBoards((cur) => [...cur, b]);
            setBoardId(b.id);
            setModal(null);
          }}
        />
      )}
      {modal === "labels" && board && (
        <LabelsModal
          boardId={board.board.id}
          labels={board.labels}
          onClose={() => setModal(null)}
          onChanged={loadBoard}
        />
      )}
      {modal === "teams" && (
        <TeamsManagerModal
          teams={teams}
          members={members}
          onClose={() => setModal(null)}
          onTeamsChange={setTeams}
        />
      )}
    </main>
  );
}

// ── Coluna ───────────────────────────────────────────────────────────────────
function Column({
  column,
  tasks,
  labels,
  memberById,
  onOpenTask,
  onQuickAdd,
}: {
  column: TaskColumn;
  tasks: TaskCard[];
  labels: BoardData["labels"];
  memberById: Map<number, Member>;
  onOpenTask: (t: TaskCard) => void;
  onQuickAdd: (title: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${column.id}` });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const taskIds = tasks.map((t) => `task-${t.id}`);

  return (
    <div className="flex max-h-full w-72 flex-shrink-0 snap-start flex-col rounded-2xl border border-slate-200 bg-slate-200/65 shadow-sm">
      <div className="flex items-center gap-2 px-3.5 py-3">
        <span className="h-2.5 w-2.5 rounded-full ring-4 ring-white/70" style={{ backgroundColor: column.color ?? "#64748b" }} />
        <h3 className="text-sm font-bold text-slate-800">{column.name}</h3>
        <span className="ml-auto min-w-6 rounded-full bg-white px-2 py-0.5 text-center text-xs font-bold tabular-nums text-slate-600 shadow-sm">{tasks.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`min-h-[60px] flex-1 space-y-2 overflow-y-auto px-2.5 pb-2.5 transition-colors ${isOver ? "rounded-xl bg-cyan-100/80 ring-2 ring-inset ring-cyan-300" : ""}`}
      >
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCardView key={task.id} task={task} labels={labels} memberById={memberById} onClick={() => onOpenTask(task)} />
          ))}
        </SortableContext>
        {/* Coluna vazia precisa dizer que aceita algo — sem isso ninguém
            descobre que dá pra soltar um card aqui. */}
        {tasks.length === 0 && !isOver && (
          <div className="flex h-16 items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-xs font-semibold text-slate-500">
            Solte uma tarefa aqui
          </div>
        )}
      </div>
      <div className="p-2">
        {adding ? (
          <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
            <textarea
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (title.trim()) {
                    onQuickAdd(title.trim());
                    setTitle("");
                  }
                  setAdding(false);
                }
                if (e.key === "Escape") setAdding(false);
              }}
              placeholder="Título da tarefa…"
              rows={2}
              className="w-full resize-none rounded border-0 p-1 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
            <div className="flex gap-1">
              <button
                onClick={() => {
                  if (title.trim()) onQuickAdd(title.trim());
                  setTitle("");
                  setAdding(false);
                }}
                className="rounded-md bg-slate-950 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-slate-800"
              >
                Adicionar
              </button>
              <button onClick={() => setAdding(false)} className="rounded px-2 py-1 text-xs text-slate-500">
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex w-full items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold text-slate-600 transition hover:bg-white hover:text-cyan-700"
          >
            <Plus className="h-4 w-4" /> Adicionar tarefa
          </button>
        )}
      </div>
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────
function TaskCardView({
  task,
  labels,
  memberById,
  onClick,
}: {
  task: TaskCard;
  labels: BoardData["labels"];
  memberById: Map<number, Member>;
  onClick: () => void;
}) {
  // useSortable (e não useDraggable): faz o card ser também alvo de solta, que é
  // o que permite reordenar dentro da própria coluna.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `task-${task.id}`,
  });
  const due = dueLabel(task.dueDate);
  const taskLabels = labels.filter((l) => task.labelIds.includes(l.id));
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onClick}
      // Div não recebe foco sozinha: sem isto o anel de focus-visible abaixo
      // nunca aparece e o quadro fica inacessível por teclado.
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`cursor-grab rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-[border,box-shadow,transform] hover:-translate-y-px hover:border-cyan-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 ${
        isDragging ? "scale-[0.98] opacity-50" : ""
      } ${task.completedAt ? "opacity-60" : ""}`}
    >
      {taskLabels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {/* Etiqueta com nome: tarja colorida sem texto só diz algo pra quem já
              sabe o código de cores de cor. */}
          {taskLabels.map((l) => (
            <span
              key={l.id}
              className="rounded px-1.5 py-0.5 text-[10px] font-bold leading-tight text-white"
              style={{ backgroundColor: l.color }}
            >
              {l.name}
            </span>
          ))}
        </div>
      )}
      <p className={`text-sm font-semibold leading-5 text-slate-900 ${task.completedAt ? "line-through" : ""}`}>{task.title}</p>
      <div className="mt-2 flex items-center gap-2">
        {/* "Média" é o padrão: mostrar em todo card vira ruído. Só destaca o que foge disso. */}
        {task.priority !== "media" && (
          <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${PRIORITY[task.priority].chip}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${PRIORITY[task.priority].dot}`} />
            {PRIORITY[task.priority].label}
          </span>
        )}
        {due && (
          <span
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${DUE_TONE[due.tone]}`}
          >
            <CalendarClock className="h-3 w-3" /> {due.text}
          </span>
        )}
        {task.assigneeIds.length > 0 && (
          <div className="ml-auto flex -space-x-1.5">
            {task.assigneeIds.slice(0, 3).map((id) => (
              <span
                key={id}
                title={memberById.get(id)?.name}
                className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-100 text-[9px] font-bold text-cyan-800 ring-2 ring-white"
              >
                {initials(memberById.get(id)?.name ?? "?")}
              </span>
            ))}
            {task.assigneeIds.length > 3 && (
              <span
                title={task.assigneeIds
                  .slice(3)
                  .map((id) => memberById.get(id)?.name ?? `#${id}`)
                  .join(", ")}
                className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[9px] font-bold text-slate-700 ring-2 ring-white"
              >
                +{task.assigneeIds.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AddColumn({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <div className="w-64 flex-shrink-0">
      {open ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-200/65 p-2 shadow-sm">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) {
                onAdd(name.trim());
                setName("");
                setOpen(false);
              }
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder="Nome da coluna…"
            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
          />
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-1.5 rounded-2xl border-2 border-dashed border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-cyan-400 hover:bg-white hover:text-cyan-700"
        >
          <Plus className="h-4 w-4" /> Adicionar coluna
        </button>
      )}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      {icon}
      <p className="text-base font-semibold text-slate-600">{title}</p>
      {hint && <p className="max-w-sm text-sm text-slate-400">{hint}</p>}
      {action && (
        <button onClick={action.onClick} className="mt-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white">
          {action.label}
        </button>
      )}
    </div>
  );
}

// ── Modais ───────────────────────────────────────────────────────────────────
const OVERLAY_SIZE = { md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-5xl" } as const;

function Overlay({
  children,
  onClose,
  size = "md",
}: {
  children: React.ReactNode;
  onClose: () => void;
  size?: keyof typeof OVERLAY_SIZE;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className={`w-full rounded-xl bg-white shadow-2xl ${OVERLAY_SIZE[size]}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function TaskModal({
  task,
  labels,
  members,
  onClose,
  onSaved,
}: {
  task: TaskCard;
  labels: BoardData["labels"];
  members: Member[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [assigneeIds, setAssigneeIds] = useState<number[]>(task.assigneeIds);
  const [labelIds, setLabelIds] = useState<number[]>(task.labelIds);
  const [completed, setCompleted] = useState(Boolean(task.completedAt));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await fetch(`/api/tasks/cards/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description, priority, dueDate: dueDate || null, assigneeIds, labelIds, completed }),
    });
    setSaving(false);
    onSaved();
  }
  async function remove() {
    await fetch(`/api/tasks/cards/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    onSaved();
  }

  return (
    <Overlay onClose={onClose} size="lg">
      <div className="flex items-center justify-between border-b border-slate-100 p-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full text-base font-bold text-slate-800 focus:outline-none"
        />
        <button onClick={onClose} className="ml-2 text-slate-400 hover:text-slate-700">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Descrição</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-slate-200 p-2 text-sm"
            placeholder="Detalhes da tarefa…"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Prioridade</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            >
              {(Object.keys(PRIORITY) as TaskPriority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY[p].label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Prazo</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Responsáveis</label>
          <div className="flex flex-wrap gap-1.5">
            {members.map((m) => {
              const on = assigneeIds.includes(m.id);
              return (
                <button
                  key={m.id}
                  onClick={() => setAssigneeIds((cur) => (on ? cur.filter((x) => x !== m.id) : [...cur, m.id]))}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-semibold ${
                    on ? "border-cyan-400 bg-cyan-50 text-cyan-800" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-cyan-100 text-[8px] font-bold text-cyan-800">
                    {initials(m.name)}
                  </span>
                  {m.name.split(" ")[0]}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Etiquetas</label>
          {labels.length === 0 ? (
            <p className="text-xs text-slate-400">
              Nenhuma etiqueta neste quadro ainda — crie pelo botão <strong>Etiquetas</strong>, no topo.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {labels.map((l) => {
                const on = labelIds.includes(l.id);
                return (
                  <button
                    key={l.id}
                    onClick={() => setLabelIds((cur) => (on ? cur.filter((x) => x !== l.id) : [...cur, l.id]))}
                    style={on ? { backgroundColor: l.color, color: "white" } : { color: l.color, borderColor: l.color }}
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${on ? "" : "bg-white"}`}
                  >
                    {l.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={completed} onChange={(e) => setCompleted(e.target.checked)} className="h-4 w-4" />
          Marcar como concluída
        </label>
      </div>
      <div className="flex items-center justify-between border-t border-slate-100 p-4">
        <button onClick={remove} className="text-sm font-semibold text-rose-600 hover:underline">
          Arquivar
        </button>
        <div className="flex gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salvar
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function SectorModal({
  sector,
  teams,
  onClose,
  onSaved,
}: {
  /** null = criar um setor novo; preenchido = editar o setor atual. */
  sector: TaskSector | null;
  teams: TaskTeam[];
  onClose: () => void;
  onSaved: (s: TaskSector) => void;
}) {
  const editing = sector !== null;
  const [name, setName] = useState(sector?.name ?? "");
  const [color, setColor] = useState(sector?.color ?? "#6366f1");
  const [openToAll, setOpenToAll] = useState(sector?.openToAll ?? false);
  const [teamIds, setTeamIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  // Ao editar, traz as equipes que já têm acesso a este setor.
  useEffect(() => {
    if (!sector) return;
    let cancelled = false;
    fetch(`/api/tasks/sectors/${sector.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && Array.isArray(d.teamIds)) setTeamIds(d.teamIds.map(Number));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sector]);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    const payload = JSON.stringify({ name, color, openToAll, teamIds });
    if (sector) {
      const res = await fetch(`/api/tasks/sectors/${sector.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      setSaving(false);
      if (res.ok) onSaved({ ...sector, name, color, openToAll });
    } else {
      const res = await fetch("/api/tasks/sectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      const d = await res.json();
      setSaving(false);
      if (d.sector) onSaved(d.sector);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <ModalHeader title={editing ? `Setor: ${sector.name}` : "Novo setor"} onClose={onClose} />
      <div className="space-y-3 p-4">
        <Field label="Nome">
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm" placeholder="Ex.: Marketing" autoFocus />
        </Field>
        <Field label="Cor">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-16 rounded border border-slate-200" />
        </Field>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-2.5">
          <input type="checkbox" checked={openToAll} onChange={(e) => setOpenToAll(e.target.checked)} className="mt-0.5 h-4 w-4" />
          <span>
            <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
              <Globe className="h-3.5 w-3.5 text-emerald-600" /> Todos os usuários veem este setor
            </span>
            <span className="text-xs text-slate-400">
              Use no setor Geral. Vale inclusive para usuários criados depois, sem precisar mexer em equipe.
            </span>
          </span>
        </label>
        <Field label="Equipes com acesso">
          {teams.length === 0 ? (
            <p className="text-xs text-slate-400">Crie equipes primeiro (botão Equipes).</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {teams.map((t) => {
                const on = teamIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => setTeamIds((c) => (on ? c.filter((x) => x !== t.id) : [...c, t.id]))}
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${on ? "border-cyan-400 bg-cyan-50 text-cyan-800" : "border-slate-200 text-slate-500"}`}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          )}
          {openToAll && (
            <p className="mt-1.5 text-xs text-slate-400">
              Com &quot;todos veem&quot; ligado, as equipes acima não limitam nada — o setor já aparece pra todo mundo.
            </p>
          )}
        </Field>
      </div>
      <ModalFooter onClose={onClose} onSave={save} saving={saving} label={editing ? "Salvar" : "Criar"} />
    </Overlay>
  );
}

function BoardModal({
  sectorId,
  onClose,
  onCreated,
}: {
  sectorId: number;
  onClose: () => void;
  onCreated: (b: TaskBoard) => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  async function create() {
    if (!name.trim()) return;
    setSaving(true);
    const res = await fetch("/api/tasks/boards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectorId, name }),
    });
    const d = await res.json();
    setSaving(false);
    if (d.board) onCreated(d.board);
  }
  return (
    <Overlay onClose={onClose}>
      <ModalHeader title="Novo quadro" onClose={onClose} />
      <div className="p-4">
        <Field label="Nome do quadro">
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm" placeholder="Ex.: Campanhas Q3" autoFocus />
        </Field>
        <p className="mt-2 text-xs text-slate-400">O quadro já vem com as colunas A fazer / Fazendo / Concluído.</p>
      </div>
      <ModalFooter onClose={onClose} onSave={create} saving={saving} />
    </Overlay>
  );
}

const LABEL_COLORS = ["#22c55e", "#eab308", "#f97316", "#ef4444", "#a855f7", "#3b82f6", "#06b6d4", "#64748b"];

/** Etiquetas são por quadro: quem enxerga o quadro pode criar e editar. */
function LabelsModal({
  boardId,
  labels,
  onClose,
  onChanged,
}: {
  boardId: number;
  labels: TaskLabel[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<TaskLabel[]>(labels);
  const [name, setName] = useState("");
  const [color, setColor] = useState(LABEL_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    const res = await fetch("/api/tasks/labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ boardId, name: trimmed, color }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (d.label) {
      setItems((cur) => [...cur, d.label]);
      setName("");
      setError(null);
      onChanged();
    } else {
      setError(d.error ?? "Não foi possível criar a etiqueta.");
    }
  }

  async function patch(label: TaskLabel, changes: { name?: string; color?: string }) {
    const previous = items;
    setItems((cur) => cur.map((l) => (l.id === label.id ? { ...l, ...changes } : l)));
    const res = await fetch(`/api/tasks/labels/${label.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    }).catch(() => null);
    if (!res?.ok) {
      setItems(previous);
      setError("Não foi possível salvar a etiqueta.");
    } else {
      setError(null);
      onChanged();
    }
  }

  async function remove(label: TaskLabel) {
    if (!window.confirm(`Excluir a etiqueta "${label.name}"? Ela sai de todos os cards que a usam.`)) return;
    const previous = items;
    setItems((cur) => cur.filter((l) => l.id !== label.id));
    const res = await fetch(`/api/tasks/labels/${label.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      setItems(previous);
      setError("Não foi possível excluir a etiqueta.");
    } else {
      setError(null);
      onChanged();
    }
  }

  return (
    <Overlay onClose={onClose}>
      <ModalHeader title="Etiquetas do quadro" onClose={onClose} />
      <div className="max-h-[70vh] space-y-3 overflow-y-auto p-4">
        {items.length === 0 && (
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">
            Nenhuma etiqueta ainda. Crie abaixo — depois elas aparecem pra marcar dentro de cada tarefa.
          </p>
        )}
        {items.map((label) => (
          <div key={label.id} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2">
            <input
              defaultValue={label.name}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next && next !== label.name) void patch(label, { name: next });
              }}
              className="min-w-0 flex-1 rounded border border-transparent px-1.5 py-1 text-sm font-semibold text-slate-700 hover:border-slate-200 focus:border-slate-300 focus:outline-none"
            />
            <div className="flex flex-shrink-0 gap-1">
              {LABEL_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => void patch(label, { color: c })}
                  title={c}
                  style={{ backgroundColor: c }}
                  className={`h-5 w-5 rounded-full transition ${
                    label.color.toLowerCase() === c ? "ring-2 ring-slate-800 ring-offset-1" : "hover:scale-110"
                  }`}
                />
              ))}
            </div>
            <button onClick={() => void remove(label)} title="Excluir etiqueta" className="text-slate-300 hover:text-rose-600">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}

        <div className="rounded-lg border border-dashed border-slate-300 p-3">
          <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Nova etiqueta</p>
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void create();
              }}
              placeholder="Ex.: Urgente, Campanha, Bug…"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
            />
            <button
              onClick={create}
              disabled={busy || !name.trim()}
              className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              Criar
            </button>
          </div>
          <div className="mt-2 flex gap-1.5">
            {LABEL_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{ backgroundColor: c }}
                className={`h-6 w-6 rounded-full transition ${
                  color === c ? "ring-2 ring-slate-800 ring-offset-1" : "hover:scale-110"
                }`}
              />
            ))}
          </div>
        </div>
        {error && <p className="text-sm font-semibold text-rose-600">{error}</p>}
      </div>
      <div className="border-t border-slate-100 p-3 text-right">
        <button onClick={onClose} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white">
          Fechar
        </button>
      </div>
    </Overlay>
  );
}

/**
 * Tela de manejo de usuários (só super master): arrasta a pessoa da lista da
 * esquerda pra dentro da equipe da direita. Cada solta grava na hora.
 */
function TeamsManagerModal({
  teams,
  members,
  onClose,
  onTeamsChange,
}: {
  teams: TaskTeam[];
  members: Member[];
  onClose: () => void;
  onTeamsChange: (teams: TaskTeam[]) => void;
}) {
  const [localTeams, setLocalTeams] = useState<TaskTeam[]>(teams);
  const [query, setQuery] = useState("");
  const [newTeam, setNewTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);

  // Mouse e toque separados: no celular o arraste só começa com pressão longa
  // (250ms), senão qualquer tentativa de rolar a tela arrastaria um card.
  // Mesmo padrão já usado no kanban do CRM.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 12 } })
  );
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  function apply(next: TaskTeam[]) {
    setLocalTeams(next);
    onTeamsChange(next);
  }

  async function saveMembers(teamId: number, memberIds: number[]) {
    const previous = localTeams;
    apply(localTeams.map((t) => (t.id === teamId ? { ...t, memberIds } : t)));
    const res = await fetch(`/api/tasks/teams/${teamId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberIds }),
    }).catch(() => null);
    if (!res?.ok) {
      apply(previous);
      setError("Não deu pra salvar. Recarregue a página e confirme que você entrou como super master.");
    } else {
      setError(null);
    }
  }

  function addToTeam(teamId: number, memberId: number) {
    const team = localTeams.find((t) => t.id === teamId);
    if (!team || team.memberIds.includes(memberId)) return;
    void saveMembers(teamId, [...team.memberIds, memberId]);
  }

  function removeFromTeam(teamId: number, memberId: number) {
    const team = localTeams.find((t) => t.id === teamId);
    if (!team) return;
    void saveMembers(teamId, team.memberIds.filter((id) => id !== memberId));
  }

  async function createTeam() {
    const name = newTeam.trim();
    if (!name) return;
    setBusy(true);
    const res = await fetch("/api/tasks/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (d.teamId) {
      apply([...localTeams, { id: d.teamId, name, description: null, color: "#0ea5e9", memberIds: [], sectorNames: [] }]);
      setNewTeam("");
      setError(null);
    } else {
      setError(d.error ?? "Não foi possível criar a equipe.");
    }
  }

  async function deleteTeam(team: TaskTeam) {
    if (!window.confirm(`Excluir a equipe "${team.name}"? Quem estava nela perde o acesso ao setor correspondente.`)) return;
    const previous = localTeams;
    apply(localTeams.filter((t) => t.id !== team.id));
    const res = await fetch(`/api/tasks/teams/${team.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      apply(previous);
      setError("Não foi possível excluir a equipe.");
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingId(null);
    const { active, over } = event;
    if (!over) return;
    const memberId = Number(String(active.id).replace("user-", ""));
    const overId = String(over.id);
    if (!overId.startsWith("team-")) return;
    addToTeam(Number(overId.replace("team-", "")), memberId);
  }

  const term = query.trim().toLowerCase();
  const filtered = term
    ? members.filter((m) => `${m.name} ${m.email}`.toLowerCase().includes(term))
    : members;

  return (
    <Overlay onClose={onClose} size="xl">
      <ModalHeader title="Equipes e usuários" onClose={onClose} />
      <DndContext sensors={sensors} onDragStart={(e) => setDraggingId(Number(String(e.active.id).replace("user-", "")))} onDragEnd={handleDragEnd}>
        <div className="grid max-h-[72vh] grid-cols-1 gap-4 overflow-y-auto p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          {/* Esquerda: todos os usuários */}
          <section className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Usuários ativos</h4>
              <span className="rounded-full bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-500">{members.length}</span>
            </div>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por nome ou e-mail…"
                className="w-full rounded-lg border border-slate-200 py-1.5 pl-7 pr-2 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              {filtered.map((m) => (
                <UserRow
                  key={m.id}
                  member={m}
                  teams={localTeams}
                  onToggleTeam={(teamId, on) => (on ? addToTeam(teamId, m.id) : removeFromTeam(teamId, m.id))}
                />
              ))}
              {filtered.length === 0 && <p className="py-6 text-center text-sm text-slate-400">Ninguém com esse nome.</p>}
            </div>
          </section>

          {/* Direita: equipes */}
          <section className="min-w-0 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Equipes</h4>
            {localTeams.map((team) => (
              <TeamDropZone
                key={team.id}
                team={team}
                memberById={memberById}
                dragging={draggingId !== null}
                onRemove={(memberId) => removeFromTeam(team.id, memberId)}
                onDelete={() => deleteTeam(team)}
              />
            ))}
            <div className="flex gap-2">
              <input
                value={newTeam}
                onChange={(e) => setNewTeam(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createTeam();
                }}
                placeholder="Nova equipe…"
                className="flex-1 rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-sm"
              />
              <button onClick={createTeam} disabled={busy} className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                Criar
              </button>
            </div>
          </section>
        </div>
      </DndContext>

      <div className="flex items-center gap-3 border-t border-slate-100 p-3">
        <p className="flex-1 text-xs text-slate-400">
          {error ? (
            <span className="font-semibold text-rose-600">{error}</span>
          ) : (
            <>Arraste a pessoa pra dentro da equipe (ou clique nas etiquetas ao lado do nome). Salva sozinho — quem mudou de equipe vê a diferença ao recarregar a página.</>
          )}
        </p>
        <button onClick={onClose} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white">
          Fechar
        </button>
      </div>
    </Overlay>
  );
}

/** Linha de usuário: o bloco do nome é o "pega" do arraste. */
function UserRow({
  member,
  teams,
  onToggleTeam,
}: {
  member: Member;
  teams: TaskTeam[];
  onToggleTeam: (teamId: number, on: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `user-${member.id}` });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50 } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 ${isDragging ? "opacity-60 shadow-lg" : ""}`}
    >
      <div {...listeners} {...attributes} className="flex min-w-0 flex-1 cursor-grab items-center gap-2 active:cursor-grabbing">
        <GripVertical className="h-4 w-4 flex-shrink-0 text-slate-300" />
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-cyan-100 text-[10px] font-bold text-cyan-800">
          {initials(member.name)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-slate-700">
            {member.name}
            {member.role === "super_master" && <span className="ml-1 text-[10px] font-bold uppercase text-amber-600">master</span>}
          </span>
          {/* E-mail resolve nomes repetidos (ex.: as duas Andreas) */}
          <span className="block truncate text-[11px] text-slate-400">{member.email}</span>
        </span>
      </div>
      <div className="flex flex-shrink-0 flex-wrap justify-end gap-1">
        {teams.map((t) => {
          const on = t.memberIds.includes(member.id);
          return (
            <button
              key={t.id}
              onClick={() => onToggleTeam(t.id, !on)}
              title={on ? `Tirar de ${t.name}` : `Colocar em ${t.name}`}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold transition ${
                on ? "border-transparent text-white" : "border-slate-200 text-slate-400 hover:bg-slate-50"
              }`}
              style={on ? { backgroundColor: t.color } : undefined}
            >
              {t.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Card da equipe — área onde se solta o usuário. */
function TeamDropZone({
  team,
  memberById,
  dragging,
  onRemove,
  onDelete,
}: {
  team: TaskTeam;
  memberById: Map<number, Member>;
  dragging: boolean;
  onRemove: (memberId: number) => void;
  onDelete: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `team-${team.id}` });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border-2 p-3 transition ${
        isOver ? "border-cyan-400 bg-cyan-50" : dragging ? "border-dashed border-slate-300 bg-white" : "border-slate-200 bg-white"
      }`}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: team.color }} />
        <h5 className="text-sm font-bold text-slate-700">{team.name}</h5>
        <span className="rounded-full bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-500">{team.memberIds.length}</span>
        <button onClick={onDelete} title="Excluir equipe" className="ml-auto text-slate-300 hover:text-rose-600">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mb-2 text-[11px] text-slate-400">
        {team.sectorNames.length > 0 ? (
          <>Dá acesso a: <strong className="text-slate-500">{team.sectorNames.join(", ")}</strong></>
        ) : (
          <span className="text-amber-600">Sem setor ligado — use o botão Acesso no setor desejado.</span>
        )}
      </p>
      <div className="flex min-h-[42px] flex-wrap gap-1.5 rounded-lg bg-slate-50 p-1.5">
        {team.memberIds.length === 0 && (
          <span className="px-1 py-1 text-xs text-slate-400">Arraste pessoas pra cá…</span>
        )}
        {team.memberIds.map((id) => {
          const m = memberById.get(id);
          return (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-600 shadow-sm">
              {m?.name ?? `#${id}`}
              <button onClick={() => onRemove(id)} title="Tirar da equipe" className="text-slate-300 hover:text-rose-600">
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">{label}</label>
      {children}
    </div>
  );
}

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 p-4">
      <h3 className="text-base font-bold text-slate-800">{title}</h3>
      <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}
function ModalFooter({
  onClose,
  onSave,
  saving,
  label = "Criar",
}: {
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  label?: string;
}) {
  return (
    <div className="flex justify-end gap-2 border-t border-slate-100 p-4">
      <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">
        Cancelar
      </button>
      <button onClick={onSave} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : label === "Salvar" ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />} {label}
      </button>
    </div>
  );
}
