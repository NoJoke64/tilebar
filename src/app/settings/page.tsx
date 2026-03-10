"use client";

import { useEffect, useState } from "react";

import AuthGuard from "@/components/auth-guard";
import { useAuth } from "@/lib/auth-context";
import { auth } from "@/lib/firebase";
import { updateMemberProfileInGroups } from "@/lib/groups";
import { updateProfile } from "firebase/auth";

export default function SettingsPage() {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(user?.displayName ?? "");
  }, [user]);

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !auth.currentUser) return;

    setSaving(true);
    setError(null);
    setStatus(null);

    try {
      await updateProfile(auth.currentUser, {
        displayName: displayName.trim() || null,
      });

      await updateMemberProfileInGroups({
        uid: user.uid,
        displayName: displayName.trim() || null,
        email: user.email ?? null,
      });

      setStatus("Profile updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthGuard>
      <div className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-emerald-50 px-6 py-16">
        <div className="mx-auto w-full max-w-3xl space-y-8">
          <div className="rounded-3xl border border-teal-100/80 bg-white/90 p-8 shadow-[0_18px_40px_-30px_rgba(20,184,166,0.45)]">
            <h1 className="text-2xl font-semibold text-slate-900">Account settings</h1>
            <p className="mt-2 text-sm text-slate-600">Update your display name.</p>

            <form onSubmit={handleSave} className="mt-6 grid gap-6">
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-500/70">
                  Display name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Your name"
                  className="mt-2 w-full rounded-2xl border border-teal-200 px-4 py-3 text-sm text-slate-900 focus:border-teal-400 focus:outline-none"
                />
              </div>

              {error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              {status ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {status}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={saving}
                className="w-fit rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 px-6 py-3 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300"
              >
                {saving ? "Saving..." : "Save changes"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
