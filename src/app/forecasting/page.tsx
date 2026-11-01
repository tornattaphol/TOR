import type { Metadata } from "next";
import { ForecastingView } from "@/components/ForecastingView";

export const metadata: Metadata = { title: "ประเมินโมเดล (ทดลอง)" };

export default function ForecastingPage() {
  return <ForecastingView />;
}
