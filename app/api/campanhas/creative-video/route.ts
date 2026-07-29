import { NextResponse, type NextRequest } from "next/server";
import { requireCampaignsAccess } from "../utils";
import { getCreativeVideoSource } from "@/lib/metaAds";

export const dynamic = "force-dynamic";

/**
 * Resolve, sob demanda, a URL tocável do vídeo de um criativo. O `source` da
 * Graph API é temporário (expira em poucas horas), por isso é buscado na hora
 * em que o gestor abre o criativo em tela cheia — nunca guardado no banco.
 */
export async function GET(request: NextRequest) {
  const denied = requireCampaignsAccess(request);
  if (denied) return denied;

  const videoId = new URL(request.url).searchParams.get("videoId")?.trim();
  if (!videoId || !/^\d+$/.test(videoId)) {
    return NextResponse.json({ error: "videoId invalido." }, { status: 400 });
  }

  try {
    const video = await getCreativeVideoSource(videoId);
    return NextResponse.json(video);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao resolver o video." },
      { status: 500 }
    );
  }
}
