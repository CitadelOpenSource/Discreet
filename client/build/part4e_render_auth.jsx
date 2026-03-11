
  // ═══════════════════════════════════════════════════════
  // RENDER — Auth Screen
  // ═══════════════════════════════════════════════════════

  if (view === "auth") return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: T.bg, color: T.tx, fontFamily: "Inter, -apple-system, sans-serif" }}>
      <div style={{ width: 380, padding: 32, background: T.sf, borderRadius: 16, border: `1px solid ${T.bd}` }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 8 }}>
            <I.Shield s={28} /><span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px" }}>Discreet</span>
          </div>
          <div style={{ fontSize: 13, color: T.mt }}>End-to-end encrypted messaging</div>
        </div>

        {/* Tab switch */}
        <div style={{ display: "flex", gap: 4, background: T.bg, borderRadius: 8, padding: 3, marginBottom: 20 }}>
          {["login", "register"].map(m => (
            <div key={m} onClick={() => { setAuthMode(m); setAuthErr(""); }}
              style={{ flex: 1, padding: "8px 0", textAlign: "center", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer",
                background: authMode === m ? T.ac : "transparent", color: authMode === m ? "#000" : T.mt, transition: "all .15s" }}>
              {m === "login" ? "Sign In" : "Register"}
            </div>
          ))}
        </div>

        {authErr && <div style={{ padding: "8px 12px", background: "rgba(255,71,87,0.08)", border: `1px solid ${T.err}33`, borderRadius: 8, color: T.err, fontSize: 13, marginBottom: 14 }}>{authErr}</div>}

        <form onSubmit={doAuth}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.mt, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6, display: "block" }}>Username</label>
            <input name="username" required autoComplete="username" style={{ width: "100%", padding: "10px 14px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 14, outline: "none", boxSizing: "border-box" }} placeholder="Choose a username" />
          </div>
          {authMode === "register" && <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.mt, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6, display: "block" }}>Email (optional)</label>
            <input name="email" type="email" autoComplete="email" style={{ width: "100%", padding: "10px 14px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 14, outline: "none", boxSizing: "border-box" }} placeholder="you@example.com" />
          </div>}
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.mt, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6, display: "block" }}>Password</label>
            <input name="password" type="password" required autoComplete={authMode === "login" ? "current-password" : "new-password"}
              style={{ width: "100%", padding: "10px 14px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 14, outline: "none", boxSizing: "border-box" }} placeholder="••••••••" />
            {authMode === "register" && <div style={{ fontSize: 11, color: T.mt, marginTop: 4 }}>Min 8 chars, upper + lower + digit required</div>}
          </div>
          <button type="submit" style={{ width: "100%", padding: "12px", background: T.ac, color: "#000", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            {authMode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 12, color: T.mt, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <I.Lock /><span>Zero-knowledge encryption active</span>
        </div>
      </div>
    </div>
  );
