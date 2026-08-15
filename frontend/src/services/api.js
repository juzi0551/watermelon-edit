import axios from 'axios'

const API_BASE = typeof window !== 'undefined' && window.__TAURI_INTERNALS__
  ? 'http://localhost:8000/api'
  : '/api'
const api = axios.create({ baseURL: API_BASE })

// 请求拦截器：注入 Bearer Token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
}, (error) => Promise.reject(error))

// 响应拦截器：捕获 401 并广播 auth:unauthorized 事件
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      window.dispatchEvent(new Event('auth:unauthorized'))
    }
    return Promise.reject(error)
  }
)

// ==================== Auth (身份验证) ====================

export async function getAuthStatus() {
  const { data } = await api.get('/auth/status')
  return data // { token_valid: bool, username: str }
}

export async function loginPassword(username, password) {
  const { data } = await api.post('/auth/login', { username, password })
  if (data.token) {
    localStorage.setItem('token', data.token)
  }
  return data
}

export async function changePassword(oldPassword, newPassword) {
  const { data } = await api.post('/auth/change-password', {
    old_password: oldPassword,
    new_password: newPassword,
  })
  if (data.token) {
    localStorage.setItem('token', data.token)
  }
  return data
}

export function logout() {
  localStorage.removeItem('token')
  window.dispatchEvent(new Event('auth:unauthorized'))
}

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

// ==================== LLM 调用历史 ====================

export async function getLLMLogs(projectId, limit = 50, offset = 0) {
  const params = { limit, offset }
  if (projectId) params.project_id = projectId
  const { data } = await api.get('/debug/llm-logs', { params })
  return { logs: data.logs || [], total: data.total || 0 }
}

// ==================== Debug (大模型调用日志) ====================

export async function getLLMLog() {
  const { data } = await api.get('/debug/llm-calls')
  return data.calls
}

export async function clearLLMLogs(projectId) {
  const { data } = await api.delete('/debug/llm-logs', { params: { project_id: projectId } })
  return data
}

// ==================== Settings (System Prompts) ====================

export async function getPrompts() {
  const { data } = await api.get('/settings/prompts')
  return data
}

export async function savePrompts(proofread, batchMaxConcurrent, proofreadWindowSize) {
  const payload = {}
  if (proofread !== undefined) payload.system_prompt_proofread = proofread
  if (batchMaxConcurrent !== undefined) payload.batch_max_concurrent = batchMaxConcurrent
  if (proofreadWindowSize !== undefined) payload.proofread_window_size = proofreadWindowSize
  const { data } = await api.put('/settings/prompts', payload)
  return data
}

export async function resetPrompts() {
  const { data } = await api.post('/settings/reset-prompts')
  return data
}

export async function saveBatchConcurrency(batchMaxConcurrent) {
  const { data } = await api.put('/settings/prompts', { batch_max_concurrent: batchMaxConcurrent })
  return data
}

export async function saveWindowSize(proofreadWindowSize) {
  const { data } = await api.put('/settings/prompts', { proofread_window_size: proofreadWindowSize })
  return data
}

// ==================== Settings (API Key，按服务商) ====================

export async function getProviders() {
  const { data } = await api.get('/settings/providers')
  return data.providers
}

export async function saveApiKey(provider, apiKey, accountId) {
  const payload = { provider }
  if (apiKey) payload.api_key = apiKey
  if (accountId) payload.account_id = accountId
  const { data } = await api.post('/settings/keys', payload)
  return data
}

export async function deleteApiKey(provider) {
  const { data } = await api.delete(`/settings/keys/${provider}`)
  return data
}

export async function addProvider(payload) {
  const { data } = await api.post('/settings/providers', payload)
  return data
}

export async function deleteProvider(providerId) {
  const { data } = await api.delete(`/settings/providers/${providerId}`)
  return data
}

export async function addModel(payload) {
  const { data } = await api.post('/settings/models', payload)
  return data
}

export async function deleteModel(providerId, modelId) {
  const { data } = await api.delete(`/settings/models/${providerId}/${encodeURIComponent(modelId)}`)
  return data
}

export async function testApiKey(provider, modelId) {
  const { data } = await api.post(`/settings/test/${provider}/${modelId}`)
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

export async function cleanEmptyParagraphs(projectId) {
  const { data } = await api.post(`/projects/${projectId}/clean-empty-paragraphs`)
  return data
}

export async function formatProjectIndent(projectId) {
  const { data } = await api.post(`/projects/${projectId}/format-indent`)
  return data
}

// ==================== Export ====================

export async function exportDoc(projectId, mode = 'print') {
  const response = await api.post(`/projects/${projectId}/export?export_mode=${mode}`, {}, { responseType: 'blob' })
  const disposition = response.headers['content-disposition']
  let filename = ''
  if (disposition && disposition.includes('filename=')) {
    const match = disposition.match(/filename\*?=(?:UTF-8'')?([^;]+)/i)
    if (match && match[1]) {
      filename = decodeURIComponent(match[1].replace(/['"]/g, ''))
    }
  }
  return { blob: response.data, filename }
}

// ==================== Batch Proofread ====================

export async function getBatchStatus(projectId, batchId) {
  const { data } = await api.get(`/projects/${projectId}/proofread/batch/${batchId}`)
  return data
}

export async function retryWindow(projectId, payload) {
  const { data } = await api.post(`/projects/${projectId}/proofread/retry-window`, payload)
  return data
}

// ==================== Paragraph & Chapter Editing ====================

export async function updateParagraph(projectId, idx, text, editNote = null, paragraphUuid = null) {
  const target = paragraphUuid || idx
  const { data } = await api.patch(`/projects/${projectId}/paragraphs/${target}`, { text, edit_note: editNote, paragraph_uuid: paragraphUuid })
  return data
}

export async function updateParagraphNotes(projectId, idx, notes, paragraphUuid = null) {
  const target = paragraphUuid || idx
  const { data } = await api.put(`/projects/${projectId}/paragraphs/${target}/notes`, { notes, paragraph_uuid: paragraphUuid })
  return data
}

export async function deleteParagraph(projectId, idx, paragraphUuid = null) {
  const target = paragraphUuid || idx
  const { data } = await api.delete(`/projects/${projectId}/paragraphs/${target}`, { params: paragraphUuid ? { paragraph_uuid: paragraphUuid } : {} })
  return data
}

export async function togglePageBreak(projectId, idx, pageBreakType, paragraphUuid = null) {
  const target = paragraphUuid || idx
  const payload = typeof pageBreakType === 'string'
    ? { page_break_type: pageBreakType, paragraph_uuid: paragraphUuid }
    : { has_page_break_before: !!pageBreakType, paragraph_uuid: paragraphUuid }
  const { data } = await api.post(`/projects/${projectId}/paragraphs/${target}/page_break`, payload)
  return data
}

export async function setChapter(projectId, idx, isChapter = true, level = 1, title = null, paragraphUuid = null) {
  const target = paragraphUuid || idx
  const { data } = await api.post(`/projects/${projectId}/paragraphs/${target}/chapter`, {
    is_chapter: isChapter,
    level,
    title,
    paragraph_uuid: paragraphUuid,
  })
  return data
}

export async function insertParagraph(projectId, idx, position = 'below', text = '', paragraphUuid = null) {
  const target = paragraphUuid || idx
  const { data } = await api.post(`/projects/${projectId}/paragraphs/${target}/insert`, {
    position,
    text,
    paragraph_uuid: paragraphUuid,
  })
  return data
}

export async function mergeParagraphs(projectId, idx, direction = 'below', separator = '', paragraphUuid = null) {
  const target = paragraphUuid || idx
  const { data } = await api.post(`/projects/${projectId}/paragraphs/${target}/merge`, {
    direction,
    separator,
    paragraph_uuid: paragraphUuid,
  })
  return data
}

export async function mergeMultipleParagraphs(projectId, paragraphUuids, separator = '') {
  const { data } = await api.post(`/projects/${projectId}/paragraphs/merge_batch`, {
    paragraph_uuids: paragraphUuids,
    separator,
  })
  return data
}

export async function getParagraphStatus(projectId, uuid) {
  const { data } = await api.get(`/projects/${projectId}/paragraphs/${uuid}/status`)
  return data
}

export async function getParagraphStatusBatch(projectId, uuids) {
  const { data } = await api.post(`/projects/${projectId}/paragraphs/status_batch`, { uuids })
  return data
}

export async function restoreParagraph(projectId, uuid, targetIdx = null) {
  const { data } = await api.post(`/projects/${projectId}/paragraphs/${uuid}/restore`, { target_idx: targetIdx })
  return data
}

// ==================== Project Profile & Character Graph ====================

export async function updateProjectProfile(projectId, profileData) {
  const { data } = await api.put(`/projects/${projectId}/profile`, profileData)
  return data
}

export async function getCharacterGraph(projectId, uptoParagraphIdx, uptoParagraphUuid = null) {
  const params = {}
  if (uptoParagraphUuid) params.upto_paragraph_uuid = uptoParagraphUuid
  else if (uptoParagraphIdx !== undefined && uptoParagraphIdx !== null) params.upto_paragraph_idx = uptoParagraphIdx
  const { data } = await api.get(`/projects/${projectId}/character-graph`, { params })
  return data
}

export async function getCharacterShortestPath(projectId, sourceId, targetId, uptoParagraphIdx, uptoParagraphUuid = null) {
  const params = { source_id: sourceId, target_id: targetId }
  if (uptoParagraphUuid) params.upto_paragraph_uuid = uptoParagraphUuid
  else if (uptoParagraphIdx !== undefined && uptoParagraphIdx !== null) params.upto_paragraph_idx = uptoParagraphIdx
  const { data } = await api.get(`/projects/${projectId}/character-graph/shortest-path`, { params })
  return data
}

export async function scanProjectTerms(projectId) {
  const { data } = await api.post(`/projects/${projectId}/scan-terms`)
  return data
}

export async function rescanEntities(projectId) {
  const { data } = await api.post(`/projects/${projectId}/rescan-entities`)
  return data
}

export async function getEntityDictionaryStatus(projectId) {
  const { data } = await api.get(`/projects/${projectId}/entity-dictionary-status`)
  return data
}

export async function getProjectPrescanStatus(projectId) {
  const { data } = await api.get(`/projects/${projectId}/prescan-status`)
  return data
}

export async function toggleProjectLock(projectId, isLocked) {
  const { data } = await api.post(`/projects/${projectId}/lock`, { is_locked: isLocked })
  return data
}

// ==================== AI Chat Assistant (阶段 2 & 3) ====================

export async function listChatSessions(projectId) {
  const { data } = await api.get(`/projects/${projectId}/chat/sessions`)
  return data
}

export async function createChatSession(projectId, title = '新对话', model = null) {
  const { data } = await api.post(`/projects/${projectId}/chat/sessions`, { title, model })
  return data
}

export async function deleteChatSession(projectId, sessionId) {
  const { data } = await api.delete(`/projects/${projectId}/chat/sessions/${sessionId}`)
  return data
}

export async function listChatMessages(projectId, sessionId) {
  const { data } = await api.get(`/projects/${projectId}/chat/sessions/${sessionId}/messages`)
  return data
}

export async function updateCardStatus(projectId, messageId, status) {
  const { data } = await api.patch(`/projects/${projectId}/chat/messages/${messageId}/card_status`, { status })
  return data
}

export function getChatStreamUrl(projectId) {
  return `${API_BASE}/projects/${projectId}/chat/stream`
}

// ==================== Annotations (划线注释) ====================

export async function getAnnotations(projectId) {
  const { data } = await api.get(`/projects/${projectId}/annotations`)
  return data
}

export async function createAnnotation(projectId, { paragraphIdx, paragraphUuid, selectedText, content, startOffset = 0, endOffset = 0 }) {
  const { data } = await api.post(`/projects/${projectId}/annotations`, {
    paragraph_idx: paragraphIdx,
    paragraph_uuid: paragraphUuid,
    selected_text: selectedText,
    content,
    start_offset: startOffset,
    end_offset: endOffset,
  })
  return data
}

export async function updateAnnotation(projectId, annotationId, content) {
  const { data } = await api.put(`/projects/${projectId}/annotations/${annotationId}`, { content })
  return data
}

export async function deleteAnnotation(projectId, annotationId) {
  const { data } = await api.delete(`/projects/${projectId}/annotations/${annotationId}`)
  return data
}

