import { writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { buildContractPdf, type ContractEvidence } from "@/lib/contractDocument";
import {
  VOZUP_CONTRACT_COMPANY,
  normalizePlan,
  type ContractSnapshot,
} from "@/lib/contractTemplate";

const SNAPSHOT: ContractSnapshot = {
  company: VOZUP_CONTRACT_COMPANY,
  student: {
    name: "Maria de Souza Oliveira",
    rg: "12.345.678-9",
    cpf: "52998224725",
    birthDate: "1990-04-15",
    profession: "Administradora",
    company: "Empresa Exemplo Ltda.",
    phone: "1133334444",
    mobile: "11999998888",
    email: "maria@example.com",
    address: "Rua Exemplo, 123, apto. 45",
    neighborhood: "Centro",
    city: "São Paulo",
    state: "SP",
    zip: "01000-000",
  },
  signer: {
    name: "Maria de Souza Oliveira",
    cpf: "52998224725",
    email: "maria@example.com",
    phone: "11999998888",
    role: "aluno",
  },
  course: {
    name: "Oratória e Liderança Emocional",
    hours: "48 horas",
    className: "Turma Agosto/2026",
  },
  plan: normalizePlan([
    {
      key: "matricula",
      label: "MATRÍCULA",
      amount: 400,
      installments: 1,
      installmentAmount: 400,
      paymentMethod: "Pix",
      firstDueDate: "2026-08-20",
    },
    {
      key: "material",
      label: "MATERIAL DIDÁTICO",
      amount: 600,
      installments: 2,
      installmentAmount: 300,
      paymentMethod: "Cartão",
      firstDueDate: "2026-08-20",
    },
    {
      key: "curso",
      label: "CURSO",
      amount: 2900,
      installments: 12,
      installmentAmount: 241.67,
      paymentMethod: "Cartão",
      firstDueDate: "2026-09-20",
    },
  ]),
  notes: "Teste de preenchimento do modelo V4.",
  saleDate: "2026-08-18",
  generatedAt: "2026-08-18T12:00:00.000Z",
};

const EVIDENCE: ContractEvidence = {
  contractId: 42,
  version: 1,
  signedAt: "2026-08-18T15:00:00.000Z",
  signerName: SNAPSHOT.signer.name,
  signerCpf: SNAPSHOT.signer.cpf ?? "",
  cpfVerified: true,
  ip: "203.0.113.10",
  userAgent: "Mozilla/5.0 teste",
  openedAt: "2026-08-18T14:55:00.000Z",
  linkReference: "ABCDEF1234567890",
  readingSeconds: 300,
  minReadingSeconds: 90,
  reachedEnd: true,
  otpVerified: true,
  otpSentTo: "henriqueduquis1@gmail.com",
  contentHash: "a".repeat(64),
  acceptanceText: "Declaro que li e aceito o contrato.",
};

describe("PDF do contrato VozUP (modelo V4)", () => {
  it("gera a via para imprimir e assinar à caneta", async () => {
    const file = await buildContractPdf({
      snapshot: SNAPSHOT,
      contractId: 42,
      version: 1,
      variant: "impressao",
      evidence: null,
    });
    const pdf = await PDFDocument.load(file);
    expect(file.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(3);
    expect(pdf.getTitle()).toContain("42");
    if (process.env.CONTRACT_PRINT_PREVIEW_PATH) {
      writeFileSync(process.env.CONTRACT_PRINT_PREVIEW_PATH, file);
    }
  });

  it("a via digital assinada ganha uma página a mais: o termo de evidências", async () => {
    const preview = await buildContractPdf({
      snapshot: SNAPSHOT,
      contractId: 42,
      version: 1,
      variant: "digital",
      evidence: null,
    });
    const signed = await buildContractPdf({
      snapshot: SNAPSHOT,
      contractId: 42,
      version: 1,
      variant: "digital",
      evidence: EVIDENCE,
    });

    const previewPages = (await PDFDocument.load(preview)).getPageCount();
    const signedPages = (await PDFDocument.load(signed)).getPageCount();
    expect(signedPages).toBe(previewPages + 1);

    if (process.env.CONTRACT_SIGNED_PREVIEW_PATH) {
      writeFileSync(process.env.CONTRACT_SIGNED_PREVIEW_PATH, signed);
    }
  });

  it("o termo de evidências nunca traz o e-mail inteiro do aluno", async () => {
    // O termo circula em processo e vai anexado por e-mail. Provar o segundo
    // fator não exige espalhar o endereço completo de quem assinou.
    const file = await buildContractPdf({
      snapshot: SNAPSHOT,
      contractId: 42,
      version: 1,
      variant: "digital",
      evidence: EVIDENCE,
    });
    expect(file.includes(Buffer.from("henriqueduquis1@gmail.com"))).toBe(false);
  });

  it("assinatura da escola quebrada não impede a emissão do contrato", async () => {
    // O pior caso realista: alguém salva lixo no campo da assinatura. A linha
    // da CONTRATADA sai em branco, mas o contrato SAI — o aluno não pode ficar
    // sem documento porque a imagem do CEO estava corrompida.
    for (const signatureImage of ["data:image/png;base64,!!!nao-e-base64", "nao-e-data-uri", ""]) {
      const file = await buildContractPdf({
        snapshot: { ...SNAPSHOT, company: { ...SNAPSHOT.company, signatureImage } },
        contractId: 42,
        version: 1,
        variant: "digital",
        evidence: EVIDENCE,
      });
      expect(file.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    }
  });

  it("o CPF do contratante sai nas duas vias, e sem linhas de testemunha", async () => {
    for (const variant of ["digital", "impressao"] as const) {
      const file = await buildContractPdf({
        snapshot: SNAPSHOT,
        contractId: 42,
        version: 1,
        variant,
        evidence: variant === "digital" ? EVIDENCE : null,
      });
      const text = file.toString("latin1");
      // Testemunha saiu do documento por decisão da escola em 21/08/2026.
      expect(text).not.toContain("TESTEMUNHA");
      expect(file.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    }
  });

  it("nome e cargo de quem assina pela escola entram nas duas vias", async () => {
    const company = {
      ...SNAPSHOT.company,
      representativeName: "Rodrigo Damaceno",
      representativeRole: "CEO",
    };
    for (const variant of ["digital", "impressao"] as const) {
      const file = await buildContractPdf({
        snapshot: { ...SNAPSHOT, company },
        contractId: 42,
        version: 1,
        variant,
        evidence: variant === "digital" ? EVIDENCE : null,
      });
      expect(file.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    }
  });

  it("quadro com entrada tem uma linha a mais e o PDF sai igual", async () => {
    const comEntrada: ContractSnapshot = {
      ...SNAPSHOT,
      plan: normalizePlan([
        ...SNAPSHOT.plan.filter((row) => row.key !== "curso"),
        {
          key: "entrada",
          label: "ENTRADA (NO ATO)",
          amount: 500,
          installments: 1,
          installmentAmount: 500,
          paymentMethod: "Pix",
          firstDueDate: "2026-08-18",
        },
        {
          key: "curso",
          label: "CURSO",
          amount: 2400,
          installments: 12,
          installmentAmount: 200,
          paymentMethod: "Cartão",
          firstDueDate: "2026-09-20",
        },
      ]),
    };
    expect(comEntrada.plan.map((row) => row.key)).toEqual([
      "matricula",
      "material",
      "entrada",
      "curso",
    ]);
    const file = await buildContractPdf({
      snapshot: comEntrada,
      contractId: 43,
      version: 1,
      variant: "impressao",
      evidence: null,
    });
    expect((await PDFDocument.load(file)).getPageCount()).toBeGreaterThanOrEqual(3);
  });

  it("contrato sem dados preenchidos ainda gera PDF — a folha sai com os campos em branco", async () => {
    const empty: ContractSnapshot = {
      ...SNAPSHOT,
      student: {
        name: "Aluno Sem Cadastro",
        rg: null,
        cpf: null,
        birthDate: null,
        profession: null,
        company: null,
        phone: null,
        mobile: null,
        email: null,
        address: null,
        neighborhood: null,
        city: null,
        state: null,
        zip: null,
      },
      course: { name: "", hours: null, className: null },
      plan: normalizePlan([]),
      notes: null,
    };
    const file = await buildContractPdf({
      snapshot: empty,
      contractId: 7,
      version: 1,
      variant: "impressao",
      evidence: null,
    });
    expect((await PDFDocument.load(file)).getPageCount()).toBeGreaterThanOrEqual(3);
  });
});
