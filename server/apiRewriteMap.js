/**
 * Build the Express-side API route table from the same rewrites used by Vercel.
 * Only exact /api/* rewrites targeting api/router.js are delegated here.
 */
export function buildApiRewriteMap(config) {
  const routes = new Map();

  for (const rewrite of config?.rewrites || []) {
    if (
      typeof rewrite?.source !== 'string'
      || !rewrite.source.startsWith('/api/')
      || typeof rewrite.destination !== 'string'
      || !rewrite.destination.startsWith('/api/router?')
    ) {
      continue;
    }

    const destination = new URL(rewrite.destination, 'http://localhost');
    const router = destination.searchParams.get('__router');
    if (!router) continue;

    routes.set(rewrite.source, Object.freeze({
      router,
      apiRoute: destination.searchParams.get('__apiRoute'),
    }));
  }

  return routes;
}
