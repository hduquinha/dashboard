"use client";

import { useEffect, useState } from "react";
import { Columns3, Maximize2, Minimize2, SlidersHorizontal } from "lucide-react";
import { CrmKanbanView } from "@/components/CrmKanbanView";
import { LeadProfileModal } from "@/components/LeadProfileModal";
import { KanbanFiltersModal } from "./KanbanFiltersModal";
import type { KanbanFilter } from "@/lib/kanbanFilters";
import type { CommercialWorkspace } from "@/types/commercial";
import type { Funnel } from "@/types/funnel";
import type { ProductivityLeadAgent } from "@/types/productivity";
import type { TrainingOption } from "@/types/training";
import type { PermissionUser } from "@/lib/permissions";

export type KanbanMode = "mine" | "all" | "member";

interface RecruiterOption {
  code: string;
  name: string;
}

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
  /** Dados para o perfil completo do lead (mesmo modal do Pipeline CRM). */
  trainingOptions: TrainingOption[];
  recruiterOptions: RecruiterOption[];
  commercial: CommercialWorkspace;
  currentUser: PermissionUser | null;
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
  trainingOptions,
  recruiterOptions,
  commercial,
  currentUser,
}: KanbanSectionProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [filters, setFilters] = useState<KanbanFilter[]>([]);
  const [activeFilterId, setActiveFilterId] = useState<number | null>(null);
  const [showFiltersModal, setShowFiltersModal] = useState(false);

  // Funil ativo: vendedor pode ter varios funis atribuidos e trocar entre
  // eles (mesma UX do seletor de Filtro); comeca no funil padrao.
  const [funnelOptions, setFunnelOptions] = useState<Funnel[]>(commercial.funnels);
  const [activeFunnelId, setActiveFunnelId] = useState<number | null>(
    () => commercial.funnels.find((funnel) => funnel.isDefault)?.id ?? commercial.funnels[0]?.id ?? null
  );
  const activeFunnel = funnelOptions.find((funnel) => funnel.id === activeFunnelId) ?? funnelOptions[0] ?? null;
  const commercialFresh = { ...commercial, funnels: funnelOptions };

  // Busca os funis atualizados — a prop `commercial` so vem fresca numa
  // navegacao completa. Refaz a busca ao montar E sempre que a aba/janela
  // recupera o foco (ex: usuario editou o funil em /funis numa outra aba e
  // voltou pra essa sem dar F5) — sem isso, a edicao so aparecia apos um
  // reload completo, e mesmo assim so se o Next remontasse o componente.
  useEffect(() => {
    let cancelled = false;

    function loadFunnels() {
      fetch("/api/funnels")
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { funnels?: Funnel[] } | null) => {
          if (cancelled || !data?.funnels) return;
          setFunnelOptions(data.funnels);
          setActiveFunnelId((current) =>
            current !== null && data.funnels!.some((funnel) => funnel.id === current)
              ? current
              : data.funnels!.find((funnel) => funnel.isDefault)?.id ?? data.funnels![0]?.id ?? null
          );
        })
        .catch(() => {});
    }

    loadFunnels();
    window.addEventListener("focus", loadFunnels);
    document.addEventListener("visibilitychange", loadFunnels);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", loadFunnels);
      document.removeEventListener("visibilitychange", loadFunnels);
    };
  }, []);
  // Mostra todas as etapas do funil como coluna, incluindo Ganho/Perdido —
  // a equipe quer ver esses leads fechados/perdidos permanecendo visiveis no
  // quadro, nao saindo dele.
  const visibleStages = activeFunnel?.stages ?? [];

  // Filtros salvos: admin ve todos; vendedor so os atribuidos a ele (a API
  // ja recorta). Vendedor com filtro atribuido entra com ele aplicado.
  // Mesmo motivo acima: reflete edicoes feitas em outra aba ao voltar o foco.
  useEffect(() => {
    let cancelled = false;

    function loadFilters() {
      fetch("/api/commercial/kanban-filters")
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { filters?: KanbanFilter[] } | null) => {
          if (cancelled || !data?.filters) return;
          setFilters(data.filters);
          if (!isManager && data.filters.length > 0) {
            setActiveFilterId((current) => current ?? data.filters![0].id);
          }
        })
        .catch(() => {});
    }

    loadFilters();
    window.addEventListener("focus", loadFilters);
    document.addEventListener("visibilitychange", loadFilters);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", loadFilters);
      document.removeEventListener("visibilitychange", loadFilters);
    };
  }, [isManager]);

  // Esc sai da tela cheia.
  useEffect(() => {
    if (!isExpanded) return;
    function handler(event: KeyboardEvent) {
      if (event.key === "Escape") setIsExpanded(false);
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isExpanded]);

  // Usuario comum sempre ve so o proprio Kanban - a API ja garante isso
  // independente do que for passado aqui, mas nem exibimos o seletor.
  const assignedSellerEmail = !isManager
    ? currentUserEmail
    : mode === "mine"
      ? currentUserEmail
      : mode === "member"
        ? memberEmail || currentUserEmail
        : undefined; // "all" => sem filtro = Kanban consolidado da equipe

  const activeFilter = filters.find((filter) => filter.id === activeFilterId) ?? null;

  function handleLeadUpdated() {
    setRefreshToken((token) => token + 1);
    onLeadMoved?.();
  }

  return (
    <>
      <section
        className={
          isExpanded
            ? "fixed inset-0 z-40 flex flex-col gap-3 overflow-y-auto bg-[rgb(var(--surface-1))] p-4"
            : "space-y-3 rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-4 shadow-[0_1px_2px_rgba(28,32,36,0.04)]"
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-[rgb(var(--slate-12))]">
            <Columns3 className="h-4 w-4 text-[rgb(var(--blue-9))]" />
            Kanban
            {activeFilter ? (
              <span className="rounded-full bg-[rgb(var(--blue-3))] px-2 py-0.5 text-[10px] font-bold text-[rgb(var(--blue-11))]">
                {activeFilter.name}
              </span>
            ) : null}
          </h2>

          <div className="flex flex-wrap items-center gap-2">
            {isManager && (
              <>
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
              </>
            )}

            {funnelOptions.length > 1 && (
              <select
                value={activeFunnelId ?? ""}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10);
                  setActiveFunnelId(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
                }}
                className="h-8 rounded-lg border border-[rgb(var(--border-weak))] px-2 text-xs font-semibold text-[rgb(var(--slate-11))]"
                title="Funil"
                aria-label="Funil"
              >
                {funnelOptions.map((funnel) => (
                  <option key={funnel.id} value={funnel.id}>
                    {funnel.name}
                  </option>
                ))}
              </select>
            )}

            {filters.length > 0 && (
              <select
                value={activeFilterId ?? ""}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10);
                  setActiveFilterId(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
                }}
                className="h-8 rounded-lg border border-[rgb(var(--border-weak))] px-2 text-xs font-semibold text-[rgb(var(--slate-11))]"
                title="Filtro do Kanban"
                aria-label="Filtro do Kanban"
              >
                <option value="">Sem filtro</option>
                {filters.map((filter) => (
                  <option key={filter.id} value={filter.id}>
                    {filter.name}
                  </option>
                ))}
              </select>
            )}

            {isManager && (
              <button
                type="button"
                onClick={() => setShowFiltersModal(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[rgb(var(--border-weak))] px-3 text-xs font-semibold text-[rgb(var(--slate-11))] transition hover:bg-[rgba(var(--alpha-2))]"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Filtros
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsExpanded((value) => !value)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[rgb(var(--border-weak))] px-3 text-xs font-semibold text-[rgb(var(--slate-11))] transition hover:bg-[rgba(var(--alpha-2))]"
              title={isExpanded ? "Sair da tela cheia (Esc)" : "Expandir Kanban para ver mais leads"}
            >
              {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              {isExpanded ? "Reduzir" : "Expandir"}
            </button>
          </div>
        </div>

        <CrmKanbanView
          onLeadMoved={onLeadMoved}
          selectedId={selectedId}
          onSelectLead={setSelectedId}
          produto={null}
          assignedSellerEmail={assignedSellerEmail}
          isSupervisor={isManager}
          stages={visibleStages}
          assignedOnly
          filterId={activeFilterId}
          refreshToken={refreshToken}
          allowCloseLead
        />
      </section>

      {/* Perfil completo do lead — mesmo modal do Pipeline CRM. */}
      <LeadProfileModal
        leadId={selectedId}
        onClose={() => setSelectedId(null)}
        onUpdate={handleLeadUpdated}
        onDelete={() => {
          setSelectedId(null);
          handleLeadUpdated();
        }}
        trainingOptions={trainingOptions}
        recruiterOptions={recruiterOptions}
        commercial={commercialFresh}
        currentUser={currentUser}
      />

      {showFiltersModal && isManager && (
        <KanbanFiltersModal
          filters={filters}
          sellers={commercial.sellers}
          trainingOptions={trainingOptions}
          onFiltersChange={(next) => {
            setFilters(next);
            if (activeFilterId && !next.some((filter) => filter.id === activeFilterId)) {
              setActiveFilterId(null);
            }
            setRefreshToken((token) => token + 1);
          }}
          onClose={() => setShowFiltersModal(false)}
        />
      )}
    </>
  );
}
