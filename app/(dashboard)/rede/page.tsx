import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import NetworkCanvas from "@/components/NetworkCanvas";
import { assertToken } from "@/lib/auth";
import { buildNetworkTree } from "@/lib/network";
import { listTrainingFilterOptions } from "@/lib/db";
import { listRecruiters } from "@/lib/recruiters";

export const metadata: Metadata = {
  title: "Rede | Painel de Inscrições",
  description: "Visualize a rede de recrutadores e leads em formato de workflow.",
};

interface RedePageProps {
  searchParams:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>;
}

function pickStringParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export default async function RedePage(props: RedePageProps) {
  const searchParams = await props.searchParams;
  const focusParam = pickStringParam(searchParams?.focus) ?? null;

  const cookieStore = await cookies();
  const token = cookieStore.get("dashboardToken")?.value;

  try {
    assertToken(token);
  } catch {
    redirect("/login");
  }

  const [tree, trainingOptions, recruiterOptions] = await Promise.all([
    buildNetworkTree({ focus: focusParam }),
    listTrainingFilterOptions(),
    Promise.resolve(listRecruiters()),
  ]);

  return (
    <main className="flex h-[calc(100vh-64px)] flex-col overflow-hidden bg-white">
      <div className="flex h-full w-full flex-col">
        <header className="flex flex-shrink-0 items-center justify-between border-b border-neutral-200 px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">Rede de Recrutadores</h1>
            <p className="text-xs text-neutral-500">
              Visualização em workflow interativo. Use o scroll para zoom e arraste para navegar.
            </p>
          </div>
        </header>

        <div className="flex-1 overflow-hidden bg-neutral-50">
          <NetworkCanvas
            roots={tree.roots}
            trainingOptions={trainingOptions}
            recruiterOptions={recruiterOptions}
          />
        </div>
      </div>
    </main>
  );
}
