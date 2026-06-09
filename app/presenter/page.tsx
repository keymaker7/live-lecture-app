"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { PresentPage } from "@/components/slides-app/PresentPage";

function PresenterContent() {
  const params = useSearchParams();
  const router = useRouter();
  const room = params.get("room");

  useEffect(() => {
    if (!room) router.replace("/");
  }, [room, router]);

  if (!room) return <div className="slide-loading">이동 중...</div>;
  return <PresentPage roomId={room} />;
}

export default function PresenterPage() {
  return (
    <Suspense fallback={<div className="slide-loading">로딩 중...</div>}>
      <PresenterContent />
    </Suspense>
  );
}
