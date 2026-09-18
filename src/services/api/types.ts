/**
 * Re-export of the shared HTTP contract.
 *
 * The real declarations live in `shared/core/api.ts`, which the serverless routes in
 * `api/` import too - one definition of every request and response shape.
 */
export * from '@shared/core/api';
