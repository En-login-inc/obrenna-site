/// <reference path="../.astro/types.d.ts" />

declare namespace App {
  interface Locals {
    portalAccount?: import('./lib/portal-account').PortalAccount;
  }
}
