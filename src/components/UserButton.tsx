"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import Image from "next/image";

export default function UserButton({ user }: { user: User | null }) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    setOpen(false);
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  if (!user) {
    return (
      <Link 
        href="/login" 
        className="inline-flex items-center gap-2 h-9 px-5 rounded-full bg-slate-900 text-white text-xs font-bold uppercase tracking-widest hover:bg-black transition-all active:scale-95 shadow-sm"
      >
        Đăng nhập
      </Link>
    );
  }

  const avatarUrl = user.user_metadata?.avatar_url as string | undefined;
  const displayName =
    (user.user_metadata?.full_name as string) ||
    (user.user_metadata?.name as string) ||
    "Người dùng";
  const email = user.email || "";
  const isAnonymous = user.is_anonymous;

  return (
    <div ref={dropdownRef} className="relative">
      {/* Avatar button */}
      <button
        id="user-avatar-btn"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center justify-center w-10 h-10 rounded-full border border-slate-200 bg-slate-50 overflow-hidden hover:shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
        aria-label="Tài khoản"
      >
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt={displayName}
            width={40}
            height={40}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-slate-100 flex items-center justify-center text-slate-500">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
        )}
      </button>

      {/* Dropdown Menu */}
      {open && (
        <div className="absolute right-0 top-[calc(100%+12px)] bg-white border border-slate-100 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.1)] min-w-[220px] overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50">
            <p className="text-sm font-bold text-slate-900 truncate">
              {isAnonymous ? "Khách ẩn danh" : displayName}
            </p>
            {email && (
              <p className="text-xs font-medium text-slate-500 truncate mt-1">
                {email}
              </p>
            )}
          </div>

          <button
            id="btn-sign-out"
            onClick={handleSignOut}
            className="flex items-center gap-3 w-full px-5 py-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:text-red-600 transition-colors text-left"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Đăng xuất
          </button>
        </div>
      )}
    </div>
  );
}