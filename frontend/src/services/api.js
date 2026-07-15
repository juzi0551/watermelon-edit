import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

// ==================== Projects ====================

export async function listProjects() {
  const { data } = await api.get('/projects')
  return data.projects
}

export async function createProject(name) {
  const { data } = await api.post(`/projects?name=${encodeURIComponent(name)}`)
  return data
}

export async function getProject(projectId) {
  const { data } = await api.get(`/projects/${projectId}`)
  return data
}

export async function deleteProject(projectId) {
  const { data } = await api.delete(`/projects/${projectId}`)
  return data
}

export async function uploadToProject(projectId, file) {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post(`/projects/${projectId}/upload`, form)
  return data
}

export async function renameProject(projectId, name) {
  const { data } = await api.post(`/projects/${projectId}/rename?name=${encodeURIComponent(name)}`)
  return data
}

// ==================== Models (校对选择) ====================

export async function getModels() {
  const { data } = await api.get('/models')
  return data.models
}

// ==================== Debug (大模型调用日志) ====================

export async function getLLMLog() {
  const { data } = await api.get('/debug/llm-calls')
  return data.calls
}

// ==================== Settings (API Key，按服务商) ====================

export async function getProviders() {
  const { data } = await api.get('/settings/providers')
  return data.providers
}

export async function saveApiKey(provider, apiKey) {
  const { data } = await api.post('/settings/keys', { provider, api_key: apiKey })
  return data
}

export async function deleteApiKey(provider) {
  const { data } = await api.delete(`/settings/keys/${provider}`)
  return data
}

export async function testApiKey(modelId) {
  const { data } = await api.post(`/settings/test/${modelId}`)
  return data
}

// ==================== Proofread ====================

export async function startProofread(projectId, payload) {
  const { data } = await api.post(`/projects/${projectId}/proofread`, payload)
  return data
}

export async function getResults(projectId) {
  const { data } = await api.get(`/projects/${projectId}/results`)
  return data
}

// ==================== Error Actions ====================

export async function setErrorStatus(projectId, errorId, status, customText) {
  const { data } = await api.post(`/projects/${projectId}/errors/${errorId}/status`, {
    status,
    custom_text: customText || null,
  })
  return data
}

export async function acceptAll(projectId) {
  const { data } = await api.post(`/projects/${projectId}/accept-all`)
  return data
}

// ==================== Export ====================

export async function exportDoc(projectId) {
  const { data } = await api.post(`/projects/${projectId}/export`, {}, { responseType: 'blob' })
  return data
}
