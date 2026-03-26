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

  // Close dropdown when clicking outside
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

  // Not logged in
  if (!user) {
    return (
      <Link href="/login" style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.375rem",
        height: "36px",
        padding: "0 1rem",
        borderRadius: "8px",
        border: "1px solid #d1d5db",
        background: "#ffffff",
        color: "#111827",
        fontSize: "0.875rem",
        fontWeight: 500,
        textDecoration: "none",
        transition: "background 0.15s",
        cursor: "pointer",
      }}>
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
    <div ref={dropdownRef} style={{ position: "relative" }}>
      {/* Avatar button */}
      <button
        id="user-avatar-btn"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "36px",
          height: "36px",
          borderRadius: "50%",
          border: "1px solid #d1d5db",
          background: "transparent",
          padding: 0,
          cursor: "pointer",
          overflow: "hidden",
          transition: "box-shadow 0.15s",
        }}
        aria-label="Tài khoản"
      >
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt={displayName}
            width={36}
            height={36}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          /* Anonymous / fallback silhouette */
          <div style={{
            width: "100%", height: "100%",
            background: "#f3f4f6",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: "absolute",
          right: 0,
          top: "calc(100% + 8px)",
          background: "#ffffff",
          border: "1px solid #e5e7eb",
          borderRadius: "10px",
          boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
          minWidth: "180px",
          overflow: "hidden",
          zIndex: 50,
        }}>
          {/* User info */}
          <div style={{ padding: "0.625rem 0.875rem", borderBottom: "1px solid #f3f4f6" }}>
            <p style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600, color: "#111827" }}>
              {isAnonymous ? "Khách ẩn danh" : displayName}
            </p>
            {email && (
              <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {email}
              </p>
            )}
          </div>

          {/* Sign out */}
          <button
            id="btn-sign-out"
            onClick={handleSignOut}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              width: "100%",
              padding: "0.625rem 0.875rem",
              background: "transparent",
              border: "none",
              fontSize: "0.875rem",
              color: "#374151",
              cursor: "pointer",
              textAlign: "left",
              transition: "background 0.1s",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "#f9fafb")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
