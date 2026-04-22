# MasterMind

MasterMind is a clinical intelligence platform for researchers and doctors. It combines a web dashboard for patient monitoring, triage, and neuroscience profiling with an on-device voice agent (powered by Gemma 4 via Cactus) that runs on iOS. Together, they enable low-latency, voice-driven clinical workflows — from bedside data capture to real-time dashboard insights.

---

## Setup

The project has two components. Follow the setup steps for each.

### 1. Web Dashboard (`ember-web-frontend-backend`)

**Prerequisites:** [Node.js](https://nodejs.org) and [Bun](https://bun.sh)

```bash
cd ember-web-frontend-backend
npm install
```

Set up Convex (backend):
```bash
npx convex dev
```

In a separate terminal, start the frontend:
```bash
npm run dev
```

The app will be available at `http://localhost:5173`.

---

### 2. Voice Agent (`voice-agents-hack`)

**Prerequisites:** Node.js, and a Mac with [Cactus](https://cactuscompute.com) installed

**Install Cactus and the on-device model:**
```bash
git clone https://github.com/cactus-compute/cactus
cd cactus && source ./setup && cd ..
cactus build --python
cactus download google/functiongemma-270m-it --reconvert
```

**Authenticate with Cactus:**
```bash
cactus auth
# Enter your API key from https://cactuscompute.com/dashboard/api-keys
```

**Optional — enable cloud fallback via Gemini:**
```bash
pip install google-genai
export GEMINI_API_KEY="your-key"
# Get a key from https://aistudio.google.com/api-keys
```

**Start the Express server:**
```bash
cd voice-agents-hack
npm install
node index.js
```

The server runs on `http://localhost:3000`.

**iOS app:** Open `voice-agents-hack/Ember/Ember.xcodeproj` in Xcode and run on a connected device or simulator.
