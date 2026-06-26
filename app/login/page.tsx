import type { Metadata } from "next";
import Image from "next/image";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  DASHBOARD_COOKIE_NAME,
  DASHBOARD_MFA_COOKIE_NAME,
  assertToken,
  readMfaChallengeValue,
} from "@/lib/auth";

interface LoginPageProps {
  searchParams:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>;
}

function pickString(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function pickMessage(searchParams: Record<string, string | string[] | undefined>): string | null {
  const value = pickString(searchParams.error);
  if (!value) {
    return null;
  }

  const messages: Record<string, string> = {
    config: "Configuracao de autenticacao ausente. Verifique as variaveis do Chatwoot.",
    forbidden: "Seu usuario do Chatwoot nao tem acesso a conta configurada para este painel.",
    invalid: "E-mail ou senha recusados pelo Chatwoot.",
    mfa_invalid: "Codigo MFA invalido ou expirado.",
    rate_limited: "Muitas tentativas de login. Aguarde alguns minutos e tente novamente.",
    unavailable: "Nao foi possivel falar com o Chatwoot agora.",
  };

  return messages[value] ?? null;
}

export const metadata: Metadata = {
  title: "Login | Dashboard Chatwoot",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(DASHBOARD_COOKIE_NAME)?.value;

  if (sessionToken) {
    let hasValidSession = false;
    try {
      assertToken(sessionToken);
      hasValidSession = true;
    } catch {
      // Let the login form render.
    }

    if (hasValidSession) {
      redirect("/");
    }
  }

  const resolvedSearchParams = await searchParams;
  const mfaChallenge = readMfaChallengeValue(cookieStore.get(DASHBOARD_MFA_COOKIE_NAME)?.value);
  const isMfaStep = pickString(resolvedSearchParams.step) === "mfa" && Boolean(mfaChallenge);
  const message = pickMessage(resolvedSearchParams);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[rgb(var(--background-color))] px-4 py-10 text-[rgb(var(--slate-12))]">
      <section className="w-full max-w-[420px] rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-7 shadow-[0_18px_60px_rgba(28,32,36,0.08)]">
        <div className="mb-7 flex items-center gap-3">
          <Image
            src="/chatwoot-logo-thumbnail.svg"
            alt="Chatwoot"
            width={36}
            height={36}
            priority
          />
          <div>
            <h1 className="text-lg font-semibold leading-6 text-[rgb(var(--slate-12))]">
              Dashboard Chatwoot
            </h1>
            <p className="text-sm text-[rgb(var(--slate-11))]">
              Use seu acesso do Chatwoot
            </p>
          </div>
        </div>

        <form action="/login/submit" method="post" className="space-y-4">
          {isMfaStep ? (
            <div className="space-y-2">
              <label className="text-sm font-medium text-[rgb(var(--slate-12))]" htmlFor="code">
                Codigo MFA
              </label>
              <input
                id="code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                className="h-10 w-full rounded-lg border border-[rgb(var(--border-strong))] bg-[rgba(var(--black-alpha-2))] px-3 text-sm text-[rgb(var(--slate-12))] outline-none transition focus:border-[rgb(var(--blue-9))] focus:ring-2 focus:ring-[rgba(var(--border-blue))]"
                placeholder="000000 ou codigo de backup"
              />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium text-[rgb(var(--slate-12))]" htmlFor="email">
                  E-mail
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="h-10 w-full rounded-lg border border-[rgb(var(--border-strong))] bg-[rgba(var(--black-alpha-2))] px-3 text-sm text-[rgb(var(--slate-12))] outline-none transition focus:border-[rgb(var(--blue-9))] focus:ring-2 focus:ring-[rgba(var(--border-blue))]"
                  placeholder="voce@empresa.com"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-[rgb(var(--slate-12))]" htmlFor="password">
                  Senha
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="h-10 w-full rounded-lg border border-[rgb(var(--border-strong))] bg-[rgba(var(--black-alpha-2))] px-3 text-sm text-[rgb(var(--slate-12))] outline-none transition focus:border-[rgb(var(--blue-9))] focus:ring-2 focus:ring-[rgba(var(--border-blue))]"
                  placeholder="Sua senha do Chatwoot"
                />
              </div>
            </>
          )}

          {message ? (
            <div className="rounded-lg border border-[rgb(var(--ruby-7))] bg-[rgb(var(--ruby-3))] px-3 py-2 text-sm text-[rgb(var(--ruby-11))]">
              {message}
            </div>
          ) : null}

          <button
            type="submit"
            className="flex h-10 w-full items-center justify-center rounded-lg bg-[rgb(var(--blue-9))] px-4 text-sm font-semibold text-white transition hover:bg-[rgb(var(--blue-10))] focus:outline-none focus:ring-2 focus:ring-[rgba(var(--border-blue))]"
          >
            {isMfaStep ? "Validar e entrar" : "Entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}
