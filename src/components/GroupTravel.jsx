'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/utils/supabase/client';

const supabase = createClient();

const CONFLICT_WINDOW_MS = 5000;

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

const chip = (extra = {}) => ({
  display: 'inline-flex', alignItems: 'center', gap: '4px',
  padding: '3px 10px', borderRadius: '20px',
  fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em', ...extra,
});

const sectionLabel = {
  margin: '0 0 0.5rem', fontSize: '0.62rem', fontWeight: 800,
  color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.15em',
};

// ─── Conflict Modal ─────────────────────────────────────────────────────────────
function ConflictModal({ conflict, onPick }) {
  if (!conflict) return null;
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
    }}>
      <div style={{
        background: T.bg, borderRadius: '20px', border: `1px solid ${T.border}`,
        boxShadow: '0 25px 80px rgba(0,0,0,0.18)', padding: '24px', maxWidth: '380px', width: '100%',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <span style={{ fontSize: '1.2rem' }}>⚡</span>
          <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 800, color: T.text }}>Xung đột hộp mù</p>
        </div>
        <p style={{ margin: '0 0 18px', fontSize: '0.78rem', color: T.textMuted, lineHeight: 1.6 }}>
          Nhiều người cùng roll hộp mù. Là trưởng phòng, hãy chọn kết quả cho cả nhóm:
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {conflict.options.map((opt, i) => (
            <button key={i} onClick={() => onPick(opt.result)}
              style={{
                padding: '12px 16px', borderRadius: '12px', cursor: 'pointer',
                border: `1.5px solid ${T.border}`, background: T.bgSubtle,
                textAlign: 'left', transition: 'all 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.background = T.bg; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.background = T.bgSubtle; }}
            >
              <p style={{ margin: '0 0 2px', fontSize: '0.82rem', fontWeight: 700, color: T.text }}>
                🎁 Hộp mù #{i + 1}
              </p>
              <p style={{ margin: 0, fontSize: '0.72rem', color: T.textMuted }}>
                {opt.result?.category ?? 'Không rõ loại'}{opt.result?.address ? ' · ' + opt.result.address : ''}
              </p>
              <p style={{ margin: '4px 0 0', fontSize: '0.68rem', color: T.textLight }}>
                {opt.isMe ? 'Kết quả của bạn' : `Của thành viên …${opt.shortId}`}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

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
  const [memberResults, setMemberResults] = useState({}); // { userId: LocationResult }
  const [conflict, setConflict]       = useState(null);   // { options: [{result, isMe, shortId}] }

  const channelRef      = useRef(null);
  const myRollTimeRef   = useRef(null);   // timestamp of my last roll
  const prevResultRef   = useRef(null);   // last broadcast result

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
    setMemberResults({}); setConflict(null); setEntryMode(null);
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

    const ch = supabase.channel(`room_${roomCode}`, {
      config: { presence: { key: userId } },
    });
    channelRef.current = ch;

    ch.on('presence', { event: 'sync'  }, () => syncMembers(ch));
    ch.on('presence', { event: 'join'  }, () => syncMembers(ch));
    ch.on('presence', { event: 'leave' }, () => syncMembers(ch));

    // ── Someone rolled a blind box ──
    ch.on('broadcast', { event: 'blind_box_result' }, ({ payload }) => {
      const { user_id: sender, result, ts } = payload;
      if (!sender || sender === userId) return;

      // Track their result in member list
      setMemberResults(prev => ({ ...prev, [sender]: result }));

      const myTs = myRollTimeRef.current;
      const isConflict = myTs && Math.abs(ts - myTs) < CONFLICT_WINDOW_MS;

      if (isConflict) {
        // Only the host resolves — non-host waits for conflict_resolved
        if (entryMode === 'host') {
          const myResult = prevResultRef.current;
          const shortId  = sender.slice(-6).toUpperCase();
          setConflict({
            options: [
              { result: myResult, isMe: true,  shortId: 'Bạn' },
              { result,           isMe: false, shortId },
            ],
          });
        }
      } else {
        // No conflict — auto-apply to everyone
        onSyncBlindBox?.(result);
      }
    });

    // ── Host broadcast resolved winner ──
    ch.on('broadcast', { event: 'conflict_resolved' }, ({ payload }) => {
      const { result } = payload;
      setConflict(null);
      myRollTimeRef.current = null;
      onSyncBlindBox?.(result);
    });

    ch.subscribe(async (status) => {
      if (status !== 'SUBSCRIBED') return;
      await ch.track({
        user_id: userId,
        joined_at: new Date().toLocaleTimeString(),
        status: 'Đang chờ...',
      });
      syncMembers(ch);

      if (entryMode === 'guest') {
        setTimeout(() => {
          const hasOthers = Object.keys(ch.presenceState()).some(k => k !== userId);
          if (!hasOthers) {
            alert('❌ Phòng không tồn tại hoặc mọi người đã thoát hết!');
            leaveRoom();
            supabase.removeChannel(ch);
          }
        }, 1400);
      }
    });

    return () => {
      channelRef.current = null;
      supabase.removeChannel(ch);
    };
  }, [roomCode, userId, entryMode, syncMembers, leaveRoom, onSyncBlindBox]);

  // ── Host picks winner ──────────────────────────────────────────────────────
  const handlePickWinner = useCallback(async (result) => {
    setConflict(null);
    myRollTimeRef.current = null;
    onSyncBlindBox?.(result);
    await channelRef.current?.send({
      type: 'broadcast',
      event: 'conflict_resolved',
      payload: { result },
    });
  }, [onSyncBlindBox]);

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
    <>
      <ConflictModal conflict={conflict} onPick={handlePickWinner} />

      <div style={{
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
        background: T.bg, borderRadius: '16px',
        border: `1px solid ${T.border}`, overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '12px 18px', borderBottom: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: T.bgSubtle,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>👥</span>
            <span style={{ fontSize: '0.78rem', fontWeight: 800, color: T.text, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Phòng Nhóm
            </span>
          </div>
          {roomCode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{
                width: '7px', height: '7px', borderRadius: '50%',
                background: T.green, boxShadow: `0 0 0 3px ${T.greenLight}`,
                display: 'inline-block',
              }} />
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: T.textMuted }}>{onlineCount} online</span>
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: '16px' }}>
          {!supabase && (
            <div style={{ marginBottom: '12px', borderRadius: '10px', border: '1px solid #fecaca', background: '#fef2f2', padding: '10px 14px', fontSize: '0.76rem', color: T.red }}>
              Thiếu cấu hình Supabase (.env.local).
            </div>
          )}

          {!roomCode ? (
            // ── Entry screen ──
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button onClick={handleCreateRoom}
                style={{ width: '100%', padding: '0.85rem', borderRadius: '12px', border: 'none', background: T.accent, color: '#fff', fontSize: '0.83rem', fontWeight: 800, cursor: 'pointer', transition: 'all 0.2s' }}
                onMouseEnter={e => e.currentTarget.style.background = T.accentHov}
                onMouseLeave={e => e.currentTarget.style.background = T.accent}
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
          ) : (
            // ── Room screen ──
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Room code */}
              <div style={{ background: T.bgMuted, border: `1px solid ${T.border}`, borderRadius: '12px', padding: '12px 16px', textAlign: 'center' }}>
                <p style={{ ...sectionLabel, textAlign: 'center', margin: '0 0 4px' }}>Mã phòng</p>
                <p style={{ margin: 0, fontSize: '1.9rem', fontWeight: 900, color: T.text, letterSpacing: '0.25em' }}>{roomCode}</p>
                <p style={{ margin: '4px 0 0', fontSize: '0.7rem', color: T.textLight }}>Chia sẻ mã để mời thành viên</p>
              </div>

              {/* Info banner */}
              <div style={{ background: T.cyanLight, border: `1px solid #a5f3fc`, borderRadius: '10px', padding: '10px 14px', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '0.9rem', flexShrink: 0 }}>💡</span>
                <p style={{ margin: 0, fontSize: '0.73rem', color: '#0e7490', lineHeight: 1.6 }}>
                  Khi bất kỳ ai trong phòng roll hộp mù, kết quả sẽ tự động hiển thị cho tất cả thành viên.
                  {entryMode === 'host' && ' Khi có xung đột, bạn (trưởng phòng) sẽ chọn kết quả cuối.'}
                </p>
              </div>

              {/* Members */}
              <div>
                <p style={sectionLabel}>Thành viên · <span style={{ color: T.text }}>{onlineCount}</span> / 4</p>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {members.length === 0 ? (
                    <li style={{ textAlign: 'center', padding: '16px', fontSize: '0.76rem', color: T.textLight, background: T.bgSubtle, borderRadius: '10px', border: `1px dashed ${T.border}` }}>
                      Đang chờ thành viên tham gia...
                    </li>
                  ) : members.map((m, i) => (
                    <MemberRow key={m.user_id} member={m} index={i} userId={userId} memberResults={memberResults} />
                  ))}
                </ul>
              </div>

              {/* Hint: roll from main panel */}
              <div style={{ background: T.bgSubtle, border: `1px solid ${T.border}`, borderRadius: '10px', padding: '10px 14px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem' }}>👆</span>
                <p style={{ margin: 0, fontSize: '0.72rem', color: T.textMuted, lineHeight: 1.5 }}>
                  Nhấn <strong style={{ color: T.text }}>BẮT ĐẦU</strong> ở trên để roll hộp mù và chia sẻ với nhóm.
                </p>
              </div>

              {/* Leave */}
              <button onClick={leaveRoom}
                style={{ background: 'none', border: 'none', fontSize: '0.76rem', fontWeight: 600, color: T.textMuted, cursor: 'pointer', padding: '2px', textAlign: 'center', transition: 'color 0.2s' }}
                onMouseEnter={e => e.currentTarget.style.color = T.red}
                onMouseLeave={e => e.currentTarget.style.color = T.textMuted}
              >
                ← Thoát phòng
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}