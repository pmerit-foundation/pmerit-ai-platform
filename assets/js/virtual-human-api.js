/**
 * Virtual Human API Client
 * Phase 3.3: Virtual Human Integration
 *
 * Provides interface for TTS, avatar management, and Virtual Human
 * integration with Cloudflare Workers backend.
 *
 * @module virtual-human-api
 * @requires AudioPlayer.js (from /assets/js/avatar/)
 */

(function (window) {
  'use strict';

  /**
   * VirtualHumanAPI class
   */
  class VirtualHumanAPI {
    /**
     * @constructor
     * @param {Object} config - Configuration options
     */
    constructor(config = {}) {
      this.config = {
        apiBase: config.apiBase || 'https://api.pmerit.com',
        ttsEndpoint: config.ttsEndpoint || '/api/v1/tts',
        defaultVoice: config.defaultVoice || 'alloy',
        cacheEnabled: config.cacheEnabled !== false,
        maxCacheSize: config.maxCacheSize || 50,
        retryAttempts: config.retryAttempts || 3,
        retryDelay: config.retryDelay || 1000
      };

      // State
      this.audioCache = new Map();
      this.isPlaying = false;
      this.currentAudio = null;
      this.audioQueue = [];

      // Event listeners
      this.eventListeners = {
        start: [],
        progress: [],
        complete: [],
        error: []
      };

      // Initialize audio context
      this.initAudioContext();
    }

    /**
     * Initialize Web Audio API context
     */
    initAudioContext() {
      try {
        window.AudioContext = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioContext();
      } catch (error) {
        console.warn('Web Audio API not supported:', error);
      }
    }

    /**
     * Generate speech from text
     * @param {string} text - Text to convert to speech
     * @param {Object} options - TTS options
     * @returns {Promise<Object>} Audio data with visemes
     */
    async speak(text, options = {}) {
      try {
        // Check cache first
        const cacheKey = this.getCacheKey(text, options);
        if (this.config.cacheEnabled && this.audioCache.has(cacheKey)) {
          // Using cached TTS response
          return this.audioCache.get(cacheKey);
        }

        // Emit start event
        this.emit('start', { text });

        // Call TTS API
        const response = await this.callTTSAPI(text, options);

        // Cache response
        if (this.config.cacheEnabled) {
          this.cacheAudioResponse(cacheKey, response);
        }

        // Emit complete event
        this.emit('complete', { text, audio: response });

        return response;

      } catch (error) {
        console.error('TTS generation failed:', error);
        this.emit('error', { text, error });
        throw error;
      }
    }

    /**
     * Call TTS API with retry logic
     * @param {string} text - Text to convert
     * @param {Object} options - TTS options
     * @returns {Promise<Object>} Audio response
     */
    async callTTSAPI(text, options = {}) {
      const url = `${this.config.apiBase}${this.config.ttsEndpoint}`;
      const voice = options.voice || this.config.defaultVoice;

      let lastError;
      for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
        try {
          // Get current language for voice selection
          const userLanguage = localStorage.getItem('pmerit_language') || 'en';

          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-User-Language': userLanguage  // For voice mapping on backend
            },
            body: JSON.stringify({
              text: text,
              voice: voice,
              language: userLanguage,  // Explicit language for TTS
              return_visemes: true
            })
          });

          if (!response.ok) {
            throw new Error(`TTS API error: ${response.status}`);
          }

          const data = await response.json();

          return {
            audioUrl: data.audio_url,
            audioData: data.audio_data, // Base64 encoded audio
            visemes: data.visemes || [],
            duration: data.duration || 0,
            text: text,
            voice: voice
          };

        } catch (error) {
          lastError = error;
          console.warn(`TTS attempt ${attempt} failed:`, error);

          if (attempt < this.config.retryAttempts) {
            await this.sleep(this.config.retryDelay * attempt);
          }
        }
      }

      throw lastError;
    }

    /**
     * Play audio with avatar lip-sync
     * @param {Object} audioData - Audio data from speak()
     * @returns {Promise<void>}
     */
    async play(audioData) {
      if (this.isPlaying) {
        // Add to queue
        this.audioQueue.push(audioData);
        return;
      }

      this.isPlaying = true;
      this.currentAudio = audioData;

      try {
        // Create audio element
        const audio = new Audio();

        if (audioData.audioUrl) {
          audio.src = audioData.audioUrl;
        } else if (audioData.audioData) {
          // Convert base64 to blob URL
          audio.src = this.base64ToAudioURL(audioData.audioData);
        }

        // Start playback
        await audio.play();

        // Trigger lip-sync via custom event
        window.dispatchEvent(new CustomEvent('vh:lipsync', {
          detail: {
            visemes: audioData.visemes,
            duration: audioData.duration
          }
        }));

        // Wait for audio to finish
        await new Promise((resolve) => {
          audio.onended = resolve;
        });

      } catch (error) {
        console.error('Audio playback failed:', error);
        throw error;
      } finally {
        this.isPlaying = false;
        this.currentAudio = null;

        // Play next in queue
        if (this.audioQueue.length > 0) {
          const next = this.audioQueue.shift();
          await this.play(next);
        }
      }
    }

    /**
     * Speak and play in one call
     * @param {string} text - Text to speak
     * @param {Object} options - Options
     * @returns {Promise<void>}
     */
    async speakAndPlay(text, options = {}) {
      const audioData = await this.speak(text, options);
      await this.play(audioData);
    }

    /**
     * Stop current playback
     */
    stop() {
      if (this.currentAudio) {
        // Stop audio
        // Clear queue
        this.audioQueue = [];
        this.isPlaying = false;

        // Emit stop event
        window.dispatchEvent(new CustomEvent('vh:stop'));
      }
    }

    /**
     * Get available TTS voices
     * @returns {Promise<Array>} List of available voices
     */
    async getVoices() {
      try {
        const response = await fetch(`${this.config.apiBase}/api/v1/tts/voices`);
        const data = await response.json();
        return data.voices || ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
      } catch (error) {
        console.warn('Failed to fetch voices:', error);
        // Return default voices
        return ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
      }
    }

    /**
     * Get available avatars
     * @returns {Promise<Array>} List of avatar configurations
     */
    async getAvatars() {
      try {
        const response = await fetch(`${this.config.apiBase}/api/v1/virtual-human/avatars`);
        const data = await response.json();
        return data.avatars || this.getDefaultAvatars();
      } catch (error) {
        console.warn('Failed to fetch avatars:', error);
        return this.getDefaultAvatars();
      }
    }

    /**
     * Get default avatar list (fallback when API unavailable)
     * These IDs must match the backend API response
     * @returns {Array} Default avatars
     */
    getDefaultAvatars() {
      return [
        {
          id: 'ty_child',
          name: 'Ty - Young Learner Guide',
          model: 'ty_character.glb',
          model_url: '/assets/avatars/ty_character.glb',
          thumbnail: '/assets/avatars/ty_thumb.jpg',
          description: 'Child-friendly educational guide for young learners',
          available: true
        },
        {
          id: 'humano_professional',
          name: 'Professional Guide - Adult',
          model: 'humano_professional.glb',
          model_url: '/assets/avatars/humano_professional.glb',
          thumbnail: '/assets/avatars/humano_thumb.jpg',
          description: 'Professional adult educational guide',
          available: true
        },
        {
          id: 'pm_classic',
          name: 'PMERIT Classic',
          model: 'pm_classic.glb',
          model_url: '/assets/avatars/pm_classic.glb',
          thumbnail: '/assets/avatars/pm_classic_thumb.jpg',
          description: 'Classic PMERIT avatar',
          available: true
        }
      ];
    }

    /**
     * Save avatar preference
     * @param {string} avatarId - Avatar ID to set as preferred
     * @returns {Promise<void>}
     */
    async setPreferredAvatar(avatarId) {
      try {
        // Save to localStorage
        localStorage.setItem('pmerit_preferred_avatar', avatarId);

        // Save to backend if authenticated
        const token = localStorage.getItem('pmerit_auth_token');
        if (token) {
          await fetch(`${this.config.apiBase}/api/v1/virtual-human/preferences`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              avatar_id: avatarId
            })
          });
        }
      } catch (error) {
        console.error('Failed to save avatar preference:', error);
      }
    }

    /**
     * Get preferred avatar
     * @returns {string} Avatar ID
     */
    getPreferredAvatar() {
      // Default to 'ty_child' (matches backend API response)
      // Previously was 'ty_character' which caused "not found" errors
      return localStorage.getItem('pmerit_preferred_avatar') || 'ty_child';
    }

    /**
     * Convert base64 audio to blob URL
     * @param {string} base64 - Base64 encoded audio
     * @returns {string} Blob URL
     */
    base64ToAudioURL(base64) {
      const byteCharacters = atob(base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'audio/mp3' });
      return URL.createObjectURL(blob);
    }

    /**
     * Generate cache key
     * @param {string} text - Text
     * @param {Object} options - Options
     * @returns {string} Cache key
     */
    getCacheKey(text, options) {
      const voice = options.voice || this.config.defaultVoice;
      return `${voice}:${text}`;
    }

    /**
     * Cache audio response
     * @param {string} key - Cache key
     * @param {Object} data - Audio data
     */
    cacheAudioResponse(key, data) {
      // Enforce max cache size
      if (this.audioCache.size >= this.config.maxCacheSize) {
        // Remove oldest entry (first key)
        const firstKey = this.audioCache.keys().next().value;
        this.audioCache.delete(firstKey);
      }

      this.audioCache.set(key, data);
    }

    /**
     * Clear audio cache
     */
    clearCache() {
      this.audioCache.clear();
    }

    /**
     * Add event listener
     * @param {string} event - Event name (start, progress, complete, error)
     * @param {Function} callback - Callback function
     */
    on(event, callback) {
      if (this.eventListeners[event]) {
        this.eventListeners[event].push(callback);
      }
    }

    /**
     * Remove event listener
     * @param {string} event - Event name
     * @param {Function} callback - Callback to remove
     */
    off(event, callback) {
      if (this.eventListeners[event]) {
        this.eventListeners[event] = this.eventListeners[event].filter(
          cb => cb !== callback
        );
      }
    }

    /**
     * Emit event
     * @param {string} event - Event name
     * @param {Object} data - Event data
     */
    emit(event, data) {
      if (this.eventListeners[event]) {
        this.eventListeners[event].forEach(callback => {
          try {
            callback(data);
          } catch (error) {
            console.error(`Event listener error (${event}):`, error);
          }
        });
      }
    }

    /**
     * Sleep utility
     * @param {number} ms - Milliseconds to sleep
     * @returns {Promise<void>}
     */
    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get current status
     * @returns {Object} Status object
     */
    getStatus() {
      return {
        isPlaying: this.isPlaying,
        queueLength: this.audioQueue.length,
        cacheSize: this.audioCache.size,
        currentText: this.currentAudio?.text || null
      };
    }
  }

  // Export to window
  window.VirtualHumanAPI = VirtualHumanAPI;

  // Create default instance
  window.virtualHumanAPI = new VirtualHumanAPI();

  // Log successful loading in development
  if (window.CONFIG && window.CONFIG.ENV === 'development') {
    logger.debug('✅ VirtualHumanAPI module loaded');
  }

})(window);
