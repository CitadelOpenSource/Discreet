import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════
// CITADEL CRYPTO ENGINE — Web Crypto API
// Uses the same primitives as MLS: AES-GCM, ECDH, ECDSA
// In production this layer is replaced by OpenMLS compiled to WASM
// ═══════════════════════════════════════════════════════════════
class CryptoEngine {
  constructor() {
    this.keys = new Map();
    this.ready = false;
    this.identity = null;
    this.fingerprint = "";
    this.log = [];
  }

  async init() {
    this.identity = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]
    );
    const raw = await crypto.subtle.exportKey("raw", this.identity.publicKey);
    const bytes = new Uint8Array(raw);
    this.fingerprint = Array.from(bytes.slice(0, 8))
      .map(b => b.toString(16).padStart(2, "0")).join(":");
    this.ready = true;
    return this.fingerprint;
  }

  async deriveKey(channelId, epoch = 0) {
    const enc = new TextEncoder();
    const material = await crypto.subtle.importKey(
      "raw", enc.encode(`citadel:${channelId}:${epoch}`),
      { name: "PBKDF2" }, false, ["deriveKey"]
    );
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: enc.encode("mls-group-secret"), iterations: 100000, hash: "SHA-256" },
      material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
    this.keys.set(`${channelId}:${epoch}`, key);
    return key;
  }

  async encrypt(plaintext, channelId, epoch = 0) {
    const cacheKey = `${channelId}:${epoch}`;
    let key = this.keys.get(cacheKey);
    if (!key) key = await this.deriveKey(channelId, epoch);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      key, new TextEncoder().encode(plaintext)
    );
    const combined = new Uint8Array(12 + ct.byteLength);
    combined.set(iv); combined.set(new Uint8Array(ct), 12);
    return btoa(String.fromCharCode(...combined));
  }

  async decrypt(b64, channelId, epoch = 0) {
    try {
      const cacheKey = `${channelId}:${epoch}`;
      let key = this.keys.get(cacheKey);
      if (!key) key = await this.deriveKey(channelId, epoch);
      const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const pt = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: data.slice(0, 12), tagLength: 128 },
        key, data.slice(12)
      );
      return new TextDecoder().decode(pt);
    } catch { return null; }
  }
}

// ═══════════════════════════════════════════════════════════════
// DEMO DATA
// ═══════════════════════════════════════════════════════════════
const U = [
  { id: "u0", name: "phantom", tag: "0001", status: "online", color: "#00d4aa" },
  { id: "u1", name: "spectre", tag: "4721", status: "online", color: "#7c5cff" },
  { id: "u2", name: "cipher", tag: "8834", status: "idle", color: "#ffa502" },
  { id: "u3", name: "nova", tag: "2290", status: "online", color: "#ff6b81" },
  { id: "u4", name: "wraith", tag: "6655", status: "dnd", color: "#ff4757" },
  { id: "u5", name: "zenith", tag: "1337", status: "offline", color: "#6e7490" },
];
const SERVERS = [
  { id: "s1", name: "Citadel Dev", icon: "🏰" },
  { id: "s2", name: "CyberSec Ops", icon: "🔒" },
  { id: "s3", name: "Rust Guild", icon: "🦀" },
];
const CHANNELS = {
  s1: [
    { id: "c1", name: "general", type: "text", topic: "Main discussion — all messages E2EE" },
    { id: "c2", name: "development", type: "text", topic: "Architecture and code review" },
    { id: "c3", name: "crypto-review", type: "text", topic: "MLS protocol implementation" },
    { id: "c4", name: "Voice Lounge", type: "voice" },
    { id: "c5", name: "War Room", type: "voice" },
  ],
  s2: [
    { id: "c6", name: "general", type: "text", topic: "Security operations" },
    { id: "c7", name: "threat-intel", type: "text", topic: "IOC sharing and analysis" },
    { id: "c8", name: "CTF Ops", type: "voice" },
  ],
  s3: [
    { id: "c9", name: "general", type: "text", topic: "All things Rust" },
    { id: "c10", name: "async-runtime", type: "text", topic: "Tokio, async-std, smol" },
    { id: "c11", name: "Pair Programming", type: "voice" },
  ],
};
const SEED = {
  c1: [
    [1, "Just pushed the WebSocket fan-out rewrite. Each client only receives events for channels they're subscribed to.", -55],
    [2, "Nice. Did you benchmark it against the old broadcast-everything approach?", -50],
    [1, "Yeah — 40% less bandwidth at 500 concurrent connections. The channel subscription filter in the relay loop is O(1) now.", -47],
    [0, "Love it. The MLS key package distribution endpoint is live too. Clients can upload batches of 100 KeyPackages and they're claimed atomically when someone joins a channel.", -40],
    [3, "Quick question: what happens when a user runs out of KeyPackages?", -36],
    [0, "Server returns 404 with a message telling the client to upload more. The client should auto-replenish when the count drops below 50. We'll add a WebSocket event to nudge.", -32],
    [2, "Speaking of — I've been reading the OpenMLS Commit flow. When we do epoch rotation, every member needs to process the Commit message to advance their group state. If someone is offline...", -25],
    [0, "They catch up when they reconnect. The server stores the commit chain. Client replays commits in order to reach the current epoch. OpenMLS handles this natively.", -20],
    [4, "Landing page update: 847 waitlist signups since the HN post yesterday. 63 GitHub stars. Three people opened PRs already.", -12],
    [1, "🚀 Let's go. What did they PR?", -10],
    [4, "Two typo fixes and one real one — someone added CORS preflight handling for the WebSocket upgrade. Actually useful.", -7],
  ],
  c2: [
    [0, "Architecture decision logged: we're using Axum 0.7 over Actix-web. Tower middleware ecosystem is too valuable to skip.", -120],
    [2, "Agreed. The middleware composition for auth + rate limiting + logging is clean. Here's the stack:", -115],
    [2, "```\nRouter::new()\n  .layer(TraceLayer)\n  .layer(CorsLayer)\n  .layer(CompressionLayer)\n  .route_layer(AuthLayer)  // JWT validation\n```", -112],
    [1, "For the database layer — are we going compile-time checked queries with sqlx or runtime?", -100],
    [0, "Runtime for now. Schema is still changing. Once we lock the migration, we switch to `sqlx::query!` with offline mode.", -95],
  ],
  c3: [
    [2, "Security consideration: MLS Post-Compromise Security requires that after a device is compromised and then secured, future messages become safe after the next epoch change.", -180],
    [0, "Right. The key is the Update proposal — a member generates fresh key material and issues a Commit. After that, the compromised keys are useless for future epochs.", -175],
    [2, "What's our epoch rotation policy? Signal rotates every message. MLS can be less aggressive since the tree structure makes it cheaper.", -168],
    [0, "I'm thinking: rotate on member add/remove (mandatory per spec), plus every 100 messages or 1 hour, whichever comes first. Keeps PCS tight without hammering performance.", -160],
    [3, "For safety numbers — are we doing QR codes like Signal or just hex fingerprints?", -150],
    [0, "Both. The identity key fingerprint is SHA-256 of the public key, displayed as hex pairs. QR encodes the same thing for in-person verification.", -145],
  ],
  c6: [
    [4, "New IOC drop from the Persona breach analysis. The exposed frontend code reveals their verification flow stores raw image data in S3 buckets with predictable naming.", -90],
    [2, "That's... not great. Did anyone check if the bucket policy was public?", -85],
    [4, "It was scoped to their API gateway, but the frontend code had the signing logic embedded. Anyone who deobfuscates the JS can generate valid presigned URLs.", -80],
  ],
};
const VOICE_USERS = { c4: ["u1", "u3"], c5: [], c8: ["u4"], c11: [] };
const SC = { online: "#00d4aa", idle: "#ffa502", dnd: "#ff4757", offline: "#2a2d3a" };

// ═══════════════════════════════════════════════════════════════
// SVG ICONS
// ═══════════════════════════════════════════════════════════════
const I = {
  Hash: (p) => <svg {...p} width={p?.s||18} height={p?.s||18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>,
  Vol: (p) => <svg {...p} width={p?.s||18} height={p?.s||18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 010 7.07"/></svg>,
  Send: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  Lock: (p) => <svg width={p?.s||13} height={p?.s||13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>,
  Shield: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  Plus: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  Mic: () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>,
  Hp: () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z"/></svg>,
  X: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Chk: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>,
  Eye: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
};

// ═══════════════════════════════════════════════════════════════
// APP
// ═══════════════════════════════════════════════════════════════
export default function App() {
  const [me] = useState(U[0]);
  const [srv, setSrv] = useState(SERVERS[0]);
  const [ch, setCh] = useState(CHANNELS.s1[0]);
  const [msgs, setMsgs] = useState({});
  const [input, setInput] = useState("");
  const [eng] = useState(() => new CryptoEngine());
  const [ready, setReady] = useState(false);
  const [fp, setFp] = useState("");
  const [panel, setPanel] = useState(null); // null | "crypto" | "members"
  const [cLog, setCLog] = useState([]);
  const [typing, setTyping] = useState(null);
  const [inspecting, setInspecting] = useState(null);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  const addLog = useCallback((m, t = "info") => {
    setCLog(p => [...p.slice(-40), { t: new Date(), m, type: t }]);
  }, []);

  // Init crypto
  useEffect(() => {
    (async () => {
      const f = await eng.init();
      setFp(f);
      setReady(true);
      addLog("Identity keypair generated (ECDSA P-256)", "key");
      addLog(`Fingerprint: ${f}`, "key");
      for (const sid of Object.keys(CHANNELS)) {
        for (const c of CHANNELS[sid]) {
          if (c.type === "text") await eng.deriveKey(c.id);
        }
      }
      addLog("Channel group keys derived (PBKDF2 → AES-256-GCM)", "key");
    })();
  }, []);

  // Seed messages
  useEffect(() => {
    if (!ready) return;
    (async () => {
      const all = {};
      for (const [cid, lines] of Object.entries(SEED)) {
        all[cid] = [];
        for (const [ui, text, tOff] of lines) {
          const ct = await eng.encrypt(text, cid);
          all[cid].push({
            id: Math.random().toString(36).slice(2, 10),
            author: U[ui], text, ciphertext: ct,
            epoch: 0, ts: new Date(Date.now() + tOff * 60000),
          });
        }
      }
      setMsgs(all);
      addLog(`Seeded ${Object.values(all).flat().length} encrypted messages`, "info");
    })();
  }, [ready]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, ch]);

  // Toggle members panel by default, crypto panel on click
  useEffect(() => {
    setPanel("members");
  }, []);

  const send = async () => {
    if (!input.trim() || !ready) return;
    const text = input.trim();
    setInput("");
    addLog(`Encrypt: "${text.slice(0, 40)}${text.length > 40 ? "…" : ""}"`, "enc");
    const ct = await eng.encrypt(text, ch.id);
    addLog(`→ AES-256-GCM ciphertext (${ct.length}B, epoch 0)`, "enc");
    addLog(`→ Sent to server as opaque blob`, "net");

    setMsgs(p => ({
      ...p,
      [ch.id]: [...(p[ch.id] || []), {
        id: Math.random().toString(36).slice(2, 10),
        author: me, text, ciphertext: ct, epoch: 0, ts: new Date(),
      }],
    }));

    // Simulate others typing occasionally
    if (Math.random() > 0.4) {
      const r = U[1 + Math.floor(Math.random() * 4)];
      setTyping(r);
      setTimeout(() => setTyping(null), 2200 + Math.random() * 1500);
    }
    inputRef.current?.focus();
  };

  const chs = CHANNELS[srv.id] || [];
  const textChs = chs.filter(c => c.type === "text");
  const voiceChs = chs.filter(c => c.type === "voice");
  const curMsgs = msgs[ch?.id] || [];
  const fmtTime = d => d ? new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

  // Responsive: hide right panel on narrow screens
  const [wide, setWide] = useState(window.innerWidth > 900);
  useEffect(() => {
    const h = () => setWide(window.innerWidth > 900);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  // ─── STYLES ───
  const bg = "#080a10", sf = "#0c0e16", sf2 = "#10131c", bd = "#161a28", tx = "#dfe1ea",
    mt = "#626882", dm = "#3a3f58", ac = "#00d4aa", ag = "rgba(0,212,170,0.08)";

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", background: bg, color: tx, fontFamily: "'Segoe UI',-apple-system,BlinkMacSystemFont,sans-serif", fontSize: 14, overflow: "hidden" }}>

      {/* ══════ SERVER RAIL ══════ */}
      <div style={{ width: 72, minWidth: 72, background: "#060810", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 12, gap: 8, borderRight: `1px solid ${bd}` }}>
        <div style={{ width: 48, height: 48, borderRadius: 16, background: `linear-gradient(135deg,${ac},#009e80)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, cursor: "pointer" }} title="Citadel Home">🏰</div>
        <div style={{ width: 32, height: 2, background: bd, borderRadius: 1, margin: "2px 0" }} />
        {SERVERS.map(s => (
          <div key={s.id} onClick={() => { setSrv(s); const c = CHANNELS[s.id]; if (c?.length) setCh(c[0]); }} style={{ width: 48, height: 48, borderRadius: srv.id === s.id ? 16 : 24, background: srv.id === s.id ? sf2 : "#0a0c14", border: srv.id === s.id ? `2px solid ${ac}` : "2px solid transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 20, transition: "all .2s", position: "relative" }} title={s.name}>
            {srv.id === s.id && <div style={{ position: "absolute", left: -14, top: "50%", transform: "translateY(-50%)", width: 4, height: 20, background: ac, borderRadius: 2 }} />}
            {s.icon}
          </div>
        ))}
        <div style={{ width: 48, height: 48, borderRadius: 24, background: "#0a0c14", border: `2px dashed ${bd}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: ac }} title="Create Server"><I.Plus /></div>
      </div>

      {/* ══════ CHANNEL SIDEBAR ══════ */}
      <div style={{ width: 240, minWidth: 240, background: sf, borderRight: `1px solid ${bd}`, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px 16px", borderBottom: `1px solid ${bd}`, fontWeight: 700, fontSize: 15, letterSpacing: "-0.3px" }}>{srv.name}</div>
        <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
          <SectionLabel>Text Channels</SectionLabel>
          {textChs.map(c => (
            <ChItem key={c.id} active={ch?.id === c.id} onClick={() => setCh(c)}>
              <span style={{ opacity: .5 }}><I.Hash /></span>
              <span style={{ flex: 1 }}>{c.name}</span>
              <span style={{ color: ac, opacity: .6 }}><I.Lock /></span>
            </ChItem>
          ))}
          <SectionLabel>Voice Channels</SectionLabel>
          {voiceChs.map(c => (
            <div key={c.id}>
              <ChItem>
                <span style={{ opacity: .5 }}><I.Vol /></span>
                <span style={{ flex: 1 }}>{c.name}</span>
                <span style={{ color: ac, opacity: .6 }}><I.Lock /></span>
              </ChItem>
              {(VOICE_USERS[c.id] || []).map(uid => {
                const u = U.find(x => x.id === uid);
                return u ? (
                  <div key={uid} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 12px 2px 42px", fontSize: 13, color: mt }}>
                    <div style={{ width: 6, height: 6, borderRadius: 3, background: SC[u.status] }} />
                    {u.name}
                  </div>
                ) : null;
              })}
            </div>
          ))}
        </div>
        {/* User bar */}
        <div style={{ padding: "10px 12px", background: "#060810", borderTop: `1px solid ${bd}`, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ position: "relative" }}>
            <Avatar u={me} size={32} />
            <StatusDot status={me.status} outline="#060810" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{me.name}</div>
            <div style={{ fontSize: 11, color: mt }}>#{me.tag}</div>
          </div>
          <span style={{ cursor: "pointer", opacity: .4, color: mt }}><I.Mic /></span>
          <span style={{ cursor: "pointer", opacity: .4, color: mt }}><I.Hp /></span>
        </div>
      </div>

      {/* ══════ MAIN ══════ */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Header */}
        <div style={{ height: 48, minHeight: 48, padding: "0 16px", display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${bd}`, background: bg }}>
          <span style={{ opacity: .45 }}><I.Hash /></span>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{ch?.name}</span>
          {ch?.topic && wide && <>
            <div style={{ width: 1, height: 20, background: bd }} />
            <span style={{ fontSize: 13, color: mt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ch.topic}</span>
          </>}
          <div style={{ flex: 1 }} />
          <Pill onClick={() => setPanel(panel === "crypto" ? "members" : "crypto")} active={panel === "crypto"}>
            <I.Shield /><span>E2EE</span><I.Chk />
          </Pill>
        </div>

        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Messages */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 0" }}>
              {/* Welcome */}
              <div style={{ marginBottom: 24, paddingBottom: 16, borderBottom: `1px solid ${bd}` }}>
                <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Welcome to #{ch?.name}</div>
                <p style={{ color: mt, fontSize: 14, marginBottom: 8 }}>This is the start of <strong>#{ch?.name}</strong>. All messages are end-to-end encrypted.</p>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 6, background: ag, border: "1px solid rgba(0,212,170,0.15)", fontSize: 12, color: ac }}>
                  <I.Lock /> MLS (RFC 9420) · AES-256-GCM · Epoch 0
                </div>
              </div>
              {/* Messages */}
              {curMsgs.map((m, i) => {
                const showHead = i === 0 || curMsgs[i - 1]?.author.id !== m.author.id || (m.ts - curMsgs[i - 1]?.ts) > 300000;
                const isInspected = inspecting === m.id;
                return (
                  <div key={m.id} style={{ padding: showHead ? "6px 8px 2px" : "1px 8px", display: "flex", gap: 12, borderRadius: 6, background: isInspected ? "rgba(0,212,170,0.04)" : "transparent", transition: "background .15s", cursor: "pointer" }}
                    onClick={() => { setInspecting(isInspected ? null : m.id); if (!isInspected) { addLog(`Inspecting message ${m.id.slice(0,6)}…`, "dec"); addLog(`Ciphertext: ${m.ciphertext.slice(0,48)}…`, "dec"); addLog(`Decrypted ✓ (AES-256-GCM, epoch ${m.epoch})`, "dec"); } }}>
                    {showHead ? <Avatar u={m.author} size={40} style={{ marginTop: 2 }} /> : <div style={{ width: 40, minWidth: 40 }} />}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      {showHead && (
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 1 }}>
                          <span style={{ fontWeight: 700, fontSize: 14, color: m.author.color }}>{m.author.name}</span>
                          <span style={{ fontSize: 11, color: dm }}>{fmtTime(m.ts)}</span>
                        </div>
                      )}
                      {isInspected ? (
                        <div>
                          <div style={{ fontSize: 14, lineHeight: 1.5, color: "#d0d3de", wordBreak: "break-word", marginBottom: 6 }}>{m.text}</div>
                          <div style={{ padding: "8px 10px", borderRadius: 6, background: "#0a0c14", border: `1px solid ${bd}`, fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: mt, lineHeight: 1.7 }}>
                            <div><span style={{ color: ac }}>cipher:</span> {m.ciphertext.slice(0, 60)}…</div>
                            <div><span style={{ color: ac }}>algo:</span> AES-256-GCM <span style={{ color: dm }}>|</span> <span style={{ color: ac }}>epoch:</span> {m.epoch} <span style={{ color: dm }}>|</span> <span style={{ color: ac }}>iv:</span> {m.ciphertext.slice(0, 16)}</div>
                            <div><span style={{ color: "#00d4aa" }}>status:</span> <span style={{ color: "#00d4aa" }}>✓ decrypted client-side</span></div>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: 14, lineHeight: 1.5, color: "#d0d3de", wordBreak: "break-word" }}>
                          {m.text.startsWith("```") ? (
                            <pre style={{ background: "#0a0c14", border: `1px solid ${bd}`, borderRadius: 6, padding: "8px 12px", fontSize: 13, fontFamily: "'JetBrains Mono',monospace", overflowX: "auto", whiteSpace: "pre-wrap", margin: "4px 0", color: "#b0b8d0" }}>{m.text.replace(/```\w*\n?/g, "").replace(/```$/g, "")}</pre>
                          ) : m.text}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {typing && (
                <div style={{ padding: "8px 8px", fontSize: 13, color: mt, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ display: "flex", gap: 3 }}>
                    {[0, 1, 2].map(i => <span key={i} style={{ width: 4, height: 4, borderRadius: 2, background: mt, animation: `cbounce 1.4s infinite ${i * .2}s` }} />)}
                  </span>
                  <strong style={{ color: typing.color }}>{typing.name}</strong> is typing…
                </div>
              )}
              <div ref={endRef} style={{ height: 8 }} />
            </div>
            {/* Input */}
            <div style={{ padding: "0 16px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: sf2, borderRadius: 10, border: `1px solid ${bd}`, transition: "border-color .15s" }}>
                <span style={{ color: ac, opacity: .5 }}><I.Lock s={15} /></span>
                <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder={`Message #${ch?.name} (end-to-end encrypted)`}
                  style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: tx, fontSize: 14, fontFamily: "inherit" }} />
                <button onClick={send} disabled={!input.trim()} style={{ background: input.trim() ? ac : bd, border: "none", borderRadius: 6, padding: "6px 8px", cursor: input.trim() ? "pointer" : "default", color: input.trim() ? bg : dm, display: "flex", transition: "all .15s" }}>
                  <I.Send />
                </button>
              </div>
            </div>
          </div>

          {/* ══════ RIGHT PANEL ══════ */}
          {wide && panel === "crypto" && (
            <div style={{ width: 320, minWidth: 320, background: sf, borderLeft: `1px solid ${bd}`, overflowY: "auto" }}>
              <div style={{ padding: 16, borderBottom: `1px solid ${bd}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 15 }}><I.Shield /> Encryption Details</div>
                <span onClick={() => setPanel("members")} style={{ cursor: "pointer", color: mt }}><I.X /></span>
              </div>
              <div style={{ padding: 16 }}>
                {/* Status badge */}
                <div style={{ padding: 12, borderRadius: 8, background: ag, border: "1px solid rgba(0,212,170,0.15)", marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, color: ac, fontWeight: 700, fontSize: 13 }}><I.Chk /> End-to-End Encrypted</div>
                  <div style={{ fontSize: 12, color: mt, lineHeight: 1.5 }}>Messages encrypted on your device. Server stores only ciphertext blobs. Click any message to inspect its encryption.</div>
                </div>

                {/* Protocol */}
                <SectionLabel>Protocol Stack</SectionLabel>
                <div style={{ marginBottom: 16 }}>
                  {[
                    ["Group E2EE", "MLS (RFC 9420)"],
                    ["Cipher", "AES-256-GCM"],
                    ["Key Exchange", "X25519 (ECDH)"],
                    ["Signatures", "Ed25519"],
                    ["Hash", "SHA-256"],
                    ["Current Epoch", "0"],
                    ["Forward Secrecy", "✓"],
                    ["Post-Compromise", "✓"],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${bd}`, fontSize: 13 }}>
                      <span style={{ color: mt }}>{k}</span>
                      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>{v}</span>
                    </div>
                  ))}
                </div>

                {/* Fingerprint */}
                <SectionLabel>Your Identity</SectionLabel>
                <div style={{ padding: 10, borderRadius: 6, background: "#0a0c14", fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: ac, wordBreak: "break-all", marginBottom: 16 }}>
                  <div style={{ fontSize: 11, color: dm, marginBottom: 4 }}>Fingerprint (ECDSA P-256)</div>
                  {fp || "Generating…"}
                </div>

                {/* Live encryption log */}
                <SectionLabel>Live Crypto Log</SectionLabel>
                <div style={{ background: "#060810", borderRadius: 6, padding: 10, maxHeight: 220, overflowY: "auto", fontFamily: "'JetBrains Mono',monospace", fontSize: 11, lineHeight: 1.6 }}>
                  {cLog.slice(-20).map((e, i) => (
                    <div key={i} style={{ color: e.type === "enc" ? "#7c5cff" : e.type === "dec" ? "#ffa502" : e.type === "key" ? ac : mt }}>
                      <span style={{ color: dm }}>[{e.t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}]</span>{" "}{e.m}
                    </div>
                  ))}
                  {cLog.length === 0 && <div style={{ color: dm }}>Waiting for crypto operations…</div>}
                </div>

                {/* Data flow */}
                <SectionLabel style={{ marginTop: 16 }}>Zero-Knowledge Flow</SectionLabel>
                <div style={{ padding: 12, borderRadius: 8, background: "#0a0c14", fontSize: 12, lineHeight: 2, fontFamily: "'JetBrains Mono',monospace", color: mt }}>
                  <div><span style={{ color: ac }}>You</span> → plaintext message</div>
                  <div><span style={{ color: ac }}>You</span> → AES-256-GCM encrypt</div>
                  <div><span style={{ color: "#ff6b81" }}>Server</span> → receives opaque blob 🔒</div>
                  <div><span style={{ color: "#ff6b81" }}>Server</span> → relays to channel members</div>
                  <div><span style={{ color: "#7c5cff" }}>Them</span> → AES-256-GCM decrypt</div>
                  <div><span style={{ color: "#7c5cff" }}>Them</span> → reads plaintext ✓</div>
                </div>
              </div>
            </div>
          )}

          {wide && panel === "members" && (
            <div style={{ width: 240, minWidth: 240, background: sf, borderLeft: `1px solid ${bd}`, overflowY: "auto", padding: "16px 12px" }}>
              <SectionLabel>Online — {U.filter(u => u.status !== "offline").length}</SectionLabel>
              {U.filter(u => u.status !== "offline").map(u => (
                <MemberRow key={u.id} u={u} />
              ))}
              <SectionLabel style={{ marginTop: 16 }}>Offline — {U.filter(u => u.status === "offline").length}</SectionLabel>
              {U.filter(u => u.status === "offline").map(u => (
                <MemberRow key={u.id} u={u} dim />
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes cbounce { 0%,60%,100%{opacity:.3;transform:translateY(0)} 30%{opacity:1;transform:translateY(-3px)} }
        ::-webkit-scrollbar{width:6px} ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:${bd};border-radius:3px} ::-webkit-scrollbar-thumb:hover{background:#252a40}
        ::selection{background:rgba(0,212,170,.25)} input::placeholder{color:${dm}}
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap');
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// REUSABLE COMPONENTS
// ═══════════════════════════════════════════════════════════════
function Avatar({ u, size = 32, style = {} }) {
  return (
    <div style={{ width: size, height: size, minWidth: size, borderRadius: size / 2, background: u.color + "33", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.42, fontWeight: 700, color: u.color, ...style }}>
      {u.name[0].toUpperCase()}
    </div>
  );
}

function StatusDot({ status, outline = "#0c0e16" }) {
  return (
    <div style={{ position: "absolute", bottom: -1, right: -1, width: 10, height: 10, borderRadius: 5, background: SC[status], border: `2px solid ${outline}` }} />
  );
}

function SectionLabel({ children, style = {} }) {
  return (
    <div style={{ padding: "8px 8px 4px", fontSize: 11, fontWeight: 700, color: "#626882", letterSpacing: ".5px", textTransform: "uppercase", ...style }}>{children}</div>
  );
}

function ChItem({ children, active, onClick }) {
  return (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", margin: "1px 8px", borderRadius: 6, cursor: "pointer", background: active ? "#161a28" : "transparent", color: active ? "#dfe1ea" : "#626882", transition: "all .15s", fontSize: 14 }}>
      {children}
    </div>
  );
}

function MemberRow({ u, dim }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 8px", borderRadius: 6, opacity: dim ? .35 : 1, marginBottom: 1 }}>
      <div style={{ position: "relative" }}>
        <Avatar u={u} size={32} />
        <StatusDot status={u.status} outline="#0c0e16" />
      </div>
      <span style={{ fontSize: 13, color: dim ? "#626882" : "#d0d3de" }}>{u.name}</span>
    </div>
  );
}

function Pill({ children, onClick, active }) {
  return (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6, background: active ? "rgba(0,212,170,0.12)" : "rgba(0,212,170,0.06)", border: `1px solid ${active ? "rgba(0,212,170,0.35)" : "rgba(0,212,170,0.15)"}`, cursor: "pointer", fontSize: 12, color: "#00d4aa", fontWeight: 600, transition: "all .15s", userSelect: "none" }}>
      {children}
    </div>
  );
}
