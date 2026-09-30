// Microphone capture in the widget. Records 16 kHz mono PCM, encodes a WAV
// and hands it to the main process, which transcribes and pastes it.

const SAMPLE_RATE = 16000;
const MAX_SECONDS = 60;

function encodeWav(chunks, sampleRate) {
  const samples = chunks.reduce((n, c) => n + c.length, 0);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const ascii = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits
  ascii(36, 'data');
  view.setUint32(40, samples * 2, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      view.setInt16(offset, Math.max(-1, Math.min(1, sample)) * 32767, true);
      offset += 2;
    }
  }
  return buffer;
}

export class VoiceRecorder {
  /** @param {{ onLevel?: (level: number) => void, onAutoStop?: () => void }} handlers */
  constructor({ onLevel, onAutoStop } = {}) {
    this.onLevel = onLevel || (() => {});
    this.onAutoStop = onAutoStop || (() => {});
    this.recording = false;
    this.chunks = [];
    this.ctx = null;
    this.stream = null;
    this.node = null;
    this.stopTimer = null;
  }

  get seconds() {
    return this.chunks.reduce((n, c) => n + c.length, 0) / SAMPLE_RATE;
  }

  async start() {
    if (this.recording) return;
    this.chunks = [];
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    await this.ctx.audioWorklet.addModule('pcm-worklet.js');
    this.node = new AudioWorkletNode(this.ctx, 'pcm-collector');
    this.node.port.onmessage = ({ data }) => {
      if (!this.recording) return;
      this.chunks.push(data);
      let peak = 0;
      for (const s of data) peak = Math.max(peak, Math.abs(s));
      this.onLevel(peak);
    };
    this.ctx.createMediaStreamSource(this.stream).connect(this.node);
    // The worklet needs a sink to be pulled, but we don't want to hear ourselves.
    this.node.connect(this.ctx.createGain()).connect(this.ctx.destination);
    this.recording = true;
    this.stopTimer = setTimeout(() => this.onAutoStop(), MAX_SECONDS * 1000);
  }

  /** Stop and return the recorded WAV, or null if nothing usable was captured. */
  stop() {
    if (!this.recording) return null;
    this.recording = false;
    clearTimeout(this.stopTimer);
    this.onLevel(0);
    const seconds = this.seconds;
    const wav = seconds >= 0.3 ? encodeWav(this.chunks, SAMPLE_RATE) : null;
    this.chunks = [];
    for (const track of this.stream?.getTracks() || []) track.stop();
    this.node?.port.close();
    this.ctx?.close();
    this.ctx = this.stream = this.node = null;
    return wav;
  }
}
