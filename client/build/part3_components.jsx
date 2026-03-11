
// ═══════════════════════════════════════════════════════════════
// CONTEXT MENU — Used for server, channel, member, message right-click
// ═══════════════════════════════════════════════════════════════
function CtxMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const k = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [onClose]);
  const W = typeof window !== "undefined" ? window : { innerWidth: 1200, innerHeight: 800 };
  const mx = Math.min(x, W.innerWidth - 220); const my = Math.min(y, W.innerHeight - (items.length * 34 + 20));
  return (
    <div ref={ref} style={{ position: "fixed", left: mx, top: my, zIndex: 10000, minWidth: 190, background: "#111320", borderRadius: 8, border: `1px solid ${T.bd}`, padding: "4px 0", boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
      {items.map((it, i) => {
        if (it.sep) return <div key={i} style={{ height: 1, background: T.bd, margin: "4px 8px" }} />;
        return (<div key={i} onClick={() => { if (!it.off) { it.fn?.(); onClose(); } }}
          style={{ padding: "7px 12px", display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: it.danger ? T.err : it.off ? T.mt : T.tx, cursor: it.off ? "default" : "pointer", opacity: it.off ? 0.4 : 1, borderRadius: 4, margin: "0 4px" }}
          onMouseEnter={e => { if (!it.off) e.currentTarget.style.background = it.danger ? "rgba(255,71,87,0.08)" : "rgba(255,255,255,0.06)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
          {it.icon && <span style={{ display: "flex", alignItems: "center", width: 18 }}>{it.icon}</span>}
          <span style={{ flex: 1 }}>{it.label}</span>
          {it.hint && <span style={{ fontSize: 10, color: T.mt, fontFamily: "monospace" }}>{it.hint}</span>}
        </div>);
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// EMOJI PICKER — 800ms grace period (Slack=300ms, Discord=400ms)
// ═══════════════════════════════════════════════════════════════
function EmojiPicker({ onPick, onClose, anchorRef }) {
  const [cat, setCat] = useState("Quick");
  const [q, setQ] = useState("");
  const ref = useRef(null);
  const tmr = useRef(null);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target) && anchorRef?.current && !anchorRef.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => { document.removeEventListener("mousedown", h); if (tmr.current) clearTimeout(tmr.current); };
  }, [onClose, anchorRef]);

  const onLeave = () => { tmr.current = setTimeout(onClose, 800); };
  const onEnter = () => { if (tmr.current) { clearTimeout(tmr.current); tmr.current = null; } };

  const list = q ? Object.values(EMOJIS).flat().filter(e => e.includes(q)) : EMOJIS[cat] || [];

  return (
    <div ref={ref} onMouseEnter={onEnter} onMouseLeave={onLeave}
      style={{ position: "absolute", bottom: "calc(100% + 8px)", right: 0, width: 320, background: "#111320", borderRadius: 10, border: `1px solid ${T.bd}`, boxShadow: "0 8px 32px rgba(0,0,0,0.5)", zIndex: 100, overflow: "hidden" }}>
      <div style={{ padding: "8px 10px", borderBottom: `1px solid ${T.bd}` }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search emoji..." autoFocus
          style={{ width: "100%", padding: "6px 10px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.tx, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
      </div>
      {!q && <div style={{ display: "flex", padding: "4px 6px", gap: 2, borderBottom: `1px solid ${T.bd}`, overflowX: "auto" }}>
        {Object.keys(EMOJIS).map(c => (
          <div key={c} onClick={() => setCat(c)} style={{ padding: "4px 8px", borderRadius: 5, fontSize: 11, cursor: "pointer", whiteSpace: "nowrap", background: cat === c ? "rgba(0,212,170,0.12)" : "transparent", color: cat === c ? T.ac : T.mt }}>{c}</div>
        ))}
      </div>}
      <div style={{ padding: 8, display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 2, maxHeight: 200, overflowY: "auto" }}>
        {list.map((e, i) => (
          <div key={i} onClick={() => { onPick(e); onClose(); }}
            style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 5, cursor: "pointer", fontSize: 18 }}
            onMouseEnter={ev => ev.currentTarget.style.background = "rgba(255,255,255,0.08)"}
            onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}>{e}</div>
        ))}
        {list.length === 0 && <div style={{ gridColumn: "1/-1", color: T.mt, fontSize: 12, padding: 10, textAlign: "center" }}>No matches</div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MEMBER POPOUT — Left-click or right-click > Profile
// Shows global username, server nickname, roles (editable by owner)
// ═══════════════════════════════════════════════════════════════
function MemberPopout({ member, serverId, isOwner, allRoles, onClose, onRoleChange }) {
  const [mRoles, setMRoles] = useState([]);
  const [showR, setShowR] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  useEffect(() => {
    if (member?.user_id && serverId) api.listMemberRoles(serverId, member.user_id).then(r => { if (Array.isArray(r)) setMRoles(r); }).catch(() => {});
  }, [member?.user_id, serverId]);

  const toggle = async (rid) => {
    const has = mRoles.some(r => r.id === rid);
    if (has) { await api.unassignRole(serverId, member.user_id, rid); setMRoles(p => p.filter(r => r.id !== rid)); }
    else { await api.assignRole(serverId, member.user_id, rid); const role = allRoles.find(r => r.id === rid); if (role) setMRoles(p => [...p, role]); }
    onRoleChange?.();
  };

  return (
    <div ref={ref} style={{ background: "#111320", borderRadius: 10, border: `1px solid ${T.bd}`, width: 290, boxShadow: "0 8px 32px rgba(0,0,0,0.6)", overflow: "hidden" }}>
      {/* Banner */}
      <div style={{ height: 60, background: `linear-gradient(135deg, ${T.ac}, ${T.ac2})`, position: "relative" }}>
        <div style={{ position: "absolute", bottom: -20, left: 16, width: 48, height: 48, borderRadius: 24, background: T.sf, border: "3px solid #111320", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: T.ac }}>
          {member.username?.[0]?.toUpperCase() || "?"}
        </div>
      </div>
      <div style={{ padding: "28px 16px 14px" }}>
        {/* Display name */}
        <div style={{ fontWeight: 700, fontSize: 16, color: T.tx }}>{member.display_name || member.nickname || member.username}</div>
        {/* Global username always shown */}
        <div style={{ fontSize: 12, color: T.mt, marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
          <span>@{member.username}</span>
          {/* Server nickname badge if different */}
          {member.nickname && member.nickname !== member.username && (
            <span style={{ padding: "1px 6px", borderRadius: 3, background: "rgba(0,212,170,0.08)", color: T.ac, fontSize: 10 }}>
              Server: {member.nickname}
            </span>
          )}
        </div>
        {/* User ID for owners */}
        {isOwner && <div style={{ fontSize: 10, color: T.mt, marginTop: 4, fontFamily: "monospace", opacity: 0.6 }}>ID: {member.user_id}</div>}

        {/* Roles */}
        <div style={{ marginTop: 12, borderTop: `1px solid ${T.bd}`, paddingTop: 10 }}>
          <div onClick={() => isOwner && setShowR(!showR)}
            style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 4, cursor: isOwner ? "pointer" : "default", marginBottom: 6 }}>
            Roles {isOwner && <I.ChevD />} {isOwner && <span style={{ fontSize: 9, color: T.ac, fontWeight: 400, textTransform: "none" }}>click to manage</span>}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {mRoles.length === 0 && <span style={{ fontSize: 11, color: T.mt }}>No roles</span>}
            {mRoles.map(r => (
              <span key={r.id} style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: `${r.color || T.ac}22`, color: r.color || T.ac, border: `1px solid ${r.color || T.ac}44` }}>{r.name}</span>
            ))}
          </div>
          {/* Inline role assignment for owners */}
          {showR && isOwner && (
            <div style={{ marginTop: 8, background: T.bg, borderRadius: 6, border: `1px solid ${T.bd}`, padding: 6, maxHeight: 150, overflowY: "auto" }}>
              {allRoles.map(r => {
                const has = mRoles.some(mr => mr.id === r.id);
                return (<div key={r.id} onClick={() => toggle(r.id)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 12 }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <div style={{ width: 16, height: 16, borderRadius: 3, border: `1px solid ${r.color || T.ac}`, background: has ? (r.color || T.ac) : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {has && <span style={{ fontSize: 10, color: "#000" }}>✓</span>}
                  </div>
                  <span style={{ color: r.color || T.tx }}>{r.name}</span>
                </div>);
              })}
              {allRoles.length === 0 && <div style={{ fontSize: 11, color: T.mt, padding: 4 }}>No roles created yet</div>}
            </div>
          )}
        </div>

        {/* Joined date */}
        {member.joined_at && <div style={{ marginTop: 10, borderTop: `1px solid ${T.bd}`, paddingTop: 8, fontSize: 11, color: T.mt }}>
          Joined: {fmtDate(member.joined_at) || new Date(member.joined_at).toLocaleDateString()}
        </div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SLASH COMMANDS — /ban /kick /role /nick /audit /settings /invite
// Autocomplete members and roles inline
// ═══════════════════════════════════════════════════════════════
function SlashBox({ input, members, roles, onSet }) {
  if (!input.startsWith("/")) return null;
  const parts = input.split(" "); const cmd = parts[0].toLowerCase(); const arg = parts.slice(1).join(" ").toLowerCase();

  const cmds = [
    { c: "/ban", d: "Ban a user from server", icon: <I.Ban /> },
    { c: "/kick", d: "Kick a user", icon: <I.Out /> },
    { c: "/role", d: "Assign role to user", icon: <I.Tag /> },
    { c: "/nick", d: "Set your server nickname", icon: <I.Edit /> },
    { c: "/audit", d: "View audit log", icon: <I.Clip2 /> },
    { c: "/settings", d: "Server settings", icon: <I.Gear /> },
    { c: "/invite", d: "Create invite link", icon: <I.Copy /> },
    { c: "/pin", d: "Pin a message", icon: <I.Pin /> },
    { c: "/search", d: "Search messages", icon: <I.Search /> },
  ];

  const box = { position: "absolute", bottom: "100%", left: 0, right: 0, background: "#111320", borderRadius: "8px 8px 0 0", border: `1px solid ${T.bd}`, borderBottom: "none", padding: 6, zIndex: 50, maxHeight: 240, overflowY: "auto" };
  const row = { display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 5, cursor: "pointer", fontSize: 13 };
  const hov = (e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)";
  const uhov = (e) => e.currentTarget.style.background = "transparent";

  // Show all commands on just "/"
  if (input === "/") return (
    <div style={box}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, padding: "4px 8px", textTransform: "uppercase" }}>Slash Commands</div>
      {cmds.map(c => (<div key={c.c} onClick={() => onSet(c.c + " ")} style={row} onMouseEnter={hov} onMouseLeave={uhov}>
        <span style={{ color: T.ac }}>{c.icon}</span>
        <span style={{ color: T.tx, fontWeight: 600, fontFamily: "monospace" }}>{c.c}</span>
        <span style={{ color: T.mt, fontSize: 12 }}>{c.d}</span>
      </div>))}
    </div>
  );

  // Member autocomplete for /ban, /kick, /role
  if (["/ban", "/kick", "/role"].includes(cmd) && parts.length <= 2) {
    const f = members.filter(m => !arg || m.username?.toLowerCase().includes(arg) || m.nickname?.toLowerCase()?.includes(arg));
    if (!f.length) return null;
    return (<div style={box}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, padding: "4px 8px" }}>Select member:</div>
      {f.slice(0, 10).map(m => (<div key={m.user_id} onClick={() => onSet(`${cmd} ${m.username} `)} style={row} onMouseEnter={hov} onMouseLeave={uhov}>
        <div style={{ width: 22, height: 22, borderRadius: 11, background: T.ac2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#000" }}>{m.username?.[0]?.toUpperCase()}</div>
        <span style={{ color: T.tx }}>{m.nickname || m.username}</span>
        <span style={{ color: T.mt, fontSize: 11 }}>@{m.username}</span>
      </div>))}
    </div>);
  }

  // Role autocomplete for /role user <role>
  if (cmd === "/role" && parts.length >= 3) {
    const rArg = parts.slice(2).join(" ").toLowerCase();
    const f = roles.filter(r => !rArg || r.name?.toLowerCase().includes(rArg));
    return (<div style={box}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, padding: "4px 8px" }}>Select role for {parts[1]}:</div>
      {f.map(r => (<div key={r.id} onClick={() => onSet(`/role ${parts[1]} ${r.name}`)} style={row} onMouseEnter={hov} onMouseLeave={uhov}>
        <div style={{ width: 10, height: 10, borderRadius: 5, background: r.color || T.ac }} />
        <span style={{ color: r.color || T.tx }}>{r.name}</span>
      </div>))}
      {!f.length && <div style={{ fontSize: 11, color: T.mt, padding: "4px 8px" }}>No matching roles</div>}
    </div>);
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// MODAL — Reusable for Settings, Audit, Roles, Bans, etc.
// ═══════════════════════════════════════════════════════════════
function Modal({ title, onClose, children, w = 500 }) {
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h); return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }} onClick={onClose}>
      <div style={{ width: w, maxWidth: "92vw", maxHeight: "85vh", background: T.sf, borderRadius: 14, border: `1px solid ${T.bd}`, display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.bd}`, display: "flex", alignItems: "center" }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: T.tx, flex: 1 }}>{title}</span>
          <div onClick={onClose} style={{ cursor: "pointer", color: T.mt, padding: 4, borderRadius: 4 }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}><I.X /></div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TYPING INDICATOR — Shows "user is typing..." with animated dots
// ═══════════════════════════════════════════════════════════════
function TypingIndicator({ typers }) {
  if (!typers || typers.length === 0) return null;
  const names = typers.slice(0, 3).join(", ");
  const extra = typers.length > 3 ? ` and ${typers.length - 3} more` : "";
  return (
    <div style={{ padding: "2px 16px 6px", fontSize: 11, color: T.mt, display: "flex", alignItems: "center", gap: 6, minHeight: 20 }}>
      <span className="typing-dots" style={{ display: "inline-flex", gap: 2 }}>
        <span style={{ width: 4, height: 4, borderRadius: 2, background: T.mt, animation: "typingBounce 1.2s infinite", animationDelay: "0ms" }} />
        <span style={{ width: 4, height: 4, borderRadius: 2, background: T.mt, animation: "typingBounce 1.2s infinite", animationDelay: "200ms" }} />
        <span style={{ width: 4, height: 4, borderRadius: 2, background: T.mt, animation: "typingBounce 1.2s infinite", animationDelay: "400ms" }} />
      </span>
      <span><strong style={{ color: T.tx }}>{names}</strong>{extra} {typers.length === 1 ? "is" : "are"} typing</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// QUICK REACTION BAR — Shows on message hover
// ═══════════════════════════════════════════════════════════════
const QUICK_REACT = ["👍","❤️","😂","🔥","👀","🎉"];

function ReactionBar({ reactions, channelId, messageId, myUserId }) {
  if (!reactions || reactions.length === 0) return null;
  // Group reactions by emoji
  const grouped = {};
  reactions.forEach(r => {
    if (!grouped[r.emoji]) grouped[r.emoji] = { emoji: r.emoji, count: 0, me: false };
    grouped[r.emoji].count++;
    if (r.user_id === myUserId) grouped[r.emoji].me = true;
  });
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
      {Object.values(grouped).map(r => (
        <div key={r.emoji} onClick={async () => {
          if (r.me) await api.removeReaction(channelId, messageId, r.emoji);
          else await api.addReaction(channelId, messageId, r.emoji);
        }}
          style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 6px", borderRadius: 4,
            background: r.me ? "rgba(0,212,170,0.12)" : "rgba(255,255,255,0.04)",
            border: r.me ? `1px solid ${T.ac}44` : `1px solid ${T.bd}`,
            cursor: "pointer", fontSize: 13 }}>
          <span>{r.emoji}</span>
          <span style={{ fontSize: 11, color: r.me ? T.ac : T.mt, fontWeight: 600 }}>{r.count}</span>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// @MENTION AUTOCOMPLETE — Type @ to get suggestions
// ═══════════════════════════════════════════════════════════════
function MentionBox({ input, cursorPos, members, onInsert }) {
  // Find @ pattern before cursor
  const before = input.slice(0, cursorPos);
  const atMatch = before.match(/@(\w*)$/);
  if (!atMatch) return null;
  const q = atMatch[1].toLowerCase();
  const filtered = members.filter(m => m.username?.toLowerCase().includes(q)).slice(0, 6);
  if (filtered.length === 0) return null;

  return (
    <div style={{ position: "absolute", bottom: "100%", left: 0, right: 0, background: "#111320", borderRadius: "8px 8px 0 0", border: `1px solid ${T.bd}`, borderBottom: "none", padding: 6, zIndex: 50 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, padding: "4px 8px" }}>Members</div>
      {filtered.map(m => (
        <div key={m.user_id} onClick={() => {
          const prefix = input.slice(0, cursorPos - atMatch[0].length);
          const suffix = input.slice(cursorPos);
          onInsert(prefix + `@${m.username} ` + suffix);
        }}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 4, cursor: "pointer", fontSize: 13 }}
          onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
          <div style={{ width: 22, height: 22, borderRadius: 11, background: T.ac2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#000" }}>{m.username?.[0]?.toUpperCase()}</div>
          <span style={{ color: T.tx }}>{m.nickname || m.display_name || m.username}</span>
          <span style={{ color: T.mt, fontSize: 11 }}>@{m.username}</span>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DATE SEPARATOR — Shown between messages from different days
// ═══════════════════════════════════════════════════════════════
function DateSep({ date }) {
  return (
    <div style={{ display: "flex", alignItems: "center", margin: "12px 0", gap: 10 }}>
      <div style={{ flex: 1, height: 1, background: T.bd }} />
      <span style={{ fontSize: 11, fontWeight: 700, color: T.mt, whiteSpace: "nowrap" }}>{fmtDate(date)}</span>
      <div style={{ flex: 1, height: 1, background: T.bd }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// AUDIT LOG INLINE PANEL (sidebar)
// ═══════════════════════════════════════════════════════════════
function AuditInline({ serverId }) {
  const [ents, setEnts] = useState([]); const [ld, setLd] = useState(true);
  useEffect(() => { if (!serverId) return; setLd(true);
    api.getAuditLog(serverId, 30).then(d => { setEnts(Array.isArray(d) ? d : d?.entries || []); setLd(false); }).catch(() => setLd(false));
  }, [serverId]);
  if (ld) return <div style={{ color: T.mt, fontSize: 12, padding: 8 }}>Loading audit log...</div>;
  return (<div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.8 }}>
    {ents.length === 0 && <div style={{ color: T.mt }}>No audit entries yet</div>}
    {ents.map((e, i) => (<div key={i} style={{ padding: "4px 0", borderBottom: `1px solid ${T.bd}33` }}>
      <div style={{ color: T.warn, fontWeight: 600 }}>{e.action_type}</div>
      <div style={{ color: T.mt, fontSize: 9 }}>{new Date(e.created_at).toLocaleString()}</div>
      {e.details && <div style={{ color: T.tx, fontSize: 9, opacity: 0.6 }}>{typeof e.details === "string" ? e.details : JSON.stringify(e.details)}</div>}
    </div>))}
  </div>);
}
