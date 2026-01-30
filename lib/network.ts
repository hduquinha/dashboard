import { listAllInscricoes } from "@/lib/db";
import {
  listRecruiters,
  normalizeRecruiterCode,
  isPlaceholderName,
  type Recruiter,
} from "@/lib/recruiters";
import type { InscricaoItem } from "@/types/inscricao";

export interface NetworkNode {
  id: number;
  displayName: string;
  code: string | null;
  tipo: "recrutador" | "lead";
  isVirtual: boolean;
  parentNodeId: number | null;
  parentCode: string | null;
  recrutadorCodigo: string | null;
  recrutadorNome: string | null;
  telefone: string | null;
  cidade: string | null;
  nivel: number | null;
  recrutadorUrl: string | null;
  totalDescendants: number;
  leadDescendants: number;
  recruiterDescendants: number;
  directLeadCount: number;
  directRecruiterCount: number;
  children: NetworkNode[];
}

export interface NetworkTreeStats {
  total: number;
  leads: number;
  recruiters: number;
  virtualRecruiters: number;
  orphans: number;
}

export interface NetworkTreeFocus {
  code: string | null;
  name: string | null;
  nodeId: number | null;
  path: number[];
}

export interface NetworkTreeResult {
  roots: NetworkNode[];
  orphans: NetworkNode[];
  stats: NetworkTreeStats;
  focus: NetworkTreeFocus | null;
}

interface BuildNetworkTreeOptions {
  focus?: string | null;
}

function createVirtualRecruiterInscricao(recruiter: Recruiter, normalizedCode: string): InscricaoItem {
  const codeNumber = Number.parseInt(normalizedCode, 10);
  const generatedId = Number.isFinite(codeNumber) ? -1000 - codeNumber : -1000;
  // Se o nome é placeholder, usar "Cluster {código}" em vez de "Recrutador XX"
  const displayName = isPlaceholderName(recruiter.name) ? `Cluster ${normalizedCode}` : recruiter.name;
  const parsedPayload = {
    nome: displayName,
    tipo: "recrutador",
    codigoRecrutador: normalizedCode,
    isRecruiter: "true",
  };
  const payload: Record<string, unknown> = { ...parsedPayload };

  return {
    id: generatedId,
    criadoEm: new Date("1990-01-01T00:00:00.000Z").toISOString(),
    payload,
    parsedPayload,
    nome: displayName,
    telefone: null,
    cidade: null,
    profissao: null,
    recrutadorCodigo: null,
    recrutadorNome: null,
    recrutadorUrl: recruiter.url,
    treinamentoId: null,
    treinamentoNome: null,
    treinamentoData: null,
    tipo: "recrutador",
    codigoProprio: normalizedCode,
    parentInscricaoId: null,
    nivel: 0,
    isVirtual: true,
  };
}

function inferDisplayName(inscricao: InscricaoItem, fallback: string): string {
  if (inscricao.nome && inscricao.nome.trim().length > 0) {
    return inscricao.nome.trim();
  }
  if (inscricao.codigoProprio) {
    return `Cluster ${inscricao.codigoProprio}`;
  }
  if (inscricao.recrutadorCodigo) {
    return `${fallback} (${inscricao.recrutadorCodigo})`;
  }
  return fallback;
}

function augmentInscricao(
  inscricao: InscricaoItem,
  recruiterByName: Map<string, { recruiter: Recruiter; code: string }>
): InscricaoItem {
  const clone: InscricaoItem = { ...inscricao };

  const ownCodeRaw = clone.codigoProprio ?? clone.parsedPayload.codigoRecrutador;
  let normalizedOwnCode =
    typeof ownCodeRaw === "string" || typeof ownCodeRaw === "number"
      ? normalizeRecruiterCode(String(ownCodeRaw))
      : null;

  if (!normalizedOwnCode && clone.nome) {
    const match = recruiterByName.get(clone.nome.trim().toLowerCase());
    if (match) {
      normalizedOwnCode = match.code;
    }
  }

  if (!normalizedOwnCode && typeof clone.id === "number" && clone.id < 0) {
    normalizedOwnCode = normalizeRecruiterCode(clone.recrutadorCodigo ?? undefined);
  }

  if (normalizedOwnCode) {
    clone.codigoProprio = normalizedOwnCode;
  }

  const inferedTipo = clone.tipo ?? (clone.codigoProprio ? "recrutador" : "lead");
  clone.tipo = inferedTipo;

  return clone;
}

function toNetworkNode(inscricao: InscricaoItem): NetworkNode {
  const displayName = inferDisplayName(inscricao, `Inscrição ${inscricao.id}`);
  return {
    id: inscricao.id,
    displayName,
    code: inscricao.codigoProprio ?? null,
    tipo: inscricao.tipo === "recrutador" ? "recrutador" : "lead",
    isVirtual: Boolean(inscricao.isVirtual),
    parentNodeId: inscricao.parentInscricaoId ?? null,
    parentCode: inscricao.recrutadorCodigo,
    recrutadorCodigo: inscricao.recrutadorCodigo,
    recrutadorNome: inscricao.recrutadorNome,
    telefone: inscricao.telefone,
    cidade: inscricao.cidade,
    nivel: inscricao.nivel ?? null,
    recrutadorUrl: inscricao.recrutadorUrl,
    totalDescendants: 0,
    leadDescendants: 0,
    recruiterDescendants: 0,
    directLeadCount: 0,
    directRecruiterCount: 0,
    children: [],
  };
}

function sortNodes(nodes: NetworkNode[]): void {
  nodes.sort((a, b) => {
    if (a.tipo !== b.tipo) {
      return a.tipo === "recrutador" ? -1 : 1;
    }
    const labelA = a.displayName.toLowerCase();
    const labelB = b.displayName.toLowerCase();
    if (labelA < labelB) {
      return -1;
    }
    if (labelA > labelB) {
      return 1;
    }
    return a.id - b.id;
  });
}

function getDirectInviteScore(node: NetworkNode): number {
  return node.directLeadCount + node.directRecruiterCount;
}

function compareByDescendants(a: NetworkNode, b: NetworkNode): number {
  const directDiff = getDirectInviteScore(b) - getDirectInviteScore(a);
  if (directDiff !== 0) {
    return directDiff;
  }

  const diff = b.totalDescendants - a.totalDescendants;
  if (diff !== 0) {
    return diff;
  }

  if (a.tipo !== b.tipo) {
    return a.tipo === "recrutador" ? -1 : 1;
  }
  return a.displayName.localeCompare(b.displayName, "pt-BR");
}

function sortTreeByDescendants(node: NetworkNode): void {
  node.children.sort(compareByDescendants);
  node.children.forEach(sortTreeByDescendants);
}

function computeMetrics(node: NetworkNode, depth: number, nodeById: Map<number, NetworkNode>): {
  total: number;
  leads: number;
  recruiters: number;
} {
  if (node.nivel === null || node.nivel === undefined) {
    node.nivel = depth;
  }

  let total = 0;
  let leads = 0;
  let recruiters = 0;

  node.children.forEach((child) => {
    const metrics = computeMetrics(child, depth + 1, nodeById);
    total += 1 + metrics.total;
    leads += (child.tipo === "lead" ? 1 : 0) + metrics.leads;
    recruiters += (child.tipo === "recrutador" ? 1 : 0) + metrics.recruiters;
  });

  node.totalDescendants = total;
  node.leadDescendants = leads;
  node.recruiterDescendants = recruiters;
  node.directLeadCount = node.children.filter((child) => child.tipo === "lead").length;
  node.directRecruiterCount = node.children.filter((child) => child.tipo === "recrutador").length;

  // Update map with reference (depth info can be derived from traversal if needed later)
  nodeById.set(node.id, node);

  return { total, leads, recruiters };
}

function buildFocusPath(
  node: NetworkNode | undefined,
  nodeById: Map<number, NetworkNode>
): number[] {
  if (!node) {
    return [];
  }
  const path: number[] = [];
  let current: NetworkNode | undefined = node;
  const guard = new Set<number>();

  while (current) {
    if (guard.has(current.id)) {
      break;
    }
    guard.add(current.id);
    path.unshift(current.id);
    if (current.parentNodeId === null) {
      break;
    }
    current = nodeById.get(current.parentNodeId);
  }

  return path;
}

export async function buildNetworkTree(
  options: BuildNetworkTreeOptions = {}
): Promise<NetworkTreeResult> {
  const focusRaw = typeof options.focus === "string" ? options.focus.trim() : "";

  const [inscricoes, recruiters] = await Promise.all([
    listAllInscricoes(),
    Promise.resolve(listRecruiters()),
  ]);

  const recruiterByName = recruiters.reduce<Map<string, { recruiter: Recruiter; code: string }>>(
    (accumulator, recruiter) => {
      const normalizedCode = normalizeRecruiterCode(recruiter.code);
      if (!normalizedCode) {
        return accumulator;
      }
      const key = recruiter.name.trim().toLowerCase();
      if (!accumulator.has(key)) {
        accumulator.set(key, { recruiter, code: normalizedCode });
      }
      return accumulator;
    },
    new Map()
  );

  const augmented = inscricoes.map((item) => augmentInscricao(item, recruiterByName));

  const existingRecruiterCodes = new Set(
    augmented
      .filter((item) => item.tipo === "recrutador" && item.codigoProprio)
      .map((item) => item.codigoProprio as string)
  );

  recruiters.forEach((recruiter) => {
    const normalizedCode = normalizeRecruiterCode(recruiter.code);
    if (!normalizedCode) {
      return;
    }
    if (!existingRecruiterCodes.has(normalizedCode)) {
      const virtualInscricao = createVirtualRecruiterInscricao(recruiter, normalizedCode);
      augmented.push(virtualInscricao);
      existingRecruiterCodes.add(normalizedCode);
    }
  });

  const nodes = augmented.map((inscricao) => toNetworkNode(inscricao));
  const nodeById = new Map<number, NetworkNode>();
  const nodeByCode = new Map<string, NetworkNode>();

  nodes.forEach((node) => {
    nodeById.set(node.id, node);
    if (node.code) {
      nodeByCode.set(node.code, node);
    }
  });

  nodes.forEach((node) => {
    if (node.parentNodeId !== null) {
      const parent = nodeById.get(node.parentNodeId);
      if (parent && parent.id !== node.id) {
        parent.children.push(node);
        node.parentNodeId = parent.id;
        return;
      }
    }

    if (node.parentCode) {
      const parentByCode = nodeByCode.get(node.parentCode);
      if (parentByCode && parentByCode.id !== node.id) {
        parentByCode.children.push(node);
        node.parentNodeId = parentByCode.id;
        return;
      }
    }

    node.parentNodeId = null;
  });

  const PRIMARY_ROOT_CODES = ["01", "1", "001"];
  let primaryRootNode: NetworkNode | undefined;
  for (const code of PRIMARY_ROOT_CODES) {
    const candidate = nodeByCode.get(code);
    if (candidate && candidate.tipo === "recrutador") {
      primaryRootNode = candidate;
      break;
    }
  }
  if (!primaryRootNode) {
    primaryRootNode = nodes.find((node) => node.tipo === "recrutador");
  }

  if (primaryRootNode) {
    primaryRootNode.parentNodeId = null;
    nodes.forEach((node) => {
      if (node.id === primaryRootNode!.id) {
        return;
      }
      if (node.tipo === "recrutador" && node.parentNodeId === null) {
        node.parentNodeId = primaryRootNode!.id;
        if (!primaryRootNode!.children.some((child) => child.id === node.id)) {
          primaryRootNode!.children.push(node);
        }
      }
    });
  }

  const roots = nodes.filter((node) => node.parentNodeId === null && node.tipo === "recrutador");
  const orphans = nodes.filter((node) => node.parentNodeId === null && node.tipo !== "recrutador");

  sortNodes(orphans);

  const recruiterCount = nodes.filter((node) => node.tipo === "recrutador").length;
  const leadCount = nodes.length - recruiterCount;
  const virtualRecruiters = nodes.filter((node) => node.tipo === "recrutador" && node.isVirtual).length;

  roots.forEach((root) => {
    computeMetrics(root, 0, nodeById);
  });

  roots.sort(compareByDescendants);
  roots.forEach(sortTreeByDescendants);

  orphans.forEach((orphan) => {
    computeMetrics(orphan, 0, nodeById);
  });

  orphans.sort(compareByDescendants);
  orphans.forEach(sortTreeByDescendants);

  const stats: NetworkTreeStats = {
    total: nodes.length,
    leads: leadCount,
    recruiters: recruiterCount,
    virtualRecruiters,
    orphans: orphans.length,
  };

  let focusNode: NetworkNode | undefined;

  if (focusRaw.length > 0) {
    if (/^-?\d+$/.test(focusRaw)) {
      const focusId = Number.parseInt(focusRaw, 10);
      focusNode = nodeById.get(focusId);
    }
    if (!focusNode) {
      const normalizedFocus = normalizeRecruiterCode(focusRaw);
      if (normalizedFocus) {
        focusNode = nodeByCode.get(normalizedFocus);
      }
    }
  }

  const focus: NetworkTreeFocus | null = focusNode
    ? {
        code: focusNode.code,
        name: focusNode.displayName,
        nodeId: focusNode.id,
        path: buildFocusPath(focusNode, nodeById),
      }
    : null;

  return {
    roots,
    orphans,
    stats,
    focus,
  };
}
