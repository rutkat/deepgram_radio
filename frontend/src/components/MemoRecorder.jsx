/**
 * MemoRecorder - Records audio from the microphone and sends it for STT transcription.
 * Displays the transcript as a memo.
 */
import { useState, useRef, useCallback } from 'react';
import { transcribeAudio } from '../api';

export default function MemoRecorder({ sessionId, onClose }) {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);

  /**
   * Start recording audio from the microphone.
   * Records as audio/webm which is widely supported and accepted by Deepgram.
   */
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Use webm if supported, fallback to whatever MediaRecorder supports
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks immediately
        stream.getTracks().forEach((t) => t.stop());

        // Create blob with the correct MIME type matching what we recorded
        const blob = new Blob(chunksRef.current, { type: mimeType.split(';')[0] });
        setLoading(true);
        setError('');
        try {
          const result = await transcribeAudio(blob, sessionId);
          setTranscript(result.transcript);
        } catch (err) {
          console.error('Transcription failed:', err);
          setError('Transcription failed. Please try again.');
          setTranscript('');
        } finally {
          setLoading(false);
        }
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
    } catch (err) {
      console.error('Microphone access denied:', err);
      setError('Microphone access denied. Please enable your mic.');
    }
  }, [sessionId]);

  /**
   * Stop recording and trigger transcription.
   */
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, []);

  return (
    <div className="notebook">
        <h2 className="notebook-title">Voice Memo</h2>

        <p>Record a voice memo. Your speech will be transcribed to text.</p>

        {error && (
          <p style={{ color: '#c62828', fontSize: '0.8rem' }}>{error}</p>
        )}

        <div style={{ textAlign: 'center', margin: '16px 0' }}>
          {!isRecording ? (
            <button
              className="notebook-btn primary"
              onClick={startRecording}
              disabled={loading}
            >
              {loading ? 'Transcribing...' : 'Start Recording'}
            </button>
          ) : (
            <button
              className="notebook-btn danger"
              onClick={stopRecording}
            >
              Stop Recording
            </button>
          )}
        </div>

        {transcript && (
          <div className="memo-display">
            <strong>Your memo:</strong><br />
            {transcript}
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: '12px' }}>
          <button className="notebook-btn" onClick={onClose}>Close</button>
        </div>
      </div>
  );
}
