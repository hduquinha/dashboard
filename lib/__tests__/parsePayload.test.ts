import { parsePayload } from "@/lib/parsePayload";

describe("parsePayload", () => {
  it("returns an empty object when payload is invalid", () => {
    expect(parsePayload(null)).toEqual({});
    expect(parsePayload(undefined)).toEqual({});
    expect(parsePayload(42)).toEqual({});
  });

  it("normalizes known string fields", () => {
    const payload = parsePayload({
      nome: " Maria Silva ",
      phone: " 8799-0000 ",
      city: " Recife ",
      createdAt: "2024-01-01T10:00:00Z",
      trafficSource: "07",
    });

    expect(payload.nome).toBe("Maria Silva");
    expect(payload.telefone).toBe("8799-0000");
    expect(payload.cidade).toBe("Recife");
    expect(payload.timestamp).toBe("2024-01-01T10:00:00Z");
    expect(payload.traffic_source).toBe("07");
  });

  it("keeps unknown fields without modification", () => {
    const payload = parsePayload({ customField: 123, flag: true });

    expect(payload.customField).toBe(123);
    expect(payload.flag).toBe(true);
  });
});
