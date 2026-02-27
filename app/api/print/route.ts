import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { assertToken, UnauthorizedError } from "@/lib/auth";
import { listInscricoes, listRecruitersWithDbNames } from "@/lib/db";
import { humanizeName } from "@/lib/utils";
import type { InscricaoItem, OrderableField, OrderDirection } from "@/types/inscricao";

const EXPORT_PAGE_SIZE = 500;

interface ExportFilters {
  nome: string;
  telefone: string;
  indicacao: string;
  treinamento: string;
  presenca?: "aprovada" | "reprovada" | "validada" | "nao-validada";
}

function sanitizeParam(value: string | null): string {
  return value?.trim() ?? "";
}

function parseOrderField(value: string | null): OrderableField {
  const allowed: OrderableField[] = [
    "id",
    "nome",
    "telefone",
    "cidade",
    "profissao",
    "treinamento",
    "recrutador",
    "criado_em",
  ];
  if (value && allowed.includes(value as OrderableField)) {
    return value as OrderableField;
  }
  return "criado_em";
}

function parseDirection(value: string | null): OrderDirection {
  return value === "asc" ? "asc" : "desc";
}

function parsePresenca(value: string | null): ExportFilters["presenca"] | undefined {
  const allowed = ["aprovada", "reprovada", "validada", "nao-validada"];
  if (value && allowed.includes(value)) {
    return value as ExportFilters["presenca"];
  }
  return undefined;
}

async function fetchAllInscricoes(options: {
  orderBy: OrderableField;
  orderDirection: OrderDirection;
  filters: ExportFilters;
}): Promise<InscricaoItem[]> {
  const aggregated: InscricaoItem[] = [];
  let currentPage = 1;

  while (true) {
    const result = await listInscricoes({
      page: currentPage,
      pageSize: EXPORT_PAGE_SIZE,
      orderBy: options.orderBy,
      orderDirection: options.orderDirection,
      filters: options.filters,
    });

    aggregated.push(...result.data);

    if (aggregated.length >= result.total || result.data.length === 0) {
      break;
    }

    currentPage += 1;
  }

  return aggregated;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("pt-BR");
}

function getPresencaLabel(inscricao: InscricaoItem): string {
  if (inscricao.presencaAprovada === true) return "✅";
  if (inscricao.presencaAprovada === false) return "❌";
  if (inscricao.presencaValidada) return "📋";
  return "—";
}

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("dashboardToken")?.value;
    assertToken(token);

    const url = new URL(request.url);
    const searchParams = url.searchParams;

    const filters: ExportFilters = {
      nome: sanitizeParam(searchParams.get("nome")),
      telefone: sanitizeParam(searchParams.get("telefone")),
      indicacao: sanitizeParam(searchParams.get("indicacao")),
      treinamento: sanitizeParam(searchParams.get("treinamento")),
      presenca: parsePresenca(searchParams.get("presenca")),
    };

    const orderBy = parseOrderField(searchParams.get("orderBy"));
    const orderDirection = parseDirection(searchParams.get("orderDirection"));

    const [inscricoes, recruiters] = await Promise.all([
      fetchAllInscricoes({ orderBy, orderDirection, filters }),
      listRecruitersWithDbNames(),
    ]);

    const recruiterMap = new Map(recruiters.map((r) => [r.code.toLowerCase(), r.name]));

    // Construir filtros ativos para o título
    const activeFilters: string[] = [];
    if (filters.nome) activeFilters.push(`Nome: ${filters.nome}`);
    if (filters.telefone) activeFilters.push(`Telefone: ${filters.telefone}`);
    if (filters.indicacao) {
      const recruiterName = recruiterMap.get(filters.indicacao.toLowerCase()) || filters.indicacao;
      activeFilters.push(`Indicador: ${recruiterName}`);
    }
    if (filters.treinamento) activeFilters.push(`Treinamento: ${filters.treinamento}`);
    if (filters.presenca) {
      const presencaLabels: Record<string, string> = {
        aprovada: "Aprovada",
        reprovada: "Reprovada",
        validada: "Validada",
        "nao-validada": "Sem Presença",
      };
      activeFilters.push(`Presença: ${presencaLabels[filters.presenca]}`);
    }

    const title = activeFilters.length > 0 ? activeFilters.join(" | ") : "Listagem Completa";
    const now = new Date();
    const dateStr = `${now.toLocaleDateString("pt-BR")} às ${now.toLocaleTimeString("pt-BR")}`;

    // Gerar HTML para impressão
    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Impressão - ${title}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 10px;
      line-height: 1.3;
      color: #1f2937;
      background: white;
    }
    
    .header {
      padding: 10px 0;
      border-bottom: 2px solid #e5e7eb;
      margin-bottom: 10px;
    }
    
    .header h1 {
      font-size: 14px;
      font-weight: bold;
      color: #111827;
      margin-bottom: 4px;
    }
    
    .header p {
      font-size: 10px;
      color: #6b7280;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9px;
    }
    
    th, td {
      padding: 4px 6px;
      text-align: left;
      border: 1px solid #d1d5db;
    }
    
    th {
      background-color: #f3f4f6;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 8px;
      color: #374151;
    }
    
    tr:nth-child(even) {
      background-color: #f9fafb;
    }
    
    tr {
      page-break-inside: avoid;
    }
    
    .text-center {
      text-align: center;
    }
    
    .badge {
      display: inline-block;
      padding: 1px 4px;
      border-radius: 2px;
      font-size: 7px;
      font-weight: 600;
    }
    
    .badge-lead {
      background-color: #fef3c7;
      color: #92400e;
    }
    
    .badge-recruiter {
      background-color: #d1fae5;
      color: #065f46;
    }
    
    @media print {
      @page {
        size: A4 landscape;
        margin: 8mm;
      }
      
      body {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    }
    
    @media screen {
      body {
        padding: 20px;
        max-width: 1200px;
        margin: 0 auto;
      }
      
      .print-btn {
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 10px 20px;
        background: #2DBDC2;
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
      }
      
      .print-btn:hover {
        background: #1a9a9e;
      }
    }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">🖨️ Imprimir / PDF</button>
  
  <div class="header">
    <h1>${title}</h1>
    <p>${inscricoes.length} registros • Gerado em ${dateStr}</p>
  </div>
  
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Nome</th>
        <th>Telefone</th>
        <th>Cidade</th>
        <th>Treinamento</th>
        <th>Indicador</th>
        <th class="text-center">Tipo</th>
        <th class="text-center">Presença</th>
      </tr>
    </thead>
    <tbody>
      ${inscricoes
        .map(
          (inscricao, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${inscricao.nome ?? ""}</td>
          <td>${inscricao.telefone ?? ""}</td>
          <td>${inscricao.cidade ?? ""}</td>
          <td>${inscricao.treinamentoNome ?? formatDate(inscricao.treinamentoData) ?? inscricao.treinamentoId ?? ""}</td>
          <td>${humanizeName(inscricao.recrutadorNome) ?? inscricao.recrutadorCodigo ?? ""}</td>
          <td class="text-center">
            <span class="badge ${inscricao.tipo === "lead" ? "badge-lead" : "badge-recruiter"}">
              ${inscricao.tipo === "lead" ? "Lead" : "Recrutador"}
            </span>
          </td>
          <td class="text-center">${getPresencaLabel(inscricao)}</td>
        </tr>
      `
        )
        .join("")}
    </tbody>
  </table>
  
  <script>
    // Auto-abrir diálogo de impressão
    window.onload = function() {
      // Pequeno delay para garantir que a página carregou
      setTimeout(function() {
        window.print();
      }, 500);
    };
  </script>
</body>
</html>`;

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("Print export error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
