"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Download, Loader2, Plus, Printer, RotateCcw, Trash2, Upload, X, Zap } from "lucide-react";
import type { BoardData, TaskCard, TaskColumn, TaskCustomField } from "@/lib/tasks";
import type { TaskCardTemplate } from "@/lib/taskDetails";
import type {
  AutomationAction,
  AutomationActionType,
  AutomationKind,
  AutomationTriggerType,
  TaskAutomation,
  TaskWebhook,
} from "@/lib/taskAutomations";
import type { Member } from "./CardModal";

/**
 * Modais de configuração do quadro: automações (Butler), campos
 * personalizados, modelos de card, integrações (webhooks/token/export/import),
 * arquivo e atalhos de teclado.
 */

export function Overlay({
  children,
  onClose,
  size = "lg",
}: {
  children: React.ReactNode;
  onClose: () => void;
  size?: "md" | "lg" | "xl";
}) {
  const width = { md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className={`w-full ${width} rounded-2xl bg-white shadow-2xl`} onClick={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function ModalHead({ title, hint, onClose }: { title: string; hint?: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between border-b border-slate-100 p-4">
      <div>
        <h2 className="text-base font-black text-slate-900">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
      </div>
      <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
        <X className="size-5" />
      </button>
    </div>
  );
}

// ── Automações ───────────────────────────────────────────────────────────────

const TRIGGERS: { value: AutomationTriggerType; label: string; needs?: "column" | "label" | "member" }[] = [
  { value: "card_created", label: "Quando um card for criado" },
  { value: "card_moved", label: "Quando um card entrar na coluna…", needs: "column" },
  { value: "label_added", label: "Quando receber a etiqueta…", needs: "label" },
  { value: "member_assigned", label: "Quando for atribuído a…", needs: "member" },
  { value: "checklist_completed", label: "Quando a checklist terminar" },
  { value: "card_completed", label: "Quando o card for concluído" },
  { value: "due_soon", label: "Quando o prazo estiver perto (hoje/amanhã)" },
  { value: "due_overdue", label: "Quando o prazo vencer" },
];

const ACTIONS: { value: AutomationActionType; label: string; needs?: "column" | "label" | "member" | "text" | "days" | "priority" | "url" | "checklist" }[] = [
  { value: "move_column", label: "Mover para a coluna…", needs: "column" },
  { value: "add_label", label: "Adicionar a etiqueta…", needs: "label" },
  { value: "remove_label", label: "Remover a etiqueta…", needs: "label" },
  { value: "assign_member", label: "Atribuir a…", needs: "member" },
  { value: "set_priority", label: "Definir prioridade…", needs: "priority" },
  { value: "set_due_days", label: "Definir prazo em N dias", needs: "days" },
  { value: "add_comment", label: "Comentar no card", needs: "text" },
  { value: "add_checklist", label: "Adicionar checklist", needs: "checklist" },
  { value: "complete_card", label: "Marcar como concluída" },
  { value: "archive_card", label: "Arquivar o card" },
  { value: "notify_members", label: "Avisar os responsáveis", needs: "text" },
  { value: "webhook", label: "Chamar um webhook (n8n)", needs: "url" },
];

export function AutomationsModal({
  board,
  members,
  onClose,
  canEdit,
}: {
  board: BoardData;
  members: Member[];
  onClose: () => void;
  canEdit: boolean;
}) {
  const [items, setItems] = useState<TaskAutomation[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<AutomationKind>("rule");
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<AutomationTriggerType>("card_moved");
  const [triggerColumn, setTriggerColumn] = useState<number | "">("");
  const [triggerLabel, setTriggerLabel] = useState<number | "">("");
  const [triggerMember, setTriggerMember] = useState<number | "">("");
  const [actions, setActions] = useState<AutomationAction[]>([]);
  const [scheduleKind, setScheduleKind] = useState("daily");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [scheduleWeekday, setScheduleWeekday] = useState(1);
  const [saving, setSaving] = useState(false);

  async function load() {
    const data = await fetch(`/api/tasks/automations?boardId=${board.board.id}`).then((r) => r.json());
    setItems(data.automations ?? []);
    setLoading(false);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.board.id]);

  async function create() {
    if (!name.trim() || actions.length === 0) return;
    setSaving(true);
    const res = await fetch("/api/tasks/automations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        boardId: board.board.id,
        kind,
        name,
        trigger: {
          type: kind === "schedule" ? "card_created" : trigger,
          columnId: triggerColumn || null,
          labelId: triggerLabel || null,
          memberId: triggerMember || null,
        },
        actions,
        scheduleKind: kind === "schedule" ? scheduleKind : null,
        scheduleTime: kind === "schedule" ? scheduleTime : null,
        scheduleWeekday: kind === "schedule" ? scheduleWeekday : null,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setName("");
      setActions([]);
      await load();
    } else {
      const data = await res.json().catch(() => ({}));
      window.alert(data?.error ?? "Não foi possível criar a automação.");
    }
  }

  function describe(automation: TaskAutomation): string {
    const triggerLabelText =
      automation.kind === "button"
        ? "Botão no card"
        : automation.kind === "schedule"
          ? `Agendado (${automation.scheduleKind ?? "daily"} ${automation.scheduleTime ?? ""})`
          : TRIGGERS.find((t) => t.value === automation.trigger?.type)?.label ?? automation.trigger?.type;
    const actionText = (automation.actions ?? [])
      .map((action) => ACTIONS.find((a) => a.value === action.type)?.label ?? action.type)
      .join(" · ");
    return `${triggerLabelText} → ${actionText}`;
  }

  return (
    <Overlay onClose={onClose} size="xl">
      <ModalHead
        title="Automações do quadro"
        hint="Regras que rodam sozinhas, botões dentro do card e comandos agendados."
        onClose={onClose}
      />
      <div className="max-h-[72vh] space-y-4 overflow-y-auto p-4">
        <div className="space-y-1.5">
          {loading && <p className="text-sm text-slate-400">Carregando…</p>}
          {!loading && items.length === 0 && (
            <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">
              Nenhuma automação ainda. Exemplo clássico: <strong>quando um card entrar em “Concluído”</strong> →
              marcar como concluída e arquivar depois.
            </p>
          )}
          {items.map((automation) => (
            <div key={automation.id} className="flex items-start gap-2 rounded-xl border border-slate-200 p-2.5">
              <span
                className={`mt-0.5 grid size-7 flex-shrink-0 place-content-center rounded-lg ${
                  automation.kind === "button"
                    ? "bg-amber-100 text-amber-700"
                    : automation.kind === "schedule"
                      ? "bg-violet-100 text-violet-700"
                      : "bg-cyan-100 text-cyan-700"
                }`}
              >
                <Zap className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-slate-800">{automation.name}</p>
                <p className="text-[11px] leading-4 text-slate-500">{describe(automation)}</p>
                {automation.lastRunAt && (
                  <p className="text-[10px] text-slate-400">
                    última execução: {new Date(automation.lastRunAt).toLocaleString("pt-BR")}
                  </p>
                )}
              </div>
              {canEdit && (
                <>
                  <button
                    onClick={async () => {
                      await fetch(`/api/tasks/automations/${automation.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ enabled: !automation.enabled }),
                      });
                      await load();
                    }}
                    className={`rounded-lg px-2 py-1 text-[10px] font-black ${
                      automation.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {automation.enabled ? "ativa" : "pausada"}
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm(`Excluir a automação "${automation.name}"?`)) return;
                      await fetch(`/api/tasks/automations/${automation.id}`, { method: "DELETE" });
                      await load();
                    }}
                    className="rounded p-1 text-slate-300 hover:text-rose-600"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        {canEdit && (
          <div className="rounded-xl border border-dashed border-slate-300 p-3">
            <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Nova automação</p>
            <div className="mb-2 flex gap-1">
              {(["rule", "button", "schedule"] as AutomationKind[]).map((value) => (
                <button
                  key={value}
                  onClick={() => setKind(value)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-bold ${
                    kind === value ? "bg-slate-900 text-white" : "border border-slate-200 text-slate-600"
                  }`}
                >
                  {value === "rule" ? "Regra" : value === "button" ? "Botão" : "Agendado"}
                </button>
              ))}
            </div>

            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={kind === "button" ? "Nome do botão (ex.: Aprovar)" : "Nome da regra"}
              className="mb-2 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
            />

            {kind === "rule" && (
              <div className="mb-2 grid gap-1.5 sm:grid-cols-2">
                <select
                  value={trigger}
                  onChange={(event) => setTrigger(event.target.value as AutomationTriggerType)}
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                >
                  {TRIGGERS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {TRIGGERS.find((t) => t.value === trigger)?.needs === "column" && (
                  <select
                    value={triggerColumn}
                    onChange={(event) => setTriggerColumn(event.target.value ? Number(event.target.value) : "")}
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                  >
                    <option value="">qualquer coluna</option>
                    {board.columns.map((column) => (
                      <option key={column.id} value={column.id}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                )}
                {TRIGGERS.find((t) => t.value === trigger)?.needs === "label" && (
                  <select
                    value={triggerLabel}
                    onChange={(event) => setTriggerLabel(event.target.value ? Number(event.target.value) : "")}
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                  >
                    <option value="">qualquer etiqueta</option>
                    {board.labels.map((label) => (
                      <option key={label.id} value={label.id}>
                        {label.name}
                      </option>
                    ))}
                  </select>
                )}
                {TRIGGERS.find((t) => t.value === trigger)?.needs === "member" && (
                  <select
                    value={triggerMember}
                    onChange={(event) => setTriggerMember(event.target.value ? Number(event.target.value) : "")}
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                  >
                    <option value="">qualquer pessoa</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {kind === "schedule" && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                <select
                  value={scheduleKind}
                  onChange={(event) => setScheduleKind(event.target.value)}
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                >
                  <option value="daily">Todo dia</option>
                  <option value="weekly">Toda semana</option>
                  <option value="monthly">Todo mês (dia 1)</option>
                </select>
                {scheduleKind === "weekly" && (
                  <select
                    value={scheduleWeekday}
                    onChange={(event) => setScheduleWeekday(Number(event.target.value))}
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                  >
                    {["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"].map((day, index) => (
                      <option key={day} value={index}>
                        {day}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  type="time"
                  value={scheduleTime}
                  onChange={(event) => setScheduleTime(event.target.value)}
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                />
                <span className="self-center text-[11px] text-slate-400">
                  O ciclo roda a cada 5 minutos, então a hora é aproximada.
                </span>
              </div>
            )}

            <ActionBuilder board={board} members={members} actions={actions} onChange={setActions} />

            <button
              onClick={create}
              disabled={saving || !name.trim() || actions.length === 0}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Criar automação
            </button>
          </div>
        )}
      </div>
      <div className="border-t border-slate-100 p-3 text-right">
        <button onClick={onClose} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white">
          Fechar
        </button>
      </div>
    </Overlay>
  );
}

function ActionBuilder({
  board,
  members,
  actions,
  onChange,
}: {
  board: BoardData;
  members: Member[];
  actions: AutomationAction[];
  onChange: (actions: AutomationAction[]) => void;
}) {
  const [type, setType] = useState<AutomationActionType>("move_column");
  const [draft, setDraft] = useState<AutomationAction>({ type: "move_column" });
  const needs = ACTIONS.find((a) => a.value === type)?.needs;

  function add() {
    onChange([...actions, { ...draft, type }]);
    setDraft({ type });
  }

  return (
    <div className="rounded-lg bg-slate-50 p-2">
      <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-500">Então…</p>
      <div className="mb-1.5 space-y-1">
        {actions.map((action, index) => (
          <div key={index} className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-600">
            {ACTIONS.find((a) => a.value === action.type)?.label ?? action.type}
            <button
              onClick={() => onChange(actions.filter((_, position) => position !== index))}
              className="ml-auto text-slate-300 hover:text-rose-600"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <select
          value={type}
          onChange={(event) => {
            const value = event.target.value as AutomationActionType;
            setType(value);
            setDraft({ type: value });
          }}
          className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
        >
          {ACTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {needs === "column" && (
          <select
            value={draft.columnId ?? ""}
            onChange={(event) => setDraft({ ...draft, columnId: Number(event.target.value) })}
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
          >
            <option value="">escolha a coluna</option>
            {board.columns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.name}
              </option>
            ))}
          </select>
        )}
        {needs === "label" && (
          <select
            value={draft.labelId ?? ""}
            onChange={(event) => setDraft({ ...draft, labelId: Number(event.target.value) })}
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
          >
            <option value="">escolha a etiqueta</option>
            {board.labels.map((label) => (
              <option key={label.id} value={label.id}>
                {label.name}
              </option>
            ))}
          </select>
        )}
        {needs === "member" && (
          <select
            value={draft.memberId ?? ""}
            onChange={(event) => setDraft({ ...draft, memberId: Number(event.target.value) })}
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
          >
            <option value="">escolha a pessoa</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        )}
        {needs === "priority" && (
          <select
            value={draft.priority ?? "alta"}
            onChange={(event) => setDraft({ ...draft, priority: event.target.value })}
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
          >
            {["baixa", "media", "alta", "urgente"].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        )}
        {needs === "days" && (
          <input
            type="number"
            value={draft.days ?? 5}
            onChange={(event) => setDraft({ ...draft, days: Number(event.target.value) })}
            className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-xs"
          />
        )}
        {(needs === "text" || needs === "checklist" || needs === "url") && (
          <input
            value={needs === "url" ? draft.url ?? "" : draft.text ?? ""}
            onChange={(event) =>
              setDraft(needs === "url" ? { ...draft, url: event.target.value } : { ...draft, text: event.target.value })
            }
            placeholder={needs === "url" ? "https://n8n…/webhook/…" : needs === "checklist" ? "Nome da checklist" : "Texto"}
            className="min-w-40 flex-1 rounded-lg border border-slate-200 px-2 py-1 text-xs"
          />
        )}
        <button onClick={add} className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-bold text-white">
          + ação
        </button>
      </div>
    </div>
  );
}

// ── Campos personalizados ────────────────────────────────────────────────────

export function CustomFieldsModal({
  board,
  onClose,
  onChanged,
}: {
  board: BoardData;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [fields, setFields] = useState<TaskCustomField[]>(board.customFields);
  const [name, setName] = useState("");
  const [type, setType] = useState<TaskCustomField["type"]>("text");
  const [options, setOptions] = useState("");

  async function reload() {
    const data = await fetch(`/api/tasks/custom-fields?boardId=${board.board.id}`).then((r) => r.json());
    setFields(data.fields ?? []);
    onChanged();
  }

  return (
    <Overlay onClose={onClose}>
      <ModalHead
        title="Campos personalizados"
        hint="Valor, telefone, curso, cidade… aparecem no card e viram coluna na visão de Tabela."
        onClose={onClose}
      />
      <div className="max-h-[70vh] space-y-2 overflow-y-auto p-4">
        {fields.map((field) => (
          <div key={field.id} className="flex items-center gap-2 rounded-xl border border-slate-200 p-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-slate-800">{field.name}</p>
              <p className="text-[11px] text-slate-400">
                {field.type}
                {field.options.length > 0 ? ` · ${field.options.join(", ")}` : ""}
              </p>
            </div>
            <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
              <input
                type="checkbox"
                checked={field.showOnCard}
                onChange={async (event) => {
                  await fetch(`/api/tasks/custom-fields/${field.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ showOnCard: event.target.checked }),
                  });
                  await reload();
                }}
                className="size-3.5"
              />
              no card
            </label>
            <button
              onClick={async () => {
                if (!window.confirm(`Excluir o campo "${field.name}"? Os valores preenchidos somem junto.`)) return;
                await fetch(`/api/tasks/custom-fields/${field.id}`, { method: "DELETE" });
                await reload();
              }}
              className="rounded p-1 text-slate-300 hover:text-rose-600"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
        {fields.length === 0 && <p className="text-sm text-slate-400">Nenhum campo personalizado ainda.</p>}

        <div className="rounded-xl border border-dashed border-slate-300 p-3">
          <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Novo campo</p>
          <div className="flex flex-wrap gap-1.5">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nome (ex.: Valor do contrato)"
              className="min-w-40 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
            />
            <select
              value={type}
              onChange={(event) => setType(event.target.value as TaskCustomField["type"])}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            >
              <option value="text">Texto</option>
              <option value="number">Número</option>
              <option value="date">Data</option>
              <option value="select">Lista</option>
              <option value="checkbox">Sim/Não</option>
            </select>
          </div>
          {type === "select" && (
            <input
              value={options}
              onChange={(event) => setOptions(event.target.value)}
              placeholder="Opções separadas por vírgula"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
            />
          )}
          <button
            onClick={async () => {
              if (!name.trim()) return;
              await fetch("/api/tasks/custom-fields", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  boardId: board.board.id,
                  name,
                  type,
                  options: options.split(",").map((option) => option.trim()).filter(Boolean),
                  showOnCard: false,
                }),
              });
              setName("");
              setOptions("");
              await reload();
            }}
            className="mt-2 rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-bold text-white"
          >
            Criar campo
          </button>
        </div>
      </div>
      <div className="border-t border-slate-100 p-3 text-right">
        <button onClick={onClose} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white">
          Fechar
        </button>
      </div>
    </Overlay>
  );
}

// ── Modelos de card ──────────────────────────────────────────────────────────

export function TemplatesModal({
  board,
  onClose,
  onCreated,
}: {
  board: BoardData;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [templates, setTemplates] = useState<TaskCardTemplate[]>([]);
  const [columnId, setColumnId] = useState<number | "">(board.columns[0]?.id ?? "");

  async function load() {
    const data = await fetch(`/api/tasks/templates?boardId=${board.board.id}`).then((r) => r.json());
    setTemplates(data.templates ?? []);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.board.id]);

  return (
    <Overlay onClose={onClose}>
      <ModalHead
        title="Modelos de card"
        hint="Salve um card como modelo pela própria tela do card. Aqui você cria a partir dele."
        onClose={onClose}
      />
      <div className="max-h-[70vh] space-y-2 overflow-y-auto p-4">
        <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-2">
          <span className="text-xs font-bold text-slate-500">Criar na coluna:</span>
          <select
            value={columnId}
            onChange={(event) => setColumnId(Number(event.target.value))}
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
          >
            {board.columns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.name}
              </option>
            ))}
          </select>
        </div>
        {templates.map((template) => (
          <div key={template.id} className="flex items-center gap-2 rounded-xl border border-slate-200 p-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-slate-800">{template.name}</p>
              <p className="text-[11px] text-slate-400">
                {(template.payload.checklists ?? []).length} checklist(s) ·{" "}
                {(template.payload.labelIds ?? []).length} etiqueta(s)
              </p>
            </div>
            <button
              onClick={async () => {
                await fetch("/api/tasks/cards", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ templateId: template.id, columnId: columnId || null }),
                });
                onCreated();
                onClose();
              }}
              className="rounded-lg bg-slate-950 px-2.5 py-1 text-xs font-bold text-white"
            >
              <Copy className="mr-1 inline size-3" /> Criar card
            </button>
            <button
              onClick={async () => {
                if (!window.confirm(`Excluir o modelo "${template.name}"?`)) return;
                await fetch(`/api/tasks/templates/${template.id}`, { method: "DELETE" });
                await load();
              }}
              className="rounded p-1 text-slate-300 hover:text-rose-600"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
        {templates.length === 0 && (
          <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">
            Nenhum modelo ainda. Abra um card, configure do jeito que se repete e use
            <strong> “Salvar como modelo”</strong>.
          </p>
        )}
      </div>
      <div className="border-t border-slate-100 p-3 text-right">
        <button onClick={onClose} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white">
          Fechar
        </button>
      </div>
    </Overlay>
  );
}

// ── Integrações (webhooks, tokens, export/import) ────────────────────────────

const WEBHOOK_EVENTS = [
  "card_created",
  "card_moved",
  "card_completed",
  "label_added",
  "member_assigned",
  "checklist_completed",
];

export function IntegrationsModal({
  board,
  sectorId,
  isMaster,
  onClose,
  onImported,
}: {
  board: BoardData;
  sectorId: number | null;
  isMaster: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const [webhooks, setWebhooks] = useState<TaskWebhook[]>([]);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [tokens, setTokens] = useState<{ id: number; name: string; userEmail: string; revoked: boolean }[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  async function load() {
    const data = await fetch(`/api/tasks/webhooks?boardId=${board.board.id}`).then((r) => r.json()).catch(() => ({}));
    setWebhooks(data.webhooks ?? []);
    if (isMaster) {
      const tokenData = await fetch("/api/tasks/tokens").then((r) => r.json()).catch(() => ({}));
      setTokens(tokenData.tokens ?? []);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.board.id]);

  return (
    <Overlay onClose={onClose} size="xl">
      <ModalHead
        title="Integrações e dados"
        hint="Webhooks para o n8n, tokens da API REST e exportação/importação do quadro."
        onClose={onClose}
      />
      <div className="max-h-[72vh] space-y-5 overflow-y-auto p-4">
        <section>
          <h3 className="mb-1.5 text-xs font-black uppercase tracking-wide text-slate-500">Exportar / importar</h3>
          <div className="flex flex-wrap gap-1.5">
            <a
              href={`/api/tasks/export?boardId=${board.board.id}&format=json`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
            >
              <Download className="size-3.5" /> JSON (reimportável)
            </a>
            <a
              href={`/api/tasks/export?boardId=${board.board.id}&format=csv`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
            >
              <Download className="size-3.5" /> CSV (planilha)
            </a>
            <a
              href={`/tarefas/relatorio?board=${board.board.id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-200 bg-cyan-50 px-2.5 py-1.5 text-xs font-bold text-cyan-800 hover:bg-cyan-100"
            >
              <Printer className="size-3.5" /> Visualizar / PDF
            </a>
            <button
              onClick={() => importInput.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
            >
              <Upload className="size-3.5" /> Importar JSON
            </button>
            <input
              ref={importInput}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file || sectorId === null) return;
                try {
                  const data = JSON.parse(await file.text());
                  const res = await fetch("/api/tasks/import", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ sectorId, data }),
                  });
                  const result = await res.json();
                  if (res.ok) {
                    window.alert(`Importado: ${result.tasks} card(s) num quadro novo.`);
                    onImported();
                    onClose();
                  } else {
                    window.alert(result?.error ?? "Falha ao importar.");
                  }
                } catch {
                  window.alert("Arquivo inválido.");
                }
              }}
            />
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            A importação sempre cria um quadro NOVO no setor atual — nunca sobrescreve o quadro aberto.
          </p>
        </section>

        <section>
          <h3 className="mb-1.5 text-xs font-black uppercase tracking-wide text-slate-500">Webhooks (n8n, Make, Zapier)</h3>
          <div className="space-y-1.5">
            {webhooks.map((webhook) => (
              <div key={webhook.id} className="flex items-center gap-2 rounded-xl border border-slate-200 p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-black text-slate-800">{webhook.url}</p>
                  <p className="text-[10px] text-slate-400">
                    {webhook.events.length === 0 ? "todos os eventos" : webhook.events.join(", ")}
                    {webhook.lastStatus ? ` · último envio: ${webhook.lastStatus}` : ""}
                  </p>
                  {webhook.secret && (
                    <p className="text-[10px] text-slate-400">
                      assinatura: sha256(secret + corpo) no header <code>X-Vozup-Signature</code>
                    </p>
                  )}
                </div>
                <button
                  onClick={async () => {
                    await fetch(`/api/tasks/webhooks/${webhook.id}`, { method: "DELETE" });
                    await load();
                  }}
                  className="rounded p-1 text-slate-300 hover:text-rose-600"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            {webhooks.length === 0 && <p className="text-xs text-slate-400">Nenhum webhook configurado.</p>}
          </div>
          <div className="mt-2 rounded-xl border border-dashed border-slate-300 p-2.5">
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://n8n.seu-dominio/webhook/tarefas"
              className="mb-1.5 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
            />
            <div className="mb-1.5 flex flex-wrap gap-1">
              {WEBHOOK_EVENTS.map((event) => {
                const on = events.includes(event);
                return (
                  <button
                    key={event}
                    onClick={() => setEvents((cur) => (on ? cur.filter((e) => e !== event) : [...cur, event]))}
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                      on ? "border-cyan-400 bg-cyan-50 text-cyan-800" : "border-slate-200 text-slate-500"
                    }`}
                  >
                    {event}
                  </button>
                );
              })}
            </div>
            <button
              onClick={async () => {
                if (!/^https?:\/\//i.test(url)) return;
                await fetch("/api/tasks/webhooks", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ boardId: board.board.id, url, events }),
                });
                setUrl("");
                setEvents([]);
                await load();
              }}
              className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-bold text-white"
            >
              Adicionar webhook
            </button>
          </div>
        </section>

        {isMaster && (
          <section>
            <h3 className="mb-1.5 text-xs font-black uppercase tracking-wide text-slate-500">Tokens da API REST</h3>
            <p className="mb-1.5 text-[11px] text-slate-500">
              Use <code className="rounded bg-slate-100 px-1">Authorization: Bearer &lt;token&gt;</code> nas rotas
              <code className="ml-1 rounded bg-slate-100 px-1">/api/tasks/*</code> para criar, mover e editar cards por fora.
            </p>
            {newToken && (
              <div className="mb-2 rounded-xl border border-emerald-200 bg-emerald-50 p-2.5">
                <p className="text-[11px] font-black text-emerald-800">Copie agora — não aparece de novo:</p>
                <code className="block break-all text-xs text-emerald-900">{newToken}</code>
              </div>
            )}
            <div className="space-y-1.5">
              {tokens.map((token) => (
                <div key={token.id} className="flex items-center gap-2 rounded-xl border border-slate-200 p-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-black text-slate-800">{token.name}</p>
                    <p className="text-[10px] text-slate-400">
                      {token.userEmail} {token.revoked ? "· revogado" : ""}
                    </p>
                  </div>
                  {!token.revoked && (
                    <button
                      onClick={async () => {
                        await fetch(`/api/tasks/tokens/${token.id}`, { method: "DELETE" });
                        await load();
                      }}
                      className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-50"
                    >
                      revogar
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={async () => {
                const name = window.prompt("Nome do token (ex.: n8n produção):");
                if (!name) return;
                const res = await fetch("/api/tasks/tokens", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name }),
                });
                const data = await res.json();
                if (data?.token) setNewToken(data.token);
                await load();
              }}
              className="mt-2 rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-bold text-white"
            >
              Gerar token
            </button>
          </section>
        )}
      </div>
      <div className="border-t border-slate-100 p-3 text-right">
        <button onClick={onClose} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white">
          Fechar
        </button>
      </div>
    </Overlay>
  );
}

// ── Arquivo ──────────────────────────────────────────────────────────────────

export function ArchiveModal({
  boardId,
  onClose,
  onChanged,
}: {
  boardId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tasks, setTasks] = useState<TaskCard[]>([]);
  const [columns, setColumns] = useState<TaskColumn[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const data = await fetch(`/api/tasks/boards/${boardId}/archive`).then((r) => r.json());
    setTasks(data.tasks ?? []);
    setColumns(data.columns ?? []);
    setLoading(false);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  return (
    <Overlay onClose={onClose}>
      <ModalHead title="Arquivo do quadro" hint="Cards e colunas arquivados — dá para restaurar ou excluir de vez." onClose={onClose} />
      <div className="max-h-[70vh] space-y-3 overflow-y-auto p-4">
        {loading && <p className="text-sm text-slate-400">Carregando…</p>}

        {columns.length > 0 && (
          <section>
            <h3 className="mb-1 text-xs font-black uppercase tracking-wide text-slate-500">Colunas</h3>
            {columns.map((column) => (
              <div key={column.id} className="mb-1 flex items-center gap-2 rounded-xl border border-slate-200 p-2">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: column.color ?? "#64748b" }} />
                <p className="flex-1 text-sm font-bold text-slate-700">{column.name}</p>
                <button
                  onClick={async () => {
                    await fetch(`/api/tasks/columns/${column.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ archived: false }),
                    });
                    await load();
                    onChanged();
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
                >
                  <RotateCcw className="size-3" /> Restaurar
                </button>
              </div>
            ))}
          </section>
        )}

        <section>
          <h3 className="mb-1 text-xs font-black uppercase tracking-wide text-slate-500">Cards</h3>
          {tasks.length === 0 && !loading && <p className="text-sm text-slate-400">Nada arquivado.</p>}
          {tasks.map((task) => (
            <div key={task.id} className="mb-1 flex items-center gap-2 rounded-xl border border-slate-200 p-2">
              <p className="min-w-0 flex-1 truncate text-sm font-bold text-slate-700">{task.title}</p>
              <button
                onClick={async () => {
                  await fetch(`/api/tasks/cards/${task.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ archived: false }),
                  });
                  await load();
                  onChanged();
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
              >
                <RotateCcw className="size-3" /> Restaurar
              </button>
              <button
                onClick={async () => {
                  if (!window.confirm(`Excluir "${task.title}" definitivamente?`)) return;
                  await fetch(`/api/tasks/cards/${task.id}`, { method: "DELETE" });
                  await load();
                  onChanged();
                }}
                className="rounded p-1 text-slate-300 hover:text-rose-600"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </section>
      </div>
      <div className="border-t border-slate-100 p-3 text-right">
        <button onClick={onClose} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white">
          Fechar
        </button>
      </div>
    </Overlay>
  );
}

// ── Atalhos ──────────────────────────────────────────────────────────────────

const SHORTCUTS: [string, string][] = [
  ["/", "Focar a busca"],
  ["n", "Nova tarefa na primeira coluna"],
  ["1 … 6", "Trocar de visão (Kanban, Tabela, Calendário, Timeline, Painel, Geral)"],
  ["w", "Visão de workspace (todos os quadros)"],
  ["f", "Abrir/fechar os filtros"],
  ["m", "Filtrar só as minhas tarefas"],
  ["a", "Abrir o arquivo do quadro"],
  ["Esc", "Fechar card ou modal"],
  ["Ctrl+Enter", "Enviar comentário (dentro do card)"],
  ["?", "Esta lista"],
];

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay onClose={onClose} size="md">
      <ModalHead title="Atalhos de teclado" onClose={onClose} />
      <div className="space-y-1 p-4">
        {SHORTCUTS.map(([key, description]) => (
          <div key={key} className="flex items-center gap-3 rounded-lg px-2 py-1.5 odd:bg-slate-50">
            <kbd className="min-w-16 rounded border border-slate-300 bg-white px-2 py-0.5 text-center text-xs font-black text-slate-700 shadow-sm">
              {key}
            </kbd>
            <span className="text-sm text-slate-600">{description}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-100 p-3 text-right">
        <button onClick={onClose} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white">
          Fechar
        </button>
      </div>
    </Overlay>
  );
}
