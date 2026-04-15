import React, { useState, useEffect } from 'react';
import { BarChart, Bar, PieChart, Pie, Cell, Tooltip, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { getStats, getDetections, clearDetections } from '../api';
import './DashboardPage.css';

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [s, r] = await Promise.all([getStats(), getDetections(200)]);
      
      // Validate and sanitize stats data
      const sanitizedStats = {
        total_detections: s?.total_detections || 0,
        scam_count: s?.scam_count || 0,
        legit_count: s?.legit_count || 0,
        scam_rate: s?.scam_rate || '0%',
        facebook_total: s?.facebook_total || 0,
        twitter_total: s?.twitter_total || 0,
        detections_today: s?.detections_today || 0,
        mock_mode: s?.mock_mode || false
      };
      
      // Validate and sanitize rows data
      const sanitizedRows = Array.isArray(r) ? r : [];
      
      setStats(sanitizedStats);
      setRows(sanitizedRows);
    } catch (err) {
      console.error('Dashboard load error:', err);
      setError('Cannot reach API. Make sure the server is running on http://localhost:8000');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const handleClear = async () => {
    if (!window.confirm('⚠️ Clear all detection records? This action cannot be undone.')) return;
    try {
      await clearDetections();
      await load();
    } catch (err) {
      console.error('Clear error:', err);
      setError('Failed to clear history');
    }
  };

  // Prepare pie chart data with validation
  const pieData = stats && stats.legit_count !== undefined && stats.scam_count !== undefined ? [
    { name: 'Legitimate', value: stats.legit_count || 0 },
    { name: 'Scam', value: stats.scam_count || 0 },
  ] : [];

  // Prepare platform data with validation
  const platData = stats ? [
    { name: 'Facebook', value: stats.facebook_total || 0, fill: '#7c5cfc' },
    { name: 'X (Twitter)', value: stats.twitter_total || 0, fill: '#a78bfa' },
  ] : [];

  // Prepare hourly data with safe array handling
  const hourlyData = (() => {
    if (!rows || rows.length === 0) return [];
    const counts = {};
    rows.forEach(row => {
      if (!row) return;
      try {
        let hour = 0;
        if (row.timestamp) {
          // Handle timestamp safely
          const timestamp = row.timestamp;
          if (typeof timestamp === 'string') {
            const date = new Date(timestamp);
            if (!isNaN(date.getTime())) {
              hour = date.getHours();
            }
          }
        }
        if (!counts[hour]) counts[hour] = { hour: `${hour}:00`, scam: 0, legit: 0 };
        const label = row.label;
        if (label === 1) {
          counts[hour].scam++;
        } else if (label === 0) {
          counts[hour].legit++;
        }
      } catch (err) {
        console.error('Error processing row:', err);
      }
    });
    return Object.values(counts).sort((a, b) => parseInt(a.hour) - parseInt(b.hour));
  })();

  // Loading state
  if (loading && !stats) {
    return (
      <div className="dash-loading">
        <div className="big-spinner-dash" />
        <p>Loading dashboard...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="dash-error card">
        <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
        <p>{error}</p>
        <button 
          onClick={load} 
          style={{ marginTop: 16, padding: '8px 16px', cursor: 'pointer' }}
          className="btn btn-primary"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const statCards = [
    { label: 'Total Scanned', value: stats?.total_detections ?? '—', color: 'default', sub: `${stats?.detections_today ?? 0} today` },
    { label: 'Scams Detected', value: stats?.scam_count ?? '—', color: 'danger', sub: stats?.scam_rate ?? '—' },
    { label: 'Legitimate Posts', value: stats?.legit_count ?? '—', color: 'safe', sub: 'non-scam' },
    { label: 'Scam Rate', value: stats?.scam_rate ?? '—', color: 'warn', sub: 'of all scanned' },
  ];

  // Check if there's any data to show
  const hasData = (stats && (stats.total_detections > 0)) || (rows && rows.length > 0);
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  
  const tooltipStyle = {
    contentStyle: {
      background: isDark ? '#16162a' : '#ffffff',
      border: `1px solid ${isDark ? '#2a2a4a' : '#d0d0e8'}`,
      borderRadius: 8,
      padding: '8px 12px',
    },
    labelStyle: { color: isDark ? '#e0e0f0' : '#1a1a2e' },
  };
  
  const tickColor = isDark ? '#9090b8' : '#4a4a6a';

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">📊 Dashboard</h1>
          <p className="page-sub">
            Live overview · auto-refreshes every 15s
            {stats?.mock_mode && <span className="mock-tag"> · 🟡 Mock Mode (Training)</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" onClick={load}>↻ Refresh</button>
          <button className="btn btn-danger" onClick={handleClear}>🗑️ Clear All</button>
        </div>
      </div>

      <div className="stats-row">
        {statCards.map(({ label, value, color, sub }) => (
          <div key={label} className={`stat-card-d stat-${color}`}>
            <div className="stat-label-d">{label}</div>
            <div className="stat-value-d">{value}</div>
            <div className="stat-sub-d">{sub}</div>
          </div>
        ))}
      </div>

      <div className="charts-row">
        {/* Pie chart */}
        <div className="chart-card card">
          <div className="chart-title">Scam vs Legit</div>
          {!hasData || pieData.every(d => d.value === 0) ? (
            <div className="chart-empty">
              <p>No data yet</p>
              <small>Start using the extension or API to see results</small>
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.name === 'Scam' ? '#f05252' : '#22c55e'} />
                    ))}
                  </Pie>
                  <Tooltip {...tooltipStyle} formatter={(value, name) => [`${value}`, name]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pie-legend">
                <span className="pie-legend-dot" style={{ background: '#22c55e' }} />
                <span className="pie-legend-label">Legitimate</span>
                <span className="pie-legend-dot" style={{ background: '#f05252', marginLeft: 14 }} />
                <span className="pie-legend-label">Scam</span>
              </div>
            </>
          )}
        </div>

        {/* By Platform */}
        <div className="chart-card card">
          <div className="chart-title">By Platform</div>
          {!hasData || platData.every(d => d.value === 0) ? (
            <div className="chart-empty">
              <p>No platform data yet</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={platData} barSize={40}>
                <XAxis 
                  dataKey="name" 
                  tick={{ fill: tickColor, fontSize: 12 }} 
                  axisLine={false} 
                  tickLine={false} 
                />
                <YAxis 
                  tick={{ fill: tickColor, fontSize: 11 }} 
                  axisLine={false} 
                  tickLine={false} 
                />
                <Tooltip {...tooltipStyle} cursor={false} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {platData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Detections by Hour */}
        <div className="chart-card chart-wide card">
          <div className="chart-title">Detections by Hour</div>
          {!hasData || hourlyData.length === 0 ? (
            <div className="chart-empty">
              <p>No hourly data yet</p>
              <small>Data will appear as you make detections</small>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={hourlyData} barSize={14}>
                <XAxis 
                  dataKey="hour" 
                  tick={{ fill: tickColor, fontSize: 11 }} 
                  axisLine={false} 
                  tickLine={false} 
                />
                <YAxis 
                  tick={{ fill: tickColor, fontSize: 11 }} 
                  axisLine={false} 
                  tickLine={false} 
                />
                <Tooltip {...tooltipStyle} cursor={false} />
                <Bar dataKey="scam" fill="#f05252" radius={[4, 4, 0, 0]} name="Scam" />
                <Bar dataKey="legit" fill="#22c55e" radius={[4, 4, 0, 0]} name="Legit" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}