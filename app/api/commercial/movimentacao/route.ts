import { NextResponse, type NextRequest } from "next/server";
import {
  getSellerMovementReport,
  listLeadPanelSellers,
  listSellerDaysWithActivity,
} from "@/lib/leadMovementLog";
import {
  deleteInstagramOutreach,
  getInstagramOutreach,
  saveInstagramOutreach,
} from "@/lib/instagramOutreach";
import { memberIdForEmail } from "@/lib/leadTasks";
import { setPanelInstagram } from "@/lib/tasks";
import { DATE_PATTERN, canSeeEveryone, requirePanelTask, requireSession } from "./access";

export const dynamic = "force-dynamic";

/**
 * Dados do painel de movimentação de um card. Leitura pura: nada aqui escreve
 * no CRM, e é por isso que abrir o card dez vezes devolve o mesmo número dez
 * vezes — o histórico não é materializado em lugar nenhum.
 *
 * `sellers` só sai para gestor: é a lista que o botão "Sincronizar vendedores"
 * usa para saber de quem falta card.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession();
  if ("error" in auth) return auth.error;

  const params = new URL(request.url).searchParams;

  // Lista de vendedores para a sincronização — não depende de card nenhum.
  if (params.get("sellers") === "1") {
    if (!canSeeEveryone(auth.user)) {
      return NextResponse.json({ error: "Apenas gestores podem sincronizar os cards." }, { status: 403 });
    }
    return NextResponse.json({ sellers: await listLeadPanelSellers() });
  }

  const taskId = Number(params.get("taskId"));
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return NextResponse.json({ error: "Card invalido." }, { status: 400 });
  }

  const access = await requirePanelTask(auth.user, taskId);
  if ("error" in access) return access.error;

  // Dias com movimentação no mês, para o seletor marcar onde há o que ver.
  const month = params.get("month");
  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: "Mes invalido." }, { status: 400 });
    }
    return NextResponse.json({ days: await listSellerDaysWithActivity(access.sellerEmail, month) });
  }

  const from = params.get("from") ?? "";
  // Sem `to` o painel pede um dia só — o caso normal do card.
  const to = params.get("to") || from;
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) {
    return NextResponse.json({ error: "Data invalida." }, { status: 400 });
  }
  if (to < from) {
    return NextResponse.json({ error: "A data final e anterior a inicial." }, { status: 400 });
  }

  // Os dois vêm juntos porque a tela mostra os dois lado a lado: separar em
  // duas chamadas faria os números do CRM e do Instagram piscarem em momentos
  // diferentes para o mesmo dia.
  const [report, instagram] = await Promise.all([
    getSellerMovementReport({
      sellerEmail: access.sellerEmail,
      sellerName: access.sellerName,
      from,
      to,
    }),
    access.instagramEnabled
      ? getInstagramOutreach({ memberId: access.sellerMemberId, from, to })
      : Promise.resolve(null),
  ]);

  return NextResponse.json({
    report,
    instagram,
    instagramEnabled: access.instagramEnabled,
    canManageInstagram: access.canManageInstagram,
    canExportAll: access.isManager,
  });
}

/**
 * Lançamento da prospecção no Instagram de um dia.
 *
 * O painel é só leitura para o CRM — este é o único ponto em que ele escreve, e
 * escreve num dado que não existe em lugar nenhum: não há como capturar DM frio
 * automaticamente (a API da Meta não deixa a empresa iniciar conversa).
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession();
  if ("error" in auth) return auth.error;

  const body = (await request.json().catch(() => ({}))) as {
    taskId?: unknown;
    date?: unknown;
    reached?: unknown;
    replied?: unknown;
    confirmed?: unknown;
    note?: unknown;
    remover?: unknown;
  };

  const taskId = Number(body.taskId);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return NextResponse.json({ error: "Card invalido." }, { status: 400 });
  }
  const date = typeof body.date === "string" ? body.date : "";
  if (!DATE_PATTERN.test(date)) {
    return NextResponse.json({ error: "Data invalida." }, { status: 400 });
  }

  // Mesmo gate da leitura: o dono do painel lança o dele, gestor lança de
  // qualquer um. O gate fica aqui no servidor, não só na UI.
  const access = await requirePanelTask(auth.user, taskId);
  if ("error" in access) return access.error;
  if (!access.instagramEnabled) {
    return NextResponse.json(
      { error: "Este card nao registra prospeccao no Instagram." },
      { status: 400 }
    );
  }

  if (body.remover === true) {
    await deleteInstagramOutreach(access.sellerMemberId, date);
    return NextResponse.json({ ok: true });
  }

  await saveInstagramOutreach({
    memberId: access.sellerMemberId,
    date,
    reached: body.reached,
    replied: body.replied,
    confirmed: body.confirmed,
    note: body.note,
    createdBy: await memberIdForEmail(auth.user.email),
  });

  return NextResponse.json({ ok: true });
}

/**
 * Liga ou desliga a opção "Leads Instagram" de um card — é assim que o master
 * define quem trabalha o direct.
 *
 * Desligar preserva os lançamentos: eles somem da tela e do PDF e voltam
 * inteiros se o card for religado. Apagar histórico de trabalho feito nunca é
 * efeito colateral de uma troca de configuração.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireSession();
  if ("error" in auth) return auth.error;

  const body = (await request.json().catch(() => ({}))) as {
    taskId?: unknown;
    instagram?: unknown;
  };
  const taskId = Number(body.taskId);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return NextResponse.json({ error: "Card invalido." }, { status: 400 });
  }
  if (typeof body.instagram !== "boolean") {
    return NextResponse.json({ error: "Informe se a opcao fica ligada ou desligada." }, { status: 400 });
  }

  const access = await requirePanelTask(auth.user, taskId);
  if ("error" in access) return access.error;
  if (!access.canManageInstagram) {
    return NextResponse.json(
      { error: "Apenas usuarios master gerenciam quem registra o Instagram." },
      { status: 403 }
    );
  }

  await setPanelInstagram(taskId, body.instagram);
  return NextResponse.json({ ok: true, instagramEnabled: body.instagram });
}
