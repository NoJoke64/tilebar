"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import AuthGuard from "@/components/auth-guard";
import { useAuth } from "@/lib/auth-context";
import { createExpense, ExpenseLineItem } from "@/lib/expenses";
import { forceTextEmoji, generateEmoji } from "@/lib/emoji";
import { Group, subscribeGroup } from "@/lib/groups";

type ParsedReceipt = {
  merchant?: string;
  total?: number;
  currency?: string;
  items?: ExpenseLineItem[];
};

const currencyFormatter = new Intl.NumberFormat("de-AT", {
  style: "currency",
  currency: "EUR",
});

function formatAmount(amount: number) {
  return currencyFormatter.format(amount);
}

function splitAmountEvenly(amount: number, uids: string[]) {
  if (uids.length === 0) return [] as { uid: string; amount: number }[];
  const totalCents = Math.round(amount * 100);
  const base = Math.floor(totalCents / uids.length);
  const remainder = totalCents - base * uids.length;

  return uids.map((uid, index) => ({
    uid,
    amount: (base + (index < remainder ? 1 : 0)) / 100,
  }));
}

function splitCentsEvenly(totalCents: number, uids: string[]) {
  if (uids.length === 0) return [] as { uid: string; cents: number }[];
  const base = Math.floor(totalCents / uids.length);
  const remainder = totalCents - base * uids.length;
  return uids.map((uid, index) => ({ uid, cents: base + (index < remainder ? 1 : 0) }));
}

const hasLeadingEmoji = (value: string) =>
  /^(\p{Extended_Pictographic}|\p{Emoji_Presentation})\uFE0E?\s+/u.test(value.trim());

function buildSplitFromLineItems(
  items: ExpenseLineItem[],
  fallbackParticipantUids: string[]
) {
  const ledger = new Map<string, number>();

  items.forEach((item) => {
    const participants =
      item.participantUids && item.participantUids.length > 0
        ? item.participantUids
        : fallbackParticipantUids;
    if (participants.length === 0) return;
    const cents = Math.round(item.amount * 100);
    splitCentsEvenly(cents, participants).forEach((share) => {
      ledger.set(share.uid, (ledger.get(share.uid) ?? 0) + share.cents);
    });
  });

  return Array.from(ledger.entries()).map(([uid, cents]) => ({
    uid,
    amount: cents / 100,
  }));
}

export default function ScanReceiptPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { user } = useAuth();
  const router = useRouter();

  const [group, setGroup] = useState<Group | null>(null);
  const [loadingGroup, setLoadingGroup] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedReceipt | null>(null);
  const [title, setTitle] = useState("");
  const [emoji, setEmoji] = useState<string | null>(null);
  const [emojiLoading, setEmojiLoading] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [lineItems, setLineItems] = useState<ExpenseLineItem[]>([]);
  const [payerUids, setPayerUids] = useState<string[]>([]);
  const [participantUids, setParticipantUids] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const members = group?.members ?? [];

  useEffect(() => {
    if (!groupId) return;
    setLoadingGroup(true);
    const unsubscribe = subscribeGroup(
      groupId,
      (data) => {
        setGroup(data);
        setLoadingGroup(false);
      },
      (err) => {
        setError(err.message);
        setLoadingGroup(false);
      }
    );

    return () => unsubscribe();
  }, [groupId]);

  useEffect(() => {
    if (!group?.members?.length) return;
    const memberIds = new Set(group.members.map((member) => member.uid));

    setPayerUids((prev) => {
      const filtered = prev.filter((uid) => memberIds.has(uid));
      if (filtered.length > 0) return filtered;
      const fallback = user?.uid && memberIds.has(user.uid) ? user.uid : group.members[0].uid;
      return fallback ? [fallback] : [];
    });

    setParticipantUids((prev) => {
      const filtered = prev.filter((uid) => memberIds.has(uid));
      if (filtered.length > 0) return filtered;
      return group.members.map((member) => member.uid);
    });
  }, [group, user]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      setImageBase64(null);
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      setImageBase64(base64);
    };
    reader.readAsDataURL(file);

    return () => URL.revokeObjectURL(url);
  }, [file]);

  const totalFromItems = useMemo(() => {
    return lineItems.reduce((sum, item) => sum + item.amount, 0);
  }, [lineItems]);

  const amountValue = Number.parseFloat(amount);
  const finalAmount = Number.isFinite(amountValue) && amountValue > 0 ? amountValue : totalFromItems;

  const canSave =
    !!group &&
    !!user &&
    title.trim().length > 1 &&
    hasLeadingEmoji(title) &&
    finalAmount > 0 &&
    payerUids.length > 0 &&
    participantUids.length > 0;

  const toggleSelection = (
    uid: string,
    list: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    setter((prev) => (prev.includes(uid) ? prev.filter((item) => item !== uid) : [...prev, uid]));
  };

  const applyEmojiToTitle = (nextEmoji: string, value: string) => {
    const trimmed = value.trim();
    const cleaned = trimmed.replace(
      /^(\p{Extended_Pictographic}|\p{Emoji_Presentation})\uFE0E?\s+/u,
      ""
    );
    return `${nextEmoji} ${cleaned || trimmed}`.trim();
  };

  const handleGenerateEmoji = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || emojiLoading) return;
    setEmojiLoading(true);
    try {
      const nextEmoji = await generateEmoji(trimmed);
      if (nextEmoji) {
        const forced = forceTextEmoji(nextEmoji);
        setEmoji(forced);
        setTitle((prev) => applyEmojiToTitle(forced, prev || trimmed));
      }
    } catch {
    } finally {
      setEmojiLoading(false);
    }
  };

  const handleParse = async () => {
    if (!imageBase64 || !file) return;
    setParsing(true);
    setError(null);

    try {
      const response = await fetch("/api/receipt/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64,
          mimeType: file.type || "image/jpeg",
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to parse receipt");
      }

      const data = (await response.json()) as ParsedReceipt;
      setParsed(data);
      const nextTitle = data.merchant ?? "Receipt";
      setTitle(nextTitle);
      setAmount(data.total ? String(data.total) : "");
      setLineItems(
        (data.items ?? []).map((item) => ({
          description: item.description ?? "",
          amount: item.amount ?? 0,
          participantUids: item.participantUids ?? [],
        }))
      );
      void handleGenerateEmoji(nextTitle);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse receipt.");
    } finally {
      setParsing(false);
    }
  };

  const handleSave = async () => {
    if (!group || !user || !canSave) return;
    setSaving(true);
    setError(null);

    try {
      const split =
        lineItems.length > 0
          ? buildSplitFromLineItems(lineItems, participantUids)
          : splitAmountEvenly(finalAmount, participantUids);
      await createExpense({
        groupId: group.id,
        amount: Number(finalAmount.toFixed(2)),
        title: title.trim(),
        description: description.trim(),
        payerUids,
        participantUids,
        split,
        lineItems,
        receiptUrl: null,
      });

      router.push(`/groups/${group.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save expense.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthGuard>
      <div className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-emerald-50 px-6 py-16">
        <div className="mx-auto w-full max-w-4xl space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Scan receipt</h1>
              <p className="mt-2 text-sm text-slate-600">
                Upload a receipt, review the items, then save the expense.
              </p>
            </div>
            <Link
              href={`/groups/${groupId}`}
              className="rounded-full border border-teal-100/80 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-teal-300"
            >
              Back to group
            </Link>
          </div>

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}
          {loadingGroup ? (
            <div className="rounded-xl border border-teal-100/80 bg-teal-50/70 px-4 py-3 text-sm text-slate-600">
              Loading group...
            </div>
          ) : null}

          <div className="rounded-3xl border border-teal-100/80 bg-white/90 p-8 shadow-[0_18px_40px_-30px_rgba(20,184,166,0.35)]">
            <label className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-500/70">
              Receipt image
            </label>
            <input
              type="file"
              accept="image/*"
              className="mt-3 text-sm"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Receipt preview"
                className="mt-4 max-h-80 rounded-2xl border border-teal-100/80 object-contain"
              />
            ) : null}
            <button
              type="button"
              onClick={handleParse}
              disabled={!imageBase64 || parsing}
              className="mt-4 rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:from-teal-400 hover:to-emerald-400 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300"
            >
              {parsing ? "Parsing..." : "Parse receipt"}
            </button>
          </div>

          <div className="rounded-3xl border border-teal-100/80 bg-white/90 p-8 shadow-[0_18px_40px_-30px_rgba(20,184,166,0.35)]">
            <h2 className="text-lg font-semibold text-slate-900">Review details</h2>
            <p className="mt-2 text-sm text-slate-600">
              Adjust the parsed result before saving.
            </p>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-500/70">
                  Title
                </label>
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleGenerateEmoji(title)}
                    disabled={!title.trim() || emojiLoading}
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-teal-100/80 bg-white/95 text-lg text-slate-700 shadow-sm transition hover:border-teal-200 disabled:cursor-not-allowed disabled:bg-slate-100"
                    aria-label="Generate emoji"
                    title="Generate emoji"
                  >
                    {emojiLoading ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-teal-500" />
                    ) : emoji ? (
                      <span>{emoji}</span>
                    ) : (
                      <svg viewBox="0 0 24 24" className="h-5 w-5" stroke="currentColor" fill="none">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.8"
                          d="M12 5v14m-7-7h14"
                        />
                      </svg>
                    )}
                  </button>
                  <input
                    type="text"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="flex-1 rounded-2xl border border-teal-100/80 px-4 py-3 text-sm text-slate-900"
                  />
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-500/70">
                  Description (optional)
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-teal-100/80 px-4 py-3 text-sm text-slate-900"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-500/70">
                  Total amount
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-teal-100/80 px-4 py-3 text-sm text-slate-900"
                />
                <p className="mt-2 text-xs text-slate-600">
                  Parsed total: {parsed?.total ? formatAmount(parsed.total) : "—"} · Line item total: {formatAmount(totalFromItems)}
                </p>
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-500/70">
                  Line items
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setLineItems((prev) => [
                      ...prev,
                      { description: "", amount: 0, participantUids: [] },
                    ])
                  }
                  className="rounded-full border border-teal-100/80 px-3 py-1 text-xs font-semibold text-slate-700"
                >
                  Add item
                </button>
              </div>
              <div className="mt-3 grid gap-3">
                {lineItems.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-teal-100/80 bg-teal-50/70 p-4 text-sm text-slate-600">
                    No line items yet.
                  </div>
                ) : (
                  lineItems.map((item, index) => (
                    <div
                      key={`line-${index}`}
                      className="grid gap-3 rounded-2xl border border-teal-100/80 bg-teal-50/70 p-4"
                    >
                      <div className="grid gap-3 md:grid-cols-[2fr_1fr_auto]">
                        <input
                          type="text"
                          value={item.description}
                          onChange={(event) =>
                            setLineItems((prev) =>
                              prev.map((entry, idx) =>
                                idx === index ? { ...entry, description: event.target.value } : entry
                              )
                            )
                          }
                          placeholder="Item description"
                          className="rounded-xl border border-teal-100/80 px-3 py-2 text-sm"
                        />
                        <input
                          type="number"
                          step="0.01"
                          value={item.amount}
                          onChange={(event) =>
                            setLineItems((prev) =>
                              prev.map((entry, idx) =>
                                idx === index
                                  ? { ...entry, amount: Number(event.target.value) || 0 }
                                  : entry
                              )
                            )
                          }
                          className="rounded-xl border border-teal-100/80 px-3 py-2 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setLineItems((prev) => prev.filter((_, idx) => idx !== index))
                          }
                          className="rounded-full border border-teal-100/80 px-3 py-2 text-xs font-semibold text-slate-700"
                        >
                          Remove
                        </button>
                      </div>
                      <div className="rounded-2xl border border-teal-100/80 bg-white p-3 text-sm">
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-500/70">
                          Participants for this item
                        </div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {members.map((member) => {
                            const selected = item.participantUids ?? [];
                            return (
                              <label
                                key={member.uid}
                                className="flex items-center gap-2 text-slate-800"
                              >
                                <input
                                  type="checkbox"
                                  checked={selected.includes(member.uid)}
                                  onChange={() =>
                                    setLineItems((prev) =>
                                      prev.map((entry, idx) => {
                                        if (idx !== index) return entry;
                                        const current = entry.participantUids ?? [];
                                        const next = current.includes(member.uid)
                                          ? current.filter((uid) => uid !== member.uid)
                                          : [...current, member.uid];
                                        return { ...entry, participantUids: next };
                                      })
                                    )
                                  }
                                  className="checkbox-tilebar"
                                />
                                <span>{member.displayName ?? member.email ?? member.uid}</span>
                              </label>
                            );
                          })}
                        </div>
                        <p className="mt-2 text-xs text-slate-600">
                          If none are selected, this item uses the overall participants.
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-500/70">
                  Paid by
                </label>
                <div className="mt-2 grid gap-2 rounded-2xl border border-teal-100/80 p-3 text-sm">
                  {members.map((member) => (
                    <label key={member.uid} className="flex items-center gap-2 text-slate-800">
                      <input
                        type="checkbox"
                        checked={payerUids.includes(member.uid)}
                        onChange={() => toggleSelection(member.uid, payerUids, setPayerUids)}
                        className="checkbox-tilebar"
                      />
                      <span>{member.displayName ?? member.email ?? member.uid}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-500/70">
                  Participants
                </label>
                <div className="mt-2 grid gap-2 rounded-2xl border border-teal-100/80 p-3 text-sm">
                  {members.map((member) => (
                    <label key={member.uid} className="flex items-center gap-2 text-slate-800">
                      <input
                        type="checkbox"
                        checked={participantUids.includes(member.uid)}
                        onChange={() =>
                          toggleSelection(member.uid, participantUids, setParticipantUids)
                        }
                        className="checkbox-tilebar"
                      />
                      <span>{member.displayName ?? member.email ?? member.uid}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave || saving}
              className="mt-6 rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:from-teal-400 hover:to-emerald-400 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300"
            >
              {saving ? "Saving..." : "Save expense"}
            </button>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
