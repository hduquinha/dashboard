"use client";

import { useMemo, useState, type ReactElement } from "react";
import type { NetworkNode, NetworkTreeFocus, NetworkTreeStats } from "@/lib/network";

interface NetworkTreeProps {
  roots: NetworkNode[];
  orphans: NetworkNode[];
  stats: NetworkTreeStats;
  focus: NetworkTreeFocus | null;
}

function computeInitialExpanded(roots: NetworkNode[], focus: NetworkTreeFocus | null): number[] {
  const ids = new Set<number>();
  if (focus?.path) {
    focus.path.forEach((id) => ids.add(id));
  }
  roots
    .filter((node) => node.children.length > 0)
    .slice(0, 3)
    .forEach((node) => ids.add(node.id));
  return Array.from(ids);
}

interface NetworkTreeInnerProps extends NetworkTreeProps {
  initialExpandedIds: number[];
}

function NetworkTreeInner({ roots, orphans, stats, focus, initialExpandedIds }: NetworkTreeInnerProps) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set(initialExpandedIds));

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

  function renderNode(node: NetworkNode): ReactElement {
    const hasChildren = node.children.length > 0;
    const isExpanded = hasChildren && expanded.has(node.id);
    const isFocus = focus?.nodeId === node.id;

    return (
      <div className="flex flex-col items-center">
        <div
          className={`relative flex flex-col items-center rounded-2xl border-2 px-4 py-3 text-center shadow-md transition ${
            isFocus ? "border-sky-600 bg-sky-50" : "border-neutral-200 bg-white"
          }`}
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
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggleNode(node.id)}
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
            <div className="relative flex flex-wrap justify-center gap-8 before:absolute before:left-0 before:right-0 before:top-0 before:h-px before:bg-neutral-200">
              {node.children.map((child) => (
                <div
                  key={child.id}
                  className="relative pt-6 before:absolute before:top-0 before:left-1/2 before:h-6 before:w-px before:-translate-x-1/2 before:bg-neutral-200"
                >
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

      <div className="space-y-6">
        {roots.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">Redes de recrutadores</h2>
            <div className="space-y-8">
              {roots.map((root) => (
                <div key={root.id}>{renderNode(root)}</div>
              ))}
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
                <li key={node.id} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {node.displayName}
                  {node.telefone ? <span className="ml-2 text-xs">{node.telefone}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

export default function NetworkTree(props: NetworkTreeProps) {
  const initialExpandedIds = useMemo(
    () => computeInitialExpanded(props.roots, props.focus),
    [props.roots, props.focus]
  );
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
