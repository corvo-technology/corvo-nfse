"use client";

import { createContext, useContext } from "react";
import { CLOUD_DEFAULT_CONFIG, type DeploymentConfig } from "@/lib/deployment-config";

const DeploymentConfigContext = createContext<DeploymentConfig>(CLOUD_DEFAULT_CONFIG);

/** Hands the server-read instance config to client components. Without a provider, cloud with billing. */
export function DeploymentConfigProvider({ config, children }: { config: DeploymentConfig; children: React.ReactNode }) {
  return <DeploymentConfigContext.Provider value={config}>{children}</DeploymentConfigContext.Provider>;
}

export const useDeploymentConfig = () => useContext(DeploymentConfigContext);

/** False on a self-hosted instance: no plans, credits, card or Pix anywhere in the dashboard. */
export const useBillingEnabled = () => useDeploymentConfig().billingEnabled;
