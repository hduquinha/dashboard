/**
 * Conversions API do ChatGPT Ads (OpenAI).
 *
 * Por que existe, se o pixel do navegador já manda a mesma conversão:
 * bloqueador de anúncio e restrições de terceiros derrubam uma fatia do pixel.
 * O envio pelo servidor recupera essas conversões — e a duplicata é evitada
 * pelo `event_id`, que o navegador e o servidor compartilham (o mesmo id que o
 * LeadForm gera e envia no payload como `chat_ads_event_id`).
 *
 * Só dispara quando o lead tem `oppref`, o click id do ChatGPT Ads: sem ele a
 * OpenAI não tem como atribuir o evento a anúncio nenhum, e mandar seria só
 * ruído.
 *
 * Falha aqui NUNCA pode derrubar o cadastro: quem chama usa fire-and-forget e
 * o erro só vira log.
 */

const ENDPOINT = "https://bzr.openai.com/v1/events";
const TIMEOUT_MS = 5000;

function text(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
}

export function chatAdsConfig(): { apiKey: string; pixelId: string } | null {
  const apiKey = process.env.OPENAI_ADS_API_KEY?.trim();
  const pixelId = process.env.OPENAI_ADS_PIXEL_ID?.trim();
  if (!apiKey || !pixelId) return null;
  return { apiKey, pixelId };
}

export async function sendChatAdsRegistration(
  payload: Record<string, unknown>,
  leadId: number
): Promise<void> {
  const config = chatAdsConfig();
  if (!config) return;

  const oppref = text(payload, "oppref");
  if (!oppref) return;

  // O mesmo id usado pelo pixel no navegador. Sem ele o servidor criaria um
  // evento novo e a mesma conversão apareceria duas vezes no painel.
  const eventId = text(payload, "chat_ads_event_id") || `lead-${leadId}`;
  const sourceUrl = text(payload, "landing_page_url") || "https://www.escolavozup.com/";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${ENDPOINT}?pid=${encodeURIComponent(config.pixelId)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        validate_only: false,
        events: [
          {
            id: eventId,
            type: "registration_completed",
            timestamp_ms: Date.now(),
            source_url: sourceUrl,
            action_source: "web",
            data: { type: "customer_action" },
          },
        ],
      }),
    });

    if (!response.ok) {
      const detalhe = await response.text().catch(() => "");
      console.error(
        `[chatAdsEvents] lead ${leadId}: HTTP ${response.status} — ${detalhe.slice(0, 300)}`
      );
    }
  } catch (err) {
    console.error(`[chatAdsEvents] lead ${leadId}: falha ao enviar conversão:`, err);
  } finally {
    clearTimeout(timer);
  }
}
