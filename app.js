import { EnigmaMachine, decodeEnigma, ENIGMA_CONFIG } from "./enigma.js";
import { sounds } from "./audio.js";

const API_BASE = "https://devfest-vibe-lounge.web.app/api";

// Application State
const state = {
  machine: new EnigmaMachine({ start: "AAA" }),
  transmissions: [],
  knownTxNumbers: new Set(),
  agendaItems: [],
  activeTab: "tab-intercepts",
  isSimulating: false,
  nextFetchCountdown: 15,
  currentLitLamp: null,
  litTimer: null
};

// DOM Elements
const elements = {
  rotorVals: [
    document.getElementById("rotor-val-0"),
    document.getElementById("rotor-val-1"),
    document.getElementById("rotor-val-2")
  ],
  notchIndicators: [
    document.getElementById("notch-0"),
    document.getElementById("notch-1"),
    document.getElementById("notch-2")
  ],
  circuitTrace: document.getElementById("circuit-trace"),
  lampboard: document.getElementById("lampboard"),
  keyboard: document.getElementById("keyboard"),
  txList: document.getElementById("tx-list"),
  agendaList: document.getElementById("agenda-list"),
  agendaFilter: document.getElementById("agenda-filter"),
  tickerBadge: document.getElementById("ticker-badge"),
  apiStatusText: document.getElementById("api-status-text"),
  statusPulse: document.getElementById("status-pulse"),
  soundToggle: document.getElementById("btn-sound-toggle"),
  soundIcon: document.getElementById("sound-icon"),
  soundLabel: document.getElementById("sound-label"),
  syncNowBtn: document.getElementById("btn-quick-refresh"),
  // Vibe Lab
  labInput: document.getElementById("lab-input"),
  labOutput: document.getElementById("lab-output"),
  labStartPos: document.getElementById("lab-start-pos"),
  labDecodeBtn: document.getElementById("btn-lab-decode"),
  labSimulateBtn: document.getElementById("btn-lab-simulate"),
  // Submit & Leaderboard
  submitForm: document.getElementById("submit-form"),
  subTeam: document.getElementById("sub-team"),
  subUrl: document.getElementById("sub-url"),
  submitResult: document.getElementById("submit-result"),
  submitEntryBtn: document.getElementById("btn-submit-entry"),
  leaderboardList: document.getElementById("leaderboard-list"),
  refreshEntriesBtn: document.getElementById("btn-refresh-entries")
};

// -------------------------------------------------------------
// Enigma Visual Machine Controller
// -------------------------------------------------------------

function updateRotorUI() {
  const pos = state.machine.getPositions();
  for (let i = 0; i < 3; i++) {
    const val = pos[i];
    elements.rotorVals[i].textContent = val;

    // Check if on notch turnover
    const isNotch = state.machine.rotorPositions[i] === state.machine.notchPositions[i];
    if (isNotch) {
      elements.notchIndicators[i].classList.add("on-notch");
      elements.notchIndicators[i].textContent = `Turnover: ${ENIGMA_CONFIG.rotors[i].notch} (ACTIVE)`;
    } else {
      elements.notchIndicators[i].classList.remove("on-notch");
      elements.notchIndicators[i].textContent = `Turnover: ${ENIGMA_CONFIG.rotors[i].notch}`;
    }
  }
}

function lightLamp(char) {
  if (state.litTimer) {
    clearTimeout(state.litTimer);
  }
  if (state.currentLitLamp) {
    state.currentLitLamp.classList.remove("lit");
  }

  const lamp = elements.lampboard.querySelector(`[data-lamp="${char}"]`);
  if (lamp) {
    lamp.classList.add("lit");
    state.currentLitLamp = lamp;
    state.litTimer = setTimeout(() => {
      lamp.classList.remove("lit");
      state.currentLitLamp = null;
    }, 400);
  }
}

function renderCircuitTrace(trace) {
  if (!trace) {
    elements.circuitTrace.innerHTML = `<span class="flow-step">Awaiting keypress...</span>`;
    return;
  }

  const html = `
    <span class="flow-step active">KEY [${trace.input}]</span>
    <span class="flow-arrow">➔</span>
    ${trace.steps.map(s => `
      <span class="flow-step">${s.stage.replace("Rotor ", "R-")}: <strong>${s.val}</strong></span>
      <span class="flow-arrow">➔</span>
    `).join("")}
    <span class="flow-step active" style="border-color: var(--neon-green); color: var(--neon-green);">LAMP [${trace.steps[trace.steps.length - 1].val}]</span>
  `;
  elements.circuitTrace.innerHTML = html;
}

function triggerKey(char) {
  const upper = char.toUpperCase();
  if (upper < "A" || upper > "Z") return;

  // Press key button visually
  const keyBtn = elements.keyboard.querySelector(`[data-key="${upper}"]`);
  if (keyBtn) {
    keyBtn.classList.add("pressed");
    setTimeout(() => keyBtn.classList.remove("pressed"), 180);
  }

  // Audio FX
  sounds.playKeyClack();

  // Machine process
  const res = state.machine.processChar(upper, true);
  updateRotorUI();
  lightLamp(res.char);
  renderCircuitTrace(res.trace);

  return res.char;
}

// -------------------------------------------------------------
// Manual Rotor Step Buttons
// -------------------------------------------------------------

document.querySelectorAll("[data-step-rotor]").forEach(btn => {
  btn.addEventListener("click", () => {
    const rotorIdx = parseInt(btn.dataset.stepRotor, 10);
    const dir = btn.dataset.dir === "up" ? 1 : -1;
    state.machine.rotorPositions[rotorIdx] = (state.machine.rotorPositions[rotorIdx] + dir + 26) % 26;
    sounds.playRotorStep();
    updateRotorUI();
  });
});

// Scroll wheel on rotor window to change position
elements.rotorVals.forEach((valEl, idx) => {
  valEl.addEventListener("wheel", (e) => {
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    state.machine.rotorPositions[idx] = (state.machine.rotorPositions[idx] + dir + 26) % 26;
    sounds.playRotorStep();
    updateRotorUI();
  }, { passive: false });
});

// Virtual Keyboard Click
elements.keyboard.querySelectorAll("[data-key]").forEach(btn => {
  btn.addEventListener("click", () => {
    triggerKey(btn.dataset.key);
  });
});

// Physical Keyboard Listener
window.addEventListener("keydown", (e) => {
  // If user is typing in an input or textarea, ignore
  const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
  if (tag === "input" || tag === "textarea") return;

  const key = e.key.toUpperCase();
  if (key >= "A" && key <= "Z" && key.length === 1) {
    e.preventDefault();
    triggerKey(key);
  }
});

// -------------------------------------------------------------
// Live Transmissions Interception Engine
// -------------------------------------------------------------

async function fetchTransmissions() {
  try {
    elements.apiStatusText.textContent = "INTERCEPTING TRANSMISSIONS…";
    elements.statusPulse.style.background = "var(--amber)";

    const res = await fetch(`${API_BASE}/transmissions`, {
      headers: { Accept: "application/json" }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const txs = data.transmissions || [];

    let hasNew = false;
    for (const tx of txs) {
      if (!state.knownTxNumbers.has(tx.number)) {
        hasNew = true;
        state.knownTxNumbers.add(tx.number);
      }
    }

    if (hasNew && state.transmissions.length > 0) {
      sounds.playIncomingTransmission();
    }

    state.transmissions = txs;
    renderTransmissions();
    parseAndRenderAgenda();

    elements.apiStatusText.textContent = `ONLINE · ${state.transmissions.length} TRANSMISSIONS`;
    elements.statusPulse.style.background = "var(--neon-green)";
  } catch (err) {
    console.warn("Failed to fetch transmissions:", err);
    elements.apiStatusText.textContent = "SIGNAL INTERRUPTED · RETRYING";
    elements.statusPulse.style.background = "var(--accent-red)";
  }
}

function renderTransmissions() {
  if (!state.transmissions || state.transmissions.length === 0) {
    elements.txList.innerHTML = `<div style="text-align: center; color: var(--text-dim); padding: 24px;">No transmissions detected yet.</div>`;
    return;
  }

  const html = state.transmissions.map(tx => {
    const decoded = decodeEnigma(tx.start, tx.ciphertext);
    const sentTime = new Date(tx.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    return `
      <div class="tx-card" data-tx-num="${tx.number}" data-start="${tx.start}" data-cipher="${encodeURIComponent(tx.ciphertext)}">
        <div class="tx-meta">
          <span class="tx-num">TRANSMISSION #${tx.number}</span>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="tx-start-pill" title="Start position of rotors">START: ${tx.start}</span>
            <span class="tx-time">${sentTime}</span>
          </div>
        </div>
        <div class="tx-cipher">${tx.ciphertext}</div>
        <div class="tx-plain">${decoded}</div>
        <div class="tx-actions">
          <button class="btn-mini btn-tx-copy" data-text="${encodeURIComponent(decoded)}">Copy Plaintext</button>
          <button class="btn-mini btn-tx-load" data-start="${tx.start}">Set Machine</button>
          <button class="btn-mini btn-tx-simulate" data-start="${tx.start}" data-text="${encodeURIComponent(tx.ciphertext)}">▶ Run Live</button>
        </div>
      </div>
    `;
  }).join("");

  elements.txList.innerHTML = html;

  // Bind actions
  elements.txList.querySelectorAll(".btn-tx-copy").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const text = decodeURIComponent(btn.dataset.text);
      navigator.clipboard.writeText(text);
      btn.textContent = "Copied!";
      setTimeout(() => btn.textContent = "Copy Plaintext", 1500);
    });
  });

  elements.txList.querySelectorAll(".btn-tx-load").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const start = btn.dataset.start;
      state.machine.setPositions(start);
      sounds.playRotorStep();
      updateRotorUI();
    });
  });

  elements.txList.querySelectorAll(".btn-tx-simulate").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const start = btn.dataset.start;
      const cipher = decodeURIComponent(btn.dataset.text);
      simulateDecryption(start, cipher);
    });
  });

  elements.txList.querySelectorAll(".tx-card").forEach(card => {
    card.addEventListener("click", () => {
      elements.txList.querySelectorAll(".tx-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      const start = card.dataset.start;
      state.machine.setPositions(start);
      sounds.playRotorStep();
      updateRotorUI();
    });
  });
}

// -------------------------------------------------------------
// Agenda Parser & Aggregator
// -------------------------------------------------------------

function parseAndRenderAgenda() {
  // Extract schedule items from decoded transmissions
  const itemsMap = new Map();

  for (const tx of state.transmissions) {
    const plain = decodeEnigma(tx.start, tx.ciphertext);
    // Format: "17:25 MOONSHINE: PEOPLE AREN’T MACHINES: COLLABORATION HACKS... / IRENA ZATLOUKALOVA"
    const match = plain.match(/^(\d{1,2}:\d{2})\s+([^:]+):\s+(.+?)(?:\s*\/\s*(.+))?$/);
    if (match) {
      const time = match[1];
      const room = match[2].trim();
      const title = match[3].trim();
      const speaker = match[4] ? match[4].trim() : "";

      const key = `${time}-${title}`;
      if (!itemsMap.has(key)) {
        itemsMap.set(key, { time, room, title, speaker, raw: plain });
      }
    }
  }

  // Sort chronologically
  state.agendaItems = Array.from(itemsMap.values()).sort((a, b) => a.time.localeCompare(b.time));
  renderAgendaList();
}

function renderAgendaList() {
  const query = elements.agendaFilter ? elements.agendaFilter.value.toLowerCase().trim() : "";
  const filtered = state.agendaItems.filter(item => {
    if (!query) return true;
    return item.title.toLowerCase().includes(query) ||
           item.speaker.toLowerCase().includes(query) ||
           item.room.toLowerCase().includes(query) ||
           item.time.includes(query);
  });

  if (filtered.length === 0) {
    elements.agendaList.innerHTML = `<div style="text-align: center; color: var(--text-dim); padding: 24px;">No talks match the filter.</div>`;
    return;
  }

  const html = filtered.map(item => {
    const roomClass = item.room.toLowerCase().includes("moonshine") ? "room-moonshine" :
                      item.room.toLowerCase().includes("speakeasy") ? "room-speakeasy" : "room-tag";

    return `
      <div class="agenda-card">
        <div class="agenda-time-room">
          <span class="agenda-time">🕒 ${item.time}</span>
          <span class="room-tag ${roomClass}">${item.room}</span>
        </div>
        <div class="agenda-title">${item.title}</div>
        ${item.speaker ? `<div class="agenda-speaker">👤 ${item.speaker}</div>` : ""}
      </div>
    `;
  }).join("");

  elements.agendaList.innerHTML = html;
}

if (elements.agendaFilter) {
  elements.agendaFilter.addEventListener("input", renderAgendaList);
}

// -------------------------------------------------------------
// Live Letter-by-Letter Simulation
// -------------------------------------------------------------

async function simulateDecryption(start, text) {
  if (state.isSimulating) return;
  state.isSimulating = true;

  // Set rotor start position
  state.machine.setPositions(start);
  updateRotorUI();

  // Scroll to machine
  window.scrollTo({ top: 0, behavior: "smooth" });

  const lettersOnly = text.split("");
  for (let i = 0; i < lettersOnly.length; i++) {
    const ch = lettersOnly[i];
    if (ch.toUpperCase() >= "A" && ch.toUpperCase() <= "Z") {
      triggerKey(ch);
      await new Promise(r => setTimeout(r, 90));
    }
  }

  state.isSimulating = false;
}

// -------------------------------------------------------------
// Vibe Lab (Manual Encoder / Decoder)
// -------------------------------------------------------------

function runLabProcess() {
  const start = elements.labStartPos.value.toUpperCase().replace(/[^A-Z]/g, "") || "AAA";
  const input = elements.labInput.value;
  const decoded = decodeEnigma(start, input);
  elements.labOutput.value = decoded;
  sounds.playKeyClack();
}

if (elements.labDecodeBtn) {
  elements.labDecodeBtn.addEventListener("click", runLabProcess);
}

if (elements.labSimulateBtn) {
  elements.labSimulateBtn.addEventListener("click", () => {
    const start = elements.labStartPos.value.toUpperCase().replace(/[^A-Z]/g, "") || "AAA";
    const input = elements.labInput.value;
    simulateDecryption(start, input);
  });
}

// -------------------------------------------------------------
// Submit to Lounge Screen & Leaderboard
// -------------------------------------------------------------

async function fetchLeaderboard() {
  try {
    const res = await fetch(`${API_BASE}/entries`, {
      headers: { Accept: "application/json" }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const entries = data.entries || [];

    if (entries.length === 0) {
      elements.leaderboardList.innerHTML = `<div style="font-size: 0.72rem; color: var(--text-dim);">No entries yet on the board.</div>`;
      return;
    }

    const html = entries.map(e => `
      <div class="leaderboard-item">
        <span class="leaderboard-team">${escapeHtml(e.team)}</span>
        <a class="leaderboard-url" href="${escapeHtml(e.url)}" target="_blank" rel="noopener">Link ↗</a>
      </div>
    `).join("");

    elements.leaderboardList.innerHTML = html;
  } catch (err) {
    console.warn("Failed to fetch entries:", err);
  }
}

if (elements.submitForm) {
  elements.submitForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const team = elements.subTeam.value.trim();
    const url = elements.subUrl.value.trim();

    if (!team || !url) return;

    elements.submitEntryBtn.disabled = true;
    elements.submitEntryBtn.textContent = "Transmitting to Lounge...";
    elements.submitResult.className = "submit-result-msg";
    elements.submitResult.style.display = "none";

    try {
      const res = await fetch(`${API_BASE}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team, url })
      });

      if (res.ok) {
        elements.submitResult.className = "submit-result-msg ok";
        elements.submitResult.textContent = "✓ Accepted! Your decoder is now on the DevFest lounge screen!";
        fetchLeaderboard();
      } else {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      elements.submitResult.className = "submit-result-msg error";
      elements.submitResult.textContent = `Transmission failed: ${err.message}`;
    } finally {
      elements.submitEntryBtn.disabled = false;
      elements.submitEntryBtn.textContent = "🚀 Transmit to Leaderboard";
    }
  });
}

if (elements.refreshEntriesBtn) {
  elements.refreshEntriesBtn.addEventListener("click", fetchLeaderboard);
}

// -------------------------------------------------------------
// Navigation Tabs
// -------------------------------------------------------------

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));

    btn.classList.add("active");
    const target = document.getElementById(btn.dataset.tab);
    if (target) {
      target.classList.add("active");
    }
  });
});

// -------------------------------------------------------------
// Sound Toggle & Controls
// -------------------------------------------------------------

if (elements.soundToggle) {
  function updateSoundUI(isOn) {
    elements.soundIcon.textContent = isOn ? "🔊" : "🔇";
    elements.soundLabel.textContent = isOn ? "Audio ON" : "Muted";
    if (isOn) {
      elements.soundToggle.classList.add("active");
    } else {
      elements.soundToggle.classList.remove("active");
    }
  }

  updateSoundUI(sounds.enabled);

  elements.soundToggle.addEventListener("click", () => {
    const isNowOn = sounds.toggle();
    updateSoundUI(isNowOn);
  });
}

if (elements.syncNowBtn) {
  elements.syncNowBtn.addEventListener("click", () => {
    state.nextFetchCountdown = 15;
    fetchTransmissions();
    fetchLeaderboard();
  });
}

// -------------------------------------------------------------
// Polling Loop & Countdown Timer
// -------------------------------------------------------------

function startPolling() {
  fetchTransmissions();
  fetchLeaderboard();

  setInterval(() => {
    state.nextFetchCountdown--;
    if (state.nextFetchCountdown <= 0) {
      state.nextFetchCountdown = 15;
      fetchTransmissions();
    }
    if (elements.tickerBadge) {
      elements.tickerBadge.textContent = `NEXT BROADCAST: ${state.nextFetchCountdown}s`;
    }
  }, 1000);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Initialize
updateRotorUI();
startPolling();
