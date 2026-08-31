import { NextResponse } from "next/server";
import { importHolidaysToCalendar, listCalendarDays } from "@/lib/academicClasses";
import { requireClassAccess } from "@/app/api/academic/classes/route";

export const dynamic = "force-dynamic";

/**
 * Traz os feriados de um ou mais anos para o calendário da escola.
 *
 * As datas são calculadas aqui dentro (`lib/holidays.ts`) — nenhum serviço
 * externo. Recesso e emenda já cadastrados não são tocados.
 */
export async function POST(request: Request) {
  const auth = await requireClassAccess(true);
  if (auth.error) return auth.error;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const atual = new Date().getFullYear();
    const anos = Array.isArray(body.years)
      ? body.years.map((year) => Number(year)).filter((year) => year >= 2020 && year <= 2100)
      : [atual, atual + 1];
    if (anos.length === 0) throw new Error("Informe o ano.");

    const imported = await importHolidaysToCalendar(anos);
    return NextResponse.json({ imported, years: anos, days: await listCalendarDays() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao importar feriados." },
      { status: 400 }
    );
  }
}
