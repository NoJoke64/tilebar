"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useAuth } from "@/lib/auth-context";

function LogoMark() {
  return (
    <svg
      aria-hidden="true"
      className="h-8 w-8"
      viewBox="0 0 32 32"
      role="img"
    >
      <defs>
        <linearGradient
          id="tilebar-gradient"
          x1="4"
          y1="4"
          x2="28"
          y2="28"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#0ea5e9" />
          <stop offset="100%" stopColor="#10b981" />
        </linearGradient>
      </defs>
      <rect x="3" y="4" width="9" height="9" rx="3" fill="currentColor" />
      <rect
        x="14"
        y="4"
        width="9"
        height="9"
        rx="3"
        fill="currentColor"
        fillOpacity="0.7"
      />
      <rect
        x="3"
        y="15"
        width="9"
        height="9"
        rx="3"
        fill="currentColor"
        fillOpacity="0.85"
      />
      <rect
        x="14"
        y="15"
        width="15"
        height="9"
        rx="4"
        fill="url(#tilebar-gradient)"
      />
    </svg>
  );
}

export default function Navbar() {
  const { user, loading, signOut } = useAuth();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-teal-100/80 bg-white/80 backdrop-blur shadow-sm shadow-teal-100/40">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
        <Link
          href="/dashboard"
          aria-label="Tilebar home"
          className="flex items-center gap-3 text-slate-900"
        >
          <LogoMark />
          <span className="font-brand text-lg leading-none">Tilebar</span>
        </Link>
        <div className="flex items-center" aria-hidden="true" />
        <div className="flex items-center gap-4 text-sm">
          {loading ? (
            <span className="text-slate-600">Loading...</span>
          ) : user ? (
            <>
              <Link href="/settings" className="text-right">
                <div className="font-medium text-slate-900 hover:text-slate-700">
                  {user.displayName ?? "Signed in"}
                </div>
                <div className="text-xs text-slate-600">{user.email}</div>
              </Link>
              <button
                type="button"
                onClick={signOut}
                className="rounded-full border border-teal-200 px-3 py-1 text-sm font-medium text-slate-700 hover:border-teal-300 hover:text-slate-900"
              >
                Sign out
              </button>
            </>
          ) : (
            <Link
              href="/sign-in"
              className="rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:from-teal-400 hover:to-emerald-400"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
