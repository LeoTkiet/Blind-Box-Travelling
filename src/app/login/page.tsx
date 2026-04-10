"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [loadingAnon, setLoadingAnon] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const params = new URLSearchParams(window.location.search);
    if (params.get("error")) {
      setError("Đăng nhập thất bại. Vui lòng thử lại.");
    }
  }, []);

  const handleGoogleLogin = async () => {
    setLoadingGoogle(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setError(error.message);
      setLoadingGoogle(false);
    }
  };

  const handleAnonLogin = async () => {
    setLoadingAnon(true);
    setError(null);
    const { error } = await supabase.auth.signInAnonymously();
    if (error) {
      setError(error.message);
      setLoadingAnon(false);
    } else {
      router.push("/");
      router.refresh();
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 px-4 py-8 font-sans">
      <div className="w-full max-w-[400px] bg-white border border-gray-200 rounded-[24px] p-8 md:p-10 shadow-xl md:shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        {/* Logo */}
        <div className="flex justify-center mb-8 text-gray-900">
          <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" width="42" height="42">
            <circle cx="18" cy="18" r="17" stroke="currentColor" strokeWidth="2" />
            <circle cx="18" cy="18" r="5" fill="currentColor" />
            <line x1="18" y1="1" x2="18" y2="7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="18" y1="29" x2="18" y2="35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="1" y1="18" x2="7" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="29" y1="18" x2="35" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>

        {/* Heading */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-black text-gray-900 tracking-tight mb-2">Blind Box Travelling</h1>
          <p className="text-[15px] text-gray-500 font-medium">Bắt đầu hành trình của bạn.</p>
        </div>

        {/* Error message */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 text-[14px] font-medium mb-6" role="alert">
            {error}
          </div>
        )}

        {/* Buttons */}
        <div className="flex flex-col gap-3.5 mb-8">
          {/* Google Button */}
          <button
            type="button"
            id="btn-google-login"
            className="flex items-center justify-center gap-3 w-full h-[52px] bg-white text-gray-900 border border-gray-200 rounded-2xl text-[15px] font-semibold transition-all hover:bg-gray-50 hover:border-gray-300 hover:shadow-sm disabled:opacity-50 touch-manipulation"
            onClick={handleGoogleLogin}
            disabled={loadingGoogle || loadingAnon}
          >
            {loadingGoogle ? (
              <div className="w-[18px] h-[18px] rounded-full border-2 border-gray-200 border-t-gray-900 animate-spin" />
            ) : (
              <svg className="w-5 h-5 pointer-events-none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            )}
            <span className="pointer-events-none">{loadingGoogle ? "Đang kết nối..." : "Đăng nhập với Google"}</span>
          </button>

          {/* Divider */}
          <div className="flex items-center gap-4 text-gray-400 text-[13px] font-medium my-1">
            <div className="flex-1 h-px bg-gray-200"></div>
            <span>hoặc</span>
            <div className="flex-1 h-px bg-gray-200"></div>
          </div>

          {/* Anonymous Button */}
          <button
            type="button"
            id="btn-anonymous-login"
            className="flex items-center justify-center gap-3 w-full h-[52px] bg-gray-900 text-white rounded-2xl text-[15px] font-semibold transition-all hover:bg-black hover:shadow-md hover:shadow-gray-900/20 disabled:opacity-50 touch-manipulation"
            onClick={handleAnonLogin}
            disabled={loadingGoogle || loadingAnon}
          >
            {loadingAnon ? (
              <div className="w-[18px] h-[18px] rounded-full border-2 border-white/20 border-t-white animate-spin" />
            ) : (
              <svg className="w-5 h-5 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            )}
            <span className="pointer-events-none">{loadingAnon ? "Đang chuẩn bị..." : "Tiếp tục ẩn danh"}</span>
          </button>
        </div>

        {/* Footer */}
        <p className="text-center text-[12px] text-gray-500 font-medium leading-relaxed">
          Bằng việc tiếp tục, bạn đồng ý với<br />
          <a href="#" className="underline text-gray-900 hover:text-black transition-colors decoration-gray-300 underline-offset-2">Điều khoản dịch vụ</a> và <a href="#" className="underline text-gray-900 hover:text-black transition-colors decoration-gray-300 underline-offset-2">Chính sách bảo mật</a>
        </p>
      </div>
    </div>
  );
}
