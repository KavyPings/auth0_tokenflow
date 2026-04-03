import { useEffect, useRef, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  ChevronRight,
  Database,
  Flame,
  LayoutDashboard,
  Lock,
  Menu,
  Play,
  RefreshCcw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Sparkles,
  SquareActivity,
  TimerReset,
  Wifi,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import { api, getWebSocketUrl } from './api.js';

/* ═══════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════ */
const STEP_ORDER = ['READ_OBJECT', 'CALL_INTERNAL_API', 'WRITE_OBJECT'];

const STEP_META = {
  READ_OBJECT: { label: 'Read Object', icon: '📦', service: 'Cloud Storage', desc: 'Read data from GCS bucket' },
  CALL_INTERNAL_API: { label: 'Call Internal API', icon: '⚡', service: 'Internal API', desc: 'Process via internal endpoint' },
  WRITE_OBJECT: { label: 'Write Object', icon: '💾', service: 'Cloud Storage', desc: 'Write results to GCS' },
  READ_REPO: { label: 'Read Repo', icon: '🚨', service: 'Source Control', desc: 'BLOCKED — unauthorized access attempt' },
};

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'chain', label: 'Token Chain', icon: Workflow },
  { id: 'audit', label: 'Audit Log', icon: TimerReset },
  { id: 'security', label: 'Security Review', icon: ShieldAlert, badgeKey: 'alerts' },
  { id: 'vault', label: 'Credential Vault', icon: Lock },
  { id: 'launch', label: 'Launch Task', icon: Play },
];

/* ═══════════════════════════════════════════════════════════
   Main App
   ═══════════════════════════════════════════════════════════ */
export default function App() {
  const [page, setPage] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [overview, setOverview] = useState(null);
  const [health, setHealth] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [selectedTask, setSelectedTask] = useState('TASK-002');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(null);
  const [chain, setChain] = useState([]);
  const [audit, setAudit] = useState([]);
  const [busyAction, setBusyAction] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [socketState, setSocketState] = useState('connecting');
  const refreshTimeoutRef = useRef(null);

  const workflows = overview?.workflows || [];
  const currentWorkflow = workflows.find((w) => w.id === selectedWorkflowId) || workflows[0] || null;
  const reviewQueue = overview?.reviewQueue || [];
  const currentReview = reviewQueue.find((i) => i.workflowId === selectedWorkflowId) || reviewQueue[0] || null;
  const credentials = overview?.credentials || [];

  const chainNodes = buildChainNodes(chain);

  // ─── Data loading ───
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

  // WebSocket
  useEffect(() => {
    const ws = new WebSocket(getWebSocketUrl());
    ws.addEventListener('open', () => setSocketState('live'));
    ws.addEventListener('close', () => setSocketState('offline'));
    ws.addEventListener('error', () => setSocketState('degraded'));
    ws.addEventListener('message', (e) => {
      try { const d = JSON.parse(e.data); if (d.type === 'SECURITY_VIOLATION') setNotice('🛑 Security violation detected — review queue updated.'); } catch {}
      clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = setTimeout(() => {
        loadDashboard().then(() => loadChain(selectedWorkflowId)).catch((err) => setError(err.message));
      }, 300);
    });
    return () => { clearTimeout(refreshTimeoutRef.current); ws.close(); };
  }, [selectedWorkflowId, loadDashboard, loadChain]);

  // Auto-dismiss notices
  useEffect(() => { if (!notice && !error) return; const t = setTimeout(() => { setNotice(''); setError(''); }, 5000); return () => clearTimeout(t); }, [notice, error]);

  // ─── Actions ───
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

  // ─── Render ───
  return (
    <div className="flex min-h-screen">
      {/* Overlay for mobile sidebar */}
      {sidebarOpen && <div className="fixed inset-0 z-30 bg-black/20 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <div className="logo-icon"><Shield className="h-5 w-5" /></div>
          <div>
            <p className="text-sm font-bold text-slate-900 tracking-tight">TokenFlow OS</p>
            <p className="text-[11px] text-slate-400">Agent Security</p>
          </div>
        </div>
        <nav className="sidebar-nav">
          <p className="px-3 pb-2 pt-4 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Navigation</p>
          {NAV_ITEMS.map((item) => (
            <button key={item.id} onClick={() => { setPage(item.id); setSidebarOpen(false); }} className={`sidebar-item ${page === item.id ? 'active' : ''}`}>
              <item.icon className="h-[18px] w-[18px]" />
              {item.label}
              {item.badgeKey === 'alerts' && alertCount > 0 && <span className="badge badge-danger">{alertCount}</span>}
            </button>
          ))}
          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Workflows</p>
            <div className="max-h-[200px] space-y-1 overflow-auto">
              {workflows.slice(0, 8).map((w) => (
                <button key={w.id} onClick={() => { setSelectedWorkflowId(w.id); setPage('chain'); setSidebarOpen(false); }} className={`sidebar-item text-xs ${w.id === selectedWorkflowId ? 'active' : ''}`}>
                  <Activity className="h-3.5 w-3.5" />
                  <span className="truncate">{w.id.replace('wf_', '')}</span>
                  <StatusPill status={w.status} small />
                </button>
              ))}
              {workflows.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">No workflows yet</p>}
            </div>
          </div>
        </nav>
        <div className="sidebar-bottom">
          <div className="flex items-center gap-2.5 rounded-lg bg-slate-50 px-3 py-2.5">
            <span className={`dot ${socketState === 'live' ? 'dot-live' : socketState === 'connecting' ? 'dot-connecting' : 'dot-offline'}`} />
            <span className="text-xs font-medium text-slate-600">Realtime: {socketState}</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="main-content">
        {/* Top bar */}
        <div className="top-bar">
          <div className="flex items-center gap-3">
            <button className="lg:hidden rounded-lg border border-slate-200 p-2" onClick={() => setSidebarOpen(true)}><Menu className="h-4 w-4 text-slate-500" /></button>
            <h2 className="text-lg font-semibold text-slate-800">{NAV_ITEMS.find(n => n.id === page)?.label || 'Dashboard'}</h2>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleRefresh} disabled={busyAction === 'refresh'} className="btn-ghost text-xs"><RefreshCcw className="h-3.5 w-3.5" /> Refresh</button>
            <div className="h-8 w-px bg-slate-200" />
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className={`dot ${socketState === 'live' ? 'dot-live' : 'dot-offline'}`} />
              {socketState}
            </div>
          </div>
        </div>

        {/* Notification bar */}
        <AnimatePresence>
          {(notice || error) && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className={`mx-6 mt-4 flex items-center gap-3 rounded-xl border px-5 py-3 text-sm font-medium ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-indigo-200 bg-indigo-50 text-indigo-700'}`}>
              {error ? <AlertTriangle className="h-4 w-4 flex-shrink-0" /> : <Sparkles className="h-4 w-4 flex-shrink-0" />}
              {error || notice}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Pages */}
        <div className="flex-1 p-6">
          <AnimatePresence mode="wait">
            {page === 'dashboard' && <DashboardPage key="dashboard" workflows={workflows} reviewQueue={reviewQueue} credentials={credentials} health={health} currentWorkflow={currentWorkflow} setPage={setPage} />}
            {page === 'chain' && <ChainPage key="chain" chainNodes={chainNodes} currentWorkflow={currentWorkflow} onKill={() => handleKill(currentWorkflow?.id)} busyAction={busyAction} />}
            {page === 'audit' && <AuditPage key="audit" audit={audit} />}
            {page === 'security' && <SecurityPage key="security" currentReview={currentReview} reviewQueue={reviewQueue} onResume={handleResume} onRevoke={handleRevoke} busyAction={busyAction} />}
            {page === 'vault' && <VaultPage key="vault" credentials={credentials} health={health} />}
            {page === 'launch' && <LaunchPage key="launch" tasks={tasks} selectedTask={selectedTask} setSelectedTask={setSelectedTask} onStart={handleStart} busyAction={busyAction} />}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PAGE: Dashboard
   ═══════════════════════════════════════════════════════════ */
function DashboardPage({ workflows, reviewQueue, credentials, health, currentWorkflow, setPage }) {
  const totalTokens = workflows.reduce((sum, w) => {
    const s = w.token_summary || {};
    return sum + Object.values(s).reduce((a, b) => a + b, 0);
  }, 0);

  const burnedTokens = workflows.reduce((sum, w) => sum + (w.token_summary?.burned || 0), 0);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
      {/* Hero banner */}
      <div className="hero-banner mb-6 anim-fade-up">
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur">
              <Shield className="h-3 w-3" /> Secure AI Agent Execution
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
            Welcome to TokenFlow OS
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-white/60">
            Every agent action is restricted by a single-use capability token. Cross-service access is blocked. Credentials never leave the vault. Compromised agents are stopped in real-time.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button onClick={() => setPage('launch')} className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-900 shadow-lg transition hover:shadow-xl hover:-translate-y-0.5">
              <Play className="h-4 w-4" /> Start Secure Execution
            </button>
            <button onClick={() => setPage('chain')} className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-5 py-3 text-sm font-medium text-white backdrop-blur transition hover:bg-white/20">
              View Token Chain <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <MetricCard label="Workflows" value={workflows.length} icon={<Workflow className="h-5 w-5 text-indigo-500" />} color="brand" sub="Execution chains" delay={0} />
        <MetricCard label="Security Alerts" value={reviewQueue.length} icon={<ShieldAlert className="h-5 w-5 text-rose-500" />} color="rose" sub="Flagged for review" delay={1} />
        <MetricCard label="Tokens Minted" value={totalTokens} icon={<Zap className="h-5 w-5 text-teal-500" />} color="teal" sub={`${burnedTokens} burned`} delay={2} />
        <MetricCard label="Vault Credentials" value={credentials.length} icon={<Lock className="h-5 w-5 text-emerald-500" />} color="emerald" sub="Isolated services" delay={3} />
      </div>

      {/* Quick overview grid */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Recent workflows */}
        <div className="card rounded-2xl p-5 lg:col-span-2 anim-fade-up stagger-3">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-800">Recent Workflows</h3>
            <button onClick={() => setPage('chain')} className="text-xs font-medium text-indigo-500 hover:text-indigo-700 transition flex items-center gap-1">View all <ChevronRight className="h-3 w-3" /></button>
          </div>
          {workflows.length === 0 ? (
            <EmptyState icon={<Workflow />} text="No workflows yet. Launch a task to get started." action="Launch Task" onAction={() => setPage('launch')} />
          ) : (
            <div className="space-y-2">
              {workflows.slice(0, 5).map((w) => (
                <div key={w.id} className="flex items-center gap-4 rounded-xl border border-slate-100 bg-slate-50/50 p-3.5 transition hover:bg-white hover:shadow-sm cursor-pointer" onClick={() => { setPage('chain'); }}>
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50">
                    <Activity className="h-4 w-4 text-indigo-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{w.name}</p>
                    <p className="text-xs text-slate-400 font-mono">{w.id} • Step {w.current_step}</p>
                  </div>
                  <StatusPill status={w.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Enforcement rules */}
        <div className="card rounded-2xl p-5 anim-fade-up stagger-4">
          <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-500" /> Enforcement Rules
          </h3>
          <div className="space-y-3">
            {[
              'One token = one action',
              'Cross-service access blocked',
              'Unauthorized steps halt chain',
              'Credentials isolated in vault',
              'Tokens are non-transferable',
              'Human kill switch available',
            ].map((rule, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <div className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50">
                  <BadgeCheck className="h-3 w-3 text-emerald-500" />
                </div>
                <p className="text-sm text-slate-600 leading-5">{rule}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PAGE: Token Chain
   ═══════════════════════════════════════════════════════════ */
function ChainPage({ chainNodes, currentWorkflow, onKill, busyAction }) {
  const burnedCount = chainNodes.filter(n => n.status === 'burned').length;
  const flaggedCount = chainNodes.filter(n => n.status === 'flagged').length;
  const total = chainNodes.length || 1;
  const progress = Math.round((burnedCount / total) * 100);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
      {/* Workflow state header */}
      <div className="card rounded-2xl p-6 mb-6 anim-fade-up">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h3 className="text-lg font-semibold text-slate-800">{currentWorkflow?.name || 'No Active Workflow'}</h3>
              {currentWorkflow && <StatusPill status={currentWorkflow.status} />}
            </div>
            <p className="text-sm text-slate-500 font-mono">{currentWorkflow?.id || '—'} • Agent: agent-cloud-worker</p>
          </div>
          <div className="flex gap-2">
            {currentWorkflow && (
              <button onClick={onKill} disabled={!currentWorkflow || busyAction === 'kill'} className="btn-danger text-sm">
                <Flame className="h-4 w-4" /> {busyAction === 'kill' ? 'Halting...' : 'Kill Switch'}
              </button>
            )}
          </div>
        </div>
        {/* Progress */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-500">Chain Progress</span>
            <span className="text-xs font-semibold text-slate-700">{progress}% complete</span>
          </div>
          <div className="progress-bar">
            <div className={`progress-bar-fill ${flaggedCount > 0 ? 'rose' : 'brand'}`} style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      {/* Token Chain DAG */}
      <div className="card rounded-2xl p-6 anim-fade-up stagger-2">
        <h3 className="text-sm font-semibold text-slate-800 mb-1 flex items-center gap-2">
          <Workflow className="h-4 w-4 text-indigo-500" /> Live Token Chain
        </h3>
        <p className="text-xs text-slate-500 mb-6">Single-use capability tokens forming the execution DAG</p>

        <div className="overflow-x-auto pb-4">
          <div className="flex items-stretch gap-0" style={{ minWidth: `${chainNodes.length * 260}px` }}>
            {chainNodes.map((node, idx) => (
              <div key={node.id} className="flex items-center">
                <motion.div
                  initial={{ opacity: 0, y: 16, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: idx * 0.12, duration: 0.4, type: 'spring', stiffness: 200 }}
                  className={`token-node w-[220px] flex-shrink-0 ${node.status}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Step {String(idx + 1).padStart(2, '0')}</span>
                    <span className="text-xl">{STEP_META[node.action]?.icon || '❓'}</span>
                  </div>
                  <h4 className={`text-base font-semibold ${node.action === 'READ_REPO' ? 'text-rose-600' : 'text-slate-800'}`}>
                    {STEP_META[node.action]?.label || node.action}
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5">{STEP_META[node.action]?.service}</p>
                  <div className="mt-4 flex items-center justify-between">
                    <StatusPill status={node.status} />
                    <span className="font-mono text-[10px] text-slate-400">{node.token?.id?.slice(0, 12) || '—'}</span>
                  </div>
                  {node.mintedAt && <p className="mt-2 text-[10px] text-slate-400">{fmtTime(node.mintedAt)}</p>}
                </motion.div>
                {idx < chainNodes.length - 1 && (
                  <div className="chain-arrow">
                    <motion.div initial={{ opacity: 0, scaleX: 0 }} animate={{ opacity: 1, scaleX: 1 }} transition={{ delay: idx * 0.12 + 0.2 }}>
                      <svg width="40" height="24" viewBox="0 0 40 24" fill="none">
                        <line x1="0" y1="12" x2="28" y2="12" stroke={node.status === 'burned' ? '#10B981' : node.status === 'flagged' ? '#F43F5E' : '#CBD5E1'} strokeWidth="2" strokeDasharray={node.status === 'flagged' ? '4 4' : 'none'} />
                        <polygon points="28,7 36,12 28,17" fill={node.status === 'burned' ? '#10B981' : node.status === 'flagged' ? '#F43F5E' : '#CBD5E1'} />
                      </svg>
                    </motion.div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Workflow snapshot */}
      {currentWorkflow && (
        <div className="mt-4 grid gap-4 md:grid-cols-3 anim-fade-up stagger-3">
          <InfoCard label="Workflow ID" value={currentWorkflow.id} />
          <InfoCard label="Current Step" value={`Step ${currentWorkflow.current_step}`} />
          <InfoCard label="Task" value={currentWorkflow.applicant_data?.name || '—'} />
        </div>
      )}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PAGE: Audit Log
   ═══════════════════════════════════════════════════════════ */
function AuditPage({ audit }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
      <div className="card rounded-2xl p-6 anim-fade-up">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            <TimerReset className="h-4 w-4 text-indigo-500" /> Audit Log
          </h3>
          <span className="text-xs text-slate-400">{audit.length} events</span>
        </div>
        <p className="text-xs text-slate-500 mb-6">Immutable token lifecycle events with timestamps and actors</p>

        {audit.length === 0 ? (
          <EmptyState icon={<TimerReset />} text="Audit events will appear here once a workflow is running." />
        ) : (
          <div className="space-y-2 max-h-[calc(100vh-240px)] overflow-auto pr-1">
            {audit.map((entry, idx) => (
              <motion.div
                key={`${entry.id}-${entry.timestamp}`}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.02 }}
                className="flex items-start gap-4 rounded-xl border border-slate-100 bg-slate-50/50 p-4 transition hover:bg-white hover:shadow-sm"
              >
                <EventIcon type={entry.event_type} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`text-xs font-bold uppercase tracking-wider ${eventColor(entry.event_type)}`}>{entry.event_type}</span>
                  </div>
                  <p className="text-sm text-slate-700">{describeAudit(entry)}</p>
                  <p className="mt-1 font-mono text-[10px] text-slate-400">{entry.token_id}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-slate-500">{fmtTime(entry.timestamp)}</p>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400 mt-0.5">{entry.actor}</p>
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
   PAGE: Security Review
   ═══════════════════════════════════════════════════════════ */
function SecurityPage({ currentReview, reviewQueue, onResume, onRevoke, busyAction }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
      {currentReview ? (
        <div className="space-y-4 anim-fade-up">
          {/* Alert banner */}
          <div className="rounded-2xl border-2 border-rose-200 bg-gradient-to-br from-rose-50 to-white p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-100 flex-shrink-0">
                <ShieldX className="h-6 w-6 text-rose-500" />
              </div>
              <div className="flex-1">
                <span className="inline-block rounded-full bg-rose-100 px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-600 mb-2">Security Violation Detected</span>
                <h3 className="text-xl font-bold text-slate-900">{currentReview.workflowName}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{currentReview.review?.summary || 'Unauthorized action detected. Manual intervention required.'}</p>
              </div>
            </div>
          </div>

          {/* Details grid */}
          <div className="grid gap-4 sm:grid-cols-2">
            <DetailCard label="Attempted Service" value={currentReview.review?.attempted_service || 'n/a'} danger icon={<Database className="h-4 w-4" />} />
            <DetailCard label="Attempted Resource" value={currentReview.review?.attempted_resource || 'n/a'} danger icon={<Search className="h-4 w-4" />} />
            <DetailCard label="Attempted Action" value={currentReview.review?.attempted_action || 'n/a'} icon={<Zap className="h-4 w-4" />} />
            <DetailCard label="Task" value={currentReview.review?.taskData?.name || currentReview.task?.name || 'n/a'} icon={<Activity className="h-4 w-4" />} />
          </div>

          {/* Violations */}
          {(currentReview.review?.violations || []).length > 0 && (
            <div className="card rounded-2xl p-5">
              <h4 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" /> Violations
              </h4>
              <div className="space-y-2">
                {(currentReview.review?.violations || []).map((v, i) => (
                  <div key={i} className="rounded-xl border border-rose-100 bg-rose-50/50 p-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-rose-500 mb-1">{v.type}</p>
                    <p className="text-sm text-slate-700 leading-6">{v.message}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button onClick={() => onResume(currentReview.workflowId)} disabled={busyAction === 'resume'} className="btn-success flex-1 text-sm">
              <BadgeCheck className="h-4 w-4" /> {busyAction === 'resume' ? 'Resuming...' : 'Override & Resume'}
            </button>
            <button onClick={() => onRevoke(currentReview.workflowId)} disabled={busyAction === 'revoke'} className="btn-danger flex-1 text-sm">
              <X className="h-4 w-4" /> {busyAction === 'revoke' ? 'Revoking...' : 'Revoke & Abort'}
            </button>
          </div>
        </div>
      ) : (
        <div className="anim-fade-up">
          <EmptyState icon={<ShieldCheck />} text="No security alerts. Start a compromised agent task (TASK-002) to trigger cross-service violation detection." action="Launch Task" />
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
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
      {/* Vault status */}
      <div className="card-dark rounded-2xl p-6 mb-6 anim-fade-up">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">
            <Lock className="h-7 w-7 text-indigo-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Auth0 Token Vault</h3>
            <p className="text-sm text-slate-400">Agent never sees raw secrets — all access through vault proxy</p>
          </div>
          <div className="ml-auto">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-400">
              <span className="dot dot-live" /> Connected
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 anim-fade-up stagger-2">
        {credentials.map((cred, idx) => (
          <motion.div key={cred.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.1 }} className="card rounded-2xl p-5 hover:shadow-lg transition-all">
            <div className="flex items-start justify-between mb-4">
              <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${cred.status === 'restricted' ? 'bg-rose-50' : 'bg-indigo-50'}`}>
                {cred.status === 'restricted' ? <ShieldX className="h-5 w-5 text-rose-500" /> : <Lock className="h-5 w-5 text-indigo-500" />}
              </div>
              <StatusPill status={cred.status === 'restricted' ? 'flagged' : 'burned'} label={cred.status} />
            </div>
            <h4 className="font-semibold text-slate-800">{cred.display_name}</h4>
            <p className="text-xs text-slate-500 mt-1 font-mono uppercase tracking-wider">{cred.connection_type}</p>
            <p className="text-xs text-slate-400 mt-3 font-mono">{cred.service_name}</p>
            {cred.last_accessed && <p className="text-[10px] text-slate-400 mt-2">Last used: {fmtTime(cred.last_accessed)}</p>}
          </motion.div>
        ))}
      </div>

      {/* Vault info */}
      <div className="mt-6 card rounded-2xl p-5 anim-fade-up stagger-4">
        <h4 className="text-sm font-semibold text-slate-800 mb-3">How Vault Protection Works</h4>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { step: '1', title: 'Token Scoped', desc: 'Execution token specifies which credential is needed' },
            { step: '2', title: 'Vault Proxy Retrieves', desc: 'Backend requests credential from Auth0 Token Vault' },
            { step: '3', title: 'Agent Uses, Never Sees', desc: 'Action executed via proxy — raw secret never exposed' },
          ].map((s) => (
            <div key={s.step} className="flex gap-3 rounded-xl bg-slate-50 p-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-sm font-bold text-indigo-600 flex-shrink-0">{s.step}</span>
              <div>
                <p className="text-sm font-semibold text-slate-800">{s.title}</p>
                <p className="text-xs text-slate-500 mt-0.5 leading-5">{s.desc}</p>
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
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8 anim-fade-up">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 shadow-lg shadow-indigo-200">
            <Play className="h-7 w-7 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900">Launch Agent Task</h2>
          <p className="text-sm text-slate-500 mt-2">Select a task scenario and execute a secure, token-gated agent workflow</p>
        </div>

        <div className="space-y-3 mb-6 anim-fade-up stagger-2">
          {tasks.map((t) => (
            <button key={t.id} onClick={() => setSelectedTask(t.id)} className={`w-full text-left rounded-2xl border-2 p-5 transition-all ${t.id === selectedTask ? 'border-indigo-500 bg-indigo-50/50 shadow-md shadow-indigo-100' : 'border-slate-200 bg-white hover:border-indigo-200 hover:shadow-sm'}`}>
              <div className="flex items-start gap-4">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl flex-shrink-0 ${t.malicious ? 'bg-rose-100' : 'bg-emerald-100'}`}>
                  {t.malicious ? <ShieldAlert className="h-5 w-5 text-rose-500" /> : <ShieldCheck className="h-5 w-5 text-emerald-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-slate-800">{t.name}</h4>
                    {t.malicious && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-600">Compromised</span>}
                    {!t.malicious && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">Normal</span>}
                  </div>
                  <p className="text-xs text-slate-500 mt-1 leading-5">{t.description}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(t.steps || []).map((s, i) => (
                      <span key={i} className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{s.action}</span>
                    ))}
                    {t.malicious_step && <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-500">⚠ {t.malicious_step.action}</span>}
                  </div>
                </div>
                <div className={`flex h-5 w-5 items-center justify-center rounded-full border-2 flex-shrink-0 mt-1 ${t.id === selectedTask ? 'border-indigo-500 bg-indigo-500' : 'border-slate-300'}`}>
                  {t.id === selectedTask && <div className="h-2 w-2 rounded-full bg-white" />}
                </div>
              </div>
            </button>
          ))}
        </div>

        <button onClick={onStart} disabled={busyAction === 'start'} className="btn-primary w-full py-4 text-base anim-fade-up stagger-4">
          <Play className="h-5 w-5" /> {busyAction === 'start' ? 'Starting Execution...' : 'Start Secure Execution'}
        </button>

        {sel && (
          <p className="text-center text-xs text-slate-400 mt-4">
            {sel.malicious ? '⚠ This task simulates a compromised agent attempting unauthorized cross-service access.' : '✓ This task demonstrates a normal execution flow completing cleanly.'}
          </p>
        )}
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Shared components
   ═══════════════════════════════════════════════════════════ */
function MetricCard({ label, value, icon, color, sub, delay }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: delay * 0.08, duration: 0.4 }} className={`metric-card ${color}`}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</span>
        {icon}
      </div>
      <p className="text-3xl font-bold text-slate-900 tracking-tight">{String(value).padStart(2, '0')}</p>
      <p className="text-xs text-slate-400 mt-1">{sub}</p>
    </motion.div>
  );
}

function StatusPill({ status, small, label }) {
  const display = label || status;
  return <span className={`pill pill-${status} ${small ? 'text-[9px] px-2 py-0' : ''}`}><span className={`dot ${status === 'burned' || status === 'completed' ? 'bg-emerald-500' : status === 'active' || status === 'running' ? 'bg-indigo-500' : status === 'flagged' || status === 'revoked' || status === 'aborted' ? 'bg-rose-500' : status === 'paused' ? 'bg-amber-500' : 'bg-slate-400'}`} style={{ width: 6, height: 6 }} />{display}</span>;
}

function EventIcon({ type }) {
  const config = { MINTED: ['bg-indigo-50', 'text-indigo-500'], ACTIVATED: ['bg-sky-50', 'text-sky-500'], BURNED: ['bg-emerald-50', 'text-emerald-500'], REVOKED: ['bg-rose-50', 'text-rose-500'], FLAGGED: ['bg-rose-50', 'text-rose-500'] };
  const [bg, text] = config[type] || ['bg-slate-50', 'text-slate-500'];
  return <div className={`flex h-9 w-9 items-center justify-center rounded-lg flex-shrink-0 ${bg}`}><Zap className={`h-4 w-4 ${text}`} /></div>;
}

function InfoCard({ label, value }) {
  return (
    <div className="card rounded-xl p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">{label}</p>
      <p className="text-sm font-semibold text-slate-800 font-mono truncate">{value}</p>
    </div>
  );
}

function DetailCard({ label, value, danger, icon }) {
  return (
    <div className={`card rounded-xl p-4 ${danger ? 'border-rose-100' : ''}`}>
      <div className="flex items-center gap-2 mb-1">
        {icon && <span className={danger ? 'text-rose-400' : 'text-slate-400'}>{icon}</span>}
        <p className={`text-[10px] font-semibold uppercase tracking-wider ${danger ? 'text-rose-500' : 'text-slate-400'}`}>{label}</p>
      </div>
      <p className={`text-sm font-semibold font-mono ${danger ? 'text-rose-700' : 'text-slate-800'}`}>{value}</p>
    </div>
  );
}

function EmptyState({ icon, text, action, onAction }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">{icon}</div>
      <p className="text-sm text-slate-500 max-w-xs mb-4">{text}</p>
      {action && onAction && <button onClick={onAction} className="btn-primary text-sm">{action}</button>}
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

function eventColor(type) {
  return { MINTED: 'text-indigo-600', ACTIVATED: 'text-sky-600', BURNED: 'text-emerald-600', REVOKED: 'text-rose-600', FLAGGED: 'text-rose-600', EXPIRED: 'text-amber-600' }[type] || 'text-slate-600';
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
