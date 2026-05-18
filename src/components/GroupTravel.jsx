'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/utils/supabase/client';
import { Users, Sparkles, LogOut } from 'lucide-react';

//1. KHỞI TẠO SUPABASE CLIENT
const supabase = createClient();

// ─── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  bg: '#ffffff', bgSubtle: '#f8fafc', bgMuted: '#f1f5f9',
  border: '#e2e8f0', borderDark: '#cbd5e1',
  text: '#0f172a', textMuted: '#64748b', textLight: '#94a3b8',
  accent: '#0f172a', accentHov: '#1e293b',
  cyan: '#06b6d4', cyanLight: '#cffafe',
  green: '#16a34a', greenLight: '#dcfce7',
  red: '#dc2626',
};

  // --- 1.1: ĐĂNG NHẬP ẨN DANH NGAY KHI MỞ TRANG ---
  useEffect(() => {
    if (!supabase) return;

// ─── Member Row ─────────────────────────────────────────────────────────────────
function MemberRow({ member, index, userId, memberResults }) {
  const isMe = member.user_id === userId;
  const result = memberResults[member.user_id];
  const shortId = member.user_id?.slice(-6)?.toUpperCase() ?? `#${index + 1}`;

  return (
    <li style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 12px', borderRadius: '12px', gap: '10px',
      background: isMe ? '#f0fdf4' : T.bgSubtle,
      border: `1px solid ${isMe ? '#bbf7d0' : T.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
        <div style={{
          width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0,
          background: isMe ? T.accent : T.bgMuted,
          border: `2px solid ${isMe ? T.accent : T.borderDark}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.72rem', fontWeight: 800,
          color: isMe ? '#fff' : T.textMuted,
        }}>
          {index + 1}
        </div>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: '0.78rem', fontWeight: 700, color: T.text }}>
            {isMe ? 'Bạn' : `Thành viên …${shortId}`}
          </p>
          {result ? (
            <p style={{ margin: 0, fontSize: '0.68rem', color: T.cyan }}>
              🎁 Đã roll hộp mù
            </p>
          ) : (
            <p style={{ margin: 0, fontSize: '0.68rem', color: T.textLight }}>Đang chờ roll...</p>
          )}
        </div>
      </div>
      {result
        ? <span style={chip({ background: T.cyanLight, color: T.cyan, flexShrink: 0 })}>Đã roll</span>
        : <span style={chip({ background: T.bgMuted, color: T.textMuted, flexShrink: 0 })}>⏳</span>
      }
    </li>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────
export default function GroupRoom({ embedded = false, currentResult, onSyncBlindBox }) {
  const [userId, setUserId]           = useState(null);
  const [roomCode, setRoomCode]       = useState('');
  const [inputCode, setInputCode]     = useState('');
  const [members, setMembers]         = useState([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [entryMode, setEntryMode]     = useState(null);
  const [memberResults, setMemberResults] = useState({});

  // ── Chat state ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab]     = useState('members'); // 'members' | 'chat'
  const [messages, setMessages]       = useState([]);
  const [chatInput, setChatInput]     = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const chatEndRef = useRef(null);

  const channelRef      = useRef(null);
  const myRollTimeRef   = useRef(null);
  const prevResultRef   = useRef(null);

  // ── Sync presence ──────────────────────────────────────────────────────────
  const syncMembers = useCallback((ch) => {
    const state = ch.presenceState();
    setOnlineCount(Object.keys(state).length);
    setMembers(Object.entries(state).map(([key, metas]) => {
      const m = metas?.[metas.length - 1] ?? {};
      return { user_id: m.user_id || key, joined_at: m.joined_at, status: m.status || '' };
    }));
  }, []);

  const leaveRoom = useCallback(() => {
    setRoomCode(''); setMembers([]); setOnlineCount(0);
    setMemberResults({}); setEntryMode(null);
    setMessages([]); setChatInput(''); setUnreadCount(0); setActiveTab('members');
    myRollTimeRef.current = null; prevResultRef.current = null;
  }, []);

  // ── Anonymous auth ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) { setUserId(data.user.id); return; }
      supabase.auth.signInAnonymously().then(({ data: d }) => {
        if (d?.user) setUserId(d.user.id);
      });
    });
  }, []);

  // ── Watch currentResult: auto-broadcast when user rolls ────────────────────
  useEffect(() => {
    if (!currentResult || !roomCode || !channelRef.current || !userId) return;
    if (currentResult === prevResultRef.current) return;
    prevResultRef.current = currentResult;
    myRollTimeRef.current = Date.now();

    // update own presence
    channelRef.current.track({
      user_id: userId,
      joined_at: new Date().toLocaleTimeString(),
      status: 'Đã roll',
    });

    // mark own result locally
    setMemberResults(prev => ({ ...prev, [userId]: currentResult }));

    // broadcast to room
    channelRef.current.send({
      type: 'broadcast',
      event: 'blind_box_result',
      payload: { user_id: userId, result: currentResult, ts: Date.now() },
    });
  }, [currentResult, roomCode, userId]);

  // ── Realtime channel ───────────────────────────────────────────────────────
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
      channelRef.current = null;
      setMessages([]);
      supabase.removeChannel(ch);
    };
  }, [roomCode, userId, entryMode, syncMembers, leaveRoom, onSyncBlindBox]);

  // ── Chat: auto-scroll ──────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab === 'chat') {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      setUnreadCount(0);
    }
  }, [messages, activeTab]);

  // ── Chat: send ──────────────────────────────────────────────────────────────
  const sendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || !channelRef.current || !userId) return;
    const ts = Date.now();
    const shortId = userId.slice(-6).toUpperCase();
    setMessages(prev => [...prev, { id: ts, userId, shortId, text, ts, isMe: true }]);
    setChatInput('');
    await channelRef.current.send({
      type: 'broadcast', event: 'group_chat',
      payload: { user_id: userId, shortId, text, ts },
    });
  }, [chatInput, userId]);

  // ── Room entry ─────────────────────────────────────────────────────────────
  const handleCreateRoom = () => {
    const code = Math.random().toString(36).substring(2, 7).toUpperCase();
    setEntryMode('host');
    setRoomCode(code);
  };

  const handleJoinRoom = () => {
    const code = inputCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 5) { alert('Mã phòng phải có 5 ký tự!'); return; }
    setEntryMode('guest');
    setRoomCode(code);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
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
          )}
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
                ✨ Tạo phòng mới
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ flex: 1, height: '1px', background: T.border }} />
                <span style={{ fontSize: '0.7rem', color: T.textLight, fontWeight: 600 }}>hoặc</span>
                <div style={{ flex: 1, height: '1px', background: T.border }} />
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <input type="text" placeholder="Mã phòng (5 ký tự)"
                  value={inputCode}
                  onChange={e => setInputCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  maxLength={5}
                  style={{
                    flex: 1, padding: '0.75rem 1rem', borderRadius: '10px',
                    border: `1.5px solid ${T.border}`, background: T.bgSubtle,
                    fontSize: '0.85rem', fontWeight: 800, letterSpacing: '0.2em',
                    color: T.text, outline: 'none', textAlign: 'center', textTransform: 'uppercase',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.background = T.bg; }}
                  onBlur={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.background = T.bgSubtle; }}
                />
                <button onClick={handleJoinRoom}
                  style={{ padding: '0.75rem 1rem', borderRadius: '10px', background: T.accent, color: '#fff', border: 'none', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}
                  onMouseEnter={e => e.currentTarget.style.background = T.accentHov}
                  onMouseLeave={e => e.currentTarget.style.background = T.accent}
                >
                  Vào
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Nếu đã vào phòng -> Hiển thị phòng chờ */
          <div className="space-y-6">
            
            {/* BOX HIỂN THỊ MÃ PHÒNG */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 text-center relative overflow-hidden">
              <p className="text-[10px] text-slate-500 font-bold mb-2 uppercase tracking-[0.2em]">Mã phòng của bạn</p>
              <p className="text-4xl font-black text-slate-900 tracking-[0.25em]">{roomCode}</p>
              <p className="text-[11px] text-slate-500 font-medium mt-3">Chia sẻ mã này để mời thành viên</p>
            </div>

            {/* DANH SÁCH THÀNH VIÊN */}
            <div>
              <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-3">Thành viên ({members.length}/4)</h3>
              
              <ul className="space-y-2">
                {members.map((member, idx) => (
                  <li key={idx} className="flex items-center justify-between bg-white border border-slate-200 p-3 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="bg-slate-900 text-white w-7 h-7 rounded-full flex items-center justify-center font-bold text-[11px]">
                        {idx + 1}
                      </div>
                      <span className="text-[13px] font-bold text-slate-800">
                        {member.user_id === userId ? 'Bạn (Host)' : `Người chơi ${idx + 1}`}
                      </span>
                    </div>
                    <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md uppercase tracking-wider">
                      {member.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* NÚT THOÁT */}
            <button 
              onClick={() => setRoomCode('')}
              className="w-full mt-2 text-slate-500 hover:text-red-600 text-[11px] font-bold uppercase tracking-wider transition flex items-center justify-center gap-1.5 py-2"
            >
              <LogOut size={14} />
              Thoát phòng
            </button>
          </div>
        )}
      </div>
    </>
  );
}