"use client";

import { useEffect, useMemo, useState } from "react";

import AuthGuard from "@/components/auth-guard";
import GroupDetailContent from "@/components/group-detail";
import { useAuth } from "@/lib/auth-context";
import { createGroup, Group, subscribeGroupsForUser } from "@/lib/groups";
import { Expense, fetchLatestExpenseForGroup } from "@/lib/expenses";

function getNickname(name?: string | null, email?: string | null) {
  if (name) return name;
  if (email && email.includes("@")) return email.split("@")[0];
  return "Member";
}

const currencyFormatter = new Intl.NumberFormat("de-AT", {
  style: "currency",
  currency: "EUR",
});

function formatAmount(amount: number) {
  return currencyFormatter.format(amount);
}

export default function DashboardPage() {
  const { user, uid } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [latestByGroup, setLatestByGroup] = useState<Record<string, Expense | null>>({});
  const [loading, setLoading] = useState(true);
  const [formName, setFormName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [inviteGroupId, setInviteGroupId] = useState<string | null>(null);
  const [inviteGroupName, setInviteGroupName] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteAnchor, setInviteAnchor] = useState<{ top: number; left: number } | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [groupModalOpen, setGroupModalOpen] = useState(false);

  const canSubmit = useMemo(() => formName.trim().length > 1 && !!user, [formName, user]);

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    const unsubscribe = subscribeGroupsForUser(
      uid,
      (data) => {
        setGroups(data);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [uid]);

  useEffect(() => {
    if (groups.length === 0) {
      setLatestByGroup({});
      return;
    }
    let cancelled = false;
    const loadLatest = async () => {
      const entries = await Promise.all(
        groups.map(async (group) => {
          try {
            const latest = await fetchLatestExpenseForGroup(group.id);
            return [group.id, latest] as const;
          } catch {
            return [group.id, null] as const;
          }
        })
      );
      if (!cancelled) {
        setLatestByGroup(Object.fromEntries(entries));
      }
    };
    loadLatest();

    return () => {
      cancelled = true;
    };
  }, [groups]);

  const inviteLink = useMemo(() => {
    if (!inviteGroupId || typeof window === "undefined") return "";
    return `${window.location.origin}/join/${inviteGroupId}`;
  }, [inviteGroupId]);

  const inviteLinkShort = useMemo(() => {
    if (!inviteLink) return "";
    if (inviteLink.length <= 36) return inviteLink;
    return `${inviteLink.slice(0, 18)}...${inviteLink.slice(-10)}`;
  }, [inviteLink]);

  const handleCreateGroup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !canSubmit) return;

    setCreating(true);
    setError(null);

    try {
      const newGroup = await createGroup({
        name: formName.trim(),
        creator: {
          uid: user.uid,
          email: user.email ?? null,
          displayName: user.displayName ?? null,
        },
      });
      setGroups((prev) => [newGroup, ...prev]);
      setFormName("");
      setShowCreate(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create group.");
    } finally {
      setCreating(false);
    }
  };

  const handleOpenInvite = (
    event: React.MouseEvent<HTMLButtonElement>,
    groupId: string,
    groupName: string
  ) => {
    event.stopPropagation();
    if (inviteGroupId === groupId) {
      setInviteGroupId(null);
      setInviteGroupName(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const popupWidth = 320;
    const popupHeight = 190;
    const margin = 16;
    const leftCandidate = rect.right - popupWidth;
    const left = Math.min(Math.max(leftCandidate, margin), window.innerWidth - popupWidth - margin);
    const topCandidate = rect.bottom + 8;
    const top =
      topCandidate + popupHeight > window.innerHeight - margin
        ? Math.max(margin, rect.top - popupHeight - 8)
        : topCandidate;

    setInviteAnchor({ top, left });
    setInviteGroupId(groupId);
    setInviteGroupName(groupName);
    setInviteCopied(false);
  };

  const handleCopyInvite = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to copy invite link.");
    }
  };

  useEffect(() => {
    if (!inviteGroupId) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-invite-popup]") || target.closest("[data-invite-trigger]")) return;
      setInviteGroupId(null);
      setInviteGroupName(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [inviteGroupId]);

  useEffect(() => {
    if (!groupModalOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setGroupModalOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [groupModalOpen]);

  useEffect(() => {
    if (!groupModalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [groupModalOpen]);

  useEffect(() => {
    if (groupModalOpen || !activeGroupId) return;
    const timeout = window.setTimeout(() => setActiveGroupId(null), 250);
    return () => window.clearTimeout(timeout);
  }, [groupModalOpen, activeGroupId]);

  const handleOpenGroup = (groupId: string) => {
    setInviteGroupId(null);
    setInviteGroupName(null);
    setActiveGroupId(groupId);
    requestAnimationFrame(() => setGroupModalOpen(true));
  };

  return (
    <AuthGuard>
      <div className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-emerald-50">
        <section className="mx-auto w-full max-w-6xl px-6 py-12">
          <div className="mb-8">
            <h1 className="text-3xl font-semibold text-slate-900">Home</h1>
            <p className="mt-2 text-sm text-slate-600">
              Overview of your groups and the latest payments.
            </p>
          </div>

          {error ? (
            <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="grid gap-5 md:grid-cols-2">
            {loading ? (
              <div className="rounded-3xl border border-teal-100/80 bg-white/90 p-6 shadow-[0_18px_40px_-30px_rgba(20,184,166,0.35)]">
                Loading groups...
              </div>
            ) : groups.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-teal-200 bg-white/90 p-6 text-sm text-slate-600">
                No groups yet. Click the plus button to create one.
              </div>
            ) : (
              groups.map((group) => {
                const latest = latestByGroup[group.id];
                const memberNames = group.members
                  .map((member) => getNickname(member.displayName, member.email))
                  .slice(0, 6);
                const remaining = group.members.length - memberNames.length;

                return (
                  <div
                    key={group.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleOpenGroup(group.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        handleOpenGroup(group.id);
                      }
                    }}
                    className="group relative cursor-pointer rounded-3xl border border-teal-100/80 bg-white/90 p-6 shadow-[0_18px_40px_-30px_rgba(20,184,166,0.35)] transition hover:border-teal-200 hover:shadow-[0_22px_45px_-32px_rgba(16,185,129,0.35)]"
                  >
                    <button
                      type="button"
                      onClick={(event) => handleOpenInvite(event, group.id, group.name)}
                      className="absolute right-5 top-5 rounded-full border border-teal-100 bg-white/90 p-2 text-slate-600 shadow-sm hover:border-teal-200"
                      aria-label="Invite member"
                      data-invite-trigger
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        className="h-5 w-5"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M8.5 12a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm0 0c-3 0-5.5 2.3-5.5 5m10-8a2.5 2.5 0 1 0-2.5-2.5"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M18 18v4m-2-2h4"
                        />
                      </svg>
                    </button>

                    <h2 className="text-xl font-semibold text-slate-900">{group.name}</h2>
                    <p className="mt-2 text-sm text-slate-600">
                      {memberNames.join(", ")}
                      {remaining > 0 ? ` +${remaining}` : ""}
                    </p>

                    <div className="mt-5 rounded-2xl border border-teal-100/70 bg-teal-50/70 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-500/70">
                        Last payment
                      </p>
                      {latest ? (
                        <div className="mt-2 flex items-center justify-between text-sm">
                          <span className="font-medium text-slate-900">
                            {latest.title || "Expense"}
                          </span>
                          <span className="text-slate-700">
                            {formatAmount(latest.amount)}
                          </span>
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-slate-600">No payments yet.</p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <div
          className={`fixed z-40 w-80 rounded-2xl border border-teal-100/80 bg-white/95 p-4 shadow-lg transition-all duration-200 ${
            inviteGroupId
              ? "translate-y-0 scale-100 opacity-100"
              : "pointer-events-none -translate-y-2 scale-95 opacity-0"
          }`}
          style={inviteAnchor ? { top: inviteAnchor.top, left: inviteAnchor.left } : undefined}
          data-invite-popup
        >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-500/70">
                  Invite link
                </p>
                <h3 className="mt-2 text-sm font-semibold text-slate-900">
                  {inviteGroupName ?? "Group"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setInviteGroupId(null);
                  setInviteGroupName(null);
                }}
                className="rounded-full border border-teal-100 p-1 text-slate-600 hover:border-teal-200"
                aria-label="Close invite popup"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.6"
                    d="M6 6l12 12M18 6l-12 12"
                  />
                </svg>
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyInvite}
                className="flex-1 rounded-xl border border-teal-100 bg-teal-50/70 px-3 py-2 text-left text-xs text-slate-600 hover:border-teal-200"
                title={inviteLink}
              >
                {inviteLinkShort || "Invite link unavailable"}
              </button>
              <button
                type="button"
                onClick={handleCopyInvite}
                className="rounded-full border border-teal-100 p-2 text-slate-600 hover:border-teal-200"
                aria-label="Copy invite link"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" stroke="currentColor" fill="none">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.7"
                    d="M9 7h8a2 2 0 0 1 2 2v8m-4 4H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.7"
                    d="M9 3h6a2 2 0 0 1 2 2v2"
                  />
                </svg>
              </button>
            </div>
            {inviteCopied ? (
              <p className="mt-2 text-xs text-emerald-600">Copied to clipboard.</p>
            ) : null}
        </div>

        {activeGroupId ? (
          <div
            className={`fixed inset-0 z-50 flex items-center justify-center px-4 py-6 transition-all duration-300 ${
              groupModalOpen ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
            aria-hidden={!groupModalOpen}
          >
            <div
              className={`absolute inset-0 bg-slate-900/30 transition-all duration-300 ${
                groupModalOpen ? "backdrop-blur-md" : "backdrop-blur-0"
              }`}
              onClick={() => setGroupModalOpen(false)}
            />
            <div
              role="dialog"
              aria-modal="true"
              className={`relative z-10 w-full max-w-6xl overflow-hidden rounded-[32px] border border-teal-100/80 bg-gradient-to-br from-white via-teal-50 to-emerald-50 shadow-2xl transition-all duration-300 ${
                groupModalOpen ? "translate-y-0 scale-100 opacity-100" : "translate-y-6 scale-95 opacity-0"
              }`}
              onClick={(event) => event.stopPropagation()}
              style={{ maxHeight: "90vh" }}
            >
              <button
                type="button"
                onClick={() => setGroupModalOpen(false)}
                className="absolute right-6 top-6 z-10 rounded-full border border-teal-100 bg-white/95 p-2 text-slate-600 shadow-sm hover:border-teal-200"
                aria-label="Close group view"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.6"
                    d="M6 6l12 12M18 6l-12 12"
                  />
                </svg>
              </button>
              <div className="max-h-[90vh] overflow-y-auto px-6 py-8">
                <GroupDetailContent
                  groupId={activeGroupId}
                  onClose={() => setGroupModalOpen(false)}
                  showInviteLink={false}
                />
              </div>
            </div>
          </div>
        ) : null}

        <div className="fixed bottom-6 right-6 z-30 flex flex-col items-end gap-3">
          <div
            className={`w-72 origin-bottom-right rounded-2xl border border-teal-100/80 bg-white/95 p-4 shadow-lg transition-all duration-200 ${
              showCreate
                ? "translate-y-0 scale-100 opacity-100"
                : "pointer-events-none translate-y-2 scale-95 opacity-0"
            }`}
          >
            <form onSubmit={handleCreateGroup} className="flex flex-col gap-3">
              <label className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-500/70">
                New group
              </label>
              <input
                type="text"
                value={formName}
                onChange={(event) => setFormName(event.target.value)}
                placeholder="Group name"
                className="rounded-xl border border-teal-200 px-3 py-2 text-sm text-slate-900 focus:border-teal-400 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!canSubmit || creating}
                className="rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300"
              >
                {creating ? "Creating..." : "Create group"}
              </button>
            </form>
          </div>

          <button
            type="button"
            onClick={() => setShowCreate((prev) => !prev)}
            className={`flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 text-2xl font-semibold text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:from-teal-400 hover:to-emerald-400 active:scale-95 ${
              showCreate ? "rotate-45" : "rotate-0"
            }`}
            aria-label="Create group"
          >
            +
          </button>
        </div>
      </div>
    </AuthGuard>
  );
}
