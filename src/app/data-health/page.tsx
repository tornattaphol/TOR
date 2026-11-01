import type { Metadata } from "next";
import { DataHealthView } from "@/components/DataHealthView";

export const metadata: Metadata = { title: "สุขภาพข้อมูล" };

export default function DataHealthPage() {
  return <DataHealthView />;
}
