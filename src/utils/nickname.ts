/**
 * Re-export of the shared nickname rules.
 *
 * The real module lives in `shared/core/nickname.ts` and is the SAME code the API
 * route runs on arrival, so what the player is shown is what gets stored.
 */
export * from '@shared/core/nickname';
