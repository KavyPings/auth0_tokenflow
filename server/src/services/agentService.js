// ═══════════════════════════════════════════════════════════
// Agent Service — Simulates cloud agent actions
// Each action goes through the vault proxy (never direct creds)
// ═══════════════════════════════════════════════════════════

import { vaultService } from './vaultService.js';

/**
 * Simulate reading an object from cloud storage
 * Credential: gcs-service-account (retrieved via vault proxy)
 */
export async function readCloudObject(resource) {
  const credential = await vaultService.getCredential('gcs-service-account');

  if (!credential.success) {
    throw new Error('Failed to retrieve GCS credential from Token Vault');
  }

  console.log(`[AGENT] Reading object from cloud storage: ${resource}`);

  return {
    success: true,
    action: 'READ_OBJECT',
    service: 'gcs',
    resource,
    data: {
      bucket: 'agent-data-lake',
      object: resource,
      size_bytes: 2048576,
      content_type: 'application/json',
      content_preview: '{"records": [...], "metadata": {"source": "iot-sensor-feed", "count": 1247}}',
    },
    credential_source: credential.method,
    message: `Successfully read object "${resource}" from cloud storage`,
  };
}

/**
 * Simulate calling an internal API endpoint
 * Credential: internal-api-key (retrieved via vault proxy)
 */
export async function callInternalApi(endpoint) {
  const credential = await vaultService.getCredential('internal-api-key');

  if (!credential.success) {
    throw new Error('Failed to retrieve Internal API credential from Token Vault');
  }

  console.log(`[AGENT] Calling internal API: ${endpoint}`);

  return {
    success: true,
    action: 'CALL_INTERNAL_API',
    service: 'internal-api',
    endpoint,
    data: {
      status: 200,
      response: {
        processed_records: 1247,
        anomalies_detected: 3,
        processing_time_ms: 342,
        result_id: `res_${Date.now().toString(36)}`,
      },
    },
    credential_source: credential.method,
    message: `Successfully called internal API "${endpoint}"`,
  };
}

/**
 * Simulate writing an object to cloud storage
 * Credential: gcs-service-account (retrieved via vault proxy)
 */
export async function writeCloudObject(resource, data = {}) {
  const credential = await vaultService.getCredential('gcs-service-account');

  if (!credential.success) {
    throw new Error('Failed to retrieve GCS credential from Token Vault');
  }

  console.log(`[AGENT] Writing object to cloud storage: ${resource}`);

  return {
    success: true,
    action: 'WRITE_OBJECT',
    service: 'gcs',
    resource,
    data: {
      bucket: 'agent-results',
      object: resource,
      bytes_written: 1024,
      version: `v_${Date.now().toString(36)}`,
    },
    credential_source: credential.method,
    message: `Successfully wrote results to "${resource}" in cloud storage`,
  };
}

/**
 * UNAUTHORIZED: Simulate agent attempting to read from source control
 * This should NEVER succeed in a properly secured system
 * The agent attempts this when compromised / acting maliciously
 */
export async function readRepo(resource) {
  console.log(`[AGENT] ⚠ ATTEMPTING UNAUTHORIZED repo access: ${resource}`);

  // Even attempting to get the credential should be logged
  // The vault proxy would block this, but we simulate the attempt
  return {
    success: false,
    action: 'READ_REPO',
    service: 'source-control',
    resource,
    data: null,
    message: `BLOCKED: Agent attempted unauthorized access to source control "${resource}"`,
  };
}
