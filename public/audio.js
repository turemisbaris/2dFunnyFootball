/**
 * REBOUND - Procedural Web Audio Synthesizer
 * Zero asset download time, instant arcade sports feedback.
 */
(function (root) {
  'use strict';

  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.enabled = true;
    }

    init() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    }

    play(type, power = 0.5) {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;

      switch (type) {
        case 'pass':
          this.tone(150, 55, 0.09, 'triangle', 0.28);
          break;
        case 'shot': {
          const freq = 180 + power * 110;
          this.tone(freq, 42, 0.16, 'sawtooth', 0.38);
          this.noise(0.09, 0.25);
          break;
        }
        case 'lob':
          this.tone(220, 420, 0.14, 'sine', 0.25);
          break;
        case 'knock':
          this.tone(190, 95, 0.07, 'triangle', 0.22);
          break;
        case 'wall':
          this.tone(130, 65, 0.08, 'sine', 0.24);
          break;
        case 'bounce':
          this.tone(105, 55, 0.06, 'sine', 0.14);
          break;
        case 'slide':
        case 'dive':
          this.noise(0.18, 0.22, 900);
          break;
        case 'poke':
        case 'poke_hit':
          this.tone(260, 120, 0.06, 'square', 0.18);
          break;
        case 'stun':
          this.tone(520, 140, 0.22, 'sawtooth', 0.32);
          break;
        case 'gk_save':
          this.tone(320, 640, 0.18, 'triangle', 0.35);
          break;
        case 'whiff':
          this.tone(160, 75, 0.18, 'sine', 0.18);
          break;
        case 'goal':
          this.chord([261.6, 329.6, 392.0, 523.2], 0.65, 0.25);
          break;
        case 'golden_goal_start':
        case 'overtime_boost':
          this.chord([330, 440, 659.2], 0.45, 0.22);
          break;
        case 'whistle_start':
        case 'kickoff':
          this.tone(2600, 2750, 0.18, 'sine', 0.18);
          break;
      }
    }

    tone(startFreq, endFreq, duration, waveType, gainVal) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = waveType || 'sine';
      osc.frequency.setValueAtTime(startFreq, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), this.ctx.currentTime + duration);

      gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    }

    noise(duration, gainVal, filterFreq = 1200) {
      const bufferSize = Math.floor(this.ctx.sampleRate * duration);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = filterFreq;

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      noise.start();
    }

    chord(freqs, duration, gainVal) {
      freqs.forEach((f) => {
        this.tone(f, f * 1.01, duration, 'sawtooth', gainVal / freqs.length);
      });
    }
  }

  root.ReboundAudio = new SoundEngine();
})(window);
