import { redirect } from "next/navigation";

// Stripe's cancel_url lands here; nothing was charged, so go back to the plans.
export default function BillingCancelPage() {
  redirect("/app/billing");
}
