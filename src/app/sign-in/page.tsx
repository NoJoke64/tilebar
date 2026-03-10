"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function SignInPage() {
  const { user, loading, signInWithGoogle } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.replace("/dashboard");
    }
  }, [loading, user, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-teal-50 via-white to-emerald-50 px-6">
      <div className="w-full max-w-md rounded-3xl border border-teal-100/80 bg-white/90 p-8 shadow-[0_18px_40px_-30px_rgba(20,184,166,0.45)]">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-500/70">
            Tilebar MVP
          </p>
          <h1 className="mt-3 text-3xl font-semibold text-slate-900">
            Sign in to manage shared expenses
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Use your Google account to access your groups and balances.
          </p>
        </div>
        <button
          type="button"
          onClick={() => signInWithGoogle()}
          className="flex w-full items-center justify-center gap-3 rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:from-teal-400 hover:to-emerald-400"
        >
          Sign in with Google
        </button>
        <p className="mt-4 text-xs text-slate-600">
          By signing in you agree to Tilebar&apos;s terms and privacy policy.
        </p>
      </div>
    </div>
  );
}
