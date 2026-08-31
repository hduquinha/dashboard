import { NextResponse, type NextRequest } from "next/server";
import { getSellerMovementReport, getTeamMovementReport } from "@/lib/leadMovementLog";
import {
  sellerMovementPdf,
  teamMovementPdf,
  type InstagramTeamRow,
} from "@/lib/leadMovementPdf";
import { getInstagramOutreach, listTeamInstagramOutreach } from "@/lib/instagramOutreach";
import { listInstagramPanelMemberIds } from "@/lib/tasks";
import { listTeamMembers } from "@/lib/teamAuth";
import { DATE_PATTERN, canSeeEveryone, requirePanelTask, requireSession } from "../access";

export const dynamic = "force-dynamic";

/**
 * Exportação em PDF do painel de movimentação — de um vendedor ou de todos.
 *
 * O período vem da tela: exportar tem que devolver exatamente o que a pessoa
 * está vendo, senão o arquivo vira outra verdade (a mesma regra que a
 * exportação do relatório de produção já segue).
 */

function pdfResponse(buffer: Buffer, nome: string): NextResponse {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nome}.pdf"`,
    },
  });
}

/** Nome de arquivo sem acento nem espaço — alguns clientes engasgam. */
function slug(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "vendedor"
  );
}

export async function GET(request: NextRequest) {
  const auth = await requireSession();
  if ("error" in auth) return auth.error;

  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") || from;
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) {
    return NextResponse.json({ error: "Data invalida." }, { status: 400 });
  }
  if (to < from) {
    return NextResponse.json({ error: "A data final e anterior a inicial." }, { status: 400 });
  }

  const taskId = Number(params.get("taskId"));
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return NextResponse.json({ error: "Card invalido." }, { status: 400 });
  }
  // O card continua sendo a porta mesmo na visão geral: quem não alcança o
  // quadro não exporta nada por ele.
  const access = await requirePanelTask(auth.user, taskId);
  if ("error" in access) return access.error;

  const periodo = from === to ? from : `${from}_${to}`;

  if (params.get("todos") === "1") {
    if (!canSeeEveryone(auth.user)) {
      return NextResponse.json(
        { error: "Apenas gestores podem exportar a visao geral." },
        { status: 403 }
      );
    }
    const [team, outreachRows, membros, comInstagram] = await Promise.all([
      getTeamMovementReport({ from, to }),
      listTeamInstagramOutreach({ from, to }),
      listTeamMembers(),
      listInstagramPanelMemberIds(),
    ]);

    // O Instagram é chaveado por id do usuário e o comercial por e-mail; este
    // mapa é a ponte entre os dois.
    const idPorEmail = new Map(membros.map((m) => [m.email.trim().toLowerCase(), m.id]));
    const nomePorId = new Map(membros.map((m) => [m.id, m.name]));
    const outreachPorId = new Map(outreachRows.map((row) => [row.memberId, row]));

    // Vendedor que teve a opção desligada some da seção, mas o lançamento dele
    // continua no banco — religar o card traz tudo de volta.
    const instagram: InstagramTeamRow[] = outreachRows
      .filter((row) => comInstagram.has(row.memberId))
      .map((row) => ({
        sellerName: nomePorId.get(row.memberId) ?? `Usuário #${row.memberId}`,
        reached: row.reached,
        replied: row.replied,
        confirmed: row.confirmed,
      }))
      .sort((a, b) => b.reached - a.reached);

    // Quem não teve nada no período não ganha página: seriam páginas inteiras
    // de tabela vazia, e o número dele já está nos comparativos. Lançamento de
    // Instagram conta como atividade — quem só prospectou também tem o que
    // mostrar.
    const comAtividade = team.sellers.filter((seller) => {
      const memberId = idPorEmail.get(seller.sellerEmail);
      const temInstagram = memberId
        ? outreachPorId.has(memberId) && comInstagram.has(memberId)
        : false;
      return seller.movements > 0 || seller.received > 0 || temInstagram;
    });

    // `team.sellers` sai do histórico COMERCIAL. Quem passou o período só no
    // direct não aparece lá e ficaria sem página, mesmo tendo trabalhado — os
    // números dele sairiam só na tabela da equipe. Entra aqui, zerado no CRM e
    // com o Instagram preenchido.
    const jaListados = new Set(comAtividade.map((seller) => seller.sellerEmail));
    for (const membro of membros) {
      const email = membro.email.trim().toLowerCase();
      if (jaListados.has(email)) continue;
      if (!comInstagram.has(membro.id) || !outreachPorId.has(membro.id)) continue;
      comAtividade.push({
        sellerEmail: email,
        sellerName: membro.name,
        received: 0,
        moved: 0,
        movements: 0,
        stalled: 0,
      });
    }

    // Em sequência de propósito: são poucas pessoas, e disparar tudo em
    // paralelo só encheria o pool de conexões para montar um PDF que ninguém
    // está esperando em tempo real.
    const detalhes = [];
    for (const seller of comAtividade) {
      const memberId = idPorEmail.get(seller.sellerEmail) ?? null;
      detalhes.push({
        report: await getSellerMovementReport({
          sellerEmail: seller.sellerEmail,
          sellerName: seller.sellerName,
          from,
          to,
        }),
        outreach:
          memberId && comInstagram.has(memberId)
            ? await getInstagramOutreach({ memberId, from, to })
            : null,
      });
    }

    return pdfResponse(
      await teamMovementPdf(team, detalhes, instagram),
      `movimentacao-equipe-${periodo}`
    );
  }

  const [report, outreach] = await Promise.all([
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
  return pdfResponse(
    await sellerMovementPdf(report, outreach),
    `movimentacao-${slug(access.sellerName)}-${periodo}`
  );
}
