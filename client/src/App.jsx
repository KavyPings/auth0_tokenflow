import { useEffect, useRef, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity, AlertTriangle, ArrowRight, BadgeCheck, ChevronRight,
  Database, Flame, LayoutDashboard, Lock, Menu, Play, RefreshCcw,
  Search, Shield, ShieldAlert, ShieldCheck, ShieldX, Sparkles,
  SquareActivity, TimerReset, Wifi, Workflow, X, Zap, Eye, KeyRound,
} from 'lucide-react';
import { api, getWebSocketUrl } from './api.js';
import LandingPage from './pages/LandingPage.jsx';
import TestbenchPage from './pages/TestbenchPage.jsx';
import UploadPage from './pages/UploadPage.jsx';
import IncidentPage from './pages/IncidentPage.jsx';

/* ─── Interactive Particle Canvas ─── */
function ParticleCanvas() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let W = canvas.width = window.innerWidth;
    let H = canvas.height = window.innerHeight;
    let mouse = { x: W / 2, y: H / 2 };
    const N = 80;
    const pts = Array.from({ length: N }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
      r: Math.random() * 1.5 + 0.5,
    }));
    const onMove = (e) => { mouse.x = e.clientX; mouse.y = e.clientY; };
    window.addEventListener('mousemove', onMove);
    const onResize = () => { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; };
    window.addEventListener('resize', onResize);
    let raf;
    function draw() {
      ctx.clearRect(0, 0, W, H);
      pts.forEach(p => {
        const dx = mouse.x - p.x, dy = mouse.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 120) { p.vx += dx / dist * 0.04; p.vy += dy / dist * 0.04; }
        p.vx *= 0.97; p.vy *= 0.97;
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(196,192,255,0.35)';
        ctx.fill();
      });
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 100) {
          ctx.beginPath();
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[j].x, pts[j].y);
          ctx.strokeStyle = `rgba(196,192,255,${0.06 * (1 - d / 100)})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
      raf = requestAnimationFrame(draw);
    }
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('mousemove', onMove); window.removeEventListener('resize', onResize); };
  }, []);
  return <canvas ref={canvasRef} id="particle-canvas" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }} />;
}

/* ─── Material Symbol shortcut ─── */
const M = ({ icon, className = '', style }) => (
  <span className={`material-symbols-outlined ${className}`} style={style}>{icon}</span>
);

/* ═══════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════ */
const STEP_ORDER = ['READ_OBJECT', 'CALL_INTERNAL_API', 'WRITE_OBJECT'];

const STEP_META = {
  READ_OBJECT: { label: 'Read Object', msym: 'database', service: 'Cloud Storage', desc: 'Read data from GCS bucket', phase: '01' },
  CALL_INTERNAL_API: { label: 'Call Internal API', msym: 'api', service: 'Internal API', desc: 'Process via internal endpoint', phase: '02' },
  WRITE_OBJECT: { label: 'Write Object', msym: 'save', service: 'Cloud Storage', desc: 'Write results to GCS', phase: '03' },
  READ_REPO: { label: 'Read Repo', msym: 'dangerous', service: 'Source Control', desc: 'BLOCKED — unauthorized access attempt', phase: 'XX' },
};

const NAV_ITEMS = [
  { id: 'landing', label: 'About', msym: 'home' },
  { id: 'dashboard', label: 'Dashboard', msym: 'space_dashboard' },
  { id: 'chain', label: 'Token Chain', msym: 'token' },
  { id: 'security', label: 'Security', msym: 'shield', badgeKey: 'alerts' },
  { id: 'testbench', label: 'Testbench', msym: 'science' },
  { id: 'upload', label: 'Upload', msym: 'upload_file' },
  { id: 'launch', label: 'Launch', msym: 'play_arrow' },
  { id: 'incident', label: 'Incident', msym: 'gpp_bad' },
];

/* ═══════════════════════════════════════════════════════════
   Main App
   ═══════════════════════════════════════════════════════════ */
export default function App() {
  const [page, setPage] = useState('landing');
  const [overview, setOverview] = useState(null);
  const [health, setHealth] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [selectedTask, setSelectedTask] = useState('SCENARIO-002');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(null);
  const [chain, setChain] = useState([]);
  const [audit, setAudit] = useState([]);
  const [busyAction, setBusyAction] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [socketState, setSocketState] = useState('connecting');
  const refreshTimeoutRef = useRef(null);
  const selectedWorkflowIdRef = useRef(selectedWorkflowId);
  const [pulseIndex, setPulseIndex] = useState(0);
  const [statusRailCollapsed, setStatusRailCollapsed] = useState(() => (
    typeof window !== 'undefined' ? window.innerWidth < 1100 : false
  ));

  const workflows = overview?.workflows || [];
  const currentWorkflow = workflows.find((w) => w.id === selectedWorkflowId) || workflows[0] || null;
  const reviewQueue = overview?.reviewQueue || [];
  const currentReview = reviewQueue.find((i) => i.workflowId === selectedWorkflowId) || reviewQueue[0] || null;
  const credentials = overview?.credentials || [];
  const chainNodes = buildChainNodes(chain);

  const loadDashboard = useCallback(async (preferredId) => {
    const [o, h, t] = await Promise.all([
      api('/api/dashboard/overview'), api('/api/health'), api('/api/workflows/tasks/list'),
    ]);
    setOverview(o); setHealth(h); setTasks(t.tasks || []);
    if (preferredId) { setSelectedWorkflowId(preferredId); return; }
    setSelectedWorkflowId((c) => (c && o.workflows.some((w) => w.id === c)) ? c : o.workflows[0]?.id || null);
  }, []);

  const loadChain = useCallback(async (wfId) => {
    if (!wfId) { setChain([]); setAudit([]); return; }
    const [c, a] = await Promise.all([api(`/api/tokens/chain/${wfId}`), api(`/api/tokens/audit?workflowId=${wfId}`)]);
    setChain(c.chain || []); setAudit(a.audit_log || []);
  }, []);

  useEffect(() => { loadDashboard().catch((e) => setError(e.message)); }, [loadDashboard]);
  useEffect(() => { loadChain(selectedWorkflowId).catch((e) => setError(e.message)); }, [selectedWorkflowId, loadChain]);
  useEffect(() => { selectedWorkflowIdRef.current = selectedWorkflowId; }, [selectedWorkflowId]);
  useEffect(() => {
    const interval = setInterval(() => setPulseIndex((value) => value + 1), 3200);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const ws = new WebSocket(getWebSocketUrl());
    ws.addEventListener('open', () => setSocketState('live'));
    ws.addEventListener('close', () => setSocketState('offline'));
    ws.addEventListener('error', () => setSocketState('degraded'));
    ws.addEventListener('message', (e) => {
      try { const d = JSON.parse(e.data); if (d.type === 'SECURITY_VIOLATION') setNotice('Security violation detected — review queue updated.'); } catch {}
      clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = setTimeout(() => {
        loadDashboard().then(() => loadChain(selectedWorkflowIdRef.current)).catch((err) => setError(err.message));
      }, 300);
    });
    return () => { clearTimeout(refreshTimeoutRef.current); ws.close(); };
  }, [loadDashboard, loadChain]);

  useEffect(() => { if (!notice && !error) return; const t = setTimeout(() => { setNotice(''); setError(''); }, 5000); return () => clearTimeout(t); }, [notice, error]);

  async function withBusy(name, fn) { setBusyAction(name); setError(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusyAction(''); } }

  function handleStart() {
    withBusy('start', async () => {
      const r = await api('/api/workflows/start', { method: 'POST', body: JSON.stringify({ taskId: selectedTask }) });
      setNotice(`Workflow ${r.workflowId} started.`);
      setPage('chain');
      await loadDashboard(r.workflowId);
      await loadChain(r.workflowId);
    });
  }

  function handleResume(id) { withBusy('resume', async () => { await api(`/api/workflows/${id}/resume`, { method: 'POST' }); setNotice('Workflow resumed.'); await loadDashboard(id); await loadChain(id); }); }
  function handleRevoke(id) { withBusy('revoke', async () => { await api(`/api/workflows/${id}/revoke`, { method: 'POST' }); setNotice('Workflow aborted.'); await loadDashboard(id); await loadChain(id); }); }
  function handleKill(id) { if (!id) return; withBusy('kill', async () => { await api(`/api/workflows/${id}/kill`, { method: 'POST' }); setNotice('Kill switch engaged.'); await loadDashboard(id); await loadChain(id); }); }
  function handleRefresh() { withBusy('refresh', async () => { await loadDashboard(); await loadChain(selectedWorkflowId); setNotice('Dashboard refreshed.'); }); }

  const alertCount = reviewQueue.length;

  function goToChain(wfId) {
    if (wfId) setSelectedWorkflowId(wfId);
    setPage('chain');
  }

  const currentChainProgress = chainNodes.length
    ? Math.round((chainNodes.filter((node) => node.status === 'burned').length / chainNodes.length) * 100)
    : 0;

  const statusSignals = [
    {
      label: 'Execution',
      value: currentWorkflow ? currentWorkflow.name : 'Awaiting launch',
      meta: currentWorkflow ? `${currentWorkflow.status} - ${currentWorkflow.id.slice(0, 12)}` : 'Start a workflow to populate the chain',
      tone: currentWorkflow?.status === 'paused' ? 'warning' : currentWorkflow ? 'primary' : 'neutral',
      page: currentWorkflow ? 'chain' : 'launch',
      msym: 'hub',
    },
    {
      label: 'Review queue',
      value: reviewQueue.length ? `${reviewQueue.length} intercepts live` : 'No active alerts',
      meta: reviewQueue.length ? 'Security is waiting on human review' : 'Guardrails are holding steady',
      tone: reviewQueue.length ? 'danger' : 'success',
      page: 'security',
      msym: 'shield',
    },
    {
      label: 'Vault boundary',
      value: `${credentials.length} credentials isolated`,
      meta: health?.auth0 ? `Auth layer: ${String(health.auth0).toUpperCase()}` : 'Vault telemetry online',
      tone: 'secondary',
      page: 'vault',
      msym: 'lock',
    },
    {
      label: 'Socket stream',
      value: socketState === 'live' ? 'Realtime link healthy' : `Link ${socketState}`,
      meta: `${workflows.length} workflows mirrored into the UI`,
      tone: socketState === 'live' ? 'success' : 'warning',
      page: 'audit',
      msym: 'sensors',
    },
  ];

  const tickerItems = [
    `${workflows.length} workflow${workflows.length === 1 ? '' : 's'} tracked in mission control`,
    reviewQueue.length ? `${reviewQueue.length} workflow${reviewQueue.length === 1 ? '' : 's'} waiting on security review` : 'No review queue pressure right now',
    currentWorkflow ? `${currentChainProgress}% of the selected chain has already burned through execution` : 'Launch a scenario to animate the capability chain',
    credentials.length ? `${credentials.length} backend credentials remain vault-brokered and hidden from the agent` : 'Vault registry is ready for live credentials',
  ];

  return (
    <div className={`app-shell min-h-screen ${statusRailCollapsed ? 'rail-collapsed' : 'rail-expanded'}`}>
      <ParticleCanvas />
      {/* ─── Floating Top Navbar ─── */}
      <nav className="top-navbar">
        <div className="flex items-center gap-3">
          <M icon="security" style={{ color: 'var(--primary)', fontSize: 22 }} />
          <span className="text-base font-bold tracking-[0.15em] uppercase font-headline" style={{ color: 'var(--on-surface)' }}>TokenFlow</span>
        </div>
        <div className="nav-pills">
          {NAV_ITEMS.map((item) => (
            <button key={item.id} onClick={() => setPage(item.id)} className={`nav-pill ${page === item.id ? 'active' : ''}`}>
              {item.label}
              {item.badgeKey === 'alerts' && alertCount > 0 && <span className="badge-dot" />}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleRefresh} disabled={busyAction === 'refresh'} className="btn-ghost" style={{ padding: '0.4rem 0.8rem', fontSize: '0.65rem' }}>
            <RefreshCcw className="h-3 w-3" /> Sync
          </button>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{
              background: socketState === 'live' ? 'var(--success)' : 'var(--error)',
              boxShadow: socketState === 'live' ? '0 0 6px var(--success)' : '0 0 6px var(--error)',
              animation: socketState === 'live' ? 'pulse-subtle 2s infinite' : 'none',
            }} />
            <span className="text-[9px] font-bold uppercase tracking-widest font-mono" style={{ color: 'var(--on-surface-variant)' }}>{socketState}</span>
          </div>
        </div>
      </nav>

      <AnimatePresence>
        {(notice || error) && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            className={`toast ${error ? 'toast-error' : 'toast-info'}`}>
            <div className="flex items-center gap-2">
              <M icon={error ? 'error' : 'check_circle'} style={{ fontSize: 16 }} />
              {error || notice}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="main-wrap">
        {page === 'landing' && (
          <LiveStatusRail
            signals={statusSignals}
            tickerItems={tickerItems}
            pulseIndex={pulseIndex}
            onNavigate={setPage}
            collapsed={statusRailCollapsed}
            onToggle={() => setStatusRailCollapsed((value) => !value)}
          />
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={page}
            className="page-stage"
            initial={{ opacity: 0, y: 16, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.99 }}
            transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
          >
            {page === 'landing' && <LandingPage key="landing" onEnter={setPage} />}
            {page === 'dashboard' && (
              <DashboardPage
                key="d"
                workflows={workflows}
                reviewQueue={reviewQueue}
                credentials={credentials}
                health={health}
                currentWorkflow={currentWorkflow}
                chainNodes={chainNodes}
                audit={audit}
                socketState={socketState}
                onKill={() => handleKill(currentWorkflow?.id)}
                busyAction={busyAction}
                goToChain={goToChain}
                setPage={setPage}
              />
            )}
            {page === 'chain' && <ChainPage key="c" workflows={workflows} chainNodes={chainNodes} currentWorkflow={currentWorkflow} selectedWorkflowId={selectedWorkflowId} setSelectedWorkflowId={setSelectedWorkflowId} audit={audit} onKill={() => handleKill(currentWorkflow?.id)} busyAction={busyAction} />}
            {page === 'audit' && <AuditPage key="a" audit={audit} />}
            {page === 'security' && <SecurityPage key="s" currentReview={currentReview} reviewQueue={reviewQueue} workflows={workflows} onResume={handleResume} onRevoke={handleRevoke} busyAction={busyAction} />}
            {page === 'vault' && <VaultPage key="v" credentials={credentials} health={health} />}
            {page === 'launch' && <LaunchPage key="l" tasks={tasks} selectedTask={selectedTask} setSelectedTask={setSelectedTask} onStart={handleStart} busyAction={busyAction} />}
            {page === 'testbench' && <TestbenchPage key="tb" />}
            {page === 'upload' && <UploadPage key="up" setPage={setPage} />}
            {page === 'incident' && <IncidentPage key="inc" />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function LiveStatusRail({ signals, tickerItems, pulseIndex, onNavigate, collapsed, onToggle }) {
  const toneMap = {
    primary: ['var(--primary)', 'rgba(196, 192, 255, 0.14)'],
    secondary: ['var(--secondary)', 'rgba(166, 230, 255, 0.12)'],
    success: ['var(--success)', 'rgba(52, 211, 153, 0.12)'],
    warning: ['var(--warning)', 'rgba(251, 191, 36, 0.12)'],
    danger: ['var(--error)', 'rgba(255, 180, 171, 0.14)'],
    neutral: ['var(--outline)', 'rgba(145, 143, 161, 0.1)'],
  };

  const activeAlert = signals.find((signal) => signal.tone === 'danger');
  const summary = activeAlert
    ? activeAlert.value
    : signals[0]?.value || 'Mission telemetry ready';

  return (
    <div className="status-rail-wrap">
      <div className="status-rail">
        <div className="status-rail-header">
          <div>
            <p className="status-rail-kicker">Live Mission Status</p>
            <p className="status-rail-summary">{summary}</p>
          </div>
          <button
            type="button"
            className="status-rail-toggle"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand live mission status' : 'Collapse live mission status'}
          >
            <span>{collapsed ? 'Expand' : 'Collapse'}</span>
            <M icon={collapsed ? 'expand_more' : 'expand_less'} style={{ fontSize: 18 }} />
          </button>
        </div>

        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              key="status-rail-body"
              className="status-rail-body"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="status-rail-grid">
                {signals.map((signal, index) => {
                  const [accent, tint] = toneMap[signal.tone] || toneMap.neutral;
                  const isActive = index === pulseIndex % signals.length;
                  return (
                    <motion.button
                      key={signal.label}
                      type="button"
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.99 }}
                      onClick={() => signal.page && onNavigate(signal.page)}
                      className={`status-card ${isActive ? 'is-active' : ''}`}
                      style={{ '--signal-accent': accent, '--signal-tint': tint }}
                    >
                      <div className="status-card-top">
                        <span className="status-card-label">{signal.label}</span>
                        <span className="status-card-icon"><M icon={signal.msym} style={{ fontSize: 16, color: accent }} /></span>
                      </div>
                      <strong className="status-card-value">{signal.value}</strong>
                      <span className="status-card-meta">{signal.meta}</span>
                    </motion.button>
                  );
                })}
              </div>

              <div className="status-ticker" aria-hidden="true">
                <div className="ticker-track">
                  {[...tickerItems, ...tickerItems].map((item, index) => (
                    <span key={`${item}-${index}`} className="ticker-pill">{item}</span>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {collapsed && (
          <div className="status-rail-collapsed-strip" aria-hidden="true">
            {signals.slice(0, 3).map((signal) => (
              <span key={signal.label} className="status-collapsed-pill">
                <M icon={signal.msym} style={{ fontSize: 13 }} />
                {signal.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PAGE: Dashboard
   ═══════════════════════════════════════════════════════════ */
function DashboardPage({ workflows, reviewQueue, credentials, health, currentWorkflow, chainNodes, audit, socketState, onKill, busyAction, setPage, goToChain }) {
  const totalTokens = workflows.reduce((s, w) => s + Object.values(w.token_summary || {}).reduce((a, b) => a + b, 0), 0);
  const burnedTokens = workflows.reduce((s, w) => s + (w.token_summary?.burned || 0), 0);
  const liveNodes = chainNodes.length ? chainNodes : STEP_ORDER.map((action, index) => ({ id: `preview-${action}-${index}`, action, status: 'pending', token: null }));
  const recentEvents = audit.slice(-4).reverse();
  const progress = chainNodes.length ? Math.round((chainNodes.filter((node) => node.status === 'burned').length / chainNodes.length) * 100) : 0;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <section className="hero-grid mb-8">
        <div className="hero-section hero-stage text-center md:text-left relative">
          <div className="hero-copy relative z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full mb-6" style={{ background: 'rgba(20, 209, 255, 0.08)', border: '1px solid rgba(166, 230, 255, 0.2)' }}>
              <span className="w-2 h-2 rounded-full animate-pulse-subtle" style={{ background: 'var(--secondary)' }} />
              <span className="text-[10px] font-bold tracking-[0.2em] uppercase" style={{ color: 'var(--secondary)' }}>Protocol Active</span>
            </div>
            <h1 className="font-headline text-4xl md:text-6xl font-bold tracking-tighter mb-5 leading-tight" style={{ color: 'var(--on-surface)' }}>
              Secure AI Agents<br /><span style={{ color: 'var(--primary)', fontStyle: 'italic' }}>Before They Act</span>
            </h1>
            <p className="text-sm md:text-base max-w-xl md:mx-0 mx-auto mb-8 leading-relaxed" style={{ color: 'var(--on-surface-variant)' }}>
              Every agent action is restricted by a single-use capability token. Cross-service access is blocked. Credentials never leave the vault.
            </p>
            <div className="flex flex-wrap justify-center md:justify-start gap-3 mb-8">
              <button onClick={() => setPage('launch')} className="btn-primary"><M icon="play_arrow" style={{ fontSize: 18 }} /> Launch Execution</button>
              <button onClick={() => setPage('chain')} className="btn-ghost"><M icon="token" style={{ fontSize: 18 }} /> View Protocol</button>
            </div>

            <div className="hero-flow-strip">
              {liveNodes.map((node, index) => {
                const meta = STEP_META[node.action] || {};
                const tone = node.status === 'flagged' || node.status === 'revoked'
                  ? 'var(--error)'
                  : node.status === 'burned'
                    ? 'var(--success)'
                    : node.status === 'active'
                      ? 'var(--secondary)'
                      : 'var(--outline)';

                return (
                  <motion.div
                    key={node.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.08 * index }}
                    className="hero-phase-chip"
                  >
                    <span className="hero-phase-index" style={{ color: tone }}>{meta.phase || String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <p className="hero-phase-title">{meta.label || node.action}</p>
                      <p className="hero-phase-meta" style={{ color: tone }}>{node.status}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="ops-panel card">
          <div className="flex items-start justify-between gap-3 mb-5">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--secondary)' }}>Live Control Room</p>
              <h3 className="font-headline text-2xl font-bold mt-2">Mission status stays visible while the chain moves.</h3>
            </div>
            <div className="ops-live-pill">
              <span className="w-2 h-2 rounded-full animate-pulse-subtle" style={{ background: socketState === 'live' ? 'var(--success)' : 'var(--warning)' }} />
              {socketState}
            </div>
          </div>

          <div className="signal-grid mb-5">
            <SignalMetric label="Current chain" value={`${progress}%`} hint={currentWorkflow ? 'burned through execution' : 'waiting for a workflow'} tone={progress === 100 ? 'success' : 'primary'} msym="token" />
            <SignalMetric label="Review pressure" value={reviewQueue.length ? `${reviewQueue.length} queued` : '0 queued'} hint={reviewQueue.length ? 'manual intervention required' : 'no pending intercepts'} tone={reviewQueue.length ? 'danger' : 'success'} msym="shield" />
            <SignalMetric label="Vault mode" value={health?.auth0 ? String(health.auth0).toUpperCase() : 'ONLINE'} hint={`${credentials.length} secrets remain backend only`} tone="secondary" msym="lock" />
            <SignalMetric label="Execution state" value={currentWorkflow?.status || 'idle'} hint={currentWorkflow ? currentWorkflow.id.slice(0, 14) : 'select Launch to start'} tone={currentWorkflow?.status === 'paused' ? 'warning' : 'neutral'} msym="hub" />
          </div>

          <div className="ops-stream mb-5">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold uppercase tracking-[0.12em]">Recent transmission</h4>
              <span className="text-[10px] font-mono" style={{ color: 'var(--outline)' }}>{recentEvents.length ? `${recentEvents.length} live events` : 'awaiting activity'}</span>
            </div>
            {recentEvents.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>Launch a workflow and this panel will fill with token lifecycle events in real time.</p>
            ) : (
              <div className="space-y-2">
                {recentEvents.map((entry) => (
                  <StreamRow key={`${entry.id}-${entry.timestamp}`} entry={entry} />
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <button onClick={() => currentWorkflow ? goToChain(currentWorkflow.id) : setPage('launch')} className="btn-primary">
              <M icon="north_east" style={{ fontSize: 16 }} /> {currentWorkflow ? 'Open Active Chain' : 'Launch First Chain'}
            </button>
            <button onClick={() => setPage('security')} className="btn-ghost">
              <M icon="policy" style={{ fontSize: 16 }} /> Review Security
            </button>
            {currentWorkflow && (
              <button onClick={onKill} disabled={busyAction === 'kill'} className="btn-danger">
                <M icon="local_fire_department" style={{ fontSize: 16 }} /> {busyAction === 'kill' ? 'Halting...' : 'Kill Switch'}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <MetricCard label="Workflows" value={workflows.length} msym="hub" color="primary" sub="Execution chains" delay={0} />
        <MetricCard label="Intercepts" value={reviewQueue.length} msym="shield" color="error" sub="Flagged for review" delay={1} />
        <MetricCard label="Tokens" value={totalTokens} msym="key_visualizer" color="secondary" sub={`${burnedTokens} burned`} delay={2} />
        <MetricCard label="Credentials" value={credentials.length} msym="lock" color="success" sub="Isolated services" delay={3} />
      </div>

      {/* Bento Feature Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {/* Main Feature */}
        <div className="card p-8 relative overflow-hidden group md:col-span-2">
          <div className="absolute top-0 right-0 p-6 opacity-15 group-hover:opacity-40 transition-opacity duration-500">
            <M icon="verified_user" style={{ fontSize: 56, color: 'var(--secondary)' }} />
          </div>
          <h3 className="text-xl font-bold mb-3 font-headline" style={{ color: 'var(--on-surface)' }}>Capability-Based Security</h3>
          <p className="text-sm leading-relaxed max-w-xl" style={{ color: 'var(--on-surface-variant)' }}>
            Limit AI agents to specific resources using granular permission keys that expire after single execution. Each token is cryptographically bound to one action on one service.
          </p>
        </div>

        {/* Token Flow */}
        <div className="card p-8 group">
          <div className="flex items-center gap-4 mb-5">
            <div className="p-3 rounded-xl" style={{ background: 'rgba(196, 192, 255, 0.1)' }}>
              <M icon="key_visualizer" style={{ color: 'var(--primary)', fontSize: 22 }} />
            </div>
            <h3 className="text-lg font-bold font-headline">Token Flow</h3>
          </div>
          <p className="text-sm mb-5" style={{ color: 'var(--on-surface-variant)' }}>Every action requires a signed cryptographic token before reaching the service provider.</p>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: '66%' }} />
          </div>
        </div>

        {/* Credential Isolation */}
        <div className="card p-8">
          <M icon="terminal" style={{ color: 'var(--secondary-container)', fontSize: 32 }} className="mb-4" />
          <h3 className="text-lg font-bold mb-2 font-headline">Credential Isolation</h3>
          <p className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>Your API keys never touch the runtime environment of the AI agent.</p>
        </div>
      </div>

      {/* Kill Switch + Active Workflows */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {/* Kill Switch Card */}
        <div className="card-high p-8 relative" style={{ borderColor: 'rgba(255, 180, 171, 0.2)' }}>
          <div className="absolute top-4 right-4">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-[0.15em]" style={{ background: 'rgba(255, 180, 171, 0.1)', color: 'var(--error)' }}>
              {currentWorkflow ? 'Armed' : 'Standby'}
            </span>
          </div>
          <M icon="local_fire_department" style={{ color: 'var(--error)', fontSize: 32 }} className="mb-4" />
          <h3 className="text-lg font-bold mb-2 font-headline">Kill Switch</h3>
          <p className="text-sm mb-5" style={{ color: 'var(--on-surface-variant)' }}>Instantly sever all AI connections with a single hardware-backed command.</p>
          <button onClick={currentWorkflow ? onKill : () => setPage('launch')} disabled={currentWorkflow && busyAction === 'kill'} className="btn-danger">
            <M icon="local_fire_department" style={{ fontSize: 16 }} /> {currentWorkflow ? (busyAction === 'kill' ? 'Halting...' : 'Abort Current Chain') : 'Queue a Workflow'}
          </button>
        </div>

        {/* Active workflows */}
        <div className="card p-6 md:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--on-surface)' }}>Active Workflows</h3>
            <button onClick={() => setPage('chain')} className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1 transition-all hover:gap-2" style={{ color: 'var(--primary)' }}>
              View all <ChevronRight className="h-3 w-3" /></button>
          </div>
          {workflows.length === 0 ? (
            <EmptyState msym="hub" text="No workflows yet. Launch a task to begin." action="Launch" onAction={() => setPage('launch')} />
          ) : (
            <div className="space-y-2">
              {workflows.slice(0, 5).map((w) => (
                <motion.div key={w.id} whileHover={{ x: 4 }} className="flex items-center gap-4 p-3 rounded-xl card-interactive"
                  style={{ background: 'var(--surface-container-high)', border: '1px solid rgba(70,69,85,0.12)', cursor: 'pointer' }}
                  onClick={() => goToChain(w.id)}>
                  <div className="p-2 rounded-lg" style={{ background: 'rgba(196,192,255,0.1)' }}>
                    <M icon="hub" style={{ color: 'var(--primary)', fontSize: 16 }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate" style={{ color: 'var(--on-surface)' }}>{w.name}</p>
                    <p className="text-[10px] font-mono" style={{ color: 'var(--on-surface-variant)' }}>{w.id}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill status={w.status} />
                    <ChevronRight className="h-3 w-3" style={{ color: 'var(--outline)' }} />
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* The Protocol — Vertical Steps */}
      <section className="mb-8">
        <h2 className="font-headline text-2xl font-bold text-center mb-2">The TokenFlow Protocol</h2>
        <div className="w-10 h-1 rounded-full mx-auto mb-10" style={{ background: 'var(--secondary)' }} />
        <div className="timeline max-w-2xl mx-auto">
          {[
            { phase: '01', title: 'Request Origin', desc: 'The AI agent initiates an action request to the internal gateway.', color: 'var(--primary)', msym: 'hub' },
            { phase: '02', title: 'Token Validation', desc: 'Protocol validates the request against capability policies and mints an execution token.', color: 'var(--secondary)', msym: 'token' },
            { phase: '03', title: 'Secure Execution', desc: 'Action is performed within a hardened sandbox using the ephemeral token.', color: 'var(--primary-container)', msym: 'play_arrow' },
            { phase: '04', title: 'Token Burn', desc: 'Token is cryptographically shredded, ensuring the action cannot be replayed.', color: 'var(--error)', msym: 'local_fire_department' },
          ].map((step, i) => (
            <motion.div key={step.phase} className="timeline-node" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.15 }}>
              <div className="timeline-dot" style={{ borderColor: step.color }}>
                <div className="ping" style={{ background: step.color }} />
              </div>
              <div className="card p-6" style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.3)' }}>
                <span className="text-[10px] font-bold tracking-[0.2em] uppercase block mb-2" style={{ color: step.color }}>Phase {step.phase}</span>
                <h4 className="text-base font-bold mb-1 font-headline">{step.title}</h4>
                <p className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>{step.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </section>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PAGE: Token Chain
   ═══════════════════════════════════════════════════════════ */
function ChainPage({ chainNodes, currentWorkflow, workflows, selectedWorkflowId, setSelectedWorkflowId, audit, onKill, busyAction }) {
  const burnedCount = chainNodes.filter(n => n.status === 'burned').length;
  const flaggedCount = chainNodes.filter(n => n.status === 'flagged').length;
  const liveCount = chainNodes.filter((n) => n.status === 'active' || n.status === 'pending').length;
  const total = chainNodes.length || 1;
  const progress = Math.round((burnedCount / total) * 100);
  const recentEvents = audit.slice(-4).reverse();

  // Build CLI log lines from chain nodes + audit
  const cliLines = [];
  cliLines.push({ type: 'cmd', text: `tokenflow chain --workflow ${currentWorkflow?.id?.slice(0, 20) || 'none'} --live` });
  cliLines.push({ type: 'out', text: `Agent: agent-cloud-worker  |  Task: ${currentWorkflow?.name || 'N/A'}` });
  cliLines.push({ type: 'muted', text: '─'.repeat(48) });
  chainNodes.forEach((node, i) => {
    const meta = STEP_META[node.action] || {};
    if (node.status === 'burned') cliLines.push({ type: 'success', text: `[${String(i+1).padStart(2,'0')}] ✓  ${meta.label || node.action}  →  BURNED  (${fmtTime(node.mintedAt)})` });
    else if (node.status === 'flagged' || node.status === 'revoked') cliLines.push({ type: 'error', text: `[${String(i+1).padStart(2,'0')}] ✗  ${meta.label || node.action}  →  BLOCKED  [UNAUTHORIZED]` });
    else if (node.status === 'active') cliLines.push({ type: 'success', text: `[${String(i+1).padStart(2,'0')}] ●  ${meta.label || node.action}  →  EXECUTING...` });
    else cliLines.push({ type: 'muted', text: `[${String(i+1).padStart(2,'0')}] ○  ${meta.label || node.action}  →  PENDING` });
  });
  if (flaggedCount > 0) {
    cliLines.push({ type: 'muted', text: '─'.repeat(48) });
    cliLines.push({ type: 'error', text: '⚠  SECURITY VIOLATION DETECTED — workflow paused for review' });
    cliLines.push({ type: 'warn', text: '   Unauthorized cross-service access attempt intercepted.' });
  } else if (burnedCount === total && total > 0) {
    cliLines.push({ type: 'muted', text: '─'.repeat(48) });
    cliLines.push({ type: 'success', text: '✓  All tokens burned. Execution chain complete.' });
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      {/* Workflow Selector */}
      {workflows.length > 1 && (
        <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
          <span className="text-[9px] font-bold uppercase tracking-widest flex-shrink-0" style={{ color: 'var(--outline)' }}>Workflow:</span>
          {workflows.map(w => (
            <button key={w.id} onClick={() => setSelectedWorkflowId(w.id)}
              className="flex-shrink-0 px-3 py-1.5 rounded-xl text-[10px] font-bold font-mono transition-all"
              style={{
                background: w.id === selectedWorkflowId ? 'rgba(196,192,255,0.15)' : 'var(--surface-container-high)',
                border: w.id === selectedWorkflowId ? '1px solid rgba(196,192,255,0.35)' : '1px solid rgba(70,69,85,0.15)',
                color: w.id === selectedWorkflowId ? 'var(--primary)' : 'var(--on-surface-variant)',
              }}>
              {w.name ? w.name.slice(0, 24) + (w.name.length > 24 ? '…' : '') : w.id.slice(0, 18) + '…'} <StatusPill status={w.status} small />
            </button>
          ))}
          <button
            onClick={() => { setSelectedWorkflowId(null); }}
            className="flex-shrink-0 px-2.5 py-1.5 rounded-xl text-[10px] font-bold transition-all flex items-center gap-1"
            style={{
              background: 'rgba(255,180,171,0.08)',
              border: '1px solid rgba(255,180,171,0.2)',
              color: 'var(--error)',
            }}
            title="Clear workflow selector"
          >
            <M icon="close" style={{ fontSize: 12 }} /> Clear
          </button>
        </div>
      )}

      {/* Header */}
      <div className="card-glow-primary p-6 mb-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h3 className="text-lg font-bold font-headline">{currentWorkflow?.name || 'No Active Workflow'}</h3>
              {currentWorkflow && <StatusPill status={currentWorkflow.status} />}
            </div>
            <p className="text-xs font-mono" style={{ color: 'var(--on-surface-variant)' }}>{currentWorkflow?.id || '—'} • Agent: agent-cloud-worker</p>
          </div>
          {currentWorkflow && (
            <button onClick={onKill} disabled={!currentWorkflow || busyAction === 'kill'} className="btn-danger animate-glow">
              <M icon="local_fire_department" style={{ fontSize: 16 }} /> {busyAction === 'kill' ? 'Halting…' : 'Kill Switch'}
            </button>
          )}
        </div>
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--on-surface-variant)' }}>Chain Progress</span>
            <span className="text-xs font-bold font-mono">{progress}%</span>
          </div>
          <div className="progress-track">
            <div className={`progress-fill ${flaggedCount > 0 ? 'danger' : ''}`} style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      <div className="signal-grid mb-5">
        <SignalMetric label="Burned tokens" value={String(burnedCount).padStart(2, '0')} hint="single-use steps already completed" tone="success" msym="local_fire_department" />
        <SignalMetric label="Live steps" value={String(liveCount).padStart(2, '0')} hint="pending or executing right now" tone={liveCount ? 'primary' : 'neutral'} msym="bolt" />
        <SignalMetric label="Blocked steps" value={String(flaggedCount).padStart(2, '0')} hint={flaggedCount ? 'workflow diverted to review' : 'no violations in this chain'} tone={flaggedCount ? 'danger' : 'success'} msym="shield" />
        <SignalMetric label="Recent events" value={String(recentEvents.length).padStart(2, '0')} hint={recentEvents[0] ? recentEvents[0].event_type.toLowerCase() : 'waiting for audit activity'} tone="secondary" msym="history" />
      </div>

      <div className="grid gap-5 md:grid-cols-2 mb-5">
        {/* Vertical Token Chain */}
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-1">
            <M icon="token" style={{ color: 'var(--primary)', fontSize: 18 }} />
            <h3 className="text-sm font-bold uppercase tracking-[0.1em] font-headline">Live Token Chain</h3>
          </div>
          <p className="text-xs mb-6" style={{ color: 'var(--on-surface-variant)' }}>Single-use capability tokens • execution DAG</p>
          <div className="timeline">
            {chainNodes.map((node, idx) => {
              const meta = STEP_META[node.action] || {};
              const isError = node.action === 'READ_REPO';
              const dotClass = node.status === 'burned' ? 'burned' : node.status === 'flagged' || node.status === 'revoked' ? 'flagged' : node.status === 'active' ? 'active' : 'idle';
              return (
                <motion.div key={node.id} className="timeline-node" initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.1, duration: 0.35 }}>
                  <div className={`timeline-dot ${dotClass}`}><div className="ping" /></div>
                  <div className="card p-4" style={isError ? { borderColor: 'rgba(255,180,171,0.3)' } : {}}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[9px] font-bold tracking-[0.2em] uppercase" style={{ color: isError ? 'var(--error)' : 'var(--primary)' }}>Phase {meta.phase || '??'}</span>
                      <StatusPill status={node.status} small />
                    </div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="p-1.5 rounded-lg" style={{ background: isError ? 'rgba(255,180,171,0.1)' : 'rgba(196,192,255,0.08)' }}>
                        <M icon={meta.msym || 'help'} style={{ fontSize: 15, color: isError ? 'var(--error)' : 'var(--primary)' }} />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold font-headline" style={{ color: isError ? 'var(--error)' : 'var(--on-surface)' }}>{meta.label || node.action}</h4>
                        <p className="text-[9px]" style={{ color: 'var(--on-surface-variant)' }}>{meta.service}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[9px]" style={{ color: 'var(--outline)' }}>{node.token?.id?.slice(0, 14) || '—'}</span>
                      {node.mintedAt && <span className="text-[9px]" style={{ color: 'var(--outline)' }}>{fmtTime(node.mintedAt)}</span>}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* CLI Terminal */}
        <div className="flex flex-col gap-4">
          <div className="cli-terminal flex-1">
            <div className="cli-titlebar">
              <span className="cli-dot cli-dot-red" />
              <span className="cli-dot cli-dot-yellow" />
              <span className="cli-dot cli-dot-green" />
              <span className="cli-titlebar-label">tokenflow-cli v2.0 — execution log</span>
            </div>
            <div className="cli-body">
              {cliLines.map((line, i) => (
                <div key={i} className={`cli-${line.type}`}>
                  {line.type === 'cmd' && <><span className="cli-prompt">$</span> <span className="cli-cmd">{line.text}</span></>}
                  {line.type !== 'cmd' && line.text}
                </div>
              ))}
              <div className="cli-out" style={{ marginTop: 4 }}><span className="cli-cursor" /></div>
            </div>
          </div>
          {currentWorkflow && (
            <div className="grid grid-cols-1 gap-3">
              <InfoCard label="Workflow ID" value={currentWorkflow.id} msym="hub" />
              <InfoCard label="Workflow" value={currentWorkflow.name || 'Unnamed Workflow'} msym="assignment" />
            </div>
          )}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold uppercase tracking-[0.12em]">Recent Transmissions</h4>
              <span className="text-[10px] font-mono" style={{ color: 'var(--outline)' }}>{recentEvents.length ? `${recentEvents.length} events` : 'idle'}</span>
            </div>
            {recentEvents.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>Audit telemetry will appear here once this chain starts moving.</p>
            ) : (
              <div className="space-y-2">
                {recentEvents.map((entry) => (
                  <StreamRow key={`${entry.id}-${entry.timestamp}`} entry={entry} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PAGE: Audit Log
   ═══════════════════════════════════════════════════════════ */
function AuditPage({ audit }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="card p-6">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <M icon="history" style={{ color: 'var(--primary)', fontSize: 18 }} />
            <h3 className="text-sm font-bold uppercase tracking-[0.1em] font-headline">Audit Log</h3>
          </div>
          <span className="text-[10px] font-mono" style={{ color: 'var(--outline)' }}>{audit.length} events</span>
        </div>
        <p className="text-xs mb-6" style={{ color: 'var(--on-surface-variant)' }}>Immutable token lifecycle events</p>
        {audit.length === 0 ? (
          <EmptyState msym="history" text="Audit events appear once a workflow runs." />
        ) : (
          <div className="space-y-2 max-h-[calc(100vh-260px)] overflow-auto pr-1">
            {audit.map((entry, idx) => (
              <motion.div key={`${entry.id}-${entry.timestamp}`} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.02 }}
                className="flex items-start gap-4 p-4 rounded-xl" style={{ background: 'var(--surface-container-high)', border: '1px solid rgba(70,69,85,0.1)' }}>
                <EventIcon type={entry.event_type} />
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: evtColor(entry.event_type) }}>{entry.event_type}</span>
                  <p className="text-sm mt-0.5" style={{ color: 'var(--on-surface)' }}>{describeAudit(entry)}</p>
                  <p className="mt-1 font-mono text-[10px]" style={{ color: 'var(--outline)' }}>{entry.token_id}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[10px]" style={{ color: 'var(--on-surface-variant)' }}>{fmtTime(entry.timestamp)}</p>
                  <p className="font-mono text-[9px] uppercase tracking-widest mt-0.5" style={{ color: 'var(--outline)' }}>{entry.actor}</p>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PAGE: Security Review — Audit Log
   ═══════════════════════════════════════════════════════════ */
function SecurityPage({ currentReview, reviewQueue, workflows, onResume, onRevoke, busyAction }) {
  const hasWorkflows = workflows && workflows.length > 0;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      {/* Page Header */}
      <div className="card p-6 mb-6 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5" style={{ background: 'radial-gradient(circle at 80% 50%, var(--error), transparent 60%)' }} />
        <div className="relative flex items-center gap-4">
          <div className="p-3 rounded-2xl" style={{ background: 'rgba(255,180,171,0.1)', boxShadow: '0 0 20px rgba(255,180,171,0.08)' }}>
            <M icon="shield" style={{ color: 'var(--error)', fontSize: 28 }} />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold font-headline">Security Audit Log</h3>
            <p className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>Tracks all workflow executions, security violations, flagged tokens, and kill switch activations across your environment.</p>
          </div>
          {reviewQueue.length > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold" style={{ background: 'rgba(255,80,80,0.1)', color: 'var(--error)', border: '1px solid rgba(255,180,171,0.2)' }}>
              <span className="w-2 h-2 rounded-full animate-pulse-subtle" style={{ background: 'var(--error)' }} />
              {reviewQueue.length} Alert{reviewQueue.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Active Review Alert */}
      {currentReview && (
        <div className="space-y-4 mb-6">
          <div className="security-alert-card">
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-4">
                <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: 2.5 }}
                  className="p-3 rounded-2xl flex-shrink-0" style={{ background: 'rgba(255,80,80,0.15)', border: '1px solid rgba(255,180,171,0.3)' }}>
                  <M icon="gpp_bad" style={{ color: 'var(--error)', fontSize: 32 }} />
                </motion.div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-block px-2.5 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-[0.15em]" style={{ background: 'rgba(255,80,80,0.15)', color: 'var(--error)', border: '1px solid rgba(255,180,171,0.3)' }}>⚠ Security Violation</span>
                  </div>
                  <h3 className="text-xl font-bold font-headline" style={{ color: 'var(--on-surface)' }}>{currentReview.workflowName}</h3>
                </div>
              </div>
              <div className="p-4 rounded-xl font-mono text-xs leading-relaxed" style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,180,171,0.1)', color: 'rgba(199,196,216,0.8)' }}>
                <span style={{ color: 'rgba(255,180,171,0.6)' }}>ALERT </span>
                {currentReview.review?.summary || 'Unauthorized action detected. Manual intervention required.'}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="card-glow-error p-5">
              <div className="flex items-center gap-2 mb-2">
                <M icon="dns" style={{ fontSize: 13, color: 'var(--error)' }} />
                <p className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--error)' }}>Attempted Service</p>
              </div>
              <p className="text-sm font-bold font-mono" style={{ color: 'var(--error)' }}>{currentReview.review?.attempted_service || 'n/a'}</p>
            </div>
            <div className="card-glow-error p-5">
              <div className="flex items-center gap-2 mb-2">
                <M icon="search" style={{ fontSize: 13, color: 'var(--error)' }} />
                <p className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--error)' }}>Attempted Resource</p>
              </div>
              <p className="text-sm font-bold font-mono" style={{ color: 'var(--error)' }}>{currentReview.review?.attempted_resource || 'n/a'}</p>
            </div>
            <DetailCard label="Attempted Action" value={currentReview.review?.attempted_action || 'n/a'} msym="bolt" />
            <DetailCard label="Task" value={currentReview.review?.taskData?.name || currentReview.task?.name || 'n/a'} msym="assignment" />
          </div>

          {(currentReview.review?.violations || []).length > 0 && (
            <div className="card p-5">
              <h4 className="text-sm font-bold uppercase tracking-[0.1em] mb-4 flex items-center gap-2">
                <M icon="warning" style={{ color: 'var(--warning)', fontSize: 16 }} /> Violations Detected
              </h4>
              <div className="space-y-2">
                {(currentReview.review?.violations || []).map((v, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }}
                    className="violation-card">
                    <p className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--error)' }}>{v.type}</p>
                    <p className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>{v.message}</p>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => onResume(currentReview.workflowId)} disabled={busyAction === 'resume'} className="btn-success flex-1">
              <M icon="check_circle" style={{ fontSize: 16 }} /> {busyAction === 'resume' ? 'Resuming…' : 'Override & Resume'}
            </button>
            <button onClick={() => onRevoke(currentReview.workflowId)} disabled={busyAction === 'revoke'} className="btn-danger flex-1">
              <M icon="cancel" style={{ fontSize: 16 }} /> {busyAction === 'revoke' ? 'Revoking…' : 'Revoke & Abort'}
            </button>
          </div>
        </div>
      )}

      {/* Workflow Audit Log — shows all tracked workflows */}
      {hasWorkflows ? (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <M icon="history" style={{ color: 'var(--primary)', fontSize: 18 }} />
              <h3 className="text-sm font-bold uppercase tracking-[0.1em] font-headline">Workflow Audit Trail</h3>
            </div>
            <span className="text-[10px] font-mono" style={{ color: 'var(--outline)' }}>{workflows.length} workflow{workflows.length !== 1 ? 's' : ''} recorded</span>
          </div>
          <p className="text-xs mb-6" style={{ color: 'var(--on-surface-variant)' }}>Complete log of all workflows with status, timestamps, and security events.</p>

          {/* Table Header */}
          <div className="grid gap-3" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 0.8fr' }}>
            <div className="px-3 py-2">
              <span className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--outline)' }}>Workflow</span>
            </div>
            <div className="px-3 py-2">
              <span className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--outline)' }}>Status</span>
            </div>
            <div className="px-3 py-2">
              <span className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--outline)' }}>Started</span>
            </div>
            <div className="px-3 py-2">
              <span className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--outline)' }}>Last Updated</span>
            </div>
            <div className="px-3 py-2">
              <span className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--outline)' }}>Tokens</span>
            </div>
          </div>

          <div className="space-y-2 max-h-[calc(100vh-420px)] overflow-auto pr-1">
            {workflows.map((w, idx) => {
              const tokenSummary = w.token_summary || {};
              const totalTokens = Object.values(tokenSummary).reduce((a, b) => a + b, 0);
              const hasFlagged = tokenSummary.flagged > 0;
              const hasRevoked = tokenSummary.revoked > 0;
              const isAborted = w.status === 'aborted';
              const isPaused = w.status === 'paused';
              const statusColor = isAborted || hasFlagged || hasRevoked ? 'var(--error)' : isPaused ? 'var(--warning)' : w.status === 'completed' ? 'var(--success)' : 'var(--primary)';
              const statusIcon = isAborted ? 'dangerous' : hasFlagged ? 'gpp_bad' : isPaused ? 'pause_circle' : w.status === 'completed' ? 'check_circle' : 'play_circle';

              return (
                <motion.div
                  key={w.id}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.04 }}
                  className="grid gap-3 items-center p-3 rounded-xl"
                  style={{
                    gridTemplateColumns: '2fr 1fr 1fr 1fr 0.8fr',
                    background: hasFlagged || isAborted ? 'rgba(255,180,171,0.04)' : 'var(--surface-container-high)',
                    border: hasFlagged || isAborted ? '1px solid rgba(255,180,171,0.15)' : '1px solid rgba(70,69,85,0.1)',
                  }}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold truncate" style={{ color: 'var(--on-surface)' }}>{w.name}</p>
                    <p className="text-[9px] font-mono mt-0.5" style={{ color: 'var(--outline)' }}>{w.id}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <M icon={statusIcon} style={{ fontSize: 14, color: statusColor }} />
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: statusColor }}>{w.status}</span>
                  </div>
                  <div>
                    <p className="text-[10px] font-mono" style={{ color: 'var(--on-surface-variant)' }}>{w.created_at ? fmtDateTime(w.created_at) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-mono" style={{ color: 'var(--on-surface-variant)' }}>{w.updated_at ? fmtDateTime(w.updated_at) : '—'}</p>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-bold">
                    {tokenSummary.burned > 0 && <span style={{ color: 'var(--success)' }}>{tokenSummary.burned}✓</span>}
                    {tokenSummary.flagged > 0 && <span style={{ color: 'var(--error)' }}>{tokenSummary.flagged}⚠</span>}
                    {tokenSummary.revoked > 0 && <span style={{ color: 'var(--error)' }}>{tokenSummary.revoked}✗</span>}
                    {totalTokens === 0 && <span style={{ color: 'var(--outline)' }}>—</span>}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Empty state — no launch button, just explanation */
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 p-4 rounded-2xl" style={{ background: 'var(--surface-container-high)' }}>
            <M icon="verified_user" style={{ fontSize: 28, color: 'var(--outline)' }} />
          </div>
          <h4 className="text-base font-bold font-headline mb-2" style={{ color: 'var(--on-surface)' }}>Security Audit Log</h4>
          <p className="text-sm max-w-md mb-3" style={{ color: 'var(--on-surface-variant)' }}>
            This tab displays a complete audit trail of all workflow executions across your TokenFlow environment.
          </p>
          <p className="text-xs max-w-md" style={{ color: 'var(--outline)' }}>
            When workflows are launched, each execution is logged here with timestamps, status changes, security violations, kill switch activations, and token lifecycle events. Start a workflow from the <strong style={{ color: 'var(--primary)' }}>Launch</strong> tab to begin populating this audit trail.
          </p>
        </div>
      )}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PAGE: Credential Vault
   ═══════════════════════════════════════════════════════════ */
function VaultPage({ credentials, health }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      {/* Vault Header */}
      <div className="card p-6 mb-6 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5" style={{ background: 'radial-gradient(circle at 80% 50%, var(--primary), transparent 60%)' }} />
        <div className="relative flex items-center gap-4">
          <div className="p-3 rounded-2xl" style={{ background: 'rgba(196,192,255,0.1)', boxShadow: '0 0 20px rgba(196,192,255,0.1)' }}>
            <M icon="lock" style={{ color: 'var(--primary)', fontSize: 28 }} />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold font-headline">Auth0 Token Vault</h3>
            <p className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>Agent never sees raw secrets — all access through vault proxy</p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold" style={{ background: 'rgba(52,211,153,0.1)', color: 'var(--success)', border: '1px solid rgba(52,211,153,0.2)' }}>
            <span className="w-2 h-2 rounded-full animate-pulse-subtle" style={{ background: 'var(--success)' }} /> Connected
          </span>
        </div>
      </div>

      {/* Credentials Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
        {credentials.map((cred, idx) => (
          <motion.div key={cred.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.08 }} className="card p-5 card-interactive">
            <div className="flex items-start justify-between mb-4">
              <div className="p-2.5 rounded-xl" style={{ background: cred.status === 'restricted' ? 'rgba(255,180,171,0.1)' : 'rgba(196,192,255,0.1)' }}>
                <M icon={cred.status === 'restricted' ? 'gpp_bad' : 'lock'} style={{ fontSize: 20, color: cred.status === 'restricted' ? 'var(--error)' : 'var(--primary)' }} />
              </div>
              <StatusPill status={cred.status === 'restricted' ? 'flagged' : 'burned'} label={cred.status} />
            </div>
            <h4 className="font-bold font-headline text-sm">{cred.display_name}</h4>
            <p className="text-[10px] mt-1 font-mono uppercase tracking-widest" style={{ color: 'var(--outline)' }}>{cred.connection_type}</p>
            <p className="text-[10px] mt-2 font-mono" style={{ color: 'var(--outline)' }}>{cred.service_name}</p>
            {cred.last_accessed && <p className="text-[10px] mt-2" style={{ color: 'var(--outline)' }}>Used: {fmtTime(cred.last_accessed)}</p>}
          </motion.div>
        ))}
      </div>

      {/* How Vault Works */}
      <div className="card p-6">
        <h4 className="text-sm font-bold uppercase tracking-[0.1em] font-headline mb-4">How Vault Protection Works</h4>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { step: '1', title: 'Token Scoped', desc: 'Execution token specifies which credential is needed', msym: 'key' },
            { step: '2', title: 'Vault Retrieves', desc: 'Backend requests credential from Auth0 Token Vault', msym: 'cloud_download' },
            { step: '3', title: 'Agent Uses, Never Sees', desc: 'Action executed via proxy — raw secret never exposed', msym: 'visibility_off' },
          ].map((s) => (
            <div key={s.step} className="flex gap-3 p-4 rounded-xl" style={{ background: 'var(--surface-container-high)', border: '1px solid rgba(70,69,85,0.1)' }}>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg flex-shrink-0" style={{ background: 'rgba(196,192,255,0.1)' }}>
                <span className="text-sm font-bold font-headline" style={{ color: 'var(--primary)' }}>{s.step}</span>
              </div>
              <div>
                <p className="text-sm font-bold font-headline">{s.title}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--on-surface-variant)' }}>{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PAGE: Launch Task
   ═══════════════════════════════════════════════════════════ */
function LaunchPage({ tasks, selectedTask, setSelectedTask, onStart, busyAction }) {
  const sel = tasks.find(t => t.id === selectedTask);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-10">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-container))', boxShadow: '0 0 30px rgba(196,192,255,0.2)' }}>
            <M icon="play_arrow" className="text-white" style={{ fontSize: 32, color: 'var(--on-primary)' }} />
          </div>
          <h2 className="text-2xl font-bold font-headline tracking-tight">Launch Agent Task</h2>
          <p className="text-sm mt-2" style={{ color: 'var(--on-surface-variant)' }}>Select a scenario and execute a secure, token-gated agent workflow</p>
        </div>

        <div className="space-y-3 mb-6">
          {tasks.map((t) => (
            <button key={t.id} onClick={() => setSelectedTask(t.id)}
              className="w-full text-left p-5 rounded-[2rem] transition-all"
              style={{
                background: t.id === selectedTask ? 'var(--surface-container)' : 'var(--surface-container-low)',
                border: t.id === selectedTask ? '2px solid rgba(196,192,255,0.4)' : '2px solid rgba(70,69,85,0.1)',
                boxShadow: t.id === selectedTask ? '0 0 20px rgba(196,192,255,0.08)' : 'none',
              }}>
              <div className="flex items-start gap-4">
                <div className="p-2.5 rounded-xl flex-shrink-0" style={{ background: t.malicious ? 'rgba(255,180,171,0.1)' : 'rgba(52,211,153,0.1)' }}>
                  <M icon={t.malicious ? 'gpp_bad' : 'verified_user'} style={{ fontSize: 20, color: t.malicious ? 'var(--error)' : 'var(--success)' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-sm font-bold font-headline">{t.name}</h4>
                    <span className="text-[8px] font-bold uppercase tracking-[0.15em] px-2 py-0.5 rounded" style={{
                      background: t.malicious ? 'rgba(255,180,171,0.1)' : 'rgba(52,211,153,0.1)',
                      color: t.malicious ? 'var(--error)' : 'var(--success)',
                    }}>{t.malicious ? 'Compromised' : 'Normal'}</span>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--on-surface-variant)' }}>{t.description}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(t.steps || []).map((s, i) => (
                      <span key={i} className="px-2 py-0.5 rounded text-[9px] font-mono font-medium" style={{ background: 'var(--surface-container-highest)', color: 'var(--on-surface-variant)' }}>{s.action}</span>
                    ))}
                    {t.malicious_step && <span className="px-2 py-0.5 rounded text-[9px] font-mono font-medium" style={{ background: 'rgba(255,180,171,0.1)', color: 'var(--error)' }}>⚠ {t.malicious_step.action}</span>}
                  </div>
                </div>
                <div className="flex h-5 w-5 items-center justify-center rounded-full flex-shrink-0 mt-1" style={{
                  border: `2px solid ${t.id === selectedTask ? 'var(--primary)' : 'var(--outline-variant)'}`,
                  background: t.id === selectedTask ? 'var(--primary)' : 'transparent',
                }}>
                  {t.id === selectedTask && <div className="h-2 w-2 rounded-full" style={{ background: 'var(--on-primary)' }} />}
                </div>
              </div>
            </button>
          ))}
        </div>

        <button onClick={onStart} disabled={busyAction === 'start'} className="btn-primary w-full py-4 text-sm" style={{ boxShadow: '0 0 30px rgba(196,192,255,0.3)' }}>
          <M icon="play_arrow" style={{ fontSize: 20 }} /> {busyAction === 'start' ? 'Starting Execution…' : 'Start Secure Execution'}
        </button>

        {sel && (
          <p className="text-center text-xs mt-4" style={{ color: 'var(--outline)' }}>
            {sel.malicious ? '⚠ Simulates a compromised agent attempting unauthorized cross-service access.' : '✓ Demonstrates a normal execution flow completing cleanly.'}
          </p>
        )}
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Shared Components
   ═══════════════════════════════════════════════════════════ */
function SignalMetric({ label, value, hint, tone = 'primary', msym = 'monitoring' }) {
  const toneMap = {
    primary: 'var(--primary)',
    secondary: 'var(--secondary)',
    success: 'var(--success)',
    warning: 'var(--warning)',
    danger: 'var(--error)',
    neutral: 'var(--outline)',
  };
  const color = toneMap[tone] || toneMap.primary;

  return (
    <div className="signal-metric">
      <div className="flex items-center justify-between mb-3">
        <span className="signal-metric-label">{label}</span>
        <span className="signal-metric-icon" style={{ color }}>
          <M icon={msym} style={{ fontSize: 15 }} />
        </span>
      </div>
      <p className="signal-metric-value">{value}</p>
      <p className="signal-metric-hint">{hint}</p>
      <div className="signal-metric-bar">
        <span style={{ background: color }} />
      </div>
    </div>
  );
}

function StreamRow({ entry }) {
  return (
    <div className="stream-row">
      <div className="stream-row-icon">
        <EventIcon type={entry.event_type} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="stream-row-label" style={{ color: evtColor(entry.event_type) }}>{entry.event_type}</p>
        <p className="stream-row-copy">{describeAudit(entry)}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="stream-row-time">{fmtTime(entry.timestamp)}</p>
        <p className="stream-row-actor">{entry.actor}</p>
      </div>
    </div>
  );
}

function MetricCard({ label, value, msym, color, sub, delay }) {
  const colorMap = { primary: 'var(--primary)', secondary: 'var(--secondary)', error: 'var(--error)', success: 'var(--success)' };
  const c = colorMap[color] || 'var(--primary)';
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: delay * 0.08 }} className="metric-card">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[8px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--on-surface-variant)' }}>{label}</span>
        <div className="p-1.5 rounded-lg" style={{ background: `color-mix(in srgb, ${c} 10%, transparent)` }}><M icon={msym} style={{ fontSize: 14, color: c }} /></div>
      </div>
      <p className="text-2xl font-bold font-headline">{String(value).padStart(2, '0')}</p>
      <p className="text-[10px] mt-1" style={{ color: 'var(--outline)' }}>{sub}</p>
    </motion.div>
  );
}

function StatusPill({ status, small, label }) {
  const display = label || status;
  const dotColor = { burned: 'var(--success)', completed: 'var(--success)', active: 'var(--primary)', running: 'var(--primary)', flagged: 'var(--error)', revoked: 'var(--error)', aborted: 'var(--error)', paused: 'var(--warning)' }[status] || 'var(--outline)';
  return (
    <span className={`pill pill-${status} ${small ? 'text-[8px] px-1.5 py-0' : ''}`}>
      <span className="dot" style={{ width: 5, height: 5, background: dotColor, boxShadow: `0 0 5px ${dotColor}` }} />
      {display}
    </span>
  );
}

function EventIcon({ type }) {
  const map = { MINTED: ['var(--primary)', 'token'], ACTIVATED: ['var(--secondary)', 'check_circle'], BURNED: ['var(--success)', 'local_fire_department'], REVOKED: ['var(--error)', 'cancel'], FLAGGED: ['var(--error)', 'gpp_bad'] };
  const [c, icon] = map[type] || ['var(--outline)', 'help'];
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-xl flex-shrink-0" style={{ background: `color-mix(in srgb, ${c} 10%, transparent)` }}>
      <M icon={icon} style={{ fontSize: 16, color: c }} />
    </div>
  );
}

function InfoCard({ label, value, msym }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-1">
        <M icon={msym} style={{ fontSize: 13, color: 'var(--outline)' }} />
        <p className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--outline)' }}>{label}</p>
      </div>
      <p className="text-sm font-bold font-mono truncate">{value}</p>
    </div>
  );
}

function DetailCard({ label, value, danger, msym }) {
  return (
    <div className="card p-4" style={danger ? { borderColor: 'rgba(255,180,171,0.2)' } : {}}>
      <div className="flex items-center gap-2 mb-1">
        <M icon={msym} style={{ fontSize: 13, color: danger ? 'var(--error)' : 'var(--outline)' }} />
        <p className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: danger ? 'var(--error)' : 'var(--outline)' }}>{label}</p>
      </div>
      <p className="text-sm font-bold font-mono" style={{ color: danger ? 'var(--error)' : 'var(--on-surface)' }}>{value}</p>
    </div>
  );
}

function EmptyState({ msym, text, action, onAction }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 p-4 rounded-2xl" style={{ background: 'var(--surface-container-high)' }}>
        <M icon={msym} style={{ fontSize: 28, color: 'var(--outline)' }} />
      </div>
      <p className="text-sm max-w-xs mb-4" style={{ color: 'var(--on-surface-variant)' }}>{text}</p>
      {action && onAction && <button onClick={onAction} className="btn-primary text-xs">{action}</button>}
    </div>
  );
}

/* ─── Helpers ─── */
function buildChainNodes(chain) {
  const byAction = new Map(chain.map(t => [t.action_type, t]));
  const hasMalicious = chain.some(t => t.action_type === 'READ_REPO');
  const steps = [...STEP_ORDER];
  if (hasMalicious) steps.splice(2, 0, 'READ_REPO');
  return steps.map((action, i) => { const t = byAction.get(action); return { id: t?.id || `${action}-${i}`, action, status: t?.status || 'idle', mintedAt: t?.minted_at || null, token: t }; });
}

function fmtTime(v) { if (!v) return '—'; return new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

function fmtDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function evtColor(type) {
  return { MINTED: 'var(--primary)', ACTIVATED: 'var(--secondary)', BURNED: 'var(--success)', REVOKED: 'var(--error)', FLAGGED: 'var(--error)', EXPIRED: 'var(--warning)' }[type] || 'var(--outline)';
}

function describeAudit(entry) {
  const d = entry.details || {};
  if (entry.event_type === 'FLAGGED') return d.summary || 'Security violation detected.';
  if (entry.event_type === 'REVOKED') return d.reason || 'Token revoked.';
  if (entry.event_type === 'MINTED') return `Token minted for ${STEP_META[d.actionType]?.label || d.actionType || 'UNKNOWN'}.`;
  if (entry.event_type === 'BURNED') return 'Token consumed and destroyed after execution.';
  if (entry.event_type === 'ACTIVATED') return 'Token activated — execution authorized.';
  return 'Lifecycle event recorded.';
}
