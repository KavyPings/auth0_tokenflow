const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'https://tokenflow-hazr.onrender.com').replace(/\/$/, '');

function toUrl(path) {
  return `${API_BASE_URL}${path}`;
}

export async function api(path, options = {}) {
  const response = await fetch(toUrl(path), {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    let message = `Request failed with ${response.status}`;
    try {
      const payload = await response.json();
      message = payload.error || payload.message || message;
    } catch {
      // Ignore non-JSON error bodies.
    }
    throw new Error(message);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return response.text();
  }

  return response.json();
}

export function getWebSocketUrl() {
  // Always derive WebSocket URL from the API base URL.
  // On Vercel, VITE_API_BASE_URL points to Render, so this correctly
  // produces wss://tokenflow-hazr.onrender.com/ws.
  return API_BASE_URL.replace(/^http/i, 'ws') + '/ws';
}

