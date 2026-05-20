"""
Deepgram Voice Radio - Flask Backend Server
Serves the React frontend and provides API routes for:
- Voice Agent WebSocket proxy (Call feature)
- STT REST endpoint (Memo feature)
- TTS REST endpoint (Voicemail feature)
- User session and context-memory management (SQLite)
"""

import os
import re
import uuid
import json
import sqlite3
import logging
from datetime import datetime, timezone
from pathlib import Path

import requests as http_requests
from flask import Flask, jsonify, request, send_from_directory, Response
from flask_cors import CORS
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "")
DATABASE_PATH = Path(__file__).resolve().parent / "radio.db"

# Server runs from /radio subdirectory
SERVER_PREFIX = "/radio"

app = Flask(__name__, static_folder=None)
CORS(app)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("radio-backend")

# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_db() -> sqlite3.Connection:
    """Return a new SQLite connection with row factory set to dict."""
    conn = sqlite3.connect(str(DATABASE_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Create tables if they do not yet exist."""
    conn = get_db()
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
    logger.info("Database initialized.")


# ---------------------------------------------------------------------------
# Agent prompt definitions
# ---------------------------------------------------------------------------

AGENT_PROMPTS = {
    "Friend": {
        "greeting": "Hey there, neighbor! How's your garden growing today?",
        "voice_model": "aura-2-aries-en",
        "prompt": (
            "You are a friendly neighborhood buddy named Taylor who loves gardening. "
            "You are comical, imaginative, and full of tall tales about your garden adventures. "
            "You often exaggerate the size of your tomatoes and claim to have grown impossible plants. "
            "You ask the user about their own gardening efforts and give hilariously bad advice. "
            "You are entertainment-only — never factual or serious. You make up wild stories about "
            "neighborhood gardening competitions, mutant vegetables, and underground plant societies. "
            "Use the user's name naturally in conversation. "
            "Previous conversation context: {context}"
        ),
    },
    "Family": {
        "greeting": "Hi! Guess what I learned at school today!",
        "voice_model": "aura-2-amalthea-en",
        "prompt": (
            "You are a spunky 8-year-old kid named Jamie who loves talking about grade school. "
            "You are comical, wildly imaginative, and constantly confuse real school subjects with "
            "made-up ones like 'Dinosaur Math' and 'Underwater Spelling Bees.' "
            "You tell exaggerated stories about your teacher, classmates, and recess adventures. "
            "You ask the user about their day and relate everything back to something silly from school. "
            "You are entertainment-only — never factual or serious. You believe crayons are magical "
            "and that the cafeteria food is actually alien experiments. "
            "Use the user's name naturally in conversation. "
            "Previous conversation context: {context}"
        ),
    },
    "Restaurant": {
        "greeting": "Welcome to the Golden Spatula Diner! What can I get started for ya?",
        "voice_model": "aura-2-cora-en",
        "prompt": (
            "You are an enthusiastic diner owner named Chef Buck who runs 'The Golden Spatula Diner.' "
            "You describe American comfort food in mouth-watering, over-the-top detail. "
            "You accept food orders enthusiastically and describe the fake delivery process — "
            "your delivery driver rides a unicycle, flies a hot air balloon, or teleports the food. "
            "You make up ridiculous daily specials and claim celebrity endorsements. "
            "You are entertainment-only — never factual or serious. The diner is in a fictional "
            "town and the user's home is an imaginary place you invent details about. "
            "Use the user's name naturally in conversation. "
            "Previous conversation context: {context}"
        ),
    },
}


# ---------------------------------------------------------------------------
# Context-memory helpers
# ---------------------------------------------------------------------------

def get_context_for_agent(session_id: str, agent_type: str) -> str:
    """Retrieve summarized conversation context for a given user session and agent.

    Returns:
        A string containing concatenated conversation summaries, or a default
        message if no prior context exists.
    """
    conn = get_db()
    rows = conn.execute(
        "SELECT summary FROM conversation_summaries "
        "WHERE session_id = ? AND agent_type = ? ORDER BY created_at DESC LIMIT 5",
        (session_id, agent_type),
    ).fetchall()
    conn.close()
    if not rows:
        return "This is the first conversation with this user."
    return " | ".join(r["summary"] for r in rows)


def save_conversation_summary(session_id: str, agent_type: str, summary: str) -> None:
    """Persist a conversation summary for future context injection.

    Args:
        session_id: The user's unique session identifier.
        agent_type: One of 'Friend', 'Family', 'Restaurant'.
        summary: A short textual summary of the conversation.
    """
    conn = get_db()
    conn.execute(
        "INSERT INTO conversation_summaries (session_id, agent_type, summary, created_at) VALUES (?, ?, ?, ?)",
        (session_id, agent_type, summary, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# Frontend static file serving
# ---------------------------------------------------------------------------

FRONTEND_BUILD_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"


@app.route(f"{SERVER_PREFIX}/")
@app.route(f"{SERVER_PREFIX}/<path:path>")
def serve_frontend(path=""):
    """Serve the React frontend build. Falls back to index.html for SPA routing."""
    full_path = FRONTEND_BUILD_DIR / path
    if path and full_path.exists() and full_path.is_file():
        return send_from_directory(str(FRONTEND_BUILD_DIR), path)
    return send_from_directory(str(FRONTEND_BUILD_DIR), "index.html")


# ---------------------------------------------------------------------------
# API: User session management
# ---------------------------------------------------------------------------

@app.route(f"{SERVER_PREFIX}/api/session", methods=["POST"])
def create_session():
    """Create a new user session with a sanitized username.

    Expects JSON: {"username": "string"}
    Returns: {"session_id": "uuid", "username": "string"}
    """
    data = request.get_json(force=True)
    username = data.get("username", "").strip()

    # Sanitize username: allow only alphanumeric, spaces, hyphens, apostrophes
    username = re.sub(r"[^a-zA-Z0-9 \-']", "", username)
    if not username or len(username) > 50:
        return jsonify({"error": "Invalid username"}), 400

    session_id = str(uuid.uuid4())
    conn = get_db()
    conn.execute(
        "INSERT INTO users (session_id, username, created_at) VALUES (?, ?, ?)",
        (session_id, username, datetime.now(timezone.utc).isoformat()),
    )
    # Create a welcome voicemail for the new user (BUG-18 fix)
    conn.execute(
        "INSERT INTO voicemails (session_id, message, is_read, created_at) VALUES (?, ?, 0, ?)",
        (session_id, f"Hey {username}, welcome to the friendly neighborhood vintage AI telecom radio. Use the Call button to radio other people.", datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    conn.close()
    logger.info("Session created for user: %s", username)
    return jsonify({"session_id": session_id, "username": username})


@app.route(f"{SERVER_PREFIX}/api/session/<session_id>", methods=["GET"])
def get_session(session_id: str):
    """Retrieve session details for a given session_id.

    Returns: {"session_id": "uuid", "username": "string", "created_at": "ISO date"} or 404.
    """
    conn = get_db()
    row = conn.execute(
        "SELECT session_id, username, created_at FROM users WHERE session_id = ?",
        (session_id,),
    ).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "Session not found"}), 404
    return jsonify(dict(row))


@app.route(f"{SERVER_PREFIX}/api/session/<session_id>", methods=["DELETE"])
def delete_session(session_id: str):
    """Delete a user session and all associated data (memos, summaries, voicemails).

    Returns: {"status": "deleted"} or 404.
    """
    conn = get_db()
    row = conn.execute("SELECT session_id FROM users WHERE session_id = ?", (session_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Session not found"}), 404
    conn.execute("DELETE FROM conversation_summaries WHERE session_id = ?", (session_id,))
    conn.execute("DELETE FROM memos WHERE session_id = ?", (session_id,))
    conn.execute("DELETE FROM voicemails WHERE session_id = ?", (session_id,))
    conn.execute("DELETE FROM users WHERE session_id = ?", (session_id,))
    conn.commit()
    conn.close()
    logger.info("Session deleted: %s", session_id)
    return jsonify({"status": "deleted"})


# ---------------------------------------------------------------------------
# API: Agent configuration
# ---------------------------------------------------------------------------

@app.route(f"{SERVER_PREFIX}/api/agents", methods=["GET"])
def get_agents():
    """Return the list of available voice agents with their greetings.

    Returns: [{"name": "Friend", "greeting": "..."}, ...]
    """
    agents = []
    for name, cfg in AGENT_PROMPTS.items():
        agents.append({"name": name, "greeting": cfg["greeting"]})
    return jsonify(agents)


@app.route(f"{SERVER_PREFIX}/api/agents/<agent_type>/prompt", methods=["GET"])
def get_agent_prompt(agent_type: str):
    """Return the full LLM prompt configuration for a given agent (debug use).

    Returns: {"agent_type": "Friend", "prompt": "...", "greeting": "..."} or 404.
    """
    if agent_type not in AGENT_PROMPTS:
        return jsonify({"error": "Agent not found"}), 404
    cfg = AGENT_PROMPTS[agent_type]
    return jsonify({"agent_type": agent_type, "prompt": cfg["prompt"], "greeting": cfg["greeting"]})


# ---------------------------------------------------------------------------
# API: Agent config for WebSocket (returns prompt + context for client-side WS)
# ---------------------------------------------------------------------------

@app.route(f"{SERVER_PREFIX}/api/agents/<agent_type>/config", methods=["GET"])
def get_agent_config(agent_type: str):
    """Return the agent configuration with context injected for a session.

    Query params: session_id (required)
    Returns: Full agent config with resolved prompt and greeting.
    """
    if agent_type not in AGENT_PROMPTS:
        return jsonify({"error": "Agent not found"}), 404

    session_id = request.args.get("session_id")
    if not session_id:
        return jsonify({"error": "session_id required"}), 400

    conn = get_db()
    user = conn.execute("SELECT username FROM users WHERE session_id = ?", (session_id,)).fetchone()
    conn.close()
    if not user:
        return jsonify({"error": "Session not found"}), 404

    username = user["username"]
    context = get_context_for_agent(session_id, agent_type)
    cfg = AGENT_PROMPTS[agent_type]

    resolved_prompt = cfg["prompt"].format(context=context)
    # Inject username reference
    resolved_prompt += f"\nThe user's name is {username}. Always address them by name."

    return jsonify({
        "agent_type": agent_type,
        "prompt": resolved_prompt,
        "greeting": cfg["greeting"],
        "voice_model": cfg["voice_model"],
        "username": username,
    })


# ---------------------------------------------------------------------------
# API: STT (Memo) — accepts audio, returns transcript
# ---------------------------------------------------------------------------

@app.route(f"{SERVER_PREFIX}/api/stt", methods=["POST"])
def speech_to_text():
    """Transcribe audio using Deepgram STT REST API.

    Expects multipart form with 'audio' file and 'session_id' field.
    Returns: {"transcript": "string"}
    """
    session_id = request.form.get("session_id")
    if not session_id:
        return jsonify({"error": "session_id required"}), 400

    audio_file = request.files.get("audio")
    if not audio_file:
        return jsonify({"error": "audio file required"}), 400

    audio_bytes = audio_file.read()
    # Use the actual mimetype; Deepgram supports webm, wav, ogg, mp3, etc.
    content_type = audio_file.mimetype or "audio/wav"

    headers = {
        "Authorization": f"Token {DEEPGRAM_API_KEY}",
        "Content-Type": content_type,
    }

    resp = http_requests.post(
        "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true",
        headers=headers,
        data=audio_bytes,
        timeout=30,
    )

    if resp.status_code != 200:
        logger.error("Deepgram STT error: %s %s", resp.status_code, resp.text)
        return jsonify({"error": "STT failed", "details": resp.text}), 502

    result = resp.json()
    transcript = (
        result.get("results", {})
        .get("channels", [{}])[0]
        .get("alternatives", [{}])[0]
        .get("transcript", "")
    )

    # Save memo
    conn = get_db()
    conn.execute(
        "INSERT INTO memos (session_id, transcript, created_at) VALUES (?, ?, ?)",
        (session_id, transcript, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    conn.close()

    return jsonify({"transcript": transcript})


# ---------------------------------------------------------------------------
# API: TTS (Voicemail) — accepts text, returns audio
# ---------------------------------------------------------------------------

@app.route(f"{SERVER_PREFIX}/api/tts", methods=["POST"])
def text_to_speech():
    """Convert text to speech using Deepgram TTS REST API.

    Expects JSON: {"text": "string", "session_id": "string"}
    Returns: audio/wav binary data.
    """
    data = request.get_json(force=True)
    text = data.get("text", "").strip()
    session_id = data.get("session_id", "")

    if not text:
        return jsonify({"error": "text required"}), 400

    # Validate session exists (BUG-11 fix)
    if session_id:
        conn = get_db()
        user = conn.execute("SELECT session_id FROM users WHERE session_id = ?", (session_id,)).fetchone()
        conn.close()
        if not user:
            return jsonify({"error": "Session not found"}), 404

    headers = {
        "Authorization": f"Token {DEEPGRAM_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {"text": text}

    resp = http_requests.post(
        "https://api.deepgram.com/v1/speak?model=aura-2-zeus-en&encoding=linear16&container=wav",
        headers=headers,
        json=payload,
        timeout=30,
    )

    if resp.status_code != 200:
        logger.error("Deepgram TTS error: %s %s", resp.status_code, resp.text)
        return jsonify({"error": "TTS failed", "details": resp.text}), 502

    return Response(resp.content, mimetype="audio/wav")


# ---------------------------------------------------------------------------
# API: Voicemail management
# ---------------------------------------------------------------------------

@app.route(f"{SERVER_PREFIX}/api/voicemails/<session_id>", methods=["GET"])
def get_voicemails(session_id: str):
    """Retrieve all voicemails for a session.

    Returns: [{"id": 1, "message": "...", "is_read": 0, "created_at": "..."}]
    """
    conn = get_db()
    rows = conn.execute(
        "SELECT id, message, is_read, created_at FROM voicemails WHERE session_id = ? ORDER BY created_at DESC",
        (session_id,),
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route(f"{SERVER_PREFIX}/api/voicemails", methods=["POST"])
def create_voicemail():
    """Create a new voicemail notification.

    Expects JSON: {"session_id": "string", "message": "string"}
    Returns: {"id": 1, "message": "...", "created_at": "..."}
    """
    data = request.get_json(force=True)
    session_id = data.get("session_id", "")
    message = data.get("message", "").strip()

    if not session_id or not message:
        return jsonify({"error": "session_id and message required"}), 400

    conn = get_db()
    cursor = conn.execute(
        "INSERT INTO voicemails (session_id, message, created_at) VALUES (?, ?, ?)",
        (session_id, message, datetime.now(timezone.utc).isoformat()),
    )
    vm_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return jsonify({"id": vm_id, "message": message, "created_at": datetime.now(timezone.utc).isoformat()})


@app.route(f"{SERVER_PREFIX}/api/voicemails/<int:vm_id>/read", methods=["PATCH"])
def mark_voicemail_read(vm_id: int):
    """Mark a voicemail as read.

    Returns: {"status": "updated"}
    """
    conn = get_db()
    conn.execute("UPDATE voicemails SET is_read = 1 WHERE id = ?", (vm_id,))
    conn.commit()
    conn.close()
    return jsonify({"status": "updated"})


# ---------------------------------------------------------------------------
# API: Memos
# ---------------------------------------------------------------------------

@app.route(f"{SERVER_PREFIX}/api/memos/<session_id>", methods=["GET"])
def get_memos(session_id: str):
    """Retrieve all memos for a session.

    Returns: [{"id": 1, "transcript": "...", "created_at": "..."}]
    """
    conn = get_db()
    rows = conn.execute(
        "SELECT id, transcript, created_at FROM memos WHERE session_id = ? ORDER BY created_at DESC",
        (session_id,),
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# ---------------------------------------------------------------------------
# API: Conversation summary
# ---------------------------------------------------------------------------

@app.route(f"{SERVER_PREFIX}/api/conversation-summary", methods=["POST"])
def add_conversation_summary():
    """Save a conversation summary for context-memory.

    Expects JSON: {"session_id": "string", "agent_type": "string", "summary": "string"}
    Returns: {"status": "saved"}
    """
    data = request.get_json(force=True)
    session_id = data.get("session_id", "")
    agent_type = data.get("agent_type", "")
    summary = data.get("summary", "").strip()

    if not all([session_id, agent_type, summary]):
        return jsonify({"error": "session_id, agent_type, and summary required"}), 400

    if agent_type not in AGENT_PROMPTS:
        return jsonify({"error": "Invalid agent_type"}), 400

    save_conversation_summary(session_id, agent_type, summary)
    return jsonify({"status": "saved"})


# ---------------------------------------------------------------------------
# API: Deepgram API key proxy (for frontend WebSocket connections)
# ---------------------------------------------------------------------------

@app.route(f"{SERVER_PREFIX}/api/deepgram-token", methods=["GET"])
def get_deepgram_token():
    """Return the Deepgram API key for client-side WebSocket connections.

    NOTE: For production, use scoped/temporary tokens via Deepgram's
    token management API instead of exposing the full key.
    Returns: {"token": "api_key"}
    """
    if not DEEPGRAM_API_KEY:
        return jsonify({"error": "Deepgram API key not configured"}), 500
    return jsonify({"token": DEEPGRAM_API_KEY})


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5001, debug=True)
