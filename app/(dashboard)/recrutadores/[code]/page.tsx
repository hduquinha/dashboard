import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import DashboardNav from "@/components/DashboardNav";
import NetworkTree from "@/components/NetworkTree";
import { listDuplicateSuspects } from "@/lib/db";
import { buildNetworkTree } from "@/lib/network";

interface PageProps {
  params: { code: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const label = params.code?.toUpperCase() ?? "Recrutador";
  return {
    title: `${label} | Rede de recrutadores`,
    description: `Visualize a árvore completa a partir do código ${label}.`,
  };
}

export default async function RecruiterDetailPage({ params }: PageProps) {
  const code = params.code ?? "";
  const [tree, duplicateSummary] = await Promise.all([
    buildNetworkTree({ focus: code }),
    listDuplicateSuspects({ maxGroups: 1 }),
  ]);

  if (!tree.focus?.nodeId) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-neutral-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
        <header className="space-y-3">
          <div className="space-y-2">
            <Link
              href="/recrutadores"
              className="inline-flex items-center text-sm font-semibold text-neutral-500 hover:text-neutral-900"
            >
              ← Voltar para recrutadores
            </Link>
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold text-neutral-900">Rede do recrutador {code.toUpperCase()}</h1>
              <p className="text-sm text-neutral-600">
                Utilize esta visão para revisar descendentes, detectar gargalos e compartilhar com o time.
              </p>
            </div>
          </div>
          <DashboardNav duplicateCount={duplicateSummary.totalGroups} />
        </header>

        <NetworkTree
          roots={tree.roots}
          orphans={tree.orphans}
          stats={tree.stats}
          focus={tree.focus}
        />
      </div>
    </main>
  );
}
