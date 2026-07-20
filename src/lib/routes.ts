export const routes = {
  home: "/",
  features: "/features",
  why: "/why-obrenna",
  privacy: "/privacy",
  download: "/download",
  docs: "/docs",
  contact: "/contact-sales",
  signin: "/sign-in",
  signup: "/sign-up",
  createOrg: "/onboarding/create-organization",
  invite: "/onboarding/invitation",
  admin: "/portal/admin",
  machines: "/portal/admin/machines",
  models: "/portal/admin/models",
  mcp: "/portal/admin/mcp",
  policies: "/portal/admin/policies",
  people: "/portal/admin/people",
  audit: "/portal/admin/audit",
  settings: "/portal/admin/settings",
  employee: "/portal/employee",
} as const;

export const publicNav: Array<[string, string]> = [
  ["Platform", routes.features],
  ["For organizations", routes.why],
  ["Security", routes.privacy],
  ["Docs", routes.docs],
];

export const adminNav: Array<[string, string, string]> = [
  ["Overview", routes.admin, "layout-dashboard"],
  ["Machines", routes.machines, "server"],
  ["Models", routes.models, "brain-circuit"],
  ["MCP servers", routes.mcp, "network"],
  ["Tool policies", routes.policies, "sliders-horizontal"],
  ["People & access", routes.people, "users"],
  ["Audit log", routes.audit, "file-clock"],
];
