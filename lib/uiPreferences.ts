import { getPool } from "@/lib/db";

/**
 * Preferências de tela por pessoa: o que cada um quer ver e o que quer
 * esconder. Fica no banco (e não no navegador) porque a mesma pessoa abre o
 * dashboard no celular e no computador, e "sumiu tudo que eu tinha
 * configurado" ao trocar de aparelho é indistinguível de um bug.
 *
 * O formato é um JSON livre por escopo (`campanhas`, e o que vier depois): a
 * tela decide o que guarda ali, o servidor só garante que é objeto e que
 * pertence a quem está pedindo.
 */

const SCHEMA = "dashboard";
let schemaReady = false;

export type UiPreferences = Record<string, unknown>;

async function ensureUiPreferencesSchema(): Promise<void> {
  if (schemaReady) return;
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.ui_preferences (
      user_email TEXT NOT NULL,
      scope TEXT NOT NULL,
      prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_email, scope)
    );
  `);
  schemaReady = true;
}

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

export async function getUiPreferences(email: string | null | undefined, scope: string): Promise<UiPreferences> {
  const userEmail = normalizeEmail(email);
  if (!userEmail || !scope) return {};
  await ensureUiPreferencesSchema();

  const { rows } = await getPool().query<{ prefs: UiPreferences }>(
    `SELECT prefs FROM ${SCHEMA}.ui_preferences WHERE user_email = $1 AND scope = $2`,
    [userEmail, scope]
  );
  return rows[0]?.prefs ?? {};
}

export async function saveUiPreferences(
  email: string | null | undefined,
  scope: string,
  prefs: UiPreferences
): Promise<UiPreferences> {
  const userEmail = normalizeEmail(email);
  if (!userEmail) throw new Error("Sessao sem usuario para salvar preferencias.");
  if (!scope) throw new Error("Informe o escopo da preferencia.");
  await ensureUiPreferencesSchema();

  // Limite de tamanho: é configuração de tela, não depósito de dados. Sem isso
  // um bug no cliente poderia empurrar um payload arbitrário para o banco.
  const serialized = JSON.stringify(prefs ?? {});
  if (serialized.length > 8000) {
    throw new Error("Preferencias grandes demais.");
  }

  const { rows } = await getPool().query<{ prefs: UiPreferences }>(
    `INSERT INTO ${SCHEMA}.ui_preferences (user_email, scope, prefs, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     ON CONFLICT (user_email, scope)
     DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = NOW()
     RETURNING prefs`,
    [userEmail, scope, serialized]
  );
  return rows[0]?.prefs ?? {};
}

/** Número positivo dentro das prefs (ex.: ticket médio); null quando ausente,
 * zerado ou lixo — quem lê decide o que fazer com a falta. */
export function readPositiveNumber(prefs: UiPreferences, key: string): number | null {
  const value = prefs[key];
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** String simples dentro das prefs (ex.: etapa escolhida como venda). */
export function readString(prefs: UiPreferences, key: string): string | null {
  const value = prefs[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Lista de strings dentro das prefs (ex.: abas escondidas), tolerante a lixo. */
export function readStringList(prefs: UiPreferences, key: string): string[] {
  const value = prefs[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, 50);
}
