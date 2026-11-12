export const routes = {
  home: "/",
  why: "/why-obrenna",
  privacy: "/privacy",
  download: "/download",
  docs: "/docs",
  contact: "/contact-sales",
  signin: "/sign-in",
  signup: "/sign-up",
  createOrg: "/onboarding/create-organization",
  features: "/why-obrenna",
} as const;

export const publicNav: Array<[string, string]> = [
  ["For organizations", routes.why],
  ["Security", routes.privacy],
];
