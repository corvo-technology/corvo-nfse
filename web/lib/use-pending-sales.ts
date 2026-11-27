"use client";

import { useEffect, useState } from "react";
import { integrations, type IntegrationSale } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/** The sales of every integration that wait for the client (no invoice yet), for the current environment. */
export function usePendingSales(enabled = true): { sales: IntegrationSale[]; loading: boolean; failed: boolean } {
  const { fiscalEnvironment, tenantId, can } = useAuth();
  const allowed = enabled && can("integrations.view");
  const scope = `${tenantId}:${fiscalEnvironment}`;
  const [state, setState] = useState<{ scope: string; sales: IntegrationSale[]; failed: boolean } | null>(null);

  useEffect(() => {
    if (!allowed || !tenantId) return;
    let alive = true;
    integrations.pending(fiscalEnvironment)
      .then((sales) => { if (alive) setState({ scope, sales, failed: false }); })
      .catch(() => { if (alive) setState({ scope, sales: [], failed: true }); });
    return () => { alive = false; };
  }, [allowed, tenantId, fiscalEnvironment, scope]);

  if (!allowed) return { sales: [], loading: false, failed: false };
  const current = state?.scope === scope ? state : null;
  return { sales: current?.sales ?? [], loading: current === null, failed: current?.failed ?? false };
}
