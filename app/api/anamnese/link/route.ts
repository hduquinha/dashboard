import { NextRequest, NextResponse } from "next/server";
import { linkAnamneseToRecruiter } from "@/lib/anamnese";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { anamneseId, recruiterCode } = body;

    if (!anamneseId || !recruiterCode) {
      return NextResponse.json({ error: "Missing anamneseId or recruiterCode" }, { status: 400 });
    }

    await linkAnamneseToRecruiter(anamneseId, recruiterCode);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to link anamnese", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
