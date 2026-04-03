import { Router } from 'express';
import { workflowRunner } from '../engine/workflowRunner.js';
import { tokenEngine } from '../engine/tokenEngine.js';
import { vaultService } from '../services/vaultService.js';

const router = Router();

router.get('/overview', (req, res) => {
  const workflows = workflowRunner.listWorkflows().map((workflow) => {
    let taskData = workflow.applicant_data;

    if (taskData) {
      try {
        taskData = JSON.parse(taskData);
      } catch {
        taskData = null;
      }
    }

    return {
      ...workflow,
      applicant_data: taskData,
      token_summary: tokenEngine.getTokenChain(workflow.id).reduce((acc, token) => {
        acc[token.status] = (acc[token.status] || 0) + 1;
        return acc;
      }, {}),
    };
  });

  const reviewQueue = workflows
    .filter((workflow) => workflow.status === 'paused')
    .map((workflow) => {
      const chain = tokenEngine.getTokenChain(workflow.id);
      const flaggedToken = chain.find((token) => token.status === 'flagged');
      const flagEvent = [...tokenEngine.getAuditLog(workflow.id)]
        .reverse()
        .find((entry) => entry.event_type === 'FLAGGED');

      return {
        workflowId: workflow.id,
        workflowName: workflow.name,
        task: workflow.applicant_data,
        flaggedToken,
        review: flagEvent?.details || null,
      };
    });

  res.json({
    success: true,
    server_time: new Date().toISOString(),
    workflows,
    reviewQueue,
    vault: vaultService.getStatus(),
    credentials: vaultService.listCredentials(),
  });
});

export default router;
