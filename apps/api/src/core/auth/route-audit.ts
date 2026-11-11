import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { readRouteAccess } from './route-access.js';

/** Lists controller routes whose access configuration is missing or invalid. */
export function findUnconfiguredRoutes(
  discovery: DiscoveryService,
  scanner: MetadataScanner,
  reflector: Reflector,
): string[] {
  const problems: string[] = [];
  for (const wrapper of discovery.getControllers()) {
    const instance = wrapper.instance as object | undefined;
    if (!instance) continue;
    const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
    for (const name of scanner.getAllMethodNames(proto)) {
      const handler = proto[name];
      if (typeof handler !== 'function') continue;
      // Only route handlers carry path metadata.
      if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
      if (!readRouteAccess(reflector, handler, instance.constructor)) {
        problems.push(`${instance.constructor.name}.${name}`);
      }
    }
  }
  return problems;
}

/** Fails application start if any route is not explicitly configured (deny by default). */
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
        `Routes without valid @Realm() + @Public()/@Authenticated()/@RequirePermission(): ${problems.join(', ')}`,
      );
    }
  }
}
