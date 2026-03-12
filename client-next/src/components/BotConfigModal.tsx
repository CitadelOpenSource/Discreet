/**
 * BotConfigModal — Comprehensive bot configuration panel.
 * Tabs: general, behavior, personality, limits, advanced.
 */
import React, { useState, useEffect, useRef } from 'react';
import { T, getInp } from '../theme';
import { api } from '../api/CitadelAPI';
import { Modal } from './Modal';

// ─── Types ───────────────────────────────────────────────

interface BotInfo {
  bot_user_id?: string;
  username?: string;
  display_name?: string;
  persona?: string;
  system_prompt?: string;
  description?: string;
  voice_style?: string;
  temperature?: number;
  max_tokens?: number;
  response_mode?: string;
  dm_auto_respond?: boolean;
  greeting_message?: string;
  blocked_topics?: string;
  response_prefix?: string;
  rate_limit_per_min?: number;
  persistent?: boolean;
  enabled?: boolean;
  typing_delay?: number;
  context_memory?: boolean;
  context_window?: number;
  auto_thread?: boolean;
  dm_greeting?: string;
  emoji_reactions?: boolean;
  language?: string;
  knowledge_base?: string;
}

interface BotConfig {
  display_name: string;
  persona: string;
  system_prompt: string;
  description: string;
  voice_style: string;
  temperature: number;
  max_tokens: number;
  response_mode: string;
  dm_auto_respond: boolean;
  greeting_message: string;
  blocked_topics: string;
  response_prefix: string;
  rate_limit_per_min: number;
  persistent: boolean;
  enabled: boolean;
  typing_delay: number;
  context_memory: boolean;
  context_window: number;
  auto_thread: boolean;
  dm_greeting: string;
  emoji_reactions: boolean;
  language: string;
  knowledge_base: string;
  show_bot_tag: boolean;
}

export interface BotConfigModalProps {
  bot: BotInfo;
  serverId?: string;
  channelId?: string;
  onClose: () => void;
  onSave?: (cfg: BotConfig) => void;
  showConfirm: (title: string, message: string, danger?: boolean) => Promise<boolean>;
}

// ─── Bot log entry ────────────────────────────────────────

interface BotLog {
  ts:            number;
  user:          string;
  msg:           string;
  response:      string;
  channel?:      string;
  responseTime?: number; // ms
}

// ─── Preset templates ─────────────────────────────────────

interface PresetCfg {
  system_prompt:    string;
  temperature:      number;
  voice_style:      string;
  greeting_message: string;
  response_prefix:  string;
}

interface Preset {
  id:      string;
  icon:    string;
  name:    string;
  tagline: string;
  color:   string;
  cfg:     PresetCfg;
}

export const PRESETS: Preset[] = [
  {
    id: 'gamemaster', icon: '🎲', name: 'Game Master', tagline: 'Jovial RPG narrator', color: '#9b59b6',
    cfg: {
      system_prompt:    'You are the Game Master — a jovial, dramatic storyteller who narrates tabletop RPG adventures. Paint vivid scenes, voice memorable NPCs, and keep players engaged with twists, challenges, and rewards. Stay in character during scenes but break clearly to answer rules questions.',
      temperature:      1.2,
      voice_style:      'dramatic',
      greeting_message: '⚔️ Welcome, brave adventurers! Gather round — your quest begins NOW!',
      response_prefix:  '🎲 GM',
    },
  },
  {
    id: 'codehelper', icon: '💻', name: 'Code Helper', tagline: 'Precise & technical', color: '#3ba55d',
    cfg: {
      system_prompt:    'You are a precise software engineering assistant. Provide accurate, concise code solutions with brief explanations. Always include working code examples, note edge cases, and suggest best practices. Format code in markdown blocks. Prefer clarity over verbosity.',
      temperature:      0.2,
      voice_style:      'technical',
      greeting_message: 'Ready to help with your code. Drop your question, error, or snippet.',
      response_prefix:  '💻',
    },
  },
  {
    id: 'creativewriter', icon: '✍️', name: 'Creative Writer', tagline: 'Imaginative & flowery', color: '#e91e8c',
    cfg: {
      system_prompt:    'You are a Creative Writer — a gifted, imaginative storyteller with a flowery, lyrical voice. Help with story ideas, character development, prose, poetry, and worldbuilding. Embrace metaphor, sensory detail, and emotional depth. Inspire creativity in every response.',
      temperature:      1.5,
      voice_style:      'expressive',
      greeting_message: '✨ Ah, a kindred spirit! Come, let us weave worlds from words together. What story shall we tell today?',
      response_prefix:  '✍️',
    },
  },
  {
    id: 'mathtutor', icon: '📐', name: 'Math Tutor', tagline: 'Patient step-by-step', color: '#faa61a',
    cfg: {
      system_prompt:    'You are a patient, encouraging Math Tutor. Break every problem into clear numbered steps, explain the reasoning behind each step, and check understanding before moving on. Use simple language and real-world examples. Never skip steps. Celebrate every win.',
      temperature:      0.3,
      voice_style:      'warm',
      greeting_message: '📐 Hi! I\'m your Math Tutor. No question is too small — let\'s solve it step by step together!',
      response_prefix:  '📐 Tutor',
    },
  },
  {
    id: 'moderator', icon: '🛡️', name: 'Moderator', tagline: 'Firm but fair', color: '#ed4245',
    cfg: {
      system_prompt:    'You are a server Moderator assistant — firm but fair. Enforce community guidelines clearly and consistently. Explain rule violations calmly, issue appropriate consequences, and help resolve conflicts constructively. Be direct without being harsh, and always give users a clear path forward.',
      temperature:      0.4,
      voice_style:      'professional',
      greeting_message: '🛡️ Server Mod Bot online. Community guidelines apply to everyone — let\'s keep this a great place.',
      response_prefix:  '🛡️ MOD',
    },
  },
  {
    id: 'therapist', icon: '💙', name: 'Therapist', tagline: 'Empathetic listener', color: '#5865f2',
    cfg: {
      system_prompt:    'You are an empathetic, supportive listener. Validate feelings without judgment, ask open-ended questions, and offer gentle, evidence-based coping strategies. Never diagnose. Remind users you are an AI and encourage professional help for serious concerns. Create a safe, non-judgmental space.',
      temperature:      0.7,
      voice_style:      'calm',
      greeting_message: '💙 I\'m here for you. This is a safe space. How are you feeling today?',
      response_prefix:  '',
    },
  },
  {
    id: 'trivia', icon: '🎯', name: 'Trivia Host', tagline: 'Energetic quiz master', color: '#00d4aa',
    cfg: {
      system_prompt:    'You are an energetic Trivia Host! Ask engaging questions across all categories — history, science, pop culture, sports, geography, and more. Vary the difficulty, track scores, celebrate correct answers with enthusiasm, and share fun facts after each reveal. Keep the energy HIGH!',
      temperature:      1.0,
      voice_style:      'energetic',
      greeting_message: '🎉 TRIVIA TIME! Welcome, contestants! Are you ready to test your knowledge?! Let\'s PLAY! 🎊',
      response_prefix:  '🎯 TRIVIA',
    },
  },
  {
    id: 'butler', icon: '🎩', name: 'Butler', tagline: 'Formal & impeccable', color: '#b8860b',
    cfg: {
      system_prompt:    'You are a distinguished digital Butler — impeccably formal, courteous, and thoroughly helpful. Address users with appropriate honorifics, anticipate their needs, handle requests with quiet efficiency, and maintain the highest standard of service etiquette. Never use slang. Always offer additional assistance.',
      temperature:      0.5,
      voice_style:      'professional',
      greeting_message: 'Good day. I am at your service. How may I be of assistance to you today?',
      response_prefix:  '🎩 Butler',
    },
  },
];

function makeDefaultCfg(bot: BotInfo): BotConfig {
  return {
    display_name:       bot?.display_name || bot?.username || 'Bot',
    persona:            'general',
    system_prompt:      '',
    description:        '',
    voice_style:        'default',
    temperature:        0.7,
    max_tokens:         1000,
    response_mode:      'auto',
    dm_auto_respond:    true,
    greeting_message:   '',
    blocked_topics:     '',
    response_prefix:    '',
    rate_limit_per_min: 20,
    persistent:         true,
    enabled:            true,
    typing_delay:       800,
    context_memory:     true,
    context_window:     20,
    auto_thread:        false,
    dm_greeting:        'Hey! I\'m here to help. Ask me anything.',
    emoji_reactions:    true,
    language:           'auto',
    knowledge_base:     '',
    show_bot_tag:       true,
  };
}

// ─── Helpers ──────────────────────────────────────────────

function fmtUptime(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function fmtTs(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 90, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || '#00d4aa', fontFamily: 'monospace' }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#9da3b4', marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: '#5c6370', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─── Toggle helper ────────────────────────────────────────

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <div onClick={onChange} style={{ width: 36, height: 20, borderRadius: 10, background: on ? T.ac : '#555', cursor: 'pointer', position: 'relative', flexShrink: 0 }}>
      <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', position: 'absolute', top: 2, left: on ? 18 : 2, transition: 'left .2s' }} />
    </div>
  );
}

// ─── Component ────────────────────────────────────────────

export function BotConfigModal({ bot, serverId, channelId, onClose, onSave, showConfirm }: BotConfigModalProps) {
  const [tab, setTab] = useState('general');
  const [activePreset, setActivePreset] = useState<string | null>(null);
  // Seed cfg from the prop (minimal member-list data) as a starting point.
  // The mount effect below will overwrite every field with the actual saved
  // values fetched from the server.
  const [cfg, setCfg] = useState<BotConfig>({
    display_name:       bot?.display_name || bot?.username || 'Bot',
    persona:            bot?.persona || 'general',
    system_prompt:      bot?.system_prompt || '',
    description:        bot?.description || '',
    voice_style:        bot?.voice_style || 'default',
    temperature:        bot?.temperature ?? 0.7,
    max_tokens:         bot?.max_tokens ?? 1000,
    response_mode:      bot?.response_mode || 'auto',
    dm_auto_respond:    bot?.dm_auto_respond !== false,
    greeting_message:   bot?.greeting_message || '',
    blocked_topics:     bot?.blocked_topics || '',
    response_prefix:    bot?.response_prefix || '',
    rate_limit_per_min: bot?.rate_limit_per_min ?? 20,
    persistent:         bot?.persistent !== false,
    enabled:            bot?.enabled !== false,
    typing_delay:       bot?.typing_delay ?? 800,
    context_memory:     bot?.context_memory !== false,
    context_window:     bot?.context_window ?? 20,
    auto_thread:        bot?.auto_thread ?? false,
    dm_greeting:        bot?.dm_greeting || 'Hey! I\'m here to help. Ask me anything.',
    emoji_reactions:    bot?.emoji_reactions !== false,
    language:           bot?.language || 'auto',
    knowledge_base:     bot?.knowledge_base || '',
    show_bot_tag:       localStorage.getItem('d_bot_tag_' + bot?.bot_user_id) !== 'false',
  });
  // True while the initial server fetch is in-flight.
  const [loading, setLoading] = useState(!!serverId);

  // On mount: fetch the actual saved config from the server and overwrite defaults.
  useEffect(() => {
    if (!serverId || !bot?.bot_user_id) { setLoading(false); return; }
    api.listBots(serverId)
      .then((bots: BotInfo[]) => {
        const b = bots.find((x: BotInfo) => x.bot_user_id === bot.bot_user_id);
        if (b) {
          setCfg(prev => ({
            display_name:       b.display_name       ?? prev.display_name,
            persona:            b.persona            ?? prev.persona,
            system_prompt:      b.system_prompt      ?? prev.system_prompt,
            description:        b.description        ?? prev.description,
            voice_style:        b.voice_style        ?? prev.voice_style,
            temperature:        b.temperature        ?? prev.temperature,
            max_tokens:         b.max_tokens         ?? prev.max_tokens,
            response_mode:      b.response_mode      ?? prev.response_mode,
            dm_auto_respond:    b.dm_auto_respond    ?? prev.dm_auto_respond,
            greeting_message:   b.greeting_message   ?? prev.greeting_message,
            blocked_topics:     b.blocked_topics     ?? prev.blocked_topics,
            response_prefix:    b.response_prefix    ?? prev.response_prefix,
            rate_limit_per_min: b.rate_limit_per_min ?? prev.rate_limit_per_min,
            persistent:         b.persistent         ?? prev.persistent,
            enabled:            b.enabled            ?? prev.enabled,
            typing_delay:       b.typing_delay       ?? prev.typing_delay,
            context_memory:     b.context_memory     ?? prev.context_memory,
            context_window:     b.context_window     ?? prev.context_window,
            auto_thread:        b.auto_thread        ?? prev.auto_thread,
            dm_greeting:        b.dm_greeting        ?? prev.dm_greeting,
            emoji_reactions:    b.emoji_reactions    ?? prev.emoji_reactions,
            language:           b.language           ?? prev.language,
            knowledge_base:     b.knowledge_base     ?? prev.knowledge_base,
            show_bot_tag:       prev.show_bot_tag, // local preference — not stored on server
          }));
        }
      })
      .catch(() => { /* network error — fall back to prop defaults already in state */ })
      .finally(() => setLoading(false));
  }, []);

  const set = <K extends keyof BotConfig>(k: K, v: BotConfig[K]) => setCfg(p => ({ ...p, [k]: v }));

  const applyPreset = (p: Preset) => {
    setCfg(prev => ({ ...prev, ...p.cfg }));
    setActivePreset(p.id);
  };

  const resetToDefault = () => {
    setCfg(makeDefaultCfg(bot));
    setActivePreset(null);
  };

  const save = async () => {
    if (serverId && bot?.bot_user_id) {
      await api.updateBotConfig(serverId, bot.bot_user_id, cfg);
    }
    // show_bot_tag is a client-side preference — persist to localStorage
    if (bot?.bot_user_id) {
      localStorage.setItem('d_bot_tag_' + bot.bot_user_id, String(cfg.show_bot_tag));
    }
    onSave?.(cfg);
    onClose();
  };

  // ── Dashboard / Logs state ──────────────────────────────
  const logsKey  = `d_bot_logs_${bot?.bot_user_id  || 'unknown'}`;
  const startKey = `d_bot_start_${bot?.bot_user_id || 'unknown'}`;
  const [logs,         setLogs]         = useState<BotLog[]>([]);
  const [botStartTime, setBotStartTime] = useState<number>(Date.now());
  const [now,          setNow]          = useState<number>(Date.now());
  const [testPrompt,   setTestPrompt]   = useState('');
  const [testResponse, setTestResponse] = useState('');
  const [testLoading,  setTestLoading]  = useState(false);
  const tabBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved: BotLog[] = JSON.parse(localStorage.getItem(logsKey) || '[]');
    setLogs(saved);
    if (!localStorage.getItem(startKey)) localStorage.setItem(startKey, String(Date.now()));
    setBotStartTime(parseInt(localStorage.getItem(startKey) || String(Date.now())));
    const ticker = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(ticker);
  }, []);

  const persistLogs = (updated: BotLog[]) => {
    const trimmed = updated.slice(0, 100);
    setLogs(trimmed);
    localStorage.setItem(logsKey, JSON.stringify(trimmed));
  };

  const runTest = async () => {
    if (!testPrompt.trim() || !serverId || !bot?.bot_user_id) return;
    setTestLoading(true);
    setTestResponse('');
    const t0 = Date.now();
    try {
      const res = await api.promptBot(serverId, bot.bot_user_id, testPrompt, undefined);
      const responseTime = Date.now() - t0;
      const text: string = res?.response ?? res?.content ?? res?.message ?? JSON.stringify(res);
      setTestResponse(text);
      persistLogs([{ ts: Date.now(), user: api.username || 'You', msg: testPrompt, response: text, channel: 'test', responseTime }, ...logs]);
    } catch (e: any) {
      setTestResponse(`Error: ${e?.message || String(e)}`);
    }
    setTestLoading(false);
  };

  // ── LLM Engine ──────────────────────────────────────────
  // All LLM calls happen client-side — preserving E2EE (server never sees
  // plaintext). API keys live in localStorage only, never sent to our server.

  type LlmProvider = 'none' | 'openai' | 'anthropic' | 'ollama' | 'custom';

  const PROVIDER_DEFAULTS: Record<LlmProvider, { endpoint: string; model: string; label: string }> = {
    none:      { endpoint: '',                            model: '',                            label: 'None (placeholder responses)' },
    openai:    { endpoint: 'https://api.openai.com/v1',   model: 'gpt-4o',                      label: 'OpenAI' },
    anthropic: { endpoint: 'https://api.anthropic.com',   model: 'claude-sonnet-4-6',           label: 'Anthropic' },
    ollama:    { endpoint: 'http://localhost:11434',       model: 'llama3',                      label: 'Ollama (local)' },
    custom:    { endpoint: '',                            model: '',                            label: 'Custom (OpenAI-compatible)' },
  };

  // Cost per message estimate (approx 1500 input + max_tokens output)
  function estimateCost(model: string, provider: LlmProvider): string {
    if (provider === 'none')   return 'Free (no API calls)';
    if (provider === 'ollama') return 'Free (runs locally)';
    const m = model.toLowerCase();
    if (m.includes('gpt-4o-mini'))          return '~$0.0002 / msg';
    if (m.includes('gpt-4o'))               return '~$0.003 / msg';
    if (m.includes('gpt-4-turbo') || m.includes('gpt-4-0'))
                                            return '~$0.016 / msg';
    if (m.includes('gpt-3.5'))              return '~$0.0005 / msg';
    if (m.includes('o1-mini'))              return '~$0.004 / msg';
    if (m.includes('o1'))                   return '~$0.024 / msg';
    if (m.includes('claude-opus'))          return '~$0.017 / msg';
    if (m.includes('claude-sonnet'))        return '~$0.003 / msg';
    if (m.includes('claude-haiku'))         return '~$0.0003 / msg';
    if (m.includes('gemini-1.5-pro'))       return '~$0.003 / msg';
    if (m.includes('gemini-1.5-flash'))     return '~$0.0002 / msg';
    if (provider === 'custom')              return 'Cost depends on provider';
    return '~$0.003 / msg (est.)';
  }

  const [llmProvider, setLlmProvider] = useState<LlmProvider>('none');
  const [llmEndpoint, setLlmEndpoint] = useState('');
  const [llmApiKey,   setLlmApiKey]   = useState('');
  const [llmModel,    setLlmModel]    = useState('');
  const [llmTestPrompt,   setLlmTestPrompt]   = useState('Hello! Can you confirm you are connected and working?');
  const [llmTestResponse, setLlmTestResponse] = useState('');
  const [llmTestLoading,  setLlmTestLoading]  = useState(false);
  const [llmTestError,    setLlmTestError]    = useState('');
  const [llmKeyVisible,   setLlmKeyVisible]   = useState(false);
  const [llmHasApiKey,      setLlmHasApiKey]      = useState(false);
  const [llmHasEnvKey,      setLlmHasEnvKey]      = useState(false);
  const [llmSaveLoading,    setLlmSaveLoading]    = useState(false);
  const [llmSaveSuccess,    setLlmSaveSuccess]    = useState(false);
  const [llmFactCount,      setLlmFactCount]      = useState<number | null>(null);
  const [llmClearingMemory, setLlmClearingMemory] = useState(false);

  // Load LLM settings from server on mount
  useEffect(() => {
    if (!serverId || !bot?.bot_user_id) return;
    api.getAgentConfig(serverId, bot.bot_user_id).then((data: any) => {
      if (!data) return;
      const p = (data.provider_type || 'none') as LlmProvider;
      setLlmProvider(p);
      setLlmEndpoint(data.endpoint_url || PROVIDER_DEFAULTS[p]?.endpoint || '');
      setLlmModel(data.model_id || PROVIDER_DEFAULTS[p]?.model || '');
      setLlmHasApiKey(!!data.has_api_key);
      setLlmHasEnvKey(!!data.has_env_key);
      setLlmFactCount(data.fact_count ?? 0);
    });
  }, [serverId, bot?.bot_user_id]);

  const selectProvider = (p: LlmProvider) => {
    const defaults = PROVIDER_DEFAULTS[p];
    const ep = defaults.endpoint;
    const m  = defaults.model;
    setLlmProvider(p);
    setLlmEndpoint(ep);
    setLlmModel(m);
  };

  const runLlmTest = async () => {
    if (!llmTestPrompt.trim() || !serverId || !bot?.bot_user_id) return;
    setLlmTestLoading(true);
    setLlmTestResponse('');
    setLlmTestError('');
    try {
      const result = await api.promptBot(
        serverId,
        bot.bot_user_id,
        llmTestPrompt,
        channelId || undefined,
      );
      if (!result) throw new Error('No response from server');
      setLlmTestResponse(result.content ?? JSON.stringify(result));
    } catch (e: any) {
      setLlmTestError(e?.message || String(e));
    } finally {
      setLlmTestLoading(false);
    }
  };

  // ── Dashboard stats ─────────────────────────────────────
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const msgsToday  = logs.filter(l => l.ts >= todayStart.getTime()).length;
  const rtLogs     = logs.filter(l => l.responseTime != null);
  const avgRT      = rtLogs.length > 0 ? Math.round(rtLogs.reduce((s, l) => s + l.responseTime!, 0) / rtLogs.length) : 0;
  const weekAgo    = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const activeChannels = [...new Set(logs.filter(l => l.ts > weekAgo && l.channel && l.channel !== 'test').map(l => l.channel!))] as string[];
  const recentLogs = logs.slice(0, 5);
  const uptime     = now - botStartTime;

  const tabs = ['dashboard', 'logs', 'general', 'ai-engine', 'behavior', 'personality', 'limits', 'advanced'];

  const lbl = { display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 4, textTransform: 'uppercase' as const };
  const sel = { width: '100%', padding: '8px 12px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 13, marginBottom: 12 };
  const row = (label: string, desc: string, on: boolean, key: keyof BotConfig) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
      <div><div style={{ fontSize: 12, fontWeight: 600 }}>{label}</div><div style={{ fontSize: 10, color: T.mt }}>{desc}</div></div>
      <Toggle on={on} onChange={() => set(key, !on as any)} />
    </div>
  );

  return (
    <Modal title={`🤖 Configure: ${cfg.display_name}`} onClose={onClose} extraWide>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div
        ref={tabBarRef}
        style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: `1px solid ${T.bd}`, paddingBottom: 8, overflowX: 'auto', scrollbarWidth: 'none', flexShrink: 0 }}
      >
        {tabs.map(t => {
          const labels: Record<string, string> = { dashboard: '📊 Dashboard', logs: '📋 Logs', general: 'General', 'ai-engine': '🧠 AI Engine', behavior: 'Behavior', personality: 'Personality', limits: 'Limits', advanced: 'Advanced' };
          return (
            <div key={t} onClick={() => setTab(t)} style={{ padding: '6px 13px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: tab === t ? 700 : 400, color: tab === t ? T.ac : T.mt, background: tab === t ? `${T.ac}11` : 'transparent', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {labels[t] ?? t}
            </div>
          );
        })}
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', gap: 12 }}>
          <div style={{ width: 32, height: 32, border: `3px solid ${T.bd}`, borderTopColor: T.ac, borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          <div style={{ fontSize: 12, color: T.mt }}>Loading bot configuration…</div>
        </div>
      ) : (<>

      {/* ══ Dashboard tab ═══════════════════════════════════ */}
      {tab === 'dashboard' && (<>
        {/* Status row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '10px 14px', background: cfg.enabled ? 'rgba(59,165,93,0.08)' : 'rgba(237,66,69,0.08)', borderRadius: 10, border: `1px solid ${cfg.enabled ? 'rgba(59,165,93,0.25)' : 'rgba(237,66,69,0.25)'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: cfg.enabled ? '#3ba55d' : '#ed4245', boxShadow: cfg.enabled ? '0 0 6px #3ba55d' : 'none' }} />
            <span style={{ fontWeight: 700, fontSize: 14, color: cfg.enabled ? '#3ba55d' : '#ed4245' }}>{cfg.enabled ? 'Online' : 'Offline'}</span>
            <span style={{ fontSize: 11, color: T.mt }}>· {cfg.display_name}</span>
          </div>
          <div style={{ fontSize: 11, color: T.mt }}>Uptime: <span style={{ color: T.tx, fontWeight: 600, fontFamily: 'monospace' }}>{fmtUptime(uptime)}</span></div>
        </div>

        {/* Stat cards */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <StatCard label="Msgs Today"    value={msgsToday}                    color="#00d4aa" />
          <StatCard label="Avg Response"  value={avgRT > 0 ? `${avgRT}ms` : '—'} color="#faa61a" sub="last 100" />
          <StatCard label="Active Chans"  value={activeChannels.length || '—'} color="#5865f2" sub="past 7d" />
          <StatCard label="Total Logs"    value={logs.length}                  color="#9da3b4" sub="stored" />
        </div>

        {/* Active channels */}
        {activeChannels.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Active Channels (7d)</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {activeChannels.map(ch => (
                <span key={ch} style={{ fontSize: 11, padding: '2px 8px', background: `${T.ac}15`, color: T.ac, borderRadius: 5, fontFamily: 'monospace' }}>#{ch}</span>
              ))}
            </div>
          </div>
        )}

        {/* Recent interactions */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Last 5 Interactions</div>
          {recentLogs.length === 0 ? (
            <div style={{ fontSize: 12, color: T.mt, fontStyle: 'italic', padding: '12px 0' }}>No interactions yet. Use the Test section below or wait for users to interact with the bot.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {recentLogs.map((l, i) => (
                <div key={i} style={{ background: T.bg, borderRadius: 8, border: `1px solid ${T.bd}`, padding: '8px 12px', fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, color: T.ac }}>{l.user}</span>
                    <span style={{ fontSize: 10, color: T.mt }}>{fmtTs(l.ts)}{l.responseTime ? ` · ${l.responseTime}ms` : ''}</span>
                  </div>
                  <div style={{ color: T.tx, marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>→ {l.msg}</div>
                  <div style={{ color: T.mt, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>← {l.response}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Test section ────────────────────────────────── */}
        <div style={{ borderTop: `1px solid ${T.bd}`, paddingTop: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Test Bot</div>
          <textarea
            value={testPrompt}
            onChange={e => setTestPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runTest(); }}
            placeholder={`Send a test message to ${cfg.display_name}… (Ctrl+Enter to send)`}
            rows={3}
            style={{ width: '100%', padding: '10px 12px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 13, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box', marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 8, marginBottom: testResponse ? 12 : 0 }}>
            <button
              onClick={runTest}
              disabled={testLoading || !testPrompt.trim()}
              style={{ padding: '8px 18px', background: testLoading ? T.sf2 : T.ac, color: testLoading ? T.mt : '#000', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: testLoading || !testPrompt.trim() ? 'default' : 'pointer' }}
            >
              {testLoading ? '⟳ Thinking…' : '▶ Send Test'}
            </button>
            {testResponse && <button onClick={() => { setTestPrompt(''); setTestResponse(''); }} style={{ padding: '8px 12px', background: 'transparent', border: `1px solid ${T.bd}`, borderRadius: 8, color: T.mt, fontSize: 12, cursor: 'pointer' }}>Clear</button>}
          </div>
          {testLoading && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', color: T.mt, fontSize: 12, padding: '8px 0' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: T.ac, animation: 'pulse 1s infinite' }} />
              {cfg.display_name} is typing…
            </div>
          )}
          {testResponse && !testLoading && (
            <div style={{ background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.ac, marginBottom: 6 }}>{cfg.display_name}</div>
              <div style={{ fontSize: 13, color: T.tx, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{testResponse}</div>
            </div>
          )}
        </div>
      </>)}

      {/* ══ Logs tab ════════════════════════════════════════ */}
      {tab === 'logs' && (<>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Interaction Logs</div>
            <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>Showing last {Math.min(logs.length, 20)} of {logs.length} stored</div>
          </div>
          {logs.length > 0 && (
            <button
              onClick={async () => {
                if (await showConfirm('Clear Logs', `Delete all ${logs.length} interaction logs for ${cfg.display_name}?`, true)) {
                  persistLogs([]);
                }
              }}
              style={{ padding: '5px 12px', background: 'rgba(237,66,69,0.1)', border: '1px solid rgba(237,66,69,0.3)', borderRadius: 6, color: '#ed4245', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
            >
              Clear All
            </button>
          )}
        </div>

        {logs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: T.mt }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>No logs yet</div>
            <div style={{ fontSize: 12 }}>Interactions will appear here after the bot receives its first message.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {logs.slice(0, 20).map((l, i) => (
              <div key={i} style={{ background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 10, overflow: 'hidden' }}>
                {/* Log header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: T.sf2, borderBottom: `1px solid ${T.bd}` }}>
                  <span style={{ fontSize: 10, fontFamily: 'monospace', color: T.mt }}>{fmtTs(l.ts)}</span>
                  {l.channel && <span style={{ fontSize: 10, color: T.ac, background: `${T.ac}15`, padding: '1px 6px', borderRadius: 4 }}>#{l.channel}</span>}
                  {l.responseTime != null && <span style={{ fontSize: 10, color: '#faa61a', marginLeft: 'auto' }}>{l.responseTime}ms</span>}
                </div>
                {/* User message */}
                <div style={{ padding: '8px 12px', borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: T.ac }}>{l.user}</span>
                  <div style={{ fontSize: 13, color: T.tx, marginTop: 3, lineHeight: 1.4 }}>{l.msg}</div>
                </div>
                {/* Bot response */}
                <div style={{ padding: '8px 12px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#9b59b6' }}>{cfg.display_name}</span>
                  <div style={{ fontSize: 12, color: T.mt, marginTop: 3, lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{l.response}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </>)}

      {tab === 'general' && (<>
        {/* ── Presets ── */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Persona Presets
            </div>
            {activePreset && (
              <button
                onClick={resetToDefault}
                style={{ background: 'none', border: `1px solid ${T.bd}`, borderRadius: 5, color: T.mt, cursor: 'pointer', fontSize: 10, fontWeight: 600, padding: '2px 8px' }}
              >
                Reset to Default
              </button>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {PRESETS.map(p => {
              const isActive = activePreset === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p)}
                  title={p.tagline}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    padding: '10px 6px', borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: isActive ? `${p.color}22` : T.sf2,
                    outline: isActive ? `2px solid ${p.color}` : `1px solid ${isActive ? p.color : T.bd}`,
                    transition: 'background .15s, outline .15s',
                  }}
                  onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = `${p.color}11`; }}
                  onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = T.sf2; }}
                >
                  <span style={{ fontSize: 20, lineHeight: 1 }}>{p.icon}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: isActive ? p.color : T.tx, textAlign: 'center', lineHeight: 1.2 }}>{p.name}</span>
                  <span style={{ fontSize: 9, color: T.mt, textAlign: 'center', lineHeight: 1.2 }}>{p.tagline}</span>
                  {isActive && (
                    <span style={{ fontSize: 8, fontWeight: 700, color: p.color, background: `${p.color}22`, borderRadius: 3, padding: '1px 4px', marginTop: 1 }}>ACTIVE</span>
                  )}
                </button>
              );
            })}
          </div>
          {activePreset && (
            <div style={{ marginTop: 8, padding: '6px 10px', background: `${PRESETS.find(p => p.id === activePreset)!.color}11`, borderRadius: 6, border: `1px solid ${PRESETS.find(p => p.id === activePreset)!.color}33`, fontSize: 11, color: T.mt }}>
              <span style={{ fontWeight: 700, color: PRESETS.find(p => p.id === activePreset)!.color }}>
                {PRESETS.find(p => p.id === activePreset)!.icon} {PRESETS.find(p => p.id === activePreset)!.name}
              </span>
              {' '}preset applied — system prompt, temperature, voice style, greeting, and prefix have been filled in. Customise below or in other tabs.
            </div>
          )}
          <div style={{ height: 1, background: T.bd, margin: '14px 0 4px' }} />
        </div>

        <label style={lbl}>Display Name</label>
        <input value={cfg.display_name} onChange={e => set('display_name', e.target.value)} style={{ ...getInp(), marginBottom: 12 }} />

        <label style={lbl}>Description</label>
        <input value={cfg.description} onChange={e => set('description', e.target.value)} placeholder="What does this bot do?" style={{ ...getInp(), marginBottom: 12 }} />

        <label style={lbl}>Persona</label>
        <select value={cfg.persona} onChange={e => set('persona', e.target.value)} style={sel}>
          {['general','legal','medical','security','gaming','music','art','research','coding','companion','creative','meme','finance','fitness'].map(p =>
            <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
          )}
        </select>

        {row('Enabled', 'Bot is active and can respond', cfg.enabled, 'enabled')}
        {row('Show BOT tag', 'Hide the BOT badge for immersion. Bot identity is always visible to admins and in profile cards.', cfg.show_bot_tag, 'show_bot_tag')}
      </>)}

      {/* ══ AI Engine tab ═══════════════════════════════════ */}
      {tab === 'ai-engine' && (<>

        {/* Server-side LLM notice */}
        <div style={{ display: 'flex', gap: 10, padding: '10px 14px', background: `${T.ac}0d`, border: `1px solid ${T.ac}30`, borderRadius: 10, marginBottom: 16, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>🔒</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.ac, marginBottom: 2 }}>Server-Side LLM — API Key Encrypted at Rest</div>
            <div style={{ fontSize: 11, color: T.mt, lineHeight: 1.5 }}>
              LLM calls are made by the server on behalf of the bot. Your API key is encrypted with AES-256-GCM before storage — the plaintext key is never stored. Bot responses are E2EE like all other messages.
            </div>
          </div>
        </div>

        {/* Provider selector */}
        <label style={lbl}>LLM Provider</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginBottom: 16 }}>
          {(['none', 'openai', 'anthropic', 'ollama', 'custom'] as LlmProvider[]).map(p => {
            const icons: Record<LlmProvider, string> = { none: '⊘', openai: '⬡', anthropic: '△', ollama: '🦙', custom: '⚙' };
            const colors: Record<LlmProvider, string> = { none: T.mt, openai: '#10a37f', anthropic: '#d97706', ollama: '#8b5cf6', custom: T.ac };
            const active = llmProvider === p;
            return (
              <button
                key={p}
                onClick={() => selectProvider(p)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  padding: '10px 6px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: active ? `${colors[p]}18` : T.sf2,
                  outline: active ? `2px solid ${colors[p]}` : `1px solid ${T.bd}`,
                }}
              >
                <span style={{ fontSize: 20, color: colors[p] }}>{icons[p]}</span>
                <span style={{ fontSize: 10, fontWeight: active ? 700 : 500, color: active ? colors[p] : T.mt, textAlign: 'center', lineHeight: 1.3 }}>
                  {PROVIDER_DEFAULTS[p].label.split('(')[0].trim()}
                </span>
                {active && <span style={{ fontSize: 8, fontWeight: 700, color: colors[p], background: `${colors[p]}20`, borderRadius: 3, padding: '1px 4px' }}>ACTIVE</span>}
              </button>
            );
          })}
        </div>

        {llmProvider !== 'none' && (<>

          {/* API Endpoint */}
          <label style={lbl}>
            API Endpoint
            {llmProvider === 'ollama' && <span style={{ color: T.ac, fontWeight: 400, marginLeft: 6, textTransform: 'none', letterSpacing: 0 }}>— must be running locally</span>}
            {llmProvider === 'custom' && <span style={{ color: T.mt, fontWeight: 400, marginLeft: 6, textTransform: 'none', letterSpacing: 0 }}>— must be OpenAI-compatible</span>}
          </label>
          <input
            value={llmEndpoint}
            onChange={e => setLlmEndpoint(e.target.value)}
            placeholder={PROVIDER_DEFAULTS[llmProvider].endpoint || 'https://your-endpoint.example.com/v1'}
            style={{ ...getInp(), marginBottom: 12, fontFamily: 'monospace', fontSize: 12 }}
          />

          {/* API Key */}
          {llmProvider !== 'ollama' && (
            <>
              <label style={lbl}>
                API Key
                <span style={{ color: T.mt, fontWeight: 400, marginLeft: 6, textTransform: 'none', letterSpacing: 0 }}>— encrypted and stored on server</span>
              </label>
              {llmHasApiKey && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#22c55e', marginBottom: 6 }}>
                  <span>✅</span> API key configured (encrypted)
                </div>
              )}
              {!llmHasApiKey && llmHasEnvKey && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.mt, marginBottom: 6 }}>
                  <span>🔑</span> Using server API key
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input
                  type={llmKeyVisible ? 'text' : 'password'}
                  value={llmApiKey}
                  onChange={e => setLlmApiKey(e.target.value)}
                  placeholder={llmHasApiKey ? '••••••••  (leave blank to keep existing)' : llmProvider === 'openai' ? 'sk-...' : llmProvider === 'anthropic' ? 'sk-ant-...' : 'Your API key'}
                  style={{ ...getInp(), flex: 1, fontFamily: 'monospace', fontSize: 12 }}
                  autoComplete="off"
                />
                <button
                  onClick={() => setLlmKeyVisible(v => !v)}
                  title={llmKeyVisible ? 'Hide key' : 'Show key'}
                  style={{ padding: '0 12px', background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.mt, cursor: 'pointer', fontSize: 14, flexShrink: 0 }}
                >
                  {llmKeyVisible ? '🙈' : '👁'}
                </button>
              </div>
              <div style={{ fontSize: 10, color: T.mt, marginBottom: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
                <span>🔐</span> Encrypted with AES-256-GCM before storage. Leave blank to keep existing key.
              </div>
            </>
          )}

          {/* Model */}
          <label style={lbl}>Model</label>
          {llmProvider === 'openai' ? (
            <select value={llmModel} onChange={e => setLlmModel(e.target.value)} style={{ ...sel, marginBottom: 4 }}>
              <option value="gpt-4o">gpt-4o — flagship, best quality</option>
              <option value="gpt-4o-mini">gpt-4o-mini — fast &amp; cheap</option>
              <option value="gpt-4-turbo">gpt-4-turbo — high quality</option>
              <option value="gpt-3.5-turbo">gpt-3.5-turbo — legacy fast</option>
              <option value="o1">o1 — reasoning model</option>
              <option value="o1-mini">o1-mini — fast reasoning</option>
            </select>
          ) : llmProvider === 'anthropic' ? (
            <select value={llmModel} onChange={e => setLlmModel(e.target.value)} style={{ ...sel, marginBottom: 4 }}>
              <option value="claude-opus-4-6">claude-opus-4-6 — most capable</option>
              <option value="claude-sonnet-4-6">claude-sonnet-4-6 — balanced (recommended)</option>
              <option value="claude-haiku-4-5-20251001">claude-haiku-4-5 — fastest &amp; cheapest</option>
            </select>
          ) : llmProvider === 'ollama' ? (
            <select value={llmModel} onChange={e => setLlmModel(e.target.value)} style={{ ...sel, marginBottom: 4 }}>
              <option value="llama3">llama3 — Meta Llama 3 (8B)</option>
              <option value="llama3:70b">llama3:70b — Meta Llama 3 (70B)</option>
              <option value="mistral">mistral — Mistral 7B</option>
              <option value="mixtral">mixtral — Mixtral 8x7B</option>
              <option value="phi3">phi3 — Microsoft Phi-3</option>
              <option value="gemma2">gemma2 — Google Gemma 2</option>
              <option value="codellama">codellama — Code Llama</option>
              <option value="qwen2">qwen2 — Qwen 2</option>
            </select>
          ) : (
            <input
              value={llmModel}
              onChange={e => setLlmModel(e.target.value)}
              placeholder="e.g. gpt-4o, mistral-7b, your-custom-model"
              style={{ ...getInp(), marginBottom: 4, fontFamily: 'monospace', fontSize: 12 }}
            />
          )}
          {/* Custom model text input for preset providers */}
          {(llmProvider === 'openai' || llmProvider === 'anthropic' || llmProvider === 'ollama') && (
            <div style={{ marginBottom: 4 }}>
              <input
                value={llmModel}
                onChange={e => setLlmModel(e.target.value)}
                placeholder="Or type a model name directly"
                style={{ ...getInp(), fontSize: 12, fontFamily: 'monospace' }}
              />
            </div>
          )}

          {/* Cost estimate */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 16, marginTop: 4 }}>
            <span style={{ fontSize: 14 }}>💰</span>
            <div style={{ fontSize: 11, color: T.mt }}>
              Estimated cost: <span style={{ color: T.ac, fontWeight: 700 }}>{estimateCost(llmModel, llmProvider)}</span>
              <span style={{ marginLeft: 6 }}>· Based on ~1500 input + {cfg.max_tokens} output tokens</span>
            </div>
          </div>

        </>)}

        {/* ── Save LLM Config ────────────────────────────────── */}
        {serverId && bot?.bot_user_id && (
          <div style={{ borderTop: `1px solid ${T.bd}`, paddingTop: 14, marginTop: 4, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={async () => {
                  setLlmSaveLoading(true);
                  setLlmSaveSuccess(false);
                  const body: any = {
                    provider_type: llmProvider,
                    model_id:      llmModel,
                    endpoint_url:  llmEndpoint || null,
                    temperature:   cfg.temperature,
                  };
                  if (llmApiKey.trim()) body.api_key = llmApiKey.trim();
                  const result = await api.putAgentConfig(serverId, bot.bot_user_id!, body);
                  setLlmSaveLoading(false);
                  if (result) {
                    setLlmApiKey('');
                    setLlmHasApiKey(!!result.has_api_key);
                    setLlmHasEnvKey(!!result.has_env_key);
                    setLlmSaveSuccess(true);
                    setTimeout(() => setLlmSaveSuccess(false), 3000);
                  }
                }}
                disabled={llmSaveLoading}
                style={{ padding: '8px 20px', background: llmSaveLoading ? T.sf2 : T.ac, color: llmSaveLoading ? T.mt : '#000', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: llmSaveLoading ? 'default' : 'pointer' }}
              >
                {llmSaveLoading ? '⟳ Saving…' : '💾 Save LLM Config'}
              </button>
              {llmSaveSuccess && (
                <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>✅ Saved successfully</span>
              )}
            </div>
          </div>
        )}

        {/* ── Test Connection ────────────────────────────────── */}
        <div style={{ borderTop: `1px solid ${T.bd}`, paddingTop: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
            Test Connection
          </div>
          <textarea
            value={llmTestPrompt}
            onChange={e => setLlmTestPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runLlmTest(); }}
            rows={2}
            placeholder="Test prompt… (Ctrl+Enter to send)"
            style={{ width: '100%', padding: '10px 12px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 13, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box', marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 8, marginBottom: (llmTestResponse || llmTestError) ? 12 : 0 }}>
            <button
              onClick={runLlmTest}
              disabled={llmTestLoading || !llmTestPrompt.trim()}
              style={{ padding: '8px 18px', background: llmTestLoading ? T.sf2 : T.ac, color: llmTestLoading ? T.mt : '#000', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: llmTestLoading || !llmTestPrompt.trim() ? 'default' : 'pointer' }}
            >
              {llmTestLoading ? '⟳ Sending…' : '▶ Test Connection'}
            </button>
            {(llmTestResponse || llmTestError) && (
              <button onClick={() => { setLlmTestResponse(''); setLlmTestError(''); }} style={{ padding: '8px 12px', background: 'transparent', border: `1px solid ${T.bd}`, borderRadius: 8, color: T.mt, fontSize: 12, cursor: 'pointer' }}>Clear</button>
            )}
          </div>
          {llmTestLoading && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', color: T.mt, fontSize: 12, padding: '8px 0' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: T.ac, animation: 'pulse 1s infinite' }} />
              Waiting for response…
            </div>
          )}
          {llmTestError && !llmTestLoading && (
            <div style={{ background: 'rgba(255,71,87,0.08)', border: '1px solid rgba(255,71,87,0.25)', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.err, marginBottom: 4 }}>Request Failed</div>
              <div style={{ fontSize: 12, color: T.err, lineHeight: 1.5, fontFamily: 'monospace', wordBreak: 'break-word' }}>{llmTestError}</div>
            </div>
          )}
          {llmTestResponse && !llmTestLoading && !llmTestError && (
            <div style={{ background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.ac, marginBottom: 6 }}>{cfg.display_name}</div>
              <div style={{ fontSize: 13, color: T.tx, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{llmTestResponse}</div>
            </div>
          )}
        </div>

        {/* ── Agent Memory ────────────────────────────────────── */}
        {serverId && bot?.bot_user_id && (
          <div style={{ borderTop: `1px solid ${T.bd}`, paddingTop: 14, marginTop: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
              Agent Memory
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 10, marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 18 }}>🧠</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>
                    {llmFactCount === null
                      ? 'Loading…'
                      : llmFactCount === 0
                        ? 'No summarised context stored'
                        : `${llmFactCount} messages tracked in summaries`}
                  </div>
                  <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>
                    Sliding-window memory (live history) is always active and unaffected by clearing.
                  </div>
                </div>
              </div>
              <button
                onClick={async () => {
                  if (llmClearingMemory) return;
                  setLlmClearingMemory(true);
                  await api.deleteAgentMemory(serverId, bot.bot_user_id!);
                  setLlmFactCount(0);
                  setLlmClearingMemory(false);
                }}
                disabled={llmClearingMemory || llmFactCount === 0}
                style={{
                  padding: '6px 14px',
                  background: llmClearingMemory || llmFactCount === 0 ? T.sf2 : 'rgba(255,71,87,0.12)',
                  color: llmClearingMemory || llmFactCount === 0 ? T.mt : '#ff4757',
                  border: `1px solid ${llmClearingMemory || llmFactCount === 0 ? T.bd : 'rgba(255,71,87,0.35)'}`,
                  borderRadius: 8,
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: llmClearingMemory || llmFactCount === 0 ? 'default' : 'pointer',
                  flexShrink: 0,
                }}
              >
                {llmClearingMemory ? '⟳ Clearing…' : '🗑 Clear Memory'}
              </button>
            </div>
          </div>
        )}
      </>)}

      {tab === 'behavior' && (<>
        <label style={lbl}>Response Mode (in channels)</label>
        <select value={cfg.response_mode} onChange={e => set('response_mode', e.target.value)} style={sel}>
          <option value="auto">Auto-respond to all messages in channel</option>
          <option value="mention_only">Respond only when @mentioned</option>
          <option value="off">Silent (no auto-responses, only slash commands)</option>
        </select>

        <div style={{ padding: '8px 12px', background: `${T.ac}11`, borderRadius: 6, marginBottom: 12, fontSize: 11, color: T.ac }}>
          In DMs: bots ALWAYS auto-respond (users are talking directly to the bot)
        </div>

        <label style={lbl}>Greeting Message</label>
        <textarea value={cfg.greeting_message} onChange={e => set('greeting_message', e.target.value)} placeholder="Message sent when bot first joins or user starts a conversation..." rows={2} style={{ width: '100%', padding: '8px 10px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 12, resize: 'vertical', marginBottom: 12, fontFamily: 'inherit', boxSizing: 'border-box' }} />

        <label style={lbl}>Response Prefix</label>
        <input value={cfg.response_prefix} onChange={e => set('response_prefix', e.target.value)} placeholder="e.g. '[Game Master]' or leave empty" style={{ ...getInp(), marginBottom: 12 }} />

        {row('Persistent', 'Bot stays in channel (vs temporary visit)', cfg.persistent, 'persistent')}

        <div style={{ marginTop: 8, borderTop: `1px solid ${T.bd}`, paddingTop: 12 }}>
          <label style={lbl}>Typing Delay ({cfg.typing_delay}ms)</label>
          <div style={{ fontSize: 10, color: T.mt, marginBottom: 4 }}>Simulated typing time before bot responds. Makes it feel more natural.</div>
          <input type="range" min="0" max="3000" step="100" value={cfg.typing_delay} onChange={e => set('typing_delay', parseInt(e.target.value))} style={{ width: '100%', accentColor: T.ac, marginBottom: 4 }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.mt }}><span>Instant</span><span>{cfg.typing_delay}ms</span><span>3s</span></div>
        </div>

        {row('Context Memory', 'Bot remembers previous messages in conversation', cfg.context_memory, 'context_memory')}
        {cfg.context_memory && (
          <div style={{ paddingLeft: 12, marginBottom: 8 }}>
            <label style={{ fontSize: 10, fontWeight: 600, color: T.mt }}>Context Window (messages to remember)</label>
            <select value={cfg.context_window} onChange={e => set('context_window', parseInt(e.target.value))} style={{ width: '100%', padding: '6px 10px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.tx, fontSize: 12, marginTop: 4 }}>
              <option value="5">Short (5 messages)</option>
              <option value="10">Medium (10 messages)</option>
              <option value="20">Standard (20 messages)</option>
              <option value="50">Long (50 messages)</option>
            </select>
          </div>
        )}

        {row('Emoji Reactions', 'Bot reacts to messages with relevant emojis', cfg.emoji_reactions, 'emoji_reactions')}
        {row('Auto-Thread', 'Create threads for long conversations with the bot', cfg.auto_thread, 'auto_thread')}

        <label style={{ ...lbl, marginTop: 8 }}>DM Greeting</label>
        <input value={cfg.dm_greeting} onChange={e => set('dm_greeting', e.target.value)} placeholder="Hey! I'm here to help. Ask me anything." style={{ ...getInp(), marginBottom: 8 }} />

        <label style={lbl}>Language</label>
        <select value={cfg.language} onChange={e => set('language', e.target.value)} style={sel}>
          <option value="auto">Auto-detect</option>
          <option value="en">English</option>
          <option value="es">Español</option>
          <option value="fr">Français</option>
          <option value="de">Deutsch</option>
          <option value="pt">Português</option>
          <option value="ja">日本語</option>
          <option value="ko">한국어</option>
          <option value="zh">中文</option>
          <option value="ar">العربية</option>
          <option value="ru">Русский</option>
        </select>
      </>)}

      {tab === 'personality' && (<>
        <label style={lbl}>System Prompt (Instructions)</label>
        <div style={{ fontSize: 10, color: T.mt, marginBottom: 6 }}>Define the bot's personality, knowledge, and behavior.</div>
        <textarea value={cfg.system_prompt} onChange={e => set('system_prompt', e.target.value)} rows={6} placeholder="You are a helpful gaming expert who knows all about strategies, meta, patch notes..." style={{ width: '100%', padding: '10px 12px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 12, resize: 'vertical', marginBottom: 12, fontFamily: 'monospace', lineHeight: 1.5, boxSizing: 'border-box' }} />

        <label style={lbl}>Voice Style</label>
        <select value={cfg.voice_style} onChange={e => set('voice_style', e.target.value)} style={sel}>
          {['default','professional','calm','technical','energetic','expressive','thoughtful','scholarly','warm','dramatic','playful','motivating'].map(v =>
            <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>
          )}
        </select>

        <label style={lbl}>Temperature</label>
        <div style={{ fontSize: 10, color: T.mt, marginBottom: 8 }}>Controls randomness. Lower = focused and predictable. Higher = creative and surprising.</div>
        {/* Temperature visual slider — 0.0 to 2.0 */}
        <div style={{ padding: '12px 14px', background: T.sf2, borderRadius: 10, border: `1px solid ${T.bd}`, marginBottom: 12 }}>
          {/* Value badge */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{
              fontSize: 22, fontWeight: 800, fontFamily: 'monospace',
              color: cfg.temperature < 0.5 ? '#5865f2'
                   : cfg.temperature < 1.0 ? T.ac
                   : cfg.temperature < 1.5 ? '#faa61a'
                   : '#ed4245',
            }}>
              {cfg.temperature.toFixed(2)}
            </span>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 6,
              background: cfg.temperature < 0.5 ? '#5865f222'
                        : cfg.temperature < 1.0 ? `${T.ac}22`
                        : cfg.temperature < 1.5 ? '#faa61a22'
                        : '#ed424522',
              color: cfg.temperature < 0.5 ? '#5865f2'
                   : cfg.temperature < 1.0 ? T.ac
                   : cfg.temperature < 1.5 ? '#faa61a'
                   : '#ed4245',
            }}>
              {cfg.temperature < 0.4 ? 'Focused'
               : cfg.temperature < 0.8 ? 'Balanced'
               : cfg.temperature < 1.2 ? 'Creative'
               : cfg.temperature < 1.7 ? 'Expressive'
               : 'Wild'}
            </span>
          </div>
          {/* Gradient track */}
          <div style={{ position: 'relative', marginBottom: 6 }}>
            <div style={{
              position: 'absolute', top: '50%', left: 0, right: 0, height: 6,
              transform: 'translateY(-50%)', borderRadius: 3, pointerEvents: 'none',
              background: 'linear-gradient(to right, #5865f2, #00d4aa, #faa61a, #ed4245)',
            }} />
            <input
              type="range" min="0" max="200" step="5"
              value={Math.round(cfg.temperature * 100)}
              onChange={e => set('temperature', parseInt(e.target.value) / 100)}
              style={{ width: '100%', accentColor: T.ac, position: 'relative', zIndex: 1, background: 'transparent' }}
            />
          </div>
          {/* Tick labels */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: T.mt, fontWeight: 600 }}>
            <span style={{ color: '#5865f2' }}>0.0<br/>Focused</span>
            <span style={{ color: T.ac, textAlign: 'center' }}>0.7<br/>Balanced</span>
            <span style={{ color: '#faa61a', textAlign: 'center' }}>1.2<br/>Creative</span>
            <span style={{ color: '#ed4245', textAlign: 'right' }}>2.0<br/>Wild</span>
          </div>
        </div>

        <div style={{ marginTop: 12, borderTop: `1px solid ${T.bd}`, paddingTop: 12 }}>
          <label style={lbl}>Custom Knowledge Base</label>
          <div style={{ fontSize: 10, color: T.mt, marginBottom: 6 }}>Add FAQ, rules, or domain knowledge the bot should reference. One fact per line.</div>
          <textarea value={cfg.knowledge_base} onChange={e => set('knowledge_base', e.target.value)} rows={4} placeholder={'Server rules: Be respectful, no spam\nFAQ: Our hours are 9-5 EST\nThe admin is @john\nWe use React + Rust'} style={{ width: '100%', padding: '10px 12px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 12, resize: 'vertical', fontFamily: 'monospace', lineHeight: 1.5, boxSizing: 'border-box' }} />
        </div>
      </>)}

      {tab === 'limits' && (<>
        <label style={lbl}>Max Response Length (tokens)</label>
        <select value={cfg.max_tokens} onChange={e => set('max_tokens', parseInt(e.target.value))} style={sel}>
          <option value="256">Short (256 tokens)</option>
          <option value="500">Medium (500 tokens)</option>
          <option value="1000">Standard (1000 tokens)</option>
          <option value="2000">Long (2000 tokens)</option>
          <option value="4000">Very Long (4000 tokens)</option>
        </select>

        <label style={lbl}>Rate Limit (responses per minute)</label>
        <select value={cfg.rate_limit_per_min} onChange={e => set('rate_limit_per_min', parseInt(e.target.value))} style={sel}>
          <option value="5">Conservative (5/min)</option>
          <option value="10">Moderate (10/min)</option>
          <option value="20">Standard (20/min)</option>
          <option value="60">High (60/min)</option>
          <option value="0">Unlimited</option>
        </select>

        <label style={lbl}>Blocked Topics</label>
        <div style={{ fontSize: 10, color: T.mt, marginBottom: 6 }}>Comma-separated list of topics the bot should refuse to discuss.</div>
        <input value={cfg.blocked_topics} onChange={e => set('blocked_topics', e.target.value)} placeholder="e.g. politics, religion, illegal activities" style={{ ...getInp(), marginBottom: 12 }} />
      </>)}

      {tab === 'advanced' && (<>
        <div style={{ padding: 12, background: T.bg, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, marginBottom: 8, textTransform: 'uppercase' }}>Bot Identity</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11, color: T.mt }}>
            <div>Bot User ID: <span style={{ color: T.ac, fontFamily: 'monospace' }}>{bot?.bot_user_id?.slice(0, 8) || '—'}</span></div>
            <div>Persona: <span style={{ color: T.ac }}>{cfg.persona}</span></div>
            <div>Server ID: <span style={{ color: T.ac, fontFamily: 'monospace' }}>{serverId?.slice(0, 8) || '—'}</span></div>
            <div>Status: <span style={{ color: cfg.enabled ? T.ac : T.err }}>{cfg.enabled ? 'Active' : 'Disabled'}</span></div>
          </div>
        </div>
        <div style={{ padding: 12, background: 'rgba(255,71,87,0.05)', borderRadius: 8, border: '1px solid rgba(255,71,87,0.15)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.err, marginBottom: 8, textTransform: 'uppercase' }}>Danger Zone</div>
          <button onClick={async () => {
            if (await showConfirm('Remove Bot', 'Remove this bot from the server? This cannot be undone.', true)) {
              await api.removeBotFromServer(serverId!, bot?.bot_user_id!);
              onClose();
            }
          }} className="pill-btn" style={{ background: 'rgba(255,71,87,0.15)', color: T.err, border: '1px solid rgba(255,71,87,0.3)', padding: '6px 14px', fontSize: 11 }}>Remove Bot from Server</button>
        </div>
      </>)}

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button
          onClick={resetToDefault}
          title="Clear all fields back to factory defaults"
          style={{ padding: '10px 16px', background: 'none', color: T.mt, border: `1px solid ${T.bd}`, borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          Reset to Default
        </button>
        <button onClick={save} style={{ flex: 1, padding: '10px 0', background: T.ac, color: '#000', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Save Configuration</button>
      </div>
      </>)}
    </Modal>
  );
}
