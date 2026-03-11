
  // ═══════════════════════════════════════════════════════
  // RENDER — Main Application Layout
  // ═══════════════════════════════════════════════════════

  return (
    <div style={{ display: "flex", height: "100vh", background: T.bg, color: T.tx, fontFamily: "Inter, -apple-system, sans-serif", overflow: "hidden" }}>

      {/* ═══ SERVER SIDEBAR — 72px ═══ */}
      <div style={{ width: 72, background: T.bg, borderRight: `1px solid ${T.bd}`, display: "flex", flexDirection: "column", alignItems: "center", padding: "10px 0", gap: 6, overflowY: "auto" }}>
        {/* Home / DMs */}
        <div onClick={() => { setCurSrv(null); setCurCh(null); }} title="Home"
          style={{ width: 48, height: 48, borderRadius: curSrv === null ? 16 : 24, background: curSrv === null ? T.ac : T.sf, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "border-radius .2s", color: curSrv === null ? "#000" : T.mt, fontWeight: 700, fontSize: 18 }}>
          <I.Shield />
        </div>
        <div style={{ width: 32, height: 2, background: T.bd, borderRadius: 1, margin: "2px 0" }} />

        {/* Server icons */}
        {servers.map(s => (
          <div key={s.id} onClick={() => { setCurSrv(s); setCurCh(null); setPanel("members"); }}
            onContextMenu={(e) => openServerCtx(e, s)}
            title={s.name}
            style={{ width: 48, height: 48, borderRadius: curSrv?.id === s.id ? 16 : 24, background: curSrv?.id === s.id ? T.ac : T.sf2, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "border-radius .2s", color: curSrv?.id === s.id ? "#000" : T.tx, fontWeight: 700, fontSize: 16, flexShrink: 0 }}>
            {s.name?.[0]?.toUpperCase() || "?"}
          </div>
        ))}

        {/* Add server */}
        <div onClick={() => setShowCreateSrv(true)} title="Create Server"
          style={{ width: 48, height: 48, borderRadius: 24, background: "transparent", border: `2px dashed ${T.bd}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: T.ac }}>
          <I.Plus />
        </div>
        {/* Join server */}
        <div onClick={() => setShowJoin(true)} title="Join Server"
          style={{ width: 48, height: 48, borderRadius: 24, background: "transparent", border: `2px dashed ${T.bd}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: T.warn, fontSize: 12, fontWeight: 700 }}>
          <I.AtSign />
        </div>

        {/* User avatar at bottom */}
        <div style={{ marginTop: "auto" }}>
          <div onClick={() => { api.logout(); setView("auth"); setCurSrv(null); setCurCh(null); setUser(null); }} title="Sign Out"
            style={{ width: 48, height: 48, borderRadius: 24, background: T.sf2, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: T.mt }}>
            <I.Out />
          </div>
        </div>
      </div>

      {/* ═══ CHANNEL SIDEBAR — 240px ═══ */}
      {curSrv && (
        <div style={{ width: 240, background: T.sf, borderRight: `1px solid ${T.bd}`, display: "flex", flexDirection: "column" }}>
          {/* Server name header */}
          <div onContextMenu={(e) => openServerCtx(e, curSrv)}
            style={{ padding: "14px 16px", borderBottom: `1px solid ${T.bd}`, display: "flex", alignItems: "center", cursor: "context-menu" }}>
            <span style={{ fontSize: 15, fontWeight: 700, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{curSrv.name}</span>
            {isOwner && <span onClick={() => { setSettingsName(curSrv.name); setSettingsDesc(curSrv.description || ""); setModal({ type: "serverSettings" }); }}
              style={{ cursor: "pointer", color: T.mt, display: "flex" }}><I.Gear /></span>}
            <I.ChevD />
          </div>

          {/* Channel list */}
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
            <div style={{ display: "flex", alignItems: "center", padding: "4px 16px 8px", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: "uppercase", letterSpacing: "0.5px" }}>Text Channels</span>
              {isOwner && <span onClick={() => setShowCreateCh(true)} style={{ cursor: "pointer", color: T.mt }}><I.Plus /></span>}
            </div>
            {channels.filter(c => c.channel_type === "text").map(ch => (
              <div key={ch.id} onClick={() => setCurCh(ch)} onContextMenu={(e) => openChannelCtx(e, ch)}
                style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 16px", cursor: "pointer",
                  background: curCh?.id === ch.id ? "rgba(0,212,170,0.08)" : "transparent",
                  color: curCh?.id === ch.id ? T.tx : T.mt, borderRadius: 4, margin: "0 8px" }}
                onMouseEnter={e => { if (curCh?.id !== ch.id) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                onMouseLeave={e => { if (curCh?.id !== ch.id) e.currentTarget.style.background = "transparent"; }}>
                <I.Hash /><span style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ch.name}</span>
              </div>
            ))}
          </div>

          {/* User bar at bottom */}
          <div style={{ padding: "10px 12px", borderTop: `1px solid ${T.bd}`, display: "flex", alignItems: "center", gap: 8, background: T.bg }}>
            <div style={{ width: 32, height: 32, borderRadius: 16, background: T.ac2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#000" }}>
              {user?.username?.[0]?.toUpperCase() || "?"}
            </div>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.display_name || user?.username}</div>
              <div style={{ fontSize: 10, color: T.mt }}>@{user?.username}</div>
            </div>
            <span style={{ cursor: "pointer", color: T.mt, display: "flex" }} title={`Fingerprint: ${fp}`}><I.Key /></span>
          </div>
        </div>
      )}

      {/* ═══ HOME SCREEN (no server selected) ═══ */}
      {!curSrv && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
          <I.Shield s={64} />
          <div style={{ fontSize: 24, fontWeight: 700 }}>Welcome to Discreet</div>
          <div style={{ color: T.mt, fontSize: 14, maxWidth: 400, textAlign: "center" }}>Select a server from the sidebar, or create a new one to start chatting with end-to-end encryption.</div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setShowCreateSrv(true)} style={{ padding: "10px 20px", background: T.ac, color: "#000", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>Create Server</button>
            <button onClick={() => setShowJoin(true)} style={{ padding: "10px 20px", background: T.sf2, color: T.tx, border: `1px solid ${T.bd}`, borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>Join Server</button>
          </div>
          {friends.length > 0 && <div style={{ marginTop: 20, fontSize: 12, color: T.mt }}>{friends.length} friend{friends.length !== 1 ? "s" : ""} online</div>}
        </div>
      )}

      {/* ═══ CHAT AREA ═══ */}
      {curSrv && curCh && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {/* Channel header */}
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.bd}`, display: "flex", alignItems: "center", gap: 10, background: T.sf, flexShrink: 0 }}>
            <I.Hash /><span style={{ fontSize: 15, fontWeight: 700 }}>#{curCh.name}</span>
            {curCh.topic && <span style={{ fontSize: 12, color: T.mt, borderLeft: `1px solid ${T.bd}`, paddingLeft: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{curCh.topic}</span>}
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              {isOwner && <span onClick={() => setPanel(p => p === "audit" ? "members" : "audit")} style={{ cursor: "pointer", color: panel === "audit" ? T.warn : T.mt, display: "flex" }} title="Audit Log"><I.Log /></span>}
              <span onClick={() => setPanel(p => p === "pins" ? "members" : "pins")} style={{ cursor: "pointer", color: panel === "pins" ? T.ac : T.mt, display: "flex" }} title="Pinned Messages"><I.Pin /></span>
              <span onClick={() => setPanel("members")} style={{ cursor: "pointer", color: panel === "members" ? T.ac : T.mt, display: "flex" }} title="Members"><I.Users /></span>
              <span style={{ fontSize: 12, color: T.mt }}><I.Lock /> E2EE</span>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
            {messages.length === 0 && <div style={{ textAlign: "center", color: T.mt, padding: 40 }}>
              <I.Hash s={48} /><div style={{ marginTop: 10, fontSize: 16, fontWeight: 700 }}>Welcome to #{curCh.name}</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>This is the start of the channel. Say something!</div>
            </div>}

            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const showDate = !prev || new Date(m.created_at).toDateString() !== new Date(prev.created_at).toDateString();
              const showAuthor = !prev || prev.sender_id !== m.sender_id || showDate || (new Date(m.created_at) - new Date(prev.created_at) > 5 * 60000);
              const sender = members.find(mb => mb.user_id === m.sender_id);
              const senderName = sender?.nickname || sender?.display_name || sender?.username || m.sender_username || "Unknown";
              const isMine = m.sender_id === user?.id;

              return (
                <div key={m.id || i}>
                  {showDate && <DateSep date={m.created_at} />}
                  <div onContextMenu={(e) => openMsgCtx(e, m)}
                    onMouseEnter={() => setHovMsg(m.id)} onMouseLeave={() => setHovMsg(null)}
                    style={{ padding: showAuthor ? "6px 0 2px" : "1px 0", display: "flex", gap: 12, position: "relative",
                      borderRadius: 6, marginLeft: showAuthor ? 0 : 48 }}
                    >
                    {/* Avatar */}
                    {showAuthor && (
                      <div onClick={() => sender && setPopout({ member: sender, x: 80, y: 200 })}
                        style={{ width: 36, height: 36, borderRadius: 18, background: isMine ? T.ac2 : T.sf2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: isMine ? "#000" : T.tx, cursor: "pointer", flexShrink: 0, marginTop: 2 }}>
                        {senderName[0]?.toUpperCase()}
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {showAuthor && (
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
                          <span onClick={() => sender && setPopout({ member: sender, x: 80, y: 200 })}
                            style={{ fontWeight: 700, fontSize: 14, color: isMine ? T.ac : T.tx, cursor: "pointer" }}>{senderName}</span>
                          {sender?.username && senderName !== sender.username && <span style={{ fontSize: 11, color: T.mt }}>@{sender.username}</span>}
                          {curSrv?.owner_id === m.sender_id && <span style={{ color: T.warn, display: "flex" }}><I.Crown /></span>}
                          <span style={{ fontSize: 11, color: T.mt }}>{fmtT(m.created_at)}</span>
                        </div>
                      )}

                      {/* Message content or edit mode */}
                      {editing?.id === m.id ? (
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input value={editText} onChange={e => setEditText(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") { setEditing(null); setEditText(""); } }}
                            autoFocus style={{ flex: 1, padding: "6px 10px", background: T.bg, border: `1px solid ${T.ac}`, borderRadius: 6, color: T.tx, fontSize: 14, outline: "none" }} />
                          <span onClick={saveEdit} style={{ cursor: "pointer", color: T.ac, fontSize: 12, fontWeight: 600 }}>Save</span>
                          <span onClick={() => { setEditing(null); setEditText(""); }} style={{ cursor: "pointer", color: T.mt, fontSize: 12 }}>Esc</span>
                        </div>
                      ) : (
                        <div style={{ fontSize: 14, lineHeight: 1.5, color: m.text ? T.tx : T.mt, wordBreak: "break-word" }}>
                          {m.text || <em>encrypted (old key)</em>}
                          {m.edited_at && <span style={{ fontSize: 10, color: T.mt, marginLeft: 6 }} title={`Edited ${fmtD(m.edited_at)}`}>(edited)</span>}
                        </div>
                      )}
                    </div>

                    {/* Hover quick actions */}
                    {hovMsg === m.id && !editing && (
                      <div style={{ position: "absolute", right: 0, top: -8, display: "flex", gap: 2, background: T.sf, borderRadius: 6, border: `1px solid ${T.bd}`, padding: "2px 4px" }}>
                        {QUICK_REACT.slice(0, 3).map(e => (
                          <span key={e} onClick={() => addReaction(m, e)} style={{ cursor: "pointer", padding: "2px 4px", borderRadius: 3, fontSize: 14 }}
                            onMouseEnter={ev => ev.currentTarget.style.background = "rgba(255,255,255,0.08)"}
                            onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}>{e}</span>
                        ))}
                        {isMine && <span onClick={() => startEdit(m)} style={{ cursor: "pointer", padding: "2px 4px", borderRadius: 3, color: T.mt, display: "flex", alignItems: "center" }}
                          onMouseEnter={ev => { ev.currentTarget.style.background = "rgba(255,255,255,0.08)"; ev.currentTarget.style.color = T.tx; }}
                          onMouseLeave={ev => { ev.currentTarget.style.background = "transparent"; ev.currentTarget.style.color = T.mt; }}><I.Edit /></span>}
                        {isMine && <span onClick={() => deleteMsg(m)} style={{ cursor: "pointer", padding: "2px 4px", borderRadius: 3, color: T.mt, display: "flex", alignItems: "center" }}
                          onMouseEnter={ev => { ev.currentTarget.style.background = "rgba(255,71,87,0.08)"; ev.currentTarget.style.color = T.err; }}
                          onMouseLeave={ev => { ev.currentTarget.style.background = "transparent"; ev.currentTarget.style.color = T.mt; }}><I.Trash /></span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>

          {/* Typing indicator */}
          <TypingIndicator typers={typers.filter(t => t !== user?.username)} />

          {/* Message input */}
          <div style={{ padding: "0 16px 16px", position: "relative" }}>
            {/* Slash command suggestions */}
            <SlashBox input={input} members={members} roles={roles} onSet={setInput} />

            <div style={{ display: "flex", alignItems: "center", gap: 8, background: T.sf2, borderRadius: 10, padding: "8px 14px", border: `1px solid ${T.bd}` }}>
              <div onClick={() => fileRef.current?.click()} style={{ cursor: "pointer", color: T.mt, display: "flex" }}
                onMouseEnter={e => e.currentTarget.style.color = T.tx}
                onMouseLeave={e => e.currentTarget.style.color = T.mt}><I.Clip /></div>
              <input ref={fileRef} type="file" style={{ display: "none" }} onChange={handleFile} />
              <input ref={inputRef} value={input} onChange={onInputChange}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(); } }}
                placeholder={`Message #${curCh.name}`}
                style={{ flex: 1, background: "transparent", border: "none", color: T.tx, fontSize: 14, outline: "none" }} />
              <div ref={emoRef} onClick={() => setShowEmoji(!showEmoji)} style={{ cursor: "pointer", color: T.mt, display: "flex", position: "relative" }}
                onMouseEnter={e => e.currentTarget.style.color = T.tx}
                onMouseLeave={e => e.currentTarget.style.color = T.mt}>
                <I.Smile />
                {showEmoji && <EmojiPicker anchorRef={emoRef} onPick={e => setInput(prev => prev + e)} onClose={() => setShowEmoji(false)} />}
              </div>
              <div onClick={sendMsg} style={{ cursor: "pointer", color: input.trim() ? T.ac : T.mt, display: "flex", transition: "color .15s" }}><I.Send /></div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ RIGHT PANEL — Members / Audit / Pins ═══ */}
      {curSrv && (
        <div style={{ width: 240, background: T.sf, borderLeft: `1px solid ${T.bd}`, display: "flex", flexDirection: "column", overflowY: "auto" }}>
          <div style={{ padding: "14px 16px", borderBottom: `1px solid ${T.bd}`, fontSize: 12, fontWeight: 700, color: T.mt, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
            {panel === "members" && <><I.Users /> Members — {members.length}</>}
            {panel === "audit" && <><I.Log /> Audit Log</>}
            {panel === "pins" && <><I.Pin /> Pinned Messages</>}
          </div>

          {panel === "members" && (
            <div style={{ padding: 8 }}>
              {/* Owner first */}
              {members.filter(m => m.user_id === curSrv.owner_id).map(m => (
                <div key={m.user_id} onClick={() => setPopout({ member: m, x: window.innerWidth - 550, y: 100 })}
                  onContextMenu={(e) => openMemberCtx(e, m)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, cursor: "pointer" }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <div style={{ width: 28, height: 28, borderRadius: 14, background: T.ac2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#000" }}>{m.username?.[0]?.toUpperCase()}</div>
                  <div style={{ flex: 1, overflow: "hidden" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.nickname || m.display_name || m.username}
                      <I.Crown />
                    </div>
                  </div>
                </div>
              ))}
              {/* Other members */}
              {members.filter(m => m.user_id !== curSrv.owner_id).map(m => (
                <div key={m.user_id} onClick={() => setPopout({ member: m, x: window.innerWidth - 550, y: 100 })}
                  onContextMenu={(e) => openMemberCtx(e, m)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, cursor: "pointer" }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <div style={{ width: 28, height: 28, borderRadius: 14, background: T.sf2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: T.tx }}>{m.username?.[0]?.toUpperCase()}</div>
                  <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.nickname || m.display_name || m.username}</div>
                </div>
              ))}
            </div>
          )}

          {panel === "audit" && <div style={{ padding: 12 }}><AuditInline serverId={curSrv.id} /></div>}
          {panel === "pins" && <div style={{ padding: 12, color: T.mt, fontSize: 12 }}>Pinned messages will appear here</div>}
        </div>
      )}
