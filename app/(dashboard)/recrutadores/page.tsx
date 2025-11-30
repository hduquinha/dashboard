import type { Metadata } from "next";
import RecruitersDirectory from "@/components/RecruitersDirectory";
import { buildNetworkTree, type NetworkNode } from "@/lib/network";
import { RECRUITERS_BASE_URL, listRecruiters } from "@/lib/recruiters";
import { listTrainingFilterOptions } from "@/lib/db";
import { listUnlinkedAnamneses } from "@/lib/anamnese";

export interface RecruiterDirectoryEntry {
  id: number;
  inscricaoId: number | null;
  name: string;
  code: string;
  url: string;
  isVirtual: boolean;
  telefone: string | null;
  cidade: string | null;
}

function collectRecruiterNodes(node: NetworkNode, entries: Map<string, RecruiterDirectoryEntry>): void {
  if (node.tipo === "recrutador" && node.code) {
    if (!entries.has(node.code)) {
      entries.set(node.code, {
        id: node.id,
        inscricaoId: node.id > 0 ? node.id : null,
        name: node.displayName,
        code: node.code,
        url: node.recrutadorUrl ?? `${RECRUITERS_BASE_URL}${node.code}`,
        isVirtual: node.isVirtual,
        telefone: node.telefone,
        cidade: node.cidade,
      });
    } else {
      const current = entries.get(node.code)!;
      if (current.isVirtual && !node.isVirtual) {
        entries.set(node.code, {
          ...current,
          id: node.id,
          inscricaoId: node.id > 0 ? node.id : null,
          name: node.displayName,
          isVirtual: node.isVirtual,
          telefone: node.telefone,
          cidade: node.cidade,
        });
      }
    }
  }

  node.children.forEach((child) => collectRecruiterNodes(child, entries));
}

function flattenRecruiters(roots: NetworkNode[], orphans: NetworkNode[]): RecruiterDirectoryEntry[] {
  const entries = new Map<string, RecruiterDirectoryEntry>();
  roots.forEach((root) => collectRecruiterNodes(root, entries));
  orphans.forEach((orphan) => collectRecruiterNodes(orphan, entries));

  return Array.from(entries.values()).sort((a, b) => {
    const codeA = Number.parseInt(a.code, 10);
    const codeB = Number.parseInt(b.code, 10);
    if (Number.isFinite(codeA) && Number.isFinite(codeB)) {
      return codeA - codeB;
    }
    return a.code.localeCompare(b.code);
  });
}

export const metadata: Metadata = {
  title: "Recrutadores | Painel de Inscrições",
  description: "Gerencie os links dos recrutadores e crie novos códigos de indicação.",
};

export default async function RecruitersPage() {
  const tree = await buildNetworkTree();
  const recruiters = flattenRecruiters(tree.roots, tree.orphans);
  const [trainingOptions, recruiterOptions, unlinkedAnamneses] = await Promise.all([
    listTrainingFilterOptions(),
    Promise.resolve(listRecruiters()),
    listUnlinkedAnamneses(),
  ]);

  return (
    <main className="px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="space-y-3">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-neutral-500">Recrutadores</p>
            <h1 className="text-2xl font-semibold text-neutral-900">Base de indicadores oficiais</h1>
            <p className="text-sm text-neutral-600">
              Centralize os códigos de indicação e compartilhe o link correto com cada recrutador.
            </p>
          </div>
        </header>

        <RecruitersDirectory
          recruiters={recruiters}
          trainingOptions={trainingOptions}
          recruiterOptions={recruiterOptions}
          unlinkedAnamneses={unlinkedAnamneses}
        />
      </div>
    </main>
  );
}
