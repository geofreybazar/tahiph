import type { INestApplicationContext } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { buildOpenApiDocument } from './openapi.js';
import { collectRoutes, type RouteInfo } from './route-inventory.js';

export function routesOf(app: INestApplicationContext): RouteInfo[] {
  return collectRoutes(app.get(DiscoveryService), app.get(MetadataScanner), app.get(Reflector));
}

export function openApiDocumentOf(app: INestApplicationContext, version = '0.0.0') {
  return buildOpenApiDocument(routesOf(app), { version });
}
