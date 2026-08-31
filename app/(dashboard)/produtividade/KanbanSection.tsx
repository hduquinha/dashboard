"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Columns3, FolderInput, Maximize2, Minimize2, SlidersHorizontal, UserPlus } from "lucide-react";
import { CrmKanbanView } from "@/components/CrmKanbanView";
import { AgendaPanel } from "@/components/AgendaPanel";
import { LeadProfileModal } from "@/components/LeadProfileModal";
import { TriageDistributionModal } from "@/components/TriageDistributionModal";
import { KanbanFiltersModal } from "./KanbanFiltersModal";
import type { KanbanFilter } from "@/lib/kanbanFilters";
import type { CommercialWorkspace } from "@/types/commercial";
import type { Funnel } from "@/types/funnel";
import type { ProductivityLeadAgent } from "@/types/productivity";
import type { TrainingOption } from "@/types/training";
import { hasPermission, type PermissionUser } from "@/lib/permissions";

export type KanbanMode = "mine" | "all" | "member";

/** Qual quadro está aberto: o Kanban de trabalho ou a pasta da Triagem de Leads. */
type BoardTab = "kanban" | "triagem";

interface TriageOverview {
  funnelId: number;
  funnelName: string;
  unassigned: number;
  assigned: number;
  mine: number;
  bySeller: Array<{ sellerId: number; sellerName: string; total: number }>;
}

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
  // ?quadro=triagem abre direto na pasta — é o link do aviso "leads de triagem
  // para conferir" que o vendedor recebe quando o admin distribui um lote.
  const searchParams = useSearchParams();
  const [boardTab, setBoardTab] = useState<BoardTab>(
    searchParams.get("quadro") === "triagem" ? "triagem" : "kanban"
  );
  const [triage, setTriage] = useState<TriageOverview | null>(null);
  const [showTriageModal, setShowTriageModal] = useState(false);

  // Funil ativo: vendedor pode ter varios funis atribuidos e trocar entre
  // eles (mesma UX do seletor de Filtro); comeca no funil padrao.
  const commercialFunnelsKey = JSON.stringify(commercial.funnels);
  const [fetchedFunnels, setFetchedFunnels] = useState<{
    key: string;
    funnels: Funnel[];
  } | null>(null);
  // Enquanto uma resposta de /api/funnels não corresponde às props novas do
  // servidor, usa as props. Isso permite que router.refresh reflita a
  // atribuição imediatamente, mesmo com o componente cliente montado.
  const funnelOptions =
    fetchedFunnels?.key === commercialFunnelsKey ? fetchedFunnels.funnels : commercial.funnels;
  const [activeFunnelId, setActiveFunnelId] = useState<number | null>(
    () => commercial.funnels.find((funnel) => funnel.isDefault)?.id ?? commercial.funnels[0]?.id ?? null
  );
  // Funis de trabalho e o funil de triagem são coisas diferentes na tela: o
  // seletor de funil só lista os de trabalho, e a triagem vira uma pasta
  // própria (aba) — senão o vendedor cairia na lista fria achando que é o
  // Kanban dele.
  const workFunnels = funnelOptions.filter((funnel) => !funnel.isTriage);
  const triageFunnel = funnelOptions.find((funnel) => funnel.isTriage) ?? null;
  const activeFunnel =
    workFunnels.find((funnel) => funnel.id === activeFunnelId) ?? workFunnels[0] ?? null;
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
          setFetchedFunnels({ key: commercialFunnelsKey, funnels: data.funnels });
          const work = data.funnels.filter((funnel) => !funnel.isTriage);
          setActiveFunnelId((current) =>
            current !== null && work.some((funnel) => funnel.id === current)
              ? current
              : work.find((funnel) => funnel.isDefault)?.id ?? work[0]?.id ?? null
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
  }, [commercialFunnelsKey]);
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

  // Contadores da pasta de triagem (quantos estão comigo / sem dono). Recarrega
  // junto com o board depois de distribuir ou aprovar.
  const loadTriage = useCallback(() => {
    fetch("/api/commercial/triage")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { overview?: TriageOverview | null } | null) => {
        setTriage(data?.overview ?? null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadTriage();
  }, [loadTriage, refreshToken]);


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

  const isKanbanTab = boardTab === "kanban" || !triageFunnel;
  // O vendedor precisa ver quantos tem pra conferir; o admin, quantos ainda
  // estão sem dono esperando distribuição.
  const triageBadge = isManager ? triage?.unassigned ?? 0 : triage?.mine ?? 0;

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
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex items-center gap-2 text-base font-semibold text-[rgb(var(--slate-12))]">
              <Columns3 className="h-4 w-4 text-[rgb(var(--blue-9))]" />
              Kanban
              {activeFilter && isKanbanTab ? (
                <span className="rounded-full bg-[rgb(var(--blue-3))] px-2 py-0.5 text-[10px] font-bold text-[rgb(var(--blue-11))]">
                  {activeFilter.name}
                </span>
              ) : null}
            </h2>

            {/* Pastas do quadro: o Kanban de trabalho e a Triagem de Leads
                (lista fria distribuída pelo admin, que só entra no CRM depois
                que o vendedor aprova). */}
            {triageFunnel && (
              <div className="flex items-center gap-1 rounded-lg bg-[rgba(var(--alpha-2))] p-0.5">
                <button
                  type="button"
                  onClick={() => setBoardTab("kanban")}
                  className={`h-7 rounded-md px-2.5 text-xs font-semibold transition ${
                    isKanbanTab
                      ? "bg-white text-[rgb(var(--slate-12))] shadow-sm"
                      : "text-[rgb(var(--slate-11))] hover:text-[rgb(var(--slate-12))]"
                  }`}
                >
                  Meu quadro
                </button>
                <button
                  type="button"
                  onClick={() => setBoardTab("triagem")}
                  className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition ${
                    !isKanbanTab
                      ? "bg-white text-[rgb(var(--slate-12))] shadow-sm"
                      : "text-[rgb(var(--slate-11))] hover:text-[rgb(var(--slate-12))]"
                  }`}
                  title="Lista fria distribuída pelos administradores — aprove o que prestar"
                >
                  <FolderInput className="h-3.5 w-3.5" />
                  Triagem de Leads
                  {triageBadge > 0 && (
                    <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800">
                      {triageBadge}
                    </span>
                  )}
                </button>
              </div>
            )}
          </div>

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

            {isKanbanTab && workFunnels.length > 1 && (
              <select
                value={activeFunnel?.id ?? ""}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10);
                  setActiveFunnelId(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
                }}
                className="h-8 rounded-lg border border-[rgb(var(--border-weak))] px-2 text-xs font-semibold text-[rgb(var(--slate-11))]"
                title="Funil"
                aria-label="Funil"
              >
                {workFunnels.map((funnel) => (
                  <option key={funnel.id} value={funnel.id}>
                    {funnel.name}
                  </option>
                ))}
              </select>
            )}

            {!isKanbanTab && isManager && (
              <button
                type="button"
                onClick={() => setShowTriageModal(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-neutral-900 px-3 text-xs font-semibold text-white transition hover:bg-neutral-800"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Distribuir leads
              </button>
            )}

            {isKanbanTab && filters.length > 0 && (
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

            {isKanbanTab && isManager && (
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

        {/* Agenda do vendedor logo acima do board: as tarefas do dia e as
            atrasadas ficam à vista sem sair do Kanban. Some no modo tela
            cheia, em que a intenção é ver o máximo de leads. */}
        {!isExpanded && isKanbanTab && (
          <div className="mb-3">
            <AgendaPanel
              onSelectLead={setSelectedId}
              refreshToken={refreshToken}
              onLeadChanged={handleLeadUpdated}
            />
          </div>
        )}

        {isKanbanTab ? (
          <CrmKanbanView
            onLeadMoved={onLeadMoved}
            selectedId={selectedId}
            onSelectLead={setSelectedId}
            produto={null}
            assignedSellerEmail={assignedSellerEmail}
            isSupervisor={isManager}
            stages={visibleStages}
            funnelId={activeFunnel?.id ?? null}
            assignedOnly
            filterId={activeFilterId}
            refreshToken={refreshToken}
            allowCloseLead
            allowRegisterSale={!currentUser || hasPermission(currentUser, "crm.register_sale")}
            sellers={commercial.sellers}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              <span className="font-semibold">
                Lista fria: estes contatos ainda não fazem parte do CRM geral.
              </span>
              <span>Aprovou? O lead sai da triagem e entra no seu Kanban com você como responsável.</span>
              {isManager && triage && (
                <span className="font-semibold">
                  {triage.unassigned.toLocaleString("pt-BR")} sem dono ·{" "}
                  {triage.assigned.toLocaleString("pt-BR")} distribuídos
                </span>
              )}
            </div>

            <CrmKanbanView
              onLeadMoved={handleLeadUpdated}
              selectedId={selectedId}
              onSelectLead={setSelectedId}
              produto={null}
              assignedSellerEmail={assignedSellerEmail}
              isSupervisor={isManager}
              stages={triageFunnel?.stages ?? []}
              funnelId={triageFunnel?.id ?? null}
              assignedOnly
              refreshToken={refreshToken}
              sellers={commercial.sellers}
              // Primeiro da lista é o destino do botão "Aprovar" do card: o
              // funil que a pessoa está trabalhando na outra aba.
              approveFunnels={[
                ...workFunnels.filter((funnel) => funnel.id === activeFunnel?.id),
                ...workFunnels.filter((funnel) => funnel.id !== activeFunnel?.id),
              ].map((funnel) => ({ id: funnel.id, name: funnel.name }))}
            />
          </>
        )}
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

      {showTriageModal && isManager && (
        <TriageDistributionModal
          sellers={commercial.sellers}
          sellerLoads={triage?.bySeller ?? []}
          onClose={() => setShowTriageModal(false)}
          onDistributed={() => {
            handleLeadUpdated();
            loadTriage();
          }}
        />
      )}
    </>
  );
}
