import React, { useState, useEffect } from 'react';
import { predict, checkHealth } from '../api';
import './DetectPage.css';

const DEFAULT_META = {
  platform:          'facebook',
  account_age:       365,
  posting_frequency: 1.0,
};

// Converts a date string to number of days from that date until today
function dateToDays(dateStr) {
  if (!dateStr) return 0;
  const joined = new Date(dateStr);
  const today  = new Date();
  const diff   = Math.floor((today - joined) / (1000 * 60 * 60 * 24));
  return diff < 0 ? 0 : diff;
}

// Converts number of days back to a date string for the date picker display
function daysToDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function NumberField({ label, name, value, onChange, hint, min, max, step }) {
  return (
    <div className="field-row">
      <div className="field-label-wrap">
        <label className="field-label">{label}</label>
        {hint && <span className="field-hint">{hint}</span>}
      </div>
      <input type="number" name={name} value={value} onChange={onChange}
        min={min} max={max} step={step || 1} className="field-input" />
    </div>
  );
}

function ResultCard({ result }) {
  const isScam = result.label === 1;
  const scamW  = result.scam_prob;
  const legitW = result.legit_prob;

  return (
    <div className={`result-card ${isScam ? 'result-scam' : 'result-legit'}`}>
      {result.is_mock && (
        <div className="mock-banner">🟡 Mock Mode — predictions are simulated</div>
      )}
      {result.is_duplicate && (
        <div className="duplicate-banner">⚡ Cached result — this post was scanned before. No duplicate saved to database.</div>
      )}
      <div className="result-header">
        <div className={`result-icon ${isScam ? 'icon-scam' : 'icon-legit'}`}>
          {isScam ? '🚨' : '✅'}
        </div>
        <div>
          <div className="result-verdict">{isScam ? 'Scam Detected' : 'Looks Legitimate'}</div>
          <div className="result-platform">
            {result.platform === 'facebook' ? '📘 Facebook' : '🐦 X (Twitter)'}
          </div>
        </div>
        <span className={`tag ${isScam ? 'tag-scam' : 'tag-legit'}`}>
          {isScam ? 'SCAM' : 'LEGIT'}
        </span>
      </div>

      <div className="result-bars">
        <div className="prob-row">
          <span className="prob-label">Scam probability</span>
          <div className="prob-bar-wrap">
            <div className="prob-bar">
              <div className="prob-fill prob-fill-scam" style={{ width: scamW }} />
            </div>
            <span className="prob-value" style={{ color: 'var(--danger)' }}>{scamW}</span>
          </div>
        </div>
        <div className="prob-row">
          <span className="prob-label">Legit probability</span>
          <div className="prob-bar-wrap">
            <div className="prob-bar">
              <div className="prob-fill prob-fill-legit" style={{ width: legitW }} />
            </div>
            <span className="prob-value" style={{ color: 'var(--safe)' }}>{legitW}</span>
          </div>
        </div>
      </div>

      <div className="result-conf">
        <span className="conf-label">Model confidence</span>
        <span className="conf-value">{result.confidence}</span>
      </div>
    </div>
  );
}

export default function DetectPage() {
  const [text,        setText]       = useState('');
  const [meta,        setMeta]       = useState(DEFAULT_META);
  const [joinedDate,  setJoinedDate] = useState(daysToDate(DEFAULT_META.account_age));
  const [result,      setResult]     = useState(null);
  const [loading,     setLoading]    = useState(false);
  const [error,       setError]      = useState('');
  const [online,      setOnline]     = useState(null);
  const [tab,         setTab]        = useState('text');

  useEffect(() => { checkHealth().then(ok => setOnline(ok)); }, []);

  // When user picks a date → auto-calculate days and update meta
  const handleDateChange = (e) => {
    const dateStr = e.target.value;
    setJoinedDate(dateStr);
    const days = dateToDays(dateStr);
    setMeta(prev => ({ ...prev, account_age: days }));
  };

  const handleMeta = (e) => {
    const { name, value } = e.target;
    setMeta(prev => ({ ...prev, [name]: parseFloat(value) ?? value }));
  };

  const handleSubmit = async () => {
    if (!text.trim()) { setError('Please enter a post caption.'); return; }
    setError(''); setLoading(true); setResult(null);
    try {
      const res = await predict({ text: text.trim(), ...meta });
      setResult(res);
    } catch {
      setError('Cannot reach API. Make sure the server is running at http://localhost:8000');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setText('');
    setMeta(DEFAULT_META);
    setJoinedDate(daysToDate(DEFAULT_META.account_age));
    setResult(null);
    setError('');
    setTab('text');
  };

  const fillScamSample = () => {
    setText("GRABE! Kumita ako ng 50000 pesos sa loob ng 7 araw! DM mo ko para malaman kung paano! 💰🔥 bit.ly/abc123");
    const age = 30;
    setMeta(prev => ({ ...prev, account_age: age, posting_frequency: 15.0 }));
    setJoinedDate(daysToDate(age));
    setTab('meta');
    setTimeout(() => setTab('text'), 1500);
  };

  const fillLegitSample = () => {
    setText("Kumain kami ni Maria sa Jollibee kanina. Masarap pa rin ang Chickenjoy! Highly recommend 😄");
    const age = 800;
    setMeta(prev => ({ ...prev, account_age: age, posting_frequency: 1.2 }));
    setJoinedDate(daysToDate(age));
    setTab('meta');
    setTimeout(() => setTab('text'), 1500);
  };

  // Today's date as max for the date picker (can't join in the future)
  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="detect-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Scam Detector</h1>
          <p className="page-sub">Enter a post caption and account metadata to get a scam verdict.</p>
        </div>
        {online === false && (
          <div className="offline-banner">⚠️ API is offline — start the FastAPI server first</div>
        )}
      </div>

      <div className="detect-grid">
        {/* LEFT — Input */}
        <div className="input-panel">

          {/* Platform */}
          <div className="platform-selector">
            <button className={`plat-btn ${meta.platform === 'facebook' ? 'plat-active' : ''}`}
              onClick={() => setMeta(p => ({ ...p, platform: 'facebook' }))}>
              📘 Facebook
            </button>
            <button className={`plat-btn ${meta.platform === 'twitter' ? 'plat-active' : ''}`}
              onClick={() => setMeta(p => ({ ...p, platform: 'twitter' }))}>
              🐦 X (Twitter)
            </button>
          </div>

          {/* Tabs */}
          <div className="tab-bar">
            <button className={`tab-btn ${tab === 'text' ? 'tab-active' : ''}`} onClick={() => setTab('text')}>
              ✏️ Post Caption
            </button>
            <button className={`tab-btn ${tab === 'meta' ? 'tab-active' : ''}`} onClick={() => setTab('meta')}>
              👤 Account Metadata
            </button>
          </div>

          {/* Tab: Post text */}
          {tab === 'text' && (
            <div className="tab-content">
              <label className="field-label" style={{ marginBottom: 8, display: 'block' }}>
                Post / Caption Text
                <span className="field-hint"> — Taglish supported</span>
              </label>
              <textarea className="post-textarea"
                placeholder={meta.platform === 'facebook'
                  ? 'Paste a Facebook post here...'
                  : 'Paste a tweet here...'}
                value={text}
                onChange={e => setText(e.target.value)}
                rows={8}
              />
              <div className="char-count">{text.length} characters</div>
              <div className="examples-wrap">
                <span className="examples-label">Try an example:</span>
                <button className="example-btn scam-ex" onClick={fillScamSample}>
                  🚨 Scam sample
                </button>
                <button className="example-btn legit-ex" onClick={fillLegitSample}>
                  ✅ Legit sample
                </button>
              </div>
            </div>
          )}

          {/* Tab: Metadata */}
          {tab === 'meta' && (
            <div className="tab-content meta-form">
              <div className="meta-section-title">📅 Account Info</div>

              {/* Date picker — user picks join date, days calculated automatically */}
              <div className="date-field-row">
                <span className="date-field-label">Account Joined Date</span>
                <span className="date-field-hint">Pick the date the account was created</span>
                <input
                  type="date"
                  className="date-input"
                  value={joinedDate}
                  max={today}
                  onChange={handleDateChange}
                />
              </div>

              {/* Auto-calculated result — shown below the date picker */}
              <div className="days-display">
                <span className="days-label">Account age in days</span>
                <div className="days-value-wrap">
                  <span className="days-formula">Today − Joined Date =</span>
                  <span className="days-value">{meta.account_age} days</span>
                </div>
              </div>

              <div className="meta-section-title" style={{ marginTop: 20 }}>📊 Activity</div>
              <NumberField
                label="Posts per Day"
                name="posting_frequency"
                value={meta.posting_frequency}
                onChange={handleMeta}
                hint="Average posting frequency"
                min={0} max={100} step={0.1}
              />
            </div>
          )}

          {error && <div className="error-msg">⚠️ {error}</div>}

          <div className="action-row">
            <button className="btn btn-primary analyze-btn" onClick={handleSubmit}
              disabled={loading || !text.trim()}>
              {loading ? <><span className="spinner" /> Analysing...</> : <>🔍 Analyse Post</>}
            </button>
            <button className="btn btn-ghost" onClick={handleReset}>Reset</button>
          </div>
        </div>

        {/* RIGHT — Result */}
        <div className="result-panel">
          {!result && !loading && (
            <div className="result-placeholder">
              <div className="placeholder-icon">🛡️</div>
              <p className="placeholder-title">Ready to analyse</p>
              <p className="placeholder-sub">Enter a post caption and click <strong>Analyse Post</strong>.</p>
              <div className="placeholder-tips">
                <div className="tip">💡 Pick the account's join date for accuracy</div>
                <div className="tip">🌐 Supports Tagalog, English, and Taglish</div>
                <div className="tip">⚡ Powered by mBERT + Early Fusion</div>
              </div>
            </div>
          )}

          {loading && (
            <div className="result-placeholder">
              <div className="big-spinner" />
              <p className="placeholder-title">Analysing post...</p>
              <p className="placeholder-sub">Running mBERT encoder + metadata fusion</p>
            </div>
          )}

          {result && !loading && (
            <div style={{ animation: 'fadeInUp 0.35s ease' }}>
              <ResultCard result={result} />
              <div className="summary-card card" style={{ marginTop: 16 }}>
                <div className="summary-title">📋 Input Summary</div>
                <div className="summary-grid">
                  {[
                    { label: 'Platform',    value: meta.platform === 'facebook' ? '📘 Facebook' : '🐦 X' },
                    { label: 'Joined Date', value: joinedDate },
                    { label: 'Acct Age',    value: `${meta.account_age} days` },
                    { label: 'Posts/Day',   value: meta.posting_frequency },
                  ].map(({ label, value }) => (
                    <div className="summary-item" key={label}>
                      <span className="s-label">{label}</span>
                      <span className="s-value">{value}</span>
                    </div>
                  ))}
                </div>
                <div className="summary-text">
                  <span className="s-label">Analysed text:</span>
                  <p className="s-text-preview">
                    "{text.substring(0, 120)}{text.length > 120 ? '…' : ''}"
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}