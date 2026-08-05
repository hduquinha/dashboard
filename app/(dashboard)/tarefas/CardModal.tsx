"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlignLeft,
  Archive,
  CalendarClock,
  Check,
  CheckSquare,
  Clock,
  Copy,
  Eye,
  History,
  Image as ImageIcon,
  Link2,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  Save,
  Tag,
  Trash2,
  Users,
  X,
  Zap,
} from "lucide-react";
import Markdown from "./Markdown";
import type { BoardData, TaskCard, TaskCustomField, TaskPriority } from "@/lib/tasks";
import type { TaskActivityEntry, TaskAttachment, TaskChecklist, TaskComment } from "@/lib/taskDetails";
import type { TaskAutomation } from "@/lib/taskAutomations";
import type { TeamRole } from "@/lib/permissions";

export interface Member {
  id: number;
  name: string;
  email: string;
  role?: TeamRole;
}

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  urgente: "Urgente",
};

const COVER_COLORS = ["#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#64748b", "#0f172a"];
const REACTION_EMOJIS = ["👍", "🎉", "🚀", "👀", "❤️", "😄"];

function initials(name: string): string {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

function when(iso: string): string {
  const date = new Date(iso);
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  if (minutes < 1440) return `há ${Math.round(minutes / 60)}h`;
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Frases do histórico — o log guarda a ação crua, a tela traduz. */
const ACTIVITY_LABEL: Record<string, string> = {
  card_created: "criou este card",
  card_updated: "editou o card",
  card_moved: "moveu o card de coluna",
  card_completed: "concluiu o card",
  card_archived: "arquivou o card",
  card_restored: "restaurou o card",
  card_deleted: "excluiu um card",
  comment_added: "comentou",
  checklist_created: "criou uma checklist",
  checklist_item_done: "marcou um item da checklist",
  attachment_added: "anexou um arquivo",
  members_changed: "mudou os responsáveis",
  labels_changed: "mudou as etiquetas",
  custom_fields_changed: "preencheu campos personalizados",
  automation_ran: "automação executada",
  automation_scheduled: "comando agendado executado",
};

interface Props {
  task: TaskCard;
  board: BoardData;
  members: Member[];
  automations: TaskAutomation[];
  onClose: () => void;
  /** Recarrega o quadro depois de qualquer mudança que apareça no card. */
  onChanged: () => void;
}

export default function CardModal({ task: initialTask, board, members, automations, onClose, onChanged }: Props) {
  const [task, setTask] = useState<TaskCard>(initialTask);
  const [tab, setTab] = useState<"detalhes" | "atividade">("detalhes");
  const [checklists, setChecklists] = useState<TaskChecklist[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [activity, setActivity] = useState<TaskActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState(initialTask.title);
  const [description, setDescription] = useState(initialTask.description ?? "");
  const [editingDescription, setEditingDescription] = useState(false);
  const [priority, setPriority] = useState<TaskPriority>(initialTask.priority);
  const [startDate, setStartDate] = useState(initialTask.startDate ?? "");
  const [dueDate, setDueDate] = useState(initialTask.dueDate ?? "");
  const [assigneeIds, setAssigneeIds] = useState<number[]>(initialTask.assigneeIds);
  const [labelIds, setLabelIds] = useState<number[]>(initialTask.labelIds);
  const [completed, setCompleted] = useState(Boolean(initialTask.completedAt));
  // completedAt vem como ISO em UTC; o input type=date só quer o dia.
  const [completedDate, setCompletedDate] = useState(initialTask.completedAt?.slice(0, 10) ?? "");
  const [customValues, setCustomValues] = useState<Record<number, string>>(initialTask.customValues ?? {});
  const [newComment, setNewComment] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const buttons = automations.filter((a) => a.kind === "button" && a.enabled);

  const loadDetail = useCallback(async () => {
    try {
      const data = await fetch(`/api/tasks/cards/${initialTask.id}/detail`).then((r) => r.json());
      if (data.task) setTask(data.task);
      setChecklists(data.checklists ?? []);
      setComments(data.comments ?? []);
      setAttachments(data.attachments ?? []);
      setActivity(data.activity ?? []);
    } finally {
      setLoading(false);
    }
  }, [initialTask.id]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  // Esc fecha o card — o mesmo atalho do Trello.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function patchTask(payload: Record<string, unknown>, reload = true) {
    const res = await fetch(`/api/tasks/cards/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (data?.task) setTask(data.task);
    if (reload) onChanged();
    return res.ok;
  }

  async function saveAll() {
    setSaving(true);
    await patchTask({
      title,
      description,
      priority,
      startDate: startDate || null,
      dueDate: dueDate || null,
      assigneeIds,
      labelIds,
      completed,
      // Só manda a data quando o usuário informou uma: sem isso o backend
      // carimba/preserva sozinho pelo checkbox. Desmarcar "concluída" limpa
      // tudo via `completed: false`.
      ...(completed && completedDate ? { completedAt: completedDate } : {}),
      customValues,
    });
    setSaving(false);
    await loadDetail();
  }

  async function addChecklist() {
    const name = window.prompt("Nome da checklist:", "Checklist");
    if (!name) return;
    await fetch("/api/tasks/checklists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id, name }),
    });
    await loadDetail();
    onChanged();
  }

  async function addChecklistItem(checklistId: number, text: string) {
    if (!text.trim()) return;
    await fetch("/api/tasks/checklist-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checklistId, text }),
    });
    await loadDetail();
    onChanged();
  }

  async function toggleItem(itemId: number, done: boolean) {
    // Otimista: marcar item é a ação mais repetida do card, esperar o servidor
    // deixaria o clique com cara de travado.
    setChecklists((cur) =>
      cur.map((list) => ({
        ...list,
        items: list.items.map((item) => (item.id === itemId ? { ...item, done } : item)),
      }))
    );
    await fetch(`/api/tasks/checklist-items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done }),
    });
    onChanged();
  }

  async function uploadFile(file: File) {
    const form = new FormData();
    form.append("taskId", String(task.id));
    form.append("file", file);
    const res = await fetch("/api/tasks/attachments", { method: "POST", body: form });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      window.alert(data?.error ?? "Falha ao anexar o arquivo.");
      return;
    }
    await loadDetail();
    onChanged();
  }

  async function addLink() {
    const url = window.prompt("Cole o link (http/https):");
    if (!url) return;
    await fetch("/api/tasks/attachments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id, url }),
    });
    await loadDetail();
    onChanged();
  }

  async function sendComment() {
    const body = newComment.trim();
    if (!body) return;
    setNewComment("");
    await fetch("/api/tasks/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id, body }),
    });
    await loadDetail();
    onChanged();
  }

  async function react(commentId: number, emoji: string) {
    await fetch(`/api/tasks/comments/${commentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji }),
    });
    await loadDetail();
  }

  async function saveAsTemplate() {
    const name = window.prompt("Nome do modelo:", title);
    if (!name) return;
    await fetch("/api/tasks/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        boardId: task.boardId,
        name,
        payload: {
          title,
          description,
          priority,
          labelIds,
          assigneeIds,
          checklists: checklists.map((list) => ({ name: list.name, items: list.items.map((i) => i.text) })),
        },
      }),
    });
    window.alert("Modelo salvo. Ele aparece no botão “Modelos” do quadro.");
  }

  async function runButton(automationId: number) {
    await fetch(`/api/tasks/automations/${automationId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id }),
    });
    await loadDetail();
    onChanged();
  }

  const coverAttachment = attachments.find((a) => a.id === task.coverAttachmentId);
  const checklistTotal = checklists.reduce((sum, list) => sum + list.items.length, 0);
  const checklistDone = checklists.reduce((sum, list) => sum + list.items.filter((i) => i.done).length, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-3 sm:p-6" onClick={onClose}>
      <div
        className="w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Capa */}
        {(task.coverColor || coverAttachment) && (
          <div
            className="h-28 w-full bg-cover bg-center"
            style={
              coverAttachment
                ? { backgroundImage: `url(/api/tasks/attachments/${coverAttachment.id})` }
                : { backgroundColor: task.coverColor ?? undefined }
            }
          />
        )}

        <div className="flex items-start gap-3 border-b border-slate-100 p-4">
          <div className="min-w-0 flex-1">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full text-lg font-black tracking-tight text-slate-900 focus:outline-none"
            />
            <p className="mt-0.5 text-xs font-semibold text-slate-400">
              {board.board.name} · {board.columns.find((c) => c.id === task.columnId)?.name ?? "sem coluna"} · #{task.id}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setTab(tab === "detalhes" ? "atividade" : "detalhes")}
              title="Ver histórico do card"
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
                tab === "atividade" ? "bg-slate-900 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              <History className="size-3.5" /> Atividade
            </button>
            <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
              <X className="size-5" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center text-slate-400">
            <Loader2 className="mr-2 size-5 animate-spin" /> Carregando card…
          </div>
        ) : tab === "atividade" ? (
          <div className="max-h-[70vh] space-y-2 overflow-y-auto p-4">
            {activity.length === 0 && <p className="text-sm text-slate-400">Nada registrado ainda.</p>}
            {activity.map((entry) => (
              <div key={entry.id} className="flex gap-2.5 rounded-xl border border-slate-100 bg-slate-50/60 p-2.5">
                <span className="mt-0.5 flex size-7 flex-shrink-0 items-center justify-center rounded-full bg-white text-[9px] font-black text-slate-600 shadow-sm">
                  {initials(entry.actorName ?? "?")}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-700">
                    {entry.actorName ?? "Alguém"}{" "}
                    <span className="font-medium text-slate-500">{ACTIVITY_LABEL[entry.action] ?? entry.action}</span>
                  </p>
                  {Object.keys(entry.detail ?? {}).length > 0 && (
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded bg-white p-1.5 text-[10px] leading-4 text-slate-500">
                      {JSON.stringify(entry.detail, null, 1)}
                    </pre>
                  )}
                  <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{when(entry.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid max-h-[70vh] gap-4 overflow-y-auto p-4 lg:grid-cols-[1fr_260px]">
            {/* Coluna principal */}
            <div className="space-y-5">
              {/* Descrição */}
              <section>
                <div className="mb-1.5 flex items-center gap-2">
                  <AlignLeft className="size-4 text-slate-400" />
                  <h3 className="text-sm font-black text-slate-800">Descrição</h3>
                  <button
                    onClick={() => setEditingDescription((value) => !value)}
                    className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-500 hover:bg-slate-50"
                  >
                    {editingDescription ? <><Eye className="size-3" /> Ver</> : <>Editar</>}
                  </button>
                </div>
                {editingDescription ? (
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={8}
                    placeholder="Aceita markdown: **negrito**, listas, `código`, tabelas, [links](url), imagens…"
                    className="w-full rounded-xl border border-slate-200 p-2.5 font-mono text-xs leading-5 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                  />
                ) : description.trim() ? (
                  <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                    <Markdown source={description} />
                  </div>
                ) : (
                  <button
                    onClick={() => setEditingDescription(true)}
                    className="w-full rounded-xl border border-dashed border-slate-300 p-3 text-left text-sm text-slate-400 hover:border-cyan-300 hover:text-cyan-700"
                  >
                    Adicionar uma descrição mais detalhada…
                  </button>
                )}
              </section>

              {/* Checklists */}
              <section>
                <div className="mb-1.5 flex items-center gap-2">
                  <CheckSquare className="size-4 text-slate-400" />
                  <h3 className="text-sm font-black text-slate-800">
                    Checklists {checklistTotal > 0 && <span className="text-slate-400">({checklistDone}/{checklistTotal})</span>}
                  </h3>
                  <button
                    onClick={addChecklist}
                    className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-500 hover:bg-slate-50"
                  >
                    <Plus className="size-3" /> Nova
                  </button>
                </div>
                {checklistTotal > 0 && (
                  <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${Math.round((checklistDone / checklistTotal) * 100)}%` }}
                    />
                  </div>
                )}
                <div className="space-y-3">
                  {checklists.map((list) => (
                    <ChecklistBlock
                      key={list.id}
                      checklist={list}
                      members={members}
                      onToggle={toggleItem}
                      onAddItem={(text) => addChecklistItem(list.id, text)}
                      onDeleteList={async () => {
                        if (!window.confirm(`Excluir a checklist "${list.name}"?`)) return;
                        await fetch(`/api/tasks/checklists/${list.id}`, { method: "DELETE" });
                        await loadDetail();
                        onChanged();
                      }}
                      onDeleteItem={async (itemId) => {
                        await fetch(`/api/tasks/checklist-items/${itemId}`, { method: "DELETE" });
                        await loadDetail();
                        onChanged();
                      }}
                      onAssignItem={async (itemId, memberId, due) => {
                        await fetch(`/api/tasks/checklist-items/${itemId}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ memberId, dueDate: due }),
                        });
                        await loadDetail();
                      }}
                    />
                  ))}
                  {checklists.length === 0 && (
                    <p className="text-xs text-slate-400">Nenhuma checklist. Use para quebrar a tarefa em passos.</p>
                  )}
                </div>
              </section>

              {/* Anexos */}
              <section>
                <div className="mb-1.5 flex items-center gap-2">
                  <Paperclip className="size-4 text-slate-400" />
                  <h3 className="text-sm font-black text-slate-800">Anexos</h3>
                  <div className="ml-auto flex gap-1">
                    <button
                      onClick={() => fileInput.current?.click()}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-500 hover:bg-slate-50"
                    >
                      <Plus className="size-3" /> Arquivo
                    </button>
                    <button
                      onClick={addLink}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-500 hover:bg-slate-50"
                    >
                      <Link2 className="size-3" /> Link
                    </button>
                  </div>
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadFile(file);
                    event.target.value = "";
                  }}
                />
                <div className="space-y-1.5">
                  {attachments.map((attachment) => (
                    <div key={attachment.id} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white p-2">
                      {attachment.isImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/tasks/attachments/${attachment.id}`}
                          alt={attachment.name}
                          className="size-10 flex-shrink-0 rounded object-cover"
                        />
                      ) : (
                        <span className="grid size-10 flex-shrink-0 place-content-center rounded bg-slate-100 text-slate-500">
                          {attachment.kind === "link" ? <Link2 className="size-4" /> : <Paperclip className="size-4" />}
                        </span>
                      )}
                      <a
                        href={attachment.kind === "link" ? attachment.url ?? "#" : `/api/tasks/attachments/${attachment.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 flex-1 truncate text-xs font-bold text-slate-700 hover:text-cyan-700"
                      >
                        {attachment.name}
                        {attachment.sizeBytes ? (
                          <span className="ml-1 font-medium text-slate-400">
                            ({Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB)
                          </span>
                        ) : null}
                      </a>
                      {attachment.isImage && (
                        <button
                          onClick={() => patchTask({ coverAttachmentId: attachment.id, coverColor: null })}
                          title="Usar como capa do card"
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <ImageIcon className="size-3.5" />
                        </button>
                      )}
                      <button
                        onClick={async () => {
                          if (!window.confirm(`Excluir "${attachment.name}"?`)) return;
                          await fetch(`/api/tasks/attachments/${attachment.id}`, { method: "DELETE" });
                          await loadDetail();
                          onChanged();
                        }}
                        className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                  {attachments.length === 0 && <p className="text-xs text-slate-400">Nenhum anexo.</p>}
                </div>
              </section>

              {/* Comentários */}
              <section>
                <div className="mb-1.5 flex items-center gap-2">
                  <MessageSquare className="size-4 text-slate-400" />
                  <h3 className="text-sm font-black text-slate-800">Comentários</h3>
                </div>
                <div className="mb-2 rounded-xl border border-slate-200 p-2">
                  <textarea
                    value={newComment}
                    onChange={(event) => setNewComment(event.target.value)}
                    onKeyDown={(event) => {
                      // Ctrl+Enter envia — quem comenta muito não quer tirar a
                      // mão do teclado pra clicar.
                      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void sendComment();
                    }}
                    rows={2}
                    placeholder="Escreva um comentário… use @nome para citar alguém (Ctrl+Enter envia)"
                    className="w-full resize-none text-sm focus:outline-none"
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={sendComment}
                      disabled={!newComment.trim()}
                      className="rounded-lg bg-slate-950 px-3 py-1 text-xs font-bold text-white disabled:opacity-40"
                    >
                      Comentar
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  {comments.map((comment) => (
                    <div key={comment.id} className="rounded-xl border border-slate-100 bg-white p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="flex size-6 items-center justify-center rounded-full bg-gradient-to-br from-cyan-100 to-blue-100 text-[9px] font-black text-cyan-800">
                          {initials(comment.authorName)}
                        </span>
                        <span className="text-xs font-black text-slate-700">{comment.authorName}</span>
                        <span className="text-[10px] font-semibold text-slate-400">{when(comment.createdAt)}</span>
                        {comment.editedAt && <span className="text-[10px] text-slate-300">(editado)</span>}
                        <button
                          onClick={async () => {
                            if (!window.confirm("Excluir este comentário?")) return;
                            const res = await fetch(`/api/tasks/comments/${comment.id}`, { method: "DELETE" });
                            if (!res.ok) {
                              const data = await res.json().catch(() => ({}));
                              window.alert(data?.error ?? "Não foi possível excluir.");
                              return;
                            }
                            await loadDetail();
                            onChanged();
                          }}
                          className="ml-auto rounded p-1 text-slate-300 hover:text-rose-600"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                      <div className="mt-1 pl-8">
                        <Markdown source={comment.body} />
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          {Object.entries(comment.reactions ?? {}).map(([emoji, people]) => (
                            <button
                              key={emoji}
                              onClick={() => react(comment.id, emoji)}
                              title={people.join(", ")}
                              className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-bold hover:border-cyan-300"
                            >
                              {emoji} {people.length}
                            </button>
                          ))}
                          <div className="flex gap-0.5 opacity-40 transition hover:opacity-100">
                            {REACTION_EMOJIS.map((emoji) => (
                              <button
                                key={emoji}
                                onClick={() => react(comment.id, emoji)}
                                className="rounded px-1 text-[11px] hover:bg-slate-100"
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {comments.length === 0 && <p className="text-xs text-slate-400">Nenhum comentário ainda.</p>}
                </div>
              </section>
            </div>

            {/* Barra lateral */}
            <aside className="space-y-3">
              <SidebarBlock icon={<Users className="size-3.5" />} label="Responsáveis">
                <div className="flex flex-wrap gap-1">
                  {members.map((member) => {
                    const on = assigneeIds.includes(member.id);
                    return (
                      <button
                        key={member.id}
                        onClick={() => setAssigneeIds((cur) => (on ? cur.filter((id) => id !== member.id) : [...cur, member.id]))}
                        title={member.name}
                        className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-bold ${
                          on ? "border-cyan-400 bg-cyan-50 text-cyan-800" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                        }`}
                      >
                        <span className="grid size-4 place-content-center rounded-full bg-cyan-100 text-[8px] text-cyan-800">
                          {initials(member.name)}
                        </span>
                        {member.name.split(" ")[0]}
                      </button>
                    );
                  })}
                </div>
              </SidebarBlock>

              <SidebarBlock icon={<Tag className="size-3.5" />} label="Etiquetas">
                {board.labels.length === 0 ? (
                  <p className="text-[11px] text-slate-400">Crie etiquetas no botão Etiquetas do quadro.</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {board.labels.map((label) => {
                      const on = labelIds.includes(label.id);
                      return (
                        <button
                          key={label.id}
                          onClick={() => setLabelIds((cur) => (on ? cur.filter((id) => id !== label.id) : [...cur, label.id]))}
                          style={on ? { backgroundColor: label.color, color: "white" } : { color: label.color, borderColor: label.color }}
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${on ? "" : "bg-white"}`}
                        >
                          {label.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </SidebarBlock>

              <SidebarBlock icon={<CalendarClock className="size-3.5" />} label="Datas">
                <label className="block text-[10px] font-bold uppercase text-slate-400">Início</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="mb-1.5 w-full rounded-lg border border-slate-200 px-2 py-1 text-xs"
                />
                <label className="block text-[10px] font-bold uppercase text-slate-400">Vencimento</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs"
                />
              </SidebarBlock>

              <SidebarBlock icon={<Clock className="size-3.5" />} label="Prioridade e status">
                <select
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as TaskPriority)}
                  className="mb-1.5 w-full rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold"
                >
                  {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((value) => (
                    <option key={value} value={value}>
                      {PRIORITY_LABEL[value]}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  <input
                    type="checkbox"
                    checked={completed}
                    onChange={(event) => {
                      const on = event.target.checked;
                      setCompleted(on);
                      // Marcou agora e nunca teve data? Sugere hoje — o campo
                      // continua editável pra registrar conclusão retroativa.
                      if (on && !completedDate) setCompletedDate(new Date().toISOString().slice(0, 10));
                    }}
                    className="size-3.5"
                  />
                  Concluída
                </label>
                {completed && (
                  <>
                    <label className="mt-1.5 block text-[10px] font-bold uppercase text-slate-400">Concluída em</label>
                    <input
                      type="date"
                      value={completedDate}
                      onChange={(event) => setCompletedDate(event.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs"
                    />
                  </>
                )}
              </SidebarBlock>

              {board.customFields.length > 0 && (
                <SidebarBlock icon={<AlignLeft className="size-3.5" />} label="Campos personalizados">
                  {board.customFields.map((field) => (
                    <CustomFieldInput
                      key={field.id}
                      field={field}
                      value={customValues[field.id] ?? ""}
                      onChange={(value) => setCustomValues((cur) => ({ ...cur, [field.id]: value }))}
                    />
                  ))}
                </SidebarBlock>
              )}

              <SidebarBlock icon={<ImageIcon className="size-3.5" />} label="Capa">
                <div className="flex flex-wrap gap-1">
                  {COVER_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => patchTask({ coverColor: color, coverAttachmentId: null })}
                      style={{ backgroundColor: color }}
                      className={`size-6 rounded-md transition hover:scale-110 ${task.coverColor === color ? "ring-2 ring-slate-900 ring-offset-1" : ""}`}
                    />
                  ))}
                  <button
                    onClick={() => patchTask({ coverColor: null, coverAttachmentId: null })}
                    className="rounded-md border border-slate-200 px-1.5 text-[10px] font-bold text-slate-500 hover:bg-slate-50"
                  >
                    limpar
                  </button>
                </div>
              </SidebarBlock>

              {buttons.length > 0 && (
                <SidebarBlock icon={<Zap className="size-3.5" />} label="Botões">
                  <div className="space-y-1">
                    {buttons.map((button) => (
                      <button
                        key={button.id}
                        onClick={() => runButton(button.id)}
                        className="flex w-full items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-800 hover:bg-amber-100"
                      >
                        <Zap className="size-3" /> {button.name}
                      </button>
                    ))}
                  </div>
                </SidebarBlock>
              )}

              <div className="space-y-1 border-t border-slate-100 pt-2">
                <button
                  onClick={saveAsTemplate}
                  className="flex w-full items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
                >
                  <Copy className="size-3.5" /> Salvar como modelo
                </button>
                <button
                  onClick={async () => {
                    await patchTask({ archived: true }, true);
                    onClose();
                  }}
                  className="flex w-full items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
                >
                  <Archive className="size-3.5" /> Arquivar
                </button>
                <button
                  onClick={async () => {
                    if (!window.confirm("Excluir este card definitivamente? Não dá para desfazer.")) return;
                    await fetch(`/api/tasks/cards/${task.id}`, { method: "DELETE" });
                    onChanged();
                    onClose();
                  }}
                  className="flex w-full items-center gap-1.5 rounded-lg border border-rose-100 px-2 py-1.5 text-[11px] font-bold text-rose-600 hover:bg-rose-50"
                >
                  <Trash2 className="size-3.5" /> Excluir
                </button>
              </div>
            </aside>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/70 p-3">
          <button onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-bold text-slate-600">
            Fechar
          </button>
          <button
            onClick={saveAll}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-4 py-1.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

function SidebarBlock({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-2.5">
      <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-slate-500">
        {icon} {label}
      </p>
      {children}
    </div>
  );
}

function CustomFieldInput({
  field,
  value,
  onChange,
}: {
  field: TaskCustomField;
  value: string;
  onChange: (value: string) => void;
}) {
  const base = "mb-1.5 w-full rounded-lg border border-slate-200 px-2 py-1 text-xs";
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase text-slate-400">{field.name}</label>
      {field.type === "select" ? (
        <select value={value} onChange={(event) => onChange(event.target.value)} className={base}>
          <option value="">—</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : field.type === "checkbox" ? (
        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
          <input
            type="checkbox"
            checked={value === "1"}
            onChange={(event) => onChange(event.target.checked ? "1" : "")}
            className="size-3.5"
          />
          Sim
        </label>
      ) : (
        <input
          type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={base}
        />
      )}
    </div>
  );
}

function ChecklistBlock({
  checklist,
  members,
  onToggle,
  onAddItem,
  onDeleteList,
  onDeleteItem,
  onAssignItem,
}: {
  checklist: TaskChecklist;
  members: Member[];
  onToggle: (itemId: number, done: boolean) => void;
  onAddItem: (text: string) => void;
  onDeleteList: () => void;
  onDeleteItem: (itemId: number) => void;
  onAssignItem: (itemId: number, memberId: number | null, due: string | null) => void;
}) {
  const [text, setText] = useState("");
  const done = checklist.items.filter((item) => item.done).length;

  return (
    <div className="rounded-xl border border-slate-100 bg-white p-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <h4 className="text-xs font-black text-slate-700">{checklist.name}</h4>
        <span className="text-[10px] font-bold text-slate-400">
          {done}/{checklist.items.length}
        </span>
        <button onClick={onDeleteList} className="ml-auto rounded p-1 text-slate-300 hover:text-rose-600">
          <Trash2 className="size-3" />
        </button>
      </div>
      <div className="space-y-1">
        {checklist.items.map((item) => (
          <div key={item.id} className="group flex items-start gap-1.5 rounded-lg px-1 py-0.5 hover:bg-slate-50">
            <input
              type="checkbox"
              checked={item.done}
              onChange={(event) => onToggle(item.id, event.target.checked)}
              className="mt-0.5 size-3.5 accent-emerald-600"
            />
            <div className="min-w-0 flex-1">
              <p className={`text-xs ${item.done ? "text-slate-400 line-through" : "text-slate-700"}`}>{item.text}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                <select
                  value={item.memberId ?? ""}
                  onChange={(event) => onAssignItem(item.id, event.target.value ? Number(event.target.value) : null, item.dueDate)}
                  className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] text-slate-500"
                >
                  <option value="">sem responsável</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name.split(" ")[0]}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={item.dueDate ?? ""}
                  onChange={(event) => onAssignItem(item.id, item.memberId, event.target.value || null)}
                  className="rounded border border-slate-200 px-1 py-0.5 text-[10px] text-slate-500"
                />
              </div>
            </div>
            <button
              onClick={() => onDeleteItem(item.id)}
              className="rounded p-1 text-slate-200 opacity-0 transition group-hover:opacity-100 hover:text-rose-600"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && text.trim()) {
              onAddItem(text);
              setText("");
            }
          }}
          placeholder="Adicionar item…"
          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1 text-xs"
        />
        <button
          onClick={() => {
            if (text.trim()) {
              onAddItem(text);
              setText("");
            }
          }}
          className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-bold text-white"
        >
          <Check className="size-3" />
        </button>
      </div>
    </div>
  );
}
