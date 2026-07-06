import { NextResponse, type NextRequest } from "next/server";
import { createCatalogEntity, getFinanceCatalog } from "@/lib/finance";
import { financeError, readJsonBody, requireFinanceAccess } from "../../utils";

interface RouteContext {
  params: Promise<{ entity: string }>;
}

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  const catalog = await getFinanceCatalog();
  return NextResponse.json({ catalog });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const [{ entity }, body] = await Promise.all([context.params, readJsonBody(request)]);
    const id = await createCatalogEntity(entity, body);
    return NextResponse.json({ id });
  } catch (error) {
    return financeError(error, "Falha ao criar configuracao.");
  }
}
