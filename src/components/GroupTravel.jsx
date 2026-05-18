'use client'; 

import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@/utils/supabase/client';
// Bổ sung thêm MessageSquare để làm icon Chat giống trong ảnh của bạn
import { Users, Sparkles, LogOut, MessageSquare, Send } from 'lucide-react';

//1. KHỞI TẠO SUPABASE CLIENT
const supabase = createClient();

export default function GroupRoom({ embedded = false, currentResult, onSyncBlindBox }) {
  // --- STATE MANAGEMENT  ---
  const [userId, setUserId] = useState(null); // Lưu ID ẩn danh
  const [roomCode, setRoomCode] = useState(''); // Mã phòng hiện tại
  const [inputCode, setInputCode] = useState(''); // Mã người dùng nhập vào ô text
  const [members, setMembers] = useState([]); // Mảng chứa danh sách thành viên
  
  // State quản lý Tab hiển thị (Thành viên hoặc Chat) theo đúng ảnh image_18168e.png
  const [activeTab, setActiveTab] = useState('members'); 
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState([
    { id: '1', sender: 'Hệ thống', text: 'Chào mừng bạn đến với phòng trò chuyện nhóm!', isSystem: true }
  ]);

  // --- 1.1: ĐĂNG NHẬP ẨN DANH NGAY KHI MỞ TRANG ---
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

  // --- 2: KẾT NỐI REALTIME  ---
  useEffect(() => {
    if (!roomCode || !userId || !supabase) return;

    const roomChannel = supabase.channel(`room_${roomCode}`, {
      config: {
        presence: { key: userId }, // Định danh tôi là ai trong phòng
      },
    });

    roomChannel.on('presence', { event: 'sync' }, () => {
      const state = roomChannel.presenceState();
      // Chuyển mảng object phức tạp thành mảng đơn giản để render UI
      const currentMembers = Object.keys(state).map((key) => state[key][0]);
      setMembers(currentMembers);
    });

    roomChannel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await roomChannel.track({
          user_id: userId,
          joined_at: new Date().toLocaleTimeString(),
          status: 'Đang chờ...',
        });
      }
    });

    // CLEANUP FUNCTION (Giống hàm Hủy - Destructor trong C++)
    return () => {
      supabase.removeChannel(roomChannel); // Hủy lắng nghe, giải phóng bộ nhớ!
    };
  }, [roomCode, userId]); 

  // Xử lý gửi tin nhắn local (bạn có thể tích hợp Broadcast Broadcast của Supabase sau)
  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      sender: 'Bạn',
      text: chatInput.trim(),
      isSystem: false
    }]);
    setChatInput('');
  };

  // --- GIAO DIỆN (UI) ---
  return (
    <div className={`${embedded ? 'w-full' : 'min-h-screen bg-[#f8fafc] py-10 px-4'} flex flex-col items-center font-sans`}>
      <div className={`w-full ${embedded ? '' : 'max-w-md bg-white rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.05)] p-8 border border-slate-100'}`}>
        
        {/* HEADER PHONG CÁCH TẠP CHÍ */}
        <div className="flex items-center justify-between mb-6 border-b border-slate-100 pb-4">
          <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
            <Users size={15} strokeWidth={2.5} />
            Phòng Nhóm
          </h2>
          {roomCode && (
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{members.length} Online</span>
            </div>
          )}
        </div>

        {!supabase && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-600">
            Thiếu cấu hình Supabase. Kiểm tra lại .env.local nhé.
          </div>
        )}

        {/* Nếu chưa có phòng -> Hiển thị màn hình Tạo/Vào phòng */}
        {!roomCode ? (
          <div className="space-y-5">
            <button 
              onClick={handleCreateRoom}
              className="w-full bg-slate-900 hover:bg-black text-white font-bold py-3.5 px-4 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 shadow-sm active:scale-95"
            >
              <Sparkles size={16} />
              Tạo phòng mới
            </button>
            
            <div className="relative flex py-2 items-center">
              <div className="flex-grow border-t border-slate-200"></div>
              <span className="flex-shrink-0 mx-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">hoặc</span>
              <div className="flex-grow border-t border-slate-200"></div>
            </div>

            <div className="flex gap-2">
              <input 
                type="text" 
                placeholder="MÃ PHÒNG (5 KÝ TỰ)" 
                className="flex-1 border border-slate-200 bg-slate-50 rounded-xl px-4 py-3 uppercase text-[13px] font-bold text-slate-900 focus:border-slate-900 focus:ring-1 focus:ring-slate-900 focus:bg-white focus:outline-none transition-all placeholder:text-slate-400 placeholder:font-semibold tracking-wider"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                maxLength={5}
              />
              <button 
                onClick={handleJoinRoom}
                className="bg-slate-900 hover:bg-black text-white font-bold py-3 px-6 rounded-xl transition-all duration-200 flex items-center justify-center active:scale-95"
              >
                Vào
              </button>
            </div>
          </div>
        ) : (
          /* Nếu đã vào phòng -> Hiển thị phòng chờ */
          <div className="space-y-5">
            
            {/* BOX HIỂN THỊ MÃ PHÒNG (Đúng ảnh image_18168e.png) */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 text-center relative overflow-hidden">
              <p className="text-[10px] text-slate-500 font-bold mb-1 uppercase tracking-[0.2em]">Mã phòng</p>
              <p className="text-4xl font-black text-slate-900 tracking-[0.25em]">{roomCode}</p>
              <p className="text-[11px] text-slate-400 font-medium mt-2">Chia sẻ mã để mời thành viên</p>
            </div>

            {/* TAB SWITCHER (Đúng nguyên mẫu thiết kế [Thành viên] [Chat] trong ảnh) */}
            <div className="flex bg-slate-100 p-1 rounded-xl">
              <button 
                onClick={() => setActiveTab('members')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-[12px] font-bold rounded-lg transition-all ${activeTab === 'members' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
              >
                <Users size={14} />
                Thành viên
              </button>
              <button 
                onClick={() => setActiveTab('chat')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-[12px] font-bold rounded-lg transition-all ${activeTab === 'chat' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
              >
                <MessageSquare size={14} />
                Chat
              </button>
            </div>

            {/* HIỂN THỊ NỘI DUNG THEO TAB ĐƯỢC CHỌN */}
            {activeTab === 'members' ? (
              <div className="space-y-4">
                {/* Khung thông báo màu xanh ngọc lam nhẹ nhàng giống hệt ảnh mẫu */}
                <div className="bg-cyan-50/70 border border-cyan-100 rounded-xl p-3.5 text-[12px] text-cyan-800 leading-relaxed font-medium">
                  💡 Khi bất kỳ ai trong phòng roll hộp mù, kết quả sẽ tự động hiển thị cho tất cả thành viên. Ai roll sau cùng sẽ là kết quả mới nhất cho cả nhóm.
                </div>

                <div>
                  <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-3">Thành viên · {members.length} / 4</h3>
                  <ul className="space-y-2">
                    {members.map((member, idx) => (
                      <li key={idx} className="flex items-center justify-between bg-white border border-slate-200 p-3 rounded-xl">
                        <div className="flex items-center gap-3">
                          <div className="bg-slate-900 text-white w-7 h-7 rounded-full flex items-center justify-center font-bold text-[11px]">
                            {idx + 1}
                          </div>
                          <span className="text-[13px] font-bold text-slate-800">
                            {member.user_id === userId ? 'Bạn (Host)' : `Thành viên ${idx + 1}`}
                          </span>
                        </div>
                        <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md uppercase tracking-wider">
                          {member.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              /* TAB CHAT: Khung hội thoại nhóm tối giản trắng đen tinh tế */
              <div className="flex flex-col h-[260px] border border-slate-200 rounded-xl bg-slate-50/50 overflow-hidden">
                <div className="flex-1 p-3 overflow-y-auto space-y-2.5 text-[12px]">
                  {messages.map((msg) => (
                    <div key={msg.id} className={`flex flex-col ${msg.isSystem ? 'items-center' : msg.sender === 'Bạn' ? 'items-end' : 'items-start'}`}>
                      {msg.isSystem ? (
                        <span className="bg-slate-200 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-full">{msg.text}</span>
                      ) : (
                        <>
                          <span className="text-[10px] font-bold text-slate-400 mb-0.5 px-1">{msg.sender}</span>
                          <span className={`px-3 py-2 rounded-2xl max-w-[85%] font-medium break-words shadow-sm ${msg.sender === 'Bạn' ? 'bg-slate-900 text-white rounded-tr-none' : 'bg-white text-slate-800 border border-slate-200 rounded-tl-none'}`}>
                            {msg.text}
                          </span>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <form onSubmit={handleSendMessage} className="p-2 bg-white border-t border-slate-200 flex gap-1.5">
                  <input 
                    type="text" 
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Nhập tin nhắn..."
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-[12px] font-medium outline-none focus:bg-white focus:border-slate-900 transition-all"
                  />
                  <button type="submit" className="bg-slate-900 text-white p-1.5 rounded-lg hover:bg-black transition-colors">
                    <Send size={14} />
                  </button>
                </form>
              </div>
            )}

            {/* NÚT THOÁT */}
            <div className="pt-2 border-t border-slate-100">
              <button 
                onClick={() => setRoomCode('')}
                className="w-full text-slate-400 hover:text-red-600 text-[11px] font-bold uppercase tracking-wider transition flex items-center justify-center gap-1.5 py-1.5"
              >
                <LogOut size={14} />
                Thoát phòng
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}