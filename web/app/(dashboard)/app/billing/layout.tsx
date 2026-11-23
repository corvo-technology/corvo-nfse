import { redirect } from "next/navigation";
import { fetchDeploymentConfig } from "@/lib/deployment-config";

/** Billing pages do not exist on a self-hosted instance (billing off): go back to the dashboard. */
export default async function BillingLayout({ children }: { children: React.ReactNode }) {
  const config = await fetchDeploymentConfig();
  if (!config.billingEnabled) redirect("/app");
  return children;
}
