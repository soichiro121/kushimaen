// @vitest-environment node
/**
 * The contract between our code and Vercel.
 *
 * Every other server test imports `server/http/*` and exercises the handler directly,
 * which is good for the logic and blind to the thing that actually broke: the files
 * under `api/` are what the platform loads, and they were exporting the handler in a
 * shape Vercel reads as the legacy `(req, res)` Node signature. Every route returned
 * FUNCTION_INVOCATION_FAILED while all 255 tests stayed green.
 *
 * So these tests load the deployment entry points themselves, and they DISCOVER them
 * rather than listing them - a new route added later is covered without anyone
 * remembering to come back here.
 */
import { describe, expect, it } from 'vitest';

/** Every file the platform will turn into a function. */
const entryPoints = import.meta.glob('../../api/**/*.ts');

describe('the api/ entry points', () => {
  it('finds all of them', () => {
    // A guard on the guard: if the glob silently matched nothing, every test below
    // would vacuously pass.
    expect(Object.keys(entryPoints).length).toBeGreaterThanOrEqual(5);
  });

  for (const [path, load] of Object.entries(entryPoints)) {
    const name = path.replace('../../', '');

    it(`${name} exports a Web handler Vercel will recognise`, async () => {
      const module = (await load()) as { default?: unknown };
      const exported = module.default;

      // A bare function default export is the LEGACY signature: Vercel would call it
      // with an IncomingMessage, and a handler expecting a `Request` throws on the
      // first `headers.get(...)`. It must be `{ fetch }` instead.
      expect(
        typeof exported,
        `${name} must export { fetch }, not a bare function - see server/http/vercel.ts`,
      ).toBe('object');
      expect(typeof (exported as { fetch?: unknown }).fetch).toBe('function');
    });
  }
});

describe('the deployed health check', () => {
  /**
   * End to end through the real entry point, with a real `Request`. This is the exact
   * call Vercel makes, and it is the one that decides remote mode versus LOCAL MODE.
   */
  it('answers 200 when invoked the way the platform invokes it', async () => {
    const { default: fn } = await import('../../api/health');

    const response = await fn.fetch(new Request('https://komato.test/api/health'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok' });
  });

  it('does not accept a Node-style (req, res) call', async () => {
    // Pins the reason the wrapper exists. If someone reverts to a bare default export
    // this file stops compiling at `fn.fetch`, but this asserts the underlying fact:
    // the handler genuinely cannot work with an IncomingMessage-shaped argument.
    const { default: fn } = await import('../../api/health');
    const nodeStyleRequest = { method: 'GET', url: '/api/health', headers: {} };

    await expect(fn.fetch(nodeStyleRequest as unknown as Request)).rejects.toThrow();
  });
});
