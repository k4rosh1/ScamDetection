import React, { useState, useEffect } from 'react';
import { BarChart, Bar, PieChart, Pie, Cell, Tooltip, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { getStats, getDetections, clearDetections } from '../api';
import './DashboardPage.css';

export default function DashboardPage() {
  const [stats,   setStats]   = useState(null);
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [s, r] = await Promise.all([getStats(), getDetections(200)]);
      setStats(s); setRows(r); setError('');
    } catch { setError('Cannot reach API. Make sure the server is running.'); }
    finally  { setLoading(false); }
  };

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);

  const handleClear = async () => {
    if (!window.confirm('Clear all detection records?')) return;
    await clearDetections(); load();
  };

  const pieData = stats ? [
    { name: 'Legitimate', value: stats.legit_count },
    { name: 'Scam',       value: stats.scam_count  },
  ] : [];

  const platData = stats ? [
    { name: 'Facebook',    value: stats.facebook_total, fill: '#7c5cfc' },
    { name: 'X (Twitter)', value: stats.twitter_total,  fill: '#a78bfa' },
  ] : [];

  const hourlyData = (() => {
    const counts = {};
    rows.forEach(r => {
      const h = r.timestamp ? new Date(r.timestamp + 'Z').getHours() : 0;
      if (!counts[h]) counts[h] = { hour: `${h}:00`, scam: 0, legit: 0 };
      counts[h][r.label === 1 ? 'scam' : 'legit']++;
    });
    return Object.values(counts).sort((a, b) => parseInt(a.hour) - parseInt(b.hour));
  })();

  if (loading && !stats) return (
    <div className="dash-loading"><div className="big-spinner-dash" /><p>Loading dashboard...</p></div>
  );

  if (error) return (
    <div className="dash-error card"><div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div><p>{error}</p></div>
  );

  const statCards = [
    { label: 'Total Scanned',    value: stats?.total_detections ?? '—', color: 'default', sub: `${stats?.detections_today ?? 0} today` },
    { label: 'Scams Detected',   value: stats?.scam_count       ?? '—', color: 'danger',  sub: stats?.scam_rate ?? '—' },
    { label: 'Legitimate Posts', value: stats?.legit_count      ?? '—', color: 'safe',    sub: 'non-scam' },
    { label: 'Scam Rate',        value: stats?.scam_rate        ?? '—', color: 'warn',    sub: 'of all scanned' },
  ];

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const tooltipStyle = {
    contentStyle: {
      background: isDark ? '#16162a' : '#ffffff',
      border: `1px solid ${isDark ? '#2a2a4a' : '#d0d0e8'}`,
      borderRadius: 8,
    },
    labelStyle: { color: isDark ? '#e0e0f0' : '#1a1a2e' },
  };
  const tickColor = isDark ? '#9090b8' : '#4a4a6a';

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">Live overview · auto-refreshes every 15s
            {stats?.mock_mode && <span className="mock-tag"> · 🟡 Mock Mode</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost"  onClick={load}>↻ Refresh</button>
          <button className="btn btn-danger" onClick={handleClear}>Clear All</button>
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
          {pieData.every(d => d.value === 0)
            ? <div className="chart-empty">No data yet</div>
            : (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%"
                      innerRadius={60} outerRadius={90}
                      paddingAngle={3} dataKey="value">
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={['#22c55e', '#f05252'][i]} />
                      ))}
                    </Pie>
                    <Tooltip {...tooltipStyle} formatter={(value, name) => [value, name]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pie-legend">
                  <span className="pie-legend-dot" style={{ background: '#22c55e' }} />
                  <span className="pie-legend-label">Legitimate</span>
                  <span className="pie-legend-dot" style={{ background: '#f05252', marginLeft: 14 }} />
                  <span className="pie-legend-label">Scam</span>
                </div>
              </>
            )
          }
        </div>

        {/* By Platform */}
        <div className="chart-card card">
          <div className="chart-title">By Platform</div>
          {platData.every(d => d.value === 0)
            ? <div className="chart-empty">No data yet</div>
            : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={platData} barSize={40}>
                  <XAxis dataKey="name" tick={{ fill: tickColor, fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: tickColor, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip {...tooltipStyle} cursor={false} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {platData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )
          }
        </div>

        {/* Detections by Hour */}
        <div className="chart-card chart-wide card">
          <div className="chart-title">Detections by Hour</div>
          {hourlyData.length === 0
            ? <div className="chart-empty">No data yet</div>
            : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={hourlyData} barSize={14}>
                  <XAxis dataKey="hour" tick={{ fill: tickColor, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: tickColor, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip {...tooltipStyle} cursor={false} />
                  <Bar dataKey="scam"  fill="#f05252" radius={[4, 4, 0, 0]} name="Scam" />
                  <Bar dataKey="legit" fill="#22c55e" radius={[4, 4, 0, 0]} name="Legit" />
                </BarChart>
              </ResponsiveContainer>
            )
          }
        </div>

      </div>
    </div>
  );
}