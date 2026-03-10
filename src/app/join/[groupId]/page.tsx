"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import AuthGuard from "@/components/auth-guard";
import { useAuth } from "@/lib/auth-context";
import { fetchGroup, joinGroup, Group } from "@/lib/groups";

export default function JoinGroupPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { user } = useAuth();
  const router = useRouter();

  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const data = await fetchGroup(groupId);
        setGroup(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load group.");
      } finally {
        setLoading(false);
      }
    };

    if (groupId) {
      load();
    }
  }, [groupId]);

  const handleJoin = async () => {
    if (!user || !groupId) return;
    setJoining(true);
    setError(null);

    try {
      await joinGroup({
        groupId,
        member: {
          uid: user.uid,
          email: user.email ?? null,
          displayName: user.displayName ?? null,
        },
      });
      setJoined(true);
      setTimeout(() => router.push(`/groups/${groupId}`), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join group.");
    } finally {
      setJoining(false);
    }
  };

  return (
    <AuthGuard>
      <div className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-emerald-50 px-6 py-16">
        <div className="mx-auto w-full max-w-xl rounded-3xl border border-teal-100/80 bg-white/90 p-8 shadow-[0_18px_40px_-30px_rgba(20,184,166,0.45)]">
          {loading ? (
            <p className="text-slate-600">Loading invite...</p>
          ) : group ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-500/70">
                Group invite
              </p>
              <h1 className="mt-4 text-2xl font-semibold text-slate-900">
                Join {group.name}
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                {group.members.length} member{group.members.length === 1 ? "" : "s"} already in this group.
              </p>

              {error ? (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              {joined ? (
                <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  You&apos;re in! Redirecting to the group...
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleJoin}
                  disabled={joining}
                  className="mt-6 rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 px-5 py-3 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300"
                >
                  {joining ? "Joining..." : "Join group"}
                </button>
              )}

              <div className="mt-6 text-sm">
                <Link href="/dashboard" className="text-slate-600 hover:text-teal-600">
                  Back to dashboard
                </Link>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-semibold text-slate-900">Group not found</h1>
              <p className="mt-2 text-sm text-slate-600">
                The invite link may be invalid or expired.
              </p>
              <Link
                href="/dashboard"
                className="mt-6 inline-flex rounded-full border border-teal-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-teal-300"
              >
                Back to dashboard
              </Link>
            </>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
