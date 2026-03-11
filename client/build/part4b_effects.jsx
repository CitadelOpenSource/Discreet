
  // ═══════════════════════════════════════════════════════
  // EFFECTS — Data loading, WebSocket, crypto init
  // ═══════════════════════════════════════════════════════

  // Init crypto on mount
  useEffect(() => { cEng.init().then(setFp); }, [cEng]);

  // Load user + servers on auth
  useEffect(() => {
    if (view !== "app") return;
    api.getMe().then(u => { setUser(u); api.username = u.username; }).catch(() => { api.clearAuth(); setView("auth"); });
    api.listServers().then(s => { if (Array.isArray(s)) setServers(s); else if (s?.servers) setServers(s.servers); });
    api.listFriends().then(f => { if (Array.isArray(f)) setFriends(f); }).catch(() => {});
    api.listIncomingRequests().then(r => { if (Array.isArray(r)) setFriendReqs(r); }).catch(() => {});
  }, [view]);

  // Load channels + members + roles when server changes
  useEffect(() => {
    if (!curSrv) return;
    api.listChannels(curSrv.id).then(c => {
      const chs = Array.isArray(c) ? c : c?.channels || [];
      setChannels(chs);
      if (chs.length > 0 && !curCh) setCurCh(chs.find(ch => ch.channel_type === "text") || chs[0]);
    });
    api.listMembers(curSrv.id).then(m => { if (Array.isArray(m)) setMembers(m); else if (m?.members) setMembers(m.members); });
    api.listRoles(curSrv.id).then(r => { if (Array.isArray(r)) setRoles(r); else if (r?.roles) setRoles(r.roles); }).catch(() => setRoles([]));

    // Connect WebSocket
    api.connectWs(curSrv.id);
    if (wsCleanup.current) wsCleanup.current();
    wsCleanup.current = api.onWsEvent(async (evt) => {
      if (evt.type === "new_message" && evt.channel_id === curCh?.id) {
        try {
          const pt = await cEng.decrypt(evt.content_ciphertext, evt.channel_id, evt.mls_epoch || 0);
          setMessages(prev => [...prev, { ...evt, text: pt }]);
        } catch { setMessages(prev => [...prev, { ...evt, text: "[decryption failed]" }]); }
      }
      if (evt.type === "message_edited") { setMessages(prev => prev.map(m => m.id === evt.id ? { ...m, edited_at: evt.edited_at, content_ciphertext: evt.content_ciphertext } : m)); }
      if (evt.type === "message_deleted") { setMessages(prev => prev.filter(m => m.id !== evt.id)); }
      if (evt.type === "typing_start") {
        setTypers(prev => { if (prev.includes(evt.username)) return prev; return [...prev, evt.username]; });
        setTimeout(() => setTypers(prev => prev.filter(u => u !== evt.username)), 5000);
      }
      if (evt.type === "member_joined") { api.listMembers(curSrv.id).then(m => { if (Array.isArray(m)) setMembers(m); }); }
      if (evt.type === "member_left") { setMembers(prev => prev.filter(m => m.user_id !== evt.user_id)); }
    });

    return () => { if (wsCleanup.current) wsCleanup.current(); api.disconnectWs(); };
  }, [curSrv?.id]);

  // Load messages when channel changes
  useEffect(() => {
    if (!curCh) return;
    setMessages([]);
    api.getMessages(curCh.id, 50).then(async (raw) => {
      const msgs = Array.isArray(raw) ? raw : raw?.messages || [];
      const decrypted = await Promise.all(msgs.map(async (m) => {
        try { const pt = await cEng.decrypt(m.content_ciphertext, curCh.id, m.mls_epoch || 0); return { ...m, text: pt }; }
        catch { return { ...m, text: null }; }
      }));
      setMessages(decrypted.reverse());
    });
  }, [curCh?.id, cEng]);

  // Auto-scroll on new messages
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);
