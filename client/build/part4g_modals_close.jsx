
      {/* ═══ CONTEXT MENU ═══ */}
      {ctx && <CtxMenu x={ctx.x} y={ctx.y} items={ctx.items} onClose={() => setCtx(null)} />}

      {/* ═══ MEMBER POPOUT ═══ */}
      {popout && (
        <div style={{ position: "fixed", left: popout.x, top: popout.y, zIndex: 9000 }}>
          <MemberPopout member={popout.member} serverId={curSrv?.id} isOwner={isOwner} allRoles={roles}
            onClose={() => setPopout(null)} onRoleChange={() => api.listMembers(curSrv.id).then(m => setMembers(Array.isArray(m) ? m : []))} />
        </div>
      )}

      {/* ═══ MODALS ═══ */}

      {/* Create Server */}
      {showCreateSrv && (
        <Modal title="Create a Server" onClose={() => setShowCreateSrv(false)} w={420}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.mt, textTransform: "uppercase", marginBottom: 6, display: "block" }}>Server Name</label>
            <input value={newSrvName} onChange={e => setNewSrvName(e.target.value)} autoFocus placeholder="My Awesome Server"
              style={{ width: "100%", padding: "10px 14px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.mt, textTransform: "uppercase", marginBottom: 6, display: "block" }}>Description (optional)</label>
            <input value={newSrvDesc} onChange={e => setNewSrvDesc(e.target.value)} placeholder="What's this server about?"
              style={{ width: "100%", padding: "10px 14px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>
          <button onClick={createServer} style={{ width: "100%", padding: "12px", background: T.ac, color: "#000", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Create Server</button>
        </Modal>
      )}

      {/* Create Channel */}
      {showCreateCh && (
        <Modal title="Create Channel" onClose={() => setShowCreateCh(false)} w={420}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.mt, textTransform: "uppercase", marginBottom: 6, display: "block" }}>Channel Name</label>
            <input value={newChName} onChange={e => setNewChName(e.target.value)} autoFocus placeholder="general"
              style={{ width: "100%", padding: "10px 14px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>
          <button onClick={createChannel} style={{ width: "100%", padding: "12px", background: T.ac, color: "#000", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Create Channel</button>
        </Modal>
      )}

      {/* Join Server */}
      {showJoin && (
        <Modal title="Join a Server" onClose={() => setShowJoin(false)} w={420}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.mt, textTransform: "uppercase", marginBottom: 6, display: "block" }}>Invite Code</label>
            <input value={joinCode} onChange={e => setJoinCode(e.target.value)} autoFocus placeholder="Paste invite code here"
              onKeyDown={e => { if (e.key === "Enter") joinServer(); }}
              style={{ width: "100%", padding: "10px 14px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>
          <button onClick={joinServer} style={{ width: "100%", padding: "12px", background: T.ac, color: "#000", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Join Server</button>
        </Modal>
      )}

      {/* Server Settings */}
      {modal?.type === "serverSettings" && (
        <Modal title="Server Settings" onClose={() => setModal(null)}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.mt, textTransform: "uppercase", marginBottom: 6, display: "block" }}>Server Name</label>
            <input value={settingsName} onChange={e => setSettingsName(e.target.value)}
              style={{ width: "100%", padding: "10px 14px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.mt, textTransform: "uppercase", marginBottom: 6, display: "block" }}>Description</label>
            <textarea value={settingsDesc} onChange={e => setSettingsDesc(e.target.value)} rows={3}
              style={{ width: "100%", padding: "10px 14px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 14, outline: "none", resize: "vertical", boxSizing: "border-box" }} />
          </div>
          <button onClick={saveServerSettings} style={{ width: "100%", padding: "12px", background: T.ac, color: "#000", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Save Changes</button>
          {isOwner && <>
            <div style={{ margin: "20px 0", height: 1, background: T.bd }} />
            <button onClick={() => { setModal(null); deleteServer(curSrv); }}
              style={{ width: "100%", padding: "12px", background: "transparent", color: T.err, border: `1px solid ${T.err}33`, borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Delete Server</button>
          </>}
        </Modal>
      )}

      {/* Channel Settings */}
      {modal?.type === "channelSettings" && (
        <Modal title={`Edit #${modal.channel?.name}`} onClose={() => setModal(null)} w={420}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.mt, textTransform: "uppercase", marginBottom: 6, display: "block" }}>Channel Name</label>
            <input value={settingsName} onChange={e => setSettingsName(e.target.value)}
              style={{ width: "100%", padding: "10px 14px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.mt, textTransform: "uppercase", marginBottom: 6, display: "block" }}>Topic</label>
            <input value={settingsTopic} onChange={e => setSettingsTopic(e.target.value)} placeholder="What's this channel about?"
              style={{ width: "100%", padding: "10px 14px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>
          <button onClick={saveChannelSettings} style={{ width: "100%", padding: "12px", background: T.ac, color: "#000", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Save Changes</button>
        </Modal>
      )}

      {/* Audit Log Modal */}
      {modal?.type === "audit" && (
        <Modal title="Audit Log" onClose={() => setModal(null)} w={600}>
          <div style={{ maxHeight: 400, overflowY: "auto" }}>
            {(modal.data || []).length === 0 && <div style={{ color: T.mt, textAlign: "center", padding: 20 }}>No audit entries yet</div>}
            {(modal.data || []).map((e, i) => (
              <div key={i} style={{ padding: "10px 0", borderBottom: `1px solid ${T.bd}22`, display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div style={{ padding: "3px 8px", borderRadius: 4, background: "rgba(255,165,2,0.08)", color: T.warn, fontSize: 11, fontWeight: 700, fontFamily: "monospace", whiteSpace: "nowrap" }}>{e.action_type}</div>
                <div style={{ flex: 1 }}>
                  {e.details && <div style={{ fontSize: 12, color: T.tx }}>{typeof e.details === "string" ? e.details : JSON.stringify(e.details)}</div>}
                  <div style={{ fontSize: 10, color: T.mt, marginTop: 2 }}>{fmtD(e.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* Invite Modal */}
      {modal?.type === "invite" && (
        <Modal title="Server Invite" onClose={() => setModal(null)} w={420}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.mt, textTransform: "uppercase", marginBottom: 6, display: "block" }}>Invite Code</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input readOnly value={modal.data?.code || modal.data?.invite_code || ""} style={{ flex: 1, padding: "10px 14px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.ac, fontSize: 16, fontFamily: "monospace", fontWeight: 700, outline: "none" }} />
              <button onClick={() => copyTo(modal.data?.code || modal.data?.invite_code || "", "Invite code")}
                style={{ padding: "10px 16px", background: T.ac, color: "#000", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>Copy</button>
            </div>
          </div>
          <div style={{ fontSize: 12, color: T.mt }}>Share this code with people to let them join your server.</div>
        </Modal>
      )}

      {/* Roles Management Modal */}
      {modal?.type === "roles" && (
        <Modal title="Manage Roles" onClose={() => setModal(null)}>
          <div style={{ marginBottom: 20, display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: T.mt, textTransform: "uppercase", marginBottom: 6, display: "block" }}>New Role</label>
              <input value={newRoleName} onChange={e => setNewRoleName(e.target.value)} placeholder="Role name"
                onKeyDown={e => { if (e.key === "Enter") createRole(); }}
                style={{ width: "100%", padding: "10px 14px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
            </div>
            <input type="color" value={newRoleColor} onChange={e => setNewRoleColor(e.target.value)} style={{ width: 42, height: 42, border: "none", borderRadius: 8, cursor: "pointer" }} />
            <button onClick={createRole} style={{ padding: "10px 16px", background: T.ac, color: "#000", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>Create</button>
          </div>
          <div>
            {roles.length === 0 && <div style={{ color: T.mt, textAlign: "center", padding: 20 }}>No roles created yet</div>}
            {roles.map(r => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${T.bd}22` }}>
                <div style={{ width: 14, height: 14, borderRadius: 7, background: r.color || T.ac }} />
                <span style={{ flex: 1, fontWeight: 600, color: r.color || T.tx }}>{r.name}</span>
                <span onClick={() => deleteRole(r)} style={{ cursor: "pointer", color: T.mt, padding: 4 }}
                  onMouseEnter={e => e.currentTarget.style.color = T.err}
                  onMouseLeave={e => e.currentTarget.style.color = T.mt}><I.Trash /></span>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* Bans Modal */}
      {modal?.type === "bans" && (
        <Modal title="Banned Users" onClose={() => setModal(null)}>
          {(modal.data || []).length === 0 && <div style={{ color: T.mt, textAlign: "center", padding: 20 }}>No banned users</div>}
          {(modal.data || []).map((b, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${T.bd}22` }}>
              <I.Ban />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{b.username || b.user_id?.slice(0, 8)}</div>
                {b.reason && <div style={{ fontSize: 12, color: T.mt }}>{b.reason}</div>}
              </div>
              <button onClick={async () => {
                await api.unbanMember(curSrv.id, b.user_id);
                setModal(prev => ({ ...prev, data: prev.data.filter(x => x.user_id !== b.user_id) }));
                notify("User unbanned", "success");
              }} style={{ padding: "4px 10px", background: "transparent", color: T.ac, border: `1px solid ${T.ac}44`, borderRadius: 6, fontSize: 12, cursor: "pointer" }}>Unban</button>
            </div>
          ))}
        </Modal>
      )}

      {/* ═══ TOAST ═══ */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", padding: "10px 20px", borderRadius: 10,
          background: toast.type === "success" ? "rgba(0,212,170,0.95)" : toast.type === "error" ? "rgba(255,71,87,0.95)" : "rgba(55,66,250,0.95)",
          color: "#fff", fontSize: 13, fontWeight: 600, zIndex: 99999, boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }}>
          {toast.msg}
        </div>
      )}

      {/* ═══ GLOBAL CSS for animations ═══ */}
      <style>{`
        @keyframes typingBounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-4px); }
        }
        * { scrollbar-width: thin; scrollbar-color: ${T.bd} transparent; }
        *::-webkit-scrollbar { width: 6px; }
        *::-webkit-scrollbar-track { background: transparent; }
        *::-webkit-scrollbar-thumb { background: ${T.bd}; border-radius: 3px; }
        *::-webkit-scrollbar-thumb:hover { background: ${T.mt}; }
        input:focus, textarea:focus { border-color: ${T.ac} !important; }
      `}</style>

    </div>
  );
}
