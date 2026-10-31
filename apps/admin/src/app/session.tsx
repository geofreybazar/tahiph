import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import {
  chooseTenant,
  type Me,
  type Membership,
  readRememberedTenant,
  rememberTenant,
} from '@/lib/tenants';

const SessionContext = createContext<{ session: Session | null; loading: boolean } | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ session: Session | null; loading: boolean }>({
    session: null,
    loading: true,
  });
  const queryClient = useQueryClient();

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // Nothing cached for one user may be shown to the next.
      if (event === 'SIGNED_OUT') queryClient.clear();
      setState({ session, loading: false });
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

export function useMe() {
  const { session } = useSession();
  return useQuery({
    queryKey: ['me', session?.user.id],
    queryFn: () => apiFetch<Me>('/me'),
    enabled: Boolean(session),
  });
}

const TenantContext = createContext<{
  tenant: Membership | null;
  switchTenant: (id: string) => void;
} | null>(null);

export function TenantProvider({ me, children }: { me: Me; children: ReactNode }) {
  const [selected, setSelected] = useState(readRememberedTenant);
  const queryClient = useQueryClient();

  const value = useMemo(
    () => ({
      tenant: chooseTenant(me.memberships, selected),
      switchTenant(id: string) {
        rememberTenant(id);
        setSelected(id);
        // Tenant queries include the tenant in their key; this removes the old tenant's data too.
        queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' });
      },
    }),
    [me.memberships, selected, queryClient],
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  const value = useContext(TenantContext);
  if (!value) throw new Error('useTenant must be used inside TenantProvider');
  return value;
}
