import type { NextRequest } from "next/server";
import { requireTasks, requireTasksAdmin, requireTasksMaster } from "@/lib/tasksApi";
import type { DashboardUser } from "@/lib/auth";
import { defaultPermissionsForRole, type TeamRole } from "@/lib/permissions";

jest.mock("@/lib/auth", () => ({
  getRequestDashboardSession: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getRequestDashboardSession } = require("@/lib/auth") as {
  getRequestDashboardSession: jest.Mock;
};

function user(role: TeamRole, email: string): DashboardUser {
  return {
    id: 1,
    email,
    name: email,
    role,
    isSupervisor: false,
    priorityLevel: 0,
    permissions: defaultPermissionsForRole(role),
    institutoUpOnly: false,
  };
}

function signedInAs(u: DashboardUser | null) {
  getRequestDashboardSession.mockReturnValue(u ? { user: u } : null);
}

// requireTasks cai no header Authorization quando nao ha sessao — o request
// falso precisa responder a headers.get, senao o teste quebra no caminho novo.
const request = { headers: new Headers() } as unknown as NextRequest;

describe("gates de permissao de Tarefas", () => {
  beforeEach(() => {
    getRequestDashboardSession.mockReset();
  });

  it("bloqueia quem nao esta logado", async () => {
    signedInAs(null);
    const result = await requireTasks(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("deixa um member comum apenas visualizar", async () => {
    signedInAs(user("member", "vendedor@escolavozup.com"));
    expect((await requireTasks(request)).ok).toBe(true);

    const admin = await requireTasksAdmin(request);
    expect(admin.ok).toBe(false);
    if (!admin.ok) expect(admin.response.status).toBe(403);

    const master = await requireTasksMaster(request);
    expect(master.ok).toBe(false);
    if (!master.ok) expect(master.response.status).toBe(403);
  });

  it("admin administra quadros, mas NAO mexe em setores/equipes", async () => {
    signedInAs(user("admin", "rafael@escolavozup.com"));
    expect((await requireTasksAdmin(request)).ok).toBe(true);

    const master = await requireTasksMaster(request);
    expect(master.ok).toBe(false);
    if (!master.ok) expect(master.response.status).toBe(403);
  });

  it("super master mexe em tudo", async () => {
    signedInAs(user("super_master", "henrique@escolavozup.com"));
    expect((await requireTasksAdmin(request)).ok).toBe(true);
    expect((await requireTasksMaster(request)).ok).toBe(true);
  });

  it("reconhece super master pelo email configurado, mesmo com role menor", async () => {
    // isSuperMaster tambem cai no fallback de email (DASHBOARD_SUPER_MASTER_EMAILS)
    signedInAs(user("admin", "henrique@escolavozup.com"));
    expect((await requireTasksMaster(request)).ok).toBe(true);
  });
});
