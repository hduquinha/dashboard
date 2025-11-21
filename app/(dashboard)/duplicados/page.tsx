import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { assertToken } from "@/lib/auth";
import { listDuplicateSuspects } from "@/lib/db";
import DuplicateAlerts from "@/components/DuplicateAlerts";

export const dynamic = "force-dynamic";

export default async function DuplicadosPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("dashboardToken")?.value;

  try {
    assertToken(token);
  } catch {
    redirect("/login");
  }

  const duplicateSummary = await listDuplicateSuspects({ maxGroups: 20 });

  return (
    <main className="min-h-screen bg-neutral-50">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        <header className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-neutral-500">
                Higienização
              </p>
              <h1 className="text-3xl font-semibold text-neutral-900">Possíveis duplicados</h1>
              <p className="text-sm text-neutral-600">
                Revise sugestões de duplicidade para manter sua base organizada.
              </p>
            </div>
            <span className="inline-flex items-center justify-center rounded-full bg-amber-500 px-6 py-2 text-sm font-semibold text-white shadow-lg">
              {duplicateSummary.totalGroups} pendente{duplicateSummary.totalGroups === 1 ? "" : "s"}
            </span>
          </div>
        </header>

        {duplicateSummary.groups.length === 0 ? (
          <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-5 text-sm text-emerald-900">
            Nenhuma duplicidade recente foi encontrada.
          </p>
        ) : (
          <DuplicateAlerts groups={duplicateSummary.groups} />
        )}
      </div>
    </main>
  );
}
