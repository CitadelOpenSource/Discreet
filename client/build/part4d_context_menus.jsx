
  // ═══════════════════════════════════════════════════════
  // CONTEXT MENU BUILDERS
  // ═══════════════════════════════════════════════════════

  const openServerCtx = (e, s) => {
    e.preventDefault();
    const isOw = user && s.owner_id === user.id;
    const items = [];
    if (isOw) {
      items.push({ label: "Server Settings", icon: <I.Gear />, fn: () => { setCurSrv(s); setSettingsName(s.name); setSettingsDesc(s.description || ""); setModal({ type: "serverSettings" }); } });
      items.push({ label: "Create Invite", icon: <I.Copy />, fn: async () => { const inv = await api.createInvite(s.id, 0, 168); setModal({ type: "invite", data: inv }); } });
      items.push({ sep: true });
      items.push({ label: "Manage Roles", icon: <I.Tag />, fn: async () => { const r = await api.listRoles(s.id); setRoles(Array.isArray(r) ? r : r?.roles || []); setModal({ type: "roles" }); } });
      items.push({ label: "Ban List", icon: <I.Ban />, fn: async () => { const b = await api.listBans(s.id); setModal({ type: "bans", data: Array.isArray(b) ? b : b?.bans || [] }); } });
      items.push({ label: "Audit Log", icon: <I.Clip2 />, fn: async () => { const l = await api.getAuditLog(s.id); setModal({ type: "audit", data: Array.isArray(l) ? l : l?.entries || [] }); } });
      items.push({ sep: true });
      items.push({ label: "Delete Server", icon: <I.Trash />, danger: true, fn: () => deleteServer(s) });
    } else {
      items.push({ label: "Leave Server", icon: <I.Out />, danger: true, fn: () => leaveServer(s) });
    }
    items.push({ sep: true });
    items.push({ label: "Copy Server ID", icon: <I.Copy />, hint: s.id?.slice(0, 8), fn: () => copyTo(s.id, "Server ID") });
    setCtx({ x: e.clientX, y: e.clientY, items });
  };

  const openChannelCtx = (e, ch) => {
    e.preventDefault();
    const items = [];
    if (isOwner) {
      items.push({ label: "Edit Channel", icon: <I.Edit />, fn: () => { setSettingsName(ch.name); setSettingsTopic(ch.topic || ""); setModal({ type: "channelSettings", channel: ch }); } });
      items.push({ label: "Delete Channel", icon: <I.Trash />, danger: true, fn: () => deleteChannel(ch) });
      items.push({ sep: true });
    }
    items.push({ label: "Copy Channel ID", icon: <I.Copy />, hint: ch.id?.slice(0, 8), fn: () => copyTo(ch.id, "Channel ID") });
    setCtx({ x: e.clientX, y: e.clientY, items });
  };

  const openMemberCtx = (e, m) => {
    e.preventDefault();
    const isSelf = user && m.user_id === user.id;
    const items = [
      { label: "View Profile", icon: <I.Tag />, fn: () => setPopout({ member: m, x: Math.min(e.clientX, window.innerWidth - 310), y: Math.min(e.clientY, window.innerHeight - 400) }) },
    ];
    if (!isSelf && isOwner) {
      items.push({ sep: true });
      items.push({ label: "Manage Roles", icon: <I.Tag />, fn: () => setPopout({ member: m, x: Math.min(e.clientX, window.innerWidth - 310), y: Math.min(e.clientY, window.innerHeight - 400) }) });
      items.push({ label: "Kick", icon: <I.Out />, danger: true, fn: async () => {
        if (!confirm(`Kick ${m.username}?`)) return;
        await api.banMember(curSrv.id, m.user_id, "Kicked");
        await api.unbanMember(curSrv.id, m.user_id);
        api.listMembers(curSrv.id).then(ms => setMembers(Array.isArray(ms) ? ms : []));
        notify(`Kicked ${m.username}`, "success");
      }});
      items.push({ label: "Ban", icon: <I.Ban />, danger: true, fn: async () => {
        const reason = prompt(`Ban reason for ${m.username}:`);
        if (reason === null) return;
        await api.banMember(curSrv.id, m.user_id, reason || "No reason");
        api.listMembers(curSrv.id).then(ms => setMembers(Array.isArray(ms) ? ms : []));
        notify(`Banned ${m.username}`, "success");
      }});
    }
    items.push({ sep: true });
    items.push({ label: "Copy User ID", icon: <I.Copy />, hint: m.user_id?.slice(0, 8), fn: () => copyTo(m.user_id, "User ID") });
    setCtx({ x: e.clientX, y: e.clientY, items });
  };

  const openMsgCtx = (e, m) => {
    e.preventDefault();
    const isMine = user && m.sender_id === user.id;
    const items = [];
    if (isMine) {
      items.push({ label: "Edit Message", icon: <I.Edit />, fn: () => startEdit(m) });
      items.push({ label: "Delete Message", icon: <I.Trash />, danger: true, fn: () => deleteMsg(m) });
      items.push({ sep: true });
    }
    items.push({ label: "Add Reaction", icon: <I.Smile />, fn: () => { /* TODO: inline reaction picker at message */ } });
    if (isOwner) {
      items.push({ label: "Pin Message", icon: <I.Pin />, fn: async () => { await api.pinMessage(curSrv.id, curCh.id, m.id); notify("Message pinned!", "success"); } });
    }
    items.push({ sep: true });
    items.push({ label: "Copy Text", icon: <I.Copy />, fn: () => copyTo(m.text || "", "Message") });
    items.push({ label: "Copy Message ID", icon: <I.Copy />, hint: m.id?.slice(0, 8), fn: () => copyTo(m.id, "Message ID") });
    setCtx({ x: e.clientX, y: e.clientY, items });
  };
