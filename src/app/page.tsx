import Image from "next/image";
import Link from "next/link"; // Import Link để chuyển trang không bị reload

export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black min-h-screen">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-center py-32 px-16 bg-white dark:bg-black sm:items-start">

        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left mb-10">
          <h1 className="max-w-xs text-4xl font-bold leading-10 tracking-tight text-black dark:text-zinc-50">
            Blind Box Travelling
          </h1>
          <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            Khám phá những địa điểm bí mật. Hãy đăng nhập để bắt đầu chuyến đi của bạn hoặc tạo phòng nhóm.
          </p>
        </div>

        <div className="flex flex-col gap-4 text-base font-medium sm:flex-row">
          {/* Nút Đăng nhập chuyển hướng sang trang /login */}
          <Link
            href="/login"
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-blue-600 px-8 text-white transition-colors hover:bg-blue-700 md:w-auto"
          >
            Đăng nhập / Đăng ký
          </Link>

          {/* Nút phụ có thể dùng cho chức năng khác sau này */}
          <a
            className="flex h-12 w-full items-center justify-center rounded-full border border-solid border-black/[.08] px-8 transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a] md:w-auto"
            href="#"
          >
            Tìm hiểu thêm
          </a>
        </div>
      </main>
    </div>
  );
}