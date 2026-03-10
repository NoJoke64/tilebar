import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  Timestamp,
} from "firebase/firestore";

import { db } from "./firebase";

export type GroupMember = {
  uid: string;
  email: string | null;
  displayName: string | null;
};

export type Group = {
  id: string;
  name: string;
  createdBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  memberUids: string[];
  members: GroupMember[];
};

const groupsCollection = collection(db, "groups");

export async function createGroup(params: {
  name: string;
  creator: GroupMember;
}): Promise<Group> {
  const docRef = await addDoc(groupsCollection, {
    name: params.name,
    createdBy: params.creator.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    memberUids: [params.creator.uid],
    members: [params.creator],
  });

  const snapshot = await getDoc(docRef);
  const data = snapshot.data();

  return {
    id: snapshot.id,
    name: String(data?.name ?? ""),
    createdBy: String(data?.createdBy ?? params.creator.uid),
    createdAt: (data?.createdAt as Timestamp) ?? null,
    updatedAt: (data?.updatedAt as Timestamp) ?? null,
    memberUids: (data?.memberUids as string[]) ?? [params.creator.uid],
    members: (data?.members as GroupMember[]) ?? [params.creator],
  };
}

export async function fetchGroupsForUser(uid: string): Promise<Group[]> {
  const groupQuery = query(groupsCollection, where("memberUids", "array-contains", uid));
  const snapshot = await getDocs(groupQuery);

  return snapshot.docs.map((docSnap) => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      name: String(data.name ?? ""),
      createdBy: String(data.createdBy ?? ""),
      createdAt: (data.createdAt as Timestamp) ?? null,
      updatedAt: (data.updatedAt as Timestamp) ?? null,
      memberUids: (data.memberUids as string[]) ?? [],
      members: (data.members as GroupMember[]) ?? [],
    };
  });
}

export function subscribeGroupsForUser(
  uid: string,
  onChange: (groups: Group[]) => void,
  onError?: (error: Error) => void
) {
  const groupQuery = query(groupsCollection, where("memberUids", "array-contains", uid));
  return onSnapshot(
    groupQuery,
    (snapshot) => {
      const groups = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          name: String(data.name ?? ""),
          createdBy: String(data.createdBy ?? ""),
          createdAt: (data.createdAt as Timestamp) ?? null,
          updatedAt: (data.updatedAt as Timestamp) ?? null,
          memberUids: (data.memberUids as string[]) ?? [],
          members: (data.members as GroupMember[]) ?? [],
        };
      });
      onChange(groups);
    },
    (error) => {
      onError?.(error);
    }
  );
}

export async function fetchGroup(groupId: string): Promise<Group | null> {
  const groupRef = doc(groupsCollection, groupId);
  const snapshot = await getDoc(groupRef);
  if (!snapshot.exists()) return null;
  const data = snapshot.data();

  return {
    id: snapshot.id,
    name: String(data.name ?? ""),
    createdBy: String(data.createdBy ?? ""),
    createdAt: (data.createdAt as Timestamp) ?? null,
    updatedAt: (data.updatedAt as Timestamp) ?? null,
    memberUids: (data.memberUids as string[]) ?? [],
    members: (data.members as GroupMember[]) ?? [],
  };
}

export function subscribeGroup(
  groupId: string,
  onChange: (group: Group | null) => void,
  onError?: (error: Error) => void
) {
  const groupRef = doc(groupsCollection, groupId);
  return onSnapshot(
    groupRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        onChange(null);
        return;
      }
      const data = snapshot.data();
      onChange({
        id: snapshot.id,
        name: String(data.name ?? ""),
        createdBy: String(data.createdBy ?? ""),
        createdAt: (data.createdAt as Timestamp) ?? null,
        updatedAt: (data.updatedAt as Timestamp) ?? null,
        memberUids: (data.memberUids as string[]) ?? [],
        members: (data.members as GroupMember[]) ?? [],
      });
    },
    (error) => {
      onError?.(error);
    }
  );
}

export async function joinGroup(params: {
  groupId: string;
  member: GroupMember;
}): Promise<void> {
  const groupRef = doc(groupsCollection, params.groupId);
  const snapshot = await getDoc(groupRef);
  if (!snapshot.exists()) {
    throw new Error("Group not found");
  }

  const data = snapshot.data();
  const existing = (data.memberUids as string[] | undefined) ?? [];
  if (existing.includes(params.member.uid)) {
    return;
  }

  await updateDoc(groupRef, {
    memberUids: arrayUnion(params.member.uid),
    members: arrayUnion(params.member),
    updatedAt: serverTimestamp(),
  });
}

export async function updateMemberProfileInGroups(params: {
  uid: string;
  displayName: string | null;
  email: string | null;
}): Promise<void> {
  const groupQuery = query(groupsCollection, where("memberUids", "array-contains", params.uid));
  const snapshot = await getDocs(groupQuery);

  await Promise.all(
    snapshot.docs.map(async (docSnap) => {
      const data = docSnap.data();
      const members = (data.members as GroupMember[]) ?? [];
      const updatedMembers = members.map((member) =>
        member.uid === params.uid
          ? {
              ...member,
              displayName: params.displayName,
              email: params.email,
            }
          : member
      );

      await updateDoc(docSnap.ref, {
        members: updatedMembers,
        updatedAt: serverTimestamp(),
      });
    })
  );
}
