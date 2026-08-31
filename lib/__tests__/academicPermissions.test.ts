import {
  defaultPermissionsForRole,
  effectivePermissionsForRole,
  hasPermission,
} from "@/lib/permissions";

describe("permissões do módulo acadêmico", () => {
  it("faz parte do lado VozUP para administradores comuns", () => {
    const permissions = defaultPermissionsForRole("admin");
    expect(permissions).toContain("view.students");
    expect(permissions).toContain("classes.manage");
  });

  it("remove permissões acadêmicas de usuários somente Instituto UP, inclusive listas antigas", () => {
    expect(defaultPermissionsForRole("admin", { institutoUpOnly: true })).not.toContain("view.students");
    expect(
      effectivePermissionsForRole("admin", ["view.dashboard", "view.students", "classes.manage"], {
        institutoUpOnly: true,
      })
    ).toEqual(["view.dashboard"]);
  });

  it("mantém a fronteira mesmo para super master", () => {
    const user = {
      email: "henrique@escolavozup.com",
      role: "super_master",
      permissions: ["view.students"],
      institutoUpOnly: true,
    };
    expect(hasPermission(user, "view.students")).toBe(false);
    expect(hasPermission(user, "view.dashboard")).toBe(true);
  });
});
