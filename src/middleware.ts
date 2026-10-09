import { defineMiddleware } from 'astro:middleware';
import { getPortalAccount } from './lib/portal-account';

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname, search } = context.url;
  if (pathname === '/portal/admin' || pathname.startsWith('/portal/admin/')) {
    const account = await getPortalAccount(context.request);
    if (!account) {
      return context.redirect(`/sign-in?returnTo=${encodeURIComponent(pathname + search)}`);
    }
    context.locals.portalAccount = account;
  }
  return next();
});
