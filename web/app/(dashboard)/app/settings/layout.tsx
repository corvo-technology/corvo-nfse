import type { ReactNode } from "react";
import { SettingsTabs } from "@/components/settings/settings-tabs";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <SettingsTabs />
      {children}
    </div>
  );
}
