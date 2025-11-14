import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import DashboardNav from "@/components/DashboardNav";
import NetworkTree from "@/components/NetworkTree";
import { assertToken } from "@/lib/auth";
import { buildNetworkTree } from "@/lib/network";

export const metadata: Metadata = {
  title: "Rede | Painel de Inscrições",
  description: "Visualize a rede de recrutadores e leads em formato de árvore.",
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

  const tree = await buildNetworkTree({ focus: focusParam });

  return (
    <main className="min-h-screen bg-neutral-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
        <header className="space-y-3">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold text-neutral-900">Rede de Recrutadores</h1>
            <p className="text-sm text-neutral-600">
              Explore a árvore completa de recrutadores e leads para mapear a estrutura do marketing multinível.
            </p>
          </div>
          <DashboardNav />
        </header>

        <section className="rounded-lg border border-neutral-200 bg-white/60 p-6">
          <NetworkTree roots={tree.roots} orphans={tree.orphans} stats={tree.stats} focus={tree.focus} />
        </section>
      </div>
    </main>
  );
}
