import { notFound } from "next/navigation";
import { AdminNav } from "@/components/admin/admin-nav";
import { isPlatformAdminOnServer } from "@/lib/platform-admin-server";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isPlatformAdminOnServer())) notFound();
  return (
    <div className="flex flex-col gap-6">
      <AdminNav />
      {children}
    </div>
  );
}
