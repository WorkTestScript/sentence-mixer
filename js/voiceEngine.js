/**
 * Voice Engine Module
 * Handles all speech synthesis functionality
 */

/**
 * Free Google voices, always offered regardless of browser/OS, since the
 * system voice list (speechSynthesis.getVoices()) varies wildly - old
 * browsers and anything other than Chrome fall back to a local OS voice,
 * which is often low quality.
 *
 * These use Google Translate's public "listen" audio endpoint (the same
 * one translate.google.com itself uses to read text aloud) rather than the
 * browser's own speechSynthesis. This is NOT an official/documented Google
 * API - there is no key, no guaranteed uptime, and Google could change or
 * restrict it at any time - but it is free, needs no sign-up, and works in
 * any browser that can play audio, not just Chrome.
 *
 * Important: this must be the translate.googleapis.com domain, not
 * translate.google.com. The googleapis.com host doesn't 404 requests
 * carrying a Referer from another site the way translate.google.com does,
 * which matters once the page is actually deployed somewhere (e.g. GitHub
 * Pages) rather than opened locally. The accent (British vs American) is
 * just the region-qualified "tl" value (en-GB / en-US) - no domain-swapping
 * trick needed.
 */
const GOOGLE_VOICES = [
  { id: "google-en-GB", label: "Google (British English)", locale: "en-GB" },
  { id: "google-en-US", label: "Google (American English)", locale: "en-US" },
]

// Google's TTS endpoint silently truncates or rejects very long requests
// (historically, right around 100 characters). Text longer than this is
// split into several chunks (preferring to break at sentence/clause
// boundaries) and played back to back.
const GOOGLE_TTS_MAX_CHUNK_LENGTH = 110

// Retry/stall-recovery timing, ported from a sibling app that has been
// reading long texts aloud via this same free Google endpoint in
// production for months without complaints. The core idea: a failed or
// stuck request for a chunk is retried with a fresh cache-busting param,
// indefinitely, rather than given up on after one or two tries - most
// failures against this endpoint are transient.
const GOOGLE_TTS_RETRY_DELAY_MS = 1000 // retry delay when a request fails outright (network error, rejected play())
const GOOGLE_TTS_STALL_MIN_MS = 8000 // shortest time to wait before assuming a "silently stuck" chunk needs retrying
const GOOGLE_TTS_STALL_MAX_MS = 25000 // longest such wait, for long chunks
// Not present in the reference app (which retries forever) - added purely
// as an outer safety net so a single utterance can't retry literally
// forever if Google is genuinely unreachable (e.g. no internet at all).
// High enough that it should never be hit in the normal transient-failure
// case this logic is designed to recover from.
const GOOGLE_TTS_MAX_RETRIES_PER_UTTERANCE = 20

class VoiceEngine {
  constructor() {
    this.voiceSelect = null;
    this.speedControl = null;
    this.pitchControl = null;
    this.volumeControl = null;
    this.isInitialized = false;
    // Tracks the <audio> element currently playing a Google voice, if any,
    // so stop() and isSpeaking() can account for it alongside speechSynthesis.
    this._googleAudio = null;
    // Lets stop() cancel a Google utterance that's still in progress across
    // its chunk-by-chunk playback.
    this._cancelGoogleSpeech = null;
  }

  /**
   * Initialize the voice engine with control elements
   * @param {HTMLElement} voiceSelect - Voice selection dropdown
   * @param {HTMLElement} speedControl - Speed control input
   * @param {HTMLElement} pitchControl - Pitch control input
   * @param {HTMLElement} volumeControl - Volume control input
   */
  init(voiceSelect, speedControl, pitchControl, volumeControl) {
    this.voiceSelect = voiceSelect;
    this.speedControl = speedControl;
    this.pitchControl = pitchControl;
    this.volumeControl = volumeControl;
    this.isInitialized = true;
    this.loadVoices();
    this.voiceSelect.addEventListener("change", () => this.updatePitchAvailability());
  }

  /**
   * Google's voices are a plain pre-recorded audio file, not a
   * real-time-synthesized voice, so there is no pitch parameter to send it
   * and (unlike speed) it can't be faked client-side either: doing real
   * pitch-shifting would mean decoding the audio samples via the Web Audio
   * API, but Google's endpoint doesn't send the CORS headers needed for a
   * cross-origin page to read that audio data, so the browser blocks it.
   * Rather than silently ignore the slider, disable it while a Google
   * voice is selected so it's clear that setting doesn't apply right now.
   */
  updatePitchAvailability() {
    if (!this.isInitialized) return;

    const isGoogleVoice = GOOGLE_VOICES.some((v) => v.id === this.voiceSelect.value);
    this.pitchControl.disabled = isGoogleVoice;
    this.pitchControl.title = isGoogleVoice
      ? "Недоступно для голосів Google: це готовий аудіофайл, а не голос, синтезований у реальному часі"
      : "";
  }

  /**
   * Load available voices into the voice select dropdown
   */
  loadVoices() {
    if (!this.isInitialized) return;

    const voices = speechSynthesis.getVoices();

    const googleOptionsHtml = GOOGLE_VOICES
      .map((v) => `<option value="${v.id}">${v.label}</option>`)
      .join("");

    const systemOptionsHtml = voices
      .map((voice) => `<option value="${voice.name}">${voice.name} (${voice.lang})</option>`)
      .join("");

    // Google voices are always listed (any browser, any OS), with the
    // system voices - if there are any - grouped separately below them.
    this.voiceSelect.innerHTML =
      `<optgroup label="Google (онлайн, безкоштовно)">${googleOptionsHtml}</optgroup>` +
      (systemOptionsHtml ? `<optgroup label="Системні голоси">${systemOptionsHtml}</optgroup>` : "");

    this.loadVoiceSettings();
  }

  /**
   * Load voice settings from localStorage
   */
  loadVoiceSettings() {
    if (!this.isInitialized) return;
    
    this.voiceSelect.value = localStorage.getItem("voice") || this.voiceSelect.value;
    this.speedControl.value = localStorage.getItem("speed") || 1;
    this.pitchControl.value = localStorage.getItem("pitch") || 1;
    this.volumeControl.value = localStorage.getItem("volume") || 1;
    this.updatePitchAvailability();
  }

  /**
   * Save voice settings to localStorage
   */
  saveSettings() {
    if (!this.isInitialized) return;
    
    localStorage.setItem("voice", this.voiceSelect.value);
    localStorage.setItem("speed", this.speedControl.value);
    localStorage.setItem("pitch", this.pitchControl.value);
    localStorage.setItem("volume", this.volumeControl.value);
  }

  /**
   * Speak text with current voice settings
   * @param {string} text - Text to speak
   * @param {function} onEnd - Callback function when speech ends
   * @param {boolean} autoClose - Whether to auto-close popup after speech
   */
  speak(text, onEnd = null, autoClose = false) {
    if (!this.isInitialized) return;

    const googleVoice = GOOGLE_VOICES.find((v) => v.id === this.voiceSelect.value);
    if (googleVoice) {
      this.speakWithGoogle(text, googleVoice, onEnd);
    } else {
      this.speakWithSystemVoice(text, onEnd);
    }
  }

  /**
   * Speak using the browser's own speechSynthesis (the original behavior).
   * @param {string} text - Text to speak
   * @param {function} onEnd - Callback function when speech ends
   */
  speakWithSystemVoice(text, onEnd = null) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice =
      speechSynthesis.getVoices().find((voice) => voice.name === this.voiceSelect.value) ||
      speechSynthesis.getVoices()[0];
    utterance.rate = Number.parseFloat(this.speedControl.value);
    utterance.pitch = Number.parseFloat(this.pitchControl.value);
    utterance.volume = Number.parseFloat(this.volumeControl.value);

    utterance.onend = () => {
      if (onEnd) onEnd();
      this.notifySpeechEnd();
      this.triggerOnSpeechEndCallback();
    };

    speechSynthesis.speak(utterance);
  }

  /**
   * Split text for the Google TTS endpoint, which rejects/mangles very
   * long requests. Prefers to break at sentence or clause boundaries so
   * playback doesn't cut mid-word.
   * @param {string} text
   * @param {number} maxLen
   * @returns {string[]}
   */
  splitTextForGoogleTTS(text, maxLen = GOOGLE_TTS_MAX_CHUNK_LENGTH) {
    let remaining = text.trim();
    if (remaining.length <= maxLen) return remaining ? [remaining] : [];

    const parts = [];
    while (remaining.length > maxLen) {
      let splitIndex = -1;
      for (const delimiter of [". ", "! ", "? ", ", ", " "]) {
        const idx = remaining.lastIndexOf(delimiter, maxLen);
        if (idx > 0) {
          splitIndex = idx + delimiter.length;
          break;
        }
      }
      if (splitIndex === -1) splitIndex = maxLen;
      parts.push(remaining.slice(0, splitIndex).trim());
      remaining = remaining.slice(splitIndex).trim();
    }
    if (remaining) parts.push(remaining);
    return parts;
  }

  /**
   * Build the Google TTS request URL for one chunk of text.
   * @param {{locale:string}} voiceInfo
   * @param {string} text
   * @param {number} retryCount - >0 adds a cache-busting param for a retry
   */
  getGoogleTTSUrl(voiceInfo, text, retryCount = 0) {
    const retryParam = retryCount ? `&retry=${Date.now()}-${retryCount}` : "";
    return (
      `https://translate.googleapis.com/translate_tts` +
      `?ie=UTF-8&client=tw-ob&tl=${voiceInfo.locale}&q=${encodeURIComponent(text)}${retryParam}`
    );
  }

  /**
   * Estimate how long a chunk should take to speak, so a request that
   * neither finishes nor errors out (silently stuck) still gets retried
   * instead of leaving the app waiting forever. Same estimate/formula as
   * the reference app: roughly 12 characters/second, scaled by speed, plus
   * a fixed buffer, clamped to a sane min/max.
   * @param {string} chunkText
   * @param {number} rate
   */
  getGoogleStallDelay(chunkText, rate) {
    if (!chunkText) return GOOGLE_TTS_STALL_MIN_MS;
    const estimate = ((chunkText.length / 12) * 1000) / rate;
    return Math.min(
      GOOGLE_TTS_STALL_MAX_MS,
      Math.max(GOOGLE_TTS_STALL_MIN_MS, Math.ceil(estimate + 4000))
    );
  }

  /**
   * Speak using Google Translate's free "listen" audio endpoint - the same
   * unofficial trick tools like the gTTS library use. A chunk that fails
   * outright (network error, rejected play()) or goes silently stuck
   * (no 'ended'/'error' within its expected duration) is retried in place
   * with a fresh cache-busting param, rather than given up on quickly -
   * most failures against this endpoint are transient. Only falls back to
   * the system voice as a last resort, after many retries.
   * @param {string} text - Text to speak
   * @param {{id:string,label:string,locale:string}} voiceInfo
   * @param {function} onEnd - Callback function when speech ends
   */
  speakWithGoogle(text, voiceInfo, onEnd = null) {
    this.stop();

    const queue = this.splitTextForGoogleTTS(text);
    if (queue.length === 0) {
      if (onEnd) onEnd();
      this.notifySpeechEnd();
      this.triggerOnSpeechEndCallback();
      return;
    }

    const volume = Number.parseFloat(this.volumeControl.value);
    const rate = Number.parseFloat(this.speedControl.value);
    // Note: this endpoint returns a plain audio file, so there's no pitch
    // control here (unlike the system voice) - only speed (via
    // playbackRate, which will also shift pitch slightly, same as
    // speeding up/slowing down a recording) and volume.
    const effectiveRate = Number.isFinite(rate) && rate > 0 ? rate : 1;

    const audio = new Audio();
    this._googleAudio = audio;
    audio.referrerPolicy = "no-referrer";
    audio.setAttribute("referrerpolicy", "no-referrer");
    audio.volume = Number.isFinite(volume) ? volume : 1;
    audio.defaultPlaybackRate = effectiveRate;
    audio.playbackRate = effectiveRate;
    audio.addEventListener("loadedmetadata", () => {
      audio.playbackRate = effectiveRate;
    });

    let cancelled = false;
    let recoveryTimer = null;
    let currentChunk = null;
    let retryCountForChunk = 0;
    let totalRetryCount = 0;

    const clearRecoveryTimer = () => {
      clearTimeout(recoveryTimer);
      recoveryTimer = null;
    };

    this._cancelGoogleSpeech = () => {
      cancelled = true;
      clearRecoveryTimer();
    };

    const finish = () => {
      clearRecoveryTimer();
      this._googleAudio = null;
      if (onEnd) onEnd();
      this.notifySpeechEnd();
      this.triggerOnSpeechEndCallback();
    };

    const fallbackToSystemVoice = () => {
      if (cancelled) return;
      clearRecoveryTimer();
      this._googleAudio = null;
      console.log("Google voice not responding after repeated retries, falling back to the system voice.");
      this.speakWithSystemVoice(text, onEnd);
    };

    const scheduleStallRecovery = () => {
      clearRecoveryTimer();
      recoveryTimer = setTimeout(retryCurrentChunk, this.getGoogleStallDelay(currentChunk, effectiveRate));
    };

    const scheduleQuickRetry = () => {
      clearRecoveryTimer();
      recoveryTimer = setTimeout(retryCurrentChunk, GOOGLE_TTS_RETRY_DELAY_MS);
    };

    const loadAndPlay = () => {
      audio.src = this.getGoogleTTSUrl(voiceInfo, currentChunk, retryCountForChunk);
      audio.playbackRate = effectiveRate;
      scheduleStallRecovery();
      audio.play().then(() => {
        // Some browsers only honor playbackRate once playback has actually
        // started, so set it once more right after play() resolves.
        audio.playbackRate = effectiveRate;
      }).catch(scheduleQuickRetry);
    };

    const retryCurrentChunk = () => {
      if (cancelled || !currentChunk) return;

      totalRetryCount++;
      if (totalRetryCount > GOOGLE_TTS_MAX_RETRIES_PER_UTTERANCE) {
        fallbackToSystemVoice();
        return;
      }

      retryCountForChunk++;
      audio.pause();
      loadAndPlay();
    };

    const playNextChunk = () => {
      if (cancelled) return;
      if (!queue.length) {
        finish();
        return;
      }
      currentChunk = queue.shift();
      retryCountForChunk = 0;
      loadAndPlay();
    };

    audio.addEventListener("ended", () => {
      if (cancelled) return;
      clearRecoveryTimer();
      currentChunk = null;
      playNextChunk();
    });
    audio.addEventListener("error", retryCurrentChunk);
    audio.addEventListener("stalled", retryCurrentChunk);

    playNextChunk();
  }

  /**
   * Method that gets called when speech ends - can be overridden or extended
   */
  notifySpeechEnd() {
    // This method can be extended or used as a callback when speech finishes
  }

  /**
   * Set a callback function to be called when speech ends
   * @param {function} callback - Function to call when speech finishes
   */
  setOnSpeechEndCallback(callback) {
    this.onSpeechEndCallback = callback;
  }

  /**
   * Internal method to call the speech end callback
   */
  triggerOnSpeechEndCallback() {
    if (this.onSpeechEndCallback && typeof this.onSpeechEndCallback === 'function') {
      this.onSpeechEndCallback();
    }
  }

  /**
   * Stop current speech
   */
  stop() {
    speechSynthesis.cancel();

    if (this._cancelGoogleSpeech) {
      this._cancelGoogleSpeech();
      this._cancelGoogleSpeech = null;
    }
    if (this._googleAudio) {
      try {
        this._googleAudio.onended = null;
        this._googleAudio.onerror = null;
        this._googleAudio.pause();
        this._googleAudio.src = "";
      } catch (e) {
        // Nothing to do - we're discarding this audio element anyway
      }
      this._googleAudio = null;
    }
  }

  /**
   * Get current voice settings
   * @returns {object} Current voice settings
   */
  getSettings() {
    if (!this.isInitialized) return {};
    
    return {
      voice: this.voiceSelect.value,
      speed: this.speedControl.value,
      pitch: this.pitchControl.value,
      volume: this.volumeControl.value
    };
  }

  /**
   * Set voice settings
   * @param {object} settings - Voice settings to apply
   */
  setSettings(settings) {
    if (!this.isInitialized) return;
    
    if (settings.voice) this.voiceSelect.value = settings.voice;
    if (settings.speed) this.speedControl.value = settings.speed;
    if (settings.pitch) this.pitchControl.value = settings.pitch;
    if (settings.volume) this.volumeControl.value = settings.volume;
  }

  /**
   * Check if speech is currently active
   * @returns {boolean} True if speech is active
   */
  isSpeaking() {
    return speechSynthesis.speaking || !!this._googleAudio;
  }

  /**
   * Get available voices
   * @returns {Array} Array of available voices
   */
  getAvailableVoices() {
    return speechSynthesis.getVoices();
  }
}

// Create global instance
const voiceEngine = new VoiceEngine();

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VoiceEngine;
}
