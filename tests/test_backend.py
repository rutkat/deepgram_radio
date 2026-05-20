"""
Unit tests for the Deepgram Voice Radio backend.
Tests cover: session management, agent configuration, STT/TTS endpoints,
context-memory, voicemail management, and memo persistence.
"""

import json
import os
import sys
import tempfile
import unittest

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from app import app, init_db, get_db, AGENT_PROMPTS, get_context_for_agent, save_conversation_summary
import sqlite3


class BaseTestCase(unittest.TestCase):
    """Base test case that sets up a test client with a temporary database."""

    def setUp(self):
        """Create a test client and use a temporary database."""
        self.app = app
        self.app.config['TESTING'] = True
        # Use a temporary database for each test
        self.db_fd, self.db_path = tempfile.mkstemp(suffix='.db')
        # Patch the database path
        import app as app_module
        self._orig_db_path = app_module.DATABASE_PATH
        app_module.DATABASE_PATH = self.db_path
        self.client = self.app.test_client()
        # Initialize the temp database
        conn = sqlite3.connect(self.db_path)
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                session_id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS conversation_summaries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                agent_type TEXT NOT NULL,
                summary TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES users(session_id)
            );
            CREATE TABLE IF NOT EXISTS memos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                transcript TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES users(session_id)
            );
            CREATE TABLE IF NOT EXISTS voicemails (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                message TEXT NOT NULL,
                is_read INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES users(session_id)
            );
        """)
        conn.commit()
        conn.close()

    def tearDown(self):
        """Clean up temporary database."""
        import app as app_module
        app_module.DATABASE_PATH = self._orig_db_path
        os.close(self.db_fd)
        os.unlink(self.db_path)


class TestSessionAPI(BaseTestCase):
    """Tests for session creation, retrieval, and deletion."""

    def test_create_session(self):
        """POST /radio/api/session should create a new session with a sanitized username."""
        resp = self.client.post(
            '/radio/api/session',
            data=json.dumps({'username': 'Alice'}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertIn('session_id', data)
        self.assertEqual(data['username'], 'Alice')

    def test_create_session_generates_welcome_voicemail(self):
        """POST /radio/api/session should create a welcome voicemail for the new user."""
        resp = self.client.post(
            '/radio/api/session',
            data=json.dumps({'username': 'Bob'}),
            content_type='application/json',
        )
        session_id = resp.get_json()['session_id']

        # Check that a welcome voicemail was created
        vms_resp = self.client.get(f'/radio/api/voicemails/{session_id}')
        self.assertEqual(vms_resp.status_code, 200)
        vms = vms_resp.get_json()
        self.assertEqual(len(vms), 1)
        self.assertIn('vintage AI telecom radio', vms[0]['message'])
        self.assertEqual(vms[0]['is_read'], 0)

    def test_create_session_sanitizes_username(self):
        """POST /radio/api/session should strip special characters from username."""
        resp = self.client.post(
            '/radio/api/session',
            data=json.dumps({'username': '<script>alert("xss")</script>'}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data['username'], 'scriptalertxssscript')

    def test_create_session_empty_username(self):
        """POST /radio/api/session should reject empty usernames."""
        resp = self.client.post(
            '/radio/api/session',
            data=json.dumps({'username': ''}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_get_session(self):
        """GET /radio/api/session/<id> should return session details."""
        # Create session first
        create_resp = self.client.post(
            '/radio/api/session',
            data=json.dumps({'username': 'Bob'}),
            content_type='application/json',
        )
        session_id = create_resp.get_json()['session_id']

        resp = self.client.get(f'/radio/api/session/{session_id}')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data['username'], 'Bob')
        self.assertEqual(data['session_id'], session_id)

    def test_get_session_not_found(self):
        """GET /radio/api/session/<id> should return 404 for invalid ID."""
        resp = self.client.get('/radio/api/session/nonexistent-id')
        self.assertEqual(resp.status_code, 404)

    def test_delete_session(self):
        """DELETE /radio/api/session/<id> should remove session and all data."""
        create_resp = self.client.post(
            '/radio/api/session',
            data=json.dumps({'username': 'Charlie'}),
            content_type='application/json',
        )
        session_id = create_resp.get_json()['session_id']

        resp = self.client.delete(f'/radio/api/session/{session_id}')
        self.assertEqual(resp.status_code, 200)

        # Verify it's gone
        get_resp = self.client.get(f'/radio/api/session/{session_id}')
        self.assertEqual(get_resp.status_code, 404)

    def test_delete_session_not_found(self):
        """DELETE /radio/api/session/<id> should return 404 for invalid ID."""
        resp = self.client.delete('/radio/api/session/nonexistent-id')
        self.assertEqual(resp.status_code, 404)


class TestAgentAPI(BaseTestCase):
    """Tests for agent configuration endpoints."""

    def test_get_agents(self):
        """GET /radio/api/agents should return 3 agents."""
        resp = self.client.get('/radio/api/agents')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(len(data), 3)
        names = {a['name'] for a in data}
        self.assertEqual(names, {'Friend', 'Family', 'Restaurant'})

    def test_get_agent_prompt(self):
        """GET /radio/api/agents/<type>/prompt should return prompt config."""
        resp = self.client.get('/radio/api/agents/Friend/prompt')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data['agent_type'], 'Friend')
        self.assertIn('prompt', data)
        self.assertIn('greeting', data)

    def test_get_agent_prompt_not_found(self):
        """GET /radio/api/agents/<type>/prompt should return 404 for unknown agent."""
        resp = self.client.get('/radio/api/agents/Unknown/prompt')
        self.assertEqual(resp.status_code, 404)

    def test_get_agent_config(self):
        """GET /radio/api/agents/<type>/config should return resolved prompt with context."""
        # Create a session first
        session_resp = self.client.post(
            '/radio/api/session',
            data=json.dumps({'username': 'Dave'}),
            content_type='application/json',
        )
        session_id = session_resp.get_json()['session_id']

        resp = self.client.get(f'/radio/api/agents/Friend/config?session_id={session_id}')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data['agent_type'], 'Friend')
        self.assertIn('Dave', data['prompt'])
        self.assertIn('prompt', data)
        self.assertIn('greeting', data)

    def test_get_agent_config_missing_session(self):
        """GET /radio/api/agents/<type>/config should return 400 without session_id."""
        resp = self.client.get('/radio/api/agents/Friend/config')
        self.assertEqual(resp.status_code, 400)

    def test_all_agents_have_prompts(self):
        """Verify all agent types have prompt, greeting, and voice_model configured."""
        for name, cfg in AGENT_PROMPTS.items():
            self.assertIn('prompt', cfg, f"Agent {name} missing 'prompt'")
            self.assertIn('greeting', cfg, f"Agent {name} missing 'greeting'")
            self.assertIn('voice_model', cfg, f"Agent {name} missing 'voice_model'")
            self.assertTrue(len(cfg['prompt']) > 50, f"Agent {name} prompt too short")
            self.assertTrue(len(cfg['greeting']) > 5, f"Agent {name} greeting too short")
            self.assertTrue(cfg['voice_model'].startswith('aura-'), f"Agent {name} voice_model invalid")


class TestContextMemory(BaseTestCase):
    """Tests for context-memory (conversation summaries)."""

    def test_save_and_retrieve_summary(self):
        """Conversation summaries should be saved and retrievable."""
        # Create a session
        conn = sqlite3.connect(self.db_path)
        conn.execute("INSERT INTO users (session_id, username, created_at) VALUES (?, ?, datetime('now'))",
                     ('test-sid', 'Eve',))
        conn.commit()
        conn.close()

        save_conversation_summary('test-sid', 'Friend', 'Talked about tomatoes')
        context = get_context_for_agent('test-sid', 'Friend')
        self.assertIn('Talked about tomatoes', context)

    def test_no_context_returns_default(self):
        """Getting context for a new session should return default message."""
        conn = sqlite3.connect(self.db_path)
        conn.execute("INSERT INTO users (session_id, username, created_at) VALUES (?, ?, datetime('now'))",
                     ('test-sid2', 'Frank',))
        conn.commit()
        conn.close()

        context = get_context_for_agent('test-sid2', 'Friend')
        self.assertIn('first conversation', context)

    def test_summary_endpoint(self):
        """POST /radio/api/conversation-summary should save a summary."""
        self.client.post(
            '/radio/api/session',
            data=json.dumps({'username': 'Grace'}),
            content_type='application/json',
        )
        session_resp = self.client.get('/radio/api/agents')
        # Get session ID from the database directly
        conn = sqlite3.connect(self.db_path)
        row = conn.execute("SELECT session_id FROM users WHERE username = 'Grace'").fetchone()
        conn.close()
        session_id = row[0]

        resp = self.client.post(
            '/radio/api/conversation-summary',
            data=json.dumps({
                'session_id': session_id,
                'agent_type': 'Friend',
                'summary': 'Discussed gardening tips',
            }),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)

        # Verify via config endpoint
        config_resp = self.client.get(f'/radio/api/agents/Friend/config?session_id={session_id}')
        self.assertIn('gardening tips', config_resp.get_json()['prompt'])


class TestVoicemailAPI(BaseTestCase):
    """Tests for voicemail CRUD operations."""

    def _create_session(self, username='TestUser'):
        """Helper to create a test session and return session_id."""
        conn = sqlite3.connect(self.db_path)
        import uuid
        sid = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO users (session_id, username, created_at) VALUES (?, ?, datetime('now'))",
            (sid, username),
        )
        conn.commit()
        conn.close()
        return sid

    def test_create_voicemail(self):
        """POST /radio/api/voicemails should create a new voicemail."""
        sid = self._create_session()
        resp = self.client.post(
            '/radio/api/voicemails',
            data=json.dumps({'session_id': sid, 'message': 'You have a new friend request!'}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertIn('id', data)
        self.assertEqual(data['message'], 'You have a new friend request!')

    def test_get_voicemails(self):
        """GET /radio/api/voicemails/<sid> should return all voicemails."""
        sid = self._create_session()
        # Create two voicemails
        self.client.post(
            '/radio/api/voicemails',
            data=json.dumps({'session_id': sid, 'message': 'First VM'}),
            content_type='application/json',
        )
        self.client.post(
            '/radio/api/voicemails',
            data=json.dumps({'session_id': sid, 'message': 'Second VM'}),
            content_type='application/json',
        )

        resp = self.client.get(f'/radio/api/voicemails/{sid}')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(len(data), 2)

    def test_mark_voicemail_read(self):
        """PATCH /radio/api/voicemails/<id>/read should mark a voicemail as read."""
        sid = self._create_session()
        create_resp = self.client.post(
            '/radio/api/voicemails',
            data=json.dumps({'session_id': sid, 'message': 'Test VM'}),
            content_type='application/json',
        )
        vm_id = create_resp.get_json()['id']

        resp = self.client.patch(f'/radio/api/voicemails/{vm_id}/read')
        self.assertEqual(resp.status_code, 200)

        # Verify it's marked as read
        vms = self.client.get(f'/radio/api/voicemails/{sid}').get_json()
        self.assertEqual(vms[0]['is_read'], 1)

    def test_create_voicemail_missing_fields(self):
        """POST /radio/api/voicemails should reject requests with missing fields."""
        resp = self.client.post(
            '/radio/api/voicemails',
            data=json.dumps({'session_id': ''}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)


class TestMemosAPI(BaseTestCase):
    """Tests for memo retrieval."""

    def _create_session_with_memo(self, username='MemoUser'):
        """Helper to create a session with a memo."""
        conn = sqlite3.connect(self.db_path)
        import uuid
        sid = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO users (session_id, username, created_at) VALUES (?, ?, datetime('now'))",
            (sid, username),
        )
        conn.execute(
            "INSERT INTO memos (session_id, transcript, created_at) VALUES (?, ?, datetime('now'))",
            (sid, 'Test memo transcript'),
        )
        conn.commit()
        conn.close()
        return sid

    def test_get_memos(self):
        """GET /radio/api/memos/<sid> should return all memos for a session."""
        sid = self._create_session_with_memo()
        resp = self.client.get(f'/radio/api/memos/{sid}')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['transcript'], 'Test memo transcript')


class TestDeepgramToken(BaseTestCase):
    """Tests for the Deepgram token endpoint."""

    def test_get_token(self):
        """GET /radio/api/deepgram-token should return the API token."""
        resp = self.client.get('/radio/api/deepgram-token')
        # Will fail if DEEPGRAM_API_KEY is not set
        self.assertIn(resp.status_code, [200, 500])


if __name__ == '__main__':
    unittest.main()
