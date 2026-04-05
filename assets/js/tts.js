// Fallback logger if not yet loaded
if (typeof window.logger === 'undefined') {
    const isProduction = window.location.hostname === 'pmerit.com' ||
                         window.location.hostname === 'www.pmerit.com';
    window.logger = {
        debug: (...args) => { if (!isProduction) console.log('[DEBUG]', ...args); },
        info: (...args) => { if (!isProduction) console.info('[INFO]', ...args); },
        warn: (...args) => { console.warn('[WARN]', ...args); },
        error: (...args) => { console.error('[ERROR]', ...args); }
    };
}

/**
 * PMERIT TTS Module
 * Phase 10: Cloudflare Workers AI TTS Integration
 *
 * Provides browser-based TTS with Web Speech API fallback,
 * Cloudflare Workers AI integration, WebAudio analysis for viseme hints,
 * and optional server-side TTS proxy with voice selection.
 *
 * Voice Tiers:
 * - Standard: AI-generated voice via MeloTTS (free, unlimited)
 * - Primo: Natural human voice via Piper TTS on RunPod (premium)
 * - Browser: Web Speech API fallback (free, offline-capable)
 *
 * @version 2.0.0
 * @updated December 13, 2025 - Added Primo Voice premium TTS
 */

(function (window) {
  'use strict';

  // Event bus via document
  const BUS = document;

  // Helper to get page identifier for analytics
  function aid() {
    return location.pathname.includes('/portal/classroom') ? 'classroom' : 'home';
  }

  // Audio context and analyzer state
  let audioCtx = null;
  let analyser = null;
  let source = null;
  let meterInterval = null;

  // TTS state management (module-level)
  let isSpeaking = false;

  // Voice cache - populated asynchronously
  let cachedVoices = [];
  let voicesLoaded = false;

  // Constants
  const INTENSITY_AMPLIFIER = 2; // Amplify intensity for more visible mouth movement
  const VISEME_UPDATE_INTERVAL = 33; // ~30 FPS
  const SERVER_TTS_TIMEOUT = 30000; // 30 seconds timeout for server TTS requests
  const MAX_TEXT_LENGTH = 5000; // Maximum text length for TTS

  // TTS Settings - Voice Selection
  const SETTINGS_KEY = 'pmerit_tts_settings';

  // Voice options - Free voices use Browser Web Speech API, Premium uses RunPod
  // ARCHITECTURE FIX (Session 65): Free voices must NOT depend on RunPod
  const VOICE_OPTIONS = {
    // FREE VOICES - Browser Web Speech API (always available, genuine variety)
    // These use client-side speech synthesis - no server dependency
    'standard-male': {
      name: 'Standard Male',
      description: 'Clear male voice',
      tier: 'free',
      apiVoice: null,  // Uses browser
      browserVoice: 'male',  // Preference hint for browser voice selection
      useServer: false
    },
    'standard-female': {
      name: 'Standard Female',
      description: 'Clear female voice',
      tier: 'free',
      apiVoice: null,  // Uses browser
      browserVoice: 'female',  // Preference hint for browser voice selection
      useServer: false
    },
    'standard-young': {
      name: 'Young Voice',
      description: 'Friendly young voice',
      tier: 'free',
      apiVoice: null,  // Uses browser
      browserVoice: 'young',  // Preference hint for browser voice selection
      useServer: false
    },
    // PREMIUM VOICES - RunPod Piper/Edge TTS (subscription required)
    // These require RunPod pod to be running
    'primo': {
      name: 'Primo Voice',
      description: 'Natural human voice (Piper TTS)',
      tier: 'premium',
      apiVoice: 'primo',
      requiresSubscription: true,
      useServer: true
    },
    'primo-female': {
      name: 'Primo Female',
      description: 'Natural female voice (Piper TTS)',
      tier: 'premium',
      apiVoice: 'primo-female',
      requiresSubscription: true,
      useServer: true
    },
    // BROWSER FALLBACK (explicit)
    'browser': {
      name: 'Browser Voice',
      description: 'Web Speech API (auto-select)',
      tier: 'free',
      apiVoice: null,
      useServer: false
    },
    // LEGACY MAPPINGS (backward compatibility)
    'standard': {
      name: 'Standard Voice',
      description: 'Default voice (legacy)',
      tier: 'free',
      apiVoice: null,
      browserVoice: 'male',
      useServer: false
    },
    'alloy': {
      name: 'Alloy',
      description: 'Default voice (legacy)',
      tier: 'free',
      apiVoice: null,
      browserVoice: 'male',
      useServer: false
    }
  };

  // Legacy engine mappings for backward compatibility
  const AVAILABLE_ENGINES = {
    // New voices
    'standard-male': 'Standard Male (Edge TTS)',
    'standard-female': 'Standard Female (Edge TTS)',
    'standard-young': 'Young Voice (Edge TTS)',
    'primo': 'Primo Voice (Premium)',
    'primo-female': 'Primo Female (Premium)',
    'browser': 'Browser (Web Speech API)',
    // Legacy mappings - all route to standard-male
    'standard': 'Standard Voice',
    'aura-2-en': 'Standard Voice',
    'aura-1': 'Standard Voice',
    'melotts': 'Standard Voice',
    'alloy': 'Standard Voice'
  };

  /**
   * Initialize voice cache - called on module load
   * Web Speech API loads voices asynchronously, so we need to wait for them
   */
  function initVoiceCache() {
    if (!window.speechSynthesis) {
      logger.warn('speechSynthesis not supported - voice selection disabled');
      return;
    }

    // Try to get voices immediately (works in some browsers)
    cachedVoices = speechSynthesis.getVoices();
    if (cachedVoices.length > 0) {
      voicesLoaded = true;
      logger.debug(`✅ Loaded ${cachedVoices.length} browser voices immediately`);
      logAvailableVoices();
    }

    // Also listen for voiceschanged event (required for Chrome, Edge, etc.)
    speechSynthesis.onvoiceschanged = () => {
      cachedVoices = speechSynthesis.getVoices();
      voicesLoaded = true;
      logger.debug(`✅ Loaded ${cachedVoices.length} browser voices via voiceschanged event`);
      logAvailableVoices();
    };
  }

  /**
   * Log available voices for debugging
   */
  function logAvailableVoices() {
    const englishVoices = cachedVoices.filter(v => v.lang.startsWith('en'));
    logger.debug('Available English voices:', englishVoices.map(v => `${v.name} (${v.lang})`));
  }

  /**
   * Get TTS settings from localStorage
   * Migrates legacy voice engine settings to new voice system
   * @returns {Object} settings object
   */
  function getSettings() {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const settings = JSON.parse(stored);

        // Migrate legacy voice engines to new voice system
        const validVoices = ['standard-male', 'standard-female', 'standard-young', 'primo', 'primo-female', 'browser'];
        if (settings.voiceEngine && !validVoices.includes(settings.voiceEngine)) {
          // Map old engines to 'standard-male'
          const legacyEngines = ['standard', 'aura-2-en', 'aura-1', 'melotts', 'aura-2-es', 'alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
          if (legacyEngines.includes(settings.voiceEngine)) {
            settings.voiceEngine = 'standard-male';
            saveSettings(settings);
            logger.debug('Migrated legacy voice engine to standard-male');
          }
        }

        return settings;
      }
    } catch (e) {
      console.warn('Failed to load TTS settings:', e);
    }
    // Default settings - use standard-male voice with slower rate for teaching
    return {
      voiceEngine: 'standard-male',
      useServer: true,
      speechRate: 0.85,  // Slower for educational content
      speechPitch: 1.0
    };
  }

  /**
   * Save TTS settings to localStorage
   * @param {Object} settings - settings object
   */
  function saveSettings(settings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      console.warn('Failed to save TTS settings:', e);
    }
  }

  /**
   * Start audio metering from MediaStream
   * Emits tts:viseme events with intensity [0..1] at ~30 FPS
   * @private
   */
  function startMeterFromMediaStream(stream) {
    stopMeter();

    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);

      meterInterval = setInterval(() => {
        analyser.getByteFrequencyData(data);

        // Calculate crude energy → intensity
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          sum += data[i];
        }
        const intensity = Math.min(1, (sum / (data.length * 255)) * INTENSITY_AMPLIFIER);

        // Emit viseme event with intensity
        BUS.dispatchEvent(new CustomEvent('tts:viseme', {
          detail: { intensity }
        }));
      }, VISEME_UPDATE_INTERVAL);
    } catch (error) {
      console.error('Failed to start audio meter:', error);
    }
  }

  /**
   * Start audio metering from Audio element
   * @private
   */
  function startMeterFromAudio(audioElement) {
    stopMeter();

    console.log('🎵 Starting audio meter from Audio element');

    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      source = audioCtx.createMediaElementSource(audioElement);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;

      // Connect: audio element -> analyser -> destination (speakers)
      // Note: Audio element output is rerouted through the analyser
      source.connect(analyser);
      analyser.connect(audioCtx.destination);

      const data = new Uint8Array(analyser.frequencyBinCount);
      let emitCount = 0;

      meterInterval = setInterval(() => {
        analyser.getByteFrequencyData(data);

        // Calculate crude energy → intensity
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          sum += data[i];
        }
        const intensity = Math.min(1, (sum / (data.length * 255)) * INTENSITY_AMPLIFIER);

        emitCount++;
        // Log first few emissions for debugging
        if (emitCount <= 3) {
          console.log(`🎵 Emitting tts:viseme #${emitCount}, intensity: ${intensity.toFixed(3)}`);
        }

        // Emit viseme event with intensity
        BUS.dispatchEvent(new CustomEvent('tts:viseme', {
          detail: { intensity }
        }));
      }, VISEME_UPDATE_INTERVAL);

      console.log('✅ Audio meter started, emitting viseme events at', VISEME_UPDATE_INTERVAL, 'ms intervals');
    } catch (error) {
      console.error('Failed to start audio meter:', error);
    }
  }

  /**
   * Stop audio metering
   * @private
   */
  function stopMeter() {
    if (meterInterval) {
      clearInterval(meterInterval);
      meterInterval = null;
    }

    try {
      if (source) {
        source.disconnect();
      }
    } catch (e) {
      // Ignore disconnect errors
    }

    try {
      if (audioCtx) {
        audioCtx.close();
      }
    } catch (e) {
      // Ignore close errors
    }

    source = null;
    analyser = null;
    audioCtx = null;
  }

  /**
   * Speak text using Web Speech API
   * @param {string} text - Text to speak
   * @param {Object|string} voiceSettings - Voice settings object { voiceName, pitch, rate } or just voice name string
   * @returns {Promise<void>}
   */
  function speakWebSpeech(text, voiceSettings) {
    return new Promise((resolve, reject) => {
      // Validate input
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return reject(new Error('Text is required and must be a non-empty string'));
      }

      if (text.length > MAX_TEXT_LENGTH) {
        return reject(new Error(`Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters`));
      }

      if (!window.speechSynthesis) {
        return reject(new Error('speechSynthesis not supported'));
      }

      const utter = new SpeechSynthesisUtterance(text);

      // Handle both object and string formats for backward compatibility
      let voiceName, pitch, rate;
      if (typeof voiceSettings === 'object' && voiceSettings !== null) {
        voiceName = voiceSettings.voiceName;
        pitch = voiceSettings.pitch || 1.0;
        rate = voiceSettings.rate || 1.0;
      } else {
        voiceName = voiceSettings;
        pitch = 1.0;
        rate = 1.0;
      }

      // Set voice if specified
      if (voiceName) {
        const voices = cachedVoices.length ? cachedVoices : speechSynthesis.getVoices();
        const voice = voices.find(v => v.name === voiceName);
        if (voice) {
          utter.voice = voice;
          console.log(`🎤 Set utterance voice to: ${voice.name}`);
        } else {
          console.warn(`🎤 Voice "${voiceName}" not found, using default`);
        }
      }

      // Apply pitch and rate for voice differentiation
      utter.pitch = pitch;
      utter.rate = rate;
      console.log(`🎤 Utterance settings: pitch=${pitch}, rate=${rate}`);

      const startTime = Date.now();

      // Event handlers
      utter.onstart = () => {
        BUS.dispatchEvent(new CustomEvent('tts:start', { detail: { text, engine: 'browser' } }));

        // Emit analytics event
        window.analytics?.track('tts_start', {
          page: aid(),
          ts: startTime,
          textChars: text.length,
          engine: 'browser',
          source: 'web_speech_api'
        });
      };

      utter.onend = () => {
        BUS.dispatchEvent(new Event('tts:end'));
        stopMeter();

        // Emit analytics event
        window.analytics?.track('tts_stop', {
          page: aid(),
          ts: Date.now(),
          engine: 'browser',
          duration: Date.now() - startTime
        });

        resolve();
      };

      utter.onerror = (e) => {
        BUS.dispatchEvent(new Event('tts:end'));
        stopMeter();

        // Emit analytics event
        window.analytics?.track('tts_error', {
          page: aid(),
          ts: Date.now(),
          engine: 'browser',
          error: e.error || 'unknown'
        });

        reject(e.error || e);
      };

      // Note: Web Speech API doesn't provide audio stream access
      // so we cannot meter the audio for viseme hints
      // The avatar will use fallback animation instead

      // Speak
      speechSynthesis.speak(utter);
    });
  }

  /**
   * Speak text via server-side TTS
   * @param {string} text - Text to speak
   * @param {string} voiceEngine - Voice engine identifier ('standard', 'primo', or legacy)
   * @returns {Promise<void>}
   */
  async function speakViaServer(text, voiceEngine = 'standard') {
    // Prevent multiple simultaneous TTS sessions (atomic check-and-set)
    if (isSpeaking) {
      throw new Error('TTS already in progress');
    }
    isSpeaking = true;

    const startTime = Date.now();

    // Map voice engine to API voice parameter
    let apiVoice = voiceEngine;
    if (VOICE_OPTIONS[voiceEngine]) {
      apiVoice = VOICE_OPTIONS[voiceEngine].apiVoice || voiceEngine;
    } else {
      // Legacy engine - map to standard
      apiVoice = 'alloy';
    }

    return new Promise((resolve, reject) => {
      // Timeout mechanism to prevent hung requests
      const timeoutId = setTimeout(() => {
        isSpeaking = false;
        reject(new Error('Server TTS request timed out'));
      }, SERVER_TTS_TIMEOUT);

      // Main TTS logic
      (async () => {
        try {
          // Emit analytics event for TTS start with engine
          window.analytics?.track('tts_start', {
            page: aid(),
            ts: startTime,
            textChars: text.length,
            engine: voiceEngine,
            apiVoice: apiVoice,
            source: 'server'
          });

          // Call Worker API TTS endpoint
          const apiBase = window.CONFIG?.API_BASE_URL || 'https://api.pmerit.com';
          const res = await fetch(`${apiBase}/api/v1/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text,
              voice: apiVoice  // 'primo' for premium, 'alloy' for standard
            })
          });

          if (!res.ok) {
            // Check if fallback is suggested
            const fallbackHeader = res.headers.get('X-TTS-Fallback');
            if (fallbackHeader === 'required' || res.status === 503) {
              throw new Error('TTS_FALLBACK_REQUIRED');
            }
            throw new Error(`TTS server ${res.status}`);
          }

          // Clear timeout on successful response
          clearTimeout(timeoutId);

          // Get audio blob
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);

          // Log provider info from response headers
          const provider = res.headers.get('X-TTS-Provider') || 'unknown';
          const isPremium = res.headers.get('X-Premium') === 'true';
          const latency = Date.now() - startTime;
          logger.debug('TTS audio received:', {
            latency,
            engine: voiceEngine,
            provider: provider,
            premium: isPremium
          });

          // Wait for audio to finish
          const handlePlay = () => {
            BUS.dispatchEvent(new CustomEvent('tts:start', { detail: { text, engine: voiceEngine } }));
            startMeterFromAudio(audio);
          };

          const handleEnd = () => {
            cleanup();

            // Emit analytics event for TTS end
            window.analytics?.track('tts_stop', {
              page: aid(),
              ts: Date.now(),
              engine: voiceEngine,
              duration: Date.now() - startTime
            });

            resolve();
          };

          const handleError = (error) => {
            cleanup();

            // Emit analytics event for TTS error
            window.analytics?.track('tts_error', {
              page: aid(),
              ts: Date.now(),
              engine: voiceEngine,
              error: error.message || 'playback_error'
            });

            reject(error);
          };

          const cleanup = () => {
            BUS.dispatchEvent(new Event('tts:end'));
            stopMeter();
            URL.revokeObjectURL(url);
            isSpeaking = false;
            clearTimeout(timeoutId);

            // Remove event listeners to prevent memory leaks
            audio.removeEventListener('play', handlePlay);
            audio.removeEventListener('ended', handleEnd);
            audio.removeEventListener('error', handleError);
          };

          audio.addEventListener('play', handlePlay);
          audio.addEventListener('ended', handleEnd);
          audio.addEventListener('error', handleError);

          // Apply speech rate from settings (slower = more teacherly)
          const settings = getSettings();
          audio.playbackRate = settings.speechRate || 0.85;
          console.log(`🎵 TTS playback rate: ${audio.playbackRate}x`);

          // Play audio
          await audio.play();
        } catch (error) {
          clearTimeout(timeoutId);
          isSpeaking = false;
          console.error('Server TTS error:', error);

          // Emit analytics event for TTS error
          window.analytics?.track('tts_error', {
            page: aid(),
            ts: Date.now(),
            engine: voiceEngine,
            error: error.message || 'unknown_error'
          });

          reject(error);
        }
      })();
    });
  }

  /**
   * Public API: Speak text
   * Routes based on VOICE_OPTIONS config:
   * - Free voices (standard-*) → Browser Web Speech API (no server dependency)
   * - Premium voices (primo-*) → Server TTS via RunPod
   * @param {string} text - Text to speak
   * @param {Object} options - Options { voiceName?: string, useServer?: boolean, voiceEngine?: string }
   * @returns {Promise<void>}
   */
  async function speak(text, options = {}) {
    if (!text || typeof text !== 'string') {
      throw new Error('Text is required');
    }

    // Get settings
    const settings = getSettings();

    // Merge options with settings
    const {
      voiceName,
      voiceEngine = settings.voiceEngine
    } = options;

    // Get voice configuration - determines whether to use server or browser
    const voiceConfig = VOICE_OPTIONS[voiceEngine] || VOICE_OPTIONS['standard-male'];

    // ARCHITECTURE FIX (Session 65): Use voiceConfig.useServer instead of settings.useServer
    // This ensures free voices ALWAYS use browser, regardless of user settings
    const shouldUseServer = voiceConfig.useServer === true;

    // Check if browser voice is explicitly selected (either 'browser' or 'browser:VoiceName')
    const isExplicitBrowserVoice = voiceEngine === 'browser' || voiceEngine?.startsWith('browser:');

    // Get voice settings (now returns object with voiceName, pitch, rate)
    let browserVoiceSettings;
    if (voiceEngine?.startsWith('browser:')) {
      browserVoiceSettings = { voiceName: voiceEngine.replace('browser:', ''), pitch: 1.0, rate: 1.0 };
    } else {
      browserVoiceSettings = getBrowserVoiceForPreference(voiceConfig.browserVoice);
    }

    // Emit analytics event for TTS engine selection
    window.analytics?.track('tts_engine', {
      page: aid(),
      ts: Date.now(),
      engine: shouldUseServer ? voiceEngine : 'browser',
      useServer: shouldUseServer,
      voiceTier: voiceConfig.tier
    });

    try {
      if (shouldUseServer && voiceConfig.apiVoice) {
        // Premium voices: Use server-side TTS via RunPod
        console.log(`🎤 Using server TTS for premium voice: ${voiceEngine}`);
        await speakViaServer(text, voiceEngine);
      } else {
        // Free voices: Use Browser Web Speech API (always available)
        console.log(`🎤 Using browser TTS for free voice: ${voiceEngine}, preference: ${voiceConfig.browserVoice}, voice: ${browserVoiceSettings.voiceName || 'default'}, pitch: ${browserVoiceSettings.pitch}, rate: ${browserVoiceSettings.rate}`);
        await speakWebSpeech(text, browserVoiceSettings);
      }
    } catch (error) {
      console.error('TTS error:', error);

      // Fallback to Web Speech if server fails (for premium voices)
      if (shouldUseServer && window.speechSynthesis && error.message === 'TTS_FALLBACK_REQUIRED') {
        console.warn('Server TTS unavailable, falling back to Web Speech API');

        // Show user notification
        BUS.dispatchEvent(new CustomEvent('tts:fallback', {
          detail: {
            message: 'Premium voice server unavailable, using browser speech',
            engine: 'browser'
          }
        }));

        await speakWebSpeech(text, browserVoiceSettings);
      } else {
        throw error;
      }
    }
  }

  /**
   * Get best browser voice based on preference hint
   * Uses cached voices (populated by initVoiceCache)
   * @param {string} preference - 'male', 'female', or 'young'
   * @returns {Object} { voiceName: string|null, pitch: number, rate: number }
   */
  function getBrowserVoiceForPreference(preference) {
    // Default settings - will be adjusted based on preference
    const result = { voiceName: null, pitch: 1.0, rate: 1.0 };

    if (!preference || !window.speechSynthesis) {
      return result;
    }

    // Use cached voices, or try to get them if cache is empty
    let voices = cachedVoices;
    if (!voices.length) {
      voices = speechSynthesis.getVoices();
      if (voices.length) {
        cachedVoices = voices;
        voicesLoaded = true;
      }
    }

    if (!voices.length) {
      console.warn('🎤 No voices available yet - using DRAMATIC pitch/rate differentiation');
      // Even without voices, we can differentiate using pitch - VERY DRAMATIC differences
      if (preference === 'male') {
        result.pitch = 0.6;  // VERY low pitch for male (deep voice)
        result.rate = 0.95;  // Slightly slower (more deliberate)
      } else if (preference === 'female') {
        result.pitch = 1.4;  // HIGH pitch for female (clearly different)
        result.rate = 1.05;  // Slightly faster
      } else if (preference === 'young') {
        result.pitch = 1.6;  // VERY HIGH pitch for young (childlike)
        result.rate = 1.15;  // Faster (energetic)
      }
      console.log(`🎤 No-voice mode: preference='${preference}', pitch=${result.pitch}, rate=${result.rate}`);
      return result;
    }

    // Filter to English voices
    const englishVoices = voices.filter(v => v.lang.startsWith('en'));

    // Log all available voices for debugging
    console.log('🎤 Available English voices:', englishVoices.map(v => v.name));

    if (!englishVoices.length) {
      console.warn('🎤 No English voices found - using DRAMATIC pitch/rate differentiation');
      if (preference === 'male') {
        result.pitch = 0.6;  // VERY low pitch
        result.rate = 0.95;
      } else if (preference === 'female') {
        result.pitch = 1.4;  // HIGH pitch
        result.rate = 1.05;
      } else if (preference === 'young') {
        result.pitch = 1.6;  // VERY HIGH pitch
        result.rate = 1.15;
      }
      console.log(`🎤 No-English-voices mode: preference='${preference}', pitch=${result.pitch}, rate=${result.rate}`);
      return result;
    }

    // Find best match based on preference
    let targetVoice = null;

    if (preference === 'male') {
      // Look for male voices - expanded pattern matching
      // Windows: Microsoft David, Microsoft Mark, Microsoft Guy
      // macOS: Daniel, Alex | Chrome: Google US English Male
      targetVoice = englishVoices.find(v =>
        /\b(guy|david|james|mark|daniel|george|alex|ryan|christopher|richard|william|michael|john|paul|andrew)\b|male/i.test(v.name)
      );
      // Secondary: find any voice that's NOT clearly female
      if (!targetVoice) {
        targetVoice = englishVoices.find(v =>
          !/\b(jenny|zira|samantha|karen|susan|hazel|fiona|moira|tessa|victoria|allison|siri|catherine|emily|emma|sarah|lisa|nicole|linda|jenny|natasha|ava|joanna)\b|female|woman/i.test(v.name)
        );
      }
      // Apply DRAMATIC pitch adjustment even if voice found
      result.pitch = 0.7;   // Low pitch for male
      result.rate = 0.95;
    } else if (preference === 'female') {
      // Look for female voices - expanded pattern matching
      // Windows: Microsoft Zira, Microsoft Jenny
      // macOS: Samantha, Karen | Chrome: Google US English Female
      targetVoice = englishVoices.find(v =>
        /\b(jenny|zira|samantha|karen|susan|hazel|fiona|moira|tessa|victoria|allison|siri|catherine|emily|emma|sarah|lisa|nicole|linda|natasha|ava|joanna|amy|ivy|kendra|kimberly|sally|olivia)\b|female|woman/i.test(v.name)
      );
      // Secondary: find any voice that's NOT clearly male
      if (!targetVoice) {
        targetVoice = englishVoices.find(v =>
          !/\b(guy|david|james|mark|daniel|george|alex|ryan|christopher|richard|william|michael|john|paul|andrew)\b|male|\bman\b/i.test(v.name)
        );
      }
      result.pitch = 1.3;  // High pitch for female
      result.rate = 1.05;
    } else if (preference === 'young') {
      // Look for younger/friendly voices
      targetVoice = englishVoices.find(v =>
        /\b(ana|amy|aria|ivy|young|junior|child|kid)\b/i.test(v.name)
      );
      // Fallback: use a female voice with higher pitch (sounds younger)
      if (!targetVoice) {
        targetVoice = englishVoices.find(v =>
          /\b(jenny|zira|samantha|karen|amy|ivy|ava|joanna)\b|female/i.test(v.name)
        );
      }
      // If still no voice, use first English voice
      if (!targetVoice && englishVoices.length > 0) {
        targetVoice = englishVoices[0];
      }
      result.pitch = 1.5;  // VERY high pitch for young (childlike)
      result.rate = 1.15;  // Faster (energetic)
    }

    // If we couldn't find distinct voices, ensure we DRAMATICALLY differentiate with pitch
    if (!targetVoice && englishVoices.length > 0) {
      // Just use the first voice but differentiate with EXTREME pitch
      targetVoice = englishVoices[0];
      if (preference === 'male') {
        result.pitch = 0.6;   // VERY LOW pitch (deep voice)
        result.rate = 0.95;
      } else if (preference === 'female') {
        result.pitch = 1.4;   // HIGH pitch
        result.rate = 1.05;
      } else if (preference === 'young') {
        result.pitch = 1.6;   // VERY HIGH pitch (childlike)
        result.rate = 1.15;
      }
    }

    result.voiceName = targetVoice ? targetVoice.name : null;

    if (result.voiceName) {
      console.log(`🎤 Selected voice for '${preference}': ${result.voiceName} (pitch: ${result.pitch}, rate: ${result.rate})`);
    } else {
      console.log(`🎤 No voice found for '${preference}', using pitch=${result.pitch}, rate=${result.rate}`);
    }

    return result;
  }

  /**
   * Set voice engine preference
   * @param {string} engine - Engine identifier (e.g., 'standard-male', 'primo', 'browser')
   */
  function setVoiceEngine(engine) {
    const settings = getSettings();
    settings.voiceEngine = engine;

    // ARCHITECTURE FIX (Session 65): useServer is determined by VOICE_OPTIONS
    // Free voices (standard-*) always use browser, premium (primo-*) use server
    const voiceConfig = VOICE_OPTIONS[engine] || VOICE_OPTIONS['standard-male'];
    settings.useServer = voiceConfig.useServer === true;

    saveSettings(settings);

    // Emit analytics event
    window.analytics?.track('tts_engine_change', {
      page: aid(),
      ts: Date.now(),
      engine: engine
    });
  }

  /**
   * Get current voice engine preference
   * @returns {string} Current engine identifier
   */
  function getVoiceEngine() {
    const settings = getSettings();
    return settings.voiceEngine;
  }

  /**
   * Get available voice engines
   * @returns {Object} Available engines mapping
   */
  function getAvailableEngines() {
    return { ...AVAILABLE_ENGINES };
  }

  /**
   * Stop current speech
   */
  function stop() {
    if (window.speechSynthesis) {
      speechSynthesis.cancel();
    }
    stopMeter();
    BUS.dispatchEvent(new Event('tts:end'));
  }

  /**
   * Check if TTS is available
   * @returns {boolean}
   */
  function isAvailable() {
    return !!(window.speechSynthesis || window.SpeechSynthesisUtterance);
  }

  /**
   * Get available voices
   * @returns {Array<SpeechSynthesisVoice>}
   */
  function getVoices() {
    if (!window.speechSynthesis) {
      return [];
    }
    return speechSynthesis.getVoices();
  }

  /**
   * Get available voice options with details
   * @returns {Object} Voice options mapping
   */
  function getVoiceOptions() {
    return { ...VOICE_OPTIONS };
  }

  /**
   * Set speech rate (playback speed)
   * @param {number} rate - Speech rate (0.5 = half speed, 1.0 = normal, 1.5 = 1.5x speed)
   */
  function setSpeechRate(rate) {
    const settings = getSettings();
    settings.speechRate = Math.max(0.5, Math.min(1.5, rate));
    saveSettings(settings);
    console.log(`🎵 Speech rate set to: ${settings.speechRate}x`);
  }

  /**
   * Get current speech rate
   * @returns {number} Current speech rate
   */
  function getSpeechRate() {
    const settings = getSettings();
    return settings.speechRate || 0.85;
  }

  /**
   * Set speech pitch
   * @param {number} pitch - Speech pitch (0.5 = lower, 1.0 = normal, 1.5 = higher)
   */
  function setSpeechPitch(pitch) {
    const settings = getSettings();
    settings.speechPitch = Math.max(0.5, Math.min(1.5, pitch));
    saveSettings(settings);
    console.log(`🎵 Speech pitch set to: ${settings.speechPitch}`);
  }

  /**
   * Get current speech pitch
   * @returns {number} Current speech pitch
   */
  function getSpeechPitch() {
    const settings = getSettings();
    return settings.speechPitch || 1.0;
  }

  // Export public API
  window.TTS = {
    speak,
    stop,
    isAvailable,
    getVoices,
    setVoiceEngine,
    getVoiceEngine,
    setSpeechRate,
    getSpeechRate,
    setSpeechPitch,
    getSpeechPitch,
    getAvailableEngines,
    getVoiceOptions,
    getSettings,
    // Event names for convenience
    events: {
      START: 'tts:start',
      END: 'tts:end',
      VISEME: 'tts:viseme',
      FALLBACK: 'tts:fallback'
    },
    // Voice tier constants
    TIERS: {
      FREE: 'free',
      PREMIUM: 'premium'
    }
  };

  // Set up analytics tracking for TTS events
  BUS.addEventListener('tts:start', (e) => {
    // Get text from detail if available, otherwise we'll track without text length
    const textChars = e.detail?.text?.length || 0;
    const engine = e.detail?.engine || 'unknown';
    window.analytics?.track('tts_start', {
      page: aid(),
      ts: Date.now(),
      textChars: textChars,
      engine: engine
    });
  });

  BUS.addEventListener('tts:end', () => {
    window.analytics?.track('tts_stop', {
      page: aid(),
      ts: Date.now()
    });
  });

  BUS.addEventListener('tts:fallback', (e) => {
    window.analytics?.track('tts_fallback', {
      page: aid(),
      ts: Date.now(),
      message: e.detail?.message,
      engine: e.detail?.engine
    });
  });

  // Initialize voice cache on module load
  // This ensures voices are ready when speak() is called
  initVoiceCache();

  logger.debug('✅ TTS module loaded');

})(window);
