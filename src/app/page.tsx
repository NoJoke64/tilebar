"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

export default function Home() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-emerald-50">
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-20">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-500/70">
            Tilebar MVP
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight text-slate-900 sm:text-5xl">
            Simple, fast expense splitting for groups.
          </h1>
          <p className="mt-4 text-base text-slate-600">
            Tilebar keeps shared costs clear. Sign in with Google to track balances and
            settle up with friends.
          </p>
          <div className="mt-6 flex flex-wrap gap-4">
            {user ? (
              <Link
                href="/dashboard"
                className="rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:from-teal-400 hover:to-emerald-400"
              >
                Go to dashboard
              </Link>
            ) : (
              <Link
                href="/sign-in"
                className="rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:from-teal-400 hover:to-emerald-400"
              >
                Sign in with Google
              </Link>
            )}
            <Link
              href="/sign-in"
              className="rounded-full border border-teal-200 px-5 py-3 text-sm font-semibold text-slate-700 hover:border-teal-300"
            >
              Learn more
            </Link>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            {
              title: "Track groups",
              copy: "Create shared groups and add members by email.",
            },
            {
              title: "Log expenses",
              copy: "Capture who paid and how the cost is split.",
            },
            {
              title: "See balances",
              copy: "Instant summaries of who owes who.",
            },
          ].map((card) => (
            <div
              key={card.title}
              className="rounded-2xl border border-teal-100/80 bg-white/90 p-5 shadow-[0_18px_40px_-30px_rgba(20,184,166,0.45)]"
            >
              <h3 className="text-base font-semibold text-slate-900">{card.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{card.copy}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
