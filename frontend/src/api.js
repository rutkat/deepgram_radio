/**
 * API utility module for communicating with the Deepgram Voice Radio backend.
 * All endpoints are prefixed with /radio/api.
 */

const API_BASE = '/radio/api';

/**
 * Create a new user session with a sanitized username.
 * @param {string} username - The user's display name.
 * @returns {Promise<{session_id: string, username: string}>}
 */
export async function createSession(username) {
  const res = await fetch(`${API_BASE}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  if (!res.ok) throw new Error(`createSession failed: ${res.status}`);
  return res.json();
}

/**
 * Retrieve an existing session.
 * @param {string} sessionId
 * @returns {Promise<{session_id: string, username: string, created_at: string}>}
 */
export async function getSession(sessionId) {
  const res = await fetch(`${API_BASE}/session/${sessionId}`);
  if (!res.ok) throw new Error(`getSession failed: ${res.status}`);
  return res.json();
}

/**
 * Delete a user session and all associated data.
 * @param {string} sessionId
 * @returns {Promise<{status: string}>}
 */
export async function deleteSession(sessionId) {
  const res = await fetch(`${API_BASE}/session/${sessionId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`deleteSession failed: ${res.status}`);
  return res.json();
}

/**
 * Get the list of available voice agents.
 * @returns {Promise<Array<{name: string, greeting: string}>>}
 */
export async function getAgents() {
  const res = await fetch(`${API_BASE}/agents`);
  if (!res.ok) throw new Error(`getAgents failed: ${res.status}`);
  return res.json();
}

/**
 * Get the full LLM prompt for an agent (debug).
 * @param {string} agentType - One of 'Friend', 'Family', 'Restaurant'.
 * @returns {Promise<{agent_type: string, prompt: string, greeting: string}>}
 */
export async function getAgentPrompt(agentType) {
  const res = await fetch(`${API_BASE}/agents/${agentType}/prompt`);
  if (!res.ok) throw new Error(`getAgentPrompt failed: ${res.status}`);
  return res.json();
}

/**
 * Get agent configuration with context-memory resolved.
 * @param {string} agentType
 * @param {string} sessionId
 * @returns {Promise<Object>}
 */
export async function getAgentConfig(agentType, sessionId) {
  const res = await fetch(`${API_BASE}/agents/${agentType}/config?session_id=${sessionId}`);
  if (!res.ok) throw new Error(`getAgentConfig failed: ${res.status}`);
  return res.json();
}

/**
 * Transcribe audio using Deepgram STT.
 * @param {Blob} audioBlob - Audio data blob (webm, wav, etc.).
 * @param {string} sessionId
 * @returns {Promise<{transcript: string}>}
 */
export async function transcribeAudio(audioBlob, sessionId) {
  const formData = new FormData();
  // Use the blob's actual type to determine the extension
  const ext = audioBlob.type.includes('webm') ? 'webm' : 'wav';
  formData.append('audio', audioBlob, `recording.${ext}`);
  formData.append('session_id', sessionId);
  const res = await fetch(`${API_BASE}/stt`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error(`transcribeAudio failed: ${res.status}`);
  return res.json();
}

/**
 * Convert text to speech using Deepgram TTS.
 * @param {string} text - Text to convert (max 2000 chars).
 * @param {string} sessionId
 * @returns {Promise<Blob>} - Audio blob (WAV).
 */
export async function synthesizeSpeech(text, sessionId) {
  const res = await fetch(`${API_BASE}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, session_id: sessionId }),
  });
  if (!res.ok) throw new Error(`synthesizeSpeech failed: ${res.status}`);
  return res.blob();
}

/**
 * Fetch the Deepgram API token for WebSocket connections.
 * @returns {Promise<{token: string}>}
 */
export async function getDeepgramToken() {
  const res = await fetch(`${API_BASE}/deepgram-token`);
  if (!res.ok) throw new Error(`getDeepgramToken failed: ${res.status}`);
  return res.json();
}

/**
 * Get all voicemails for a session.
 * @param {string} sessionId
 * @returns {Promise<Array<Object>>}
 */
export async function getVoicemails(sessionId) {
  const res = await fetch(`${API_BASE}/voicemails/${sessionId}`);
  if (!res.ok) throw new Error(`getVoicemails failed: ${res.status}`);
  return res.json();
}

/**
 * Create a new voicemail notification.
 * @param {string} sessionId
 * @param {string} message
 * @returns {Promise<Object>}
 */
export async function createVoicemail(sessionId, message) {
  const res = await fetch(`${API_BASE}/voicemails`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, message }),
  });
  if (!res.ok) throw new Error(`createVoicemail failed: ${res.status}`);
  return res.json();
}

/**
 * Mark a voicemail as read.
 * @param {number} voicemailId
 * @returns {Promise<{status: string}>}
 */
export async function markVoicemailRead(voicemailId) {
  const res = await fetch(`${API_BASE}/voicemails/${voicemailId}/read`, {
    method: 'PATCH',
  });
  if (!res.ok) throw new Error(`markVoicemailRead failed: ${res.status}`);
  return res.json();
}

/**
 * Get all memos for a session.
 * @param {string} sessionId
 * @returns {Promise<Array<Object>>}
 */
export async function getMemos(sessionId) {
  const res = await fetch(`${API_BASE}/memos/${sessionId}`);
  if (!res.ok) throw new Error(`getMemos failed: ${res.status}`);
  return res.json();
}

/**
 * Save a conversation summary for context-memory.
 * @param {string} sessionId
 * @param {string} agentType
 * @param {string} summary
 * @returns {Promise<{status: string}>}
 */
export async function saveConversationSummary(sessionId, agentType, summary) {
  const res = await fetch(`${API_BASE}/conversation-summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, agent_type: agentType, summary }),
  });
  if (!res.ok) throw new Error(`saveConversationSummary failed: ${res.status}`);
  return res.json();
}
