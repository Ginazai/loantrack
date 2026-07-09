/**
 * OpenAPI type stubs — generated from /api/v1/openapi.json.
 *
 * To regenerate:
 *   npx openapi-typescript http://localhost:8000/api/v1/openapi.json -o src/api/openapi.ts
 *
 * These are hand-maintained stubs until the project adds the generation step to CI.
 * The canonical types used by the app live in src/types/index.ts; this file provides
 * the contract reference so the generation command can be added without touching imports.
 */

// Re-export app types as the OpenAPI schema surface for now.
// Replace with generated output from openapi-typescript.
export type { LoanAccount, Payment, User, WebhookConfig, LoanRequest } from "../types";
