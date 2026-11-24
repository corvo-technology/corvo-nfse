"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { members, invitations, collectAll, type Member, type Invitation, type InviteResult } from "@/lib/api";
import { timeAgo } from "@/lib/i18n-helpers";
import { AlertTriangle, Check, Mail, UserPlus, Users } from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, DataTableSkeleton, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { useApiErrorText } from "@/lib/use-api-error";

export default function MembersPage() {
  const t = useTranslations("Members");
  const tCommon = useTranslations("Common");
  const apiError = useApiErrorText();
  const [memberList, setMemberList] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("developer");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [pending, setPending] = useState<Invitation[]>([]);
  const [pendingBusyId, setPendingBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await collectAll((cursor) => members.list({ cursor, limit: 1000 }));
      setMemberList(data);
    } catch (err: unknown) {
      setError(apiError(err, t("errors.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const fetchPending = useCallback(async () => {
    try {
      setPending(await invitations.list());
    } catch (err: unknown) {
      setError(apiError(err, t("pending.errors.loadFailed")));
    }
  }, [t]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchMembers(); fetchPending(); }, [fetchMembers, fetchPending]);

  async function handleInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!inviteName.trim() || !inviteEmail || inviting) return;
    setInviting(true);
    setInviteError(null);
    try {
      const result = await members.invite({
        name: inviteName.trim(),
        email: inviteEmail,
        role: inviteRole,
      });
      setInviteResult(result);
      setModalOpen(false);
      fetchPending();
    } catch (err: unknown) {
      setInviteError(apiError(err, t("errors.inviteFailed")));
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(id: string) {
    setRemovingId(id);
    try {
      await members.remove(id);
      setMemberList((prev) => prev.filter((m) => m.id !== id));
    } catch (err: unknown) {
      setError(apiError(err, t("errors.removeFailed")));
    } finally {
      setRemovingId(null);
    }
  }

  async function handleResend(id: string) {
    setPendingBusyId(id);
    setNotice(null);
    try {
      await invitations.resend(id);
      setNotice(t("pending.resent"));
      fetchPending();
    } catch (err: unknown) {
      setError(apiError(err, t("pending.errors.resendFailed")));
    } finally {
      setPendingBusyId(null);
    }
  }

  async function handleRevoke(id: string) {
    setPendingBusyId(id);
    setNotice(null);
    try {
      await invitations.revoke(id);
      setPending((prev) => prev.filter((i) => i.id !== id));
      setNotice(t("pending.revoked"));
    } catch (err: unknown) {
      setError(apiError(err, t("pending.errors.revokeFailed")));
    } finally {
      setPendingBusyId(null);
    }
  }

  const roleVariant: Record<string, BadgeVariant> = { admin: "accent", developer: "gray", billing: "info" };

  const openInvite = () => {
    setModalOpen(true);
    setInviteResult(null);
    setInviteName("");
    setInviteEmail("");
    setInviteRole("developer");
  };

  const columns: Column<Member>[] = [
    {
      id: "person",
      header: t("table.person"),
      primary: true,
      cell: (m) => (
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-border-strong bg-active font-mono text-[12px] text-text-2">
            {(m.name || m.email).slice(0, 1).toUpperCase()}
          </span>
          <div className="flex min-w-0 flex-col">
            {m.name && <span className="truncate text-text">{m.name}</span>}
            <span className={`truncate font-mono text-[12px] ${m.name ? "font-normal text-text-4" : "text-text"}`}>{m.email}</span>
          </div>
        </div>
      ),
    },
    {
      id: "role",
      header: t("table.role"),
      cell: (m) => <Badge variant={roleVariant[m.role] ?? "gray"}>{m.role}</Badge>,
    },
    {
      id: "joined",
      header: t("table.joined"),
      cell: (m) => <span className="text-[13px] text-text-4">{timeAgo(m.createdAt, tCommon)}</span>,
    },
    {
      id: "actions",
      header: tCommon("delete"),
      action: true,
      align: "right",
      cell: (m) => (
        <Button
          variant="danger"
          size="sm"
          onClick={() => handleRemove(m.id)}
          disabled={removingId === m.id}
          aria-label={`${tCommon("delete")}: ${m.name || m.email}`}
        >
          {removingId === m.id ? tCommon("removing") : tCommon("delete")}
        </Button>
      ),
    },
  ];

  const pendingColumns: Column<Invitation>[] = [
    {
      id: "email",
      header: t("pending.email"),
      primary: true,
      cell: (i) => (
        <div className="flex min-w-0 flex-col">
          {i.name && <span className="truncate text-text">{i.name}</span>}
          <span className={`truncate font-mono text-[12px] ${i.name ? "font-normal text-text-4" : "text-text"}`}>{i.email}</span>
        </div>
      ),
    },
    {
      id: "role",
      header: t("table.role"),
      cell: (i) => <Badge variant={roleVariant[i.role] ?? "gray"}>{i.role}</Badge>,
    },
    {
      id: "expires",
      header: t("pending.expires"),
      cell: (i) => i.expired
        ? <Badge variant="gray">{t("pending.expired")}</Badge>
        : <span className="text-[13px] text-text-4">{new Date(i.expiresAt).toLocaleDateString()}</span>,
    },
    {
      id: "actions",
      header: t("pending.actions"),
      action: true,
      align: "right",
      cell: (i) => (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => handleResend(i.id)} disabled={pendingBusyId === i.id}>
            {t("pending.resend")}
          </Button>
          <Button variant="danger" size="sm" onClick={() => handleRevoke(i.id)} disabled={pendingBusyId === i.id}>
            {t("pending.revoke")}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Button variant="accent" onClick={openInvite}>
            <UserPlus size={15} aria-hidden />
            {t("invite")}
          </Button>
        }
      />

      {error && (
        <div role="alert" className="banner banner-danger">
          <AlertTriangle size={16} aria-hidden className="mt-0.5 flex-none" />
          {error}
        </div>
      )}

      {inviteResult && (
        <div role="status" className="banner banner-accent dash-in flex-col">
          <div className="flex items-start gap-2.5">
            <span aria-hidden className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-accent text-bg">
              <Check size={12} strokeWidth={3} />
            </span>
            <span className="text-[13.5px] text-text-2">
              {t("invitationSent", { email: inviteResult.email, role: inviteResult.role })}
            </span>
          </div>
          <p className="text-sm text-text-3">{t("codeLoginHint")}</p>
          <Button variant="ghost" size="sm" className="self-end" onClick={() => setInviteResult(null)}>
            {tCommon("dismiss")}
          </Button>
        </div>
      )}

      <Card className="dash-in dash-in-1 overflow-hidden" aria-live="polite">
        {loading ? (
          <DataTableSkeleton label={t("loading")} />
        ) : memberList.length === 0 ? (
          <EmptyState icon={Users} title={t("noMembers")} />
        ) : (
          <DataTable columns={columns} rows={memberList} rowKey={(m) => m.id} caption={t("title")} />
        )}
      </Card>

      {notice && (
        <div role="status" className="banner banner-accent">
          <Check size={16} aria-hidden className="mt-0.5 flex-none" />
          {notice}
        </div>
      )}

      {pending.length > 0 && (
        <Card className="dash-in dash-in-1 overflow-hidden">
          <div className="flex items-center gap-2 px-4 pt-4 text-[13.5px] text-text-2">
            <Mail size={15} aria-hidden />
            {t("pending.title")}
          </div>
          <DataTable
            columns={pendingColumns}
            rows={pending}
            rowKey={(i) => i.id}
            caption={t("pending.title")}
          />
        </Card>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t("modal.title")}>
        <form className="flex flex-col gap-5" onSubmit={handleInvite}>
          <div className="flex flex-col gap-4">
            <p className="eyebrow">{t("modal.person")}</p>
            <Field label={`${t("modal.fullName")} ${t("modal.fullNameRequired")}`.trim()}>
              {(c) => (
                <input
                  {...c}
                  type="text"
                  autoFocus
                  maxLength={100}
                  required
                  autoComplete="off"
                  placeholder={t("modal.fullNamePlaceholder")}
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  className="field"
                />
              )}
            </Field>
            <Field label={`${t("modal.emailAddress")} ${t("modal.emailAddressRequired")}`.trim()}>
              {(c) => (
                <input
                  {...c}
                  type="email"
                  inputMode="email"
                  required
                  autoComplete="off"
                  placeholder={t("modal.emailPlaceholder")}
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="field"
                />
              )}
            </Field>
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className="eyebrow mb-3">{t("modal.role")}</legend>
            {[
              { value: "admin", label: t("roles.admin.label"), desc: t("roles.admin.desc") },
              { value: "developer", label: t("roles.developer.label"), desc: t("roles.developer.desc") },
              { value: "billing", label: t("roles.billing.label"), desc: t("roles.billing.desc") },
            ].map((role) => (
              <label key={role.value} className="choice">
                <input
                  type="radio"
                  name="role"
                  value={role.value}
                  checked={inviteRole === role.value}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                <span className="flex flex-col">
                  <span className="text-[13.5px] text-text">{role.label}</span>
                  <span className="text-[12px] text-text-4">{role.desc}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {inviteError && (
            <div role="alert" className="banner banner-danger">
              {inviteError}
            </div>
          )}

          <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" variant="accent" loading={inviting} disabled={!inviteName.trim() || !inviteEmail}>
              {inviting ? tCommon("sending") : t("modal.sendInvite")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
