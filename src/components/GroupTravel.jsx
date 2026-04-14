'use client'; 

import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
//1. KHỞI TẠO SUPABASE CLIENT

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

export default function GroupRoom() {
  // --- STATE MANAGEMENT  ---
  const [userId, setUserId] = useState(null); // Lưu ID ẩn danh
  const [roomCode, setRoomCode] = useState(''); // Mã phòng hiện tại
  const [inputCode, setInputCode] = useState(''); // Mã người dùng nhập vào ô text
  const [members, setMembers] = useState([]); // Mảng chứa danh sách thành viên

  // --- 1.1: ĐĂNG NHẬP ẨN DANH NGAY KHI MỞ TRANG ---
  // Chạy đúng 1 lần khi component được tạo 
  useEffect(() => {
    if (!supabase) return;

    const loginAnonymously = async () => {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) {
        console.error('Lỗi đăng nhập ẩn danh:', error.message);
      } else if (data?.user) {
        // Lưu lại ID của user để vào phòng
        setUserId(data.user.id); 
      }
    };
    loginAnonymously();
  }, []);

  // --- TẠO MÃ PHÒNG NGẪU NHIÊN ---
  const handleCreateRoom = () => {
    // Sinh chuỗi ngẫu nhiên 5 ký tự 
    const newCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    setRoomCode(newCode);
  };

  const handleJoinRoom = () => {
    const normalizedCode = inputCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (normalizedCode.length === 5) {
      setRoomCode(normalizedCode);
    } else {
      alert("Mã phòng phải có 5 ký tự!");
    }
  };

  // --- 2: KẾT NỐI REALTIME (PHẦN ĂN TIỀN CỦA DEV 6) ---
  useEffect(() => {
    // Nếu chưa có mã phòng hoặc chưa có ID thì không làm gì cả
    if (!roomCode || !userId || !supabase) return;

    // Khởi tạo kênh chat riêng cho cái phòng này
    const roomChannel = supabase.channel(`room_${roomCode}`, {
      config: {
        presence: { key: userId }, // Định danh tôi là ai trong phòng
      },
    });

    // Lắng nghe sự kiện: Có người vào/ra phòng
    roomChannel.on('presence', { event: 'sync' }, () => {
      const state = roomChannel.presenceState();
      // Chuyển mảng object phức tạp thành mảng đơn giản để render UI
      const currentMembers = Object.keys(state).map((key) => state[key][0]);
      setMembers(currentMembers);
    });

    // Bắt đầu kết nối (Subscribe)
    roomChannel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        // Nếu kết nối thành công, báo danh với anh em trong phòng
        await roomChannel.track({
          user_id: userId,
          joined_at: new Date().toLocaleTimeString(),
          status: 'Đang chờ...',
        });
      }
    });

    // CLEANUP FUNCTION (Giống hàm Hủy - Destructor trong C++)
    // Chạy khi người dùng thoát Component hoặc đổi mã phòng khác
    return () => {
      supabase.removeChannel(roomChannel); // Hủy lắng nghe, giải phóng bộ nhớ!
    };
  }, [roomCode, userId]); // Effect này sẽ chạy lại nếu roomCode hoặc userId thay đổi

  // --- GIAO DIỆN (UI) ---
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-10 px-4 font-sans">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-6">
        <h1 className="text-2xl font-bold text-center text-indigo-600 mb-6">
          Blind Box Travelling 🎒
        </h1>

        {!supabase && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Thiếu cấu hình Supabase. Hãy thêm NEXT_PUBLIC_SUPABASE_URL và một trong hai key: NEXT_PUBLIC_SUPABASE_ANON_KEY hoặc NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY trong .env.local.
          </div>
        )}

        {/* Nếu chưa có phòng -> Hiển thị màn hình Tạo/Vào phòng */}
        {!roomCode ? (
          <div className="space-y-6">
            <button 
              onClick={handleCreateRoom}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-xl transition duration-200 shadow-md"
            >
              ✨ Tạo Phòng Mới
            </button>
            
            <div className="relative flex py-2 items-center">
              <div className="flex-grow border-t border-gray-300"></div>
              <span className="flex-shrink-0 mx-4 text-gray-400">hoặc</span>
              <div className="flex-grow border-t border-gray-300"></div>
            </div>

            <div className="flex gap-2">
              <input 
                type="text" 
                placeholder="Nhập mã phòng (5 ký tự)" 
                className="flex-1 border-2 border-gray-200 rounded-xl px-4 py-2 uppercase focus:border-indigo-500 focus:outline-none"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                maxLength={5}
              />
              <button 
                onClick={handleJoinRoom}
                className="bg-gray-800 hover:bg-gray-900 text-white font-bold py-2 px-6 rounded-xl transition duration-200"
              >
                Vào
              </button>
            </div>
          </div>
        ) : (
          /* Nếu đã vào phòng -> Hiển thị phòng chờ */
          <div className="space-y-4">
            <div className="bg-indigo-50 border-2 border-indigo-100 rounded-xl p-4 text-center">
              <p className="text-sm text-indigo-400 font-semibold mb-1">MÃ PHÒNG CỦA BẠN</p>
              <p className="text-4xl font-black text-indigo-700 tracking-widest">{roomCode}</p>
            </div>

            <div>
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-bold text-gray-700">Thành viên ({members.length}/4)</h3>
                <span className="flex h-3 w-3 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                </span>
              </div>
              
              <ul className="space-y-2">
                {members.map((member, idx) => (
                  <li key={idx} className="flex items-center justify-between bg-gray-50 p-3 rounded-lg border border-gray-100">
                    <div className="flex items-center gap-3">
                      <div className="bg-indigo-100 text-indigo-600 w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm">
                        {idx + 1}
                      </div>
                      <span className="text-sm font-medium text-gray-700">
                        {member.user_id === userId ? 'Bạn (Host)' : member.user_id}
                      </span>
                    </div>
                    <span className="text-xs font-semibold text-green-600 bg-green-100 px-2 py-1 rounded-full">
                      {member.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <button 
              onClick={() => setRoomCode('')}
              className="w-full mt-4 text-gray-500 hover:text-red-500 text-sm font-semibold transition"
            >
              ← Thoát phòng
            </button>
          </div>
        )}
      </div>
    </div>
  );
}