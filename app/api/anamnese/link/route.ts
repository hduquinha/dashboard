import { NextRequest, NextResponse } from "next/server";
import { assertAuthenticatedRequest } from "@/lib/auth";
import { linkAnamneseToRecruiter } from "@/lib/anamnese";

export async function POST(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request);
  } catch {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { anamneseId, recruiterCode } = body;

    if (!anamneseId || !recruiterCode) {
      return NextResponse.json(
        { error: "Missing anamneseId or recruiterCode" },
        { status: 400 }
      );
    }

    await linkAnamneseToRecruiter(anamneseId, recruiterCode);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to link anamnese", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
