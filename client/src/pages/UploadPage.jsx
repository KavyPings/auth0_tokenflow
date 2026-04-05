import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api.js';

const M = ({ icon, className = '', style }) => (
  <span className={`material-symbols-outlined ${className}`} style={style}>{icon}</span>
);

const ACTION_META = {
  READ_OBJECT: { msym: 'database', color: 'var(--primary)', label: 'Read Object' },
  CALL_INTERNAL_API: { msym: 'api', color: 'var(--secondary)', label: 'Call Internal API' },
  WRITE_OBJECT: { msym: 'save', color: 'var(--warning)', label: 'Write Object' },
};

const STATUS_META = {
  validated: { label: 'Validated', color: 'var(--success)', icon: 'verified' },
  invalid: { label: 'Invalid', color: 'var(--error)', icon: 'shield_locked' },
  run_failed: { label: 'Run Failed', color: 'var(--error)', icon: 'gpp_bad' },
};

export default function UploadPage({ setPage, onRunUploadedWorkflow }) {
  const [templates, setTemplates] = useState([]);
  const [uploaded, setUploaded] = useState([]);
  const [jsonInput, setJsonInput] = useState('');
  const [preview, setPreview] = useState(null);
  const [errors, setErrors] = useState([]);
  const [uploadResult, setUploadResult] = useState(null);
  const [busy, setBusy] = useState('');
  const [activeUploadedId, setActiveUploadedId] = useState(null);
  const fileInputRef = useRef(null);

  async function loadTemplates() {
    try {
      const response = await api('/api/workflows/templates');
      setTemplates(response.templates || []);
    } catch {
      setTemplates([]);
    }
  }

  async function loadUploadedWorkflows() {
    const response = await api('/api/workflows/upload');
    const workflows = response.workflows || [];
    setUploaded(workflows);
    setActiveUploadedId((current) => current && workflows.some((workflow) => workflow.id === current) ? current : workflows[0]?.id || null);
    return workflows;
  }

  useEffect(() => {
    loadTemplates();
    loadUploadedWorkflows().catch(() => setUploaded([]));
  }, []);

  function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const text = loadEvent.target?.result || '';
      setJsonInput(text);
      tryParse(text);
    };
    reader.readAsText(file);
  }

  function tryParse(text) {
    setErrors([]);
    setPreview(null);
    setUploadResult(null);

    try {
      const parsed = JSON.parse(text);
      setPreview(parsed);
    } catch {
      setErrors(['Invalid JSON. Fix the syntax before uploading.']);
    }
  }

  function handleJsonChange(event) {
    const text = event.target.value;
    setJsonInput(text);

    if (text.trim()) {
      tryParse(text);
    } else {
      setPreview(null);
      setErrors([]);
      setUploadResult(null);
    }
  }

  function loadTemplate(template) {
    const templateJson = JSON.stringify(template.definition, null, 2);
    setJsonInput(templateJson);
    tryParse(templateJson);
  }

  async function handleUpload() {
    if (!preview) return;

    setBusy('upload');
    setErrors([]);
    setUploadResult(null);

    try {
      const result = await api('/api/workflows/upload', {
        method: 'POST',
        body: JSON.stringify({ definition: preview }),
      });

      setUploadResult(result);
      setErrors(result.success ? [] : (result.errors || result.validation?.errors || []));
      const workflows = await loadUploadedWorkflows();
      if (result.id) {
        setActiveUploadedId(result.id);
      } else if (!activeUploadedId && workflows.length > 0) {
        setActiveUploadedId(workflows[0].id);
      }
    } catch (error) {
      setErrors([error.message]);
    }

    setBusy('');
  }

  async function handleRunUploaded(id) {
    setBusy(`run-${id}`);
    setErrors([]);

    try {
      if (onRunUploadedWorkflow) {
        await onRunUploadedWorkflow(id);
      } else {
        await api(`/api/workflows/upload/${id}/run`, { method: 'POST' });
        setPage('chain');
      }
      await loadUploadedWorkflows();
    } catch (error) {
      await loadUploadedWorkflows().catch(() => {});
      setErrors([error.message]);
    }

    setBusy('');
  }

  async function handleDeleteUploaded(id) {
    setBusy(`delete-${id}`);
    setErrors([]);

    try {
      await api(`/api/workflows/upload/${id}`, { method: 'DELETE' });
      if (activeUploadedId === id) {
        setActiveUploadedId(null);
      }
      await loadUploadedWorkflows();
      setUploadResult(null);
    } catch (error) {
      setErrors([error.message]);
    }

    setBusy('');
  }

  const activeUploadedWorkflow = uploaded.find((workflow) => workflow.id === activeUploadedId) || uploaded[0] || null;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="text-center mb-8">
        <div
          className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
          style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-container))', boxShadow: '0 0 30px rgba(196,192,255,0.2)' }}
        >
          <M icon="upload_file" style={{ fontSize: 32, color: 'var(--on-primary)' }} />
        </div>
        <h2 className="text-2xl font-bold font-headline tracking-tight">Upload Workflow</h2>
        <p className="text-sm mt-2 max-w-lg mx-auto" style={{ color: 'var(--on-surface-variant)' }}>
          Store custom workflows in the library, validate them against TokenFlow policy, and keep failed definitions available for debugging and reruns.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="text-sm font-bold uppercase tracking-[0.1em] font-headline mb-3">Starter Templates</h3>
            <div className="space-y-2">
              {templates.map((template) => (
                <button
                  key={template.id}
                  onClick={() => loadTemplate(template)}
                  className="w-full text-left p-3 rounded-xl transition-all"
                  style={{ background: 'var(--surface-container-high)', border: '1px solid rgba(70,69,85,0.12)' }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <M icon="description" style={{ fontSize: 14, color: 'var(--primary)' }} />
                    <p className="text-xs font-bold">{template.name}</p>
                  </div>
                  <p className="text-[10px]" style={{ color: 'var(--on-surface-variant)' }}>{template.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="upload-dropzone" onClick={() => fileInputRef.current?.click()}>
            <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileSelect} style={{ display: 'none' }} />
            <M icon="cloud_upload" style={{ fontSize: 32, color: 'var(--primary)' }} />
            <p className="text-sm font-bold mt-2">Drop a JSON file or click to browse</p>
            <p className="text-[10px]" style={{ color: 'var(--outline)' }}>Accepts .json workflow definitions</p>
          </div>

          <div className="card p-5">
            <h3 className="text-sm font-bold uppercase tracking-[0.1em] font-headline mb-3">JSON Editor</h3>
            <textarea
              value={jsonInput}
              onChange={handleJsonChange}
              placeholder={'{\n  "name": "My Workflow",\n  "description": "...",\n  "steps": [\n    {\n      "action": "READ_OBJECT",\n      "service": "gcs",\n      "resource": "data/input.json",\n      "actionVerb": "read"\n    }\n  ]\n}'}
              className="upload-editor"
              rows={12}
            />
          </div>

          <AnimatePresence>
            {errors.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="p-4 rounded-xl space-y-1"
                style={{ background: 'rgba(147,0,10,0.15)', border: '1px solid rgba(255,180,171,0.2)' }}
              >
                {errors.map((error, index) => (
                  <div key={index} className="flex items-start gap-2 text-xs" style={{ color: 'var(--error)' }}>
                    <M icon="error" style={{ fontSize: 14, marginTop: 1 }} /> {error}
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {uploadResult && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="p-4 rounded-xl"
              style={{
                background: uploadResult.success ? 'rgba(52,211,153,0.1)' : 'rgba(255,180,171,0.1)',
                border: uploadResult.success ? '1px solid rgba(52,211,153,0.2)' : '1px solid rgba(255,180,171,0.2)',
              }}
            >
              <div className="flex items-start gap-2 text-xs" style={{ color: uploadResult.success ? 'var(--success)' : 'var(--error)' }}>
                <M icon={uploadResult.success ? 'check_circle' : 'shield_locked'} style={{ fontSize: 14, marginTop: 1 }} />
                <div>
                  <p>
                    {uploadResult.success
                      ? `Workflow uploaded: ${uploadResult.name} (${uploadResult.id})`
                      : `Workflow stored but invalid: ${uploadResult.name} (${uploadResult.id})`}
                  </p>
                  <p style={{ color: 'var(--on-surface-variant)', marginTop: 4 }}>{uploadResult.message}</p>
                </div>
              </div>
            </motion.div>
          )}
        </div>

        <div className="space-y-4">
          {preview ? (
            <div className="card p-6">
              <h3 className="text-sm font-bold uppercase tracking-[0.1em] font-headline mb-1">Preview</h3>
              <p className="text-xs mb-6" style={{ color: 'var(--on-surface-variant)' }}>Validate before uploading</p>

              <div className="mb-4">
                <p className="text-[9px] font-bold uppercase tracking-[0.2em] mb-1" style={{ color: 'var(--outline)' }}>Name</p>
                <p className="text-sm font-bold font-headline">{preview.name || '(unnamed)'}</p>
              </div>

              {preview.description && (
                <div className="mb-4">
                  <p className="text-[9px] font-bold uppercase tracking-[0.2em] mb-1" style={{ color: 'var(--outline)' }}>Description</p>
                  <p className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>{preview.description}</p>
                </div>
              )}

              <p className="text-[9px] font-bold uppercase tracking-[0.2em] mb-3" style={{ color: 'var(--outline)' }}>Steps ({Array.isArray(preview.steps) ? preview.steps.length : 0})</p>
              <div className="timeline">
                {(Array.isArray(preview.steps) ? preview.steps : []).map((step, index) => {
                  const meta = ACTION_META[step.action] || { msym: 'help', color: 'var(--outline)', label: step.action };

                  return (
                    <div key={`${step.action}-${index}`} className="timeline-node">
                      <div className="timeline-dot idle"><div className="ping" /></div>
                      <div className="card p-4" style={{ background: 'var(--surface-container-high)' }}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] font-bold tracking-[0.2em] uppercase" style={{ color: meta.color }}>
                            Step {String(index + 1).padStart(2, '0')}
                          </span>
                          <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded" style={{ background: `color-mix(in srgb, ${meta.color} 10%, transparent)`, color: meta.color }}>
                            {step.actionVerb}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <M icon={meta.msym} style={{ fontSize: 14, color: meta.color }} />
                          <div>
                            <p className="text-xs font-bold font-headline">{meta.label}</p>
                            <p className="text-[10px] font-mono" style={{ color: 'var(--outline)' }}>{step.service} / {step.resource}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <button onClick={handleUpload} disabled={busy === 'upload' || errors.length > 0} className="btn-primary w-full mt-6 py-3">
                <M icon="cloud_upload" style={{ fontSize: 18 }} />
                {busy === 'upload' ? 'Uploading…' : 'Upload & Validate'}
              </button>
            </div>
          ) : (
            <div className="card p-6 flex flex-col items-center justify-center py-16">
              <div className="mb-4 p-4 rounded-2xl" style={{ background: 'var(--surface-container-high)' }}>
                <M icon="preview" style={{ fontSize: 28, color: 'var(--outline)' }} />
              </div>
              <p className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>Enter JSON or select a template to preview</p>
            </div>
          )}

          {uploaded.length > 0 && (
            <div className="card p-5">
              <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-[0.1em] font-headline">Uploaded Workflows</h3>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--on-surface-variant)' }}>
                    Stored uploads stay here even when validation fails so you can inspect, rerun, or delete them later.
                  </p>
                </div>
                <span className="text-[10px] font-mono" style={{ color: 'var(--outline)' }}>
                  {uploaded.length} workflow{uploaded.length === 1 ? '' : 's'} stored
                </span>
              </div>

              <div className="grid gap-4 lg:grid-cols-[0.95fr,1.05fr]">
                <div className="space-y-2">
                  {uploaded.map((workflow) => {
                    const statusMeta = STATUS_META[workflow.status] || STATUS_META.validated;
                    const isSelected = workflow.id === activeUploadedWorkflow?.id;
                    return (
                      <button
                        key={workflow.id}
                        onClick={() => setActiveUploadedId(workflow.id)}
                        className="w-full text-left p-3 rounded-xl transition-all"
                        style={{
                          background: isSelected ? 'rgba(196,192,255,0.1)' : 'var(--surface-container-high)',
                          border: isSelected ? '1px solid rgba(196,192,255,0.28)' : '1px solid rgba(70,69,85,0.1)',
                        }}
                      >
                        <div className="flex items-start gap-3">
                          <div className="p-1.5 rounded-lg" style={{ background: `color-mix(in srgb, ${statusMeta.color} 12%, transparent)` }}>
                            <M icon={statusMeta.icon} style={{ fontSize: 14, color: statusMeta.color }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <p className="text-xs font-bold truncate">{workflow.name}</p>
                              <span className="text-[8px] font-bold uppercase tracking-[0.16em] px-2 py-0.5 rounded" style={{ background: `color-mix(in srgb, ${statusMeta.color} 10%, transparent)`, color: statusMeta.color }}>
                                {statusMeta.label}
                              </span>
                            </div>
                            <p className="text-[10px] font-mono" style={{ color: 'var(--outline)' }}>{workflow.id}</p>
                            {(workflow.last_error || workflow.validation_errors?.length > 0) && (
                              <p className="text-[10px] mt-1 line-clamp-2" style={{ color: workflow.status === 'validated' ? 'var(--on-surface-variant)' : 'var(--error)' }}>
                                {workflow.last_error || workflow.validation_errors[0]}
                              </p>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {activeUploadedWorkflow && (
                  <div className="p-4 rounded-2xl" style={{ background: 'var(--surface-container-high)', border: '1px solid rgba(70,69,85,0.1)' }}>
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h4 className="text-sm font-bold font-headline">{activeUploadedWorkflow.name}</h4>
                          <span
                            className="text-[8px] font-bold uppercase tracking-[0.16em] px-2 py-0.5 rounded"
                            style={{
                              background: `color-mix(in srgb, ${(STATUS_META[activeUploadedWorkflow.status] || STATUS_META.validated).color} 10%, transparent)`,
                              color: (STATUS_META[activeUploadedWorkflow.status] || STATUS_META.validated).color,
                            }}
                          >
                            {(STATUS_META[activeUploadedWorkflow.status] || STATUS_META.validated).label}
                          </span>
                        </div>
                        <p className="text-[10px] font-mono" style={{ color: 'var(--outline)' }}>{activeUploadedWorkflow.id}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleRunUploaded(activeUploadedWorkflow.id)}
                          disabled={busy === `run-${activeUploadedWorkflow.id}`}
                          className="btn-ghost text-[10px]"
                          style={{ padding: '0.45rem 0.8rem' }}
                        >
                          <M icon="play_arrow" style={{ fontSize: 14 }} />
                          {busy === `run-${activeUploadedWorkflow.id}` ? 'Running…' : activeUploadedWorkflow.status === 'validated' ? 'Run' : 'Run Again'}
                        </button>
                        <button
                          onClick={() => handleDeleteUploaded(activeUploadedWorkflow.id)}
                          disabled={busy === `delete-${activeUploadedWorkflow.id}`}
                          className="btn-ghost text-[10px]"
                          style={{ padding: '0.45rem 0.8rem', color: 'var(--error)', borderColor: 'rgba(255,180,171,0.2)', background: 'rgba(255,180,171,0.06)' }}
                        >
                          <M icon="delete" style={{ fontSize: 14 }} />
                          {busy === `delete-${activeUploadedWorkflow.id}` ? 'Removing…' : 'Remove'}
                        </button>
                      </div>
                    </div>

                    <p className="text-xs mb-4" style={{ color: 'var(--on-surface-variant)' }}>
                      {activeUploadedWorkflow.description || 'No description provided.'}
                    </p>

                    {(activeUploadedWorkflow.validation_errors?.length > 0 || activeUploadedWorkflow.last_error) && (
                      <div className="mb-4 p-4 rounded-xl" style={{ background: 'rgba(255,180,171,0.08)', border: '1px solid rgba(255,180,171,0.15)' }}>
                        <div className="flex items-center gap-2 mb-2">
                          <M icon="gpp_bad" style={{ fontSize: 14, color: 'var(--error)' }} />
                          <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--error)' }}>Failure Detail</p>
                        </div>
                        {activeUploadedWorkflow.last_error && (
                          <p className="text-xs mb-2" style={{ color: 'var(--error)' }}>{activeUploadedWorkflow.last_error}</p>
                        )}
                        {activeUploadedWorkflow.validation_errors?.length > 0 && (
                          <div className="space-y-1">
                            {activeUploadedWorkflow.validation_errors.map((validationError, index) => (
                              <p key={`${activeUploadedWorkflow.id}-error-${index}`} className="text-[11px]" style={{ color: 'var(--on-surface-variant)' }}>
                                {index + 1}. {validationError}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="space-y-2 max-h-[280px] overflow-auto pr-1">
                      {(Array.isArray(activeUploadedWorkflow.definition?.steps) ? activeUploadedWorkflow.definition.steps : []).map((step, index) => {
                        const meta = ACTION_META[step.action] || { msym: 'help', color: 'var(--outline)', label: step.action || 'Unknown Step' };
                        return (
                          <div key={`${activeUploadedWorkflow.id}-step-${index}`} className="p-3 rounded-xl" style={{ background: 'var(--surface-container)', border: '1px solid rgba(70,69,85,0.08)' }}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: meta.color }}>
                                Step {String(index + 1).padStart(2, '0')}
                              </span>
                              <span className="text-[8px] font-bold uppercase tracking-[0.16em] px-1.5 py-0.5 rounded" style={{ background: `color-mix(in srgb, ${meta.color} 10%, transparent)`, color: meta.color }}>
                                {step.actionVerb || 'unknown'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <M icon={meta.msym} style={{ fontSize: 14, color: meta.color }} />
                              <div>
                                <p className="text-xs font-bold font-headline">{meta.label}</p>
                                <p className="text-[10px] font-mono" style={{ color: 'var(--outline)' }}>{step.service || 'n/a'} / {step.resource || 'n/a'}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
