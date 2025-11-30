import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import NetworkCanvas from "@/components/NetworkCanvas";
import RecruiterAnamneseList from "@/components/RecruiterAnamneseList";
import { buildNetworkTree } from "@/lib/network";
import { listTrainingFilterOptions } from "@/lib/db";
import { listRecruiters } from "@/lib/recruiters";
import { getAnamneseByRecruiter } from "@/lib/anamnese";

interface PageProps {
  params: Promise<{ code: string }>;
}


export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const label = params.code?.toUpperCase() ?? "Recrutador";
  return {
    title: `${label} | Rede de recrutadores`,
    description: `Visualize a árvore completa a partir do código ${label}.`,
  };
}

export default async function RecruiterDetailPage(props: PageProps) {
  const params = await props.params;
  const code = params.code ?? "";
  const [tree, trainingOptions, recruiterOptions, anamneses] = await Promise.all([
    buildNetworkTree({ focus: code }),
    listTrainingFilterOptions(),
    Promise.resolve(listRecruiters()),
    getAnamneseByRecruiter(code),
  ]);

  if (!tree.focus?.nodeId) {
    notFound();
  }

  return (
    <main className="flex h-[calc(100vh-64px)] flex-col overflow-hidden bg-white">
      <div className="flex h-full w-full flex-col overflow-y-auto">
        <header className="flex flex-shrink-0 items-center justify-between border-b border-neutral-200 px-6 py-4">
          <div className="space-y-1">
            <Link
              href="/recrutadores"
              className="text-xs font-semibold text-neutral-500 hover:text-neutral-900"
            >
              ← Voltar
            </Link>
            <h1 className="text-lg font-semibold text-neutral-900">Rede de {code.toUpperCase()}</h1>
          </div>
        </header>

        <div className="flex-1 bg-neutral-50 min-h-[500px]">
          <NetworkCanvas
            roots={tree.roots}
            trainingOptions={trainingOptions}
            recruiterOptions={recruiterOptions}
          />
        </div>

        <RecruiterAnamneseList anamneses={anamneses} />
      </div>
    </main>
  );
}
