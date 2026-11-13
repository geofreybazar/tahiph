import { SetMetadata } from '@nestjs/common';
import type { z } from 'zod';

export const RESPONSE_SCHEMA_KEY = 'tahi:responseSchema';
export const REFERENCES_KEY = 'tahi:references';

export interface ResponseContract {
  schema: z.ZodType;
  /** The handler returns Paginated<T>; `schema` describes one item. */
  paginated: boolean;
}

/**
 * The route's success payload (inside `{ data }`). The envelope interceptor parses every
 * response with it, so undeclared fields (e.g. passwordHash) are stripped, and the OpenAPI
 * document is generated from it (ADR-023). Every route must declare one.
 */
export const ResponseSchema = (schema: z.ZodType, options: { paginated?: boolean } = {}) =>
  SetMetadata(RESPONSE_SCHEMA_KEY, {
    schema,
    paginated: options.paginated ?? false,
  } satisfies ResponseContract);

/**
 * Tenant resource kinds that ids in a request can point to (cross-tenant tests use these).
 * `membership` is the caller's own membership; `staffMember` is another member's;
 * `customRole` is a role that can be deleted (not a system role, no members).
 * `erasableClient` is a client without upcoming appointments (erasure is irreversible).
 */
export type ResourceKind =
  | 'role'
  | 'customRole'
  | 'membership'
  | 'staffMember'
  | 'holiday'
  | 'invitation'
  | 'customer'
  | 'client'
  | 'erasableClient'
  | 'clientNote'
  | 'garmentCategory'
  | 'measurementTemplate'
  | 'measurementRecord'
  | 'appointmentType'
  | 'appointment'
  | 'timeOff'
  | 'catalogCategory'
  | 'catalogItem'
  | 'optionGroup'
  | 'catalogOption'
  | 'catalogImage'
  | 'logo'
  | (string & {});

/**
 * Declares which path params and body fields are ids of tenant resources. The cross-tenant
 * suite sends another atelier's ids for each of them and expects 404. Routes whose request
 * contains uuid fields must declare them (enforced by test).
 */
export const References = (refs: Record<string, ResourceKind>) => SetMetadata(REFERENCES_KEY, refs);
