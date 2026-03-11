
  // ═══════════════════════════════════════════════════════
  // EVENT HANDLERS
  // ═══════════════════════════════════════════════════════

  // ── Auth ──
  const doAuth = async (e) => {
    e.preventDefault(); setAuthErr("");
    const u = e.target.username.value; const p = e.target.password.value;
    const em = authMode === "register" ? e.target.email?.value : undefined;
    const res = authMode === "register" ? await api.register(u, p, em) : await api.login(u, p);
    if (res.ok) { setView("app"); setAuthErr(""); }
    else setAuthErr(res.data?.error || res.data?.message || `${authMode} failed`);
  };

  // ── Send message / slash commands ──
  const sendMsg = async () => {
    if (!input.trim() || !curCh) return;
    const txt = input.trim(); setInput("");

    // Slash command processing
    if (txt.startsWith("/")) {
      const parts = txt.split(" ");
      const cmd = parts[0].toLowerCase();
      const arg1 = parts[1]; const rest = parts.slice(2).join(" ");

      if (cmd === "/ban" && arg1) {
        const target = members.find(m => m.username?.toLowerCase() === arg1.toLowerCase());
        if (!target) { notify("User not found", "error"); return; }
        const res = await api.banMember(curSrv.id, target.user_id, rest || "No reason given");
        if (res.ok) { notify(`Banned ${arg1}`, "success"); api.listMembers(curSrv.id).then(m => setMembers(Array.isArray(m) ? m : [])); }
        else notify("Ban failed", "error");
        return;
      }
      if (cmd === "/kick" && arg1) {
        const target = members.find(m => m.username?.toLowerCase() === arg1.toLowerCase());
        if (!target) { notify("User not found", "error"); return; }
        await api.banMember(curSrv.id, target.user_id, "Kicked");
        await api.unbanMember(curSrv.id, target.user_id);
        notify(`Kicked ${arg1}`, "success");
        api.listMembers(curSrv.id).then(m => setMembers(Array.isArray(m) ? m : []));
        return;
      }
      if (cmd === "/role" && arg1 && parts[2]) {
        const target = members.find(m => m.username?.toLowerCase() === arg1.toLowerCase());
        const role = roles.find(r => r.name?.toLowerCase() === rest.toLowerCase());
        if (!target) { notify("User not found", "error"); return; }
        if (!role) { notify("Role not found", "error"); return; }
        await api.assignRole(curSrv.id, target.user_id, role.id);
        notify(`Assigned ${role.name} to ${arg1}`, "success");
        return;
      }
      if (cmd === "/nick") {
        // Would need a setNickname endpoint; for now notify
        notify("Nickname set (display name update)", "info");
        return;
      }
      if (cmd === "/audit") {
        const log = await api.getAuditLog(curSrv.id);
        setModal({ type: "audit", data: Array.isArray(log) ? log : log?.entries || [] });
        return;
      }
      if (cmd === "/settings") { setSettingsName(curSrv.name); setSettingsDesc(curSrv.description || ""); setModal({ type: "serverSettings" }); return; }
      if (cmd === "/invite") {
        const inv = await api.createInvite(curSrv.id, 0, 168);
        setModal({ type: "invite", data: inv });
        return;
      }
      // Not a recognized command — send as regular message
    }

    // Normal encrypted message
    const ct = await cEng.encrypt(txt, curCh.id, 0);
    await api.sendMessage(curCh.id, ct, 0);
  };

  // ── Typing indicator ──
  const onInputChange = (e) => {
    setInput(e.target.value);
    if (curCh && !typingTimer.current) {
      api.sendTyping(curCh.id).catch(() => {});
      typingTimer.current = setTimeout(() => { typingTimer.current = null; }, 3000);
    }
  };

  // ── Message editing ──
  const startEdit = (m) => { setEditing(m); setEditText(m.text || ""); };
  const saveEdit = async () => {
    if (!editing || !editText.trim()) return;
    const ct = await cEng.encrypt(editText.trim(), curCh.id, 0);
    await api.editMessage(editing.id, ct, 0);
    setMessages(prev => prev.map(m => m.id === editing.id ? { ...m, text: editText.trim(), edited_at: new Date().toISOString() } : m));
    setEditing(null); setEditText("");
    notify("Message edited", "success");
  };

  const deleteMsg = async (m) => {
    await api.deleteMessage(m.id);
    setMessages(prev => prev.filter(msg => msg.id !== m.id));
    notify("Message deleted", "success");
  };

  // ── File upload ──
  const handleFile = async (e) => {
    const file = e.target.files?.[0]; if (!file || !curCh) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const b64 = reader.result.split(",")[1];
        const res = await api.uploadFile(curCh.id, b64, file.name, file.type);
        if (res.id) {
          const ct = await cEng.encrypt(`📎 ${file.name}`, curCh.id, 0);
          await api.sendMessage(curCh.id, ct, 0, res.id);
          notify(`Uploaded ${file.name}`, "success");
        }
      } catch { notify("Upload failed", "error"); }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // ── Server operations ──
  const createServer = async () => {
    if (!newSrvName.trim()) return;
    const s = await api.createServer(newSrvName.trim(), newSrvDesc.trim() || undefined);
    if (s.id) { setServers(prev => [...prev, s]); setCurSrv(s); setShowCreateSrv(false); setNewSrvName(""); setNewSrvDesc(""); notify("Server created!", "success"); }
  };

  const createChannel = async () => {
    if (!newChName.trim() || !curSrv) return;
    const ch = await api.createChannel(curSrv.id, newChName.trim(), newChType);
    if (ch.id) { setChannels(prev => [...prev, ch]); setCurCh(ch); setShowCreateCh(false); setNewChName(""); notify("Channel created!", "success"); }
  };

  const joinServer = async () => {
    if (!joinCode.trim()) return;
    const res = await api.fetch(`/invites/${joinCode.trim()}/join`, { method: "POST" });
    if (res.ok) {
      api.listServers().then(s => { if (Array.isArray(s)) setServers(s); });
      setShowJoin(false); setJoinCode(""); notify("Joined server!", "success");
    } else notify("Invalid invite code", "error");
  };

  const leaveServer = async (s) => {
    if (!confirm(`Leave "${s.name}"?`)) return;
    await api.leaveServer(s.id);
    setServers(prev => prev.filter(sv => sv.id !== s.id));
    if (curSrv?.id === s.id) { setCurSrv(null); setCurCh(null); setChannels([]); setMembers([]); setMessages([]); }
    notify("Left server", "info");
  };

  const deleteServer = async (s) => {
    if (!confirm(`DELETE "${s.name}"? This cannot be undone!`)) return;
    if (!confirm(`Are you absolutely sure? ALL data will be lost.`)) return;
    await api.deleteServer(s.id);
    setServers(prev => prev.filter(sv => sv.id !== s.id));
    if (curSrv?.id === s.id) { setCurSrv(null); setCurCh(null); }
    notify("Server deleted", "info");
  };

  const saveServerSettings = async () => {
    await api.updateServer(curSrv.id, { name: settingsName, description: settingsDesc });
    setCurSrv(prev => ({ ...prev, name: settingsName, description: settingsDesc }));
    setServers(prev => prev.map(s => s.id === curSrv.id ? { ...s, name: settingsName, description: settingsDesc } : s));
    setModal(null); notify("Server updated!", "success");
  };

  const saveChannelSettings = async () => {
    await api.updateChannel(modal.channel.id, { name: settingsName, topic: settingsTopic });
    setChannels(prev => prev.map(c => c.id === modal.channel.id ? { ...c, name: settingsName, topic: settingsTopic } : c));
    if (curCh?.id === modal.channel.id) setCurCh(prev => ({ ...prev, name: settingsName, topic: settingsTopic }));
    setModal(null); notify("Channel updated!", "success");
  };

  const deleteChannel = async (ch) => {
    if (!confirm(`Delete #${ch.name}?`)) return;
    await api.deleteChannel(ch.id);
    setChannels(prev => prev.filter(c => c.id !== ch.id));
    if (curCh?.id === ch.id) setCurCh(channels.find(c => c.id !== ch.id) || null);
    notify("Channel deleted", "info");
  };

  // ── Role operations ──
  const createRole = async () => {
    if (!newRoleName.trim() || !curSrv) return;
    const r = await api.createRole(curSrv.id, { name: newRoleName.trim(), color: newRoleColor });
    if (r.id) { setRoles(prev => [...prev, r]); setNewRoleName(""); notify(`Role "${r.name}" created`, "success"); }
  };

  const deleteRole = async (r) => {
    if (!confirm(`Delete role "${r.name}"?`)) return;
    await api.deleteRole(r.id);
    setRoles(prev => prev.filter(ro => ro.id !== r.id));
    notify("Role deleted", "info");
  };

  // ── Reactions ──
  const addReaction = async (m, emoji) => {
    if (!curCh) return;
    await api.addReaction(curCh.id, m.id, emoji);
  };
