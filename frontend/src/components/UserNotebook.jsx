/**
 * UserNotebook - First-load overlay that collects the user's name and
 * shows the welcome message. Also provides profile management and agent selection.
 * Includes: close button, clear profile, and selectable agent toggles.
 */
import { useState } from 'react';
import { createSession } from '../api';

export default function UserNotebook({ onSessionCreated, existingSession, onClearProfile, onClose, onSelectAgent }) {
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedAgent, setSelectedAgent] = useState(null);

  const agents = [
    { name: 'Friend', desc: 'Neighborhood buddy' },
    { name: 'Family', desc: 'Kid at school' },
    { name: 'Restaurant', desc: 'The Golden Spatula Diner' },
  ];

  /**
   * Handle username submission — sanitizes input and creates session.
   */
  const handleSubmit = async (e) => {
    e.preventDefault();
    // Sanitize: alphanumeric, spaces, hyphens, apostrophes only
    const sanitized = username.replace(/[^a-zA-Z0-9 \-']/g, '').trim();
    if (!sanitized) return;
    setLoading(true);
    setError('');
    try {
      const data = await createSession(sanitized);
      onSessionCreated(data.session_id, data.username);
    } catch (err) {
      console.error('Failed to create session:', err);
      setError('Failed to create session. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle agent selection from the notebook — close notebook and open call.
   */
  const handleAgentSelect = (agentName) => {
    setSelectedAgent(agentName);
    if (onSelectAgent) {
      onSelectAgent(agentName);
    }
  };

  return (
    <div className="notebook">
        {/* Close button (BUG-13 fix) */}
        {existingSession && onClose && (
          <div style={{ textAlign: 'right', marginBottom: '8px' }}>
            <button className="notebook-btn" onClick={onClose} style={{ fontSize: '0.7rem' }}>
              Close
            </button>
          </div>
        )}

        <h2 className="notebook-title">
          {existingSession ? `${existingSession.username}'s Notebook` : 'Your Notebook'}
        </h2>

        <p>
          Welcome to your communications radio where you can call friends, family and
          shops! Ensure your microphone is enabled since this device is voice-only.
        </p>

        {error && (
          <p style={{ color: '#c62828', fontSize: '0.8rem' }}>{error}</p>
        )}

        {!existingSession && (
          <form onSubmit={handleSubmit}>
            <p>What's your name?</p>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your name..."
              maxLength={50}
              autoFocus
            />
            <button
              type="submit"
              className="notebook-btn primary"
              disabled={loading || !username.trim()}
            >
              {loading ? 'Starting...' : 'Start'}
            </button>
          </form>
        )}

        {existingSession && (
          <div style={{ marginTop: '16px' }}>
            <p style={{ fontSize: '0.8rem', color: '#666' }}>
              Select a contact to call:
            </p>
            {/* Agent names as selectable toggles (BUG-17 fix) */}
            <ul className="agent-list">
              {agents.map((agent) => (
                <li
                  key={agent.name}
                  className={selectedAgent === agent.name ? 'selected' : ''}
                  onClick={() => handleAgentSelect(agent.name)}
                >
                  {agent.name} — {agent.desc}
                </li>
              ))}
            </ul>

            {/* Clear Profile button inside notebook (BUG-12 fix) */}
            <div style={{ textAlign: 'center', marginTop: '16px' }}>
              <button
                className="notebook-btn danger"
                onClick={onClearProfile}
                style={{ fontSize: '0.75rem' }}
              >
                Clear Profile
              </button>
            </div>
          </div>
        )}
      </div>
  );
}
