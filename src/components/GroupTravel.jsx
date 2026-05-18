'use client'; 

import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@/utils/supabase/client';
import { Users, Sparkles, LogOut, MessageSquare, Send } from 'lucide-react';

const supabase = createClient();

export default function GroupRoom({ embedded = false, currentResult, onSyncBlindBox }) {
  const [userId, setUserId] = useState(null); 
  const [roomCode, setRoomCode] = useState(''); 
  const [inputCode, setInputCode] = useState(''); 
  const [members, setMembers] = useState([]); 
  
  const [activeTab, setActiveTab] = useState('members'); 
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState([
    { id: '1', sender: 'Hệ thống', text: 'Chào mừng bạn đến với phòng nhóm! Cùng nhau roll địa điểm nhé.', isSystem: true }
  ]);

  const channelRef = useRef(null);
  const lastResultRef = useRef(null); // Tấm khiên chống dội kết quả (Tránh 2 máy cứ đẩy qua đẩy lại vô tận)

  useEffect(() => {
    if (!supabase) return;
    const loginAnonymously = async () => {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (!error && data?.user) setUserId(data.user.id); 
    };
    loginAnonymously();
  }, []);

  const handleCreateRoom = () => {
    const newCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    setRoomCode(newCode);
  };

  const handleJoinRoom = () => {
    const normalizedCode = inputCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (normalizedCode.length === 5) setRoomCode(normalizedCode);
    else alert("Mã phòng phải có 5 ký tự!");
  };

  // --- KẾT NỐI REALTIME & BROADCAST TỔNG HỢP ---
  useEffect(() => {
    if (!roomCode || !userId || !supabase) return;

    // Khởi tạo kênh với config Broadcast bật sẵn
    const roomChannel = supabase.channel(`room_${roomCode}`, {
      config: {
        presence: { key: userId }, 
        broadcast: { self: false } // Không tự nhận lại tin nhắn của chính mình
      },
    });

    channelRef.current = roomChannel;

    // 1. ĐỒNG BỘ DANH SÁCH THÀNH VIÊN VÀ CHỌN HOST
    roomChannel.on('presence', { event: 'sync' }, () => {
      const state = roomChannel.presenceState();
      const currentMembers = Object.keys(state).map((key) => state[key][0]);
      
      // FIX LỖI HOST: Sắp xếp danh sách theo thời gian join. Ai vào sớm nhất là Host!
      currentMembers.sort((a, b) => a.joined_at - b.joined_at);
      setMembers(currentMembers);
    });

    // 2. LẮNG NGHE TIN NHẮN CHAT TỪ NGƯỜI KHÁC
    roomChannel.on('broadcast', { event: 'chat_message' }, (payload) => {
      setMessages(prev => [...prev, payload.payload]);
    });

    // 3. FIX LỖI ROLL: LẮNG NGHE KẾT QUẢ ĐỊA ĐIỂM TỪ NGƯỜI KHÁC BẮN SANG
    roomChannel.on('broadcast', { event: 'sync_result' }, (payload) => {
      if (onSyncBlindBox && payload.payload) {
        // Cập nhật khiên chắn để máy mình không phát lại kết quả này nữa
        lastResultRef.current = payload.payload.name; 
        
        // Gọi hàm để update lên bản đồ
        onSyncBlindBox(payload.payload);
        
        // Bắn luôn một tin nhắn hệ thống vào Chat Box cho mọi người cùng thấy
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          sender: 'Hệ thống',
          text: `🎁 Ai đó vừa quay trúng địa điểm mới!`,
          isSystem: true
        }]);
      }
    });

    // Đăng ký vào phòng
    roomChannel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await roomChannel.track({
          user_id: userId,
          joined_at: Date.now(), // Lưu timestamp chính xác bằng số để tính Host
          status: 'Online',
        });
      }
    });

    return () => {
      supabase.removeChannel(roomChannel); 
    };
  }, [roomCode, userId, onSyncBlindBox]); 

  // --- MỖI KHI MÌNH ROLL RA ĐỊA ĐIỂM, LẤY LOA PHÁT CHO CẢ PHÒNG ---
  useEffect(() => {
    if (roomCode && currentResult && channelRef.current) {
      // Chỉ phát sóng nếu đây là kết quả mới hoàn toàn
      if (lastResultRef.current !== currentResult.name) {
        lastResultRef.current = currentResult.name;
        channelRef.current.send({
          type: 'broadcast',
          event: 'sync_result',
          payload: currentResult
        });
      }
    }
  }, [currentResult, roomCode]);

  // --- XỬ LÝ NÚT GỬI TIN NHẮN CHAT ---
  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const newMsg = {
      id: Date.now().toString(),
      sender: userId, 
      text: chatInput.trim(),
      isSystem: false
    };

    // Dùng bộ đàm phát tin nhắn này cho cả phòng
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'chat_message',
        payload: newMsg
      });
    }

    // In tin nhắn lên màn hình của chính mình
    setMessages(prev => [...prev, newMsg]);
    setChatInput('');
  };

  // Lấy ID của người làm Host (Người đứng đầu danh sách sau khi đã sort)
  const hostId = members.length > 0 ? members[0].user_id : null;

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
          <div className="space-y-5">
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 text-center relative overflow-hidden">
              <p className="text-[10px] text-slate-500 font-bold mb-1 uppercase tracking-[0.2em]">Mã phòng</p>
              <p className="text-4xl font-black text-slate-900 tracking-[0.25em]">{roomCode}</p>
              <p className="text-[11px] text-slate-400 font-medium mt-2">Chia sẻ mã để mời thành viên</p>
            </div>

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

            {activeTab === 'members' ? (
              <div className="space-y-4">
                <div className="bg-cyan-50/70 border border-cyan-100 rounded-xl p-3.5 text-[12px] text-cyan-800 leading-relaxed font-medium">
                  💡 Khi bất kỳ ai trong phòng roll hộp mù, kết quả sẽ tự động hiển thị cho tất cả thành viên. Ai roll sau cùng sẽ là kết quả mới nhất cho cả nhóm.
                </div>

                <div>
                  <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-3">Thành viên · {members.length} / 4</h3>
                  <ul className="space-y-2">
                    {members.map((member, idx) => {
                      const isMe = member.user_id === userId;
                      const isHost = member.user_id === hostId;
                      
                      // Cách hiển thị Tên và Chức vụ chuẩn xác
                      let displayName = isMe ? 'Bạn' : `Thành viên ${member.user_id.substring(0,4)}`;
                      if (isHost) displayName += ' (Host)';

                      return (
                        <li key={idx} className="flex items-center justify-between bg-white border border-slate-200 p-3 rounded-xl">
                          <div className="flex items-center gap-3">
                            <div className="bg-slate-900 text-white w-7 h-7 rounded-full flex items-center justify-center font-bold text-[11px]">
                              {idx + 1}
                            </div>
                            <span className={`text-[13px] font-bold ${isMe ? 'text-indigo-600' : 'text-slate-800'}`}>
                              {displayName}
                            </span>
                          </div>
                          <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md uppercase tracking-wider">
                            {member.status}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="flex flex-col h-[260px] border border-slate-200 rounded-xl bg-slate-50/50 overflow-hidden">
                <div className="flex-1 p-3 overflow-y-auto space-y-2.5 text-[12px]">
                  {messages.map((msg) => {
                    const isMe = msg.sender === userId;
                    const isHost = msg.sender === hostId;
                    
                    let senderName = msg.isSystem ? 'Hệ thống' : (isMe ? 'Bạn' : `Thành viên ${msg.sender.substring(0,4)}`);
                    if (!msg.isSystem && isHost && !isMe) senderName += ' (Host)';

                    return (
                      <div key={msg.id} className={`flex flex-col ${msg.isSystem ? 'items-center' : isMe ? 'items-end' : 'items-start'}`}>
                        {msg.isSystem ? (
                          <span className="bg-slate-200 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-full">{msg.text}</span>
                        ) : (
                          <>
                            <span className="text-[10px] font-bold text-slate-400 mb-0.5 px-1">{senderName}</span>
                            <span className={`px-3 py-2 rounded-2xl max-w-[85%] font-medium break-words shadow-sm ${isMe ? 'bg-slate-900 text-white rounded-tr-none' : 'bg-white text-slate-800 border border-slate-200 rounded-tl-none'}`}>
                              {msg.text}
                            </span>
                          </>
                        )}
                      </div>
                    );
                  })}
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