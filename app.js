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
  hasInitialReplayed: false,
  currentReplayTx: null,
  plugPairs: [...ENIGMA_CONFIG.defaultPlugboard],
  selectedPlugSocket: null,
  nextFetchCountdown: 15,
  currentLitLamp: null,
  litTimer: null,
  lastTrace: null
};

// DOM Elements
const elements = {
  machineChassis: document.getElementById("machine-chassis"),
  loomSvg: document.getElementById("machine-loom-svg"),
  signalSvg: document.getElementById("machine-signal-svg"),
  drumUkw: document.getElementById("drum-ukw"),
  drumR1: document.getElementById("drum-r1"),
  drumR2: document.getElementById("drum-r2"),
  drumR3: document.getElementById("drum-r3"),
  drumEtw: document.getElementById("drum-etw"),
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
  circuitBayStatus: document.getElementById("circuit-bay-status"),
  lampboard: document.getElementById("lampboard"),
  keyboard: document.getElementById("keyboard"),
  // Full Steckerbrett
  steckerGrid: document.getElementById("stecker-sockets-grid"),
  steckerSvg: document.getElementById("stecker-cables-svg"),
  plugCountBadge: document.getElementById("plug-count-badge"),
  plugPairsText: document.getElementById("plug-pairs-text"),
  plugboardPairsList: document.getElementById("plugboard-pairs"),
  btnResetPlugs: document.getElementById("btn-reset-plugs"),
  btnClearPlugs: document.getElementById("btn-clear-plugs"),
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
  // Teleprinter Paper Elements
  paperText: document.getElementById("paper-text"),
  paperCursor: document.getElementById("paper-cursor"),
  paperTxNum: document.getElementById("paper-tx-num"),
  paperTxStart: document.getElementById("paper-tx-start"),
  paperTxTime: document.getElementById("paper-tx-time"),
  btnReplayPaper: document.getElementById("btn-replay-paper"),
  btnClearPaper: document.getElementById("btn-clear-paper"),
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
      elements.notchIndicators[i].textContent = `Notch: ${ENIGMA_CONFIG.rotors[i].notch} ★`;
    } else {
      elements.notchIndicators[i].classList.remove("on-notch");
      elements.notchIndicators[i].textContent = `Notch: ${ENIGMA_CONFIG.rotors[i].notch}`;
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
    }, 380);
  }
}

/**
 * Renders the full-machine internal copper wiring harness (loomSvg)
 * and the live exposed rotor commutators + active electrical signal flow (signalSvg)
 * directly across the actual DOM Keys, Plugboard sockets, Rotors, and Lamps.
 */
function drawInternals(trace) {
  state.lastTrace = trace || null;
  if (!elements.machineChassis || !elements.loomSvg || !elements.signalSvg) return;

  // Highlight active key and lamp at rest for trace inspection
  elements.keyboard.querySelectorAll(".key-btn.traced").forEach(el => el.classList.remove("traced"));
  elements.lampboard.querySelectorAll(".lamp.traced").forEach(el => el.classList.remove("traced"));

  if (trace && trace.steps && trace.steps.length >= 9) {
    const activeKeyEl = elements.keyboard.querySelector(`[data-key="${trace.input}"]`);
    const activeLampEl = elements.lampboard.querySelector(`[data-lamp="${trace.steps[8].val}"]`);
    if (activeKeyEl) activeKeyEl.classList.add("traced");
    if (activeLampEl) activeLampEl.classList.add("traced");
  }

  const chassisRect = elements.machineChassis.getBoundingClientRect();
  if (chassisRect.width === 0 || chassisRect.height === 0) return;

  const W = chassisRect.width;
  const H = chassisRect.height;

  elements.loomSvg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  elements.signalSvg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  const relRect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: r.left - chassisRect.left,
      right: r.right - chassisRect.left,
      top: r.top - chassisRect.top,
      bottom: r.bottom - chassisRect.top,
      cx: r.left - chassisRect.left + r.width / 2,
      cy: r.top - chassisRect.top + r.height / 2,
      width: r.width,
      height: r.height
    };
  };

  const ukwRect = relRect(elements.drumUkw);
  const r1Rect = relRect(elements.drumR1);
  const r2Rect = relRect(elements.drumR2);
  const r3Rect = relRect(elements.drumR3);
  const etwRect = relRect(elements.drumEtw);

  if (!ukwRect || !r1Rect || !r2Rect || !r3Rect || !etwRect) return;

  // Map all 26 keys, lamps, and plugboard sockets
  const keyRects = new Map();
  elements.keyboard.querySelectorAll("[data-key]").forEach(el => {
    keyRects.set(el.dataset.key, relRect(el));
  });

  const lampRects = new Map();
  elements.lampboard.querySelectorAll("[data-lamp]").forEach(el => {
    lampRects.set(el.dataset.lamp, relRect(el));
  });

  const sockRects = new Map();
  if (elements.steckerGrid) {
    elements.steckerGrid.querySelectorAll(".stecker-socket[data-letter]").forEach(el => {
      sockRects.set(el.dataset.letter, relRect(el));
    });
  }

  const getPinY = (dRect, idx) => {
    const pad = 11;
    const usable = Math.max(30, dRect.height - pad * 2);
    return dRect.top + pad + (idx / 25) * usable;
  };

  // Left and Right Chassis Harness Bus Channels
  const xLeftBus = 14;
  const xRightBus = W - 14;

  // -------------------------------------------------------------------------
  // 1. RENDER PERMANENT SKEUOMORPHIC COPPER WIRING HARNESS (loomSvg)
  // -------------------------------------------------------------------------
  let loom = `
    <defs>
      <linearGradient id="copperTrunkGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#5c3818" />
        <stop offset="50%" stop-color="#d4944e" />
        <stop offset="100%" stop-color="#5c3818" />
      </linearGradient>
    </defs>
  `;

  const trunkTopY = etwRect.top + 8;
  const trunkBotY = H - 24;

  // Left Return Bus Trunk (Lampboard <-> Steckerbrett <-> Rotors)
  loom += `
    <line x1="${xLeftBus - 3}" y1="${trunkTopY}" x2="${xLeftBus - 3}" y2="${trunkBotY}" stroke="#6e4720" stroke-width="2" stroke-opacity="0.55" />
    <line x1="${xLeftBus}" y1="${trunkTopY}" x2="${xLeftBus}" y2="${trunkBotY}" stroke="#c88a4b" stroke-width="2.5" stroke-opacity="0.65" />
    <line x1="${xLeftBus + 3}" y1="${trunkTopY}" x2="${xLeftBus + 3}" y2="${trunkBotY}" stroke="#8a5a2b" stroke-width="1.5" stroke-opacity="0.5" />
  `;

  // Right Forward/Return Stator Harness Trunk (Keyboard <-> Steckerbrett <-> ETW)
  loom += `
    <line x1="${xRightBus - 3}" y1="${trunkTopY}" x2="${xRightBus - 3}" y2="${trunkBotY}" stroke="#1c5d78" stroke-width="1.8" stroke-opacity="0.55" />
    <line x1="${xRightBus}" y1="${trunkTopY}" x2="${xRightBus}" y2="${trunkBotY}" stroke="#b87a3d" stroke-width="2.5" stroke-opacity="0.65" />
    <line x1="${xRightBus + 3}" y1="${trunkTopY}" x2="${xRightBus + 3}" y2="${trunkBotY}" stroke="#6e4720" stroke-width="2" stroke-opacity="0.55" />
  `;

  // Brass Harness Clamps along Left & Right Trunks
  for (let cy = trunkTopY + 45; cy < trunkBotY - 20; cy += 95) {
    loom += `
      <rect x="${xLeftBus - 6}" y="${cy}" width="12" height="5" rx="1.5" fill="#b88a44" stroke="#3d280d" stroke-width="0.8" opacity="0.8" />
      <rect x="${xRightBus - 6}" y="${cy}" width="12" height="5" rx="1.5" fill="#b88a44" stroke="#3d280d" stroke-width="0.8" opacity="0.8" />
    `;
  }

  // Horizontal Copper Bus Bars under each Lamp Row
  elements.lampboard.querySelectorAll(".lamp-row").forEach(rowEl => {
    const rRect = relRect(rowEl);
    if (!rRect) return;
    const busY = rRect.bottom + 5;
    loom += `
      <line x1="${xLeftBus}" y1="${busY}" x2="${rRect.right + 12}" y2="${busY}" stroke="#b87a3d" stroke-width="1.8" stroke-opacity="0.45" />
      <line x1="${xLeftBus}" y1="${busY + 2.5}" x2="${rRect.right + 12}" y2="${busY + 2.5}" stroke="#704820" stroke-width="1" stroke-opacity="0.4" />
      <circle cx="${xLeftBus}" cy="${busY}" r="3" fill="#d4a359" opacity="0.7" />
    `;
  });

  // Horizontal Switch Bus Bars under each Key Row
  elements.keyboard.querySelectorAll(".key-row").forEach(rowEl => {
    const rRect = relRect(rowEl);
    if (!rRect) return;
    const busY = rRect.bottom + 6;
    loom += `
      <line x1="${rRect.left - 12}" y1="${busY}" x2="${xRightBus}" y2="${busY}" stroke="#298099" stroke-width="1.8" stroke-opacity="0.45" />
      <line x1="${rRect.left - 12}" y1="${busY + 2.5}" x2="${xRightBus}" y2="${busY + 2.5}" stroke="#8c6227" stroke-width="1" stroke-opacity="0.4" />
      <circle cx="${xRightBus}" cy="${busY}" r="3" fill="#00d9ff" opacity="0.65" />
    `;
  });

  // 26 Individual Copper Leads: Keys -> Steckerbrett & Steckerbrett -> Lamps & ETW -> Right Trunk
  const alphabet = ENIGMA_CONFIG.alphabet;
  for (let i = 0; i < 26; i++) {
    const letter = alphabet[i];
    const kRect = keyRects.get(letter);
    const lRect = lampRects.get(letter);
    const sRect = sockRects.get(letter);

    // ETW Stator Fan-out into Right Harness Trunk
    const etwPinY = getPinY(etwRect, i);
    loom += `
      <path d="M ${etwRect.right - 4} ${etwPinY} C ${etwRect.right + 10} ${etwPinY}, ${xRightBus - 6} ${etwPinY + 8}, ${xRightBus} ${etwPinY + 14}"
            fill="none" stroke="#b87a3d" stroke-width="0.9" stroke-opacity="0.42" />
    `;

    if (kRect && sRect) {
      const kx = kRect.cx;
      const ky = kRect.bottom + 3;
      const sx = sRect.cx;
      const sy = sRect.top + 4;
      const midY = ky + (sy - ky) * 0.52;
      // Enamelled copper wire from Key Switch to Plugboard Socket
      loom += `
        <path d="M ${kx} ${ky} C ${kx} ${midY}, ${sx} ${midY}, ${sx} ${sy}"
              fill="none" stroke="#c8823c" stroke-width="0.95" stroke-opacity="0.24" />
      `;
    }

    if (lRect && sRect) {
      const lx = lRect.cx;
      const ly = lRect.bottom + 3;
      const sx = sRect.cx;
      const sy = sRect.top + 4;
      const midY = ly + (sy - ly) * 0.45;
      // Return wire trace between Plugboard Socket and Lamp Socket
      loom += `
        <path d="M ${sx} ${sy} C ${sx} ${midY}, ${lx} ${midY}, ${lx} ${ly}"
              fill="none" stroke="#6488a8" stroke-width="0.75" stroke-opacity="0.16" />
      `;
    }
  }

  elements.loomSvg.innerHTML = loom;

  // -------------------------------------------------------------------------
  // 2. RENDER EXPOSED ROTOR COMMUTATORS & LIVE SIGNAL CONDUCTION (signalSvg)
  // -------------------------------------------------------------------------
  let sig = `
    <defs>
      <filter id="cyanGlow" x="-25%" y="-25%" width="150%" height="150%">
        <feGaussianBlur stdDeviation="3" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="amberGlow" x="-25%" y="-25%" width="150%" height="150%">
        <feGaussianBlur stdDeviation="3" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  `;

  const r1Offset = state.machine.rotorPositions[0];
  const r2Offset = state.machine.rotorPositions[1];
  const r3Offset = state.machine.rotorPositions[2];

  // Helper to draw all 26 internal rotor wires & brass contact pins inside each cutaway rotor drum
  const drawRotorDrumInternals = (dRect, wiring, offset) => {
    const xLeft = dRect.left + 6;
    const xRight = dRect.right - 6;
    let out = "";

    for (let i = 0; i < 26; i++) {
      const inPin = (i + offset) % 26;
      const wired = wiring.charCodeAt(inPin) - 65;
      const outIdx = (wired - offset + 26) % 26;

      const yIn = getPinY(dRect, i);
      const yOut = getPinY(dRect, outIdx);

      // Alternating copper/brass tint for internal insulated rotor wires
      const strokeColor = i % 2 === 0 ? "#8a6236" : "#435c7a";
      const opacity = i % 2 === 0 ? "0.48" : "0.38";

      out += `
        <path d="M ${xRight} ${yIn} C ${xRight - dRect.width * 0.35} ${yIn}, ${xLeft + dRect.width * 0.35} ${yOut}, ${xLeft} ${yOut}"
              fill="none" stroke="${strokeColor}" stroke-width="0.9" stroke-opacity="${opacity}" />
        <circle cx="${xLeft}" cy="${yIn}" r="1.5" fill="#d4a359" opacity="0.8" />
        <circle cx="${xRight}" cy="${yIn}" r="1.5" fill="#d4a359" opacity="0.8" />
      `;
    }
    return out;
  };

  sig += drawRotorDrumInternals(r1Rect, ENIGMA_CONFIG.rotors[0].wiring, r1Offset);
  sig += drawRotorDrumInternals(r2Rect, ENIGMA_CONFIG.rotors[1].wiring, r2Offset);
  sig += drawRotorDrumInternals(r3Rect, ENIGMA_CONFIG.rotors[2].wiring, r3Offset);

  // Draw UKW-B (Reflector B) 26 pins & 13 internal hairpin loops
  const ukwRightX = ukwRect.right - 6;
  for (let i = 0; i < 26; i++) {
    const y1 = getPinY(ukwRect, i);
    sig += `<circle cx="${ukwRightX}" cy="${y1}" r="1.5" fill="#d4a359" opacity="0.8" />`;

    const pairChar = ENIGMA_CONFIG.reflector.wiring[i];
    const pairIdx = pairChar.charCodeAt(0) - 65;
    if (i < pairIdx) {
      const y2 = getPinY(ukwRect, pairIdx);
      const loopSpan = Math.abs(y2 - y1);
      const loopX = Math.max(ukwRect.left + 6, ukwRightX - (10 + (loopSpan / ukwRect.height) * (ukwRect.width - 18)));
      sig += `
        <path d="M ${ukwRightX} ${y1} C ${loopX} ${y1}, ${loopX} ${y2}, ${ukwRightX} ${y2}"
              fill="none" stroke="#5b7396" stroke-width="0.95" stroke-opacity="0.48" />
      `;
    }
  }

  // Draw ETW (Entry Stator) 26 pass-through terminal bars & pins
  const etwLeftX = etwRect.left + 6;
  const etwRightX = etwRect.right - 6;
  for (let i = 0; i < 26; i++) {
    const y = getPinY(etwRect, i);
    sig += `
      <line x1="${etwLeftX}" y1="${y}" x2="${etwRightX}" y2="${y}" stroke="#3e526e" stroke-width="0.8" stroke-opacity="0.45" />
      <circle cx="${etwLeftX}" cy="${y}" r="1.4" fill="#d4a359" opacity="0.8" />
      <circle cx="${etwRightX}" cy="${y}" r="1.5" fill="#00d9ff" opacity="0.7" />
    `;
  }

  // -------------------------------------------------------------------------
  // 3. ACTIVE LIVE ELECTRICAL SIGNAL PATH ACROSS THE MACHINE
  // -------------------------------------------------------------------------
  if (trace && trace.steps && trace.steps.length >= 9) {
    const s = trace.steps;

    const inChar = trace.input;
    const plugInVal = s[0].val;
    const plugInIdx = s[0].idx;

    const outChar = s[8].val;
    const outIdx = s[8].idx;
    const prePlug = s[8].prePlug || outChar;
    const prePlugIdx = prePlug.charCodeAt(0) - 65;

    const keyInRect = keyRects.get(inChar);
    const sockInRect = sockRects.get(inChar);
    const sockInExitRect = sockRects.get(plugInVal);

    const sockOutInRect = sockRects.get(prePlug);
    const sockOutExitRect = sockRects.get(outChar);
    const lampOutRect = lampRects.get(outChar);

    // Coordinates on the Rotor Spindle Drums
    const yEtwIn = getPinY(etwRect, plugInIdx);
    const yR3In = getPinY(r3Rect, s[1].inIdx);
    const yR3Out = getPinY(r3Rect, s[1].idx);
    const yR2In = getPinY(r2Rect, s[2].inIdx);
    const yR2Out = getPinY(r2Rect, s[2].idx);
    const yR1In = getPinY(r1Rect, s[3].inIdx);
    const yR1Out = getPinY(r1Rect, s[3].idx);
    const yRefIn = getPinY(ukwRect, s[4].inIdx);
    const yRefOut = getPinY(ukwRect, s[4].outIdx);

    // Reverse coordinates on the Rotor Spindle Drums
    const yR1RevIn = getPinY(r1Rect, s[5].inIdx);
    const yR1RevOut = getPinY(r1Rect, s[5].outIdx);
    const yR2RevIn = getPinY(r2Rect, s[6].inIdx);
    const yR2RevOut = getPinY(r2Rect, s[6].outIdx);
    const yR3RevIn = getPinY(r3Rect, s[7].inIdx);
    const yR3RevOut = getPinY(r3Rect, s[7].outIdx);
    const yEtwOut = getPinY(etwRect, prePlugIdx);

    // --- A. FORWARD WIRE: Key -> Steckerbrett -> ETW -> R-III -> R-II -> R-I -> UKW-B ---
    let forwardChassisPath = "";
    if (keyInRect && sockInRect && sockInExitRect) {
      const kx = keyInRect.cx;
      const ky = keyInRect.bottom + 2;
      const s1x = sockInRect.cx;
      const s1y = sockInRect.top + 8;
      const midKS = ky + (s1y - ky) * 0.5;

      // Key switch to Plugboard Input Socket
      forwardChassisPath += `M ${kx} ${ky} C ${kx} ${midKS}, ${s1x} ${midKS}, ${s1x} ${s1y} `;

      // If swapped on Steckerbrett, flow through the patch cable to partner socket
      let exitX = s1x;
      let exitY = s1y;
      if (s[0].swapped && inChar !== plugInVal) {
        exitX = sockInExitRect.cx;
        exitY = sockInExitRect.top + 8;
        const droop = Math.min(35, Math.abs(exitX - s1x) * 0.25 + 15);
        forwardChassisPath += `C ${s1x} ${s1y + droop}, ${exitX} ${exitY + droop}, ${exitX} ${exitY} `;
      }

      // From Plugboard Output Socket -> Right Harness Channel -> Up into ETW pin
      const chanX = W - 11;
      forwardChassisPath += `
        C ${exitX} ${exitY - 26}, ${chanX} ${exitY - 12}, ${chanX} ${exitY - 42}
        L ${chanX} ${yEtwIn + 14}
        C ${chanX} ${yEtwIn}, ${etwRightX + 8} ${yEtwIn}, ${etwRightX} ${yEtwIn}
      `;
    }

    // Forward path across the Rotor Spindle (ETW -> R-III -> R-II -> R-I -> UKW-B)
    const forwardSpindlePath = `
      M ${etwRightX} ${yEtwIn}
      L ${etwLeftX} ${yEtwIn}
      L ${r3Rect.right - 6} ${yR3In}
      C ${r3Rect.right - r3Rect.width * 0.35} ${yR3In}, ${r3Rect.left + r3Rect.width * 0.35} ${yR3Out}, ${r3Rect.left + 6} ${yR3Out}
      L ${r2Rect.right - 6} ${yR2In}
      C ${r2Rect.right - r2Rect.width * 0.35} ${yR2In}, ${r2Rect.left + r2Rect.width * 0.35} ${yR2Out}, ${r2Rect.left + 6} ${yR2Out}
      L ${r1Rect.right - 6} ${yR1In}
      C ${r1Rect.right - r1Rect.width * 0.35} ${yR1In}, ${r1Rect.left + r1Rect.width * 0.35} ${yR1Out}, ${r1Rect.left + 6} ${yR1Out}
      L ${ukwRightX} ${yRefIn}
    `;

    // Reflector B U-turn Loop inside UKW-B
    const refSpan = Math.abs(yRefOut - yRefIn);
    const refLoopX = Math.max(ukwRect.left + 5, ukwRightX - (14 + (refSpan / ukwRect.height) * (ukwRect.width - 20)));
    const reflectorLoopPath = `
      M ${ukwRightX} ${yRefIn}
      C ${refLoopX} ${yRefIn}, ${refLoopX} ${yRefOut}, ${ukwRightX} ${yRefOut}
    `;

    // --- B. RETURN WIRE: UKW-B -> R-I -> R-II -> R-III -> ETW -> Steckerbrett -> Lamp ---
    const returnSpindlePath = `
      M ${ukwRightX} ${yRefOut}
      L ${r1Rect.left + 6} ${yR1RevIn}
      C ${r1Rect.left + r1Rect.width * 0.35} ${yR1RevIn}, ${r1Rect.right - r1Rect.width * 0.35} ${yR1RevOut}, ${r1Rect.right - 6} ${yR1RevOut}
      L ${r2Rect.left + 6} ${yR2RevIn}
      C ${r2Rect.left + r2Rect.width * 0.35} ${yR2RevIn}, ${r2Rect.right - r2Rect.width * 0.35} ${yR2RevOut}, ${r2Rect.right - 6} ${yR2RevOut}
      L ${r3Rect.left + 6} ${yR3RevIn}
      C ${r3Rect.left + r3Rect.width * 0.35} ${yR3RevIn}, ${r3Rect.right - r3Rect.width * 0.35} ${yR3RevOut}, ${r3Rect.right - 6} ${yR3RevOut}
      L ${etwLeftX} ${yEtwOut}
      L ${etwRightX} ${yEtwOut}
    `;

    let returnChassisPath = "";
    if (sockOutInRect && sockOutExitRect && lampOutRect) {
      const s2x = sockOutInRect.cx;
      const s2y = sockOutInRect.top + 10;
      const retChanX = W - 18;

      // From ETW right lug down right return channel to Plugboard Return Socket
      returnChassisPath += `
        M ${etwRightX} ${yEtwOut}
        C ${etwRightX + 8} ${yEtwOut}, ${retChanX} ${yEtwOut}, ${retChanX} ${yEtwOut + 14}
        L ${retChanX} ${s2y - 36}
        C ${retChanX} ${s2y - 10}, ${s2x} ${s2y - 24}, ${s2x} ${s2y}
      `;

      // If swapped on Steckerbrett, flow through the patch cable to final output socket
      let finalSockX = s2x;
      let finalSockY = s2y;
      if (s[8].swapped && prePlug !== outChar) {
        finalSockX = sockOutExitRect.cx;
        finalSockY = sockOutExitRect.top + 10;
        const droop = Math.min(35, Math.abs(finalSockX - s2x) * 0.25 + 15);
        returnChassisPath += `C ${s2x} ${s2y + droop}, ${finalSockX} ${finalSockY + droop}, ${finalSockX} ${finalSockY} `;
      }

      // From Final Plugboard Socket up to the Lit Lamp's bottom brass lug
      const lx = lampOutRect.cx;
      const ly = lampOutRect.bottom + 3;
      const midSL = finalSockY - (finalSockY - ly) * 0.48;
      returnChassisPath += `C ${finalSockX} ${midSL}, ${lx} ${midSL}, ${lx} ${ly}`;
    }

    const fullForward = `${forwardChassisPath} ${forwardSpindlePath}`;
    const fullReturn = `${returnSpindlePath} ${returnChassisPath}`;

    sig += `
      <!-- Forward Conduction Beam (Cyan) -->
      <path d="${fullForward}" fill="none" stroke="#00e5ff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.88" filter="url(#cyanGlow)" />
      <path d="${fullForward}" fill="none" stroke="#ffffff" stroke-width="1.2" stroke-linecap="round" class="signal-pulse-path" />

      <!-- Reflector Hairpin Loop -->
      <path d="${reflectorLoopPath}" fill="none" stroke="#00e5ff" stroke-width="2.8" stroke-linecap="round" filter="url(#cyanGlow)" />
      <path d="${reflectorLoopPath}" fill="none" stroke="#ffffff" stroke-width="1.3" class="signal-pulse-path" />

      <!-- Return Conduction Beam (Incandescent Amber) -->
      <path d="${fullReturn}" fill="none" stroke="#ffaa22" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.9" filter="url(#amberGlow)" />
      <path d="${fullReturn}" fill="none" stroke="#fff6d6" stroke-width="1.2" stroke-linecap="round" class="signal-pulse-path" />
    `;

    // Helper for crisp pin badges on the active rotor contacts
    const drawPinNode = (x, y, label, color, align = "left") => {
      const dx = align === "left" ? -11 : 11;
      return `
        <circle cx="${x}" cy="${y}" r="3.4" fill="${color}" stroke="#ffffff" stroke-width="1" />
        <rect x="${x + dx - 7}" y="${y - 6}" width="14" height="12" rx="2.5" fill="#070a10" stroke="${color}" stroke-width="0.9" opacity="0.92" />
        <text x="${x + dx}" y="${y + 3}" fill="${color}" font-size="8" font-family="'JetBrains Mono', monospace" font-weight="bold" text-anchor="middle">${label}</text>
      `;
    };

    // Pin nodes along the Rotor Spindle
    sig += drawPinNode(etwLeftX, yEtwIn, plugInVal, "#00e5ff", "right");
    sig += drawPinNode(r3Rect.left + 6, yR3Out, s[1].val, "#00e5ff", "right");
    sig += drawPinNode(r2Rect.left + 6, yR2Out, s[2].val, "#00e5ff", "right");
    sig += drawPinNode(r1Rect.left + 6, yR1Out, s[3].val, "#00e5ff", "right");
    sig += drawPinNode(ukwRightX, yRefOut, s[4].val, "#ffaa22", "left");
    sig += drawPinNode(r1Rect.right - 6, yR1RevOut, s[5].val, "#ffaa22", "left");
    sig += drawPinNode(r2Rect.right - 6, yR2RevOut, s[6].val, s[6].val === s[2].val ? "#ffaa22" : "#ffaa22", "left");
    sig += drawPinNode(r3Rect.right - 6, yR3RevOut, prePlug, "#ffaa22", "left");

    // Key, Plugboard, and Lamp Terminal Nodes
    if (keyInRect) {
      sig += `
        <circle cx="${keyInRect.cx}" cy="${keyInRect.bottom + 2}" r="4.5" fill="#00e5ff" stroke="#ffffff" stroke-width="1.2" filter="url(#cyanGlow)" />
      `;
    }
    if (sockInRect) {
      sig += `<circle cx="${sockInRect.cx}" cy="${sockInRect.top + 8}" r="4" fill="#00e5ff" stroke="#ffffff" stroke-width="1" />`;
    }
    if (s[0].swapped && sockInExitRect) {
      sig += `<circle cx="${sockInExitRect.cx}" cy="${sockInExitRect.top + 8}" r="4" fill="#00e5ff" stroke="#ffffff" stroke-width="1" />`;
    }
    if (sockOutInRect) {
      sig += `<circle cx="${sockOutInRect.cx}" cy="${sockOutInRect.top + 10}" r="4" fill="#ffaa22" stroke="#ffffff" stroke-width="1" />`;
    }
    if (s[8].swapped && sockOutExitRect) {
      sig += `<circle cx="${sockOutExitRect.cx}" cy="${sockOutExitRect.top + 10}" r="4" fill="#ffaa22" stroke="#ffffff" stroke-width="1" />`;
    }
    if (lampOutRect) {
      sig += `
        <circle cx="${lampOutRect.cx}" cy="${lampOutRect.bottom + 3}" r="4.5" fill="#ffaa22" stroke="#ffffff" stroke-width="1.2" filter="url(#amberGlow)" />
      `;
    }
  }

  elements.signalSvg.innerHTML = sig;
  drawSteckerCables();
}

function renderCircuitTrace(trace) {
  drawInternals(trace);

  if (!trace) {
    elements.circuitTrace.innerHTML = `<span class="flow-step">Press any key or replay broadcast to trace internal wiring...</span>`;
    return;
  }

  const html = `
    <span class="flow-step active">KEY [${trace.input}]</span>
    <span class="flow-arrow">➔</span>
    ${trace.steps.map((s, idx) => {
      const isLamp = idx === trace.steps.length - 1;
      const isReverse = idx >= 4 && !isLamp;
      const stepClass = isLamp ? "flow-step lamp-step" : (isReverse ? "flow-step reverse-step" : "flow-step active");
      const shortStage = s.stage
        .replace("Plugboard In", "PLUG IN")
        .replace("Rotor III (Right)", "R-III")
        .replace("Rotor II (Mid)", "R-II")
        .replace("Rotor I (Left)", "R-I")
        .replace("Reflector B", "UKW-B")
        .replace("Rotor I Reverse", "R-I ↩")
        .replace("Rotor II Reverse", "R-II ↩")
        .replace("Rotor III Reverse", "R-III ↩")
        .replace("Plugboard Out", "LAMP");
      return `
        <span class="${stepClass}">${shortStage}: <strong>${s.val}</strong></span>
        ${isLamp ? "" : '<span class="flow-arrow">➔</span>'}
      `;
    }).join("")}
  `;
  elements.circuitTrace.innerHTML = html;
}

function triggerKey(char, appendToPaper = true) {
  const upper = char.toUpperCase();
  if (upper < "A" || upper > "Z") return;

  // Press key button visually
  const keyBtn = elements.keyboard.querySelector(`[data-key="${upper}"]`);
  if (keyBtn) {
    keyBtn.classList.add("pressed");
    setTimeout(() => keyBtn.classList.remove("pressed"), 160);
  }

  // Audio FX
  sounds.playKeyClack();

  // Machine process
  const res = state.machine.processChar(upper, true);
  updateRotorUI();
  lightLamp(res.char);
  renderCircuitTrace(res.trace);

  // Append to paper tape if manual typing
  if (appendToPaper && !state.isSimulating) {
    if (elements.paperText.textContent.startsWith("INITIALIZING")) {
      elements.paperText.textContent = "";
    }
    elements.paperText.textContent += res.char;
  }

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
    drawInternals(null);
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
    drawInternals(null);
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
  } else if (e.key === " " && !state.isSimulating) {
    e.preventDefault();
    elements.paperText.textContent += " ";
    sounds.playKeyClack();
  }
});

// -------------------------------------------------------------
// Full Interactive Steckerbrett (Plugboard) Controller
// -------------------------------------------------------------

function initSteckerbrett() {
  if (!elements.steckerGrid) return;

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  elements.steckerGrid.innerHTML = alphabet.map(letter => `
    <div class="stecker-socket" data-letter="${letter}">
      <div class="jack-holes">
        <span class="jack-pin"></span>
        <span class="jack-pin"></span>
      </div>
      <span class="socket-letter">${letter}</span>
      <span class="socket-plug-tag" id="plug-tag-${letter}"></span>
    </div>
  `).join("");

  elements.steckerGrid.querySelectorAll(".stecker-socket").forEach(sock => {
    sock.addEventListener("click", () => {
      const letter = sock.dataset.letter;
      handleSocketClick(letter);
    });
  });

  if (elements.btnResetPlugs) {
    elements.btnResetPlugs.addEventListener("click", () => {
      state.plugPairs = [...ENIGMA_CONFIG.defaultPlugboard];
      state.selectedPlugSocket = null;
      state.machine.setPlugboard(state.plugPairs);
      sounds.playRotorStep();
      updateSteckerbrettUI();
      drawInternals(null);
    });
  }

  if (elements.btnClearPlugs) {
    elements.btnClearPlugs.addEventListener("click", () => {
      state.plugPairs = [];
      state.selectedPlugSocket = null;
      state.machine.setPlugboard([]);
      sounds.playRotorStep();
      updateSteckerbrettUI();
      drawInternals(null);
    });
  }

  window.addEventListener("resize", () => {
    drawSteckerCables();
    drawInternals(state.lastTrace);
  });
  updateSteckerbrettUI();
}

function handleSocketClick(letter) {
  sounds.playKeyClack();

  // Check if this letter is already plugged in a pair
  const existingIndex = state.plugPairs.findIndex(pair => pair.includes(letter));
  if (existingIndex !== -1) {
    // Unplug this pair
    state.plugPairs.splice(existingIndex, 1);
    state.selectedPlugSocket = null;
    state.machine.setPlugboard(state.plugPairs);
    updateSteckerbrettUI();
    drawInternals(null);
    return;
  }

  // Socket is free
  if (!state.selectedPlugSocket) {
    state.selectedPlugSocket = letter;
    updateSteckerbrettUI();
  } else if (state.selectedPlugSocket === letter) {
    state.selectedPlugSocket = null;
    updateSteckerbrettUI();
  } else {
    // Form new pair!
    const newPair = [state.selectedPlugSocket, letter].sort().join("");
    if (state.plugPairs.length < 10) {
      state.plugPairs.push(newPair);
    }
    state.selectedPlugSocket = null;
    state.machine.setPlugboard(state.plugPairs);
    updateSteckerbrettUI();
    drawInternals(null);
  }
}

function updateSteckerbrettUI() {
  if (!elements.steckerGrid) return;

  const mapping = new Map();
  for (const pair of state.plugPairs) {
    mapping.set(pair[0], pair[1]);
    mapping.set(pair[1], pair[0]);
  }

  elements.steckerGrid.querySelectorAll(".stecker-socket").forEach(sock => {
    const letter = sock.dataset.letter;
    const tagEl = document.getElementById(`plug-tag-${letter}`);

    sock.classList.remove("plugged", "selected");

    if (state.selectedPlugSocket === letter) {
      sock.classList.add("selected");
      if (tagEl) tagEl.textContent = "SELECT…";
    } else if (mapping.has(letter)) {
      sock.classList.add("plugged");
      if (tagEl) tagEl.textContent = `⇄ ${mapping.get(letter)}`;
    } else {
      if (tagEl) tagEl.textContent = "";
    }
  });

  if (elements.plugCountBadge) {
    elements.plugCountBadge.textContent = `${state.plugPairs.length} / 10 PAIRS`;
  }

  if (elements.plugPairsText) {
    elements.plugPairsText.textContent = state.plugPairs.length > 0 ? state.plugPairs.join(" · ") : "NONE (STRAIGHT THROUGH)";
  }

  if (elements.plugboardPairsList) {
    elements.plugboardPairsList.innerHTML = state.plugPairs.map(pair => `
      <div class="plug-badge" data-unplug="${pair}" title="Click to remove plug">
        🔌 ${pair[0]} ⇄ ${pair[1]} <span style="opacity: 0.6; font-size: 0.7rem;">✕</span>
      </div>
    `).join("");

    elements.plugboardPairsList.querySelectorAll("[data-unplug]").forEach(badge => {
      badge.addEventListener("click", () => {
        const pairToRemove = badge.dataset.unplug;
        state.plugPairs = state.plugPairs.filter(p => p !== pairToRemove);
        state.machine.setPlugboard(state.plugPairs);
        sounds.playKeyClack();
        updateSteckerbrettUI();
        drawInternals(null);
      });
    });
  }

  setTimeout(drawSteckerCables, 50);
}

function drawSteckerCables() {
  if (!elements.steckerSvg || !elements.steckerGrid) return;

  const gridRect = elements.steckerGrid.getBoundingClientRect();
  if (gridRect.width === 0) return;

  const colors = [
    "#00e5ff", "#ff3344", "#ffaa22", "#00ff9d", "#b537f2", 
    "#f7d154", "#2de2e6", "#ff6c00", "#38ef7d", "#ea00d9"
  ];

  const trace = state.lastTrace;
  const fwdPair = (trace && trace.steps && trace.steps[0] && trace.steps[0].swapped)
    ? [trace.input, trace.steps[0].val].sort().join("")
    : null;
  const retPair = (trace && trace.steps && trace.steps[8] && trace.steps[8].swapped)
    ? [trace.steps[8].prePlug, trace.steps[8].val].sort().join("")
    : null;

  let svg = "";
  state.plugPairs.forEach((pair, idx) => {
    const sockA = elements.steckerGrid.querySelector(`.stecker-socket[data-letter="${pair[0]}"]`);
    const sockB = elements.steckerGrid.querySelector(`.stecker-socket[data-letter="${pair[1]}"]`);
    if (sockA && sockB) {
      const rectA = sockA.getBoundingClientRect();
      const rectB = sockB.getBoundingClientRect();

      const x1 = rectA.left + rectA.width / 2 - gridRect.left;
      const y1 = rectA.top + rectA.height / 2 - gridRect.top;
      const x2 = rectB.left + rectB.width / 2 - gridRect.left;
      const y2 = rectB.top + rectB.height / 2 - gridRect.top;

      const sortedPair = [pair[0], pair[1]].sort().join("");
      const isFwd = sortedPair === fwdPair;
      const isRet = sortedPair === retPair;

      const color = isFwd ? "#00e5ff" : (isRet ? "#ffaa22" : colors[idx % colors.length]);
      const droop = Math.min(35, Math.abs(x2 - x1) * 0.25 + 15);
      const pathD = `M ${x1} ${y1} C ${x1} ${y1 + droop}, ${x2} ${y2 + droop}, ${x2} ${y2}`;

      svg += `
        <path d="${pathD}" 
              fill="none" stroke="${color}" stroke-width="${(isFwd || isRet) ? 3.5 : 2.5}" stroke-linecap="round" opacity="${(isFwd || isRet) ? 1 : 0.82}" />
        <path d="${pathD}" 
              fill="none" stroke="#ffffff" stroke-width="${(isFwd || isRet) ? 1.4 : 0.8}" stroke-linecap="round" opacity="${(isFwd || isRet) ? 0.95 : 0.55}" ${(isFwd || isRet) ? 'class="signal-pulse-path"' : ''} />
        <circle cx="${x1}" cy="${y1}" r="${(isFwd || isRet) ? 4.2 : 3}" fill="${color}" stroke="#ffffff" stroke-width="0.8" />
        <circle cx="${x2}" cy="${y2}" r="${(isFwd || isRet) ? 4.2 : 3}" fill="${color}" stroke="#ffffff" stroke-width="0.8" />
      `;
    }
  });

  elements.steckerSvg.innerHTML = svg;
}

// -------------------------------------------------------------
// Teleprinter Paper Tape Controls
// -------------------------------------------------------------

if (elements.btnClearPaper) {
  elements.btnClearPaper.addEventListener("click", () => {
    elements.paperText.textContent = "";
  });
}

if (elements.btnReplayPaper) {
  elements.btnReplayPaper.addEventListener("click", () => {
    const tx = state.currentReplayTx || state.transmissions[0];
    if (tx) {
      replayTransmission(tx);
    }
  });
}

// -------------------------------------------------------------
// Replay Transmission on Enigma & Type on Paper
// -------------------------------------------------------------

async function replayTransmission(tx) {
  if (state.isSimulating || !tx) return;
  state.isSimulating = true;
  state.currentReplayTx = tx;

  // Update paper metadata header
  const sentTime = new Date(tx.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (elements.paperTxNum) elements.paperTxNum.textContent = `TX: #${tx.number}`;
  if (elements.paperTxStart) elements.paperTxStart.textContent = `START: ${tx.start}`;
  if (elements.paperTxTime) elements.paperTxTime.textContent = `TIME: ${sentTime}`;
  if (elements.paperText) elements.paperText.textContent = "";
  if (elements.circuitBayStatus) elements.circuitBayStatus.textContent = "DECODING LIVE SIGNAL…";

  // Set rotor start positions
  state.machine.setPositions(tx.start);
  sounds.playRotorStep();
  updateRotorUI();

  // Highlight corresponding card in list if exists
  elements.txList.querySelectorAll(".tx-card").forEach(c => {
    if (c.dataset.txNum === String(tx.number)) {
      c.classList.add("selected");
    } else {
      c.classList.remove("selected");
    }
  });

  const chars = tx.ciphertext.split("");
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch.toUpperCase() >= "A" && ch.toUpperCase() <= "Z") {
      const decoded = triggerKey(ch, false);
      if (elements.paperText) {
        elements.paperText.textContent += decoded;
      }
      await new Promise(r => setTimeout(r, 85));
    } else {
      // Spaces, punctuation, digits pass straight through
      if (elements.paperText) {
        elements.paperText.textContent += ch;
      }
      sounds.playKeyClack();
      await new Promise(r => setTimeout(r, 45));
    }
  }

  // Typewriter bell on transmission completion
  sounds.playBell();
  if (elements.circuitBayStatus) {
    elements.circuitBayStatus.textContent = "SIGNAL DECODED ✓";
  }

  state.isSimulating = false;
}

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

    // Auto-replay latest transmission on first load for maximum wow factor!
    if (!state.hasInitialReplayed && state.transmissions.length > 0) {
      state.hasInitialReplayed = true;
      setTimeout(() => {
        replayTransmission(state.transmissions[0]);
      }, 700);
    }
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
          <button class="btn-mini btn-tx-simulate" data-num="${tx.number}">▶ Run Live</button>
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
      const num = parseInt(btn.dataset.num, 10);
      const targetTx = state.transmissions.find(t => t.number === num);
      if (targetTx) {
        replayTransmission(targetTx);
      }
    });
  });

  elements.txList.querySelectorAll(".tx-card").forEach(card => {
    card.addEventListener("click", () => {
      const num = parseInt(card.dataset.txNum, 10);
      const targetTx = state.transmissions.find(t => t.number === num);
      if (targetTx) {
        replayTransmission(targetTx);
      }
    });
  });
}

// -------------------------------------------------------------
// Agenda Parser & Aggregator
// -------------------------------------------------------------

function parseAndRenderAgenda() {
  const itemsMap = new Map();

  for (const tx of state.transmissions) {
    const plain = decodeEnigma(tx.start, tx.ciphertext);
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
    const fakeTx = {
      number: 9999,
      start,
      ciphertext: input,
      sentAt: new Date().toISOString()
    };
    replayTransmission(fakeTx);
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
initSteckerbrett();
drawInternals(null);
setTimeout(() => drawInternals(state.lastTrace), 120);
startPolling();
