"use client";

import { useState } from "react";
import { Columns3 } from "lucide-react";
import { CrmKanbanView } from "@/components/CrmKanbanView";
import type { ProductivityLeadAgent } from "@/types/productivity";

export type KanbanMode = "mine" | "all" | "member";

interface KanbanSectionProps {
  isManager: boolean;
  currentUserEmail: string;
  teamMembers: ProductivityLeadAgent[];
  /**
   * Controlado pelo pai (ProductivityClient) para que a mesma selecao guie
   * tambem Diario de Bordo/Bolos/Fechamento — ver scopeEmail em
   * ProductivityClient.tsx.
   */
  mode: KanbanMode;
  memberEmail: string;
  onModeChange: (mode: KanbanMode) => void;
  onMemberEmailChange: (email: string) => void;
  onLeadMoved?: () => void;
}

export function KanbanSection({
  isManager,
  currentUserEmail,
  teamMembers,
  mode,
  memberEmail,
  onModeChange,
  onMemberEmailChange,
  onLeadMoved,
}: KanbanSectionProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Usuario comum sempre ve so o proprio Kanban - a API ja garante isso
  // independente do que for passado aqui, mas nem exibimos o seletor.
  const assignedSellerEmail = !isManager
    ? currentUserEmail
    : mode === "mine"
      ? currentUserEmail
      : mode === "member"
        ? memberEmail || currentUserEmail
        : undefined; // "all" => sem filtro = Kanban consolidado da equipe

  return (
    <section className="space-y-3 rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[rgb(var(--slate-12))]">
          <Columns3 className="h-4 w-4 text-[rgb(var(--blue-9))]" />
          Kanban
        </h2>

        {isManager && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onModeChange("mine")}
              className={`h-8 rounded-lg px-3 text-xs font-semibold transition ${
                mode === "mine"
                  ? "bg-neutral-900 text-white"
                  : "border border-[rgb(var(--border-weak))] text-[rgb(var(--slate-11))] hover:bg-[rgba(var(--alpha-2))]"
              }`}
            >
              Meu Kanban
            </button>
            <button
              type="button"
              onClick={() => onModeChange("all")}
              className={`h-8 rounded-lg px-3 text-xs font-semibold transition ${
                mode === "all"
                  ? "bg-neutral-900 text-white"
                  : "border border-[rgb(var(--border-weak))] text-[rgb(var(--slate-11))] hover:bg-[rgba(var(--alpha-2))]"
              }`}
            >
              Kanban Geral
            </button>
            <select
              value={mode === "member" ? memberEmail : ""}
              onChange={(event) => {
                onMemberEmailChange(event.target.value);
                onModeChange(event.target.value ? "member" : "mine");
              }}
              className={`h-8 rounded-lg border px-2 text-xs font-semibold ${
                mode === "member"
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-[rgb(var(--border-weak))] text-[rgb(var(--slate-11))]"
              }`}
            >
              <option value="">Colaborador...</option>
              {teamMembers.map((member) => (
                <option key={member.chatwootUserId} value={member.email}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <CrmKanbanView
        onLeadMoved={onLeadMoved}
        selectedId={selectedId}
        onSelectLead={setSelectedId}
        produto={null}
        assignedSellerEmail={assignedSellerEmail}
        isSupervisor={isManager}
      />
    </section>
  );
}
