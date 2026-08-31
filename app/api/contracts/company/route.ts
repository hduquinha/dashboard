import { NextRequest, NextResponse } from "next/server";
import { getContractCompany, saveContractCompany } from "@/lib/contracts";
import { requireContractAccess } from "../route";

export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await requireContractAccess(false);
  if (error) return error;
  return NextResponse.json({ company: await getContractCompany() });
}

/** Razão social, CNPJ e endereço da CONTRATADA — sem isso o contrato sai com lacunas. */
export async function PUT(request: NextRequest) {
  const { error, session } = await requireContractAccess(true);
  if (error) return error;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const text = (key: string): string => (typeof body[key] === "string" ? (body[key] as string) : "");

  // Todos os campos, sem exceção: `saveContractCompany` grava o objeto inteiro,
  // então campo omitido aqui não fica como estava — é APAGADO. Foi o que
  // acontecia com razão social, bairro, site e Instagram: salvar os dados da
  // escola limpava o bairro do endereço e o rodapé do contrato.
  const company = await saveContractCompany(session.user, {
    name: text("name"),
    legalName: text("legalName"),
    cnpj: text("cnpj"),
    address: text("address"),
    neighborhood: text("neighborhood"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    forum: text("forum"),
    email: text("email"),
    phone: text("phone"),
    website: text("website"),
    instagram: text("instagram"),
    representativeName: text("representativeName"),
    representativeRole: text("representativeRole"),
    signatureImage: text("signatureImage"),
  });

  return NextResponse.json({ company });
}
