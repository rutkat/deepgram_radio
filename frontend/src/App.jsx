/**
 * App - Main component for the Deepgram Voice Radio.
 * Manages the 1970s radio UI, session state, and feature overlays.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import Wavescope from './components/Wavescope';
import UserNotebook from './components/UserNotebook';
import CallOverlay from './components/CallOverlay';
import MemoRecorder from './components/MemoRecorder';
import VoicemailPanel from './components/VoicemailPanel';
import { getSession, deleteSession, getVoicemails } from './api';
import './styles/app.css';

export default function App() {
  // Session state
  const [sessionId, setSessionId] = useState(() => localStorage.getItem('radio_session_id') || '');
  const [username, setUsername] = useState(() => localStorage.getItem('radio_username') || '');
  const [showNotebook, setShowNotebook] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Feature overlays
  const [showCall, setShowCall] = useState(false);
  const [showMemo, setShowMemo] = useState(false);
  const [showVoicemail, setShowVoicemail] = useState(false);

  // Audio state
  const [isAudioActive, setIsAudioActive] = useState(false);
  const [analyserNode, setAnalyserNode] = useState(null);
  const [voicemailCount, setVoicemailCount] = useState(0);

  // AudioContext for wavescope visualization
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);

  /**
   * On mount, check for existing session. If none, show the notebook.
   */
  useEffect(() => {
    const init = async () => {
      if (sessionId) {
        try {
          const data = await getSession(sessionId);
          setUsername(data.username);
        } catch {
          localStorage.removeItem('radio_session_id');
          localStorage.removeItem('radio_username');
          setSessionId('');
          setUsername('');
          setShowNotebook(true);
        }
      } else {
        setShowNotebook(true);
      }
      setInitialized(true);
    };
    init();
  }, []);

  /**
   * Poll voicemail count for badge display.
   */
  useEffect(() => {
    if (!sessionId) return;
    const poll = async () => {
      try {
        const vms = await getVoicemails(sessionId);
        setVoicemailCount(vms.filter((v) => !v.is_read).length);
      } catch { /* ignore */ }
    };
    poll();
    const interval = setInterval(poll, 10000);
    return () => clearInterval(interval);
  }, [sessionId]);

  /**
   * Create an AudioContext and AnalyserNode for wavescope visualization.
   * Returns the context and analyser for use by child components.
   */
  const setupAudio = useCallback(() => {
    if (!audioContextRef.current) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = ctx;
      analyserRef.current = ctx.createAnalyser();
      analyserRef.current.fftSize = 2048;
      analyserRef.current.connect(ctx.destination);
      setAnalyserNode(analyserRef.current);
    }
    return { ctx: audioContextRef.current, analyser: analyserRef.current };
  }, []);

  /**
   * Handle new session creation from the UserNotebook overlay.
   */
  const handleSessionCreated = useCallback((sid, uname) => {
    setSessionId(sid);
    setUsername(uname);
    localStorage.setItem('radio_session_id', sid);
    localStorage.setItem('radio_username', uname);
    setShowNotebook(false);
    setupAudio();
  }, [setupAudio]);

  /**
   * Clear the user's profile, session, and all associated data.
   */
  const handleClearProfile = useCallback(async () => {
    if (sessionId) {
      try { await deleteSession(sessionId); } catch { /* ignore */ }
    }
    localStorage.removeItem('radio_session_id');
    localStorage.removeItem('radio_username');
    setSessionId('');
    setUsername('');
    setShowNotebook(true);
    setShowCall(false);
    setShowMemo(false);
    setShowVoicemail(false);
  }, [sessionId]);

  /**
   * Called when a voice agent call ends.
   */
  const handleCallEnd = useCallback(() => {
    setIsAudioActive(false);
  }, []);

  /**
   * Play an audio Blob through the AudioContext/AnalyserNode for wavescope visualization.
   * Used by VoicemailPanel to route TTS audio through the analyser.
   */
  const playAudioThroughAnalyser = useCallback(async (blob) => {
    const { ctx, analyser } = setupAudio();
    if (!ctx) return;

    try {
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(analyser);
      source.start(0);
      return source;
    } catch (err) {
      console.error('Failed to play audio through analyser:', err);
      return null;
    }
  }, [setupAudio]);

  if (!initialized) {
    return (
      <div className="radio">
        <div className="radio-brand"><h1>Vintage AI Telecom Radio</h1></div>
      </div>
    );
  }

  return (
    <>
      <div className="disclaimer">
        Usage: Press Call for real-time voice agent communication. Press Memo for speech-to-text and Voicemail for text-to-speech. This demo is using Deepgram's limited starter API service which may run out of tokens after many visitors. The voice generation is done by Flux multilingual conversational model. Thanks for visiting&#x1FA75;
      </div>
      <div className="radio">

        {/* Radio brand */}
        <div className="radio-brand">
          <h1>Vintage AI Telecom Radio</h1>
        </div>

        {/* Speaker grill with wavescope visualization */}
        <Wavescope isActive={isAudioActive} analyserNode={analyserNode} />

        {/* Control buttons — knobs disabled until session exists */}
        <div className="controls">
          <button
            className={`radio-btn btn-call ${showCall ? 'active' : ''}`}
            disabled={!sessionId}
            onClick={() => {
              setShowCall(!showCall);
              setShowMemo(false);
              setShowVoicemail(false);
            }}
          >
            Call
          </button>
          <button
            className="radio-btn btn-memo"
            disabled={!sessionId}
            onClick={() => {
              setShowMemo(!showMemo);
              setShowCall(false);
              setShowVoicemail(false);
            }}
          >
            Memo
          </button>
          <button
            className="radio-btn btn-voicemail"
            disabled={!sessionId}
            onClick={() => {
              setShowVoicemail(!showVoicemail);
              setShowCall(false);
              setShowMemo(false);
            }}
          >
            Voicemail
            {voicemailCount > 0 && (
              <span className="voicemail-badge">{voicemailCount}</span>
            )}
          </button>
        </div>
      </div>

      {/* Notebook panels — rendered below the radio */}
      {showNotebook && (
        <div className="notebook-panel">
          <UserNotebook
            existingSession={sessionId ? { username } : null}
            onSessionCreated={handleSessionCreated}
            onClearProfile={handleClearProfile}
            onClose={() => setShowNotebook(false)}
            onSelectAgent={(agentName) => {
              setShowNotebook(false);
              setShowCall(true);
            }}
          />
        </div>
      )}

      {showCall && sessionId && (
        <div className="notebook-panel">
          <CallOverlay
            sessionId={sessionId}
            onClose={() => setShowCall(false)}
            onCallEnd={handleCallEnd}
            audioContext={audioContextRef.current}
            analyserNode={analyserRef.current}
          />
        </div>
      )}

      {showMemo && sessionId && (
        <div className="notebook-panel">
          <MemoRecorder
            sessionId={sessionId}
            onClose={() => setShowMemo(false)}
          />
        </div>
      )}

      {showVoicemail && sessionId && (
        <div className="notebook-panel">
          <VoicemailPanel
            sessionId={sessionId}
            onClose={() => setShowVoicemail(false)}
            onPlayingChange={setIsAudioActive}
            playAudioThroughAnalyser={playAudioThroughAnalyser}
          />
        </div>
      )}

    </>
  );
}
