// =====================================================================
// client.js: Browser fetch wrapper for the /api routes.
// The session lives in an httpOnly cookie, so no token handling is needed here.
// =====================================================================

async function request(endpoint, options = {}) {
  const config = {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...options.headers }
  };
  if (config.body !== undefined && typeof config.body !== 'string') {
    config.body = JSON.stringify(config.body);
  }

  const response = await fetch(`/api${endpoint}`, config);

  let data;
  try {
    data = await response.json();
  } catch {
    data = { success: false, error: 'JSON Parse Error', message: response.statusText };
  }

  if (!response.ok || data.success === false) {
    const error = new Error(data.message || data.error || 'API Request Failed');
    error.status = response.status;
    error.details = data.details || null;
    throw error;
  }

  return data.data !== undefined ? data.data : data;
}

export const api = {
  get: (endpoint, options) => request(endpoint, { ...options, method: 'GET' }),
  post: (endpoint, body, options) => request(endpoint, { ...options, method: 'POST', body: body ?? {} }),
  put: (endpoint, body, options) => request(endpoint, { ...options, method: 'PUT', body: body ?? {} }),
  patch: (endpoint, body, options) => request(endpoint, { ...options, method: 'PATCH', body: body ?? {} }),
  delete: (endpoint, options) => request(endpoint, { ...options, method: 'DELETE' })
};
