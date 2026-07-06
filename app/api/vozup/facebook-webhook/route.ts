import { createHmac, timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import {
  alreadyIngestedFacebookLead,
  fetchFacebookLeadDetails,
  ingestFacebookLead,
} from "@/lib/facebookLeadAds";

export const dynamic = "force-dynamic";

function verifySignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * Handshake de verificação exigido pelo Facebook ao registrar o webhook
 * (Meta App > Webhooks > Page > campo "leadgen").
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const expectedToken = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && expectedToken && token === expectedToken) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  const signature = req.headers.get("x-hub-signature-256");

  if (appSecret && !verifySignature(rawBody, signature, appSecret)) {
    console.error("[facebook-webhook] Assinatura inválida.");
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let body: { entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: Record<string, unknown> }> }> };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (!process.env.FACEBOOK_PAGE_ACCESS_TOKEN?.trim()) {
    console.error("[facebook-webhook] FACEBOOK_PAGE_ACCESS_TOKEN não configurado — lead ignorado.");
    return NextResponse.json({ ok: true });
  }

  let received = 0;
  let imported = 0;
  let skipped = 0;
  const entries = body.entry ?? [];
  for (const entry of entries) {
    const changes = entry.changes ?? [];
    for (const change of changes) {
      if (change.field !== "leadgen") continue;
      const value = change.value ?? {};
      const leadgenId = String(value.leadgen_id ?? "").trim();
      if (!leadgenId) continue;
      received += 1;

      try {
        if (await alreadyIngestedFacebookLead(leadgenId)) {
          skipped += 1;
          continue;
        }

        const lead = await fetchFacebookLeadDetails(leadgenId);
        const savedId = await ingestFacebookLead(lead, {
          formId: String(value.form_id ?? lead.form_id ?? ""),
          pageId: String(value.page_id ?? entry.id ?? ""),
        });
        if (savedId) imported += 1;
        else skipped += 1;
      } catch (err) {
        console.error("[facebook-webhook] Erro ao processar leadgen_id", leadgenId, err);
      }
    }
  }

  console.log("[facebook-webhook] processamento concluído", { received, imported, skipped });

  return NextResponse.json({ ok: true });
}
