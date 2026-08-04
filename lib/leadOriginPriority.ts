/**
 * Qual origem manda quando a MESMA pessoa entrou por mais de um formulário.
 *
 * Uma pessoa pode ter vários vínculos (o cadastro dela mais os satélites
 * mesclados por telefone — ver `dashboard_origens_adicionais`). Até 04/08/2026
 * quem mandava era a ordem do relógio: valia o formulário preenchido primeiro.
 * O efeito prático era o canal de captação perder o lead para um formulário de
 * produto preenchido minutos antes, e a mídia ficar sem crédito por alguém que
 * ela trouxe.
 *
 * A regra agora é de prioridade, decidida pela operação: **canal de anúncio
 * vem antes do formulário de produto**, na ordem Meta → Google Ads → Landing
 * Page VozUP → o que a pessoa preencheu.
 *
 * Duas coisas que esta regra NÃO faz, de propósito:
 *
 * 1. **Não mexe na linha do banco.** O cadastro primário continua sendo o
 *    mesmo (o card do CRM, o histórico e os eventos estão amarrados no id
 *    dele); o que muda é a origem efetiva calculada em cima dos vínculos.
 * 2. **Não tira ninguém da turma.** As pastas e os blocos de aula da VozUP são
 *    montados por EVENTO (a pessoa aparece em toda pasta em que qualquer
 *    vínculo dela se encaixa), então quem se inscreveu numa aula continua na
 *    lista daquela aula mesmo com a origem efetiva apontando para a landing
 *    page. Ver docs/cartilha-formularios-produtos.md §10.
 *
 * Atenção a um efeito real: "Landing Page VozUP" hoje é majoritariamente
 * tráfego ORGÂNICO (o pago que cai em landing page é carimbado como
 * "Meta Ads VozUP - <tema>" no ingest). Priorizar landing page, portanto, não
 * é o mesmo que priorizar mídia paga — foi uma decisão consciente da operação
 * em 04/08/2026.
 */

/** Chave do nível de prioridade; menor número ganha. */
export type OriginTier = 1 | 2 | 3 | 4;

const norm = (value: string): string => value.trim().toLowerCase();

/** Meta: formulário nativo (Lead Ads) e landing pages carimbadas como Meta. */
export function isMetaOrigin(origem: string): boolean {
  const o = norm(origem);
  return o === "facebook lead ads" || o.startsWith("meta");
}

export function isGoogleAdsOrigin(origem: string): boolean {
  return norm(origem).includes("google ads");
}

export function isLandingPageOrigin(origem: string): boolean {
  return norm(origem).includes("landing");
}

/** Em que nível de prioridade esta origem cai. 4 = formulário de produto. */
export function originTier(origem: string | null | undefined): OriginTier {
  if (!origem) return 4;
  if (isMetaOrigin(origem)) return 1;
  if (isGoogleAdsOrigin(origem)) return 2;
  if (isLandingPageOrigin(origem)) return 3;
  return 4;
}

/** Toda origem conhecida da pessoa: a do próprio cadastro e as herdadas dos
 * vínculos mesclados. Preserva a ordem (própria primeiro) para servir de
 * critério de desempate dentro do mesmo nível. */
export function collectLeadOrigins(payload: Record<string, unknown> | null | undefined): string[] {
  const own = typeof payload?.origem === "string" ? payload.origem.trim() : "";
  const extrasRaw = payload?.dashboard_origens_adicionais;
  const extras = Array.isArray(extrasRaw)
    ? extrasRaw.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  return [own, ...extras.map((value) => value.trim())].filter((value) => value.length > 0);
}

export interface EffectiveLeadOrigin {
  /** Origem que vale para a tela: a de maior prioridade entre os vínculos. */
  origem: string | null;
  /** Origem do formulário que a pessoa preencheu neste cadastro. */
  formOrigem: string | null;
  /** A prioridade trocou a origem — a tela mostra as duas quando isto é true. */
  overridden: boolean;
}

export function effectiveLeadOrigin(
  payload: Record<string, unknown> | null | undefined
): EffectiveLeadOrigin {
  const own = typeof payload?.origem === "string" && payload.origem.trim() ? payload.origem.trim() : null;
  const inherited = collectLeadOrigins(payload).filter((origem) => origem !== own);

  // Só troca por nível ESTRITAMENTE melhor. Empate fica com o formulário que a
  // pessoa preencheu — inclusive quando ele não tem origem gravada (o caso do
  // Encontro Online, que é justamente o "sem origem"): herdar a origem de um
  // vínculo de mesmo nível trocaria o produto do lead sem nenhum ganho.
  let best = own;
  let bestTier = originTier(own);
  for (const candidate of inherited) {
    const tier = originTier(candidate);
    if (tier < bestTier) {
      best = candidate;
      bestTier = tier;
    }
  }

  return { origem: best, formOrigem: own, overridden: best !== own };
}

/**
 * A mesma regra em SQL, para as consultas que agrupam por origem. Recebe o
 * alias da tabela `inscricoes.inscricoes` e devolve uma expressão escalar.
 *
 * Precisa existir em duas linguagens porque a classificação roda dos dois
 * lados (contagem no Postgres, ficha e kanban no navegador); as duas devem
 * mudar juntas, ou duas telas passam a discordar sobre a origem do lead.
 */
export function effectiveOriginSql(alias = "i"): string {
  // A origem própria entra na disputa mesmo vazia (nível 4, desempate 0): sem
  // isso, um lead sem origem — o Encontro Online é exatamente esse caso —
  // herdaria a origem de um vínculo de mesmo nível e trocaria de produto.
  return `NULLIF((
    SELECT candidato.origem
    FROM (
      SELECT COALESCE(NULLIF(TRIM(${alias}.payload->>'origem'), ''), '') AS origem, 0 AS propria
      UNION ALL
      SELECT TRIM(extra.valor) AS origem, 1 AS propria
      FROM jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(${alias}.payload->'dashboard_origens_adicionais') = 'array'
            THEN ${alias}.payload->'dashboard_origens_adicionais'
          ELSE '[]'::jsonb
        END
      ) AS extra(valor)
      WHERE NULLIF(TRIM(extra.valor), '') IS NOT NULL
    ) AS candidato
    ORDER BY
      CASE
        WHEN LOWER(candidato.origem) = 'facebook lead ads'
          OR LOWER(candidato.origem) LIKE 'meta%' THEN 1
        WHEN LOWER(candidato.origem) LIKE '%google ads%' THEN 2
        WHEN LOWER(candidato.origem) LIKE '%landing%' THEN 3
        ELSE 4
      END,
      candidato.propria
    LIMIT 1
  ), '')`;
}
