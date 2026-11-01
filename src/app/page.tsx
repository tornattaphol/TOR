import { Suspense } from "react";
import { Dashboard } from "@/components/Dashboard";
import { LoadingState } from "@/components/ui";

export default function HomePage() {
  return (
    <Suspense fallback={<LoadingState label="กำลังเตรียมหน้าแดชบอร์ด…" height={300} />}>
      <Dashboard />
    </Suspense>
  );
}
