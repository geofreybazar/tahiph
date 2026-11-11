import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { collectRoutes } from '../http/route-inventory.js';

/**
 * Lists routes that are not fully declared: missing or invalid access configuration
 * (deny by default) or no @ResponseSchema() (serialization and OpenAPI need it).
 */
export function findUnconfiguredRoutes(
  discovery: DiscoveryService,
  scanner: MetadataScanner,
  reflector: Reflector,
): string[] {
  return collectRoutes(discovery, scanner, reflector).flatMap((r) => [
    ...(r.access ? [] : [`${r.operationId} (access)`]),
    ...(r.response ? [] : [`${r.operationId} (response schema)`]),
  ]);
}

/** Fails application start if any route is not explicitly configured. */
@Injectable()
export class RouteAccessAudit implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    const problems = findUnconfiguredRoutes(this.discovery, this.scanner, this.reflector);
    if (problems.length > 0) {
      throw new Error(
        `Routes must declare @Realm() + @Public()/@Authenticated()/@RequirePermission() and @ResponseSchema(): ${problems.join(', ')}`,
      );
    }
  }
}
