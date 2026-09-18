/**
 * Re-export of the shared score formulas.
 *
 * The real module lives in `shared/core/scoring.ts`: the server recomputes every
 * score with the SAME code the client displays, so there is no second implementation
 * to keep in step. See `shared/game-rules/README.md`.
 */
export * from '@shared/core/scoring';
