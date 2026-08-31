"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Ban,
  Building2,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FilePlus2,
  FileSignature,
  Link2,
  MessageCircle,
  Pencil,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import IconTile, { type IconTileTone } from "@/components/IconTile";
import { NovoContratoModal } from "./NovoContratoModal";
import { RegularizarPanel, type EnrollmentPendency } from "./RegularizarPanel";
import { buildWhatsAppWebUrl, openWhatsAppOnMobile } from "@/lib/utils";
import {
  CONTRACT_STATUS_LABELS,
  SCANNED_UPLOAD_MAX_BYTES,
  SIGNER_ROLE_LABELS,
  contractLinkPath,
  contractWhatsAppMessage,
  type ContractStatus,
} from "@/lib/contractRules";
import {
  PLAN_ROW_LABELS,
  type ContractCompany,
  type ContractCourse,
  type ContractPlanRow,
  type ContractSigner,
  type ContractCoStudent,
  type ContractStudent,
} from "@/lib/contractTemplate";
import type { ContractChargeState, ContractEventRecord, ContractSummary } from "@/lib/contracts";
import { describePlanSplitDivergence } from "@/lib/contractProfile";
import { enrollmentInstallmentOptions, installmentCap } from "@/lib/enrollmentInstallments";

interface ContratosClientProps {
  initialContracts: ContractSummary[];
  initialCompany: ContractCompany;
  missingCompany: string[];
  canManage: boolean;
}

const STATUS_STYLE: Record<ContractStatus, string> = {
  pendente: "bg-amber-50 text-amber-700",
  assinado: "bg-emerald-50 text-emerald-700",
  cancelado: "bg-neutral-100 text-neutral-500",
};

const EVENT_LABELS: Record<string, string> = {
  created: "Contrato gerado",
  updated: "Dados atualizados",
  link_reissued: "Link reemitido",
  opened: "Link aberto pelo signatário",
  sign_rejected: "Tentativa de assinatura recusada",
  signed: "Assinado eletronicamente",
  signed_physical: "Via assinada no papel arquivada",
  canceled: "Cancelado",
  sale_changed: "Venda alterada depois da assinatura",
  downloaded: "Via assinada baixada",
};

function formatMoney(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function formatCpf(value: string | null): string {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length !== 11) return value ?? "—";
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

/**
 * Rascunho do quadro de resumo.
 *
 * Espelha o `snapshot` do contrato em vez de campos soltos porque é assim que
 * a lib grava: `updateContract` faz merge por seção, então mandar a seção
 * inteira evita apagar sem querer o que a tela não mostra.
 */
interface ContractDataDraft {
  id: number;
  student: ContractStudent;
  signer: ContractSigner;
  course: ContractCourse;
  plan: PlanDraftRow[];
  /** Alunos adicionais do contrato de casal, editáveis aqui como o titular. */
  coStudents: CoStudentDraft[];
  /** Item 5 do contrato. Nasce do campo Observações da venda. */
  notes: string;
  /** Financeiro da matrícula. Chega depois (uma chamada), por isso é opcional. */
  charge: ChargeDraft | null;
}

/** O resto do financeiro do contrato — o que não cabe no quadro do item 4. */
interface ChargeDraft {
  saleDate: string;
  sellerId: string;
  sellerName: string | null;
  branchId: string;
  branchName: string | null;
  cardBrandId: string;
  cardBrandName: string | null;
  paymentCount: number;
}

interface EnrollmentSemContrato {
  enrollmentId: number;
  student: string;
  courseName: string | null;
  amount: number;
  saleDate: string | null;
  sellerName: string | null;
  planSplit: { matricula: number; material: number; curso: number } | null;
}

/** "1500" → "1.500,00"; zero vira campo vazio, não "0,00". */
function valorParaCampo(valor: number): string {
  return valor > 0 ? valor.toFixed(2).replace(".", ",") : "";
}

/** Geração de contrato em curso: a matrícula escolhida e os valores editáveis. */
interface GeracaoDraft {
  carregando: boolean;
  matriculas: EnrollmentSemContrato[];
  escolhida: EnrollmentSemContrato | null;
  matricula: string;
  material: string;
  curso: string;
}

/** Aluno adicional em edição: o valor fica como texto enquanto se digita. */
interface CoStudentDraft extends ContractCoStudent {
  amountText: string;
}

/**
 * Valor e parcelas ficam como **string crua** enquanto se digita.
 *
 * Guardar o número parseado e devolvê-lo ao `value` impede digitar decimal:
 * ao teclar "1200," o parse devolve 1200, o React reescreve o campo e come a
 * vírgula. A conversão para número acontece só no envio.
 */
interface PaymentMethodOption {
  id: number;
  name: string;
  kind: string;
  maxInstallments: number | null;
}

interface NamedOption {
  id: number;
  name: string;
}

/** O que a tela precisa do catálogo para editar o financeiro do contrato. */
interface ChargeCatalog {
  paymentMethods: PaymentMethodOption[];
  cardBrands: NamedOption[];
  sellers: NamedOption[];
  branches: NamedOption[];
}

interface PlanDraftRow {
  key: ContractPlanRow["key"];
  label: string;
  amount: string;
  installments: string;
  paymentMethod: string;
  firstDueDate: string;
}

// As quatro linhas do quadro em papel, na ordem — as mesmas que o contrato
// impresso mostra, zeradas ou não (ver normalizePlan).
const PLAN_KEYS: ContractPlanRow["key"][] = ["matricula", "material", "entrada", "curso"];

/** Quadro em branco de um aluno adicionado direto no contrato. */
const EMPTY_CONTRACT_STUDENT: ContractStudent = {
  name: "",
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
};

function parseDecimal(value: string): number {
  const clean = value.trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number(clean);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
}

function parseCount(value: string): number {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * O plano sempre aparece com as quatro linhas, mesmo as zeradas: quem preenche
 * precisa ver onde rateia.
 *
 * A entrada tem um socorro: contrato gerado antes de o quadro ter linha de
 * ENTRADA abre com ela vazia mesmo com entrada registrada no Financeiro — e
 * salvar assim apagaria esse dinheiro da cobrança, já que o quadro manda nela.
 * Por isso o campo nasce com a entrada que a matrícula tem.
 */
function planRows(plan: ContractPlanRow[], saleDownPayment: number): PlanDraftRow[] {
  return PLAN_KEYS.map((key) => {
    const row = plan.find((item) => item.key === key);
    const amount =
      key === "entrada" && !(row && row.amount > 0) ? saleDownPayment : row?.amount ?? 0;
    return {
      key,
      label: PLAN_ROW_LABELS[key],
      amount: amount > 0 ? String(amount).replace(".", ",") : "",
      installments: row ? String(row.installments) : "1",
      paymentMethod: row?.paymentMethod ?? "",
      firstDueDate: row?.firstDueDate ?? "",
    };
  });
}

function draftPlanTotal(plan: PlanDraftRow[]): number {
  return Math.round(plan.reduce((sum, row) => sum + parseDecimal(row.amount), 0) * 100) / 100;
}

/** Só as linhas com valor viram plano: uma linha zerada impressa no quadro levanta dúvida em vez de informar. */
function toPlanRows(plan: PlanDraftRow[]): ContractPlanRow[] {
  return plan
    .map((row) => {
      const amount = parseDecimal(row.amount);
      const installments = parseCount(row.installments);
      return {
        key: row.key,
        label: PLAN_ROW_LABELS[row.key],
        amount,
        installments,
        installmentAmount: Math.round((amount / installments) * 100) / 100,
        paymentMethod: row.paymentMethod.trim() || null,
        firstDueDate: row.firstDueDate || null,
      };
    })
    .filter((row) => row.amount > 0);
}

/**
 * Contrato gravado antes da coluna `snapshot` existir vem sem ela — a própria
 * lib trata isso como possível. Abrir o editor com os campos vazios, e deixar
 * o vendedor preencher, é melhor que derrubar a tela inteira num destructure.
 */
/**
 * O contrato soma o plano; a venda soma o que o Financeiro registrou. Divergir
 * é legítimo (a secretaria pode repartir matrícula/material/curso), então isso
 * avisa em vez de travar — mas ninguém deve mandar assinar sem perceber.
 */
function divergesFromSale(contract: ContractSummary): boolean {
  if (contract.saleAmount === null) return false;
  return Math.abs(contract.amount - contract.saleAmount) > 0.005;
}

/**
 * O que está gravado mas saiu do cadastro (vendedor desligado, unidade
 * desativada) continua na lista. Sem isso, abrir o quadro e salvar apagaria em
 * silêncio o vendedor de uma venda antiga — e com ele a comissão.
 */
function offCatalogOption(
  options: NamedOption[] | undefined,
  id: string,
  name: string | null
): ReactNode {
  if (!id || (options ?? []).some((item) => String(item.id) === id)) return null;
  return <option value={id}>{name ?? `#${id}`} (fora do cadastro)</option>;
}

function draftFromContract(contract: ContractSummary): ContractDataDraft {
  const snapshot = contract.snapshot as ContractSummary["snapshot"] | null;
  return {
    id: contract.id,
    charge: null,
    student: snapshot
      ? { ...snapshot.student }
      : {
          name: contract.studentName ?? contract.signerName,
          rg: null,
          cpf: contract.signerCpf,
          birthDate: null,
          profession: null,
          company: null,
          phone: null,
          mobile: contract.signerPhone,
          email: contract.signerEmail,
          address: null,
          neighborhood: null,
          city: null,
          state: null,
          zip: null,
        },
    signer: snapshot
      ? { ...snapshot.signer }
      : {
          name: contract.signerName,
          cpf: contract.signerCpf,
          email: contract.signerEmail,
          phone: contract.signerPhone,
          role: contract.signerRole,
        },
    course: snapshot ? { ...snapshot.course } : { name: contract.courseName ?? "", hours: null, className: null },
    plan: planRows(snapshot?.plan ?? [], contract.saleDownPayment),
    coStudents: (snapshot?.coStudents ?? []).map((co) => ({
      ...co,
      amountText: co.amount > 0 ? String(co.amount).replace(".", ",") : "",
    })),
    notes: snapshot?.notes ?? "",
  };
}

/**
 * Gestão dos contratos digitais de matrícula.
 *
 * A tela existe para responder, em ordem: **quem ainda não assinou**, o que
 * falta para poder mandar o link, e o que exatamente ficou registrado de quem
 * já assinou. Por isso os pendentes vêm primeiro, o aviso de dados da escola
 * fica no topo (contrato com lacuna não pode ser enviado) e a trilha de
 * evidências abre no detalhe, e não numa tela separada — na hora de discutir
 * uma assinatura, ninguém quer procurar.
 */
export function ContratosClient({
  initialContracts,
  initialCompany,
  missingCompany,
  canManage,
}: ContratosClientProps) {
  const [contracts, setContracts] = useState(initialContracts);
  const [company, setCompany] = useState(initialCompany);
  const [missing, setMissing] = useState(missingCompany);
  const [status, setStatus] = useState<ContractStatus | "todos">("pendente");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ contract: ContractSummary; events: ContractEventRecord[] } | null>(null);
  const [dataDraft, setDataDraft] = useState<ContractDataDraft | null>(null);
  const [physicalDraft, setPhysicalDraft] = useState<{ contract: ContractSummary; file: File | null } | null>(null);
  const [companyDraft, setCompanyDraft] = useState<ContractCompany | null>(null);
  const [saving, setSaving] = useState(false);
  const [gerando, setGerando] = useState<GeracaoDraft | null>(null);
  /** Catálogo do financeiro: formas (com o teto de parcelas), bandeiras,
   *  vendedores e unidades. Vem de /api/contracts/intake — e não do Financeiro —
   *  porque quem gerencia contrato pode não ter permissão lá. */
  const [chargeCatalog, setChargeCatalog] = useState<ChargeCatalog | null>(null);
  const paymentMethods = chargeCatalog?.paymentMethods ?? [];

  // Só quando o quadro é aberto: quem apenas lista contratos não precisa do catálogo.
  useEffect(() => {
    if (!dataDraft || chargeCatalog) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/contracts/intake");
        const data = (await response.json().catch(() => ({}))) as Partial<ChargeCatalog>;
        if (cancelled) return;
        setChargeCatalog({
          paymentMethods: data.paymentMethods ?? [],
          cardBrands: data.cardBrands ?? [],
          sellers: data.sellers ?? [],
          branches: data.branches ?? [],
        });
      } catch {
        // Sem catálogo os campos viram texto livre, como era antes — não é
        // motivo para derrubar o quadro inteiro.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataDraft, chargeCatalog]);

  /** O financeiro da matrícula deste contrato, buscado ao abrir o quadro. */
  useEffect(() => {
    const contractId = dataDraft?.id;
    if (!contractId || dataDraft?.charge) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/contracts/${contractId}`);
        const data = (await response.json().catch(() => ({}))) as {
          charge?: ContractChargeState | null;
        };
        if (cancelled || !data.charge) return;
        setDataDraft((current) =>
          current && current.id === contractId
            ? {
                ...current,
                charge: {
                  saleDate: data.charge!.saleDate,
                  sellerId: data.charge!.sellerId ? String(data.charge!.sellerId) : "",
                  sellerName: data.charge!.sellerName,
                  branchId: data.charge!.branchId ? String(data.charge!.branchId) : "",
                  branchName: data.charge!.branchName,
                  cardBrandId: data.charge!.cardBrandId ? String(data.charge!.cardBrandId) : "",
                  cardBrandName: data.charge!.cardBrandName,
                  paymentCount: data.charge!.paymentCount,
                },
              }
            : current
        );
      } catch {
        // Matrícula sem financeiro legível: o quadro continua editável, só sem
        // o bloco de cobrança.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataDraft?.id, dataDraft?.charge]);

  const totals = useMemo(
    () => ({
      pendentes: contracts.filter((item) => item.status === "pendente").length,
      assinados: contracts.filter((item) => item.status === "assinado").length,
      desatualizados: contracts.filter((item) => item.outdated).length,
    }),
    [contracts]
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return contracts.filter((item) => {
      if (status !== "todos" && item.status !== status) return false;
      if (!term) return true;
      return [item.signerName, item.studentName, item.courseName, item.signerCpf]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term));
    });
  }, [contracts, search, status]);

  const replaceContract = useCallback((updated: ContractSummary) => {
    setContracts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  }, []);

  const linkFor = useCallback(
    (contract: ContractSummary) =>
      typeof window === "undefined"
        ? contractLinkPath(contract.token)
        : `${window.location.origin}${contractLinkPath(contract.token)}`,
    []
  );

  /**
   * Assistente de contrato novo. `pendency` nulo é contrato do zero; com
   * matrícula, é a regularização de quem já foi lançado no Financeiro.
   */
  const [novoContrato, setNovoContrato] = useState<{ pendency: EnrollmentPendency | null } | null>(null);
  /** Recarrega a fila de pendências depois de mexer em contrato ou matrícula. */
  const [filaVersao, setFilaVersao] = useState(0);

  async function recarregarContratos() {
    const lista = await fetch("/api/contracts?status=todos");
    const dados = (await lista.json().catch(() => ({}))) as { contracts?: ContractSummary[] };
    if (dados.contracts) setContracts(dados.contracts);
  }

  async function copyLink(contract: ContractSummary) {
    try {
      await navigator.clipboard.writeText(linkFor(contract));
      setNotice("Link de assinatura copiado.");
      setError(null);
    } catch {
      setError("Não consegui copiar. Copie manualmente: " + linkFor(contract));
    }
  }

  async function patchContract(id: number, body: Record<string, unknown>, successMessage: string) {
    setBusy(id);
    setError(null);
    try {
      const response = await fetch(`/api/contracts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { contract?: ContractSummary; error?: string };
      if (!response.ok || !data.contract) throw new Error(data.error ?? "Falha ao atualizar o contrato.");
      replaceContract(data.contract);
      setNotice(successMessage);
      return data.contract;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao atualizar o contrato.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function openDetail(contract: ContractSummary) {
    setError(null);
    try {
      const response = await fetch(`/api/contracts/${contract.id}`);
      const data = (await response.json()) as {
        contract?: ContractSummary;
        events?: ContractEventRecord[];
        error?: string;
      };
      if (!response.ok || !data.contract) throw new Error(data.error ?? "Falha ao abrir o contrato.");
      setDetail({ contract: data.contract, events: data.events ?? [] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao abrir o contrato.");
    }
  }

  function setStudent(patch: Partial<ContractStudent>) {
    setDataDraft((current) => (current ? { ...current, student: { ...current.student, ...patch } } : current));
  }

  function setSigner(patch: Partial<ContractSigner>) {
    setDataDraft((current) => (current ? { ...current, signer: { ...current.signer, ...patch } } : current));
  }

  function setCourse(patch: Partial<ContractCourse>) {
    setDataDraft((current) => (current ? { ...current, course: { ...current.course, ...patch } } : current));
  }

  function setCoStudent(index: number, patch: Partial<CoStudentDraft>) {
    setDataDraft((current) =>
      current
        ? {
            ...current,
            coStudents: current.coStudents.map((item, i) => (i === index ? { ...item, ...patch } : item)),
          }
        : current
    );
  }

  /** A forma do cadastro com este nome — é dela que sai o teto de parcelas. */
  function methodOf(name: string): PaymentMethodOption | undefined {
    return paymentMethods.find((method) => method.name === name);
  }

  /** Forma escolhida numa linha do quadro — a do CURSO decide se pede bandeira. */
  function planRowValue(key: ContractPlanRow["key"]): string {
    return dataDraft?.plan.find((row) => row.key === key)?.paymentMethod ?? "";
  }

  function setCharge(patch: Partial<ChargeDraft>) {
    setDataDraft((current) =>
      current && current.charge ? { ...current, charge: { ...current.charge, ...patch } } : current
    );
  }

  function setPlanRow(index: number, patch: Partial<PlanDraftRow>) {
    setDataDraft((current) =>
      current
        ? { ...current, plan: current.plan.map((row, i) => (i === index ? { ...row, ...patch } : row)) }
        : current
    );
  }

  /* ── Gerar contrato a partir de uma matrícula ────────────────────────
     A tela nunca teve este caminho: o contrato só nascia sozinho ao registrar a
     venda. Quem vendeu fora do modal (ou cancelou um contrato e precisou de
     outro) ficava sem saída. Aqui a fila de matrículas sem contrato vem sob
     demanda, e os valores são editáveis ANTES de gerar. */
  async function abrirGeracao() {
    setGerando({ carregando: true, matriculas: [], escolhida: null, matricula: "", material: "", curso: "" });
    try {
      const response = await fetch("/api/contracts?fila=1");
      const payload = (await response.json().catch(() => ({}))) as {
        enrollments?: EnrollmentSemContrato[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar as matrículas.");
      setGerando((atual) =>
        atual ? { ...atual, carregando: false, matriculas: payload.enrollments ?? [] } : atual
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar as matrículas.");
      setGerando(null);
    }
  }

  async function confirmarGeracao() {
    if (!gerando?.escolhida) return;
    setSaving(true);
    try {
      const response = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrollmentId: gerando.escolhida.enrollmentId,
          planSplit: {
            matricula: parseDecimal(gerando.matricula),
            material: parseDecimal(gerando.material),
            curso: parseDecimal(gerando.curso),
          },
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível gerar o contrato.");
      setGerando(null);
      setNotice("Contrato gerado.");
      const lista = await fetch("/api/contracts?status=todos");
      const dados = (await lista.json().catch(() => ({}))) as { contracts?: ContractSummary[] };
      if (dados.contracts) setContracts(dados.contracts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gerar o contrato.");
    } finally {
      setSaving(false);
    }
  }

  async function saveContractData() {
    if (!dataDraft) return;
    setSaving(true);
    const updated = await patchContract(
      dataDraft.id,
      {
        action: "data",
        student: dataDraft.student,
        signer: dataDraft.signer,
        course: dataDraft.course,
        plan: toPlanRows(dataDraft.plan),
        charge: dataDraft.charge
          ? {
              saleDate: dataDraft.charge.saleDate,
              sellerId: dataDraft.charge.sellerId,
              branchId: dataDraft.charge.branchId,
              cardBrandId: dataDraft.charge.cardBrandId,
            }
          : undefined,
        coStudents: dataDraft.coStudents.map((co) => ({
          student: co.student,
          course: co.course,
          amount: parseDecimal(co.amountText),
        })),
        notes: dataDraft.notes.trim() || null,
        role: dataDraft.signer.role,
      },
      "Quadro de resumo atualizado."
    );
    setSaving(false);
    if (updated) setDataDraft(null);
  }

  async function uploadPhysicalContract() {
    if (!physicalDraft?.file) {
      setError("Selecione o arquivo digitalizado.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", physicalDraft.file);
      const response = await fetch(`/api/contracts/${physicalDraft.contract.id}/signed-file`, {
        method: "POST",
        body: form,
      });
      // Resposta sem JSON acontece de verdade: um 413 do proxy, ou a conexão
      // caindo no meio de um arquivo grande. `response.json()` cru estourava um
      // SyntaxError que virava "Falha ao enviar" sem dizer nada de útil.
      const data = (await response.json().catch(() => null)) as
        | { contract?: ContractSummary; error?: string }
        | null;
      if (!response.ok || !data?.contract) {
        throw new Error(
          data?.error ??
            (response.status === 413
              ? "O servidor recusou o arquivo por tamanho. Reduza a resolução da digitalização e tente de novo."
              : `Falha ao enviar o contrato assinado (erro ${response.status}).`)
        );
      }
      replaceContract(data.contract);
      setPhysicalDraft(null);
      setNotice("Via assinada no papel arquivada no contrato.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao enviar o contrato assinado.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Converte o arquivo escolhido em data URI para viajar junto do resto do
   * formulário — o mesmo PUT que salva CNPJ e endereço salva a assinatura, sem
   * rota de upload separada. O teto de 300 KB é folgado para uma assinatura e
   * evita empurrar um JPEG de câmera para dentro do JSONB.
   */
  function loadSignature(file: File | null): void {
    if (!file) return;
    if (file.size > 300_000) {
      setError("A imagem da assinatura passa de 300 KB. Recorte só o traço e tente de novo.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      setCompanyDraft((current) => (current ? { ...current, signatureImage: result } : current));
    };
    reader.onerror = () => setError("Não consegui ler esse arquivo de imagem.");
    reader.readAsDataURL(file);
  }

  async function saveCompany() {
    if (!companyDraft) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/contracts/company", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(companyDraft),
      });
      const data = (await response.json()) as { company?: ContractCompany; error?: string };
      if (!response.ok || !data.company) throw new Error(data.error ?? "Falha ao salvar os dados da escola.");
      setCompany(data.company);
      setMissing(
        [
          !data.company.name.trim() ? "razão social" : "",
          !data.company.cnpj.trim() ? "CNPJ" : "",
          !data.company.address.trim() ? "endereço" : "",
          !data.company.city.trim() ? "cidade" : "",
        ].filter(Boolean)
      );
      setCompanyDraft(null);
      setNotice("Dados da escola salvos. Contratos gerados a partir de agora já saem com eles.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao salvar os dados da escola.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-sm text-neutral-900 focus:border-cyan-400 focus:outline-none";
  const labelClass = "mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400";

  return (
    <main className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Contratos</h1>
          <p className="text-sm text-neutral-500">
            Via preenchida com os dados do cliente: assinatura eletrônica por link ou impressão, assinatura à
            mão e envio do PDF digitalizado.
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2 self-start">
            <button
              type="button"
              onClick={() => setNovoContrato({ pendency: null })}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700"
            >
              <FilePlus2 className="h-4 w-4" /> Novo contrato
            </button>
            {/* Caminho antigo, para a matrícula que já existe e só precisa do
                documento. O "Novo contrato" acima cria a matrícula junto. */}
            <button
              type="button"
              onClick={() => void abrirGeracao()}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 text-sm font-bold text-neutral-700 hover:bg-neutral-50"
            >
              <FileSignature className="h-4 w-4" /> Gerar de uma matrícula
            </button>
            <button
              type="button"
              onClick={() => setCompanyDraft({ ...company })}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 text-sm font-bold text-neutral-700 hover:bg-neutral-50"
            >
              <Building2 className="h-4 w-4" /> Dados da escola
            </button>
          </div>
        )}
      </header>

      {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
      {notice && (
        <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}{" "}
          <button type="button" className="font-bold underline" onClick={() => setNotice(null)}>
            ok
          </button>
        </p>
      )}

      {missing.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-amber-600" />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold text-amber-900">
                Falta cadastrar {missing.join(", ")} da escola
              </h2>
              <p className="mt-0.5 text-xs leading-relaxed text-amber-800">
                O contrato identifica a CONTRATADA por esses dados. Enquanto eles faltarem, o documento sai com
                lacunas e a página de assinatura bloqueia o aceite — ninguém assina um contrato incompleto.
              </p>
              {canManage && (
                <button
                  type="button"
                  onClick={() => setCompanyDraft({ ...company })}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-100"
                >
                  <Building2 className="h-3.5 w-3.5" /> Preencher agora
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard
          icon={Clock}
          tone="amber"
          label="Aguardando assinatura"
          value={String(totals.pendentes)}
          hint="Link gerado e ainda não assinado"
        />
        <SummaryCard
          icon={ShieldCheck}
          tone="teal"
          label="Assinados"
          value={String(totals.assinados)}
          hint="Eletrônicos ou digitalizados do papel"
        />
        <SummaryCard
          icon={AlertTriangle}
          tone={totals.desatualizados > 0 ? "amber" : "brand"}
          label="Venda mudou depois"
          value={String(totals.desatualizados)}
          hint="Assinados cuja matrícula foi corrigida"
        />
      </div>

      {/* A fila vem ANTES da lista de contratos de propósito: contrato que
          existe já está resolvido, e o que precisa de gente é o que ainda não
          virou contrato nenhum. */}
      <RegularizarPanel
        key={filaVersao}
        canManage={canManage}
        onCompletar={(pendency) => setNovoContrato({ pendency })}
        onChanged={() => void recarregarContratos()}
      />

      <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-neutral-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {(["pendente", "assinado", "cancelado", "todos"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setStatus(option)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                  status === option ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                }`}
              >
                {option === "todos" ? "Todos" : CONTRACT_STATUS_LABELS[option]}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nome, CPF ou treinamento"
            className="w-full rounded-lg border border-neutral-200 px-3 py-1.5 text-sm focus:border-cyan-400 focus:outline-none sm:w-72"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-400">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Signatário</th>
                <th className="px-4 py-2 text-left font-semibold">Treinamento</th>
                <th className="px-4 py-2 text-right font-semibold">Valor</th>
                <th className="px-4 py-2 text-center font-semibold">Situação</th>
                <th className="px-4 py-2 text-left font-semibold">Andamento</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-neutral-400">
                    Nenhum contrato nesta faixa. Contratos nascem quando a venda é registrada no CRM.
                  </td>
                </tr>
              ) : (
                visible.map((contract) => {
                  const whatsappUrl = contract.signerPhone
                    ? `${buildWhatsAppWebUrl(contract.signerPhone)}&text=${encodeURIComponent(
                        contractWhatsAppMessage({
                          signerName: contract.signerName,
                          courseName: contract.courseName ?? "VozUP",
                          link: linkFor(contract),
                          companyName: company.name,
                        })
                      )}`
                    : null;

                  return (
                    <tr key={contract.id} className={contract.status === "cancelado" ? "bg-neutral-50/60" : ""}>
                      <td className="px-4 py-3">
                        <p className="font-bold text-neutral-900">{contract.signerName}</p>
                        <p className="text-xs text-neutral-400">
                          {contract.signerCpf ? formatCpf(contract.signerCpf) : "CPF não cadastrado"}
                          {contract.signerRole === "responsavel" && contract.studentName
                            ? ` • responsável por ${contract.studentName}`
                            : ""}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-neutral-700">{contract.courseName ?? "—"}</td>
                      <td className="px-4 py-3 text-right font-semibold text-neutral-900">
                        {formatMoney(contract.amount)}
                        {divergesFromSale(contract) && (
                          <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600">
                            venda: {formatMoney(contract.saleAmount ?? 0)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS_STYLE[contract.status]}`}
                        >
                          {CONTRACT_STATUS_LABELS[contract.status]}
                        </span>
                        {contract.outdated && (
                          <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-amber-600">
                            venda mudou depois
                          </p>
                        )}
                        {contract.status === "pendente" && contract.missingFields.length > 0 && (
                          <p className="mt-1 text-[10px] font-semibold leading-tight text-rose-600">
                            falta {contract.missingFields.join(", ")}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-neutral-500">
                        {contract.status === "assinado" ? (
                          <>
                            <span className="flex items-center gap-1 font-semibold text-emerald-700">
                              <CheckCircle2 className="h-3.5 w-3.5" /> {formatDateTime(contract.signedAt)}
                            </span>
                            <span>
                              {contract.signatureKind === "papel"
                                ? "Assinado no papel e digitalizado"
                                : contract.cpfVerified
                                  ? "Assinatura eletrônica • CPF conferido"
                                  : "Assinatura eletrônica • CPF declarado no ato"}
                            </span>
                          </>
                        ) : contract.status === "cancelado" ? (
                          <span>{contract.canceledReason ?? "Cancelado"}</span>
                        ) : contract.firstOpenedAt ? (
                          <span>Aberto em {formatDateTime(contract.firstOpenedAt)}</span>
                        ) : (
                          <span>Ainda não aberto pelo aluno</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {contract.status === "pendente" && (
                            <>
                              <ActionButton icon={Copy} label="Copiar link" onClick={() => copyLink(contract)} />
                              {whatsappUrl && (
                                <a
                                  href={whatsappUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(event) => openWhatsAppOnMobile(event, contract.signerPhone)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                                >
                                  <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                                </a>
                              )}
                              {canManage && (
                                <ActionButton
                                  icon={Pencil}
                                  label="Dados"
                                  onClick={() => setDataDraft(draftFromContract(contract))}
                                />
                              )}
                            </>
                          )}
                          <a
                            href={
                              contract.status === "pendente"
                                ? `/api/contracts/${contract.id}/pdf?via=impressao`
                                : `/api/contracts/${contract.id}/pdf`
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-bold text-neutral-600 hover:bg-neutral-50"
                          >
                            <Download className="h-3.5 w-3.5" />
                            {contract.status === "pendente" ? "PDF para imprimir" : "Baixar assinado"}
                          </a>
                          {canManage && contract.status === "pendente" && (
                            <ActionButton
                              icon={Upload}
                              label="Enviar assinado"
                              onClick={() => setPhysicalDraft({ contract, file: null })}
                            />
                          )}
                          <ActionButton icon={FileSignature} label="Detalhes" onClick={() => openDetail(contract)} />
                          {canManage && contract.status === "pendente" && (
                            <>
                              <ActionButton
                                icon={Link2}
                                label="Novo link"
                                disabled={busy === contract.id}
                                onClick={() =>
                                  patchContract(contract.id, { action: "reissue" }, "Link novo gerado — o anterior parou de valer.")
                                }
                              />
                              <ActionButton
                                icon={Ban}
                                label="Cancelar"
                                tone="danger"
                                disabled={busy === contract.id}
                                onClick={() => {
                                  const reason = window.prompt("Motivo do cancelamento deste contrato:");
                                  if (reason && reason.trim()) {
                                    void patchContract(contract.id, { action: "cancel", reason }, "Contrato cancelado.");
                                  }
                                }}
                              />
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {detail && (
        <Modal title={`Contrato nº ${detail.contract.id}`} onClose={() => setDetail(null)} error={error}>
          <div className="space-y-4">
            {detail.contract.status === "pendente" && detail.contract.missingFields.length > 0 && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                Ainda não dá para assinar: falta {detail.contract.missingFields.join(", ")}.
              </p>
            )}
            {divergesFromSale(detail.contract) && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                O plano do contrato soma {formatMoney(detail.contract.amount)}, mas a matrícula no Financeiro
                está em {formatMoney(detail.contract.saleAmount ?? 0)}. Confira antes de mandar assinar.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Signatário" value={detail.contract.signerName} />
              <Field label="Papel" value={SIGNER_ROLE_LABELS[detail.contract.signerRole]} />
              <Field label="CPF" value={formatCpf(detail.contract.signerCpf)} />
              <Field label="Treinamento" value={detail.contract.courseName ?? "—"} />
              <Field label="Valor" value={formatMoney(detail.contract.amount)} />
              <Field label="Gerado por" value={detail.contract.createdByName ?? "—"} />
              {detail.contract.status === "assinado" && (
                <>
                  <Field label="Assinado em" value={formatDateTime(detail.contract.signedAt)} />
                  <Field
                    label="Forma de assinatura"
                    value={
                      detail.contract.signatureKind === "papel"
                        ? "Papel, depois digitalizado"
                        : "Eletrônica pelo link"
                    }
                  />
                  {detail.contract.signatureKind !== "papel" && (
                    <Field
                      label="Conferência do CPF"
                      value={detail.contract.cpfVerified ? "Bateu com o cadastro" : "Declarado no ato"}
                    />
                  )}
                  <Field
                    label="Hash do arquivo (SHA-256)"
                    value={detail.contract.signedFileHash ?? "—"}
                    mono
                    wide
                  />
                </>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-400">
                Trilha de evidências
              </h3>
              <ol className="space-y-2">
                {detail.events.map((event) => (
                  <li key={event.id} className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-neutral-800">
                        {EVENT_LABELS[event.type] ?? event.type}
                      </span>
                      <span className="text-xs text-neutral-500">{formatDateTime(event.at)}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {[
                        event.actorName,
                        event.ip ? `IP ${event.ip}` : null,
                        event.userAgent ? event.userAgent.slice(0, 80) : null,
                      ]
                        .filter(Boolean)
                        .join(" • ") || "—"}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Modal>
      )}

{dataDraft && (
        <Modal title="Quadro de resumo do contrato" onClose={() => setDataDraft(null)} error={error}>
          <div className="space-y-4">
            <p className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
              É o que sai impresso na primeira página. O CPF de quem assina também é usado para conferir a
              assinatura eletrônica pelo link.
            </p>

            <section className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-400">Aluno(a)</h3>
              <StudentFields
                student={dataDraft.student}
                onChange={setStudent}
                labelClass={labelClass}
                inputClass={inputClass}
              />
            </section>

            {/* ── ALUNOS ADICIONAIS ────────────────────────────
                Contrato de casal: quem entra junto tem quadro próprio no item
                2, treinamento no item 3 e valor no item 4. Quem assina continua
                sendo um só — o pagador. */}
            <section className="space-y-3 border-t border-neutral-100 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-400">
                  Outras pessoas no contrato
                </h3>
                <button
                  type="button"
                  onClick={() =>
                    setDataDraft((current) =>
                      current
                        ? {
                            ...current,
                            coStudents: [
                              ...current.coStudents,
                              {
                                student: { ...EMPTY_CONTRACT_STUDENT },
                                course: { name: current.course.name, hours: current.course.hours, className: null },
                                amount: 0,
                                amountText: "",
                              },
                            ],
                          }
                        : current
                    )
                  }
                  className="rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50"
                >
                  Adicionar pessoa
                </button>
              </div>
              {dataDraft.coStudents.length === 0 ? (
                <p className="text-[11px] text-neutral-400">
                  Só o aluno acima está neste contrato.
                </p>
              ) : (
                dataDraft.coStudents.map((co, index) => (
                  <div key={index} className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/30 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-violet-700">
                        {index + 2}º aluno
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          setDataDraft((current) =>
                            current
                              ? { ...current, coStudents: current.coStudents.filter((_, i) => i !== index) }
                              : current
                          )
                        }
                        className="text-[11px] font-semibold text-rose-600 hover:underline"
                      >
                        Remover do contrato
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2">
                        <label className={labelClass}>Curso deste aluno</label>
                        <input
                          value={co.course.name}
                          onChange={(event) => setCoStudent(index, { course: { ...co.course, name: event.target.value } })}
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Valor (R$)</label>
                        <input
                          inputMode="decimal"
                          value={co.amountText}
                          onChange={(event) => setCoStudent(index, { amountText: event.target.value })}
                          className={inputClass}
                        />
                      </div>
                      <div className="col-span-2">
                        <label className={labelClass}>Carga horária</label>
                        <input
                          value={co.course.hours ?? ""}
                          onChange={(event) => setCoStudent(index, { course: { ...co.course, hours: event.target.value } })}
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Turma</label>
                        <input
                          value={co.course.className ?? ""}
                          onChange={(event) =>
                            setCoStudent(index, { course: { ...co.course, className: event.target.value } })
                          }
                          className={inputClass}
                        />
                      </div>
                    </div>

                    <StudentFields
                      student={co.student}
                      onChange={(patch) => setCoStudent(index, { student: { ...co.student, ...patch } })}
                      labelClass={labelClass}
                      inputClass={inputClass}
                    />
                  </div>
                ))
              )}
              <p className="text-[11px] text-neutral-400">
                O valor de cada pessoa aparece no item 4, uma linha por aluno. O total do contrato é
                o plano financeiro lá embaixo — mudar aqui não muda a cobrança no Financeiro, que
                vem da venda.
              </p>
            </section>

            <section className="space-y-3 border-t border-neutral-100 pt-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-400">Quem assina</h3>
              <div>
                <label className={labelClass}>Papel</label>
                <select
                  value={dataDraft.signer.role}
                  onChange={(event) =>
                    setSigner({ role: event.target.value as ContractSigner["role"] })
                  }
                  className={inputClass}
                >
                  <option value="aluno">{SIGNER_ROLE_LABELS.aluno}</option>
                  <option value="responsavel">{SIGNER_ROLE_LABELS.responsavel}</option>
                </select>
              </div>
              {dataDraft.signer.role === "aluno" ? (
                <p className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
                  O próprio aluno assina — nome, CPF, e-mail e telefone saem dos dados acima.
                </p>
              ) : (
                <>
                  <div>
                    <label className={labelClass}>Nome do responsável</label>
                    <input
                      value={dataDraft.signer.name}
                      onChange={(event) => setSigner({ name: event.target.value })}
                      className={inputClass}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>CPF do responsável</label>
                      <input
                        value={dataDraft.signer.cpf ?? ""}
                        onChange={(event) => setSigner({ cpf: event.target.value })}
                        className={inputClass}
                        inputMode="numeric"
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Telefone</label>
                      <input
                        value={dataDraft.signer.phone ?? ""}
                        onChange={(event) => setSigner({ phone: event.target.value })}
                        className={inputClass}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>E-mail</label>
                    <input
                      value={dataDraft.signer.email ?? ""}
                      onChange={(event) => setSigner({ email: event.target.value })}
                      className={inputClass}
                    />
                  </div>
                </>
              )}
            </section>

            <section className="space-y-3 border-t border-neutral-100 pt-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-400">
                Curso / treinamento
              </h3>
              <div>
                <label className={labelClass}>Nome do curso</label>
                <input
                  value={dataDraft.course.name}
                  onChange={(event) => setCourse({ name: event.target.value })}
                  className={inputClass}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Carga horária</label>
                  <input
                    value={dataDraft.course.hours ?? ""}
                    onChange={(event) => setCourse({ hours: event.target.value })}
                    placeholder="48 horas"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Turma</label>
                  <input
                    value={dataDraft.course.className ?? ""}
                    onChange={(event) => setCourse({ className: event.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>
            </section>

            <section className="space-y-2 border-t border-neutral-100 pt-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-400">
                Observações / aditivo
              </h3>
              <p className="text-[11px] text-neutral-400">
                Sai impresso no item 5 do contrato. Vem do campo Observações da venda; o que for
                escrito aqui vale a partir da próxima emissão do PDF.
              </p>
              <textarea
                value={dataDraft.notes}
                onChange={(event) =>
                  setDataDraft((current) => (current ? { ...current, notes: event.target.value } : current))
                }
                rows={3}
                placeholder="Ex.: entrada de R$ 1.000 no Pix em 01/07; turma remarcada para agosto."
                className={inputClass}
              />
            </section>

            <section className="space-y-2 border-t border-neutral-100 pt-4">
              <div className="flex items-baseline justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-400">
                  Plano financeiro
                </h3>
                <span className="text-xs font-bold text-neutral-700">
                  Total {formatMoney(draftPlanTotal(dataDraft.plan))}
                </span>
              </div>
              <p className="text-[11px] text-neutral-400">
                O contrato nasce com tudo em CURSO. Separe matrícula e material se foi assim que a venda
                foi combinada — a soma é que vale.
              </p>
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
                <strong>Isto reescreve a cobrança.</strong> Salvar refaz as parcelas da matrícula no
                Financeiro com o valor, o nº de parcelas, a forma e o 1º vencimento da linha{" "}
                <strong>CURSO</strong> (matrícula, material e entrada viram o que é pago no ato).
                Matrícula que já tem pagamento registrado é recusada — nesse caso, corrija em Matrículas.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-neutral-400">
                      <th className="pb-1 text-left font-semibold">Item</th>
                      <th className="pb-1 text-left font-semibold">Valor</th>
                      <th className="pb-1 text-left font-semibold">Parcelas</th>
                      <th className="pb-1 text-left font-semibold">Forma</th>
                      <th className="pb-1 text-left font-semibold">1º venc.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dataDraft.plan.map((row, index) => (
                      <tr key={row.key}>
                        <td className="py-1 pr-2 text-xs font-semibold text-neutral-600">{row.label}</td>
                        <td className="py-1 pr-2">
                          <input
                            value={row.amount}
                            onChange={(event) => setPlanRow(index, { amount: event.target.value })}
                            inputMode="decimal"
                            placeholder="0,00"
                            className={inputClass}
                          />
                        </td>
                        <td className="py-1 pr-2">
                          <select
                            value={row.installments}
                            onChange={(event) => setPlanRow(index, { installments: event.target.value })}
                            className={inputClass}
                          >
                            {enrollmentInstallmentOptions(methodOf(row.paymentMethod)?.maxInstallments).map(
                              (option) => (
                                <option key={option} value={option}>
                                  {option}x
                                </option>
                              )
                            )}
                          </select>
                        </td>
                        <td className="py-1 pr-2">
                          {paymentMethods.length > 0 ? (
                            <select
                              value={row.paymentMethod}
                              onChange={(event) => {
                                // Forma de teto menor não pode deixar para trás um
                                // nº de parcelas que o Financeiro vai recusar.
                                const cap = installmentCap(methodOf(event.target.value)?.maxInstallments);
                                setPlanRow(index, {
                                  paymentMethod: event.target.value,
                                  installments: String(Math.min(parseCount(row.installments), cap)),
                                });
                              }}
                              className={inputClass}
                            >
                              <option value="">—</option>
                              {/* A forma gravada antes pode não estar mais no cadastro
                                  (renomeada, desativada): ela continua aparecendo para
                                  não sumir do contrato sem ninguém mandar. */}
                              {!paymentMethods.some((method) => method.name === row.paymentMethod) &&
                              row.paymentMethod ? (
                                <option value={row.paymentMethod}>{row.paymentMethod}</option>
                              ) : null}
                              {paymentMethods.map((method) => (
                                <option key={method.id} value={method.name}>
                                  {method.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              value={row.paymentMethod}
                              onChange={(event) => setPlanRow(index, { paymentMethod: event.target.value })}
                              className={inputClass}
                            />
                          )}
                        </td>
                        <td className="py-1">
                          <input
                            type="date"
                            value={row.firstDueDate}
                            onChange={(event) => setPlanRow(index, { firstDueDate: event.target.value })}
                            className={inputClass}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {dataDraft.charge ? (
                <div className="space-y-2 rounded-xl border border-neutral-200 p-3">
                  <h4 className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">
                    Cobrança da matrícula
                  </h4>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <label className={labelClass}>Data da venda</label>
                      <input
                        type="date"
                        value={dataDraft.charge.saleDate}
                        onChange={(event) => setCharge({ saleDate: event.target.value })}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Vendedor</label>
                      <select
                        value={dataDraft.charge.sellerId}
                        onChange={(event) => setCharge({ sellerId: event.target.value })}
                        className={inputClass}
                      >
                        <option value="">—</option>
                        {offCatalogOption(chargeCatalog?.sellers, dataDraft.charge.sellerId, dataDraft.charge.sellerName)}
                        {(chargeCatalog?.sellers ?? []).map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Unidade</label>
                      <select
                        value={dataDraft.charge.branchId}
                        onChange={(event) => setCharge({ branchId: event.target.value })}
                        className={inputClass}
                      >
                        <option value="">—</option>
                        {offCatalogOption(chargeCatalog?.branches, dataDraft.charge.branchId, dataDraft.charge.branchName)}
                        {(chargeCatalog?.branches ?? []).map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    {/* Bandeira só aparece em forma parcelada: é ela que escolhe
                        a taxa da maquininha. No Pix não significa nada. */}
                    {methodOf(planRowValue("curso"))?.kind === "parcelado" ? (
                      <div>
                        <label className={labelClass}>Bandeira</label>
                        <select
                          value={dataDraft.charge.cardBrandId}
                          onChange={(event) => setCharge({ cardBrandId: event.target.value })}
                          className={inputClass}
                        >
                          <option value="">Taxa padrão</option>
                          {offCatalogOption(
                            chargeCatalog?.cardBrands,
                            dataDraft.charge.cardBrandId,
                            dataDraft.charge.cardBrandName
                          )}
                          {(chargeCatalog?.cardBrands ?? []).map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                  </div>
                  {dataDraft.charge.paymentCount > 0 ? (
                    <p className="rounded-lg bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-900">
                      Esta matrícula já tem <strong>{dataDraft.charge.paymentCount}</strong> pagamento(s)
                      registrado(s): o Financeiro vai recusar a alteração. Renegociação de saldo é feita em
                      Matrículas, que protege as parcelas já recebidas.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDataDraft(null)}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-neutral-500 hover:bg-neutral-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={saveContractData}
                disabled={saving}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-bold text-white hover:bg-neutral-800 disabled:opacity-60"
              >
                Salvar
              </button>
            </div>
          </div>
        </Modal>
      )}

      
      {physicalDraft && (
        <Modal title="Enviar contrato assinado no papel" onClose={() => setPhysicalDraft(null)} error={error}>
          <div className="space-y-4">
            <p className="rounded-lg bg-cyan-50 px-3 py-2 text-sm leading-relaxed text-cyan-900">
              Baixe a via de impressão (com as linhas de assinatura e testemunhas), imprima, colha a assinatura
              do cliente e digitalize todas as páginas. Pode ser um PDF ou fotos nítidas da folha. Ao enviar, essa
              via será arquivada como o documento assinado do contrato nº {physicalDraft.contract.id}.
            </p>
            <a
              href={`/api/contracts/${physicalDraft.contract.id}/pdf?via=impressao`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-bold text-neutral-700 hover:bg-neutral-50"
            >
              <Download className="h-4 w-4" /> Baixar via de impressão
            </a>
            <div>
              <label htmlFor="physical-contract-file" className={labelClass}>
                Arquivo digitalizado — PDF, JPG, PNG ou WEBP (máximo{" "}
                {Math.round(SCANNED_UPLOAD_MAX_BYTES / 1024 / 1024)} MB)
              </label>
              <input
                id="physical-contract-file"
                type="file"
                accept="application/pdf,.pdf,image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  const escolhido = event.target.files?.[0] ?? null;
                  // Conferido aqui, e não só no servidor: subir 25 MB para
                  // receber "passou do limite" gasta o tempo de quem espera e,
                  // numa conexão ruim, nem chega a completar.
                  if (escolhido && escolhido.size > SCANNED_UPLOAD_MAX_BYTES) {
                    setError(
                      `“${escolhido.name}” tem ${(escolhido.size / 1024 / 1024).toFixed(1)} MB e o limite é ${Math.round(
                        SCANNED_UPLOAD_MAX_BYTES / 1024 / 1024
                      )} MB. Digitalize em preto e branco ou em 200 dpi e o arquivo cabe.`
                    );
                    setPhysicalDraft({ ...physicalDraft, file: null });
                    event.target.value = "";
                    return;
                  }
                  setError(null);
                  setPhysicalDraft({ ...physicalDraft, file: escolhido });
                }}
                className="block w-full rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-3 py-5 text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-900 file:px-3 file:py-2 file:text-xs file:font-bold file:text-white"
              />
            </div>
            {physicalDraft.file && (
              <p className="text-xs text-neutral-500">
                {physicalDraft.file.name} • {(physicalDraft.file.size / 1024 / 1024).toFixed(1)} MB
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPhysicalDraft(null)}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-neutral-500 hover:bg-neutral-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={uploadPhysicalContract}
                disabled={saving || !physicalDraft.file}
                className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-bold text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                <Upload className="h-4 w-4" /> {saving ? "Enviando..." : "Arquivar como assinado"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {novoContrato && (
        <NovoContratoModal
          pendency={novoContrato.pendency}
          onClose={() => setNovoContrato(null)}
          onSaved={(message) => {
            setNovoContrato(null);
            setNotice(message);
            setFilaVersao((current) => current + 1);
            void recarregarContratos();
          }}
        />
      )}

      {gerando && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-neutral-950/40 p-0 sm:items-center sm:p-6">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-neutral-900">Gerar contrato</h2>
                <p className="text-xs text-neutral-500">
                  Escolha a matrícula e confira os valores antes de gerar.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setGerando(null)}
                className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {gerando.carregando ? (
              <p className="text-sm text-neutral-500">Carregando matrículas…</p>
            ) : gerando.matriculas.length === 0 ? (
              <p className="rounded-xl bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
                Todas as matrículas já têm contrato.
              </p>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-[11px] font-bold uppercase text-neutral-500">Matrícula</label>
                  <select
                    value={gerando.escolhida?.enrollmentId ?? ""}
                    onChange={(event) => {
                      const escolhida =
                        gerando.matriculas.find(
                          (item) => String(item.enrollmentId) === event.target.value
                        ) ?? null;
                      // O padrão é o que JÁ foi combinado na venda. Sem rateio
                      // combinado (venda antiga ou lançada fora do modal), o
                      // padrão é o valor da matrícula inteiro em curso. Nos dois
                      // casos o total começa igual ao da matrícula — e os três
                      // campos continuam editáveis.
                      const padrao = escolhida?.planSplit ?? {
                        matricula: 0,
                        material: 0,
                        curso: escolhida?.amount ?? 0,
                      };
                      setGerando({
                        ...gerando,
                        escolhida,
                        matricula: escolhida ? valorParaCampo(padrao.matricula) : "",
                        material: escolhida ? valorParaCampo(padrao.material) : "",
                        curso: escolhida ? valorParaCampo(padrao.curso) : "",
                      });
                    }}
                    className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                  >
                    <option value="">Escolha…</option>
                    {gerando.matriculas.map((item) => (
                      <option key={item.enrollmentId} value={item.enrollmentId}>
                        {item.student} · {item.courseName ?? "sem curso"} · {formatMoney(item.amount)}
                      </option>
                    ))}
                  </select>
                </div>

                {gerando.escolhida && (
                  <>
                    <div>
                      <p className="text-[11px] font-bold uppercase text-neutral-500">
                        Valores do contrato (item 4)
                      </p>
                      <div className="mt-1 grid grid-cols-3 gap-2">
                        {(
                          [
                            ["matricula", "Matrícula"],
                            ["material", "Material"],
                            ["curso", "Curso"],
                          ] as const
                        ).map(([campo, rotulo]) => (
                          <div key={campo}>
                            <label className="text-[10px] font-semibold text-neutral-500">{rotulo}</label>
                            <input
                              value={gerando[campo]}
                              onChange={(event) =>
                                setGerando({ ...gerando, [campo]: event.target.value })
                              }
                              inputMode="decimal"
                              placeholder="0,00"
                              className="mt-1 w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm"
                            />
                          </div>
                        ))}
                      </div>
                      <p className="mt-1.5 text-[11px] text-neutral-500">
                        Total do contrato{" "}
                        <strong className="text-neutral-800">
                          {formatMoney(
                            parseDecimal(gerando.matricula) +
                              parseDecimal(gerando.material) +
                              parseDecimal(gerando.curso)
                          )}
                        </strong>{" "}
                        · valor da matrícula {formatMoney(gerando.escolhida.amount)}
                      </p>
                      {(() => {
                        const aviso = describePlanSplitDivergence(
                          {
                            matricula: parseDecimal(gerando.matricula),
                            material: parseDecimal(gerando.material),
                            curso: parseDecimal(gerando.curso),
                          },
                          gerando.escolhida.amount
                        );
                        return aviso ? (
                          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
                            {aviso}
                          </p>
                        ) : null;
                      })()}
                    </div>

                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setGerando(null)}
                        className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => void confirmarGeracao()}
                        disabled={saving}
                        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {saving ? "Gerando…" : "Gerar contrato"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {companyDraft && (
        <Modal title="Dados da escola no contrato" onClose={() => setCompanyDraft(null)} error={error}>
          <div className="space-y-3">
            <p className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
              É a identificação da CONTRATADA. Vale para os contratos gerados a partir de agora; os já emitidos
              guardam o texto do dia em que nasceram.
            </p>
            <div>
              <label className={labelClass}>Razão social</label>
              <input
                value={companyDraft.name}
                onChange={(event) => setCompanyDraft({ ...companyDraft, name: event.target.value })}
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>CNPJ</label>
                <input
                  value={companyDraft.cnpj}
                  onChange={(event) => setCompanyDraft({ ...companyDraft, cnpj: event.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>CEP</label>
                <input
                  value={companyDraft.zip}
                  onChange={(event) => setCompanyDraft({ ...companyDraft, zip: event.target.value })}
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label className={labelClass}>Endereço</label>
              <input
                value={companyDraft.address}
                onChange={(event) => setCompanyDraft({ ...companyDraft, address: event.target.value })}
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className={labelClass}>Cidade</label>
                <input
                  value={companyDraft.city}
                  onChange={(event) => setCompanyDraft({ ...companyDraft, city: event.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>UF</label>
                <input
                  value={companyDraft.state}
                  onChange={(event) => setCompanyDraft({ ...companyDraft, state: event.target.value })}
                  className={inputClass}
                  maxLength={2}
                />
              </div>
            </div>
            <div>
              <label className={labelClass}>Comarca do foro (se diferente da cidade)</label>
              <input
                value={companyDraft.forum}
                onChange={(event) => setCompanyDraft({ ...companyDraft, forum: event.target.value })}
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>E-mail de contato</label>
                <input
                  value={companyDraft.email}
                  onChange={(event) => setCompanyDraft({ ...companyDraft, email: event.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Telefone</label>
                <input
                  value={companyDraft.phone}
                  onChange={(event) => setCompanyDraft({ ...companyDraft, phone: event.target.value })}
                  className={inputClass}
                />
              </div>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
                Quem assina pela escola
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-neutral-500">
                Aparece no fecho do contrato, do lado da CONTRATADA. A assinatura entra em todo
                contrato novo, na via digital e na impressa.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Nome do representante</label>
                  <input
                    value={companyDraft.representativeName}
                    onChange={(event) =>
                      setCompanyDraft({ ...companyDraft, representativeName: event.target.value })
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Cargo</label>
                  <input
                    value={companyDraft.representativeRole}
                    onChange={(event) =>
                      setCompanyDraft({ ...companyDraft, representativeRole: event.target.value })
                    }
                    className={inputClass}
                    placeholder="CEO"
                  />
                </div>
              </div>
              <div className="mt-3">
                <label className={labelClass}>Assinatura (PNG ou JPG)</label>
                {companyDraft.signatureImage ? (
                  <div className="mt-1 flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={companyDraft.signatureImage}
                      alt="Assinatura do representante"
                      className="h-14 rounded-lg border border-neutral-200 bg-white px-2"
                    />
                    <button
                      type="button"
                      onClick={() => setCompanyDraft({ ...companyDraft, signatureImage: "" })}
                      className="rounded-lg px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      Remover
                    </button>
                  </div>
                ) : (
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={(event) => loadSignature(event.target.files?.[0] ?? null)}
                    className="mt-1 w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
                  />
                )}
                <p className="mt-1 text-[11px] text-neutral-400">
                  Fundo transparente ou branco, traço escuro. Sem imagem, a linha da CONTRATADA sai
                  em branco para assinar à caneta.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setCompanyDraft(null)}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-neutral-500 hover:bg-neutral-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={saveCompany}
                disabled={saving}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-bold text-white hover:bg-neutral-800 disabled:opacity-60"
              >
                Salvar
              </button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  tone,
}: {
  icon: typeof Copy;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold disabled:opacity-50 ${
        tone === "danger"
          ? "border-rose-200 text-rose-600 hover:bg-rose-50"
          : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
      }`}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

function Field({
  label,
  value,
  mono,
  wide,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{label}</p>
      <p className={`text-sm text-neutral-800 ${mono ? "break-all font-mono text-xs" : ""}`}>{value}</p>
    </div>
  );
}

/**
 * O `error` é mostrado AQUI DENTRO, e não só na faixa do topo da página.
 *
 * A faixa fica atrás do `fixed inset-0` do modal e fora da rolagem: o upload de
 * um arquivo grande respondia "o arquivo pode ter no máximo X MB", a mensagem
 * era gravada no estado e ninguém via nada — o botão voltava de "Enviando..."
 * para o normal e o modal continuava aberto, como se o clique não tivesse
 * acontecido. Erro que a pessoa não lê é erro que não existe.
 */
function Modal({
  title,
  children,
  onClose,
  error,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  error?: string | null;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4">
      <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-neutral-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar janela"
            className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {error && (
          <p role="alert" className="mb-3 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {error}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}

function SummaryCard({
  icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: typeof Clock;
  tone: IconTileTone;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <IconTile icon={icon} tone={tone} />
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{label}</p>
        <p className="text-xl font-bold text-neutral-900">{value}</p>
        <p className="text-xs text-neutral-400">{hint}</p>
      </div>
    </div>
  );
}

/**
 * Os quatorze campos do quadro de um aluno. Existe como componente porque o
 * contrato de casal repete o mesmo formulário para cada pessoa que entra
 * junto — duas cópias divergiriam no primeiro campo novo.
 */
function StudentFields({
  student,
  onChange,
  labelClass,
  inputClass,
}: {
  student: ContractStudent;
  onChange: (patch: Partial<ContractStudent>) => void;
  labelClass: string;
  inputClass: string;
}) {
  return (
    <>
      <div>
        <label className={labelClass}>Nome completo</label>
        <input
          value={student.name}
          onChange={(event) => onChange({ name: event.target.value })}
          className={inputClass}
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelClass}>RG</label>
          <input
            value={student.rg ?? ""}
            onChange={(event) => onChange({ rg: event.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>CPF</label>
          <input
            value={student.cpf ?? ""}
            onChange={(event) => onChange({ cpf: event.target.value })}
            className={inputClass}
            inputMode="numeric"
          />
        </div>
        <div>
          <label className={labelClass}>Nascimento</label>
          <input
            type="date"
            value={student.birthDate ?? ""}
            onChange={(event) => onChange({ birthDate: event.target.value })}
            className={inputClass}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Profissão</label>
          <input
            value={student.profession ?? ""}
            onChange={(event) => onChange({ profession: event.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Empresa</label>
          <input
            value={student.company ?? ""}
            onChange={(event) => onChange({ company: event.target.value })}
            className={inputClass}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Celular</label>
          <input
            value={student.mobile ?? ""}
            onChange={(event) => onChange({ mobile: event.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Telefone fixo</label>
          <input
            value={student.phone ?? ""}
            onChange={(event) => onChange({ phone: event.target.value })}
            className={inputClass}
          />
        </div>
      </div>
      <div>
        <label className={labelClass}>E-mail</label>
        <input
          value={student.email ?? ""}
          onChange={(event) => onChange({ email: event.target.value })}
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>Endereço</label>
        <input
          value={student.address ?? ""}
          onChange={(event) => onChange({ address: event.target.value })}
          className={inputClass}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Bairro</label>
          <input
            value={student.neighborhood ?? ""}
            onChange={(event) => onChange({ neighborhood: event.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Cidade</label>
          <input
            value={student.city ?? ""}
            onChange={(event) => onChange({ city: event.target.value })}
            className={inputClass}
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelClass}>UF</label>
          <input
            value={student.state ?? ""}
            onChange={(event) => onChange({ state: event.target.value.toUpperCase() })}
            maxLength={2}
            className={inputClass}
          />
        </div>
        <div className="col-span-2">
          <label className={labelClass}>CEP</label>
          <input
            value={student.zip ?? ""}
            onChange={(event) => onChange({ zip: event.target.value })}
            className={inputClass}
          />
        </div>
      </div>
    </>
  );
}
