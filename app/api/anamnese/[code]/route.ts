import { NextRequest, NextResponse } from "next/server";
import { getAnamneseByRecruiter } from "@/lib/anamnese";

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { code } = await params;
    
    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "Código do recrutador é obrigatório" }, { status: 400 });
    }

    const anamneses = await getAnamneseByRecruiter(code);

    return NextResponse.json({ anamneses });
  } catch (error) {
    console.error("Failed to get anamneses:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
