"use client";

import { useParams } from "next/navigation";

import AuthGuard from "@/components/auth-guard";
import GroupDetailContent from "@/components/group-detail";

export default function GroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>();

  return (
    <AuthGuard>
      <div className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-emerald-50 px-6 py-16">
        <GroupDetailContent groupId={groupId} />
      </div>
    </AuthGuard>
  );
}
