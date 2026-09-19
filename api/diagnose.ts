/**
 * TEMPORARY. Delete once the deployment is healthy.
 *
 * Every route was returning FUNCTION_INVOCATION_FAILED, which is what Vercel says
 * for both "the module would not load" and "the handler threw". Those have very
 * different fixes and the platform will not tell us which it was, so this endpoint
 * imports each layer separately and reports where it stops.
 *
 * It has NO static imports of its own, so it can still answer when everything else
 * is broken. It reports an error's code, name and message - all of which are our own
 * file paths and module names, already public in the repository - and nothing from a
 * request or the database.
 */
interface Probe {
  layer: string;
  ok: boolean;
  detail: string;
}

async function probe(layer: string, load: () => Promise<unknown>): Promise<Probe> {
  try {
    const module = (await load()) as Record<string, unknown>;
    return { layer, ok: true, detail: Object.keys(module).slice(0, 6).join(',') };
  } catch (error) {
    const code = (error as { code?: string }).code;
    const name = error instanceof Error ? error.name : typeof error;
    const message = error instanceof Error ? error.message : String(error);
    return { layer, ok: false, detail: `${code ?? name}: ${message.slice(0, 300)}` };
  }
}

export default {
  async fetch(): Promise<Response> {
    const results: Probe[] = [];

    // Innermost first, so the first failure is the real one.
    results.push(await probe('json', () => import('../shared/game-rules/v3.json')));
    results.push(await probe('rules', () => import('../shared/core/rules.js')));
    results.push(await probe('env', () => import('../server/config/env.js')));
    results.push(await probe('headers', () => import('../server/http/headers.js')));
    results.push(await probe('health', () => import('../server/http/health.js')));
    results.push(await probe('driver', () => import('../server/db/neon.js')));
    results.push(await probe('routes', () => import('../server/http/routes.js')));

    return new Response(
      JSON.stringify(
        {
          node: process.version,
          region: process.env.VERCEL_REGION ?? null,
          databaseUrlSet: Boolean(process.env.DATABASE_URL),
          results,
        },
        null,
        2,
      ),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  },
};
