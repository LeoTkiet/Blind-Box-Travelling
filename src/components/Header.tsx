import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import UserButton from "./UserButton";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin", "vietnamese"], display: "swap" });

const TABS = [{ label: "Du lịch hộp mù", href: "/app" }];

export default function Header({ user }: { user: User | null }) {
  return (
    <header className={`${inter.className} flex items-center justify-between px-6 md:px-8 h-[60px] bg-white border-b border-slate-200 flex-shrink-0 z-50 sticky top-0`}>
      
      <Link 
        href="/" 
        className="font-black text-xl text-slate-900 tracking-tighter hover:text-slate-600 transition-colors"
      >
        BBT
      </Link>

      <nav className="flex gap-2">
        {TABS.map((tab) => (
          <Link 
            key={tab.href} 
            href={tab.href} 
            className="px-4 py-2 rounded-full text-[0.7rem] font-bold text-slate-500 uppercase tracking-[0.15em] hover:bg-slate-100 hover:text-slate-900 transition-all"
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center">
        <UserButton user={user} />
      </div>

    </header>
  );
}