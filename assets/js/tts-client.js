/**
 * PMERIT TTS Client
 * Handles text-to-speech generation using Cloudflare Workers AI with browser fallback
 * Features: API integration, quota management, voice selection, audio caching
 */

class TTSClient {
  constructor() {
    // API configuration
    this.apiUrl = 'https://api.pmerit.com/api/v1/tts';
    this.quotaUrl = 'https://api.pmerit.com/api/v1/tts/quota';
    
    // Audio cache (prevent duplicate API calls)
    this.cache = new Map();
    
    // Voice preference (persisted to localStorage)
    // Migrate legacy voices to new default
    let savedVoice = localStorage.getItem('tts_voice');
    const legacyVoices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
    if (!savedVoice || legacyVoices.includes(savedVoice)) {
      savedVoice = 'standard-male';
      localStorage.setItem('tts_voice', savedVoice);
    }
    this.currentVoice = savedVoice;
    
    // Fallback mode tracking
    this.fallbackMode = false;
    
    // Current audio player
    this.currentAudio = null;
    
    // Quota info
    this.quotaRemaining = null;
    this.quotaLimit = 10000; // Daily limit
    
    logger.debug('[TTS Client] Initialized with voice:', this.currentVoice);
  }

  /**
   * Main speak method - tries API first, falls back to browser
   * @param {string} text - Text to convert to speech
   * @returns {Promise<void>}
   */
  async speak(text) {
    if (!text || text.trim().length === 0) {
      console.warn('[TTS Client] Empty text provided, skipping TTS');
      return;
    }

    try {
      // Try Cloudflare Workers AI API first
      await this.speakCloudflare(text);
    } catch (error) {
      console.warn('[TTS Client] API TTS failed, using browser fallback:', error.message);
      
      // Fall back to browser Web Speech API
      try {
        await this.speakBrowser(text);
      } catch (browserError) {
        console.error('[TTS Client] Browser TTS also failed:', browserError);
        // Silently fail - don't break the user experience
      }
    }
  }

  /**
   * Preprocess text for natural TTS pronunciation
   * @param {string} text - Raw text to preprocess
   * @returns {string} - Cleaned text ready for TTS
   */
  preprocessText(text) {
    let processed = text;

    // Replace brand names with phonetic pronunciations
    processed = processed.replace(/\bPmerit\b/gi, 'Merit');
    processed = processed.replace(/\bPMERIT\b/g, 'Merit');
    
    // Strip markdown formatting
    // Remove bold/italic markers
    processed = processed.replace(/\*\*\*(.+?)\*\*\*/g, '$1'); // Bold+italic
    processed = processed.replace(/\*\*(.+?)\*\*/g, '$1');     // Bold
    processed = processed.replace(/\*(.+?)\*/g, '$1');         // Italic
    processed = processed.replace(/__(.+?)__/g, '$1');         // Underline
    
    // Convert markdown bullets to natural pauses
    processed = processed.replace(/^\s*[\*\-\+]\s+/gm, '');    // Remove bullet markers
    processed = processed.replace(/^\s*\d+\.\s+/gm, '');       // Remove numbered lists
    
    // Remove markdown headers
    processed = processed.replace(/^#+\s+/gm, '');
    
    // Convert links to just the text
    processed = processed.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
    
    // Remove code blocks and inline code
    processed = processed.replace(/```[\s\S]*?```/g, '');
    processed = processed.replace(/`([^`]+)`/g, '$1');
    
    // Clean up special characters
    processed = processed.replace(/[#\*_~`]/g, '');
    
    // Convert multiple spaces/newlines to single space
    processed = processed.replace(/\s+/g, ' ');
    
    // Add natural pauses at sentence endings
    processed = processed.replace(/\.\s+/g, '. ');
    processed = processed.replace(/\?\s+/g, '? ');
    processed = processed.replace(/!\s+/g, '! ');
    
    // Trim whitespace
    processed = processed.trim();
    
    return processed;
  }

  /**
   * Cloudflare Workers AI TTS implementation
   * @param {string} text - Text to convert to speech
   * @returns {Promise<void>}
   */
  async speakCloudflare(text) {
    // Preprocess text for natural pronunciation
    const processedText = this.preprocessText(text);
    
    logger.debug('[TTS Client] Original:', text);
    logger.debug('[TTS Client] Processed:', processedText);
    
    // Check cache first (using processed text)
    const cacheKey = `${processedText}_${this.currentVoice}`;
    
    if (this.cache.has(cacheKey)) {
      logger.debug('[TTS Client] Using cached audio');
      const audioUrl = this.cache.get(cacheKey);
      await this.playAudio(audioUrl);
      return;
    }

    logger.debug('[TTS Client] Requesting TTS from API...');

    // Make API request with processed text
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: processedText,
        voice: this.currentVoice
      })
    });

    // Handle quota exceeded
    if (response.status === 429) {
      console.warn('[TTS Client] Quota exceeded (429)');
      this.fallbackMode = true;
      throw new Error('Quota exceeded');
    }

    // Handle other errors
    if (!response.ok) {
      console.error('[TTS Client] API error:', response.status);
      throw new Error(`API error: ${response.status}`);
    }

    // Check content type
    const contentType = response.headers.get('content-type');
    
    if (contentType && contentType.includes('application/json')) {
      // Error response from backend
      const errorData = await response.json();
      console.warn('[TTS Client] Backend error:', errorData);
      
      if (errorData.fallbackRequired) {
        throw new Error('Fallback required by backend');
      }
      
      throw new Error(errorData.error || 'Unknown error');
    }

    // Success - audio response
    logger.debug('[TTS Client] Audio received from API');
    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    
    // Cache the audio URL
    this.cache.set(cacheKey, audioUrl);
    
    // Play the audio
    await this.playAudio(audioUrl);
    
    // Update quota info if provided
    if (response.headers.get('x-quota-remaining')) {
      this.quotaRemaining = parseInt(response.headers.get('x-quota-remaining'));
      logger.debug('[TTS Client] Quota remaining:', this.quotaRemaining);
    }
  }

  /**
   * Browser Web Speech API fallback
   * @param {string} text - Text to convert to speech
   * @returns {Promise<void>}
   */
  speakBrowser(text) {
    return new Promise((resolve, reject) => {
      // Check browser support
      if (!('speechSynthesis' in window)) {
        reject(new Error('Browser does not support speech synthesis'));
        return;
      }

      // Preprocess text for natural pronunciation
      const processedText = this.preprocessText(text);

      logger.debug('[TTS Client] Using browser speech synthesis');
      logger.debug('[TTS Client] Browser TTS text:', processedText);

      // Stop any ongoing speech
      window.speechSynthesis.cancel();

      // Create utterance with processed text
      const utterance = new SpeechSynthesisUtterance(processedText);
      
      // Set voice
      utterance.voice = this.getBrowserVoice();
      
      // Configure utterance
      utterance.rate = 1.0;  // Normal speed
      utterance.pitch = 1.0; // Normal pitch
      utterance.volume = 1.0; // Full volume
      
      // Event handlers
      utterance.onend = () => {
        logger.debug('[TTS Client] Browser speech completed');
        resolve();
      };
      
      utterance.onerror = (event) => {
        console.error('[TTS Client] Browser speech error:', event.error);
        reject(new Error(`Speech synthesis error: ${event.error}`));
      };
      
      // Speak
      window.speechSynthesis.speak(utterance);
    });
  }

  /**
   * Get appropriate browser voice based on selected TTS voice
   * @returns {SpeechSynthesisVoice|null}
   */
  getBrowserVoice() {
    const voices = window.speechSynthesis.getVoices();
    
    if (voices.length === 0) {
      console.warn('[TTS Client] No browser voices available');
      return null;
    }

    // Map TTS voice names to browser voice preferences
    const voiceMap = {
      // New voices
      'standard-male': ['Google US English', 'Microsoft David', 'Alex'],
      'standard-female': ['Google US English Female', 'Microsoft Zira', 'Samantha'],
      'standard-young': ['Google US English Female', 'Microsoft Zira', 'Samantha'],
      'primo': ['Google US English', 'Microsoft David', 'Alex'],
      'primo-female': ['Google US English Female', 'Microsoft Zira', 'Samantha'],
      // Legacy voices (backward compatibility)
      'alloy': ['Google US English', 'Microsoft David', 'Alex'],
      'echo': ['Google UK English Male', 'Microsoft Mark', 'Daniel'],
      'fable': ['Google US English', 'Microsoft David', 'Alex'],
      'onyx': ['Google UK English Male', 'Microsoft Mark', 'Daniel'],
      'nova': ['Google US English Female', 'Microsoft Zira', 'Samantha'],
      'shimmer': ['Google UK English Female', 'Microsoft Zira', 'Karen']
    };

    // Get preferences for current voice
    const preferences = voiceMap[this.currentVoice] || [];

    // Try to find matching voice
    for (const preference of preferences) {
      const voice = voices.find(v => v.name.includes(preference));
      if (voice) {
        logger.debug('[TTS Client] Selected browser voice:', voice.name);
        return voice;
      }
    }

    // Default to first English voice
    const englishVoice = voices.find(v => v.lang.startsWith('en'));
    if (englishVoice) {
      logger.debug('[TTS Client] Using default English voice:', englishVoice.name);
      return englishVoice;
    }

    // Fallback to first available voice
    logger.debug('[TTS Client] Using first available voice:', voices[0].name);
    return voices[0];
  }

  /**
   * Play audio from URL
   * @param {string} audioUrl - URL of audio to play
   * @returns {Promise<void>}
   */
  playAudio(audioUrl) {
    return new Promise((resolve, reject) => {
      // Stop current audio if playing
      if (this.currentAudio) {
        this.currentAudio.pause();
        this.currentAudio = null;
      }

      // Create new audio element
      const audio = new Audio(audioUrl);
      this.currentAudio = audio;

      // Event handlers
      audio.onended = () => {
        logger.debug('[TTS Client] Audio playback completed');
        this.currentAudio = null;
        resolve();
      };

      audio.onerror = (error) => {
        console.error('[TTS Client] Audio playback error:', error);
        this.currentAudio = null;
        reject(new Error('Audio playback failed'));
      };

      // Start playback
      audio.play().catch(error => {
        console.error('[TTS Client] Audio play failed:', error);
        reject(error);
      });
    });
  }

  /**
   * Stop any ongoing speech
   */
  stop() {
    // Stop API audio
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }

    // Stop browser speech
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    logger.debug('[TTS Client] Speech stopped');
  }

  /**
   * Change voice preference
   * @param {string} voice - Voice ID (standard-male, standard-female, standard-young, primo, primo-female, or legacy)
   */
  setVoice(voice) {
    // New voices + legacy voices for backward compatibility
    const validVoices = [
      // New voices (Session 54+)
      'standard-male', 'standard-female', 'standard-young',
      'primo', 'primo-female',
      // Legacy voices (map to standard-male on backend)
      'alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'standard'
    ];

    if (!validVoices.includes(voice)) {
      console.warn('[TTS Client] Unknown voice:', voice, '- using standard-male');
      voice = 'standard-male';
    }

    this.currentVoice = voice;
    localStorage.setItem('tts_voice', voice);
    logger.debug('[TTS Client] Voice changed to:', voice);

    // Clear cache when voice changes (force regeneration)
    this.cache.clear();
  }

  /**
   * Get current voice preference
   * @returns {string}
   */
  getVoice() {
    return this.currentVoice;
  }

  /**
   * Check TTS quota from API
   * @returns {Promise<Object>}
   */
  async checkQuota() {
    try {
      const response = await fetch(this.quotaUrl);
      
      if (!response.ok) {
        throw new Error(`Quota check failed: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.success && data.quota) {
        this.quotaRemaining = data.quota.remaining;
        this.quotaLimit = data.quota.limit;
        
        logger.debug('[TTS Client] Quota:', this.quotaRemaining, '/', this.quotaLimit);
        
        return {
          remaining: this.quotaRemaining,
          limit: this.quotaLimit,
          percentage: (this.quotaRemaining / this.quotaLimit) * 100
        };
      }

      // Quota tracking not available
      return {
        remaining: null,
        limit: this.quotaLimit,
        percentage: null
      };

    } catch (error) {
      console.error('[TTS Client] Quota check error:', error);
      return {
        remaining: null,
        limit: this.quotaLimit,
        percentage: null
      };
    }
  }

  /**
   * Clear audio cache
   */
  clearCache() {
    // Revoke all blob URLs to free memory
    for (const [key, url] of this.cache.entries()) {
      if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    }
    
    this.cache.clear();
    logger.debug('[TTS Client] Cache cleared');
  }

  /**
   * Check if browser supports Web Speech API
   * @returns {boolean}
   */
  static isBrowserSupported() {
    return 'speechSynthesis' in window;
  }

  /**
   * Check if quota warning should be shown
   * @returns {boolean}
   */
  shouldShowQuotaWarning() {
    if (this.quotaRemaining === null) {
      return false;
    }
    
    // Show warning when below 1000 characters (10%)
    return this.quotaRemaining < 1000;
  }

  /**
   * Check if quota is exceeded
   * @returns {boolean}
   */
  isQuotaExceeded() {
    if (this.quotaRemaining === null) {
      return false;
    }
    
    return this.quotaRemaining <= 0;
  }
}

// Initialize global TTS client
logger.debug('[TTS Client] Creating global instance...');
window.TTSClient = new TTSClient();

// Load browser voices when available
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    logger.debug('[TTS Client] Browser voices loaded:', window.speechSynthesis.getVoices().length);
  };
}

logger.debug('[TTS Client] Ready! Usage: window.TTSClient.speak("Hello world")');