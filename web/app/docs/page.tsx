import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function DocsRedirect() {
  const store = await cookies();
  const locale = store.get("NEXT_LOCALE")?.value === "pt" ? "pt" : "en";
  redirect(`/${locale}/docs`);
}
