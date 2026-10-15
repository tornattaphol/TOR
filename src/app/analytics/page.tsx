import type { Metadata } from "next";
import { Suspense } from "react";
import { AnalyticsView } from "@/components/AnalyticsView";
import { LoadingState } from "@/components/ui";

export const metadata: Metadata = { title: "วิเคราะห์เชิงลึก" };

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<LoadingState label="กำลังเตรียมหน้า…" height={300} />}>
      <AnalyticsView />
    </Suspense>
  );
}
