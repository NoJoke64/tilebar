import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  where,
} from "firebase/firestore";

import { db } from "./firebase";

export type Settlement = {
  id: string;
  groupId: string;
  fromUid: string;
  toUid: string;
  amount: number;
  createdAt: Timestamp | null;
};

const settlementsCollection = collection(db, "settlements");

export async function createSettlement(params: {
  groupId: string;
  fromUid: string;
  toUid: string;
  amount: number;
}): Promise<Settlement> {
  const docRef = await addDoc(settlementsCollection, {
    groupId: params.groupId,
    fromUid: params.fromUid,
    toUid: params.toUid,
    amount: params.amount,
    createdAt: serverTimestamp(),
  });

  const snapshot = await getDoc(docRef);
  const data = snapshot.data();

  return {
    id: docRef.id,
    groupId: params.groupId,
    fromUid: String(data?.fromUid ?? params.fromUid),
    toUid: String(data?.toUid ?? params.toUid),
    amount: Number(data?.amount ?? params.amount),
    createdAt: (data?.createdAt as Timestamp) ?? Timestamp.now(),
  };
}

export async function deleteSettlement(settlementId: string): Promise<void> {
  await deleteDoc(doc(settlementsCollection, settlementId));
}

export function subscribeSettlementsForGroup(
  groupId: string,
  onChange: (settlements: Settlement[]) => void,
  onError?: (error: Error) => void
) {
  const settlementQuery = query(settlementsCollection, where("groupId", "==", groupId));
  return onSnapshot(
    settlementQuery,
    (snapshot) => {
      const settlements = snapshot.docs
        .map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            groupId: String(data.groupId ?? ""),
            fromUid: String(data.fromUid ?? ""),
            toUid: String(data.toUid ?? ""),
            amount: Number(data.amount ?? 0),
            createdAt: (data.createdAt as Timestamp) ?? null,
          };
        })
        .sort((a, b) => {
          const aTime = a.createdAt ? a.createdAt.toMillis() : 0;
          const bTime = b.createdAt ? b.createdAt.toMillis() : 0;
          return bTime - aTime;
        });

      onChange(settlements);
    },
    (error) => {
      onError?.(error);
    }
  );
}
