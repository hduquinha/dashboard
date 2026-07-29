import { NextRequest } from "next/server";
import { ingestVozupLead } from "@/lib/vozupLeadIngest";
import { POST } from "./route";

jest.mock("@/lib/vozupLeadIngest", () => ({
  ingestVozupLead: jest.fn(),
}));

const mockedIngest = ingestVozupLead as jest.MockedFunction<typeof ingestVozupLead>;

function leadRequest(payload: unknown) {
  return new NextRequest("https://dashboard.escolavozup.com/api/vozup/lead", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://escolavozup.com",
    },
    body: JSON.stringify(payload),
  });
}

describe("POST /api/vozup/lead", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedIngest.mockResolvedValue(123);
  });

  it("does not persist a partial form interaction without an explicit final flag", async () => {
    const response = await POST(
      leadRequest({ nome: "Maria Silva", telefone: "(11) 91234-5678" })
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false });
    expect(mockedIngest).not.toHaveBeenCalled();
  });

  it("does not persist an explicitly final payload without valid contact data", async () => {
    const response = await POST(
      leadRequest({ _final: true, nome: {}, telefone: "119" })
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false });
    expect(mockedIngest).not.toHaveBeenCalled();
  });

  it("persists and notifies only a completed lead with valid contact data", async () => {
    const response = await POST(
      leadRequest({
        _final: true,
        nome: "Maria Silva",
        telefone: "(11) 91234-5678",
        objetivo: "Falar em público com segurança",
        origem: "Landing Page VozUP - Home",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, id: 123 });
    expect(mockedIngest).toHaveBeenCalledWith(
      expect.objectContaining({
        nome: "Maria Silva",
        telefone: "(11) 91234-5678",
        objetivo: "Falar em público com segurança",
        origem: "Landing Page VozUP - Home",
        _final: "true",
      }),
      { notify: true }
    );
  });

  it("accepts the existing _meta.final compatibility flag", async () => {
    const response = await POST(
      leadRequest({
        _meta: { final: true },
        nome: "Ana Costa",
        telefone: "+55 (11) 99876-5432",
      })
    );

    expect(response.status).toBe(200);
    expect(mockedIngest).toHaveBeenCalledTimes(1);
  });

  it("normalizes panfleto origins and queues them for distribution", async () => {
    const response = await POST(
      leadRequest({
        _final: true,
        nome: "João Souza",
        telefone: "(11) 99876-5432",
        origem: "panfleto_a",
      })
    );

    expect(response.status).toBe(200);
    expect(mockedIngest).toHaveBeenCalledWith(
      expect.objectContaining({
        origem: "Panfleto A",
        aguarda_distribuicao: "true",
      }),
      { notify: true }
    );
  });
});
