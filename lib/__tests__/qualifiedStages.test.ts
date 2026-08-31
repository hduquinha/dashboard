import { buildQualifiedStageKeys } from "@/lib/metaAds";
import type { FunnelStageDef } from "@/types/metaAds";

/**
 * O funil VozUP como está em produção: "Tentativas" é a fila de quem acabou de
 * chegar e ainda não foi atendido — quem para nela não é contato qualificado.
 */
const funilVozup: FunnelStageDef[] = [
  { position: 0, key: "novo", label: "Novo", kind: "entry" },
  { position: 1, key: "primeiro_contato", label: "Tentativas", kind: "normal" },
  { position: 2, key: "em_atendimento", label: "Conexão", kind: "normal" },
  { position: 3, key: "no_show", label: "Aula Exclusiva", kind: "normal" },
  { position: 4, key: "agendado", label: "Agendado", kind: "normal" },
  { position: 5, key: "fechamento", label: "Fechado", kind: "normal" },
  { position: 6, key: "ganho", label: "Follow-Up", kind: "won" },
  { position: 7, key: "compra_futura", label: "Compra futura", kind: "normal" },
  { position: 8, key: "perdido", label: "Desinteresse", kind: "lost" },
];

describe("buildQualifiedStageKeys", () => {
  it("não conta quem só entrou na fila de chegada", () => {
    const keys = buildQualifiedStageKeys(funilVozup);
    expect(keys.has("novo")).toBe(false);
    expect(keys.has("primeiro_contato")).toBe(false);
    expect(keys.has("perdido")).toBe(false);
  });

  it("conta de Conexão em diante, incluindo a etapa de venda", () => {
    const keys = buildQualifiedStageKeys(funilVozup);
    expect(keys.has("em_atendimento")).toBe(true);
    expect(keys.has("agendado")).toBe(true);
    expect(keys.has("fechamento")).toBe(true);
    expect(keys.has("ganho")).toBe(true);
    expect(keys.has("compra_futura")).toBe(true);
  });

  it("usa a posição, não a chave — o funil é editável", () => {
    const outroFunil: FunnelStageDef[] = [
      { position: 0, key: "entrada", label: "Entrada", kind: "entry" },
      { position: 1, key: "fila", label: "Fila", kind: "normal" },
      { position: 2, key: "conversando", label: "Conversando", kind: "normal" },
      { position: 3, key: "vendido", label: "Vendido", kind: "won" },
    ];
    expect(buildQualifiedStageKeys(outroFunil)).toEqual(new Set(["conversando", "vendido"]));
  });

  it("venda sempre conta, mesmo se alguém a colocar antes das etapas normais", () => {
    const funilTorto: FunnelStageDef[] = [
      { position: 0, key: "vendido", label: "Vendido", kind: "won" },
      { position: 1, key: "fila", label: "Fila", kind: "normal" },
    ];
    expect(buildQualifiedStageKeys(funilTorto)).toEqual(new Set(["vendido"]));
  });

  it("funil sem etapa normal nenhuma não quebra", () => {
    expect(buildQualifiedStageKeys([{ position: 0, key: "novo", label: "Novo", kind: "entry" }])).toEqual(new Set());
  });
});
