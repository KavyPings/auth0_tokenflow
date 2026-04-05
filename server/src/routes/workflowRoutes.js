import { Router } from 'express';
import { workflowRunner } from '../engine/workflowRunner.js';
import { tokenEngine } from '../engine/tokenEngine.js';
import { ALL_TASKS, getTaskById } from '../data/agentTasks.js';

const router = Router();

router.post('/start', async (req, res) => {
  try {
    let taskData = req.body.taskData;

    if (req.body.taskId) {
      taskData = getTaskById(req.body.taskId);
      if (!taskData) {
        return res.status(404).json({ error: `Task ${req.body.taskId} not found` });
      }
    }

    if (!taskData) {
      return res.status(400).json({ error: 'Missing taskData or taskId' });
    }

    const result = await workflowRunner.startWorkflow(taskData);
    res.status(201).json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/tasks/list', (req, res) => {
  res.json({ success: true, tasks: ALL_TASKS });
});

router.get('/review/queue', (req, res) => {
  const queue = workflowRunner
    .listWorkflows()
    .filter((workflow) => workflow.status === 'paused')
    .map((workflow) => buildWorkflowReviewEntry(workflow));

  res.json({ success: true, queue, count: queue.length });
});

router.post('/:id/resume', async (req, res) => {
  try {
    const result = await workflowRunner.resumeWorkflow(req.params.id);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/:id/revoke', async (req, res) => {
  try {
    const result = await workflowRunner.abortWorkflow(req.params.id);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/:id/kill', async (req, res) => {
  try {
    const result = await workflowRunner.killWorkflow(req.params.id);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/clear', (req, res) => {
  try {
    const result = workflowRunner.clearWorkflows({ workflowTypes: ['mission'], statuses: ['completed', 'aborted'] });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', (req, res) => {
  const workflow = workflowRunner.getWorkflow(req.params.id);
  if (!workflow) {
    return res.status(404).json({ error: 'Workflow not found' });
  }

  if (workflow.applicant_data) {
    try {
      workflow.applicant_data = JSON.parse(workflow.applicant_data);
    } catch {
      workflow.applicant_data = null;
    }
  }

  res.json({
    success: true,
    workflow,
    review: workflow.status === 'paused' ? buildWorkflowReviewEntry(workflow) : null,
  });
});

router.get('/', (req, res) => {
  const workflows = workflowRunner.listWorkflows().map((workflow) => {
    if (workflow.applicant_data) {
      try {
        workflow.applicant_data = JSON.parse(workflow.applicant_data);
      } catch {
        workflow.applicant_data = null;
      }
    }
    return workflow;
  });

  res.json({ success: true, workflows, count: workflows.length });
});

function buildWorkflowReviewEntry(workflow) {
  const normalizedWorkflow = { ...workflow };

  if (normalizedWorkflow.applicant_data) {
    try {
      normalizedWorkflow.applicant_data = JSON.parse(normalizedWorkflow.applicant_data);
    } catch {
      normalizedWorkflow.applicant_data = null;
    }
  }

  const tokenChain = tokenEngine.getTokenChain(normalizedWorkflow.id);
  const flaggedToken = tokenChain.find((token) => token.status === 'flagged');
  const flagEvent = [...tokenEngine.getAuditLog(normalizedWorkflow.id)]
    .reverse()
    .find((entry) => entry.event_type === 'FLAGGED');

  return {
    workflow: normalizedWorkflow,
    flaggedToken,
    review: flagEvent?.details || null,
  };
}

export default router;
