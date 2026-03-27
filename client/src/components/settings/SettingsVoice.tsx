import React, { useState, useEffect, useRef } from 'react';
import { T } from '../../theme';
import * as I from '../../icons';
import { voice } from '../../hooks/useVoice';
import { api } from '../../api/CitadelAPI';

export interface SettingsVoiceProps {
  DeviceSelector: React.ComponentType<{ label: string; kind: MediaDeviceKind; storageKey: string; onChange: (id: string) => void }>;
  TestMicrophoneButton: React.ComponentType;
  TestSpeakerButton: React.ComponentType;
  AudioToggle: React.ComponentType<{ label: string; storageKey: string; defaultVal: boolean; desc: string; onChange: (v: boolean) => void }>;
}

export default function SettingsVoice({ DeviceSelector, TestMicrophoneButton, TestSpeakerButton, AudioToggle }: SettingsVoiceProps) {
  return (<>
    <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Input Mode</div>
    <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
      {[{ id: 'vad', label: 'Voice Activity', desc: 'Auto-detect when you speak' }, { id: 'ptt', label: 'Push to Talk', desc: 'Hold a key to transmit' }].map(m => (
        <div key={m.id} onClick={() => { localStorage.setItem('d_vmode', m.id); voice.mode = m.id as any; api.updateSettings({ voice_mode: m.id }).catch(() => {}); }}
          style={{ flex: 1, padding: '12px 14px', borderRadius: 'var(--radius-md)', cursor: 'pointer', border: `2px solid ${(localStorage.getItem('d_vmode') || 'vad') === m.id ? T.ac : T.bd}`, background: (localStorage.getItem('d_vmode') || 'vad') === m.id ? 'rgba(0,212,170,0.06)' : 'transparent', textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: (localStorage.getItem('d_vmode') || 'vad') === m.id ? T.ac : T.tx }}>{m.label}</div>
          <div style={{ fontSize: 10, color: T.mt, marginTop: 2 }}>{m.desc}</div>
        </div>
      ))}
    </div>
    {(localStorage.getItem('d_vmode') || 'vad') === 'vad' && (
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Sensitivity</div>
        <input type="range" min="0.005" max="0.15" step="0.005" defaultValue={localStorage.getItem('d_vsens') || '0.02'} onChange={e => { localStorage.setItem('d_vsens', e.target.value); voice.sensitivity = parseFloat(e.target.value); }} style={{ width: '100%', accentColor: T.ac } as any} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.mt, marginTop: 2 }}><span>More Sensitive</span><span>Less Sensitive</span></div>
      </div>
    )}
    {(localStorage.getItem('d_vmode') || 'vad') === 'ptt' && (
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Push-to-Talk Key</div>
        <div style={{ padding: '12px 16px', borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, background: T.sf2, fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-mono)', color: T.ac, textAlign: 'center', cursor: 'pointer' }}
          onClick={(e) => {
            const el = e.currentTarget; el.textContent = 'Press any key...';
            const handler = (ke: KeyboardEvent) => { ke.preventDefault(); voice.pttKey = ke.key; el.textContent = ke.key === ' ' ? 'Space' : ke.key; localStorage.setItem('d_pttkey', ke.key); api.updateSettings({ push_to_talk_key: ke.key }).catch(() => {}); document.removeEventListener('keydown', handler); };
            document.addEventListener('keydown', handler);
          }}>{localStorage.getItem('d_pttkey') || '`'}</div>
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.mt, marginBottom: 4 }}>
            <span>Release Delay</span>
            <span style={{ color: T.ac, fontFamily: 'monospace' }}>{localStorage.getItem('d_pttDelay') || '200'}ms</span>
          </div>
          <input type="range" min="0" max="500" step="25"
            defaultValue={localStorage.getItem('d_pttDelay') || '200'}
            onChange={e => { localStorage.setItem('d_pttDelay', e.target.value); voice.pttReleaseDelay = parseInt(e.target.value); }}
            style={{ width: '100%', accentColor: T.ac, height: 4 } as any} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: T.mt }}><span>0ms (instant)</span><span>500ms (smooth)</span></div>
          <div style={{ fontSize: 9, color: T.mt, marginTop: 4 }}>Keeps the mic open briefly after releasing the key to avoid cutting off the end of speech.</div>
        </div>
      </div>
    )}
    <div style={{ padding: 12, background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, marginTop: 8, marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 10 }}>Audio Devices</div>
      <DeviceSelector label="Input (Microphone)" kind="audioinput" storageKey="d_audioIn" onChange={id => voice.setInputDevice(id)} />
      <DeviceSelector label="Output (Speakers/Headphones)" kind="audiooutput" storageKey="d_audioOut" onChange={id => voice.setOutputDevice(id)} />
      <DeviceSelector label="Camera" kind="videoinput" storageKey="d_videoIn" onChange={() => {}} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        <TestMicrophoneButton />
        <TestSpeakerButton />
      </div>
    </div>
    <div style={{ padding: 12, background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 10 }}>Volume</div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: T.tx, marginBottom: 4 }}>Input Volume</div>
        <input type="range" min="0" max="200" defaultValue={localStorage.getItem('d_inputVol') || '100'} onChange={e => { localStorage.setItem('d_inputVol', e.target.value); voice.inputGain = parseInt(e.target.value) / 100; }} style={{ width: '100%', accentColor: T.ac } as any} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.mt }}><span>0%</span><span>{localStorage.getItem('d_inputVol') || '100'}%</span><span>200%</span></div>
        <InputLevelMeter />
      </div>
      <div>
        <div style={{ fontSize: 12, color: T.tx, marginBottom: 4 }}>Output Volume</div>
        <input type="range" min="0" max="200" defaultValue={localStorage.getItem('d_outputVol') || '100'} onChange={e => { localStorage.setItem('d_outputVol', e.target.value); voice.outputGain = parseInt(e.target.value) / 100; }} style={{ width: '100%', accentColor: T.ac } as any} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.mt }}><span>0%</span><span>{localStorage.getItem('d_outputVol') || '100'}%</span><span>200%</span></div>
      </div>
    </div>
    <div style={{ padding: 12, background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 10 }}><I.Sliders s={11} /> Audio Processing Chain</div>
      <div style={{ fontSize: 10, color: T.mt, marginBottom: 10, lineHeight: 1.4 }}>Signal path: Mic → Noise Suppression → Noise Gate → Compressor → EQ → Gain → Output. Professional broadcast-grade audio processing chain.</div>
      <AudioToggle label="Noise Suppression" storageKey="d_noiseSup" defaultVal={true} desc="AI-powered background noise removal (RNNoise)" onChange={v => { voice.noiseSuppression = v; api.updateSettings({ voice_noise_suppression: v }).catch(() => {}); }} />
      <AudioToggle label="Echo Cancellation" storageKey="d_echoCan" defaultVal={true} desc="Prevents feedback loops from speakers to mic" onChange={v => voice.echoCancellation = v} />
      <AudioToggle label="Auto Gain Control" storageKey="d_agc" defaultVal={true} desc="Automatically levels your microphone" onChange={v => voice.autoGainControl = v} />

      {/* Noise Gate */}
      <div style={{ marginTop: 12, padding: 10, background: T.bg, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>Noise Gate</span>
          <div onClick={() => { const v = localStorage.getItem('d_noiseGateOn') === 'false'; localStorage.setItem('d_noiseGateOn', String(v)); voice.noiseGateEnabled = v; }}
            style={{ width: 36, height: 20, borderRadius: 10, background: localStorage.getItem('d_noiseGateOn') !== 'false' ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background .2s' }}>
            <div style={{ width: 16, height: 16, borderRadius: 'var(--radius-md)', background: '#fff', position: 'absolute', top: 2, left: localStorage.getItem('d_noiseGateOn') !== 'false' ? 18 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
          </div>
        </div>
        <div style={{ fontSize: 10, color: T.mt, marginBottom: 8 }}>Attenuates audio below the threshold by 40dB. Runs before encryption — cleaned audio is what gets encrypted and sent to other participants.</div>
        <div style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.mt }}>
            <span>Sensitivity (Threshold)</span>
            <span style={{ color: T.ac, fontFamily: 'monospace' }}>{localStorage.getItem('d_noiseGateThresh') || '-50'} dB</span>
          </div>
          <input type="range" min="-60" max="-30" step="1"
            defaultValue={localStorage.getItem('d_noiseGateThresh') || '-50'}
            onChange={e => { localStorage.setItem('d_noiseGateThresh', e.target.value); voice.noiseGateThreshold = parseFloat(e.target.value); }}
            style={{ width: '100%', accentColor: T.ac, height: 4 } as any} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: T.mt }}><span>Very Sensitive (whispers)</span><span>Less Sensitive (loud speech)</span></div>
        </div>
      </div>

      {/* Noise Gate */}
      <div style={{ marginTop: 12, padding: 10, background: T.bg, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>Noise Gate</span>
          <div onClick={() => { const v = localStorage.getItem('d_noiseGate') !== 'true'; localStorage.setItem('d_noiseGate', String(v)); (voice as any).noiseGate = v; }}
            style={{ width: 36, height: 20, borderRadius: 10, background: localStorage.getItem('d_noiseGate') === 'true' ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background .2s' }}>
            <div style={{ width: 16, height: 16, borderRadius: 'var(--radius-md)', background: '#fff', position: 'absolute', top: 2, left: localStorage.getItem('d_noiseGate') === 'true' ? 18 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
          </div>
        </div>
        <div style={{ fontSize: 10, color: T.mt, marginBottom: 8 }}>Cuts audio when signal falls below threshold. Cuts audio when signal falls below threshold level.</div>
        {[
          { key: 'd_ng_openThresh',  label: 'Open Threshold (dB)',  min: -60, max: 0,   step: 1,  def: -26 },
          { key: 'd_ng_closeThresh', label: 'Close Threshold (dB)', min: -60, max: 0,   step: 1,  def: -32 },
          { key: 'd_ng_attack',      label: 'Attack (ms)',          min: 1,   max: 100, step: 1,  def: 25  },
          { key: 'd_ng_hold',        label: 'Hold (ms)',            min: 0,   max: 500, step: 10, def: 200 },
          { key: 'd_ng_release',     label: 'Release (ms)',         min: 10,  max: 500, step: 10, def: 150 },
        ].map(p => (
          <div key={p.key} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.mt }}><span>{p.label}</span><span style={{ color: T.ac, fontFamily: 'monospace' }}>{localStorage.getItem(p.key) || p.def}</span></div>
            <input type="range" min={p.min} max={p.max} step={p.step} defaultValue={localStorage.getItem(p.key) || String(p.def)} onChange={e => localStorage.setItem(p.key, e.target.value)} style={{ width: '100%', accentColor: T.ac, height: 4 } as any} />
          </div>
        ))}
      </div>

      {/* Compressor */}
      <div style={{ marginTop: 10, padding: 10, background: T.bg, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>Compressor</span>
          <div onClick={() => { const v = localStorage.getItem('d_compressor') !== 'true'; localStorage.setItem('d_compressor', String(v)); }}
            style={{ width: 36, height: 20, borderRadius: 10, background: localStorage.getItem('d_compressor') === 'true' ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background .2s' }}>
            <div style={{ width: 16, height: 16, borderRadius: 'var(--radius-md)', background: '#fff', position: 'absolute', top: 2, left: localStorage.getItem('d_compressor') === 'true' ? 18 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
          </div>
        </div>
        <div style={{ fontSize: 10, color: T.mt, marginBottom: 8 }}>Reduces dynamic range — makes quiet sounds louder and loud sounds quieter. Industry-standard dynamic range compression.</div>
        {[
          { key: 'd_comp_ratio',   label: 'Ratio',              min: 1,   max: 20,   step: 0.5, def: 4   },
          { key: 'd_comp_thresh',  label: 'Threshold (dB)',     min: -60, max: 0,    step: 1,   def: -18 },
          { key: 'd_comp_attack',  label: 'Attack (ms)',        min: 1,   max: 100,  step: 1,   def: 6   },
          { key: 'd_comp_release', label: 'Release (ms)',       min: 10,  max: 1000, step: 10,  def: 60  },
          { key: 'd_comp_gain',    label: 'Output Gain (dB)',   min: 0,   max: 20,   step: 1,   def: 0   },
        ].map(p => (
          <div key={p.key} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.mt }}><span>{p.label}</span><span style={{ color: T.ac, fontFamily: 'monospace' }}>{localStorage.getItem(p.key) || p.def}</span></div>
            <input type="range" min={p.min} max={p.max} step={p.step} defaultValue={localStorage.getItem(p.key) || String(p.def)} onChange={e => localStorage.setItem(p.key, e.target.value)} style={{ width: '100%', accentColor: T.ac, height: 4 } as any} />
          </div>
        ))}
      </div>

      {/* Expander */}
      <div style={{ marginTop: 10, padding: 10, background: T.bg, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>Expander</span>
          <div onClick={() => { const v = localStorage.getItem('d_expander') !== 'true'; localStorage.setItem('d_expander', String(v)); }}
            style={{ width: 36, height: 20, borderRadius: 10, background: localStorage.getItem('d_expander') === 'true' ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background .2s' }}>
            <div style={{ width: 16, height: 16, borderRadius: 'var(--radius-md)', background: '#fff', position: 'absolute', top: 2, left: localStorage.getItem('d_expander') === 'true' ? 18 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
          </div>
        </div>
        <div style={{ fontSize: 10, color: T.mt, marginBottom: 8 }}>Gradually reduces audio below threshold — smoother than noise gate.</div>
        {[
          { key: 'd_exp_ratio',   label: 'Ratio',          min: 1,  max: 10,  step: 0.5, def: 4   },
          { key: 'd_exp_thresh',  label: 'Threshold (dB)', min: -60, max: 0,  step: 1,   def: -30 },
          { key: 'd_exp_attack',  label: 'Attack (ms)',    min: 1,  max: 100, step: 1,   def: 10  },
          { key: 'd_exp_release', label: 'Release (ms)',   min: 10, max: 500, step: 10,  def: 100 },
        ].map(p => (
          <div key={p.key} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.mt }}><span>{p.label}</span><span style={{ color: T.ac, fontFamily: 'monospace' }}>{localStorage.getItem(p.key) || p.def}</span></div>
            <input type="range" min={p.min} max={p.max} step={p.step} defaultValue={localStorage.getItem(p.key) || String(p.def)} onChange={e => localStorage.setItem(p.key, e.target.value)} style={{ width: '100%', accentColor: T.ac, height: 4 } as any} />
          </div>
        ))}
      </div>

      <div style={{ marginTop: 10 }}>
        <AudioToggle label="Audio Ducking" storageKey="d_ducking" defaultVal={false} desc="Auto-lower media volume when someone speaks (voice-activated ducking)" onChange={v => { (voice as any).ducking = v; }} />
        <AudioToggle label="Voice Normalization" storageKey="d_normalize" defaultVal={false} desc="Level all participants to similar volume" onChange={v => { (voice as any).normalization = v; }} />
      </div>

      {/* Equalizer */}
      <div style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: T.tx, fontWeight: 600 }}>5-Band Equalizer</div>
          <select style={{ background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.ac, fontSize: 11, padding: '4px 8px', cursor: 'pointer' }} defaultValue="" onChange={e => {
            if (!e.target.value) return;
            const presets: Record<string, Record<string, number>> = {
              flat:      { '60': 0, '250': 0, '1k': 0, '4k': 0, '16k': 0 },
              rock:      { '60': 3, '250': 1, '1k': 0, '4k': 2, '16k': 3 },
              hiphop:    { '60': 5, '250': 3, '1k': -1, '4k': 1, '16k': 2 },
              pop:       { '60': 1, '250': 2, '1k': 3, '4k': 2, '16k': 1 },
              country:   { '60': 2, '250': 1, '1k': 2, '4k': 3, '16k': 2 },
              edm:       { '60': 4, '250': 2, '1k': 0, '4k': 1, '16k': 3 },
              jazz:      { '60': 3, '250': 1, '1k': -1, '4k': 1, '16k': 2 },
              classical: { '60': 1, '250': 0, '1k': 0, '4k': 1, '16k': 3 },
              bass:      { '60': 6, '250': 4, '1k': 0, '4k': 0, '16k': 0 },
              vocal:     { '60': -2, '250': 0, '1k': 3, '4k': 4, '16k': 1 },
            };
            const p = presets[e.target.value]; if (!p) return;
            Object.entries(p).forEach(([f, v]) => { localStorage.setItem('d_eq_' + f, String(v)); voice.setEQ(f, v); });
            e.target.value = '';
          }}>
            <option value="">Presets</option>
            <option value="flat">Flat (Neutral)</option><option value="rock">Rock & Roll</option>
            <option value="hiphop">Hip-Hop / R&B</option><option value="pop">Pop</option>
            <option value="country">Country</option><option value="edm">EDM / Electronic</option>
            <option value="jazz">Jazz</option><option value="classical">Classical / Orchestral</option>
            <option value="bass">Bass Boost</option><option value="vocal">Vocal / Podcast</option>
          </select>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'flex-end' }}>
          {[{ f: '60', l: '60' }, { f: '250', l: '250' }, { f: '1k', l: '1k' }, { f: '4k', l: '4k' }, { f: '16k', l: '16k' }].map(({ f, l }) => (
            <div key={f} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '18%' }}>
              <span style={{ fontSize: 9, color: T.ac, fontFamily: 'monospace', marginBottom: 2 }}>{localStorage.getItem('d_eq_' + f) || '0'}dB</span>
              <input type="range" min="-12" max="12" defaultValue={localStorage.getItem('d_eq_' + f) || '0'} onChange={e => { localStorage.setItem('d_eq_' + f, e.target.value); voice.setEQ(f, parseFloat(e.target.value)); }} style={{ width: 60, height: 'auto', accentColor: T.ac, writingMode: 'vertical-lr', direction: 'rtl' } as any} />
              <span style={{ fontSize: 9, color: T.mt, marginTop: 4 }}>{l}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: T.mt, marginTop: 4 }}><span>Bass</span><span>Mid</span><span>Treble</span></div>
        <button onClick={() => { ['60', '250', '1k', '4k', '16k'].forEach(f => { localStorage.setItem('d_eq_' + f, '0'); voice.setEQ(f, 0); }); }} className="pill-btn" style={{ marginTop: 6, fontSize: 10, color: T.mt, background: T.sf, border: `1px solid ${T.bd}`, padding: '4px 10px' }}>Reset EQ</button>
      </div>
    </div>
    {/* E2EE Voice Encryption */}
    <div style={{ padding: 12, background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, marginTop: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 10 }}><I.Shield s={11} /> End-to-End Voice Encryption</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>End-to-End Voice Encryption</div>
          <div style={{ fontSize: 10, color: T.mt, marginTop: 2 }}>Encrypts every audio and video frame with SFrame (RFC 9605). Requires browser support for Insertable Streams.</div>
        </div>
        <div onClick={() => { const v = localStorage.getItem('d_sframe_enabled') !== 'false'; localStorage.setItem('d_sframe_enabled', String(!v)); }}
          style={{ width: 36, height: 20, borderRadius: 10, background: localStorage.getItem('d_sframe_enabled') !== 'false' ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0, marginLeft: 12 }}>
          <div style={{ width: 16, height: 16, borderRadius: 'var(--radius-md)', background: '#fff', position: 'absolute', top: 2, left: localStorage.getItem('d_sframe_enabled') !== 'false' ? 18 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: T.mt, padding: '6px 8px', background: T.bg, borderRadius: 6, border: `1px solid ${T.bd}` }}>
        <span style={{ fontWeight: 600, color: T.tx }}>Cipher Suite:</span>
        <span style={{ fontFamily: 'monospace', color: T.ac }}>AES-256-GCM</span>
      </div>
    </div>

    {/* Voice Safety */}
    <div style={{ padding: 12, background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, marginTop: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 10 }}>Voice Safety</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>Confirm before leaving voice</div>
          <div style={{ fontSize: 10, color: T.mt, marginTop: 2 }}>Show a confirmation dialog before disconnecting from voice channels or calls</div>
        </div>
        <div onClick={() => { const v = localStorage.getItem('d_voice_confirm') === 'false'; localStorage.setItem('d_voice_confirm', String(v)); }}
          style={{ width: 36, height: 20, borderRadius: 10, background: localStorage.getItem('d_voice_confirm') !== 'false' ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0, marginLeft: 12 }}>
          <div style={{ width: 16, height: 16, borderRadius: 'var(--radius-md)', background: '#fff', position: 'absolute', top: 2, left: localStorage.getItem('d_voice_confirm') !== 'false' ? 18 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
        </div>
      </div>
    </div>

    <div style={{ padding: 12, background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, marginTop: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 6 }}>How Discreet Voice Works</div>
      <div style={{ fontSize: 12, color: T.tx, lineHeight: 1.5 }}>Voice uses peer-to-peer WebRTC with echo cancellation and noise suppression. Audio goes directly between participants — it never touches our servers. SFrame (RFC 9605) encrypts every audio frame end-to-end when enabled.</div>
    </div>
  </>);
}

// ─── Input Level Meter ───────────────────────────────────────────────────

function InputLevelMeter() {
  const [level, setLevel] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const deviceId = localStorage.getItem('d_audioIn');
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : true,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        ctxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);

        const poll = () => {
          if (cancelled) return;
          analyser.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length / 255;
          setLevel(avg);
          rafRef.current = requestAnimationFrame(poll);
        };
        poll();
      } catch { /* mic denied — meter stays at 0 */ }
    })();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (ctxRef.current) ctxRef.current.close();
    };
  }, []);

  const pct = Math.min(100, Math.round(level * 100));
  const color = pct > 80 ? '#ff4757' : pct > 40 ? '#faa61a' : '#2ecc71';

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <I.Mic s={11} />
        <div style={{ flex: 1, height: 6, background: T.bd, borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.05s' }} />
        </div>
        <span style={{ fontSize: 9, color: T.mt, fontFamily: 'monospace', width: 28, textAlign: 'right' }}>{pct}%</span>
      </div>
      <div style={{ fontSize: 9, color: T.mt, marginTop: 2 }}>Input level — speak to test your microphone</div>
    </div>
  );
}
