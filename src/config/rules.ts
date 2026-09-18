/**
 * Re-export of the shared rule set.
 *
 * The real module lives in `shared/core/rules.ts` because the API routes read it as
 * well, and a serverless bundle cannot resolve this project's `@/` aliases. Game code
 * keeps importing `@/config/rules`, so nothing below the shell had to move.
 */
export * from '@shared/core/rules';
