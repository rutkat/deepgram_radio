/**
 * CallOverlay - Notebook-style overlay for selecting a voice agent to call.
 * Shows three agent options: Friend, Family, Restaurant.
 * When an agent is selected, initiates a Deepgram Voice Agent WebSocket connection
 * with full microphone streaming and incoming audio playback.
 */
import { useState, useRef, useCallback } from 'react';
import { getAgentConfig, saveConversationSummary, createVoicemail, getDeepgramToken } from '../api';

export default function CallOverlay({ sessionId, onClose, onCallEnd, audioContext, analyserNode }) {
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [callState, setCallState] = useState('idle'); // idle | connecting | connected
  const [error, setError] = useState('');

  // Refs to manage WebSocket, mic stream, and audio processor (not React state to avoid stale closures)
  const wsRef = useRef(null);
  const micStreamRef = useRef(null);
  const processorRef = useRef(null);
  const micCtxRef = useRef(null);

  const agents = [
    { name: 'Friend', desc: 'Friendly gardener in the neighborhood' },
    { name: 'Family', desc: 'Your kid at school with an imagination' },
    { name: 'Restaurant', desc: 'The local Spatula Diner' },
  ];

  /**
   * Convert Float32 PCM samples to Int16 (linear16 encoding for Deepgram).
   * @param {Float32Array} float32
   * @returns {ArrayBuffer}
   */
  function float32ToInt16(float32) {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16.buffer;
  }

  /**
   * Play raw linear16 PCM audio through the AudioContext/AnalyserNode.
   * @param {ArrayBuffer} pcmBuffer - Raw linear16 PCM data at 24000Hz
   */
  function playPCMAudio(pcmBuffer) {
    const ctx = audioContext;
    const analyser = analyserNode;
    if (!ctx) return;

    const int16 = new Int16Array(pcmBuffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    if (analyser) {
      source.connect(analyser);
    } else {
      source.connect(ctx.destination);
    }
    source.start(0);
  }

  /**
   * Clean up mic stream and processor refs.
   */
  function cleanupMic() {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (micCtxRef.current) {
      micCtxRef.current.close().catch(() => {});
      micCtxRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
  }

  /**
   * Initiate a voice agent call via Deepgram WebSocket.
   * Fetches config with context-memory, establishes WS, starts mic streaming.
   */
  const startCall = useCallback(async () => {
    if (!selectedAgent || !sessionId) return;
    setError('');
    setCallState('connecting');

    try {
      // Fetch agent config (includes context-memory) and token in parallel
      const [config, { token }] = await Promise.all([
        getAgentConfig(selectedAgent, sessionId),
        getDeepgramToken(),
      ]);

      const wsUrl = 'wss://agent.deepgram.com/v1/agent/converse';
      const ws = new WebSocket(wsUrl, ['token', token]);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        // Send agent configuration
        const settings = {
          type: 'Settings',
          audio: {
            input: { encoding: 'linear16', sample_rate: 24000 },
            output: { encoding: 'linear16', sample_rate: 24000 },
          },
          agent: {
            language: 'en',
            listen: { provider: { type: 'deepgram', model: 'nova-3' } },
            think: {
              provider: { type: 'open_ai', model: 'gpt-4o-mini', temperature: 0.8 },
              prompt: config.prompt,
            },
            speak: { provider: { type: 'deepgram', model: config.voice_model } },
            greeting: config.greeting,
          },
        };
        ws.send(JSON.stringify(settings));

        // Start microphone streaming
        startMicStreaming(ws);

        setCallState('connected');
      });

      // Handle incoming messages from the voice agent
      ws.addEventListener('message', (event) => {
        if (typeof event.data === 'string') {
          // JSON message — transcript or event from Deepgram
          try {
            const msg = JSON.parse(event.data);
            // Could extract transcript here for context-memory enrichment
            console.log('Agent event:', msg.type, msg);
          } catch { /* ignore non-JSON text */ }
        } else if (event.data instanceof Blob) {
          // Binary message — raw linear16 PCM audio from the agent
          event.data.arrayBuffer().then((buf) => {
            playPCMAudio(buf);
          });
        }
      });

      ws.addEventListener('close', async () => {
        cleanupMic();
        setCallState('idle');
        wsRef.current = null;
        onCallEnd();

        // Save conversation summary using local `config` variable (not React state — avoids stale closure)
        try {
          const summary = `Called ${selectedAgent} (${config.agent_type}) — had a conversation about ${selectedAgent === 'Friend' ? 'gardening' : selectedAgent === 'Family' ? 'school topics' : 'food and dining'}.`;
          await saveConversationSummary(sessionId, selectedAgent, summary);

          // Generate a voicemail notification about the call (BUG-18 fix)
          await createVoicemail(sessionId, `You had a call with ${selectedAgent}. Check back soon for more fun!`);
        } catch (e) {
          console.error('Failed to save summary/voicemail:', e);
        }
      });

      ws.addEventListener('error', () => {
        setError('Connection failed. Check your Deepgram API key.');
        cleanupMic();
        setCallState('idle');
        wsRef.current = null;
        onCallEnd();
      });
    } catch (err) {
      console.error('Failed to start call:', err);
      setError('Failed to start call. Please try again.');
      setCallState('idle');
    }
  }, [selectedAgent, sessionId, audioContext, analyserNode, onCallEnd]);

  /**
   * Start capturing microphone audio and streaming it to the WebSocket.
   * Uses ScriptProcessorNode to convert float32 → int16 PCM for Deepgram.
   */
  async function startMicStreaming(ws) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      micStreamRef.current = stream;

      // Create a dedicated AudioContext for mic at 24000Hz
      const micCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
      micCtxRef.current = micCtx;

      const source = micCtx.createMediaStreamSource(stream);
      const processor = micCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      source.connect(processor);
      processor.connect(micCtx.destination); // needed for the processor to fire

      processor.onaudioprocess = (e) => {
        if (ws.readyState === WebSocket.OPEN) {
          const float32 = e.inputBuffer.getChannelData(0);
          const int16Buffer = float32ToInt16(float32);
          ws.send(int16Buffer);
        }
      };
    } catch (err) {
      console.error('Microphone access denied:', err);
      setError('Microphone access denied. Please enable your mic.');
    }
  }

  /**
   * Hang up the current call — closes WebSocket and cleans up mic.
   */
  const hangUp = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    cleanupMic();
    setCallState('idle');
    setSelectedAgent(null);
  }, []);

  return (
    <div className="notebook">
        <h2 className="notebook-title">Who are you calling?</h2>

        {error && (
          <p style={{ color: '#c62828', fontSize: '0.8rem', marginBottom: '8px' }}>{error}</p>
        )}

        {callState === 'idle' && (
          <>
            <ul className="agent-list">
              {agents.map((agent) => (
                <li
                  key={agent.name}
                  className={selectedAgent === agent.name ? 'selected' : ''}
                  onClick={() => { setSelectedAgent(agent.name); setError(''); }}
                >
                  {agent.name} — {agent.desc}
                </li>
              ))}
            </ul>
            <div style={{ textAlign: 'center', marginTop: '12px' }}>
              <button
                className="notebook-btn primary"
                disabled={!selectedAgent}
                onClick={startCall}
              >
                Dial
              </button>
              <button className="notebook-btn" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}

        {callState === 'connecting' && (
          <div className="call-status">
            <p className="status-text">Connecting to {selectedAgent}...</p>
          </div>
        )}

        {callState === 'connected' && (
          <div className="call-status">
            <p style={{ color: '#333', marginBottom: '8px' }}>
              Talking to <strong>{selectedAgent}</strong>
            </p>
            <p className="status-text">ON AIR</p>
            <button className="hangup-btn" onClick={hangUp}>
              Hang Up
            </button>
          </div>
        )}
      </div>
  );
}
