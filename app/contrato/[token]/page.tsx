import type { Metadata } from "next";
import { headers } from "next/headers";
import { getContractByToken, registerContractOpened } from "@/lib/contracts";
import { AssinaturaClient } from "./AssinaturaClient";

export const dynamic = "force-dynamic";

/**
 * Página PÚBLICA de assinatura — a única rota do dashboard sem login.
 *
 * Fica fora do grupo `(dashboard)` (sem menu lateral, sem sessão) e fora do
 * `matcher` do `middleware.ts` de propósito: quem abre é o aluno, pelo link
 * que recebeu no WhatsApp. A porta é o token, não o cookie.
 *
 * `noindex` porque contrato de aluno não pode aparecer em busca.
 */
export const metadata: Metadata = {
  title: "Contrato de matrícula",
  description: "Leia e assine seu contrato de matrícula.",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function ContratoPage({ params }: PageProps) {
  const { token } = await params;

  // A abertura é gravada ANTES de ler o contrato, e não depois: a página conta
  // o tempo mínimo de leitura a partir de `openedAt`, e se ele chegasse nulo na
  // primeira visita o contador não teria de onde partir. Para token inexistente
  // ou contrato já assinado esta chamada não faz nada.
  const headerList = await headers();
  await registerContractOpened(token, {
    ip: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? headerList.get("x-real-ip"),
    userAgent: headerList.get("user-agent"),
  });

  const contract = await getContractByToken(token);

  if (!contract) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-6 text-center">
        <h1 className="text-xl font-bold text-neutral-900">Link não encontrado</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Este link de contrato não existe mais ou foi substituído por um novo. Peça outro para a escola.
        </p>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <AssinaturaClient contract={contract} token={token} />
    </div>
  );
}
