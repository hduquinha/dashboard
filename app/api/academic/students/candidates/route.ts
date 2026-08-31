import { NextRequest, NextResponse } from "next/server";
import { listStudentCandidates } from "@/lib/academicStudents";
import { requireStudentAccess } from "@/app/api/academic/students/route";

export const dynamic = "force-dynamic";

/**
 * Leads que já fecharam negócio e ainda não viraram aluno.
 *
 * É a fila de trabalho da secretaria depois da venda — e substitui a busca livre
 * por qualquer lead do CRM, que convidava a converter gente de topo de funil.
 */
export async function GET(request: NextRequest) {
  const auth = await requireStudentAccess(false);
  if (auth.error) return auth.error;

  const search = new URL(request.url).searchParams.get("search") ?? undefined;
  return NextResponse.json({ candidates: await listStudentCandidates(search) });
}
