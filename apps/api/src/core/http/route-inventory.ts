import { RequestMethod, VERSION_NEUTRAL } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
  VERSION_METADATA,
} from '@nestjs/common/constants.js';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';
import type { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type { z } from 'zod';
import { readRouteAccess, type RouteAccess } from '../auth/route-access.js';
import { REFERENCES_KEY, RESPONSE_SCHEMA_KEY, type ResponseContract } from './contract.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

export interface RouteInfo {
  operationId: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Full path, e.g. /api/v1/tenant/invitations/:id */
  path: string;
  status: number;
  access: RouteAccess | null;
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
  response?: ResponseContract;
  references: Record<string, string>;
  pathParams: string[];
}

const METHODS: Partial<Record<RequestMethod, RouteInfo['method']>> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
};

interface ArgMetadata {
  index: number;
  data?: unknown;
  pipes?: unknown[];
}

function join(...parts: string[]): string {
  return `/${parts
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')}`;
}

/** Zod schema of the first ZodValidationPipe on a @Body()/@Query()/@Param() argument. */
function argSchema(
  args: Record<string, ArgMetadata>,
  type: RouteParamtypes,
): z.ZodType | undefined {
  for (const [key, meta] of Object.entries(args)) {
    if (Number(key.split(':')[0]) !== Number(type)) continue;
    const pipe = meta.pipes?.find(
      (p): p is ZodValidationPipe<z.ZodType> => p instanceof ZodValidationPipe,
    );
    if (pipe) return pipe.schema;
  }
  return undefined;
}

/**
 * Every HTTP route with its contract, read from Nest metadata: the same decorators that drive
 * validation, access control and serialization. Used by the OpenAPI generator (ADR-023), the
 * boot-time route audit and the cross-tenant suite.
 */
export function collectRoutes(
  discovery: DiscoveryService,
  scanner: MetadataScanner,
  reflector: Reflector,
  options: { prefix?: string; defaultVersion?: string } = {},
): RouteInfo[] {
  const prefix = options.prefix ?? 'api';
  const defaultVersion = options.defaultVersion ?? '1';
  const routes: RouteInfo[] = [];
  for (const wrapper of discovery.getControllers()) {
    const instance = wrapper.instance as object | undefined;
    if (!instance) continue;
    const controller = instance.constructor;
    const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
    const controllerPath = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
    const controllerVersion = Reflect.getMetadata(VERSION_METADATA, controller) as unknown;
    for (const name of scanner.getAllMethodNames(proto)) {
      const handler = proto[name];
      if (typeof handler !== 'function') continue;
      const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      if (methodPath === undefined) continue;
      const method = METHODS[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
      if (!method) continue;
      const version =
        (Reflect.getMetadata(VERSION_METADATA, handler) as unknown) ?? controllerVersion;
      const versionSegment =
        version === VERSION_NEUTRAL
          ? ''
          : `v${typeof version === 'string' ? version : defaultVersion}`;
      const path = join(prefix, versionSegment, controllerPath, methodPath);
      const handlerArgs = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) ??
        {}) as Record<string, ArgMetadata>;
      routes.push({
        operationId: `${controller.name}.${name}`,
        method,
        path,
        status:
          (Reflect.getMetadata(HTTP_CODE_METADATA, handler) as number | undefined) ??
          (method === 'POST' ? 201 : 200),
        access: readRouteAccess(reflector, handler, controller),
        ...optional('body', argSchema(handlerArgs, RouteParamtypes.BODY)),
        ...optional('query', argSchema(handlerArgs, RouteParamtypes.QUERY)),
        ...optional('params', argSchema(handlerArgs, RouteParamtypes.PARAM)),
        ...optional(
          'response',
          reflector.get<ResponseContract | undefined>(RESPONSE_SCHEMA_KEY, handler),
        ),
        references:
          reflector.get<Record<string, string> | undefined>(REFERENCES_KEY, handler) ?? {},
        pathParams: [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]!),
      });
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}
