/**
 * Re-export of the shared submission validator.
 *
 * The real module lives in `shared/core/validation.ts` and is the SAME code the API
 * route runs to decide what reaches the leaderboard. The client calls it so LOCAL
 * MODE behaves like production.
 */
export * from '@shared/core/validation';
