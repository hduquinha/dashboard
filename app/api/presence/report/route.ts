import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { Buffer } from "node:buffer";

interface ClusterData {
  code: string;
  name: string;
  presentes: Array<{
    nome: string;
    participanteNomeZoom: string | null;
    telefone: string | null;
    aprovado: boolean;
    tempoTotalMinutos: number;
  }>;
  totalPresentes: number;
  totalAprovados: number;
}

interface ReportRequest {
  treinamentoId: string;
  clusters: ClusterData[];
  totalParticipantes: number;
  totalAprovados: number;
  totalReprovados: number;
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
}

export async function POST(request: NextRequest) {
  try {
    const body: ReportRequest = await request.json();
    const { treinamentoId, clusters, totalParticipantes, totalAprovados, totalReprovados } = body;

    // Ordenar clusters por aprovados
    const sortedClusters = [...clusters].sort(
      (a, b) => b.totalAprovados - a.totalAprovados || b.totalPresentes - a.totalPresentes
    );
    const top5 = sortedClusters.slice(0, 5);

    // Criar PDF
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
    });

    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));

    // Header
    doc.fontSize(20).font("Helvetica-Bold").fillColor("#1e293b");
    doc.text("RELATÓRIO DE PRESENÇA NO ENCONTRO", { align: "center" });
    doc.moveDown(0.5);

    doc.fontSize(12).font("Helvetica").fillColor("#64748b");
    doc.text(`Treinamento: ${treinamentoId}`, { align: "center" });
    doc.text(
      `Data do Relatório: ${new Date().toLocaleDateString("pt-BR")} ${new Date().toLocaleTimeString("pt-BR")}`,
      { align: "center" }
    );
    doc.moveDown(1.5);

    // Resumo Geral
    doc.fontSize(14).font("Helvetica-Bold").fillColor("#0ea5e9");
    doc.text("RESUMO GERAL", { underline: true });
    doc.moveDown(0.5);

    doc.fontSize(11).font("Helvetica").fillColor("#1e293b");
    doc.text(`Total de Participantes: ${totalParticipantes}`);
    doc.text(`Aprovados (presença OK): ${totalAprovados}`, { continued: false });
    doc.text(`Reprovados (faltou presença): ${totalReprovados}`);
    doc.moveDown(1.5);

    // Ranking Top 5
    doc.fontSize(14).font("Helvetica-Bold").fillColor("#eab308");
    doc.text("🏆 RANKING TOP 5 CLUSTERS", { underline: true });
    doc.moveDown(0.5);

    const medals = ["🥇", "🥈", "🥉", "  ", "  "];
    top5.forEach((cluster, index) => {
      doc.fontSize(12).font("Helvetica-Bold").fillColor("#1e293b");
      doc.text(
        `${medals[index]} ${index + 1}º Lugar: ${cluster.name} - ${cluster.totalPresentes} presente(s)`
      );
    });
    doc.moveDown(1.5);

    // Gráfico de barras simples (usando linhas)
    doc.fontSize(14).font("Helvetica-Bold").fillColor("#0ea5e9");
    doc.text("GRÁFICO DE PRESENTES POR CLUSTER", { underline: true });
    doc.moveDown(0.5);

    const maxAprovados = Math.max(...top5.map((c) => c.totalPresentes), 1);
    const barMaxWidth = 300;
    const barHeight = 20;
    const startY = doc.y;

    top5.forEach((cluster, index) => {
      const y = startY + index * (barHeight + 10);
      const barWidth = (cluster.totalPresentes / maxAprovados) * barMaxWidth;

      // Nome do cluster
      doc.fontSize(10).font("Helvetica").fillColor("#1e293b");
      doc.text(cluster.name, 50, y + 5, { width: 100 });

      // Barra
      const colors = ["#10b981", "#3b82f6", "#f59e0b", "#8b5cf6", "#ec4899"];
      doc.rect(160, y, barWidth, barHeight).fill(colors[index] || "#64748b");

      // Valor
      doc.fontSize(10).font("Helvetica-Bold").fillColor("#1e293b");
      doc.text(cluster.totalPresentes.toString(), 165 + barWidth + 5, y + 5);
    });

    doc.y = startY + top5.length * (barHeight + 10) + 20;
    doc.moveDown(2);

    // Presentes por Cluster (nova página se necessário)
    if (doc.y > 650) {
      doc.addPage();
    }

    doc.fontSize(14).font("Helvetica-Bold").fillColor("#0ea5e9");
    doc.text("PRESENTES POR CLUSTER", { underline: true });
    doc.moveDown(1);

    sortedClusters.forEach((cluster) => {
      // Verificar se precisa de nova página
      if (doc.y > 700) {
        doc.addPage();
      }

      // Header do cluster
      doc.fontSize(12).font("Helvetica-Bold").fillColor("#0284c7");
      doc.text(`${cluster.name} (${cluster.totalPresentes} presentes)`);
      doc.moveDown(0.3);

      // Lista de presentes
      cluster.presentes.forEach((p, idx) => {
        if (doc.y > 750) {
          doc.addPage();
        }

        const status = p.aprovado ? "✓" : "✗";
        const statusColor = p.aprovado ? "#10b981" : "#ef4444";

        doc.fontSize(10).font("Helvetica").fillColor(statusColor);
        doc.text(`${status} `, { continued: true });
        doc.fillColor("#1e293b");
        doc.text(`${idx + 1}. ${p.nome}`, { continued: true });
        doc.fillColor("#64748b");
        doc.text(` - ${formatMinutes(p.tempoTotalMinutos)}${p.telefone ? ` | Tel: ${p.telefone}` : ""}`);
      });

      doc.moveDown(0.8);
    });

    // Rodapé
    doc.fontSize(8).font("Helvetica").fillColor("#94a3b8");
    doc.text("Relatório gerado automaticamente pelo Sistema de Gestão de Presenças", 50, 780, {
      align: "center",
    });

    // Finalizar
    doc.end();

    // Esperar todos os chunks
    const buffer = await new Promise<Buffer>((resolve) => {
      doc.on("end", () => {
        resolve(Buffer.concat(chunks));
      });
    });

    // Converter Buffer para Uint8Array para compatibilidade com NextResponse
    const uint8Array = new Uint8Array(buffer);

    return new NextResponse(uint8Array, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="relatorio-presenca-${treinamentoId}-${new Date().toISOString().split("T")[0]}.pdf"`,
      },
    });
  } catch (error) {
    console.error("Erro ao gerar PDF:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao gerar PDF" },
      { status: 500 }
    );
  }
}
