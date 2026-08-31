import { canReceiveNewLeadNotifications } from "@/lib/leadNotificationAudience";

describe("canReceiveNewLeadNotifications", () => {
  it("aceita gestor que pode abrir a Chegada de Leads", () => {
    expect(
      canReceiveNewLeadNotifications({
        email: "gestor@example.com",
        role: "member",
        permissions: ["view.distribution", "admin.distribution"],
      })
    ).toBe(true);
  });

  it("recusa quem ve a Chegada mas nao tem poder de distribuir", () => {
    expect(
      canReceiveNewLeadNotifications({
        email: "consulta@example.com",
        role: "member",
        permissions: ["view.distribution"],
      })
    ).toBe(false);
  });

  it("recusa gestor sem acesso a tela de Chegada", () => {
    expect(
      canReceiveNewLeadNotifications({
        email: "admin@example.com",
        role: "admin",
        permissions: ["view.crm"],
      })
    ).toBe(false);
  });
});
