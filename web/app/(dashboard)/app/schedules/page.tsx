import { redirect } from "next/navigation";

/** Schedules live under the notes list now; this keeps old links (e-mails, bookmarks) working. */
export default function SchedulesRedirect() {
  redirect("/app/invoices?filter=scheduled");
}
