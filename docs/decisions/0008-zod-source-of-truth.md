# ADR 0008: Zod schemas as the source of truth

**Status:** Zod in `packages/shared` is Established. `nestjs-zod` is approved by the owner on 2026-10-31, as an added dependency.

## Decision

Zod schemas in `packages/shared` define request validation and inferred types. `nestjs-zod` connects them to NestJS through `createZodDto`, a validation pipe, and `cleanupOpenApiDoc` for Swagger.

## Why `nestjs-zod`

NestJS's Swagger integration works from classes, and Zod schemas aren't classes. `nestjs-zod` bridges this, so there's no hand-written second copy of every contract.

## Version constraint

Checked on npm on 2026-10-31: the latest `nestjs-zod`, 5.5.0, declares peer support for `@nestjs/common` and `@nestjs/swagger` up to version 11, while the latest NestJS is 12.3.2.

**Plan:** use NestJS 11 unless a compatible `nestjs-zod` is available when Phase 0 starts. Check `nestjs-cls` at the same time. Don't force a peer dependency override.

## Consequences

- `packages/shared` ships as ESM only. The CJS NestJS build loads it through Node 24's native `require()` of ES modules, which avoids a dual build. Checked by running the built API under plain Node.
- A restricted role's responses need their own schema.
