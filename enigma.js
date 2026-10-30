/**
 * Enigma I Machine Implementation
 * Specification matching DevFest Vibe Lounge /api/enigma
 */

export const ENIGMA_CONFIG = {
  machine: "Enigma I",
  rotors: [
    { name: "I", wiring: "EKMFLGDQVZNTOWYHXUSPAIBRCJ", notch: "Q" },
    { name: "II", wiring: "AJDKSIRUXBLHWTMCQGZNPYFVOE", notch: "E" },
    { name: "III", wiring: "BDFHJLCPRTXVZNYEIWGAKMUSQO", notch: "V" }
  ],
  reflector: { name: "B", wiring: "YRUHQSLDPXNGOKMIEBFZCWVJAT" },
  rings: "AAA",
  defaultPlugboard: ["DE", "VF", "ST"],
  alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
};

export class EnigmaMachine {
  constructor(options = {}) {
    this.rotorsConfig = options.rotors || ENIGMA_CONFIG.rotors;
    this.reflector = options.reflector || ENIGMA_CONFIG.reflector;
    this.plugboard = new Map();
    this.setPlugboard(options.plugboard || ENIGMA_CONFIG.defaultPlugboard);

    // Rotor positions: 0 = A, 1 = B, ..., 25 = Z
    // Order: [Left (I), Middle (II), Right (III)]
    this.rotorPositions = [0, 0, 0];
    this.ringSettings = [0, 0, 0];

    // Notch positions (as 0..25)
    this.notchPositions = this.rotorsConfig.map(r => r.notch.charCodeAt(0) - 65);

    if (options.start) {
      this.setPositions(options.start);
    }
  }

  setPlugboard(pairs) {
    this.plugboard.clear();
    for (const pair of pairs) {
      if (pair.length === 2) {
        const a = pair[0].toUpperCase();
        const b = pair[1].toUpperCase();
        this.plugboard.set(a, b);
        this.plugboard.set(b, a);
      }
    }
  }

  setPositions(str) {
    const clean = str.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    for (let i = 0; i < 3; i++) {
      if (clean[i]) {
        this.rotorPositions[i] = clean.charCodeAt(i) - 65;
      }
    }
  }

  getPositions() {
    return this.rotorPositions.map(p => String.fromCharCode(p + 65)).join("");
  }

  /**
   * Advance rotors according to standard Enigma double-stepping rules:
   * - Right rotor steps on every letter.
   * - Middle rotor steps if right rotor was at notch, OR if middle rotor itself is at notch (double-step).
   * - Left rotor steps if middle rotor was at notch.
   */
  step() {
    const rLeftNotch = this.notchPositions[0];
    const rMidNotch = this.notchPositions[1];
    const rRightNotch = this.notchPositions[2];

    const midAtNotch = this.rotorPositions[1] === rMidNotch;
    const rightAtNotch = this.rotorPositions[2] === rRightNotch;

    // Double-stepping:
    if (midAtNotch) {
      this.rotorPositions[0] = (this.rotorPositions[0] + 1) % 26;
      this.rotorPositions[1] = (this.rotorPositions[1] + 1) % 26;
    } else if (rightAtNotch) {
      this.rotorPositions[1] = (this.rotorPositions[1] + 1) % 26;
    }

    this.rotorPositions[2] = (this.rotorPositions[2] + 1) % 26;

    return {
      positions: this.getPositions(),
      stepped: {
        left: midAtNotch,
        middle: midAtNotch || rightAtNotch,
        right: true
      }
    };
  }

  /**
   * Process a single character through the machine
   * Returns: { char: string, trace?: object }
   */
  processChar(ch, captureTrace = false) {
    const upper = ch.toUpperCase();
    if (upper < "A" || upper > "Z") {
      return { char: ch, trace: null };
    }

    // Step rotors before encryption
    const stepInfo = this.step();

    const trace = captureTrace ? { 
      input: upper, 
      rotorPositions: [...this.rotorPositions],
      steps: [] 
    } : null;

    // 1. Plugboard in
    let current = this.plugboard.get(upper) || upper;
    let idx = current.charCodeAt(0) - 65;
    if (trace) trace.steps.push({ 
      stage: "Plugboard In", 
      val: current, 
      idx, 
      input: upper,
      swapped: current !== upper 
    });

    // 2. Right rotor forward (rotor 2)
    const r3_inIdx = idx;
    const r3_inPin = (idx + (this.rotorPositions[2] - this.ringSettings[2] + 26) % 26) % 26;
    idx = this.rotorForward(2, idx);
    const r3_outPin = (idx + (this.rotorPositions[2] - this.ringSettings[2] + 26) % 26) % 26;
    if (trace) trace.steps.push({ 
      stage: "Rotor III (Right)", 
      val: String.fromCharCode(idx + 65), 
      idx, 
      inIdx: r3_inIdx, 
      inPin: r3_inPin, 
      outPin: r3_outPin,
      rotorPos: this.rotorPositions[2]
    });

    // 3. Middle rotor forward (rotor 1)
    const r2_inIdx = idx;
    const r2_inPin = (idx + (this.rotorPositions[1] - this.ringSettings[1] + 26) % 26) % 26;
    idx = this.rotorForward(1, idx);
    const r2_outPin = (idx + (this.rotorPositions[1] - this.ringSettings[1] + 26) % 26) % 26;
    if (trace) trace.steps.push({ 
      stage: "Rotor II (Mid)", 
      val: String.fromCharCode(idx + 65), 
      idx, 
      inIdx: r2_inIdx, 
      inPin: r2_inPin, 
      outPin: r2_outPin,
      rotorPos: this.rotorPositions[1]
    });

    // 4. Left rotor forward (rotor 0)
    const r1_inIdx = idx;
    const r1_inPin = (idx + (this.rotorPositions[0] - this.ringSettings[0] + 26) % 26) % 26;
    idx = this.rotorForward(0, idx);
    const r1_outPin = (idx + (this.rotorPositions[0] - this.ringSettings[0] + 26) % 26) % 26;
    if (trace) trace.steps.push({ 
      stage: "Rotor I (Left)", 
      val: String.fromCharCode(idx + 65), 
      idx, 
      inIdx: r1_inIdx, 
      inPin: r1_inPin, 
      outPin: r1_outPin,
      rotorPos: this.rotorPositions[0]
    });

    // 5. Reflector B
    const ref_inIdx = idx;
    const refChar = this.reflector.wiring[idx];
    idx = refChar.charCodeAt(0) - 65;
    if (trace) trace.steps.push({ 
      stage: "Reflector B", 
      val: refChar, 
      idx, 
      inIdx: ref_inIdx, 
      outIdx: idx 
    });

    // 6. Left rotor backward (rotor 0)
    const r1_revIn = idx;
    idx = this.rotorBackward(0, idx);
    if (trace) trace.steps.push({ 
      stage: "Rotor I Reverse", 
      val: String.fromCharCode(idx + 65), 
      idx,
      inIdx: r1_revIn,
      outIdx: idx,
      rotorPos: this.rotorPositions[0]
    });

    // 7. Middle rotor backward (rotor 1)
    const r2_revIn = idx;
    idx = this.rotorBackward(1, idx);
    if (trace) trace.steps.push({ 
      stage: "Rotor II Reverse", 
      val: String.fromCharCode(idx + 65), 
      idx,
      inIdx: r2_revIn,
      outIdx: idx,
      rotorPos: this.rotorPositions[1]
    });

    // 8. Right rotor backward (rotor 2)
    const r3_revIn = idx;
    idx = this.rotorBackward(2, idx);
    if (trace) trace.steps.push({ 
      stage: "Rotor III Reverse", 
      val: String.fromCharCode(idx + 65), 
      idx,
      inIdx: r3_revIn,
      outIdx: idx,
      rotorPos: this.rotorPositions[2]
    });

    // 9. Plugboard out
    const prePlug = String.fromCharCode(idx + 65);
    const finalChar = this.plugboard.get(prePlug) || prePlug;
    if (trace) trace.steps.push({ 
      stage: "Plugboard Out", 
      val: finalChar, 
      idx: finalChar.charCodeAt(0) - 65,
      prePlug,
      swapped: finalChar !== prePlug
    });

    return { char: finalChar, trace, stepInfo };
  }

  rotorForward(rotorIdx, inIdx) {
    const p = this.rotorPositions[rotorIdx];
    const ring = this.ringSettings[rotorIdx];
    const offset = (p - ring + 26) % 26;
    const pin = (inIdx + offset) % 26;
    const wired = this.rotorsConfig[rotorIdx].wiring.charCodeAt(pin) - 65;
    return (wired - offset + 26) % 26;
  }

  rotorBackward(rotorIdx, inIdx) {
    const p = this.rotorPositions[rotorIdx];
    const ring = this.ringSettings[rotorIdx];
    const offset = (p - ring + 26) % 26;
    const pin = (inIdx + offset) % 26;
    const charToFind = String.fromCharCode(pin + 65);
    const wiredIdx = this.rotorsConfig[rotorIdx].wiring.indexOf(charToFind);
    return (wiredIdx - offset + 26) % 26;
  }

  /**
   * Process a full text string
   */
  processText(text, captureTraces = false) {
    let result = "";
    const traces = [];
    for (const ch of text) {
      const res = this.processChar(ch, captureTraces);
      result += res.char;
      if (captureTraces && res.trace) {
        traces.push(res.trace);
      }
    }
    return { text: result, traces };
  }
}

/**
 * Convenience helper to decode/encode text given start position
 */
export function decodeEnigma(start, text, plugboard = ENIGMA_CONFIG.defaultPlugboard) {
  const machine = new EnigmaMachine({ start, plugboard });
  return machine.processText(text).text;
}
