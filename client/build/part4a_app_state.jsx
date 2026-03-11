
// ═══════════════════════════════════════════════════════════════
// MAIN APPLICATION — Discreet Encrypted Messenger
// ═══════════════════════════════════════════════════════════════
export default function App() {
  // ── Auth state ──
  const [view, setView] = useState(api.token ? "app" : "auth");
  const [authMode, setAuthMode] = useState("login");
  const [authErr, setAuthErr] = useState("");
  const [user, setUser] = useState(null);

  // ── Data state ──
  const [servers, setServers] = useState([]);
  const [channels, setChannels] = useState([]);
  const [members, setMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [roles, setRoles] = useState([]);
  const [pins, setPins] = useState([]);
  const [typers, setTypers] = useState([]);
  const [friends, setFriends] = useState([]);
  const [friendReqs, setFriendReqs] = useState([]);

  // ── Selection state ──
  const [curSrv, setCurSrv] = useState(null);
  const [curCh, setCurCh] = useState(null);

  // ── UI state ──
  const [input, setInput] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [showCreateSrv, setShowCreateSrv] = useState(false);
  const [showCreateCh, setShowCreateCh] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [modal, setModal] = useState(null); // { type: "serverSettings"|"channelSettings"|"audit"|"roles"|"bans"|"invite"|"join" }
  const [ctx, setCtx] = useState(null);     // { x, y, items }
  const [popout, setPopout] = useState(null); // { member, x, y }
  const [panel, setPanel] = useState("members"); // "members"|"audit"|"pins"|"search"
  const [toast, setToast] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editText, setEditText] = useState("");
  const [hovMsg, setHovMsg] = useState(null);
  const [searchQ, setSearchQ] = useState("");

  // ── Form state ──
  const [newSrvName, setNewSrvName] = useState("");
  const [newSrvDesc, setNewSrvDesc] = useState("");
  const [newChName, setNewChName] = useState("");
  const [newChType, setNewChType] = useState("text");
  const [joinCode, setJoinCode] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleColor, setNewRoleColor] = useState("#00d4aa");
  const [settingsName, setSettingsName] = useState("");
  const [settingsDesc, setSettingsDesc] = useState("");
  const [settingsTopic, setSettingsTopic] = useState("");

  // ── Crypto ──
  const [cEng] = useState(() => new CryptoEngine());
  const [fp, setFp] = useState("");

  // ── Refs ──
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const emoRef = useRef(null);
  const fileRef = useRef(null);
  const typingTimer = useRef(null);
  const wsCleanup = useRef(null);

  // ── Helpers ──
  const notify = useCallback((msg, type = "info") => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3500);
  }, []);

  const copyTo = useCallback((t, label) => {
    navigator.clipboard?.writeText(t).then(() => notify(`${label} copied!`, "success")).catch(() => {});
  }, [notify]);

  const isOwner = curSrv && user && curSrv.owner_id === user.id;
