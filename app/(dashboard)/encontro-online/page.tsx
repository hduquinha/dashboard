import type { Metadata } from "next";
import EncontroOnlineClient from "./EncontroOnlineClient";

export const metadata: Metadata = {
  title: "Encontro Online — Presença Gravada",
};

export const dynamic = "force-dynamic";

export default function EncontroOnlinePage() {
  return (
    <main className="px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#2DBDC2]">
            Encontro Online
          </p>
          <h1 className="mt-1 text-2xl font-bold text-neutral-800">
            Presença — Aula Gravada
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Dados de presença importados do sistema Encontro Online (aula
            gravada).
          </p>
        </div>

        <EncontroOnlineClient />
      </div>
    </main>
  );
}
