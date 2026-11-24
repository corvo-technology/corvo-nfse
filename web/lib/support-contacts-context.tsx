"use client";

import { createContext, useContext } from "react";
import { NO_SUPPORT_CONTACTS, type SupportContacts } from "@/lib/support-contacts";

const SupportContactsContext = createContext<SupportContacts>(NO_SUPPORT_CONTACTS);

/** Hands the server-read support contacts to client components. Without a provider, no contacts. */
export function SupportContactsProvider({ contacts, children }: { contacts: SupportContacts; children: React.ReactNode }) {
  return <SupportContactsContext.Provider value={contacts}>{children}</SupportContactsContext.Provider>;
}

export const useSupportContacts = () => useContext(SupportContactsContext);
