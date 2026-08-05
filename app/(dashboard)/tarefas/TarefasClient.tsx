"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Archive,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  Check,
  Copy,
  Filter,
  FolderKanban,
  GanttChartSquare,
  Globe,
  GripVertical,
  History,
  Keyboard,
  LayoutGrid,
  Link2,
  Loader2,
  ListTodo,
  MessageSquare,
  Paperclip,
  PieChart,
  Pencil,
  Plus,
  Search,
  Settings2,
  Sparkles,
  SlidersHorizontal,
  Table2,
  Tag,
  Trash2,
  Users,
  X,
  Zap,
} from "lucide-react";
import CardModal, { type Member } from "./CardModal";
import {
  CalendarView,
  DashboardView,
  GeneralView,
  TableView,
  TimelineView,
  WorkspaceView,
  type WorkspaceBoardItem,
} from "./BoardViews";
import {
  ArchiveModal,
  AutomationsModal,
  CustomFieldsModal,
  IntegrationsModal,
  ShortcutsModal,
  TemplatesModal,
} from "./BoardModals";
import type { TaskAutomation } from "@/lib/taskAutomations";
import type {
  BoardData,
  TaskBoard,
  TaskCard,
  TaskColumn,
  TaskLabel,
  TaskOverviewTask,
  TaskPriority,
  TaskSector,
  TaskTeam,
} from "@/lib/tasks";

interface Props {
  initialSectors: TaskSector[];
  teams: TaskTeam[];
  members: Member[];
  /** Pode criar quadros e colunas dentro dos setores que enxerga. */
  isAdmin: boolean;
  /** Super master: único que monta setores/equipes e decide quem vê o quê. */
  isMaster: boolean;
  /** Id do usuário logado em team_members (null se ele não estiver na lista). */
  currentMemberId: number | null;
}

/** As visões do quadro. Kanban continua sendo a porta de entrada. */
type BoardView = "geral" | "kanban" | "tabela" | "calendario" | "timeline" | "painel" | "workspace";

const VIEWS: { key: BoardView; label: string; icon: typeof LayoutGrid }[] = [
  { key: "geral", label: "Geral", icon: Globe },
  { key: "kanban", label: "Kanban", icon: LayoutGrid },
  { key: "tabela", label: "Tabela", icon: Table2 },
  { key: "calendario", label: "Calendário", icon: CalendarDays },
  { key: "timeline", label: "Timeline", icon: GanttChartSquare },
  { key: "painel", label: "Painel", icon: PieChart },
  { key: "workspace", label: "Workspace", icon: FolderKanban },
];

interface Filters {
  text: string;
  labelIds: number[];
  memberIds: number[];
  priorities: TaskPriority[];
  status: "todos" | "abertas" | "concluidas" | "atrasadas" | "sem_prazo";
  onlyMine: boolean;
}

const EMPTY_FILTERS: Filters = {
  text: "",
  labelIds: [],
  memberIds: [],
  priorities: [],
  status: "todos",
  onlyMine: false,
};

const PRIORITY: Record<TaskPriority, { label: string; dot: string; chip: string }> = {
  baixa: { label: "Baixa", dot: "bg-slate-400", chip: "bg-slate-100 text-slate-600" },
  media: { label: "Média", dot: "bg-blue-500", chip: "bg-blue-100 text-blue-700" },
  alta: { label: "Alta", dot: "bg-amber-500", chip: "bg-amber-100 text-amber-700" },
  urgente: { label: "Urgente", dot: "bg-rose-500", chip: "bg-rose-100 text-rose-700" },
};

const PRIORITY_CARD_ACCENT: Record<TaskPriority, string> = {
  baixa: "from-slate-400 via-slate-300 to-transparent",
  media: "from-blue-600 via-cyan-400 to-transparent",
  alta: "from-amber-500 via-orange-300 to-transparent",
  urgente: "from-rose-600 via-fuchsia-400 to-transparent",
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

/**
 * Selo de conclusão do card: "Concluída 31/07". A data é guardada ao meio-dia
 * UTC justamente pra caber no dia certo em qualquer fuso do Brasil.
 */
function completedLabel(completedAt: string | null): string {
  if (!completedAt) return "Concluída";
  const d = new Date(completedAt);
  if (Number.isNaN(d.getTime())) return "Concluída";
  return `Concluída ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;
}

const DUE_TONE: Record<"overdue" | "soon" | "normal", string> = {
  overdue: "bg-rose-50 text-rose-700",
  soon: "bg-amber-50 text-amber-700",
  normal: "text-slate-600",
};

export default function TarefasClient({
  initialSectors,
  teams: initialTeams,
  members,
  isAdmin,
  isMaster,
  currentMemberId,
}: Props) {
  const [sectors, setSectors] = useState<TaskSector[]>(initialSectors);
  const [teams, setTeams] = useState<TaskTeam[]>(initialTeams);
  const [sectorId, setSectorId] = useState<number | null>(initialSectors[0]?.id ?? null);
  const [boards, setBoards] = useState<TaskBoard[]>([]);
  const [boardId, setBoardId] = useState<number | null>(null);
  const [board, setBoard] = useState<BoardData | null>(null);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskCard | null>(null);
  const [modal, setModal] = useState<
    | null
    | "sector"
    | "sector-edit"
    | "board"
    | "teams"
    | "labels"
    | "automations"
    | "fields"
    | "templates"
    | "integrations"
    | "archive"
    | "shortcuts"
  >(null);
  const [view, setView] = useState<BoardView>("kanban");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [automations, setAutomations] = useState<TaskAutomation[]>([]);
  const [workspaceBoards, setWorkspaceBoards] = useState<WorkspaceBoardItem[]>([]);
  const [generalTasks, setGeneralTasks] = useState<TaskOverviewTask[]>([]);
  const [pendingTaskId, setPendingTaskId] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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

  // Automações do quadro — precisam vir junto porque os botões aparecem dentro
  // de cada card.
  useEffect(() => {
    if (boardId === null) {
      setAutomations([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/tasks/automations?boardId=${boardId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setAutomations(d.automations ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  useEffect(() => {
    if (view !== "workspace") return;
    fetch("/api/tasks/workspace")
      .then((r) => r.json())
      .then((d) => setWorkspaceBoards(d.boards ?? []))
      .catch(() => {});
  }, [view]);

  // A aba Geral traz somente os dados necessários para o panorama. O card
  // completo continua sendo carregado sob demanda, ao abrir uma tarefa.
  useEffect(() => {
    if (view !== "geral") return;
    let cancelled = false;
    fetch("/api/tasks/overview")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setWorkspaceBoards(data.boards ?? []);
        setGeneralTasks(data.tasks ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setWorkspaceBoards([]);
          setGeneralTasks([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [view]);

  // Primeiro troca para o quadro correto; só então abre o card. Assim um clique
  // no Geral nunca mostra o detalhe da tarefa sobre o quadro que estava aberto.
  useEffect(() => {
    if (pendingTaskId === null || board?.board.id !== boardId) return;
    let cancelled = false;
    fetch(`/api/tasks/cards/${pendingTaskId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.task) setEditingTask(data.task);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setPendingTaskId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pendingTaskId, board?.board.id, boardId]);

  // Link direto vindo da notificação (/tarefas?board=12&card=345).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const deepBoard = Number(params.get("board"));
    if (Number.isFinite(deepBoard) && deepBoard > 0) setBoardId(deepBoard);
    const deepCard = Number(params.get("card"));
    if (Number.isFinite(deepCard) && deepCard > 0) {
      fetch(`/api/tasks/cards/${deepCard}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.task) setEditingTask(d.task);
        })
        .catch(() => {});
    }
  }, []);

  const filteredTasks = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const term = filters.text.trim().toLowerCase();
    return (board?.tasks ?? []).filter((task) => {
      if (term && !`${task.title} ${task.description ?? ""}`.toLowerCase().includes(term)) return false;
      if (filters.labelIds.length > 0 && !filters.labelIds.some((id) => task.labelIds.includes(id))) return false;
      if (filters.memberIds.length > 0 && !filters.memberIds.some((id) => task.assigneeIds.includes(id))) return false;
      if (filters.priorities.length > 0 && !filters.priorities.includes(task.priority)) return false;
      if (filters.onlyMine && (currentMemberId === null || !task.assigneeIds.includes(currentMemberId))) return false;
      switch (filters.status) {
        case "abertas":
          return !task.completedAt;
        case "concluidas":
          return Boolean(task.completedAt);
        case "atrasadas":
          return Boolean(task.dueDate && task.dueDate < today && !task.completedAt);
        case "sem_prazo":
          return !task.dueDate;
        default:
          return true;
      }
    });
  }, [board, filters, currentMemberId]);

  const filtersActive =
    filters.text.trim() !== "" ||
    filters.labelIds.length > 0 ||
    filters.memberIds.length > 0 ||
    filters.priorities.length > 0 ||
    filters.status !== "todos" ||
    filters.onlyMine;

  async function quickAdd(columnId: number | null, title: string) {
    if (!board) return;
    const res = await fetch("/api/tasks/cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ boardId: board.board.id, columnId, title }),
    });
    if (res.ok) void loadBoard();
  }

  // Atalhos de teclado (a lista completa fica no modal "?").
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (editingTask || modal) return;

      const viewByKey: Record<string, BoardView> = {
        "1": "kanban",
        "2": "tabela",
        "3": "calendario",
        "4": "timeline",
        "5": "painel",
        "6": "geral",
        w: "workspace",
      };
      if (viewByKey[event.key]) {
        setView(viewByKey[event.key]);
        return;
      }
      switch (event.key) {
        case "/":
          event.preventDefault();
          setShowFilters(true);
          setTimeout(() => searchRef.current?.focus(), 0);
          break;
        case "n": {
          const first = board?.columns[0];
          if (!first) break;
          const title = window.prompt("Título da nova tarefa:");
          if (title?.trim()) void quickAdd(first.id, title.trim());
          break;
        }
        case "f":
          setShowFilters((value) => !value);
          break;
        case "m":
          setFilters((cur) => ({ ...cur, onlyMine: !cur.onlyMine }));
          break;
        case "a":
          if (board) setModal("archive");
          break;
        case "?":
          setModal("shortcuts");
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, editingTask, modal]);

  /** O que aparece na coluna (respeita os filtros do topo). */
  function tasksInColumn(columnId: number): TaskCard[] {
    return filteredTasks
      .filter((t) => t.columnId === columnId)
      .sort((a, b) => a.position - b.position);
  }

  /**
   * Ordem real da coluna, ignorando filtro. O arraste precisa desta: mandar pro
   * servidor só os cards visíveis reescreveria as posições de uma parte da
   * coluna e embaralharia o que estava escondido pelo filtro.
   */
  function allTasksInColumn(columnId: number): TaskCard[] {
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

    const before = allTasksInColumn(targetColumnId).map((t) => t.id);
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
  // As métricas seguem o que está na tela: com filtro ligado, contar o quadro
  // inteiro faria os números discordarem das colunas logo abaixo.
  const taskStats = useMemo(() => {
    const tasks = filteredTasks;
    const overdue = tasks.filter((task) => dueLabel(task.dueDate)?.tone === "overdue" && !task.completedAt).length;
    const dueSoon = tasks.filter((task) => dueLabel(task.dueDate)?.tone === "soon" && !task.completedAt).length;
    const completed = tasks.filter((task) => task.completedAt).length;
    return { total: tasks.length, overdue, dueSoon, completed, open: Math.max(0, tasks.length - completed) };
  }, [filteredTasks]);

  function openWorkspaceBoard(targetBoardId: number, taskId?: number) {
    const target = workspaceBoards.find((item) => item.id === targetBoardId);
    if (target) setSectorId(target.sectorId);
    setEditingTask(null);
    setPendingTaskId(taskId ?? null);
    setBoardId(targetBoardId);
    setView("kanban");
  }

  return (
    // Altura no padrão do CRM: no mobile desconta a barra de topo (3.5rem) e usa
    // dvh (100vh conta a barra de endereço do navegador e estoura a tela).
    <main className="flex min-h-[calc(100dvh-3.5rem)] flex-col bg-[radial-gradient(circle_at_top,#e0f5fb_0%,#f5f8fb_37%,#eef2f7_100%)] text-slate-900 lg:h-[calc(100vh-4rem)] lg:min-h-0">
      {/* Cabeçalho */}
      <header className="relative overflow-hidden border-b border-slate-800 bg-[linear-gradient(120deg,#071a33_0%,#083b57_58%,#0b6074_100%)] px-5 py-4 text-white shadow-[0_12px_28px_rgba(2,19,37,0.2)]">
        <div className="pointer-events-none absolute -right-12 -top-20 size-64 rounded-full bg-cyan-300/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5 pr-1">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-cyan-200 ring-1 ring-white/15 shadow-lg">
            <FolderKanban className="h-5 w-5" />
          </span>
          <div>
            <div className="flex items-center gap-1.5"><h1 className="text-lg font-black tracking-tight">Central de tarefas</h1><Sparkles className="size-3.5 text-cyan-200" /></div>
            <p className="text-[11px] font-medium text-cyan-50/70">Priorize o agora. Visualize o que move a equipe.</p>
          </div>
        </div>
        {/* A cor do setor já existia no banco e não aparecia em lugar nenhum do
            quadro — aqui ela vira a identidade visual de onde você está. */}
        {currentSector && (
          <span
            className="h-7 w-1.5 flex-shrink-0 rounded-full shadow-[0_0_16px_currentColor]"
            style={{ backgroundColor: currentSector.color }}
            aria-hidden
          />
        )}
        <select
          value={sectorId ?? ""}
          onChange={(e) => setSectorId(e.target.value ? Number(e.target.value) : null)}
          className="rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm font-bold text-white shadow-sm outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100/30"
        >
          {sectors.length === 0 && <option value="" className="bg-white text-slate-900">Nenhum setor</option>}
          {sectors.map((s) => (
            <option key={s.id} value={s.id} className="bg-white text-slate-900">
              {s.name}
            </option>
          ))}
        </select>

        {/* Quadros do setor */}
        <div className="flex flex-wrap items-center gap-1.5 border-l border-white/15 pl-3">
          {boards.map((b) => (
            <button
              key={b.id}
              onClick={() => setBoardId(b.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                boardId === b.id
                  ? "bg-white text-slate-950 shadow-lg"
                  : "border border-white/10 bg-white/5 text-cyan-50/80 hover:border-white/25 hover:bg-white/10 hover:text-white"
              }`}
            >
              {b.name}
            </button>
          ))}
          {isAdmin && sectorId !== null && (
            <button
              onClick={() => setModal("board")}
              className="rounded-xl border border-dashed border-cyan-200/50 px-2.5 py-1.5 text-sm font-bold text-cyan-50 transition hover:border-cyan-100 hover:bg-white/10"
            >
              <Plus className="inline h-3.5 w-3.5" /> Quadro
            </button>
          )}
          {board && (
            <button
              onClick={() => setModal("labels")}
              title="Criar e editar as etiquetas deste quadro"
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-2.5 py-1.5 text-sm font-bold text-cyan-50 shadow-sm transition hover:bg-white/15"
            >
              <Tag className="h-3.5 w-3.5" /> Etiquetas
            </button>
          )}
        </div>

        {/* Ferramentas do quadro */}
        {board && (
          <div className="flex flex-wrap items-center gap-1.5 border-l border-white/15 pl-3">
            <HeaderTool icon={<Copy className="h-3.5 w-3.5" />} label="Modelos" onClick={() => setModal("templates")} />
            <HeaderTool icon={<Zap className="h-3.5 w-3.5" />} label="Automações" onClick={() => setModal("automations")} />
            <HeaderTool icon={<Settings2 className="h-3.5 w-3.5" />} label="Campos" onClick={() => setModal("fields")} />
            <HeaderTool icon={<Link2 className="h-3.5 w-3.5" />} label="Integrações" onClick={() => setModal("integrations")} />
            <HeaderTool icon={<Archive className="h-3.5 w-3.5" />} label="Arquivo" onClick={() => setModal("archive")} />
            <HeaderTool icon={<Keyboard className="h-3.5 w-3.5" />} label="Atalhos" onClick={() => setModal("shortcuts")} />
          </div>
        )}

        {isMaster && (
          <div className="ml-auto flex items-center gap-2">
            {currentSector && (
              <button
                onClick={() => setModal("sector-edit")}
                title="Editar setor (nome, cor e quais equipes têm acesso)"
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-2.5 py-1.5 text-xs font-bold text-cyan-50 shadow-sm transition hover:bg-white/15"
              >
                <Pencil className="h-3.5 w-3.5" /> Acesso
              </button>
            )}
            <button
              onClick={() => setModal("teams")}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-2.5 py-1.5 text-xs font-black text-slate-950 shadow-sm transition hover:bg-cyan-50"
            >
              <Users className="h-3.5 w-3.5" /> Equipes e usuários
            </button>
            <button
              onClick={() => setModal("sector")}
              className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-300 px-2.5 py-1.5 text-xs font-black text-slate-950 shadow-sm transition hover:bg-cyan-200"
            >
              <Plus className="h-3.5 w-3.5" /> Setor
            </button>
          </div>
        )}
        </div>
      </header>

      {/* Barra de visões + busca + filtros */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/80 bg-white/80 px-5 py-2 backdrop-blur">
        <div className="flex flex-wrap items-center gap-1">
          {VIEWS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                onClick={() => setView(item.key)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-black transition ${
                  view === item.key
                    ? "bg-slate-900 text-white shadow-sm"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <Icon className="size-3.5" /> {item.label}
              </button>
            );
          })}
          <a
            href="/tarefas/auditoria"
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs font-black text-violet-700 transition hover:bg-violet-100"
          >
            <History className="size-3.5" /> Auditoria
          </a>
        </div>

        {view !== "workspace" && view !== "geral" && (
          <>
            <div className="relative ml-auto min-w-48 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchRef}
                value={filters.text}
                onChange={(event) => setFilters((cur) => ({ ...cur, text: event.target.value }))}
                placeholder="Buscar tarefa…  (tecle /)"
                className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-2 text-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              />
            </div>
            <button
              onClick={() => setFilters((cur) => ({ ...cur, onlyMine: !cur.onlyMine }))}
              disabled={currentMemberId === null}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-black transition disabled:opacity-40 ${
                filters.onlyMine ? "bg-cyan-600 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Users className="size-3.5" /> Minhas
            </button>
            <button
              onClick={() => setShowFilters((value) => !value)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-black transition ${
                filtersActive ? "bg-amber-500 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              <SlidersHorizontal className="size-3.5" /> Filtros
              {filtersActive && <span className="rounded-full bg-white/30 px-1.5 text-[10px]">on</span>}
            </button>
            {filtersActive && (
              <button
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-50"
              >
                <X className="size-3" /> Limpar
              </button>
            )}
          </>
        )}
      </div>

      {showFilters && board && view !== "workspace" && view !== "geral" && (
        <FilterPanel board={board} members={members} filters={filters} onChange={setFilters} />
      )}

      {board && view !== "workspace" && view !== "geral" ? (
        <div className="grid gap-2 border-b border-slate-200/80 bg-white/75 px-5 py-3 backdrop-blur sm:grid-cols-2 lg:grid-cols-5">
          <TaskMetric icon={<ListTodo />} label="Em aberto" value={taskStats.open} tone="slate" />
          <TaskMetric icon={<CircleDot />} label={filtersActive ? "Filtradas" : "No quadro"} value={taskStats.total} tone="cyan" />
          <TaskMetric icon={<CalendarClock />} label="Prazo próximo" value={taskStats.dueSoon} tone="amber" />
          <TaskMetric icon={<CalendarClock />} label="Em atraso" value={taskStats.overdue} tone="rose" />
          <TaskMetric icon={<CheckCircle2 />} label="Concluídas" value={taskStats.completed} tone="emerald" />
        </div>
      ) : null}

      {/* Corpo */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {view === "geral" ? (
          <GeneralView
            boards={workspaceBoards}
            tasks={generalTasks}
            memberById={memberById}
            onOpenTask={(task) => openWorkspaceBoard(task.boardId, task.id)}
            onOpenBoard={(id) => openWorkspaceBoard(id)}
          />
        ) : view === "workspace" ? (
          <WorkspaceView
            boards={workspaceBoards}
            onOpenBoard={(id) => openWorkspaceBoard(id)}
          />
        ) : sectors.length === 0 ? (
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
        ) : view === "tabela" ? (
          <TableView board={board} tasks={filteredTasks} memberById={memberById} onOpen={setEditingTask} />
        ) : view === "calendario" ? (
          <CalendarView board={board} tasks={filteredTasks} onOpen={setEditingTask} />
        ) : view === "timeline" ? (
          <TimelineView board={board} tasks={filteredTasks} memberById={memberById} onOpen={setEditingTask} />
        ) : view === "painel" ? (
          <DashboardView board={board} tasks={filteredTasks} memberById={memberById} />
        ) : (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            {/* snap-x: no celular cada coluna "encaixa" em vez de parar no meio. */}
            <div className="flex h-full snap-x snap-mandatory items-start gap-4 overflow-x-auto p-5 sm:snap-none">
              {board.columns.map((col) => (
                <Column
                  key={col.id}
                  column={col}
                  tasks={tasksInColumn(col.id)}
                  totalInColumn={allTasksInColumn(col.id).length}
                  labels={board.labels}
                  customFields={board.customFields}
                  memberById={memberById}
                  canManage={isAdmin}
                  onOpenTask={setEditingTask}
                  onQuickAdd={(title) => quickAdd(col.id, title)}
                  onUpdateColumn={async (changes) => {
                    await fetch(`/api/tasks/columns/${col.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(changes),
                    });
                    void loadBoard();
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

      {editingTask && board && (
        <CardModal
          task={editingTask}
          board={board}
          members={members}
          automations={automations}
          onClose={() => setEditingTask(null)}
          onChanged={loadBoard}
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
      {modal === "automations" && board && (
        <AutomationsModal board={board} members={members} canEdit={isAdmin} onClose={() => setModal(null)} />
      )}
      {modal === "fields" && board && (
        <CustomFieldsModal board={board} onClose={() => setModal(null)} onChanged={loadBoard} />
      )}
      {modal === "templates" && board && (
        <TemplatesModal board={board} onClose={() => setModal(null)} onCreated={loadBoard} />
      )}
      {modal === "integrations" && board && (
        <IntegrationsModal
          board={board}
          sectorId={sectorId}
          isMaster={isMaster}
          onClose={() => setModal(null)}
          onImported={() => {
            // O quadro importado é novo: recarrega a lista de quadros do setor.
            if (sectorId !== null) {
              void fetch(`/api/tasks/boards?sectorId=${sectorId}`)
                .then((r) => r.json())
                .then((d) => setBoards(d.boards ?? []));
            }
          }}
        />
      )}
      {modal === "archive" && board && (
        <ArchiveModal boardId={board.board.id} onClose={() => setModal(null)} onChanged={loadBoard} />
      )}
      {modal === "shortcuts" && <ShortcutsModal onClose={() => setModal(null)} />}
    </main>
  );
}

/** Botão pequeno da barra de ferramentas do quadro (topo escuro). */
function HeaderTool({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-2.5 py-1.5 text-xs font-bold text-cyan-50 shadow-sm transition hover:bg-white/15"
    >
      {icon} <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

/** Painel de filtros (etiqueta, responsável, prioridade e situação). */
function FilterPanel({
  board,
  members,
  filters,
  onChange,
}: {
  board: BoardData;
  members: Member[];
  filters: Filters;
  onChange: (updater: (cur: Filters) => Filters) => void;
}) {
  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  }

  return (
    <div className="flex flex-wrap gap-4 border-b border-slate-200/80 bg-white/90 px-5 py-3">
      <div>
        <p className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-slate-400">
          <Tag className="size-3" /> Etiquetas
        </p>
        <div className="flex flex-wrap gap-1">
          {board.labels.length === 0 && <span className="text-xs text-slate-400">nenhuma</span>}
          {board.labels.map((label) => {
            const on = filters.labelIds.includes(label.id);
            return (
              <button
                key={label.id}
                onClick={() => onChange((cur) => ({ ...cur, labelIds: toggle(cur.labelIds, label.id) }))}
                style={on ? { backgroundColor: label.color, color: "white" } : { color: label.color, borderColor: label.color }}
                className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${on ? "" : "bg-white"}`}
              >
                {label.name}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-slate-400">
          <Users className="size-3" /> Responsáveis
        </p>
        <div className="flex flex-wrap gap-1">
          {members.map((member) => {
            const on = filters.memberIds.includes(member.id);
            return (
              <button
                key={member.id}
                onClick={() => onChange((cur) => ({ ...cur, memberIds: toggle(cur.memberIds, member.id) }))}
                className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                  on ? "border-cyan-400 bg-cyan-50 text-cyan-800" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {member.name.split(" ")[0]}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-slate-400">
          <Filter className="size-3" /> Prioridade
        </p>
        <div className="flex flex-wrap gap-1">
          {(Object.keys(PRIORITY) as TaskPriority[]).map((value) => {
            const on = filters.priorities.includes(value);
            return (
              <button
                key={value}
                onClick={() => onChange((cur) => ({ ...cur, priorities: toggle(cur.priorities, value) }))}
                className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                  on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {PRIORITY[value].label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-400">Situação</p>
        <select
          value={filters.status}
          onChange={(event) => onChange((cur) => ({ ...cur, status: event.target.value as Filters["status"] }))}
          className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold"
        >
          <option value="todos">Todas</option>
          <option value="abertas">Em aberto</option>
          <option value="concluidas">Concluídas</option>
          <option value="atrasadas">Atrasadas</option>
          <option value="sem_prazo">Sem prazo</option>
        </select>
      </div>
    </div>
  );
}

function TaskMetric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: "slate" | "cyan" | "amber" | "rose" | "emerald" }) {
  const styles = {
    slate: "bg-slate-100 text-slate-600",
    cyan: "bg-cyan-50 text-cyan-700",
    amber: "bg-amber-50 text-amber-700",
    rose: "bg-rose-50 text-rose-700",
    emerald: "bg-emerald-50 text-emerald-700",
  }[tone];
  return <div className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2 shadow-sm"><span className={`grid size-8 place-content-center rounded-lg ${styles}`}>{icon}</span><div><p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">{label}</p><p className="text-lg font-black leading-5 text-slate-950">{value}</p></div></div>;
}

// ── Coluna ───────────────────────────────────────────────────────────────────
function Column({
  column,
  tasks,
  totalInColumn,
  labels,
  customFields,
  memberById,
  canManage,
  onOpenTask,
  onQuickAdd,
  onUpdateColumn,
}: {
  column: TaskColumn;
  tasks: TaskCard[];
  /** Contagem real da coluna (sem filtro) — é ela que vale para o limite WIP. */
  totalInColumn: number;
  labels: BoardData["labels"];
  customFields: BoardData["customFields"];
  memberById: Map<number, Member>;
  canManage: boolean;
  onOpenTask: (t: TaskCard) => void;
  onQuickAdd: (title: string) => void;
  onUpdateColumn: (changes: Record<string, unknown>) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${column.id}` });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(column.name);
  const taskIds = tasks.map((t) => `task-${t.id}`);
  const overWip = column.wipLimit !== null && totalInColumn > column.wipLimit;

  return (
    <div className="flex max-h-full w-80 flex-shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-slate-100/80 shadow-[0_10px_28px_rgba(15,23,42,0.08)] backdrop-blur-sm">
      <div className="border-t-4 bg-white/80 px-3.5 py-3" style={{ borderTopColor: column.color ?? "#64748b" }}>
        <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full ring-4 ring-white" style={{ backgroundColor: column.color ?? "#64748b" }} />
        {editing ? (
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              setEditing(false);
              if (name.trim() && name !== column.name) onUpdateColumn({ name: name.trim() });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setName(column.name);
                setEditing(false);
              }
            }}
            className="min-w-0 flex-1 rounded border border-slate-300 px-1 text-sm font-black text-slate-800"
          />
        ) : (
          <h3
            onDoubleClick={() => canManage && setEditing(true)}
            title={canManage ? "Duplo clique para renomear" : undefined}
            className="text-sm font-black text-slate-800"
          >
            {column.name}
          </h3>
        )}
        {column.completesTask && (
          <span title="Card que entra aqui vira concluído" className="text-emerald-600">
            <CheckCircle2 className="size-3.5" />
          </span>
        )}
        <span
          className={`ml-auto min-w-6 rounded-full px-2 py-0.5 text-center text-xs font-black tabular-nums ${
            overWip ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600"
          }`}
          title={column.wipLimit !== null ? `Limite de ${column.wipLimit} card(s) em andamento` : undefined}
        >
          {tasks.length}
          {column.wipLimit !== null ? `/${column.wipLimit}` : ""}
        </span>
        {canManage && (
          <ColumnMenu column={column} onUpdateColumn={onUpdateColumn} />
        )}
        </div>
        <p className={`mt-1 pl-4 text-[10px] font-semibold ${overWip ? "text-rose-600" : "text-slate-400"}`}>
          {overWip ? "Acima do limite de WIP — termine antes de puxar mais." : "Arraste ou crie uma nova tarefa"}
        </p>
      </div>
      <div
        ref={setNodeRef}
        className={`min-h-[60px] flex-1 space-y-2 overflow-y-auto px-2.5 pb-2.5 pt-2.5 transition-colors ${isOver ? "rounded-xl bg-cyan-100/80 ring-2 ring-inset ring-cyan-300" : ""}`}
      >
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCardView
              key={task.id}
              task={task}
              labels={labels}
              customFields={customFields}
              memberById={memberById}
              onClick={() => onOpenTask(task)}
            />
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
            className="flex w-full items-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-2.5 py-2 text-sm font-bold text-slate-600 transition hover:border-cyan-300 hover:bg-white hover:text-cyan-700"
          >
            <Plus className="h-4 w-4" /> Adicionar tarefa
          </button>
        )}
      </div>
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────
/** Menu da coluna: cor, limite de WIP, coluna que conclui e arquivar. */
function ColumnMenu({
  column,
  onUpdateColumn,
}: {
  column: TaskColumn;
  onUpdateColumn: (changes: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        title="Configurar coluna"
        className="rounded p-0.5 text-slate-300 transition hover:bg-slate-100 hover:text-slate-600"
      >
        <Settings2 className="size-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-6 z-20 w-56 space-y-2 rounded-xl border border-slate-200 bg-white p-2.5 shadow-xl">
            <div>
              <label className="text-[10px] font-black uppercase text-slate-400">Cor</label>
              <input
                type="color"
                defaultValue={column.color ?? "#64748b"}
                onBlur={(event) => onUpdateColumn({ color: event.target.value })}
                className="h-7 w-full rounded border border-slate-200"
              />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase text-slate-400">Limite de WIP</label>
              <input
                type="number"
                min={0}
                defaultValue={column.wipLimit ?? ""}
                placeholder="sem limite"
                onBlur={(event) =>
                  onUpdateColumn({ wipLimit: event.target.value === "" ? null : Number(event.target.value) })
                }
                className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
              />
            </div>
            <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
              <input
                type="checkbox"
                defaultChecked={column.completesTask}
                onChange={(event) => onUpdateColumn({ completesTask: event.target.checked })}
                className="size-3.5"
              />
              Entrar aqui conclui a tarefa
            </label>
            <button
              onClick={() => {
                if (window.confirm(`Arquivar a coluna "${column.name}"? Os cards dela continuam no arquivo.`)) {
                  onUpdateColumn({ archived: true });
                  setOpen(false);
                }
              }}
              className="flex w-full items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
            >
              <Archive className="size-3" /> Arquivar coluna
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function TaskCardView({
  task,
  labels,
  customFields,
  memberById,
  onClick,
}: {
  task: TaskCard;
  labels: BoardData["labels"];
  customFields: BoardData["customFields"];
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
  const priority = PRIORITY[task.priority];

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
      aria-label={`Abrir tarefa: ${task.title}`}
      className={`group relative cursor-grab overflow-hidden rounded-2xl border border-white/90 bg-white shadow-[0_3px_14px_rgba(15,23,42,0.1)] ring-1 ring-slate-200/80 transition-[border,box-shadow,transform] duration-200 hover:-translate-y-1 hover:border-cyan-200 hover:shadow-[0_16px_28px_rgba(8,145,178,0.16)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 active:cursor-grabbing ${
        isDragging ? "scale-[0.98] rotate-[1deg] opacity-50 shadow-2xl" : ""
      } ${task.completedAt ? "bg-slate-50/90" : ""}`}
    >
      {/* Capa do card: imagem ou cor sólida. */}
      {task.coverAttachmentId ? (
        <div
          className="h-20 w-full bg-cover bg-center"
          style={{ backgroundImage: `url(/api/tasks/attachments/${task.coverAttachmentId})` }}
        />
      ) : task.coverColor ? (
        <div className="h-8 w-full" style={{ backgroundColor: task.coverColor }} />
      ) : null}
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${PRIORITY_CARD_ACCENT[task.priority]}`} />
      <div className="p-3.5 pt-4">
        <div className="mb-2 flex items-center gap-1.5">
          <span
            title="Arraste para mover"
            className="-ml-1 flex size-5 items-center justify-center rounded-md text-slate-300 transition group-hover:bg-slate-100 group-hover:text-slate-500"
          >
            <GripVertical className="size-3.5" />
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${priority.chip}`}>
            <span className={`size-1.5 rounded-full ${priority.dot}`} />
            {priority.label}
          </span>
          {task.completedAt && (
            <span
              title={`Concluída em ${new Date(task.completedAt).toLocaleDateString("pt-BR")}`}
              className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-extrabold text-emerald-700"
            >
              <CheckCircle2 className="size-3" /> {completedLabel(task.completedAt)}
            </span>
          )}
        </div>
        <p className={`text-[15px] font-extrabold leading-5 tracking-[-0.01em] text-slate-900 ${task.completedAt ? "text-slate-500 line-through" : ""}`}>{task.title}</p>
        {task.description && (
          <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-slate-500">{task.description}</p>
        )}
        {taskLabels.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {/* Etiquetas usam o nome e a cor: a informação não depende de memória visual. */}
            {taskLabels.map((l) => (
              <span
                key={l.id}
                className="inline-flex items-center gap-1 rounded-md border border-black/5 bg-white px-1.5 py-1 text-[10px] font-bold text-slate-600 shadow-sm"
              >
                <span className="size-1.5 rounded-full" style={{ backgroundColor: l.color }} />
                {l.name}
              </span>
            ))}
          </div>
        )}
        {/* Campos personalizados marcados como "mostrar no card". */}
        {customFields.some((field) => field.showOnCard && task.customValues?.[field.id]) && (
          <div className="mt-2 flex flex-wrap gap-1">
            {customFields
              .filter((field) => field.showOnCard && task.customValues?.[field.id])
              .map((field) => (
                <span
                  key={field.id}
                  className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600"
                >
                  {field.name}: {field.type === "checkbox" ? "sim" : task.customValues[field.id]}
                </span>
              ))}
          </div>
        )}

        {/* Selos de conteúdo: só aparecem quando existe conteúdo de verdade. */}
        {(task.checklistTotal > 0 || task.commentCount > 0 || task.attachmentCount > 0 || task.startDate) && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-bold text-slate-500">
            {task.checklistTotal > 0 && (
              <span
                className={`inline-flex items-center gap-1 rounded px-1 py-0.5 ${
                  task.checklistDone === task.checklistTotal ? "bg-emerald-50 text-emerald-700" : "bg-slate-100"
                }`}
              >
                <Check className="size-3" /> {task.checklistDone}/{task.checklistTotal}
              </span>
            )}
            {task.commentCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <MessageSquare className="size-3" /> {task.commentCount}
              </span>
            )}
            {task.attachmentCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <Paperclip className="size-3" /> {task.attachmentCount}
              </span>
            )}
            {task.startDate && (
              <span className="inline-flex items-center gap-1" title="Data de início">
                <CalendarDays className="size-3" /> {new Date(`${task.startDate}T00:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
              </span>
            )}
          </div>
        )}

        <div className="mt-3 flex min-h-7 items-center gap-1.5 border-t border-slate-100 pt-2.5">
          {due ? (
            <span
              className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-extrabold ${DUE_TONE[due.tone]}`}
            >
              <CalendarClock className="size-3" /> {due.tone === "overdue" ? `Atrasada · ${due.text}` : due.text}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400">
              <CalendarClock className="size-3" /> Sem prazo
            </span>
          )}
          {task.assigneeIds.length > 0 ? (
            <div className="ml-auto flex -space-x-2">
              {task.assigneeIds.slice(0, 3).map((id) => (
                <span
                  key={id}
                  title={memberById.get(id)?.name}
                  className="flex size-6 items-center justify-center rounded-full bg-gradient-to-br from-cyan-100 to-blue-100 text-[9px] font-black text-cyan-800 ring-2 ring-white shadow-sm"
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
                  className="flex size-6 items-center justify-center rounded-full bg-slate-200 text-[9px] font-black text-slate-700 ring-2 ring-white shadow-sm"
                >
                  +{task.assigneeIds.length - 3}
                </span>
              )}
            </div>
          ) : (
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400">
              <Users className="size-3" /> Sem responsável
            </span>
          )}
        </div>
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
