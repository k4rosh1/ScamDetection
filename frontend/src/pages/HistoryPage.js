import React, { useState, useEffect } from 'react';
import { getDetections, clearDetections } from '../api';
import './HistoryPage.css';

const FILTERS = [
  { key: 'all',      label: 'All' },
  { key: 'scam',     label: ' Scam' },
  { key: 'legit',    label: ' Legit' },
  { key: 'facebook', label: ' Facebook' },
  { key: 'twitter',  label: ' X (Twitter)' },
];

// Helper to get extension history
async function getExtensionHistory() {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
    return [];
  }
  
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getHistory' }, (response) => {
      if (response && response.history) {
        const formatted = response.history.map(item => ({
          id: item.id,
          text: item.text || '',
          label: item.verdict === 'SCAM' ? 1 : 0,
          verdict: item.verdict,
          confidence: item.confidence,
          scam_prob: item.scam_prob,
          legit_prob: item.legit_prob,
          platform: item.platform,
          timestamp: item.timestamp,
          is_mock: item.is_mock || false
        }));
        resolve(formatted);
      } else {
        resolve([]);
      }
    });
  });
}

export default function HistoryPage() {
  const [rows,    setRows]    = useState([]);
  const [filter,  setFilter]  = useState('all');
  const [search,  setSearch]  = useState('');
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const load = async () => {
    setLoading(true);
    try { 
      // Get both backend and extension data
      const [backendData, extensionData] = await Promise.all([
        getDetections(200).catch(() => []),
        getExtensionHistory().catch(() => [])
      ]);
      
      // Merge and sort by ID (newest first)
      const allData = [...backendData, ...extensionData];
      allData.sort((a, b) => (b.id || 0) - (a.id || 0));
      
      setRows(allData); 
      setError(''); 
    } catch (err) { 
      console.error('Failed to load history:', err);
      setError('Cannot reach API.'); 
    } finally { 
      setLoading(false); 
    }
  };

  useEffect(() => { load(); }, []);

  const handleClear = async () => {
    if (!window.confirm('Clear all records? This clears ONLY backend records. Extension history will remain.')) return;
    await clearDetections(); 
    load();
  };

  const filtered = rows.filter(r => {
    const matchFilter =
      filter === 'all'      ? true :
      filter === 'scam'     ? r.label === 1 :
      filter === 'legit'    ? r.label === 0 :
      filter === 'facebook' ? r.platform === 'facebook' :
      filter === 'twitter'  ? r.platform === 'twitter' : true;
    const matchSearch = search.trim() === '' ||
      (r.text || '').toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  return (
    <div className="history-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Detection History</h1>
          <p className="page-sub">All past detections — from manual input and browser extension</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost"  onClick={load}>↻ Refresh</button>
          <button className="btn btn-danger" onClick={handleClear}>Clear All</button>
        </div>
      </div>

      <div className="controls-row">
        <div className="filter-tabs">
          {FILTERS.map(f => (
            <button key={f.key}
              className={`filter-tab ${filter === f.key ? 'filter-active' : ''}`}
              onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <input className="search-input" type="text"
          placeholder="Search post text..."
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="results-count">
        Showing <strong>{filtered.length}</strong> of {rows.length} detections
      </div>

      {loading ? (
        <div className="table-loading"><div className="big-spinner-h" /><span>Loading...</span></div>
      ) : error ? (
        <div className="table-error card"> {error}</div>
      ) : filtered.length === 0 ? (
        <div className="table-empty card">
          <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
          <p>No detections found.</p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            Use the Detect page for manual scans, or the extension on Facebook/Twitter.
          </p>
        </div>
      ) : (
        <div className="table-wrap card">
          <table className="det-table">
            <thead>
              <tr>
                <th>ID</th><th>Verdict</th><th>Platform</th><th>Post Text</th>
                <th>Confidence</th><th>Scam %</th><th>Legit %</th>
                <th>Mock?</th><th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const isScam = r.label === 1;
                const conf   = parseFloat(r.confidence) || 0;
                const ts     = r.timestamp ? new Date(r.timestamp).toLocaleString() : '—';
                return (
                  <tr key={r.id} className={isScam ? 'row-scam' : 'row-legit'}>
                    <td className="mono-cell">#{r.id}</td>
                    <td><span className={`tag ${isScam ? 'tag-scam' : 'tag-legit'}`}>{isScam ? ' Scam' : ' Legit'}</span></td>
                    <td><span className="plat-cell">{r.platform === 'facebook' ? ' FB' : r.platform === 'twitter' ? ' X' : ' ?'}</span></td>
                    <td className="text-cell" title={r.text || ''}>{(r.text || '').substring(0, 70)}{r.text?.length > 70 ? '…' : ''}</td>
                    <td>
                      <div className="mini-bar-wrap">
                        <div className="mini-bar"><div className={`mini-fill ${isScam ? 'fill-scam' : 'fill-legit'}`} style={{ width: `${conf}%` }} /></div>
                        <span className="mono-cell">{conf.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="mono-cell" style={{ color: 'var(--danger)' }}>{r.scam_prob  ? parseFloat(r.scam_prob).toFixed(1)  + '%' : '—'}</td>
                    <td className="mono-cell" style={{ color: 'var(--safe)'   }}>{r.legit_prob ? parseFloat(r.legit_prob).toFixed(1) + '%' : '—'}</td>
                    <td className="mono-cell">{r.is_mock ? '🟡' : '✅'}</td>
                    <td className="ts-cell">{ts}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}