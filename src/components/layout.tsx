"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { REQUIRED_WARNING, SHORT_DISCLAIMER } from "@/lib/disclaimer";

const NAV = [
  { href: "/", label: "ภาพรวม" },
  { href: "/analytics", label: "วิเคราะห์เชิงลึก" },
  { href: "/forecasting", label: "ประเมินโมเดล (ทดลอง)" },
  { href: "/data-health", label: "สุขภาพข้อมูล" },
  { href: "/about", label: "เกี่ยวกับ/วิธีการ" },
];

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "dark" ? "dark" : "light");
  }, []);
  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // storage may be blocked; the choice then lasts for this visit only
    }
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "สลับเป็นโหมดสว่าง" : "สลับเป็นโหมดมืด"}
      className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm text-fg-2 hover:bg-surface-2"
    >
      <span aria-hidden>{theme === "dark" ? "☀" : "☾"}</span>
      <span className="hidden sm:inline">{theme === "dark" ? "โหมดสว่าง" : "โหมดมืด"}</span>
    </button>
  );
}

export function Header() {
  const pathname = usePathname();
  return (
    <header className="z-30 border-b border-line bg-surface/95 backdrop-blur sm:sticky sm:top-0">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="text-base font-semibold text-fg">
          Lao Lottery Statistics
          <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 align-middle text-xs font-normal text-fg-2">เพื่อการศึกษา</span>
        </Link>
        <div className="flex items-center gap-2">
          <nav aria-label="เมนูหลัก" className="flex flex-wrap gap-1">
            {NAV.map((n) => {
              const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-lg px-3 py-1.5 text-sm ${active ? "bg-accent-soft text-fg font-medium" : "text-fg-2 hover:bg-surface-2"}`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl space-y-2 px-4 py-6 text-sm text-fg-2">
        <p className="font-medium text-fg">{REQUIRED_WARNING}</p>
        <p>{SHORT_DISCLAIMER}</p>
        <p className="text-fg-3">
          ทุกรายการข้อมูลระบุแหล่งที่มา (source URL) และเวลาที่ดึงข้อมูล — ดูรายละเอียดข้อจำกัดของแหล่งข้อมูลที่หน้า{" "}
          <Link href="/about" className="text-accent underline">
            เกี่ยวกับ/วิธีการ
          </Link>
        </p>
      </div>
    </footer>
  );
}
