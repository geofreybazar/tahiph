import { useTenant } from '@/app/session';
import { isManager } from './navigation';

/** Feature pages only render once a tenant is selected. */
export function useTenantAccess() {
  const { tenant } = useTenant();
  return { tenantId: tenant!.id, manager: isManager(tenant!.role) };
}
