import { notFound } from "next/navigation";
import { isPlatformAdminOnServer } from "@/lib/platform-admin-server";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isPlatformAdminOnServer())) notFound();
  return <>{children}</>;
}
