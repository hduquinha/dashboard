import { NextResponse, type NextRequest } from "next/server";
import { requireCampaignsAccess } from "../utils";
import { runGoogleAdsSync } from "@/lib/googleAds";
import { runMetaAdsSync } from "@/lib/metaAds";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const denied = requireCampaignsAccess(request);
  if (denied) return denied;

  try {
    // Ação manual também atualiza os criativos, incluindo URL do formulário.
    // O job automático continua respeitando o TTL para poupar a Graph API.
    const [meta, google] = await Promise.allSettled([
      runMetaAdsSync({ forceStructure: true }),
      runGoogleAdsSync({ forceStructure: true }),
    ]);

    const metaError = meta.status === "rejected" ? meta.reason : null;
    const googleError = google.status === "rejected" ? google.reason : null;
    if (metaError || googleError) {
      return NextResponse.json(
        {
          meta: meta.status === "fulfilled" ? meta.value : { error: metaError instanceof Error ? metaError.message : String(metaError) },
          google: google.status === "fulfilled" ? google.value : { error: googleError instanceof Error ? googleError.message : String(googleError) },
        },
        { status: metaError ? 500 : 207 }
      );
    }

    if (meta.status === "fulfilled" && google.status === "fulfilled") {
      return NextResponse.json({ meta: meta.value, google: google.value });
    }

    return NextResponse.json({ error: "Falha inesperada ao sincronizar campanhas." }, { status: 500 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao sincronizar campanhas." },
      { status: 500 }
    );
  }
}
