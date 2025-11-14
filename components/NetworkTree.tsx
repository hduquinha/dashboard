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
      <li key={node.id} className="space-y-2">
        <div
          className={`flex items-start gap-3 rounded-md border px-3 py-2 shadow-sm transition ${
            isFocus ? "border-neutral-900 bg-neutral-900/5" : "border-neutral-200 bg-white"
          }`}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggleNode(node.id)}
              className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-neutral-300 text-xs font-semibold text-neutral-600 transition hover:border-neutral-400 hover:text-neutral-900"
            >
              {isExpanded ? "−" : "+"}
            </button>
          ) : (
            <span className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-transparent text-xs text-neutral-400">
              •
            </span>
          )}
          <div className="flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-neutral-900">{node.displayName}</span>
              {node.code ? (
                <span className="inline-flex items-center rounded-full bg-neutral-900 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
                  Código {node.code}
                </span>
              ) : null}
              {node.isVirtual ? (
                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                  Virtual
                </span>
              ) : null}
              {node.tipo === "recrutador" ? (
                <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                  Recrutador
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-sky-700">
                  Lead
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
              {node.recrutadorCodigo ? <span>Indicador: {node.recrutadorCodigo}</span> : null}
              {typeof node.nivel === "number" ? <span>Nível: {node.nivel}</span> : null}
              {node.telefone ? <span>Telefone: {node.telefone}</span> : null}
              {node.cidade ? <span>Cidade: {node.cidade}</span> : null}
              <span>Diretos: {node.directLeadCount + node.directRecruiterCount}</span>
              <span>Descendentes: {node.totalDescendants}</span>
            </div>
          </div>
        </div>
        {hasChildren && isExpanded ? (
          <ul className="ml-8 border-l border-neutral-200 pl-4">
            {node.children.map((child) => renderNode(child))}
          </ul>
        ) : null}
      </li>
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
            <ul className="space-y-4">
              {roots.map((root) => renderNode(root))}
            </ul>
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
