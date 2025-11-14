import express from "express";
import request from "supertest";
import { handleInscricoesRequest } from "@/app/api/inscricoes/route";
import { listInscricoes } from "@/lib/db";

jest.mock("@/lib/db", () => ({
  listInscricoes: jest.fn(),
}));

const mockedListInscricoes = listInscricoes as jest.MockedFunction<typeof listInscricoes>;

describe("GET /api/inscricoes", () => {
  const originalToken = process.env.DASHBOARD_TOKEN;

  beforeEach(() => {
    process.env.DASHBOARD_TOKEN = "test-token";
    mockedListInscricoes.mockReset();
  });

  afterAll(() => {
    process.env.DASHBOARD_TOKEN = originalToken;
  });

  function createTestServer() {
    const app = express();
    app.get("/api/inscricoes", async (req, res) => {
      const url = new URL(req.originalUrl, "http://localhost");
      const result = await handleInscricoesRequest({
        authorization: req.header("authorization"),
        searchParams: url.searchParams,
      });
      res.status(result.status).json(result.body);
    });
    return app;
  }

  it("rejects requests without authorization header", async () => {
    const app = createTestServer();

    const response = await request(app).get("/api/inscricoes");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Unauthorized" });
    expect(mockedListInscricoes).not.toHaveBeenCalled();
  });

  it("returns paginated data when authorized", async () => {
    mockedListInscricoes.mockResolvedValue({
      data: [],
      page: 1,
      pageSize: 10,
      total: 0,
    });

    const app = createTestServer();

    const response = await request(app)
      .get("/api/inscricoes?page=2&orderBy=nome&orderDirection=asc&nome=Ana")
      .set("Authorization", "Bearer test-token");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: [],
      page: 1,
      pageSize: 10,
      total: 0,
    });

    expect(mockedListInscricoes).toHaveBeenCalledWith({
      page: 2,
      pageSize: 10,
      orderBy: "nome",
      orderDirection: "asc",
      filters: {
        nome: "Ana",
        telefone: "",
        indicacao: "",
        treinamento: "",
      },
    });
  });
});
