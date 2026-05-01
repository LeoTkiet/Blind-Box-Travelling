"use client";

import Link from "next/link";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin", "vietnamese"], display: "swap" });

export default function Home() {
  return (
    <main className={`relative min-h-screen w-full overflow-hidden flex items-center justify-center bg-[#f8fafc] ${inter.className}`}>
      
      <div className="absolute top-[-10%] left-[-5%] w-[600px] h-[600px] bg-[radial-gradient(circle,rgba(203,213,225,0.4)_0%,transparent_70%)] animate-blob pointer-events-none" style={{ willChange: "transform" }}></div>
      <div className="absolute top-[30%] right-[-10%] w-[500px] h-[500px] bg-[radial-gradient(circle,rgba(212,212,216,0.3)_0%,transparent_70%)] animate-blob pointer-events-none" style={{ animationDelay: "3s", willChange: "transform" }}></div>
      <div className="absolute bottom-[-15%] left-[15%] w-[700px] h-[700px] bg-[radial-gradient(circle,rgba(209,213,219,0.3)_0%,transparent_70%)] animate-blob pointer-events-none" style={{ animationDelay: "6s", willChange: "transform" }}></div>

      <div className="relative z-10 w-full max-w-6xl p-6 lg:p-12 flex flex-col md:flex-row items-center justify-between gap-12 md:gap-8">
        
        <div className="flex-1 flex flex-col items-start justify-center">
          <h1 className="text-6xl md:text-7xl lg:text-[6rem] font-black text-slate-900 leading-[1] tracking-tighter">
            BLIND
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-slate-600 to-slate-900">
              BOX
            </span>
            <br />
            TRAVELLING
          </h1>
          <div className="mt-10 h-1 w-24 bg-slate-900 mb-6"></div>
          <p className="text-xl text-slate-600 font-medium max-w-sm leading-relaxed">
            Bạn không chọn điểm đến.
          </p>
          <p className="text-xl text-slate-600 font-medium max-w-sm leading-relaxed">
            Điểm đến chọn bạn.
          </p>
        </div>

        <div className="w-full md:w-[440px] shrink-0">
          <div className="relative p-12 rounded-[2.5rem] bg-white/40 backdrop-blur-2xl border border-white/60 shadow-[0_20px_50px_rgba(0,0,0,0.05)] flex flex-col items-center text-center overflow-hidden">
            
            <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent pointer-events-none"></div>
            
            {/* --- THÊM HÌNH ẢNH HỘP QUÀ VÀO ĐÂY --- */}
            <div className="relative w-full flex justify-center mb-8">
              <img 
                src="/mystery-box.png" 
                alt="Mystery Box" 
                className="w-32 h-32 object-contain drop-shadow-[0_10px_20px_rgba(0,0,0,0.15)] transition-transform duration-500 hover:scale-110 hover:-rotate-3"
              />
            </div>
            
            <p className="relative text-slate-600 mb-12 font-semibold px-4 leading-relaxed opacity-80">
              Bỏ qua lịch trình. Chọn sự ngẫu nhiên.
            </p>

            <Link
              href="/app"
              className="relative w-full group py-5 bg-slate-900 text-white rounded-2xl font-bold text-xl tracking-widest transition-all duration-300 hover:bg-black hover:scale-[1.02] hover:shadow-[0_15px_30px_rgba(0,0,0,0.2)] flex items-center justify-center gap-3"
            >
              START
              <svg className="w-6 h-6 transition-transform duration-300 group-hover:translate-x-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </Link>
          </div>
        </div>

      </div>

      <style>{`
        @keyframes blob {
          0% { transform: translate3d(0px, 0px, 0px) scale(1); }
          50% { transform: translate3d(40px, -60px, 0px) scale(1.05); }
          100% { transform: translate3d(0px, 0px, 0px) scale(1); }
        }
        .animate-blob {
          animation: blob 15s infinite ease-in-out alternate;
        }
      `}</style>
    </main>
  );
}