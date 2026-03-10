import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  where,
} from "firebase/firestore";

import { db } from "./firebase";

export type ExpenseSplit = {
  uid: string;
  amount: number;
};

export type ExpenseLineItem = {
  description: string;
  amount: number;
  participantUids?: string[];
};

export type Expense = {
  id: string;
  groupId: string;
  amount: number;
  title: string;
  description?: string;
  payerUids: string[];
  participantUids: string[];
  split: ExpenseSplit[];
  lineItems?: ExpenseLineItem[];
  createdAt: Timestamp | null;
  receiptUrl?: string | null;
};

const expensesCollection = collection(db, "expenses");

export async function createExpense(params: {
  groupId: string;
  amount: number;
  title: string;
  description?: string;
  payerUids: string[];
  participantUids: string[];
  split: ExpenseSplit[];
  lineItems?: ExpenseLineItem[];
  receiptUrl?: string | null;
}): Promise<Expense> {
  const docRef = await addDoc(expensesCollection, {
    groupId: params.groupId,
    amount: params.amount,
    title: params.title,
    description: params.description ?? "",
    payerUids: params.payerUids,
    participantUids: params.participantUids,
    split: params.split,
    lineItems: params.lineItems ?? [],
    receiptUrl: params.receiptUrl ?? null,
    createdAt: serverTimestamp(),
  });

  const snapshot = await getDoc(docRef);
  const data = snapshot.data();

  return {
    id: docRef.id,
    groupId: params.groupId,
    amount: Number(data?.amount ?? params.amount),
    title: String(data?.title ?? params.title),
    description: String(data?.description ?? params.description ?? ""),
    payerUids: (data?.payerUids as string[]) ?? params.payerUids,
    participantUids: (data?.participantUids as string[]) ?? params.participantUids,
    split: (data?.split as ExpenseSplit[]) ?? params.split,
    lineItems: (data?.lineItems as ExpenseLineItem[]) ?? params.lineItems ?? [],
    createdAt: (data?.createdAt as Timestamp) ?? Timestamp.now(),
    receiptUrl: (data?.receiptUrl as string | null) ?? null,
  };
}

export async function deleteExpense(expenseId: string): Promise<void> {
  await deleteDoc(doc(db, "expenses", expenseId));
}

export async function fetchExpensesForGroup(groupId: string): Promise<Expense[]> {
  const expenseQuery = query(expensesCollection, where("groupId", "==", groupId));
  const snapshot = await getDocs(expenseQuery);

  return snapshot.docs
    .map((docSnap) => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        groupId: String(data.groupId ?? ""),
        amount: Number(data.amount ?? 0),
        title: String(data.title ?? data.description ?? "Expense"),
        description: data.title ? String(data.description ?? "") : "",
        payerUids: Array.isArray(data.payerUids)
          ? (data.payerUids as string[])
          : data.payerUid
            ? [String(data.payerUid)]
            : [],
        participantUids: Array.isArray(data.participantUids)
          ? (data.participantUids as string[])
          : Array.isArray(data.split)
            ? (data.split as ExpenseSplit[]).map((split) => split.uid)
            : [],
        split: (data.split as ExpenseSplit[]) ?? [],
        lineItems: (data.lineItems as ExpenseLineItem[]) ?? [],
        createdAt: (data.createdAt as Timestamp) ?? null,
        receiptUrl: (data.receiptUrl as string | null) ?? null,
      };
    })
    .sort((a, b) => {
      const aTime = a.createdAt ? a.createdAt.toMillis() : 0;
      const bTime = b.createdAt ? b.createdAt.toMillis() : 0;
      return bTime - aTime;
    });
}

export async function fetchLatestExpenseForGroup(groupId: string): Promise<Expense | null> {
  const expenseQuery = query(expensesCollection, where("groupId", "==", groupId));
  const snapshot = await getDocs(expenseQuery);
  if (snapshot.empty) return null;

  let latestDoc = snapshot.docs[0];
  let latestTime =
    (latestDoc.data().createdAt as Timestamp | undefined)?.toMillis?.() ??
    latestDoc.updateTime?.toMillis?.() ??
    0;

  snapshot.docs.forEach((docSnap) => {
    const data = docSnap.data();
    const time =
      (data.createdAt as Timestamp | undefined)?.toMillis?.() ??
      docSnap.updateTime?.toMillis?.() ??
      0;
    if (time > latestTime) {
      latestDoc = docSnap;
      latestTime = time;
    }
  });

  const data = latestDoc.data();
  return {
    id: latestDoc.id,
    groupId: String(data.groupId ?? ""),
    amount: Number(data.amount ?? 0),
    title: String(data.title ?? data.description ?? "Expense"),
    description: data.title ? String(data.description ?? "") : "",
    payerUids: Array.isArray(data.payerUids)
      ? (data.payerUids as string[])
      : data.payerUid
        ? [String(data.payerUid)]
        : [],
    participantUids: Array.isArray(data.participantUids)
      ? (data.participantUids as string[])
      : Array.isArray(data.split)
        ? (data.split as ExpenseSplit[]).map((split) => split.uid)
        : [],
    split: (data.split as ExpenseSplit[]) ?? [],
    lineItems: (data.lineItems as ExpenseLineItem[]) ?? [],
    createdAt: (data.createdAt as Timestamp) ?? null,
    receiptUrl: (data.receiptUrl as string | null) ?? null,
  };
}

export function subscribeExpensesForGroup(
  groupId: string,
  onChange: (expenses: Expense[]) => void,
  onError?: (error: Error) => void
) {
  const expenseQuery = query(expensesCollection, where("groupId", "==", groupId));
  return onSnapshot(
    expenseQuery,
    (snapshot) => {
      const expenses = snapshot.docs
        .map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            groupId: String(data.groupId ?? ""),
            amount: Number(data.amount ?? 0),
            title: String(data.title ?? data.description ?? "Expense"),
            description: data.title ? String(data.description ?? "") : "",
            payerUids: Array.isArray(data.payerUids)
              ? (data.payerUids as string[])
              : data.payerUid
                ? [String(data.payerUid)]
                : [],
            participantUids: Array.isArray(data.participantUids)
              ? (data.participantUids as string[])
              : Array.isArray(data.split)
                ? (data.split as ExpenseSplit[]).map((split) => split.uid)
                : [],
            split: (data.split as ExpenseSplit[]) ?? [],
            lineItems: (data.lineItems as ExpenseLineItem[]) ?? [],
            createdAt: (data.createdAt as Timestamp) ?? null,
            receiptUrl: (data.receiptUrl as string | null) ?? null,
          };
        })
        .sort((a, b) => {
          const aTime = a.createdAt ? a.createdAt.toMillis() : 0;
          const bTime = b.createdAt ? b.createdAt.toMillis() : 0;
          return bTime - aTime;
        });

      onChange(expenses);
    },
    (error) => {
      onError?.(error);
    }
  );
}
