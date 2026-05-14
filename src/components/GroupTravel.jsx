'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/utils/supabase/client';

const supabase = createClient();

// ─── Design tokens (matches BlindBoxPanel / app theme) ────────────────────────
const TOKEN = {
  bg:         '#ffffff',
  bgSubtle:   '#f8fafc',
  bgMuted:    '#f1f5f9',
  border:     '#e2e8f0',
  borderDark: '#cbd5e1',
  text:       '#0f172a',
  textMuted:  '#64748b',
  textLight:  '#94a3b8',
  accent:     '#0f172a',
  accentHov:  '#1e293b',
  cyan:       '#06b6d4',
  cyanLight:  '#e0f7fa',
  green:      '#16a34a',
  greenLight: '#dcfce7',
  amber:      '#d97706',
  amberLight: '#fef3c7',
  red:        '#dc2626',
};

const chip = (extra = {}) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '3px 10px',
  borderRadius: '20px',
  fontSize: '0.7rem',
  fontWeight: 700,
  letterSpacing: '0.04em',
  ...extra,
});

const sectionLabel = {
  margin: '0 0 0.6rem',
  fontSize: '0.62rem',
  fontWeight: 800,
  color: TOKEN.textMuted,
  textTransform: 'uppercase',
  letterSpacing: '0.15em',
};

const card = {
  background: TOKEN.bgSubtle,
  border: `1px solid ${TOKEN.border}`,
  borderRadius: '14px',
  padding: '14px 16px',
};

const btnPrimary = (disabled = false) => ({
  width: '100%',
  padding: '0.9rem',
  borderRadius: '14px',
  border: 'none',
  background: disabled ? TOKEN.bgMuted : TOKEN.accent,
  color: disabled ? TOKEN.textLight : '#ffffff',
  fontSize: '0.85rem',
  fontWeight: 800,
  letterSpacing: '0.05em',
  cursor: disabled ? 'not-allowed' : 'pointer',
  transition: 'all 0.2s ease',
});

const btnOutline = {
  width: '100%',
  padding: '0.85rem',
  borderRadius: '14px',
  border: `1px solid ${TOKEN.border}`,
  background: TOKEN.bg,
  color: TOKEN.text,
  fontSize: '0.82rem',
  fontWeight: 700,
  cursor: 'pointer',
  transition: 'all 0.2s ease',
};

// ─── Notification Toast ────────────────────────────────────────────────────────
function SyncNotification({ notification, onAccept, onDismiss }) {
  if (!notification) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: 9999,
      maxWidth: '340px',
      width: 'calc(100vw - 48px)',
      background: TOKEN.bg,
      border: `1px solid ${TOKEN.borderDark}`,
      borderRadius: '16px',
      boxShadow: '0 20px 60px rgba(0,0,0,0.14)',
      padding: '18px 20px',
      animation: 'slideInNotif 0.35s cubic-bezier(0.2,0.8,0.2,1)',
    }}>
      <style>{`
        @keyframes slideInNotif {
          from { opacity: 0; transform: translateY(20px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0)   scale(1);    }
        }
      `}</style>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '14px' }}>
        <div style={{
          width: '36px', height: '36px', borderRadius: '10px',
          background: TOKEN.cyanLight, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, fontSize: '1.1rem',
        }}>🎁</div>
        <div>
          <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 700, color: TOKEN.text, lineHeight: 1.4 }}>
            Đồng bộ hộp mù
          </p>
          <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: TOKEN.textMuted, lineHeight: 1.5 }}>
            Bạn có muốn đồng bộ hộp mù của người dùng{' '}
            <span style={{ fontWeight: 700, color: TOKEN.text }}>
              {notification.shortId}
            </span>{' '}
            không?
          </p>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={onAccept}
          style={{
            flex: 1, padding: '0.6rem', borderRadius: '10px', border: 'none',
            background: TOKEN.accent, color: '#fff', fontSize: '0.8rem', fontWeight: 700,
            cursor: 'pointer', transition: 'all 0.2s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = TOKEN.accentHov}
          onMouseLeave={e => e.currentTarget.style.background = TOKEN.accent}
        >
          ✓ Đồng bộ
        </button>
        <button
          onClick={onDismiss}
          style={{
            flex: 1, padding: '0.6rem', borderRadius: '10px',
            border: `1px solid ${TOKEN.border}`, background: TOKEN.bg,
            color: TOKEN.textMuted, fontSize: '0.8rem', fontWeight: 700,
            cursor: 'pointer', transition: 'all 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = TOKEN.bgMuted; }}
          onMouseLeave={e => { e.currentTarget.style.background = TOKEN.bg; }}
        >
          Bỏ qua
        </button>
      </div>
    </div>
  );
}

// ─── Member list item ──────────────────────────────────────────────────────────
function MemberRow({ member, index, userId, openedUsers, syncedUsers }) {
  const isMe = member.user_id === userId;
  const hasOpened = Boolean(openedUsers[member.user_id]);
  const hasSynced = Boolean(syncedUsers[member.user_id]);
  const shortId = member.user_id?.slice(-6)?.toUpperCase() ?? `#${index + 1}`;

  return (
    <li style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 12px', borderRadius: '12px',
      background: isMe ? '#f0fdf4' : TOKEN.bgSubtle,
      border: `1px solid ${isMe ? '#bbf7d0' : TOKEN.border}`,
      gap: '10px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {/* Avatar */}
        <div style={{
          width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
          background: isMe ? TOKEN.accent : TOKEN.bgMuted,
          border: `2px solid ${isMe ? TOKEN.accent : TOKEN.borderDark}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.75rem', fontWeight: 800,
          color: isMe ? '#fff' : TOKEN.textMuted,
        }}>
          {index + 1}
        </div>
        <div>
          <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 700, color: TOKEN.text }}>
            {isMe ? 'Bạn' : `Thành viên …${shortId}`}
            {isMe && <span style={{ ...chip({ background: TOKEN.greenLight, color: TOKEN.green }), marginLeft: '6px' }}>Bạn</span>}
          </p>
          {member.joined_at && (
            <p style={{ margin: 0, fontSize: '0.68rem', color: TOKEN.textLight }}>
              Tham gia lúc {member.joined_at}
            </p>
          )}
        </div>
      </div>

      {/* Status chip */}
      {hasOpened ? (
        <span style={chip({ background: TOKEN.cyanLight, color: TOKEN.cyan })}>
          🎁 Đã mở
          {hasSynced && !isMe && ' · Đã đồng bộ'}
        </span>
      ) : (
        <span style={chip({ background: TOKEN.bgMuted, color: TOKEN.textMuted })}>
          ⏳ Đang chờ
        </span>
      )}
    </li>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function GroupRoom({ embedded = false, onSyncBlindBox }) {
  const [userId, setUserId]           = useState(null);
  const [roomCode, setRoomCode]       = useState('');
  const [inputCode, setInputCode]     = useState('');
  const [members, setMembers]         = useState([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [openedUsers, setOpenedUsers] = useState({});
  const [syncedUsers, setSyncedUsers] = useState({});
  const [entryMode, setEntryMode]     = useState(null);

  // Blind-box payload broadcast
  const [syncNotification, setSyncNotification] = useState(null); // { userId, shortId, payload }

  const channelRef = useRef(null);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const syncMembersFromPresence = useCallback((roomChannel) => {
    const presenceState = roomChannel.presenceState();
    setOnlineCount(Object.keys(presenceState).length);

    const currentMembers = Object.entries(presenceState).map(([presenceKey, metas]) => {
      const latestMeta = metas?.[metas.length - 1] ?? {};
      return {
        user_id:   latestMeta.user_id || presenceKey,
        joined_at: latestMeta.joined_at,
        status:    latestMeta.status || 'Đang chờ...',
        lat:       latestMeta.lat,
        lng:       latestMeta.lng,
      };
    });

    setMembers(currentMembers);
  }, []);

  const leaveRoom = useCallback(() => {
    setRoomCode('');
    setMembers([]);
    setOnlineCount(0);
    setOpenedUsers({});
    setSyncedUsers({});
    setSyncNotification(null);
    setEntryMode(null);
  }, []);

  // ── Anonymous login ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (!error && data?.user) setUserId(data.user.id);
    })();
  }, []);

  // ── Room actions ───────────────────────────────────────────────────────────
  const handleCreateRoom = () => {
    const newCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    setEntryMode('host');
    setRoomCode(newCode);
  };

  const handleJoinRoom = () => {
    const normalized = inputCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (normalized.length !== 5) { alert('Mã phòng phải có 5 ký tự!'); return; }
    setEntryMode('guest');
    setRoomCode(normalized);
  };

  const handleOpenBlindBox = async (payload = null) => {
    if (!channelRef.current || !userId) return;

    const openedAt = new Date().toISOString();
    setOpenedUsers(prev => ({ ...prev, [userId]: openedAt }));

    await channelRef.current.track({
      user_id:   userId,
      joined_at: new Date().toLocaleTimeString(),
      status:    'Đã mở hộp',
    });

    await channelRef.current.send({
      type:    'broadcast',
      event:   'blind_box_opened',
      payload: {
        user_id:    userId,
        opened_at:  openedAt,
        blind_box:  payload, // optional result payload
      },
    });
  };

  // ── Realtime channel ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!roomCode || !userId || !supabase) return;

    const roomChannel = supabase.channel(`room_${roomCode}`, {
      config: { presence: { key: userId } },
    });

    channelRef.current = roomChannel;

    roomChannel.on('presence', { event: 'sync'  }, () => syncMembersFromPresence(roomChannel));
    roomChannel.on('presence', { event: 'join'  }, () => syncMembersFromPresence(roomChannel));
    roomChannel.on('presence', { event: 'leave' }, () => syncMembersFromPresence(roomChannel));

    // ── Broadcast: blind box opened ──────────────────────────────────────────
    roomChannel.on('broadcast', { event: 'blind_box_opened' }, ({ payload }) => {
      const openedUserId = payload?.user_id;
      const openedAt     = payload?.opened_at;
      const blindBox     = payload?.blind_box;
      const shortId      = openedUserId?.slice(-6)?.toUpperCase() ?? '??????';

      if (!openedUserId || openedUserId === userId) return;

      // Update opened state
      setOpenedUsers(prev => ({ ...prev, [openedUserId]: openedAt || new Date().toISOString() }));
      setMembers(prev => prev.map(m =>
        m.user_id === openedUserId ? { ...m, status: 'Đã mở hộp' } : m
      ));

      // Show sync notification
      setSyncNotification({ userId: openedUserId, shortId, payload: blindBox });
    });

    // ── Broadcast: location update ───────────────────────────────────────────
    roomChannel.on('broadcast', { event: 'location_update' }, ({ payload }) => {
      const { user_id: uid, lat, lng } = payload;
      setMembers(prev => prev.map(m =>
        m.user_id === uid ? { ...m, lat, lng } : m
      ));
    });

    roomChannel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await roomChannel.track({
          user_id:   userId,
          joined_at: new Date().toLocaleTimeString(),
          status:    'Đang chờ...',
        });

        syncMembersFromPresence(roomChannel);

        if (entryMode === 'guest') {
          setTimeout(() => {
            const presenceState = roomChannel.presenceState();
            const hasOthers = Object.keys(presenceState).some(k => k !== userId);
            if (!hasOthers) {
              alert('❌ Phòng không tồn tại hoặc mọi người đã thoát hết!');
              leaveRoom();
              supabase.removeChannel(roomChannel);
            }
          }, 1200);
        }
      }
    });

    return () => {
      channelRef.current = null;
      setOnlineCount(0);
      setOpenedUsers({});
      setSyncedUsers({});
      setSyncNotification(null);
      supabase.removeChannel(roomChannel);
    };
  }, [roomCode, userId, entryMode, syncMembersFromPresence, leaveRoom]);

  // ── Broadcast own location whenever it changes ─────────────────────────────
  useEffect(() => {
    if (!channelRef.current || !userId) return;
    if (!navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(pos => {
      const { latitude: lat, longitude: lng } = pos.coords;
      channelRef.current?.track({
        user_id:   userId,
        joined_at: new Date().toLocaleTimeString(),
        status:    openedUsers[userId] ? 'Đã mở hộp' : 'Đang chờ...',
        lat,
        lng,
      });
      channelRef.current?.send({
        type:    'broadcast',
        event:   'location_update',
        payload: { user_id: userId, lat, lng },
      });
    }, null, { enableHighAccuracy: true, maximumAge: 5000 });

    return () => navigator.geolocation.clearWatch(watchId);
  }, [roomCode, userId, openedUsers]);

  // ── Sync notification handlers ─────────────────────────────────────────────
  const handleAcceptSync = useCallback(() => {
    if (!syncNotification) return;
    setSyncedUsers(prev => ({ ...prev, [syncNotification.userId]: true }));
    if (syncNotification.payload && onSyncBlindBox) {
      onSyncBlindBox(syncNotification.payload);
    }
    setSyncNotification(null);
  }, [syncNotification, onSyncBlindBox]);

  const handleDismissSync = useCallback(() => {
    setSyncNotification(null);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  const hasLocation = members.some(m => m.user_id !== userId && m.lat);

  return (
    <>
      {/* ── Sync Toast Notification ── */}
      <SyncNotification
        notification={syncNotification}
        onAccept={handleAcceptSync}
        onDismiss={handleDismissSync}
      />

      <div style={{
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
        background: TOKEN.bg,
        borderRadius: '16px',
        border: `1px solid ${TOKEN.border}`,
        overflow: 'hidden',
      }}>

        {/* ── Header ── */}
        <div style={{
          padding: '14px 18px',
          borderBottom: `1px solid ${TOKEN.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: TOKEN.bgSubtle,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1rem' }}>👥</span>
            <span style={{ fontSize: '0.8rem', fontWeight: 800, color: TOKEN.text, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Phòng Nhóm
            </span>
          </div>
          {roomCode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{
                width: '7px', height: '7px', borderRadius: '50%',
                background: TOKEN.green,
                boxShadow: `0 0 0 3px ${TOKEN.greenLight}`,
                display: 'inline-block',
              }} />
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: TOKEN.textMuted }}>
                {onlineCount} online
              </span>
            </div>
          )}
        </div>

        {/* ── Body ── */}
        <div style={{ padding: '18px' }}>
          {!supabase && (
            <div style={{
              marginBottom: '14px', borderRadius: '10px',
              border: `1px solid #fecaca`, background: '#fef2f2',
              padding: '10px 14px', fontSize: '0.78rem', color: TOKEN.red,
            }}>
              Thiếu cấu hình Supabase. Hãy thêm NEXT_PUBLIC_SUPABASE_URL và NEXT_PUBLIC_SUPABASE_ANON_KEY trong .env.local.
            </div>
          )}

          {!roomCode ? (
            /* ── Entry screen ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button
                onClick={handleCreateRoom}
                style={btnPrimary()}
                onMouseEnter={e => e.currentTarget.style.background = TOKEN.accentHov}
                onMouseLeave={e => e.currentTarget.style.background = TOKEN.accent}
              >
                ✨ Tạo phòng mới
              </button>

              {/* Divider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '2px 0' }}>
                <div style={{ flex: 1, height: '1px', background: TOKEN.border }} />
                <span style={{ fontSize: '0.72rem', color: TOKEN.textLight, fontWeight: 600 }}>hoặc</span>
                <div style={{ flex: 1, height: '1px', background: TOKEN.border }} />
              </div>

              {/* Join room */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="Mã phòng (5 ký tự)"
                  value={inputCode}
                  onChange={e => setInputCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  maxLength={5}
                  style={{
                    flex: 1, padding: '0.8rem 1rem', borderRadius: '12px',
                    border: `1.5px solid ${TOKEN.border}`, background: TOKEN.bgSubtle,
                    fontSize: '0.85rem', fontWeight: 800, letterSpacing: '0.2em',
                    color: TOKEN.text, outline: 'none', textAlign: 'center',
                    textTransform: 'uppercase', transition: 'all 0.2s',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = TOKEN.accent; e.currentTarget.style.background = TOKEN.bg; }}
                  onBlur={e => { e.currentTarget.style.borderColor = TOKEN.border; e.currentTarget.style.background = TOKEN.bgSubtle; }}
                />
                <button
                  onClick={handleJoinRoom}
                  style={{
                    padding: '0.8rem 1.1rem', borderRadius: '12px',
                    background: TOKEN.accent, color: '#fff', border: 'none',
                    fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = TOKEN.accentHov}
                  onMouseLeave={e => e.currentTarget.style.background = TOKEN.accent}
                >
                  Vào
                </button>
              </div>
            </div>
          ) : (
            /* ── Room screen ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

              {/* Room code banner */}
              <div style={{
                ...card,
                background: TOKEN.bgMuted,
                textAlign: 'center',
              }}>
                <p style={{ margin: '0 0 4px', ...sectionLabel, textAlign: 'center' }}>Mã phòng của bạn</p>
                <p style={{
                  margin: 0, fontSize: '2rem', fontWeight: 900,
                  color: TOKEN.text, letterSpacing: '0.25em', lineHeight: 1.2,
                }}>
                  {roomCode}
                </p>
                <p style={{ margin: '6px 0 0', fontSize: '0.72rem', color: TOKEN.textLight }}>
                  Chia sẻ mã này để mời thành viên vào phòng
                </p>
              </div>

              {/* Member list */}
              <div>
                <p style={sectionLabel}>
                  Thành viên &nbsp;·&nbsp;
                  <span style={{ color: TOKEN.text }}>{onlineCount}</span> / 4 online
                </p>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {members.length === 0 ? (
                    <li style={{
                      textAlign: 'center', padding: '18px',
                      fontSize: '0.78rem', color: TOKEN.textLight,
                      background: TOKEN.bgSubtle, borderRadius: '12px',
                      border: `1px dashed ${TOKEN.border}`,
                    }}>
                      Đang chờ thành viên tham gia...
                    </li>
                  ) : (
                    members.map((member, idx) => (
                      <MemberRow
                        key={member.user_id}
                        member={member}
                        index={idx}
                        userId={userId}
                        openedUsers={openedUsers}
                        syncedUsers={syncedUsers}
                      />
                    ))
                  )}
                </ul>
              </div>

              {/* Location sync hint */}
              {hasLocation && (
                <div style={{
                  ...card,
                  display: 'flex', alignItems: 'center', gap: '10px',
                }}>
                  <span style={{ fontSize: '1rem' }}>📍</span>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: TOKEN.textMuted, lineHeight: 1.5 }}>
                    Vị trí của các thành viên đang được chia sẻ theo thời gian thực.
                  </p>
                </div>
              )}

              {/* Open blind box button */}
              <button
                onClick={() => handleOpenBlindBox()}
                disabled={Boolean(openedUsers[userId])}
                style={btnPrimary(Boolean(openedUsers[userId]))}
                onMouseEnter={e => {
                  if (!openedUsers[userId]) e.currentTarget.style.background = TOKEN.accentHov;
                }}
                onMouseLeave={e => {
                  if (!openedUsers[userId]) e.currentTarget.style.background = TOKEN.accent;
                }}
              >
                {openedUsers[userId] ? '🎁 Bạn đã mở hộp' : '🎁 Mở hộp ngay'}
              </button>

              {/* Leave room */}
              <button
                onClick={leaveRoom}
                style={{
                  background: 'none', border: 'none',
                  fontSize: '0.78rem', fontWeight: 600,
                  color: TOKEN.textMuted, cursor: 'pointer',
                  padding: '4px', textAlign: 'center',
                  transition: 'color 0.2s',
                }}
                onMouseEnter={e => e.currentTarget.style.color = TOKEN.red}
                onMouseLeave={e => e.currentTarget.style.color = TOKEN.textMuted}
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