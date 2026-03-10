"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/lib/auth-context";
import { forceTextEmoji, generateEmoji } from "@/lib/emoji";
import {
  createExpense,
  deleteExpense,
  Expense,
  ExpenseLineItem,
  ExpenseSplit,
  subscribeExpensesForGroup,
} from "@/lib/expenses";
import {
  createSettlement,
  deleteSettlement,
  Settlement,
  subscribeSettlementsForGroup,
} from "@/lib/settlements";
import { Group, GroupMember, subscribeGroup } from "@/lib/groups";

function splitAmountEvenly(amount: number, uids: string[]): ExpenseSplit[] {
  if (uids.length === 0) return [];
  const totalCents = Math.round(amount * 100);
  const base = Math.floor(totalCents / uids.length);
  const remainder = totalCents - base * uids.length;

  return uids.map((uid, index) => ({
    uid,
    amount: (base + (index < remainder ? 1 : 0)) / 100,
  }));
}

function splitEvenly(amount: number, members: GroupMember[]) {
  return splitAmountEvenly(
    amount,
    members.map((member) => member.uid)
  );
}

const currencyFormatter = new Intl.NumberFormat("de-AT", {
  style: "currency",
  currency: "EUR",
});

function formatAmount(amount: number) {
  return currencyFormatter.format(amount);
}

function toCents(amount: number) {
  return Math.round(amount * 100);
}

function fromCents(cents: number) {
  return cents / 100;
}

type BalanceRow = {
  member: GroupMember;
  paid: number;
  owed: number;
  net: number;
};

type SettlementSuggestion = {
  from: GroupMember;
  to: GroupMember;
  amount: number;
};

type PairwiseMatrix = {
  members: GroupMember[];
  matrix: number[][];
};

type ParsedReceipt = {
  merchant?: string;
  total?: number;
  currency?: string;
  items?: ExpenseLineItem[];
};

function computeBalances(
  members: GroupMember[],
  expenses: Expense[],
  settlements: Settlement[]
): BalanceRow[] {
  const ledger = new Map<string, { paidCents: number; owedCents: number }>();
  members.forEach((member) => {
    ledger.set(member.uid, { paidCents: 0, owedCents: 0 });
  });

  expenses.forEach((expense) => {
    const payerSplits = splitAmountEvenly(expense.amount, expense.payerUids ?? []);
    payerSplits.forEach((split) => {
      const payer = ledger.get(split.uid);
      if (payer) {
        payer.paidCents += toCents(split.amount);
      }
    });

    if (expense.split.length > 0) {
      expense.split.forEach((split) => {
        const entry = ledger.get(split.uid);
        if (entry) {
          entry.owedCents += toCents(split.amount);
        }
      });
    } else if (members.length > 0) {
      const equalShare = toCents(expense.amount) / members.length;
      members.forEach((member) => {
        const entry = ledger.get(member.uid);
        if (entry) {
          entry.owedCents += equalShare;
        }
      });
    }
  });

  const netCents = new Map<string, number>();
  members.forEach((member) => {
    const entry = ledger.get(member.uid) ?? { paidCents: 0, owedCents: 0 };
    netCents.set(member.uid, entry.paidCents - entry.owedCents);
  });

  settlements.forEach((settlement) => {
    const amountCents = toCents(settlement.amount);
    if (netCents.has(settlement.fromUid)) {
      netCents.set(settlement.fromUid, (netCents.get(settlement.fromUid) ?? 0) + amountCents);
    }
    if (netCents.has(settlement.toUid)) {
      netCents.set(settlement.toUid, (netCents.get(settlement.toUid) ?? 0) - amountCents);
    }
  });

  return members.map((member) => {
    const entry = ledger.get(member.uid) ?? { paidCents: 0, owedCents: 0 };
    return {
      member,
      paid: fromCents(entry.paidCents),
      owed: fromCents(entry.owedCents),
      net: fromCents(netCents.get(member.uid) ?? 0),
    };
  });
}

function simplifyBalances(balances: BalanceRow[]): SettlementSuggestion[] {
  const debtors = balances
    .map((row) => ({ member: row.member, cents: toCents(row.net) }))
    .filter((row) => row.cents < -1)
    .sort((a, b) => a.cents - b.cents);

  const creditors = balances
    .map((row) => ({ member: row.member, cents: toCents(row.net) }))
    .filter((row) => row.cents > 1)
    .sort((a, b) => b.cents - a.cents);

  const suggestions: SettlementSuggestion[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];

    const amount = Math.min(creditor.cents, Math.abs(debtor.cents));
    if (amount > 0) {
      suggestions.push({
        from: debtor.member,
        to: creditor.member,
        amount: fromCents(amount),
      });
      debtor.cents += amount;
      creditor.cents -= amount;
    }

    if (debtor.cents >= -1) debtorIndex += 1;
    if (creditor.cents <= 1) creditorIndex += 1;
  }

  return suggestions;
}

function splitCentsEvenly(totalCents: number, uids: string[]) {
  if (uids.length === 0) return [] as { uid: string; cents: number }[];
  const base = Math.floor(totalCents / uids.length);
  const remainder = totalCents - base * uids.length;
  return uids.map((uid, index) => ({ uid, cents: base + (index < remainder ? 1 : 0) }));
}

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

function computePairwiseMatrix(
  members: GroupMember[],
  expenses: Expense[],
  settlements: Settlement[]
): PairwiseMatrix {
  const size = members.length;
  const indexByUid = new Map(members.map((member, index) => [member.uid, index]));
  const matrixCents: number[][] = Array.from({ length: size }, () => Array(size).fill(0));

  const addDebtCents = (fromUid: string, toUid: string, cents: number) => {
    if (fromUid === toUid || cents === 0) return;
    const fromIndex = indexByUid.get(fromUid);
    const toIndex = indexByUid.get(toUid);
    if (fromIndex === undefined || toIndex === undefined) return;
    matrixCents[fromIndex][toIndex] += cents;
  };

  expenses.forEach((expense) => {
    const payerUids = expense.payerUids.length > 0 ? expense.payerUids : [];
    if (payerUids.length === 0) return;

    let splits: { uid: string; cents: number }[] = [];
    if (expense.split.length > 0) {
      splits = expense.split.map((split) => ({
        uid: split.uid,
        cents: toCents(split.amount),
      }));
    } else if (expense.participantUids.length > 0) {
      splits = splitCentsEvenly(toCents(expense.amount), expense.participantUids);
    } else if (members.length > 0) {
      splits = splitCentsEvenly(
        toCents(expense.amount),
        members.map((member) => member.uid)
      );
    }

    splits.forEach((split) => {
      const payerShares = splitCentsEvenly(split.cents, payerUids);
      payerShares.forEach((share) => {
        addDebtCents(split.uid, share.uid, share.cents);
      });
    });
  });

  settlements.forEach((settlement) => {
    addDebtCents(settlement.fromUid, settlement.toUid, -toCents(settlement.amount));
  });

  // Net out reciprocal debts to show pairwise balances without global simplification.
  const netMatrix: number[][] = Array.from({ length: size }, () => Array(size).fill(0));
  for (let i = 0; i < size; i += 1) {
    for (let j = i + 1; j < size; j += 1) {
      const net = matrixCents[i][j] - matrixCents[j][i];
      if (net > 0) {
        netMatrix[i][j] = net;
      } else if (net < 0) {
        netMatrix[j][i] = Math.abs(net);
      }
    }
  }

  return { members, matrix: netMatrix };
}

type GroupDetailContentProps = {
  groupId: string;
  onClose?: () => void;
  showInviteLink?: boolean;
};

export default function GroupDetailContent({
  groupId,
  onClose,
  showInviteLink = !onClose,
}: GroupDetailContentProps) {
  const { user } = useAuth();
  const [group, setGroup] = useState<Group | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loadingGroup, setLoadingGroup] = useState(true);
  const [loadingExpenses, setLoadingExpenses] = useState(true);
  const [loadingSettlements, setLoadingSettlements] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [emoji, setEmoji] = useState<string | null>(null);
  const [emojiLoading, setEmojiLoading] = useState(false);
  const [formDescription, setFormDescription] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [lineItems, setLineItems] = useState<ExpenseLineItem[]>([]);
  const [payerUids, setPayerUids] = useState<string[]>([]);
  const [participantUids, setParticipantUids] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [recordingKey, setRecordingKey] = useState<string | null>(null);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [deletingExpenseId, setDeletingExpenseId] = useState<string | null>(null);
  const [expandedExpenseId, setExpandedExpenseId] = useState<string | null>(null);
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [addExpenseMounted, setAddExpenseMounted] = useState(false);
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [matrixMounted, setMatrixMounted] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [scanPreviewUrl, setScanPreviewUrl] = useState<string | null>(null);
  const [scanImageBase64, setScanImageBase64] = useState<string | null>(null);
  const [scanParsing, setScanParsing] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const membersPanelId = useId();

  const inviteLink = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/join/${groupId}`;
  }, [groupId]);

  const hasLeadingEmoji = (value: string) =>
    /^(\p{Extended_Pictographic}|\p{Emoji_Presentation})\uFE0E?\s+/u.test(value.trim());

  const totalFromItems = useMemo(() => {
    return lineItems.reduce((sum, item) => sum + item.amount, 0);
  }, [lineItems]);

  const amountValue = Number.parseFloat(formAmount);
  const finalAmount =
    Number.isFinite(totalFromItems) && totalFromItems > 0 ? totalFromItems : amountValue;
  const members = group?.members ?? [];
  const canCreate =
    !!group &&
    members.length > 0 &&
    payerUids.length > 0 &&
    participantUids.length > 0 &&
    Number.isFinite(finalAmount) &&
    finalAmount > 0 &&
    formTitle.trim().length > 1 &&
    hasLeadingEmoji(formTitle) &&
    !!user;

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
    if (!groupId) return;
    setLoadingExpenses(true);
    const unsubscribe = subscribeExpensesForGroup(
      groupId,
      (data) => {
        setExpenses(data);
        setLoadingExpenses(false);
      },
      (err) => {
        setError(err.message);
        setLoadingExpenses(false);
      }
    );

    return () => unsubscribe();
  }, [groupId]);

  useEffect(() => {
    if (!groupId) return;
    setLoadingSettlements(true);
    const unsubscribe = subscribeSettlementsForGroup(
      groupId,
      (data) => {
        setSettlements(data);
        setLoadingSettlements(false);
      },
      (err) => {
        setError(err.message);
        setLoadingSettlements(false);
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
    if (!scanFile) {
      setScanPreviewUrl(null);
      setScanImageBase64(null);
      return;
    }

    const url = URL.createObjectURL(scanFile);
    setScanPreviewUrl(url);

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      setScanImageBase64(base64);
    };
    reader.readAsDataURL(scanFile);

    return () => URL.revokeObjectURL(url);
  }, [scanFile]);

  const handleCopy = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to copy link.");
    }
  };

  const toggleSelection = (
    uid: string,
    list: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    setter((prev) => (prev.includes(uid) ? prev.filter((item) => item !== uid) : [...prev, uid]));
  };

  const closeScan = () => {
    setScanOpen(false);
    setScanFile(null);
    setScanPreviewUrl(null);
    setScanImageBase64(null);
    setScanError(null);
  };

  const openAddExpense = () => {
    setAddExpenseMounted(true);
    requestAnimationFrame(() => setAddExpenseOpen(true));
  };

  const closeAddExpense = () => {
    setAddExpenseOpen(false);
  };

  useEffect(() => {
    if (!addExpenseMounted || addExpenseOpen) return;
    const timeout = window.setTimeout(() => setAddExpenseMounted(false), 300);
    return () => window.clearTimeout(timeout);
  }, [addExpenseMounted, addExpenseOpen]);

  const openMatrix = () => {
    setMatrixMounted(true);
    requestAnimationFrame(() => setMatrixOpen(true));
  };

  const closeMatrix = () => {
    setMatrixOpen(false);
  };

  useEffect(() => {
    if (!matrixMounted || matrixOpen) return;
    const timeout = window.setTimeout(() => setMatrixMounted(false), 300);
    return () => window.clearTimeout(timeout);
  }, [matrixMounted, matrixOpen]);

  const applyEmojiToTitle = (nextEmoji: string, title: string) => {
    const trimmed = title.trim();
    const cleaned = trimmed.replace(
      /^(\p{Extended_Pictographic}|\p{Emoji_Presentation})\uFE0E?\s+/u,
      ""
    );
    return `${nextEmoji} ${cleaned || trimmed}`.trim();
  };

  const handleGenerateEmoji = async (title: string) => {
    const trimmed = title.trim();
    if (!trimmed || emojiLoading) return;
    setEmojiLoading(true);
    try {
      const nextEmoji = await generateEmoji(trimmed);
      if (nextEmoji) {
        const forced = forceTextEmoji(nextEmoji);
        setEmoji(forced);
        setFormTitle((prev) => applyEmojiToTitle(forced, prev || trimmed));
      }
    } catch {
    } finally {
      setEmojiLoading(false);
    }
  };

  const handleScanParse = async () => {
    if (!scanImageBase64 || !scanFile) return;
    setScanParsing(true);
    setScanError(null);

    try {
      const response = await fetch("/api/receipt/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: scanImageBase64,
          mimeType: scanFile.type || "image/jpeg",
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to parse receipt");
      }

      const data = (await response.json()) as ParsedReceipt;
      const nextTitle = data.merchant ?? "Receipt";
      setFormTitle(nextTitle);
      setFormAmount(data.total ? String(data.total) : "");
      setLineItems(
        (data.items ?? []).map((item) => ({
          description: item.description ?? "",
          amount: item.amount ?? 0,
          participantUids: item.participantUids ?? [],
        }))
      );
      void handleGenerateEmoji(nextTitle);
      closeScan();
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Failed to parse receipt.");
    } finally {
      setScanParsing(false);
    }
  };

  const handleCreateExpense = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!group || !user || !canCreate) return;

    setCreating(true);
    setError(null);

    try {
      const selectedMembers = group.members.filter((member) => participantUids.includes(member.uid));
      const split =
        lineItems.length > 0
          ? buildSplitFromLineItems(lineItems, participantUids)
          : splitEvenly(finalAmount, selectedMembers);
      await createExpense({
        groupId: group.id,
        amount: Number(finalAmount.toFixed(2)),
        title: formTitle.trim(),
        description: formDescription.trim(),
        payerUids,
        participantUids,
        split,
        lineItems,
      });

      setFormTitle("");
      setEmoji(null);
      setFormDescription("");
      setFormAmount("");
      setLineItems([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create expense.");
    } finally {
      setCreating(false);
    }
  };

  const handleRecordSettlement = async (suggestion: SettlementSuggestion) => {
    if (!group) return;
    const key = `${suggestion.from.uid}-${suggestion.to.uid}-${suggestion.amount}`;
    setRecordingKey(key);
    setError(null);

    try {
      await createSettlement({
        groupId: group.id,
        fromUid: suggestion.from.uid,
        toUid: suggestion.to.uid,
        amount: Number(suggestion.amount.toFixed(2)),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record settlement.");
    } finally {
      setRecordingKey(null);
    }
  };

  const handleUndoSettlement = async (settlementId: string) => {
    setUndoingId(settlementId);
    setError(null);
    try {
      await deleteSettlement(settlementId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to undo settlement.");
    } finally {
      setUndoingId(null);
    }
  };

  const handleDeleteExpense = async (expenseId: string) => {
    if (!window.confirm("Delete this expense?")) return;
    setDeletingExpenseId(expenseId);
    setError(null);
    try {
      await deleteExpense(expenseId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete expense.");
    } finally {
      setDeletingExpenseId(null);
    }
  };

  const memberLookup = useMemo(() => {
    const map = new Map<string, GroupMember>();
    (group?.members ?? []).forEach((member) => map.set(member.uid, member));
    return map;
  }, [group]);

  const balances = useMemo(
    () => computeBalances(group?.members ?? [], expenses, settlements),
    [group?.members, expenses, settlements]
  );

  const settlementSuggestions = useMemo(() => simplifyBalances(balances), [balances]);
  const settlementSummary = useMemo(() => {
    const total = settlementSuggestions.reduce((sum, item) => sum + item.amount, 0);
    return {
      count: settlementSuggestions.length,
      total,
    };
  }, [settlementSuggestions]);

  const pairwiseMatrix = useMemo(
    () => computePairwiseMatrix(group?.members ?? [], expenses, settlements),
    [group?.members, expenses, settlements]
  );

  const getMemberLabel = (uid: string) => {
    const member = memberLookup.get(uid);
    return member?.displayName ?? member?.email ?? uid;
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <div className="relative rounded-3xl border border-teal-100/80 bg-white/90 p-8 shadow-[0_18px_40px_-30px_rgba(20,184,166,0.35)]">
        {loadingGroup ? (
          <p className="text-slate-600">Loading group...</p>
        ) : group ? (
          <>
            <div className="absolute right-6 top-6">
              <button
                type="button"
                onClick={() => setMembersOpen((prev) => !prev)}
                className="rounded-full border border-teal-100/80 bg-white/95 p-2 text-slate-600 shadow-sm transition hover:border-teal-200"
                aria-label={membersOpen ? "Hide members" : "View members"}
                aria-expanded={membersOpen}
                aria-controls={membersPanelId}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" stroke="currentColor" fill="none">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.7"
                    d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 19a4.5 4.5 0 0 1 9 0m1.5 0a4.5 4.5 0 0 1 9 0"
                  />
                </svg>
              </button>
              {membersOpen ? (
                <div
                  id={membersPanelId}
                  className="absolute right-0 top-full z-10 mt-3 w-64 rounded-2xl border border-teal-100/80 bg-white/95 p-4 text-left text-sm shadow-xl"
                >
                  <div className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-500/70">
                    Members
                  </div>
                  <div className="mt-3 grid gap-2">
                    {group.members.map((member) => (
                      <div
                        key={member.uid}
                        className="rounded-xl border border-teal-100/70 bg-teal-50/60 px-3 py-2"
                      >
                        <div className="font-medium text-slate-900">
                          {member.displayName ?? member.email ?? "Member"}
                        </div>
                        <div className="text-xs text-slate-600">{member.email ?? "No email"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-500/70">
                  Group
                </p>
                <h1 className="mt-3 text-2xl font-semibold text-slate-900">{group.name}</h1>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={handleCopy}
                    disabled={!inviteLink}
                    className="flex-1 text-left text-sm font-semibold text-teal-600 transition hover:text-teal-500 disabled:cursor-not-allowed disabled:text-slate-400"
                  >
                    <span className="break-all">
                      {inviteLink || "Invite link will appear here"}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            {error ? (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <div className="mt-10 flex flex-wrap gap-4">
              {!onClose ? (
                <Link
                  href="/dashboard"
                  className="rounded-full border border-teal-100/80 px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Back to dashboard
                </Link>
              ) : null}
              {showInviteLink ? (
                <Link
                  href={`/join/${group.id}`}
                  className="rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:from-teal-400 hover:to-emerald-400"
                >
                  Open invite page
                </Link>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-slate-900">Group not found</h1>
            <p className="mt-2 text-sm text-slate-600">The group ID may be invalid.</p>
            {!onClose ? (
              <Link
                href="/dashboard"
                className="mt-6 inline-flex rounded-full border border-teal-100/80 px-4 py-2 text-sm font-medium text-slate-700"
              >
                Back to dashboard
              </Link>
            ) : null}
          </>
        )}
      </div>

      <div className="rounded-3xl border border-teal-100/80 bg-white/90 p-8 shadow-[0_18px_40px_-30px_rgba(20,184,166,0.35)]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Simplified payments</h2>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600">
              {settlementSummary.count} transfer{settlementSummary.count === 1 ? "" : "s"} ·{" "}
              {formatAmount(settlementSummary.total)} total
            </span>
            <button
              type="button"
              onClick={openMatrix}
              className="rounded-full border border-teal-100/80 bg-white/90 p-2 text-slate-600 shadow-sm transition hover:border-teal-200"
              aria-label="Open balance matrix"
              title="Open balance matrix"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" stroke="currentColor" fill="none">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.6"
                  d="M4 4h16v16H4zM4 10h16M4 16h16M10 4v16M16 4v16"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          {loadingSettlements ? (
            <div className="rounded-2xl border border-teal-100/80 bg-teal-50/70 p-6 text-sm text-slate-600">
              Loading settlement suggestions...
            </div>
          ) : settlementSuggestions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-teal-100/80 bg-teal-50/70 p-6 text-sm text-slate-600">
              All settled. No transfers needed.
            </div>
          ) : (
            settlementSuggestions.map((suggestion) => {
              const key = `${suggestion.from.uid}-${suggestion.to.uid}-${suggestion.amount}`;
              return (
                <div
                  key={key}
                  className="flex flex-col gap-3 rounded-2xl border border-teal-100/80 bg-teal-50/70 p-5 sm:flex-row sm:items-center"
                >
                  <div className="text-xl font-semibold text-rose-600/90 sm:w-32 sm:flex-shrink-0">
                    {formatAmount(suggestion.amount)}
                  </div>
                  <div className="flex-1 text-sm font-semibold text-slate-900">
                    {suggestion.from.displayName ?? suggestion.from.email ?? "Member"} has to pay{" "}
                    {suggestion.to.displayName ?? suggestion.to.email ?? "Member"}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRecordSettlement(suggestion)}
                    disabled={recordingKey === key}
                    className="rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:from-teal-400 hover:to-emerald-400 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300"
                  >
                    {recordingKey === key ? "recording..." : "record settlement"}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="mt-6 border-t border-teal-100/70 pt-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Recent settlements</h3>
            <span className="text-xs text-slate-600">{settlements.length} total</span>
          </div>
          <div className="mt-3 grid gap-3">
            {settlements.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-teal-100/80 bg-teal-50/70 p-5 text-sm text-slate-600">
                No settlements recorded yet.
              </div>
            ) : (
              settlements.map((settlement) => {
                const from = memberLookup.get(settlement.fromUid);
                const to = memberLookup.get(settlement.toUid);
                return (
                  <div
                    key={settlement.id}
                    className="rounded-2xl border border-teal-100/80 bg-teal-50/70 p-4 text-sm"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-slate-700">
                        {from?.displayName ?? from?.email ?? settlement.fromUid} paid{" "}
                        {to?.displayName ?? to?.email ?? settlement.toUid}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="font-semibold text-slate-900">
                          {formatAmount(settlement.amount)}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleUndoSettlement(settlement.id)}
                          disabled={undoingId === settlement.id}
                          className="rounded-full border border-teal-100/80 px-3 py-1 text-xs font-semibold text-slate-700 hover:border-teal-300 disabled:cursor-not-allowed disabled:bg-slate-100"
                        >
                          {undoingId === settlement.id ? "Undoing..." : "Undo"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-teal-100/80 bg-white/90 p-8 shadow-[0_18px_40px_-30px_rgba(20,184,166,0.35)]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Recent expenses</h2>
          <span className="text-sm text-slate-600">{expenses.length} total</span>
        </div>

        <div className="mt-4 grid gap-4">
          {loadingExpenses ? (
            <div className="rounded-2xl border border-teal-100/80 bg-teal-50/70 p-6 text-sm text-slate-600">
              Loading expenses...
            </div>
          ) : expenses.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-teal-100/80 bg-teal-50/70 p-6 text-sm text-slate-600">
              No expenses yet. Use the + button to add the first one.
            </div>
          ) : (
            expenses.map((expense) => {
              const isExpanded = expandedExpenseId === expense.id;
              const payerNames = expense.payerUids
                .map((uid) => getMemberLabel(uid))
                .filter(Boolean)
                .join(", ");
              const splitLines =
                expense.split.length > 0
                  ? expense.split.map((split) => ({
                      uid: split.uid,
                      amount: split.amount,
                    }))
                  : splitAmountEvenly(expense.amount, expense.participantUids);

              return (
                <div
                  key={expense.id}
                  className={`rounded-2xl border bg-teal-50/70 p-5 transition ${
                    isExpanded
                      ? "border-teal-400 shadow-[0_12px_30px_-24px_rgba(20,184,166,0.5)]"
                      : "border-teal-100/80"
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedExpenseId((prev) => (prev === expense.id ? null : expense.id))
                      }
                      className="flex flex-1 flex-col gap-2 text-left sm:flex-row sm:items-center sm:justify-between"
                      aria-expanded={isExpanded}
                    >
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">
                          {expense.title || "Expense"}
                        </h3>
                        {expense.description ? (
                          <p className="text-sm text-slate-600">{expense.description}</p>
                        ) : null}
                        <p className="text-xs text-slate-700">
                          Paid by {payerNames || "Unknown"}
                        </p>
                      </div>
                      <div className="text-lg font-semibold text-slate-900">
                        {formatAmount(expense.amount)}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteExpense(expense.id)}
                      disabled={deletingExpenseId === expense.id}
                      className="rounded-full border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-600 hover:border-rose-300 hover:text-rose-700 disabled:cursor-not-allowed disabled:bg-slate-100"
                    >
                      {deletingExpenseId === expense.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                  {isExpanded ? (
                    <div className="mt-4 border-t border-teal-100/80 pt-4 text-sm text-slate-600">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-500/70">
                          Split breakdown
                        </div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {splitLines.map((line) => (
                            <div
                              key={`${expense.id}-${line.uid}`}
                              className="flex items-center justify-between rounded-xl border border-teal-100/80 bg-white px-3 py-2"
                            >
                              <span>{getMemberLabel(line.uid)}</span>
                              <span className="font-medium text-slate-900">
                                {formatAmount(line.amount)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                      {expense.lineItems && expense.lineItems.length > 0 ? (
                        <div className="mt-4">
                          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-500/70">
                            Line items
                          </div>
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            {expense.lineItems.map((item, index) => (
                              <div
                                key={`${expense.id}-item-${index}`}
                                className="flex items-center justify-between rounded-xl border border-teal-100/80 bg-white px-3 py-2"
                              >
                                <div>
                                  <div>{item.description}</div>
                                  {item.participantUids && item.participantUids.length > 0 ? (
                                    <div className="text-xs text-teal-500/70">
                                      {item.participantUids
                                        .map((uid) => getMemberLabel(uid))
                                        .join(", ")}
                                    </div>
                                  ) : null}
                                </div>
                                <span className="font-medium text-slate-900">
                                  {formatAmount(item.amount)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>

      {group ? (
        <button
          type="button"
          onClick={openAddExpense}
          className="fixed bottom-6 right-6 z-[45] flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 text-white shadow-lg shadow-emerald-200/60 transition hover:from-teal-400 hover:to-emerald-400"
          aria-label="Add expense"
          title="Add expense"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" stroke="currentColor" fill="none">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 5v14m-7-7h14"
            />
          </svg>
        </button>
      ) : null}

      {addExpenseMounted && group ? (
        <div
          className={`fixed inset-0 z-[55] flex items-center justify-center px-4 py-6 transition-all duration-300 ${
            addExpenseOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          aria-hidden={!addExpenseOpen}
        >
          <div
            className={`absolute inset-0 bg-slate-900/30 transition-all duration-300 ${
              addExpenseOpen ? "backdrop-blur-sm" : "backdrop-blur-0"
            }`}
            onClick={closeAddExpense}
          />
          <div
            className={`relative w-full max-w-5xl overflow-hidden rounded-[32px] border border-teal-100/80 bg-white/95 shadow-2xl transition-all duration-300 ${
              addExpenseOpen ? "translate-y-0 scale-100 opacity-100" : "translate-y-6 scale-95 opacity-0"
            }`}
          >
            <button
              type="button"
              onClick={closeAddExpense}
              className="absolute right-6 top-6 z-10 rounded-full border border-teal-100/80 bg-white/95 p-2 text-slate-600 shadow-sm hover:border-teal-200"
              aria-label="Close add expense"
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
            <div className="max-h-[85vh] overflow-y-auto px-8 py-8">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-500/70">
                    Expenses
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold text-slate-900">Add an expense</h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Select who paid and who participated in the expense.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setScanOpen(true);
                    setScanFile(null);
                    setScanPreviewUrl(null);
                    setScanImageBase64(null);
                    setScanError(null);
                  }}
                  className="inline-flex items-center gap-2 rounded-full border border-teal-100/80 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-teal-300"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" stroke="currentColor" fill="none">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.7"
                      d="M7 4h10a2 2 0 0 1 2 2v14l-3-2-3 2-3-2-3 2V6a2 2 0 0 1 2-2Z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.7"
                      d="M9 8h6M9 12h6M9 16h3"
                    />
                  </svg>
                  <span>Scan receipt</span>
                </button>
              </div>

              <form onSubmit={handleCreateExpense} className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-500/70">
                    Title
                  </label>
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleGenerateEmoji(formTitle)}
                      disabled={!formTitle.trim() || emojiLoading}
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
                      value={formTitle}
                      onChange={(event) => setFormTitle(event.target.value)}
                      placeholder="Dinner at Cafe Sacher"
                      className="flex-1 rounded-2xl border border-teal-100/80 px-4 py-3 text-sm text-slate-900 focus:border-teal-400 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-500/70">
                    Description (optional)
                  </label>
                  <textarea
                    value={formDescription}
                    onChange={(event) => setFormDescription(event.target.value)}
                    placeholder="Optional details or notes"
                    className="mt-2 w-full rounded-2xl border border-teal-100/80 px-4 py-3 text-sm text-slate-900 focus:border-teal-400 focus:outline-none"
                    rows={3}
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-500/70">
                    Amount
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formAmount}
                    onChange={(event) => setFormAmount(event.target.value)}
                    placeholder="0.00"
                    className="mt-2 w-full rounded-2xl border border-teal-100/80 px-4 py-3 text-sm text-slate-900 focus:border-teal-400 focus:outline-none"
                  />
                  <p className="mt-2 text-xs text-slate-600">
                    {totalFromItems > 0
                      ? `Line items total: ${formatAmount(totalFromItems)}`
                      : "Enter the total amount."}
                  </p>
                </div>

                <div className="md:col-span-2">
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
                      className="rounded-full border border-teal-100/80 px-3 py-1 text-xs font-semibold text-slate-700 hover:border-teal-300"
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
                                    idx === index
                                      ? { ...entry, description: event.target.value }
                                      : entry
                                  )
                                )
                              }
                              placeholder="Item description"
                              className="rounded-xl border border-teal-100/80 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400"
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
                              className="rounded-xl border border-teal-100/80 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setLineItems((prev) => prev.filter((_, idx) => idx !== index))
                              }
                              className="rounded-full border border-teal-100/80 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-teal-300"
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
                  <p className="mt-2 text-xs text-slate-600">
                    {payerUids.length > 0 && Number.isFinite(finalAmount) && finalAmount > 0
                      ? `Split paid: ${formatAmount(finalAmount / payerUids.length)} each`
                      : "Select one or more payers"}
                  </p>
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
                  <p className="mt-2 text-xs text-slate-600">
                    {participantUids.length > 0 && Number.isFinite(finalAmount) && finalAmount > 0
                      ? `Split owed: ${formatAmount(finalAmount / participantUids.length)} each`
                      : "Select who participated in the expense"}
                  </p>
                </div>

                <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-4">
                  <p className="text-sm text-slate-600">
                    {payerUids.length > 0 && participantUids.length > 0
                      ? `Payers: ${payerUids.length} · Participants: ${participantUids.length}`
                      : "Select payers and participants"}
                  </p>
                  <button
                    type="submit"
                    disabled={!canCreate || creating}
                    className="rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:from-teal-400 hover:to-emerald-400 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300"
                  >
                    {creating ? "Adding..." : "Add expense"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}

      {matrixMounted && group ? (
        <div
          className={`fixed inset-0 z-[58] flex items-center justify-center px-4 py-6 transition-all duration-300 ${
            matrixOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          aria-hidden={!matrixOpen}
        >
          <div
            className={`absolute inset-0 bg-slate-900/30 transition-all duration-300 ${
              matrixOpen ? "backdrop-blur-sm" : "backdrop-blur-0"
            }`}
            onClick={closeMatrix}
          />
          <div
            className={`relative w-full max-w-5xl overflow-hidden rounded-[32px] border border-teal-100/80 bg-white/95 shadow-2xl transition-all duration-300 ${
              matrixOpen ? "translate-y-0 scale-100 opacity-100" : "translate-y-6 scale-95 opacity-0"
            }`}
          >
            <button
              type="button"
              onClick={closeMatrix}
              className="absolute right-6 top-6 z-10 rounded-full border border-teal-100/80 bg-white/95 p-2 text-slate-600 shadow-sm hover:border-teal-200"
              aria-label="Close balance matrix"
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
            <div className="max-h-[85vh] overflow-y-auto px-8 py-8">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">Balance matrix</h2>
                <span className="text-sm text-slate-600">
                  {pairwiseMatrix.members.length} member
                  {pairwiseMatrix.members.length === 1 ? "" : "s"}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                Each cell shows how much the row member owes the column member.
              </p>

              <div className="mt-4 overflow-x-auto">
                {pairwiseMatrix.members.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-teal-100/80 bg-teal-50/70 p-6 text-sm text-slate-600">
                    No members available to show the matrix.
                  </div>
                ) : (
                  <table className="min-w-full border-separate border-spacing-0 text-sm">
                    <thead>
                      <tr>
                        <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.2em] text-teal-500/70">
                          Owes →
                        </th>
                        {pairwiseMatrix.members.map((member) => (
                          <th
                            key={`col-${member.uid}`}
                            className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.2em] text-teal-500/70"
                          >
                            {member.displayName ?? member.email ?? "Member"}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pairwiseMatrix.members.map((rowMember, rowIndex) => (
                        <tr key={`row-${rowMember.uid}`} className="border-t border-teal-100/70">
                          <td className="sticky left-0 z-10 bg-white px-3 py-3 font-medium text-slate-700">
                            {rowMember.displayName ?? rowMember.email ?? "Member"}
                          </td>
                          {pairwiseMatrix.members.map((colMember, colIndex) => {
                            const amountCents = pairwiseMatrix.matrix[rowIndex][colIndex];
                            const isSelf = rowMember.uid === colMember.uid;
                            return (
                              <td key={`cell-${rowMember.uid}-${colMember.uid}`} className="px-3 py-3">
                                {isSelf ? (
                                  <span className="text-slate-300">—</span>
                                ) : amountCents > 0 ? (
                                  <span className="font-semibold text-rose-600">
                                    {formatAmount(fromCents(amountCents))}
                                  </span>
                                ) : (
                                  <span className="text-teal-500/70">0.00</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {scanOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-6">
          <div
            className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm"
            onClick={closeScan}
          />
          <div className="relative w-full max-w-md rounded-3xl border border-teal-100/80 bg-white/95 p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-500/70">
                  Scan receipt
                </p>
                <h3 className="mt-2 text-lg font-semibold text-slate-900">Upload a file</h3>
                <p className="mt-1 text-sm text-slate-600">
                  We&apos;ll pull the items into the form below.
                </p>
              </div>
              <button
                type="button"
                onClick={closeScan}
                className="rounded-full border border-teal-100/80 p-1 text-slate-600 hover:border-teal-300"
                aria-label="Close receipt scan"
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

            {scanError ? (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {scanError}
              </div>
            ) : null}

            <input
              type="file"
              accept="image/*"
              className="mt-4 text-sm text-slate-700 file:mr-3 file:rounded-full file:border-0 file:bg-teal-50 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-teal-700 hover:file:bg-teal-100"
              onChange={(event) => setScanFile(event.target.files?.[0] ?? null)}
            />
            {scanPreviewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={scanPreviewUrl}
                alt="Receipt preview"
                className="mt-4 max-h-64 rounded-2xl border border-teal-100/80 object-contain"
              />
            ) : null}
            <button
              type="button"
              onClick={handleScanParse}
              disabled={!scanImageBase64 || scanParsing}
              className="mt-4 w-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:from-teal-400 hover:to-emerald-400 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300"
            >
              {scanParsing ? "Parsing..." : "Parse receipt"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
