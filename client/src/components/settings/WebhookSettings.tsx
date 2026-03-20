import React, { useState, useEffect, useCallback } from 'react';
import { T, ta } from '../../theme';
import { api } from '../../api/CitadelAPI';

interface Channel {
  id: string;
  name: string;
  channel_type?: string;
}

interface Webhook {
  id: string;
  server_id: string;
  channel_id: string | null;
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
  failure_count: number;
  created_at: string;
}

const ALL_EVENTS = [
  { id: 'message_create', label: 'Message Create' },
  { id: 'member_join',    label: 'Member Join' },
  { id: 'member_leave',   label: 'Member Leave' },
  { id: 'message_delete', label: 'Message Delete' },
] as const;

interface Props {
  serverId: string;
  channels: Channel[];
}

export default function WebhookSettings({ serverId, channels }: Props) {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.listWebhooks(serverId);
      setWebhooks(Array.isArray(data) ? data : []);
    } catch { /* empty list on error */ }
    setLoading(false);
  }, [serverId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ color: T.mt, fontSize: 12, padding: 12 }}>Loading webhooks...</div>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.tx }}>Webhooks</div>
          <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>Send event notifications to external services</div>
        </div>
        <button
          onClick={() => { setShowCreate(true); setError(''); }}
          style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: T.ac, color: '#000', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
        >
          Create Webhook
        </button>
      </div>

      {error && (
        <div style={{ fontSize: 11, color: T.err, padding: '6px 10px', background: 'rgba(255,71,87,0.06)', borderRadius: 4, marginBottom: 8 }}>
          {error}
          <span onClick={() => setError('')} style={{ marginLeft: 8, cursor: 'pointer', textDecoration: 'underline', fontSize: 10 }}>Dismiss</span>
        </div>
      )}

      {/* Secret reveal modal */}
      {secret && (
        <SecretModal name={secret.name} secret={secret.value} onClose={() => setSecret(null)} />
      )}

      {/* Create form */}
      {showCreate && (
        <CreateWebhookForm
          serverId={serverId}
          channels={channels}
          onCreated={(wh, sec) => {
            setWebhooks(prev => [...prev, wh]);
            setShowCreate(false);
            setSecret({ name: wh.name, value: sec });
          }}
          onCancel={() => setShowCreate(false)}
          onError={setError}
        />
      )}

      {/* Webhook list */}
      {webhooks.length === 0 && !showCreate && (
        <div style={{ color: T.mt, fontSize: 12, textAlign: 'center', padding: '20px 0' }}>
          No webhooks configured
        </div>
      )}

      {webhooks.map(wh => (
        <WebhookRow
          key={wh.id}
          webhook={wh}
          serverId={serverId}
          onUpdate={(updated) => setWebhooks(prev => prev.map(w => w.id === updated.id ? updated : w))}
          onDelete={(id) => setWebhooks(prev => prev.filter(w => w.id !== id))}
          onError={setError}
        />
      ))}
    </div>
  );
}

// ─── Secret Modal ────────────────────────────────────────────────────────

function SecretModal({ name, secret, onClose }: { name: string; secret: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard?.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 9999,
    }}>
      <div style={{
        background: T.sf, borderRadius: 12, padding: 24, maxWidth: 480, width: '90%',
        border: `1px solid ${T.bd}`, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: T.tx, marginBottom: 12 }}>
          Webhook Secret
        </div>
        <div style={{ fontSize: 12, color: T.mt, lineHeight: 1.6, marginBottom: 12 }}>
          Webhook <strong style={{ color: T.tx }}>{name}</strong> has been created.
          Copy the signing secret below. It is used to verify webhook payloads
          via the <code style={{ fontSize: 11, background: T.bg, padding: '1px 4px', borderRadius: 3 }}>X-Discreet-Signature</code> header.
        </div>
        <div style={{
          padding: '10px 12px', background: T.bg, borderRadius: 8,
          border: `1px solid ${T.bd}`, fontFamily: 'monospace', fontSize: 12,
          color: T.ac, wordBreak: 'break-all', marginBottom: 12,
        }}>
          {secret}
        </div>
        <div style={{
          fontSize: 11, color: '#faa61a', padding: '8px 10px',
          background: 'rgba(250,166,26,0.08)', borderRadius: 6,
          border: '1px solid rgba(250,166,26,0.15)', marginBottom: 16, lineHeight: 1.5,
        }}>
          Save this secret — it won't be shown again.
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={copy}
            style={{
              padding: '8px 18px', borderRadius: 8, border: `1px solid ${T.bd}`,
              background: T.sf2, color: T.tx, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {copied ? 'Copied!' : 'Copy Secret'}
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '8px 18px', borderRadius: 8, border: 'none',
              background: T.ac, color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Create Form ─────────────────────────────────────────────────────────

function CreateWebhookForm({
  serverId, channels, onCreated, onCancel, onError,
}: {
  serverId: string;
  channels: Channel[];
  onCreated: (wh: Webhook, secret: string) => void;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [channelId, setChannelId] = useState('');
  const [events, setEvents] = useState<string[]>(['message_create']);
  const [saving, setSaving] = useState(false);

  const toggleEvent = (ev: string) => {
    setEvents(prev => prev.includes(ev) ? prev.filter(e => e !== ev) : [...prev, ev]);
  };

  const submit = async () => {
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();

    if (!trimmedName) { onError('Webhook name is required'); return; }
    if (trimmedName.length > 100) { onError('Name must be 100 characters or fewer'); return; }
    if (!trimmedUrl) { onError('Webhook URL is required'); return; }
    if (!trimmedUrl.startsWith('https://')) { onError('URL must start with https://'); return; }
    if (events.length === 0) { onError('Select at least one event'); return; }

    setSaving(true);
    onError('');
    try {
      const result = await api.createWebhook(serverId, {
        name: trimmedName,
        url: trimmedUrl,
        channel_id: channelId || undefined,
        events,
      });
      onCreated(result, result.secret);
    } catch (e: any) {
      onError(e?.message || 'Failed to create webhook');
    }
    setSaving(false);
  };

  const textChannels = channels.filter(c => c.channel_type !== 'voice');

  return (
    <div style={{
      padding: 14, background: T.sf2, borderRadius: 10,
      border: `1px solid ${T.bd}`, marginBottom: 12,
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 12 }}>New Webhook</div>

      {/* Name */}
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 4, textTransform: 'uppercase' }}>
        Name
      </label>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="My Webhook"
        maxLength={100}
        style={{
          width: '100%', padding: '8px 12px', background: T.bg,
          border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx,
          fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 10,
        }}
        aria-label="Webhook name"
      />

      {/* URL */}
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 4, textTransform: 'uppercase' }}>
        URL
      </label>
      <input
        value={url}
        onChange={e => setUrl(e.target.value)}
        placeholder="https://example.com/webhook"
        style={{
          width: '100%', padding: '8px 12px', background: T.bg,
          border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx,
          fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 10,
        }}
        aria-label="Webhook URL"
      />

      {/* Channel filter */}
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 4, textTransform: 'uppercase' }}>
        Channel Filter <span style={{ fontWeight: 400 }}>(optional)</span>
      </label>
      <select
        value={channelId}
        onChange={e => setChannelId(e.target.value)}
        style={{
          width: '100%', padding: '8px 12px', background: T.bg,
          border: `1px solid ${T.bd}`, borderRadius: 8, color: channelId ? T.tx : T.mt,
          fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 10,
        }}
        aria-label="Channel filter"
      >
        <option value="">All channels</option>
        {textChannels.map(ch => (
          <option key={ch.id} value={ch.id}># {ch.name}</option>
        ))}
      </select>

      {/* Events */}
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 6, textTransform: 'uppercase' }}>
        Events
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
        {ALL_EVENTS.map(ev => {
          const active = events.includes(ev.id);
          return (
            <button
              key={ev.id}
              onClick={() => toggleEvent(ev.id)}
              style={{
                padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.15s',
                background: active ? ta(T.ac, '22') : T.bg,
                color: active ? T.ac : T.mt,
                border: `1px solid ${active ? ta(T.ac, '44') : T.bd}`,
              }}
              aria-label={`${ev.label} event`}
              aria-pressed={active}
            >
              {ev.label}
            </button>
          );
        })}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{
            padding: '8px 18px', borderRadius: 8, border: `1px solid ${T.bd}`,
            background: T.sf2, color: T.mt, fontSize: 12, cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={saving}
          style={{
            padding: '8px 18px', borderRadius: 8, border: 'none',
            background: T.ac, color: '#000', fontSize: 12, fontWeight: 700,
            cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Creating...' : 'Create'}
        </button>
      </div>
    </div>
  );
}

// ─── Webhook Row ─────────────────────────────────────────────────────────

function WebhookRow({
  webhook, serverId, onUpdate, onDelete, onError,
}: {
  webhook: Webhook;
  serverId: string;
  onUpdate: (wh: Webhook) => void;
  onDelete: (id: string) => void;
  onError: (msg: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);

  const toggleEnabled = async () => {
    const next = !webhook.enabled;
    onUpdate({ ...webhook, enabled: next, failure_count: next ? 0 : webhook.failure_count });
    try {
      await api.updateWebhook(webhook.id, { enabled: next });
    } catch (e: any) {
      onUpdate(webhook); // revert
      onError(e?.message || 'Failed to update webhook');
    }
  };

  const doDelete = async () => {
    try {
      await api.deleteWebhook(webhook.id);
      onDelete(webhook.id);
    } catch (e: any) {
      onError(e?.message || 'Failed to delete webhook');
    }
    setConfirmDelete(false);
  };

  const doTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await api.testWebhook(serverId, webhook.id);
      setTestResult('ok');
    } catch {
      setTestResult('fail');
    }
    setTesting(false);
    setTimeout(() => setTestResult(null), 3000);
  };

  const truncUrl = webhook.url.length > 40 ? webhook.url.slice(0, 37) + '...' : webhook.url;

  return (
    <div style={{
      padding: '10px 12px', background: T.sf2, borderRadius: 8,
      border: `1px solid ${T.bd}`, marginBottom: 6,
      opacity: webhook.enabled ? 1 : 0.6, transition: 'opacity 0.2s',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.tx, display: 'flex', alignItems: 'center', gap: 6 }}>
            {webhook.name}
            {webhook.failure_count > 0 && (
              <span style={{
                fontSize: 9, padding: '1px 5px', borderRadius: 4,
                background: 'rgba(255,71,87,0.12)', color: T.err, fontWeight: 700,
              }}>
                {webhook.failure_count} failures
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: T.mt, marginTop: 2, fontFamily: 'monospace' }} title={webhook.url}>
            {truncUrl}
          </div>
        </div>

        {/* Toggle */}
        <div
          onClick={toggleEnabled}
          style={{
            width: 36, height: 20, borderRadius: 10,
            background: webhook.enabled ? T.ac : '#555',
            cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
            flexShrink: 0,
          }}
          title={webhook.enabled ? 'Disable' : 'Enable'}
          aria-label={`${webhook.enabled ? 'Disable' : 'Enable'} webhook`}
        >
          <div style={{
            width: 16, height: 16, borderRadius: 8, background: '#fff',
            position: 'absolute', top: 2, left: webhook.enabled ? 18 : 2,
            transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          }} />
        </div>
      </div>

      {/* Event badges */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
        {webhook.events.map(ev => (
          <span key={ev} style={{
            fontSize: 9, padding: '2px 6px', borderRadius: 4,
            background: ta(T.ac, '15'), color: T.ac, fontWeight: 600,
          }}>
            {ev}
          </span>
        ))}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button
          onClick={doTest}
          disabled={testing || !webhook.enabled}
          style={{
            fontSize: 10, padding: '3px 10px', borderRadius: 4,
            border: `1px solid ${T.bd}`, background: T.bg,
            color: testResult === 'ok' ? T.ok : testResult === 'fail' ? T.err : T.tx,
            cursor: testing || !webhook.enabled ? 'default' : 'pointer',
            opacity: !webhook.enabled ? 0.4 : 1,
          }}
        >
          {testing ? 'Testing...' : testResult === 'ok' ? 'Delivered' : testResult === 'fail' ? 'Failed' : 'Test'}
        </button>
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            style={{
              fontSize: 10, padding: '3px 10px', borderRadius: 4,
              border: '1px solid rgba(255,71,87,0.3)', background: 'none',
              color: T.err, cursor: 'pointer',
            }}
          >
            Delete
          </button>
        ) : (
          <>
            <button
              onClick={doDelete}
              style={{
                fontSize: 10, padding: '3px 10px', borderRadius: 4,
                border: 'none', background: T.err, color: '#fff',
                cursor: 'pointer', fontWeight: 700,
              }}
            >
              Confirm Delete
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              style={{
                fontSize: 10, padding: '3px 10px', borderRadius: 4,
                border: `1px solid ${T.bd}`, background: 'none',
                color: T.mt, cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
