/**
 * VoicemailPanel - Displays voicemail notifications and plays them via TTS.
 * Routes audio through the AudioContext/AnalyserNode for wavescope visualization.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { getVoicemails, markVoicemailRead, synthesizeSpeech } from '../api';

export default function VoicemailPanel({ sessionId, onClose, onPlayingChange, playAudioThroughAnalyser }) {
  const [voicemails, setVoicemails] = useState([]);
  const [playing, setPlaying] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const currentSourceRef = useRef(null);

  useEffect(() => {
    if (sessionId) {
      getVoicemails(sessionId)
        .then((vms) => { setVoicemails(vms); setLoading(false); })
        .catch((err) => { console.error(err); setError('Failed to load voicemails'); setLoading(false); });
    }
  }, [sessionId]);

  /**
   * Play a voicemail using TTS, routing audio through the AnalyserNode for visualization.
   */
  const playVoicemail = useCallback(async (vm) => {
    try {
      setPlaying(vm.id);
      setError('');
      onPlayingChange(true);

      const audioBlob = await synthesizeSpeech(vm.message, sessionId);

      // Stop any currently playing audio
      if (currentSourceRef.current) {
        try { currentSourceRef.current.stop(); } catch { /* already stopped */ }
      }

      // Route through AudioContext/AnalyserNode for wavescope (BUG-14 fix)
      if (playAudioThroughAnalyser) {
        const source = await playAudioThroughAnalyser(audioBlob);
        if (source) {
          currentSourceRef.current = source;
          source.onended = () => {
            setPlaying(null);
            onPlayingChange(false);
            currentSourceRef.current = null;
          };
        }
      } else {
        // Fallback: play without analyser
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audio.onended = () => {
          setPlaying(null);
          onPlayingChange(false);
          URL.revokeObjectURL(audioUrl);
        };
        await audio.play();
      }

      // Mark as read
      if (!vm.is_read) {
        await markVoicemailRead(vm.id);
        setVoicemails((prev) =>
          prev.map((v) => (v.id === vm.id ? { ...v, is_read: 1 } : v))
        );
      }
    } catch (err) {
      console.error('Failed to play voicemail:', err);
      setError('Failed to play voicemail.');
      setPlaying(null);
      onPlayingChange(false);
    }
  }, [sessionId, onPlayingChange, playAudioThroughAnalyser]);

  const unreadCount = voicemails.filter((v) => !v.is_read).length;

  return (
    <div className="notebook">
        <h2 className="notebook-title">Voicemails ({unreadCount} new)</h2>

        {error && (
          <p style={{ color: '#c62828', fontSize: '0.8rem' }}>{error}</p>
        )}

        {loading ? (
          <p>Loading voicemails...</p>
        ) : voicemails.length === 0 ? (
          <p>No voicemails yet.</p>
        ) : (
          <ul className="voicemail-list">
            {voicemails.map((vm) => (
              <li
                key={vm.id}
                className={`voicemail-item ${vm.is_read ? 'read' : 'unread'}`}
                onClick={() => playVoicemail(vm)}
              >
                {playing === vm.id ? '>> Playing... ' : ''}
                {vm.message}
              </li>
            ))}
          </ul>
        )}

        <div style={{ textAlign: 'center', marginTop: '12px' }}>
          <button className="notebook-btn" onClick={onClose}>Close</button>
        </div>
      </div>
  );
}
