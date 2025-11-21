"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import InscricaoDetails from "@/components/InscricaoDetails";
import type { NetworkNode, NetworkTreeFocus, NetworkTreeStats } from "@/lib/network";
import type { TrainingOption } from "@/types/training";
import type { Recruiter } from "@/lib/recruiters";
import type { InscricaoItem } from "@/types/inscricao";

interface NetworkTreeProps {
  roots: NetworkNode[];
  orphans: NetworkNode[];
  stats: NetworkTreeStats;
  focus: NetworkTreeFocus | null;
  trainingOptions: TrainingOption[];
  recruiterOptions: Recruiter[];
}

function computeInitialExpanded(focus: NetworkTreeFocus | null): number[] {
  if (!focus?.path?.length) {
    return [];
  }
  return [...new Set(focus.path)];
}

function findNodeById(nodes: NetworkNode[], id: number): NetworkNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const child = findNodeById(node.children, id);
    if (child) {
      return child;
    }
  }
  return null;
}

interface NetworkTreeInnerProps extends NetworkTreeProps {
  initialExpandedIds: number[];
}

function NetworkTreeInner({
  roots,
  orphans,
  stats,
  focus,
  trainingOptions,
  recruiterOptions,
  initialExpandedIds,
}: NetworkTreeInnerProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set(initialExpandedIds));
  const [selectedInscricao, setSelectedInscricao] = useState<InscricaoItem | null>(null);
  const [isDetailsLoading, setIsDetailsLoading] = useState(false);
  const [pendingNodeId, setPendingNodeId] = useState<number | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  const displayedRoots = useMemo(() => {
    if (!focus?.nodeId) {
      return roots;
    }
    const node = findNodeById(roots, focus.nodeId);
    return node ? [node] : roots;
  }, [roots, focus]);

  function toggleNode(id: number) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const loadInscricaoDetails = useCallback(
    async (node: NetworkNode) => {
      if (node.id <= 0) {
        setDetailsError("Perfis virtuais não podem ser editados diretamente.");
        setSelectedInscricao(null);
        return;
      }

      setDetailsError(null);
      setPendingNodeId(node.id);
      setIsDetailsLoading(true);

      try {
        const response = await fetch(`/api/inscricoes/${node.id}`);
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          setDetailsError(payload?.error ?? "Não foi possível carregar o cadastro.");
          setSelectedInscricao(null);
          return;
        }

        const data = (await response.json()) as { inscricao?: InscricaoItem };
        setSelectedInscricao(data.inscricao ?? null);
      } catch (error) {
        console.error("Failed to load inscrição", error);
        setDetailsError("Erro inesperado ao abrir o cadastro.");
      } finally {
        setIsDetailsLoading(false);
        setPendingNodeId(null);
      }
    },
    []
  );

  const handleNodeCardClick = useCallback(
    (node: NetworkNode) => {
      void loadInscricaoDetails(node);
    },
    [loadInscricaoDetails]
  );

  function renderNode(node: NetworkNode): ReactElement {
    const hasChildren = node.children.length > 0;
    const isExpanded = hasChildren && expanded.has(node.id);
    const isFocus = focus?.nodeId === node.id;
    const isLoadingNode = pendingNodeId === node.id && isDetailsLoading;

    return (
      <div className="flex flex-col items-center">
        <div
          role="button"
          tabIndex={0}
          onClick={() => handleNodeCardClick(node)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleNodeCardClick(node);
            }
          }}
          className={`relative flex cursor-pointer flex-col items-center rounded-2xl border-2 px-4 py-3 text-center shadow-md transition hover:-translate-y-1 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-sky-500 ${
            isFocus ? "border-sky-600 bg-sky-50" : "border-neutral-200 bg-white"
          } ${isLoadingNode ? "opacity-70" : ""}`}
          aria-pressed={isFocus}
          aria-busy={isLoadingNode}
        >
          <span
            className={`mb-2 inline-flex h-10 w-10 items-center justify-center rounded-full text-lg ${
              node.tipo === "recrutador" ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"
            }`}
          >
            {node.tipo === "recrutador" ? "👤" : "🧲"}
          </span>
          <span className="text-sm font-semibold text-neutral-900">{node.displayName}</span>
          {node.code ? (
            <span className="mt-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{`Código ${node.code}`}</span>
          ) : null}
          <div className="mt-2 text-[11px] text-neutral-600">
            {node.recrutadorCodigo ? <p>Indicador: {node.recrutadorCodigo}</p> : null}
            {node.telefone ? <p>Telefone: {node.telefone}</p> : null}
            {node.cidade ? <p>Cidade: {node.cidade}</p> : null}
            <p>
              Diretos: {node.directLeadCount + node.directRecruiterCount} · Descendentes: {node.totalDescendants}
            </p>
          </div>
          {node.tipo === "recrutador" ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                router.push(`/rede?focus=${node.id}`);
              }}
              className="mt-3 rounded-full border border-neutral-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-600 transition hover:border-neutral-500 hover:text-neutral-900"
            >
              Ver árvore completa
            </button>
          ) : null}
          {hasChildren ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                toggleNode(node.id);
              }}
              className="absolute -bottom-4 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-neutral-900 text-white shadow-lg"
              aria-label={isExpanded ? "Recolher" : "Expandir"}
            >
              {isExpanded ? "−" : "+"}
            </button>
          ) : null}
        </div>
        {hasChildren && isExpanded ? (
          <div className="relative mt-6 flex w-full flex-col items-center">
            <span className="mb-4 h-10 w-px bg-neutral-300" aria-hidden="true" />
            <div className="flex flex-row flex-nowrap justify-center gap-8">
              {node.children.map((child, index) => (
                <div key={child.id} className="relative flex flex-col items-center pt-6">
                  {/* Horizontal line to the left (hidden for first child) */}
                  <div
                    className={`absolute left-0 top-0 h-px w-1/2 bg-neutral-300 ${
                      index === 0 ? "hidden" : "block"
                    }`}
                  />
                  {/* Horizontal line to the right (hidden for last child) */}
                  <div
                    className={`absolute right-0 top-0 h-px w-1/2 bg-neutral-300 ${
                      index === node.children.length - 1 ? "hidden" : "block"
                    }`}
                  />
                  {/* Vertical line from top to child */}
                  <div className="absolute left-1/2 top-0 h-6 w-px -translate-x-1/2 bg-neutral-300" />
                  {renderNode(child)}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {detailsError ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {detailsError}
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-4 rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-700 md:grid-cols-5">
        <div>
          <span className="block text-xs uppercase tracking-wide text-neutral-500">Total</span>
          <strong className="text-lg text-neutral-900">{stats.total}</strong>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-neutral-500">Recrutadores</span>
          <strong className="text-lg text-neutral-900">{stats.recruiters}</strong>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-neutral-500">Leads</span>
          <strong className="text-lg text-neutral-900">{stats.leads}</strong>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-neutral-500">Recrutadores virtuais</span>
          <strong className="text-lg text-neutral-900">{stats.virtualRecruiters}</strong>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-neutral-500">Sem indicador</span>
          <strong className="text-lg text-neutral-900">{stats.orphans}</strong>
        </div>
      </section>

      {focus?.nodeId ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <span>
            Mostrando a rede do recrutador {focus.code ?? `#${focus.nodeId}`}.
          </span>
          <button
            type="button"
            className="rounded-full bg-sky-600 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-sky-700"
            onClick={() => router.push("/rede")}
          >
            Ver visão completa
          </button>
        </div>
      ) : null}

      <div className="space-y-6">
        {displayedRoots.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">Redes de recrutadores</h2>
            <div className="space-y-8 overflow-x-auto pb-6">
              <div className="flex min-w-full w-fit flex-col items-center">
                {displayedRoots.map((root) => (
                  <div key={root.id} className="mb-8">
                    {renderNode(root)}
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : (
          <p className="rounded-md border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-600">
            Nenhum recrutador encontrado.
          </p>
        )}

        {orphans.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">Sem indicador atribuído</h2>
            <ul className="space-y-2">
              {orphans.map((node) => (
                <li key={node.id}>
                  <button
                    type="button"
                    onClick={() => handleNodeCardClick(node)}
                    className="flex w-full flex-col rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm text-amber-800 transition hover:border-amber-400 hover:bg-amber-100"
                  >
                    <span className="font-semibold">{node.displayName}</span>
                    {node.telefone ? <span className="text-xs">{node.telefone}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <InscricaoDetails
        inscricao={selectedInscricao}
        onClose={() => setSelectedInscricao(null)}
        onUpdate={(updated) => setSelectedInscricao(updated)}
        trainingOptions={trainingOptions}
        recruiterOptions={recruiterOptions}
      />
    </div>
  );
}

export default function NetworkTree(props: NetworkTreeProps) {
  const initialExpandedIds = useMemo(() => computeInitialExpanded(props.focus), [props.focus]);
  const resetKey = useMemo(() => {
    const focusKey = props.focus?.nodeId ?? "none";
    return `${focusKey}-${initialExpandedIds.join("-")}`;
  }, [props.focus, initialExpandedIds]);

  return (
    <NetworkTreeInner
      key={resetKey}
      {...props}
      initialExpandedIds={initialExpandedIds}
    />
  );
}
