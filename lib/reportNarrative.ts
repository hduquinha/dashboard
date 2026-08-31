import Anthropic from "@anthropic-ai/sdk";

/**
 * Narrativa do relatório de campanha escrita pela Claude API.
 *
 * **A IA não calcula nada.** Ela recebe os números já apurados em SQL
 * (lib/reportSegments.ts, lib/monthlyReportData.ts) e escreve só a leitura:
 * o que o número quer dizer, o que fazer a respeito. Modelo de linguagem erra
 * conta, e um relatório para sócios com número errado é pior que relatório
 * nenhum — por isso o schema de saída não tem um único campo numérico.
 *
 * **Degrada sem chave.** Sem `ANTHROPIC_API_KEY` devolve `null` e o relatório
 * sai com os textos determinísticos de sempre. Ligar a IA nunca é requisito
 * para o relatório existir.
 */

const MODEL = "claude-opus-5";

/**
 * Arredonda todo número antes de mandar para o modelo. Sem isto, uma taxa
 * calculada em ponto flutuante chega como 33.33333333333333 e é assim que ela
 * volta escrita no relatório.
 */
function arredondar(value: unknown): unknown {
  if (typeof value === "number") return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
  if (Array.isArray(value)) return value.map(arredondar);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, arredondar(v)]));
  }
  return value;
}

export interface NarrativeSection {
  /** Rótulo curto em caixa alta, no estilo "O NÚMERO QUE DÓI". */
  eyebrow: string;
  title: string;
  /** 2 a 4 frases. Markdown simples (negrito) permitido. */
  body: string;
}

export interface NarrativeAction {
  title: string;
  /** Por que essa ação, ancorada num número do período. */
  rationale: string;
  urgency: "agora" | "esta-semana" | "testar" | "habilitar";
}

export interface ReportNarrative {
  /** Manchete curta do documento (uma linha, sem ponto final). Existe como
   * campo próprio porque derivar o título cortando a lede na primeira frase
   * quebrava em qualquer valor com separador de milhar: "R$ 2.451,38" virava
   * o título "R$ 2.". */
  titulo: string;
  /** Uma frase que resume o período inteiro. */
  lede: string;
  sections: NarrativeSection[];
  actions: NarrativeAction[];
  /** Perguntas que os dados do período não conseguem responder. */
  blindSpots: string[];
  generatedAt: string;
  model: string;
}

export function hasNarrativeConfig(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["titulo", "lede", "sections", "actions", "blindSpots"],
  properties: {
    titulo: { type: "string" },
    lede: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["eyebrow", "title", "body"],
        properties: {
          eyebrow: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
        },
      },
    },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "rationale", "urgency"],
        properties: {
          title: { type: "string" },
          rationale: { type: "string" },
          urgency: { type: "string", enum: ["agora", "esta-semana", "testar", "habilitar"] },
        },
      },
    },
    blindSpots: { type: "array", items: { type: "string" } },
  },
} as const;

const SYSTEM = `Você escreve a análise de um relatório de mídia paga da VozUP, uma escola de oratória, para os sócios lerem. O relatório é um documento de 8 a 10 páginas, não um resumo executivo.

REGRA ABSOLUTA — números:
- Todos os números já vêm calculados no JSON. Use SOMENTE eles.
- Nunca calcule, estime ou infira um número que não esteja no JSON. Se faltar, escreva a frase sem ele.
- Reproduza o número exatamente como veio, com no máximo duas casas decimais.

O QUE A ANÁLISE PRECISA COBRIR (uma seção para cada, quando o JSON tiver o dado):
1. MÍDIA — quanto foi investido, onde parou cada real, CPM, CTR, CPC, custo por lead, custo por agendamento. Compare Meta e Google Ads quando os dois existirem.
2. DESTINO / TEMA — qual página ou tema rende e qual queima dinheiro. Cite os nomes.
3. PÚBLICO — qual conjunto entrega mais barato. Cite os nomes.
4. CRIATIVO — quais peças se pagaram e quais não. Cite os identificadores (VOZUP_ADxx) e diga o que as vencedoras têm em comum.
5. FUNIL COMERCIAL — do cadastro ao fechamento, por origem. Use a taxa sobre ATENDIDOS para comparar canais, nunca a taxa sobre cadastro.
6. OPERAÇÃO — horário de chegada do lead, velocidade de resposta, desempenho por vendedor, quando o JSON trouxer.

ESTILO DAS SEÇÕES:
- Cada seção é um achado específico com número, não um panorama. O título afirma alguma coisa ("Falar em Público paga o dobro do que Vendas paga"), nunca descreve um tema ("Análise de temas").
- Prefira o achado desconfortável. Se a semana foi ruim, diga.
- Procure a contradição: o que tem melhor CTR e pior resultado, o que recebe mais verba e rende menos.

COMO ESCREVER:
- Português do Brasil, direto, sem jargão de agência.
- Proibido "não é X, é Y" e "mais que X, é Y".
- Nada de emoji, exclamação, "incrível/poderoso/robusto".
- Amostra pequena (menos de ~10 casos numa taxa): diga que serve como direção e não como prova. Obrigatório.
- Não invente causa. Se o dado não separa duas explicações, apresente as duas.

TÍTULO: uma manchete curta (no máximo 10 palavras), afirmando o achado central do período. Sem ponto final. Ex.: "32 dias de anúncio, do primeiro real ao agendamento".

AÇÕES: cada uma ancorada num número do período, dizendo o que muda na prática e, quando o JSON permitir, o impacto estimado com os custos medidos. Sem conselho genérico de marketing.`;

/** Timeout próprio: o relatório não pode ficar pendurado se a API demorar. */
const TIMEOUT_MS = 240_000;

export async function generateReportNarrative(
  data: unknown,
  options: { periodLabel: string }
): Promise<ReportNarrative | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      thinking: { type: "adaptive" },
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: `Período: ${options.periodLabel}

Escreva a análise deste período. De 6 a 9 seções cobrindo os territórios listados, e de 6 a 12 ações.

Dados apurados (fonte única da verdade para qualquer número):

${JSON.stringify(arredondar(data), null, 2)}`,
        },
      ],
    });

    // `refusal` chega como HTTP 200 com content vazio — ler content[0] direto
    // quebraria. Sem narrativa o relatório segue com o texto determinístico.
    if (response.stop_reason === "refusal") {
      console.warn("[report-narrative] a API recusou a geração", response.stop_details);
      return null;
    }

    const text = response.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") return null;

    const parsed = JSON.parse(text.text) as Omit<ReportNarrative, "generatedAt" | "model">;
    return {
      ...parsed,
      generatedAt: new Date().toISOString(),
      model: response.model,
    };
  } catch (error) {
    // Narrativa é enfeite: qualquer falha (rede, cota, JSON torto) devolve null
    // e o relatório sai igual ao de antes, em vez de a tela quebrar.
    console.error("[report-narrative] falhou:", error instanceof Error ? error.message : error);
    return null;
  }
}
