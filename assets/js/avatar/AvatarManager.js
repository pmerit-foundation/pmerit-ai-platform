/**
 * PMERIT Avatar Manager
 * Phase 3.3-A: Coordinates avatar state, speech, and visuals
 * 
 * This module manages the avatar lifecycle and coordinates between
 * the WebGL provider, audio playback, and lip-sync systems.
 */

(function (window) {
  'use strict';

  // Constants
  const MAX_LIPSYNC_DURATION = 5 * 60 * 1000; // 5 minutes maximum

  class AvatarManager {
    constructor(config = {}) {
      this.config = {
        canvasId: config.canvasId || 'vh-canvas',
        captionsId: config.captionsId || 'vh-captions',
        enabled: config.enabled !== undefined ? config.enabled : true,
        apiBaseUrl: config.apiBaseUrl || '/api',
        modelFile: config.modelFile || 'humano_professional.glb',
        avatarBaseUrl: config.avatarBaseUrl || '/assets/models/avatars/',
        ...config
      };

      this.state = {
        initialized: false,
        speaking: false,
        currentAudio: null,
        provider: null,
        lipSync: null,
        animationFrameId: null
      };

      this.callbacks = {
        onSpeakStart: config.onSpeakStart || null,
        onSpeakEnd: config.onSpeakEnd || null,
        onError: config.onError || null
      };
      
      // Bound event handlers for cleanup
      this.boundTTSStartHandler = null;
      this.boundTTSEndHandler = null;
    }

    /**
     * Initialize the avatar system
     * @returns {Promise<void>}
     */
    async init() {
      if (this.state.initialized) {
        console.warn('AvatarManager already initialized');
        return;
      }

      try {
        console.log('🎭 Initializing AvatarManager...');

        // Initialize WebGL provider if enabled
        if (this.config.enabled) {
          const canvas = document.getElementById(this.config.canvasId);
          if (canvas) {
            // Lazy load WebGLProvider
            if (window.WebGLProvider) {
              try {
                this.state.provider = new window.WebGLProvider(canvas, this.config);
                await this.state.provider.init();
              } catch (providerError) {
                // WebGL failed - continue without visual avatar
                console.warn('WebGLProvider init failed, using audio-only mode:', providerError.message);
                this.state.provider = null;
              }
            } else {
              console.warn('WebGLProvider not available, running in audio-only mode');
            }
          }
        }

        this.state.initialized = true;

        // Set up TTS event listeners if TTS module is available
        this._setupTTSListeners();

        console.log('✅ AvatarManager initialized (audio-only mode:', !this.state.provider, ')');
      } catch (error) {
        // Even on error, mark as initialized to prevent repeated attempts
        this.state.initialized = true;
        console.warn('⚠️ AvatarManager init warning:', error.message);
        // Don't call onError for non-critical initialization issues
        // The avatar will simply work in audio-only/fallback mode
      }
    }

    /**
     * Speak text with avatar animation and audio
     * @param {string} text - Text to speak
     * @param {Object} options - Speech options
     * @returns {Promise<void>}
     */
    async speak(text, options = {}) {
      if (!text || this.state.speaking) {
        console.warn('Cannot speak: no text or already speaking');
        return;
      }

      try {
        this.state.speaking = true;
        
        if (this.callbacks.onSpeakStart) {
          this.callbacks.onSpeakStart(text);
        }

        // Show captions
        this._showCaption(text);

        // Get TTS audio and visemes
        const audioData = await this._getTTS(text, options);

        // Start avatar animation if provider available
        if (this.state.provider && this.config.enabled) {
          this.state.provider.startSpeaking();
        }

        // Play audio with lip-sync
        if (audioData.audioUrl) {
          await this._playAudioWithSync(audioData.audioUrl, audioData.visemes || []);
        }

        // Stop avatar animation
        if (this.state.provider && this.config.enabled) {
          this.state.provider.stopSpeaking();
        }

      } catch (error) {
        console.error('❌ Speak error:', error);
        if (this.callbacks.onError) {
          this.callbacks.onError(error);
        }
      } finally {
        this.state.speaking = false;
        this._hideCaption();
        
        if (this.callbacks.onSpeakEnd) {
          this.callbacks.onSpeakEnd();
        }
      }
    }

    /**
     * Stop current speech
     */
    stop() {
      if (this.state.currentAudio) {
        this.state.currentAudio.pause();
        this.state.currentAudio = null;
      }

      if (this.state.provider && this.config.enabled) {
        this.state.provider.stopSpeaking();
      }

      this.state.speaking = false;
      this._hideCaption();
    }

    /**
     * Toggle avatar enabled/disabled
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
      this.config.enabled = enabled;
      
      if (!enabled && this.state.provider) {
        this.state.provider.pause();
      } else if (enabled && this.state.provider) {
        this.state.provider.resume();
      }

      // Save preference
      localStorage.setItem('pmerit_vh_enabled', enabled);
    }

    /**
     * Check if avatar is enabled
     * @returns {boolean}
     */
    isEnabled() {
      return this.config.enabled;
    }

    /**
     * Get TTS audio and viseme data from API
     * @private
     */
    async _getTTS(text, options = {}) {
      // Always use the full Worker API URL for TTS
      const apiBase = window.CONFIG?.API_BASE_URL || 'https://api.pmerit.com';
      const ttsUrl = `${apiBase}/api/v1/tts`;

      try {
        const response = await fetch(ttsUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text,
            voice: options.voice || 'default',
            speed: options.speed || 1.0
          })
        });

        if (!response.ok) {
          // TTS not available - return empty result for graceful degradation
          console.warn(`TTS API returned ${response.status}, using silent mode`);
          return { audioUrl: null, visemes: [] };
        }

        return await response.json();
      } catch (error) {
        // Network error - gracefully degrade
        console.warn('TTS API unavailable:', error.message);
        return { audioUrl: null, visemes: [] };
      }
    }

    /**
     * Play audio with synchronized lip-sync
     * @private
     */
    async _playAudioWithSync(audioUrl, visemes) {
      return new Promise((resolve, reject) => {
        const audio = new Audio(audioUrl);
        this.state.currentAudio = audio;

        // Set up lip-sync if available
        if (this.state.provider && window.LipSyncVisemes && visemes.length > 0) {
          const lipSync = new window.LipSyncVisemes(this.state.provider, visemes);
          
          audio.addEventListener('timeupdate', () => {
            lipSync.update(audio.currentTime * 1000); // Convert to ms
          });
        }

        audio.addEventListener('ended', () => {
          this.state.currentAudio = null;
          resolve();
        });

        audio.addEventListener('error', (error) => {
          this.state.currentAudio = null;
          reject(error);
        });

        // Handle autoplay blocking
        audio.play().catch(error => {
          console.warn('Audio autoplay blocked:', error);
          // User interaction required - this is expected behavior
          // The error is logged but not thrown to avoid breaking the flow
        });
      });
    }

    /**
     * Show caption text
     * @private
     */
    _showCaption(text) {
      const captionsEl = document.getElementById(this.config.captionsId);
      if (captionsEl) {
        captionsEl.textContent = text;
        captionsEl.style.display = 'block';
      }
    }

    /**
     * Hide caption text
     * @private
     */
    _hideCaption() {
      const captionsEl = document.getElementById(this.config.captionsId);
      if (captionsEl) {
        captionsEl.textContent = '';
        captionsEl.style.display = 'none';
      }
    }

    /**
     * Set up TTS event listeners
     * @private
     */
    _setupTTSListeners() {
      if (!window.TTS) {
        return;
      }

      // Create bound handlers for cleanup
      this.boundTTSStartHandler = () => {
        if (this.state.provider && this.config.enabled) {
          this.state.provider.startSpeaking();
          
          // Create lip sync with intensity mode for TTS-driven animation
          if (window.LipSyncVisemes) {
            this.state.lipSync = new window.LipSyncVisemes(this.state.provider, []);
            this.state.lipSync.startIntensityMode();
            
            // Cancel any existing animation loop
            if (this.state.animationFrameId) {
              cancelAnimationFrame(this.state.animationFrameId);
              this.state.animationFrameId = null;
            }
            
            // Update lip sync in animation loop with proper timing
            // Safety: Loop will stop when intensityMode is false or after MAX_LIPSYNC_DURATION
            const startTime = Date.now();
            
            const updateLipSync = (timestamp) => {
              if (this.state.lipSync && this.state.lipSync.intensityMode) {
                // Safety check: stop after maximum duration
                if (Date.now() - startTime > MAX_LIPSYNC_DURATION) {
                  console.warn('Lip sync animation exceeded maximum duration, stopping');
                  this.state.lipSync.stopIntensityMode();
                  this.state.animationFrameId = null;
                  return;
                }
                
                this.state.lipSync.update(timestamp);
                this.state.animationFrameId = requestAnimationFrame(updateLipSync);
              } else {
                this.state.animationFrameId = null;
              }
            };
            this.state.animationFrameId = requestAnimationFrame(updateLipSync);
          }
        }
      };

      this.boundTTSEndHandler = () => {
        // Cancel animation frame if running
        if (this.state.animationFrameId) {
          cancelAnimationFrame(this.state.animationFrameId);
          this.state.animationFrameId = null;
        }
        
        if (this.state.lipSync) {
          this.state.lipSync.stopIntensityMode();
          this.state.lipSync.reset();
          this.state.lipSync = null;
        }
        
        if (this.state.provider && this.config.enabled) {
          this.state.provider.stopSpeaking();
        }
      };

      // Listen for TTS events
      document.addEventListener('tts:start', this.boundTTSStartHandler);
      document.addEventListener('tts:end', this.boundTTSEndHandler);
    }

    /**
     * Clean up resources
     */
    dispose() {
      this.stop();
      
      // Remove TTS event listeners
      if (this.boundTTSStartHandler) {
        document.removeEventListener('tts:start', this.boundTTSStartHandler);
        this.boundTTSStartHandler = null;
      }
      if (this.boundTTSEndHandler) {
        document.removeEventListener('tts:end', this.boundTTSEndHandler);
        this.boundTTSEndHandler = null;
      }
      
      // Cancel any running animation frame
      if (this.state.animationFrameId) {
        cancelAnimationFrame(this.state.animationFrameId);
        this.state.animationFrameId = null;
      }
      
      // Clean up lip sync
      if (this.state.lipSync) {
        this.state.lipSync.stopIntensityMode();
        this.state.lipSync = null;
      }
      
      if (this.state.provider) {
        this.state.provider.dispose();
        this.state.provider = null;
      }

      this.state.initialized = false;
    }
  }

  // Export to global scope
  window.AvatarManager = AvatarManager;

})(window);
