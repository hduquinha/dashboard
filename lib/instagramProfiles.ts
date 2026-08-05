import { getPool } from "@/lib/db";
import { getFacebookAccessToken } from "@/lib/facebookLeadAds";

/**
 * Seguidores dos perfis do Instagram ligados à conta de anúncios.
 *
 * **O que a Meta NÃO entrega, e por isso não existe aqui:** não há atribuição
 * de seguidor por campanha. O relatório de anúncios não devolve nenhum evento
 * de "seguiu" e o insight diário do Instagram (`follower_count`) exige a
 * permissão `instagram_manage_insights`, que o app "Webhook formularios" não
 * tem — testado em 2026-07-30, resposta #10. Prometer "esta campanha trouxe N
 * seguidores" seria inventar número.
 *
 * **O que dá para fazer com o token atual:** ler o total de seguidores agora
 * (`followers_count`) e guardar uma foto por dia. Com isso o crescimento vira
 * série real do dia da instalação em diante — comparável com o investimento do
 * mesmo período, como correlação declarada, não como atribuição.
 */

const GRAPH_API_VERSION = "v21.0";
const SCHEMA = "meta_ads";
const TIME_ZONE = "America/Sao_Paulo";

let schemaReady = false;

async function ensureInstagramSchema(): Promise<void> {
  if (schemaReady) return;
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.instagram_profiles (
      ig_user_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      last_synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.instagram_profile_snapshots (
      ig_user_id TEXT NOT NULL REFERENCES ${SCHEMA}.instagram_profiles(ig_user_id) ON DELETE CASCADE,
      date DATE NOT NULL,
      followers_count INTEGER NOT NULL,
      media_count INTEGER NOT NULL,
      captured_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      PRIMARY KEY (ig_user_id, date)
    );
  `);
  schemaReady = true;
}

function requireAdAccountId(): string {
  const raw = process.env.META_ADS_AD_ACCOUNT_ID?.trim();
  if (!raw) throw new Error("META_ADS_AD_ACCOUNT_ID nao configurado.");
  return raw.startsWith("act_") ? raw : `act_${raw}`;
}

async function graph<T>(path: string): Promise<T> {
  const token = getFacebookAccessToken();
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${path}${separator}access_token=${encodeURIComponent(token)}`,
    { cache: "no-store" }
  );
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok || body?.error) {
    throw new Error(body?.error?.message ?? `Graph respondeu ${response.status}`);
  }
  return body;
}

export interface InstagramProfileSnapshot {
  igUserId: string;
  username: string;
  date: string;
  followersCount: number;
  mediaCount: number;
}

/** Perfis do Instagram vinculados à conta de anúncios (é assim que a Meta
 * expõe quais perfis podem veicular anúncios desta conta). */
async function fetchLinkedProfiles(): Promise<Array<{ id: string; username: string }>> {
  const data = await graph<{ data?: Array<{ id: string; username?: string }> }>(
    `${requireAdAccountId()}/instagram_accounts?fields=id,username&limit=50`
  );
  return (data.data ?? [])
    .filter((profile) => profile.username)
    .map((profile) => ({ id: profile.id, username: profile.username as string }));
}

/**
 * Guarda a foto de hoje (seguidores e publicações) de cada perfil ligado à
 * conta. Idempotente: rodar várias vezes no mesmo dia só atualiza a linha do
 * dia, então pode ser chamada em todo sync sem inflar a série.
 */
export async function snapshotInstagramProfiles(): Promise<{ profiles: number }> {
  await ensureInstagramSchema();
  const pool = getPool();
  const profiles = await fetchLinkedProfiles();
  let stored = 0;

  for (const profile of profiles) {
    try {
      const detail = await graph<{ followers_count?: number; media_count?: number; username?: string }>(
        `${profile.id}?fields=followers_count,media_count,username`
      );
      const username = detail.username ?? profile.username;

      await pool.query(
        `INSERT INTO ${SCHEMA}.instagram_profiles (ig_user_id, username, last_synced_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (ig_user_id) DO UPDATE SET username = EXCLUDED.username, last_synced_at = NOW()`,
        [profile.id, username]
      );

      await pool.query(
        `INSERT INTO ${SCHEMA}.instagram_profile_snapshots (ig_user_id, date, followers_count, media_count, captured_at)
         VALUES ($1, (NOW() AT TIME ZONE '${TIME_ZONE}')::date, $2, $3, NOW())
         ON CONFLICT (ig_user_id, date) DO UPDATE SET
           followers_count = EXCLUDED.followers_count,
           media_count = EXCLUDED.media_count,
           captured_at = NOW()`,
        [profile.id, detail.followers_count ?? 0, detail.media_count ?? 0]
      );
      stored += 1;
    } catch (error) {
      // Um perfil sem permissão não pode derrubar o sync inteiro (nem os outros
      // perfis): registra e segue.
      console.warn(`[instagramProfiles] falha ao ler @${profile.username}:`, error);
    }
  }

  return { profiles: stored };
}

export interface InstagramProfileSeries {
  igUserId: string;
  username: string;
  /** Foto mais recente dentro do período (ou a última conhecida). */
  followersNow: number | null;
  mediaNow: number | null;
  /** Seguidores no primeiro dia com foto dentro do período. */
  followersStart: number | null;
  /** followersNow - followersStart; null quando ainda não há dois dias. */
  ganho: number | null;
  /** Uma entrada por dia com foto. */
  points: Array<{ date: string; followersCount: number; mediaCount: number }>;
  /** Dia da primeira foto já registrada, para a tela explicar desde quando há série. */
  primeiroRegistro: string | null;
}

export async function getInstagramProfileSeries(
  from: string,
  to: string
): Promise<InstagramProfileSeries[]> {
  await ensureInstagramSchema();
  const pool = getPool();

  const { rows } = await pool.query<{
    ig_user_id: string;
    username: string;
    date: string;
    followers_count: number;
    media_count: number;
    primeiro_registro: string | null;
  }>(
    `SELECT p.ig_user_id, p.username, s.date::text, s.followers_count, s.media_count,
            (SELECT MIN(s2.date)::text FROM ${SCHEMA}.instagram_profile_snapshots s2 WHERE s2.ig_user_id = p.ig_user_id) AS primeiro_registro
     FROM ${SCHEMA}.instagram_profiles p
     LEFT JOIN ${SCHEMA}.instagram_profile_snapshots s
       ON s.ig_user_id = p.ig_user_id AND s.date BETWEEN $1 AND $2
     ORDER BY p.username, s.date`,
    [from, to]
  );

  const byProfile = new Map<string, InstagramProfileSeries>();
  for (const row of rows) {
    let entry = byProfile.get(row.ig_user_id);
    if (!entry) {
      entry = {
        igUserId: row.ig_user_id,
        username: row.username,
        followersNow: null,
        mediaNow: null,
        followersStart: null,
        ganho: null,
        points: [],
        primeiroRegistro: row.primeiro_registro,
      };
      byProfile.set(row.ig_user_id, entry);
    }
    if (row.date) {
      entry.points.push({
        date: row.date,
        followersCount: row.followers_count,
        mediaCount: row.media_count,
      });
    }
  }

  for (const entry of byProfile.values()) {
    const first = entry.points[0];
    const last = entry.points[entry.points.length - 1];
    entry.followersStart = first?.followersCount ?? null;
    entry.followersNow = last?.followersCount ?? null;
    entry.mediaNow = last?.mediaCount ?? null;
    entry.ganho =
      entry.points.length >= 2 && first && last ? last.followersCount - first.followersCount : null;
  }

  return Array.from(byProfile.values()).sort((a, b) => (b.followersNow ?? 0) - (a.followersNow ?? 0));
}
