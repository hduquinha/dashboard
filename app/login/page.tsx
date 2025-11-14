import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { assertToken } from "@/lib/auth";

interface LoginPageProps {
  searchParams:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>;
}

function pickMessage(searchParams: Record<string, string | string[] | undefined>): string | null {
  const error = searchParams.error;
  if (!error) {
    return null;
  }
  const value = Array.isArray(error) ? error[0] : error;
  if (value === "invalid") {
    return "Token inválido. Verifique e tente novamente.";
  }
  return null;
}

export const metadata: Metadata = {
  title: "Login | Painel de Inscrições",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const cookieStore = await cookies();
  const token = cookieStore.get("dashboardToken")?.value;
  if (token) {
    try {
      assertToken(token);
      redirect("/");
    } catch {
      // Ignore and allow login to proceed.
    }
  }

  const resolvedSearchParams = await searchParams;
  const message = pickMessage(resolvedSearchParams);

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-4">
      <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-lg font-semibold text-neutral-900">Acessar painel</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Informe o token de acesso para visualizar as inscrições.
        </p>

        <form action="/login/submit" method="post" className="mt-6 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-700" htmlFor="token">
              Token de acesso
            </label>
            <input
              id="token"
              name="token"
              type="password"
              required
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
              placeholder="Insira o token compartilhado"
            />
          </div>

          {message ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {message}
            </div>
          ) : null}

          <button
            type="submit"
            className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700"
          >
            Entrar
          </button>
        </form>
      </div>
    </main>
  );
}
