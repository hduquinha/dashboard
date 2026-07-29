/**
 * Cliente da API do Chatwoot (account-scoped) para a integração dashboard <->
 * Chatwoot da Fase 2. A dashboard é a fonte da verdade dos usuários; aqui ficam
 * as chamadas que espelham/consultam agentes e contatos no Chatwoot.
 *
 * Config por env (ver docker-compose dashboard + .env raiz):
 *   CHATWOOT_API_URL   (ex.: http://chatwoot-rails:3000, rede interna)
 *   CHATWOOT_ACCOUNT_ID (ex.: 1)
 *   CHATWOOT_API_TOKEN  (access_token de um admin da conta)
 *
 * Regra de ouro: nada aqui pode derrubar a operação principal da dashboard —
 * toda função devolve um resultado tipado { ok, ... } em vez de lançar.
 */

const API_URL = (process.env.CHATWOOT_API_URL ?? "").replace(/\/+$/, "");
const ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID ?? "";
const API_TOKEN = process.env.CHATWOOT_API_TOKEN ?? "";

export function isChatwootConfigured(): boolean {
  return Boolean(API_URL && ACCOUNT_ID && API_TOKEN);
}

export interface ChatwootAgent {
  id: number;
  name: string;
  email: string;
  role: "agent" | "administrator";
  confirmed: boolean;
  availability_status?: string;
}

export interface ChatwootContact {
  id: number;
  name: string | null;
  email: string | null;
  phone_number: string | null;
  identifier: string | null;
}

type CwResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function request<T>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown
): Promise<CwResult<T>> {
  if (!isChatwootConfigured()) {
    return { ok: false, status: 0, error: "Chatwoot não configurado (CHATWOOT_API_URL/ACCOUNT_ID/API_TOKEN)." };
  }
  try {
    const res = await fetch(`${API_URL}/api/v1/accounts/${ACCOUNT_ID}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        api_access_token: API_TOKEN,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // Nunca segurar a request da dashboard por muito tempo por causa do Chatwoot.
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    const parsed = text ? (JSON.parse(text) as T) : (undefined as T);
    if (!res.ok) {
      const message =
        parsed && typeof parsed === "object" && "message" in parsed
          ? String((parsed as Record<string, unknown>).message)
          : `HTTP ${res.status}`;
      return { ok: false, status: res.status, error: message };
    }
    return { ok: true, data: parsed };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "Falha de rede ao chamar o Chatwoot.",
    };
  }
}

/** Lista os agentes da conta. */
export function listChatwootAgents(): Promise<CwResult<ChatwootAgent[]>> {
  return request<ChatwootAgent[]>("GET", "/agents");
}

/** Convida/cria um agente (o Chatwoot envia convite por e-mail p/ definir senha). */
export function createChatwootAgent(input: {
  name: string;
  email: string;
  role?: "agent" | "administrator";
}): Promise<CwResult<ChatwootAgent>> {
  return request<ChatwootAgent>("POST", "/agents", {
    name: input.name,
    email: input.email,
    role: input.role ?? "agent",
  });
}

/** Atualiza papel/nome de um agente existente. */
export function updateChatwootAgent(
  agentId: number,
  input: { role?: "agent" | "administrator"; availability?: string }
): Promise<CwResult<ChatwootAgent>> {
  return request<ChatwootAgent>("PATCH", `/agents/${agentId}`, input);
}

/** Remove um agente da conta (não apaga o usuário global). */
export function deleteChatwootAgent(agentId: number): Promise<CwResult<undefined>> {
  return request<undefined>("DELETE", `/agents/${agentId}`);
}
