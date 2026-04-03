// ═══════════════════════════════════════════════════════════
// Agent Task Definitions for Demo
// ═══════════════════════════════════════════════════════════

// Task that will complete normally — all steps within authorized scope
export const TASK_NORMAL = {
  id: 'TASK-001',
  name: 'Sensor Data Processing',
  description: 'Read IoT sensor data from cloud storage, process via internal API, write results back.',
  agent: 'agent-cloud-worker',
  malicious: false,
  steps: [
    { action: 'READ_OBJECT', service: 'gcs', resource: 'sensor-feed/batch-2026-04.json', actionVerb: 'read' },
    { action: 'CALL_INTERNAL_API', service: 'internal-api', resource: 'api/analytics/process', actionVerb: 'invoke' },
    { action: 'WRITE_OBJECT', service: 'gcs', resource: 'results/analytics-output.json', actionVerb: 'write' },
  ],
};

// Task that WILL trigger security violation
// Agent is compromised and attempts unauthorized source control access
export const TASK_MALICIOUS = {
  id: 'TASK-002',
  name: 'Compromised Agent — Credential Exfiltration',
  description: 'Agent starts normal workflow but attempts to access source control repo (unauthorized service).',
  agent: 'agent-cloud-worker',
  malicious: true,
  malicious_step: {
    action: 'READ_REPO',
    service: 'source-control',
    resource: 'internal/secrets-config.yaml',
    actionVerb: 'read',
  },
  steps: [
    { action: 'READ_OBJECT', service: 'gcs', resource: 'sensor-feed/batch-2026-04.json', actionVerb: 'read' },
    { action: 'CALL_INTERNAL_API', service: 'internal-api', resource: 'api/analytics/process', actionVerb: 'invoke' },
    // After this step, the compromised agent attempts READ_REPO (injected by workflowRunner)
    { action: 'WRITE_OBJECT', service: 'gcs', resource: 'results/analytics-output.json', actionVerb: 'write' },
  ],
};

// Additional edge case: scope escalation attempt
export const TASK_ESCALATION = {
  id: 'TASK-003',
  name: 'Scope Escalation Attempt',
  description: 'Agent attempts to write instead of read, escalating its permissions beyond token scope.',
  agent: 'agent-cloud-worker',
  malicious: true,
  escalation: true,
  steps: [
    { action: 'READ_OBJECT', service: 'gcs', resource: 'restricted/admin-config.json', actionVerb: 'read' },
    { action: 'CALL_INTERNAL_API', service: 'internal-api', resource: 'api/admin/elevate', actionVerb: 'invoke' },
    { action: 'WRITE_OBJECT', service: 'gcs', resource: 'results/output.json', actionVerb: 'write' },
  ],
};

export const ALL_TASKS = [TASK_MALICIOUS, TASK_NORMAL, TASK_ESCALATION];

export function getTaskById(id) {
  return ALL_TASKS.find(t => t.id === id) || null;
}
