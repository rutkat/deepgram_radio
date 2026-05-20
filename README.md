# Deepgram Voice Radio

A mobile-responsive, 1970s classic-look web app styled as a vintage radio with a speaker grill that displays a green wavescope during audio playback. The app uses Deepgram's Voice Agent API, Speech-to-Text REST API, and Text-to-Speech REST API for voice interactions.

## Purpose

An instructional web application demonstrating Deepgram's voice tools and APIs. Three comical, entertainment-only voice agents interact with users through a retro radio interface:

- **Friend** — A neighborhood buddy who talks about gardening (imaginative, not factual)
- **Family** — A kid who discusses grade school topics with wild imagination
- **Restaurant** — A diner owner who takes fake food orders at The Golden Spatula Diner

The app supports voice calls, voice memos, and voicemail notifications — all voice-driven.

## Tech Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Frontend | React | 19.2.6 |
| Frontend Build | Vite | 9.x |
| Backend | Flask (Python) | 3.1.3 |
| Database | SQLite | (built-in with Python 3.13) |
| Runtime | Python | 3.13.x |
| Runtime | Node.js | 24.x |
| Voice Agent | Deepgram Voice Agent API | v1 |
| STT | Deepgram STT REST API | v1 (nova-3) |
| TTS | Deepgram TTS REST API | v1 (aura-2-thalia-en) |
| Visualization | Canvas 2D API | (browser native) |

## Deepgram API Usage

| Feature | API | Endpoint |
|---------|-----|----------|
| Call | Voice Agent WebSocket | `wss://api.deepgram.com/v1/agent/converse` |
| Memo | STT Pre-recorded REST | `POST https://api.deepgram.com/v1/listen` |
| Voicemail | TTS REST | `POST https://api.deepgram.com/v1/speak` |

### Voice Agent Configuration

- **STT Model**: Deepgram nova-3
- **TTS Model**: Deepgram aura-2-thalia-en
- **LLM**: OpenAI gpt-4o-mini
- **Temperature**: 0.8 (creative role play)
- **Audio Encoding**: linear16, 24000 Hz

## Installation

### Prerequisites

- Python 3.13+
- Node.js 24+
- npm 11+
- A Deepgram API key ([get one here](https://console.deepgram.com/))

### Setup

1. Clone the repository and navigate to the project directory.

2. Create a `.env` file in the project root:
   ```
   DEEPGRAM_API_KEY=your_deepgram_api_key_here
   ```

3. Install Python backend dependencies:
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

4. Install frontend dependencies:
   ```bash
   cd frontend
   npm install
   ```

5. Build the frontend:
   ```bash
   npm run build
   ```

### Running

Start the Flask backend (serves both the API and the built frontend):
```bash
cd backend
python app.py
```

The app is served at `http://localhost:5001/radio/`

For development with hot-reload on the frontend:
```bash
cd frontend
npm run dev
```

The Vite dev server proxies API requests to the Flask backend.

## Project Structure

```
deepgram_radio/
├── backend/
│   ├── app.py              # Flask server, API routes, SQLite models
│   ├── requirements.txt    # Python dependencies
│   └── radio.db            # SQLite database (created at runtime)
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Wavescope.jsx      # Canvas 2D green oscilloscope
│   │   │   ├── UserNotebook.jsx   # First-load name input overlay
│   │   │   ├── CallOverlay.jsx    # Agent selection and call UI
│   │   │   ├── MemoRecorder.jsx   # Voice memo via STT
│   │   │   ├── VoicemailPanel.jsx # Voicemail list and TTS playback
│   │   │   └── DebugWindow.jsx    # Agent prompts debug panel
│   │   ├── styles/
│   │   │   └── app.css            # 1970s radio styles
│   │   ├── api.js                 # API utility module
│   │   ├── App.jsx                # Main app component
│   │   └── main.jsx               # React entry point
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── tests/
│   └── test_backend.py     # 22 unit tests
├── .env.example
├── deepgram_build_guide.md
└── README.md
```

## Features

- **1970s Radio UI** — Wood-textured cabinet with brass accents, rounded speaker grill
- **Green Wavescope** — Canvas 2D CRT-style oscilloscope with scanlines, grid, and vignette
- **Call** — Connect to a voice agent via Deepgram Voice Agent WebSocket
- **Memo** — Record voice and transcribe via Deepgram STT REST
- **Voicemail** — Listen to notifications via Deepgram TTS REST
- **Context Memory** — Conversation summaries stored in SQLite, injected into agent prompts
- **User Notebook** — Profile setup, agent list, and "Clear Profile" to reset all data
- **Debug Panel** — View raw LLM prompts for each agent

## Running Tests

```bash
python -m pytest tests/test_backend.py -v
```

## License

MIT License
