const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000/api';
let authToken = localStorage.getItem('authToken') || null;

function getAuthHeaders() {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

function request(url, options = {}) {
  const headers = { ...options.headers, ...getAuthHeaders() };
  return fetch(url, { ...options, headers });
}

export function setAuthToken(token) {
  authToken = token;
  if (token) {
    localStorage.setItem('authToken', token);
  } else {
    localStorage.removeItem('authToken');
  }
}

export async function login(email, password) {
  const response = await request(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  return response.json();
}

export async function fetchMe() {
  const response = await request(`${API_BASE}/auth/me`);
  return response.json();
}

export async function fetchUsers() {
  const response = await request(`${API_BASE}/users`);
  return response.json();
}

export async function fetchDashboard() {
  const response = await request(`${API_BASE}/dashboard`);
  return response.json();
}

export async function fetchLeaves() {
  const response = await request(`${API_BASE}/leaves`);
  return response.json();
}

export async function createLeaveRequest(payload) {
  const response = await request(`${API_BASE}/leaves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function createUser(payload) {
  const response = await request(`${API_BASE}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function updateUser(userId, payload) {
  const response = await request(`${API_BASE}/users/${userId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function deleteUser(userId) {
  const response = await request(`${API_BASE}/users/${userId}`, {
    method: 'DELETE'
  });
  return response.json();
}

export async function uploadProfilePhoto(userId, file) {
  const formData = new FormData();
  formData.append('photo', file);
  const response = await request(`${API_BASE}/users/${userId}/photo`, {
    method: 'POST',
    body: formData
  });
  return response.json();
}

export async function uploadHealthReport(userId, file) {
  const formData = new FormData();
  formData.append('report', file);
  const response = await request(`${API_BASE}/users/${userId}/report`, {
    method: 'POST',
    body: formData
  });
  return response.json();
}

export async function approveLeave(leaveId, payload) {
  const response = await request(`${API_BASE}/leaves/${leaveId}/approve`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function rejectLeave(leaveId, payload) {
  const response = await request(`${API_BASE}/leaves/${leaveId}/reject`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function updateLeave(leaveId, payload) {
  const response = await request(`${API_BASE}/leaves/${leaveId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function cancelLeave(leaveId) {
  const response = await request(`${API_BASE}/leaves/${leaveId}`, {
    method: 'DELETE'
  });
  return response.json();
}
