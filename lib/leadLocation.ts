/**
 * Localização do lead nas Métricas de Campanha.
 *
 * São duas fontes, nesta ordem de confiança:
 *
 * 1. **Cidade** — informada no formulário ou estimada pelo IP de quem enviou
 *    (ver lib/leadGeo). Só existe para quem chegou depois que a estimativa por
 *    IP entrou no ar; o histórico não tem.
 * 2. **DDD do telefone** — sempre existe (o WhatsApp é obrigatório em todo
 *    formulário) e vale para o histórico inteiro. Em compensação diz a região
 *    da linha, não onde a pessoa mora: 90% dos leads de anúncio são DDD 11.
 *
 * Cada lead entra em UMA localização: a cidade quando ela existe, senão o DDD.
 * As duas convivem na mesma lista de opções em vez de uma "corrigir" a outra —
 * misturar cidade estimada com região de linha telefônica no mesmo balde
 * produziria um número que não é nem uma coisa nem outra.
 *
 * Nada disso corta gasto ou alcance: a Meta não publica entrega por cidade
 * (o breakdown `city` não existe na Marketing API), então o recorte vale só
 * para as abas em que cada linha é uma pessoa.
 */

/** DDD → UF (plano de numeração da Anatel). */
const DDD_UF: Record<string, string> = {
  "11": "SP", "12": "SP", "13": "SP", "14": "SP", "15": "SP", "16": "SP", "17": "SP", "18": "SP", "19": "SP",
  "21": "RJ", "22": "RJ", "24": "RJ",
  "27": "ES", "28": "ES",
  "31": "MG", "32": "MG", "33": "MG", "34": "MG", "35": "MG", "37": "MG", "38": "MG",
  "41": "PR", "42": "PR", "43": "PR", "44": "PR", "45": "PR", "46": "PR",
  "47": "SC", "48": "SC", "49": "SC",
  "51": "RS", "53": "RS", "54": "RS", "55": "RS",
  "61": "DF", "62": "GO", "63": "TO", "64": "GO", "65": "MT", "66": "MT", "67": "MS",
  "68": "AC", "69": "RO",
  "71": "BA", "73": "BA", "74": "BA", "75": "BA", "77": "BA", "79": "SE",
  "81": "PE", "82": "AL", "83": "PB", "84": "RN", "85": "CE", "86": "PI",
  "87": "PE", "88": "CE", "89": "PI",
  "91": "PA", "92": "AM", "93": "PA", "94": "PA", "95": "RR", "96": "AP",
  "97": "AM", "98": "MA", "99": "MA",
};

export const NO_LOCATION_KEY = "sem-local";

/** Uma localização com quantos leads do período caíram nela — alimenta o
 * seletor da tela e já responde "quanto está chegando de fora daqui". */
export interface LeadLocationOption {
  key: string;
  label: string;
  leads: number;
}

// ─── Fragmentos SQL ──────────────────────────────────────────────────────────
// Escritos uma vez aqui para a lista de opções e o filtro nunca divergirem:
// se a chave for calculada de um jeito no agrupamento e de outro no WHERE, a
// opção escolhida devolve zero lead sem nenhum erro aparente.

/** Telefone do payload só com dígitos. Espera o alias `i` de inscricoes. */
const PHONE_DIGITS = `regexp_replace(COALESCE(i.payload->>'telefone', ''), '\\D', '', 'g')`;

/**
 * Cidade sem acento e em minúsculas, para "São Paulo" e "Sao Paulo" contarem
 * como a mesma cidade. `translate` evita depender da extensão `unaccent`, que
 * não está instalada neste banco.
 */
const CITY_KEY = `NULLIF(translate(lower(trim(COALESCE(i.payload->>'cidade', ''))), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'), '')`;

/**
 * DDD de dois dígitos. O 55 só é tratado como código do país quando o tamanho
 * já inclui os dois dígitos a mais — senão o DDD 55 (Santa Maria/RS) viraria
 * código de país (mesma regra de app/api/vozup/lead/route.ts).
 */
const DDD = `CASE
      WHEN length(${PHONE_DIGITS}) IN (12, 13) AND left(${PHONE_DIGITS}, 2) = '55' THEN substr(${PHONE_DIGITS}, 3, 2)
      WHEN length(${PHONE_DIGITS}) IN (10, 11) THEN left(${PHONE_DIGITS}, 2)
      ELSE NULL
    END`;

/** Colunas de localização para qualquer SELECT sobre inscricoes com alias `i`. */
export const LEAD_LOCATION_COLUMNS = `NULLIF(trim(i.payload->>'cidade'), '') AS cidade,
              ${CITY_KEY} AS cidade_key,
              ${DDD} AS ddd`;

/** Chave da localização a partir das colunas acima, já no alias do CTE. */
export const LEAD_LOCATION_KEY = `COALESCE('cidade:' || la.cidade_key, 'ddd:' || la.ddd, '${NO_LOCATION_KEY}')`;

// ─── Rótulos ─────────────────────────────────────────────────────────────────

/** "DDD 11 · SP" — a UF deixa o número reconhecível para quem não decora DDD. */
function dddLabel(ddd: string): string {
  const uf = DDD_UF[ddd];
  return uf ? `DDD ${ddd} · ${uf}` : `DDD ${ddd}`;
}

/**
 * Localização de UM lead, para mostrar na linha dele. A cidade vem primeiro
 * porque é a informação mais específica que existe sobre aquela pessoa.
 */
export function formatLeadLocation(lead: { cidade: string | null; ddd: string | null }): string | null {
  if (lead.cidade) return lead.cidade;
  if (lead.ddd) return dddLabel(lead.ddd);
  return null;
}

/** Rótulo de uma opção do seletor, a partir da linha agregada do banco. */
export function leadLocationLabel(row: { key: string; cidade: string | null; ddd: string | null }): string {
  if (row.key === NO_LOCATION_KEY) return "Sem localização";
  if (row.key.startsWith("cidade:")) return row.cidade ?? row.key.slice(7);
  return dddLabel(row.ddd ?? row.key.slice(4));
}
