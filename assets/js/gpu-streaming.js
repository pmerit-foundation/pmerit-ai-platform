/**
 * GPU Streaming - Just-In-Time Cloud GPU for Premium Avatars
 * Phase 4: Digital Desk Classroom Redesign
 * @version 2.0.0 - Ready Player Me tutor avatar with jaw bone lip sync
 *
 * Manages tiered virtual human rendering:
 * - Free: CSS/SVG animations (client-side)
 * - Standard: WebGL 3D avatar (client-side)
 * - Premium: Unreal MetaHuman via RunPod GPU streaming
 *
 * Features:
 * - Bandwidth detection for tier auto-selection
 * - Just-In-Time GPU Pod provisioning (~$0.44/hr RTX 4090)
 * - Unreal Pixel Streaming client
 * - Auto-fallback when GPU unavailable
 * - Idle timeout for cost management
 *
 * @module gpu-streaming
 */

(function (window) {
  'use strict';

  /**
   * Avatar tier definitions with 3D model paths
   */
  const TIERS = {
    FREE: {
      name: 'free',
      minBandwidth: 0,
      avatar: 'cartoon',
      description: 'CSS/SVG Animation',
      cost: 0,
      model: null // Uses CSS avatar
    },
    STANDARD: {
      name: 'standard',
      minBandwidth: 5, // Mbps
      avatar: 'webgl',
      description: 'WebGL 3D Avatar',
      cost: 0,
      model: '/assets/models/avatars/pmerit-tutor-no-morph.glb' // Ready Player Me avatar (773KB) - jaw bone animation
    },
    PREMIUM: {
      name: 'premium',
      minBandwidth: 25, // Mbps for smooth 1080p streaming
      avatar: 'unreal',
      description: 'Unreal MetaHuman',
      cost: 0.44, // $/hr for RTX 4090 on RunPod
      model: '/assets/models/avatars/pmerit-tutor-no-morph.glb' // Fallback to WebGL model - jaw bone animation
    },
    FALLBACK: {
      name: 'fallback',
      minBandwidth: 0,
      avatar: 'static',
      description: 'Static Image',
      cost: 0,
      model: null
    }
  };

  /**
   * RunPod data center regions for GPU pods
   */
  const GPU_REGIONS = {
    US_EAST: { id: 'us-east', name: 'US East', latency: null },
    US_WEST: { id: 'us-west', name: 'US West', latency: null },
    EU_WEST: { id: 'eu-west', name: 'EU West', latency: null },
    ASIA_PACIFIC: { id: 'asia-pacific', name: 'Asia Pacific', latency: null }
  };

  /**
   * GPUStreaming class
   */
  class GPUStreaming {
    /**
     * @constructor
     * @param {Object} config - Configuration options
     */
    constructor(config = {}) {
      this.config = {
        apiBase: config.apiBase || window.CONFIG?.API_BASE_URL || 'https://api.pmerit.com',
        idleTimeout: config.idleTimeout || 300000, // 5 minutes
        maxSessionDuration: config.maxSessionDuration || 3600000, // 1 hour
        regions: config.regions || ['us-east', 'us-west', 'eu-west'],
        gpuType: config.gpuType || 'rtx-4090', // RTX 4090 GPU on RunPod
        streamQuality: config.streamQuality || 'auto'
      };

      // State
      this.state = {
        currentTier: 'standard', // Default to standard for reliable WebGL avatar
        isConnected: false,
        isStreaming: false,
        podId: null,
        podIp: null,
        streamUrl: null,
        sessionId: null,
        bandwidth: null,
        idleTimer: null,
        sessionTimer: null,
        pixelStreaming: null,
        sessionStartTime: null,
        sessionCostCents: 0,
        lastActivity: Date.now(),
        isProvisioning: false,
        provisioningProgress: 0
      };

      // WebGL state for 3D avatar rendering
      this.webgl = {
        scene: null,
        camera: null,
        renderer: null,
        model: null,
        mixer: null,
        clock: null,
        animationId: null,
        isLoading: false,
        loadedModel: null
      };

      // Callbacks
      this.callbacks = {
        onTierChange: null,
        onConnectionChange: null,
        onError: null,
        onCostUpdate: null
      };

      // DOM elements
      this.avatarFrame = null;
      this.streamContainer = null;
    }

    /**
     * Initialize GPU streaming
     * @param {HTMLElement} avatarFrameElement - Avatar frame container
     * @returns {Promise<void>}
     */
    async init(avatarFrameElement) {
      console.log('🎮 Initializing GPU Streaming...');

      this.avatarFrame = avatarFrameElement || document.getElementById('avatar-frame');

      if (!this.avatarFrame) {
        console.warn('Avatar frame element not found');
      }

      // Detect bandwidth and auto-select tier
      await this.detectBandwidth();

      // Select best region based on latency
      await this.selectBestRegion();

      console.log('✅ GPU Streaming initialized');
      console.log(`📊 Detected bandwidth: ${this.state.bandwidth?.toFixed(2) || 'Unknown'} Mbps`);
      console.log(`🎯 Recommended tier: ${this.state.currentTier}`);
    }

    /**
     * Detect network bandwidth
     * @returns {Promise<number>} Bandwidth in Mbps
     */
    async detectBandwidth() {
      console.log('📡 Detecting bandwidth...');

      try {
        // Method 1: Use Network Information API if available
        if ('connection' in navigator) {
          const connection = navigator.connection;
          if (connection.downlink) {
            this.state.bandwidth = connection.downlink; // Already in Mbps
            await this.selectTierForBandwidth(this.state.bandwidth);
            return this.state.bandwidth;
          }
        }

        // Method 2: Download test file and measure
        const testUrl = `${this.config.apiBase}/api/v1/bandwidth-test?t=${Date.now()}`;
        const startTime = performance.now();

        const response = await fetch(testUrl, {
          method: 'GET',
          cache: 'no-store'
        });

        if (!response.ok) {
          // Fallback to default moderate bandwidth
          this.state.bandwidth = 10;
          await this.selectTierForBandwidth(this.state.bandwidth);
          return this.state.bandwidth;
        }

        const blob = await response.blob();
        const endTime = performance.now();

        const durationSeconds = (endTime - startTime) / 1000;
        const bitsLoaded = blob.size * 8;
        const bps = bitsLoaded / durationSeconds;
        const mbps = bps / 1000000;

        this.state.bandwidth = mbps;
        await this.selectTierForBandwidth(mbps);

        return mbps;

      } catch (error) {
        console.warn('Bandwidth detection failed:', error);
        // Default to standard tier bandwidth
        this.state.bandwidth = 10;
        await this.selectTierForBandwidth(10);
        return 10;
      }
    }

    /**
     * Select tier based on bandwidth
     * @param {number} mbps - Bandwidth in Mbps
     * @returns {string} Selected tier name
     */
    async selectTierForBandwidth(mbps) {
      // Force standard as minimum tier - free tier doesn't load WebGL avatar
      let selectedTier = 'standard';

      if (mbps >= TIERS.PREMIUM.minBandwidth) {
        selectedTier = 'premium';
      } else {
        // Always use standard tier minimum for reliable avatar loading
        selectedTier = 'standard';
        console.log('🎯 Forcing standard tier (minimum) for reliable avatar loading');
      }

      const previousTier = this.state.currentTier;
      this.state.currentTier = selectedTier;

      if (previousTier !== selectedTier) {
        this.updateAvatarFrameTier(selectedTier);
        this.emitTierChange(selectedTier, previousTier);
      }

      // Auto-load WebGL avatar for standard tier
      if (selectedTier === 'standard' && this.avatarFrame) {
        // Wait a frame for container to be visible and sized
        await new Promise(resolve => requestAnimationFrame(resolve));
        const tierInfo = this.getTierInfo('standard');
        if (tierInfo.model) {
          console.log('🎭 Auto-loading WebGL avatar for standard tier...');
          await this.loadWebGLAvatar(tierInfo.model);
        }
      }

      return selectedTier;
    }

    /**
     * Select best region based on latency
     * Uses backend API to avoid CORS issues with direct pings
     * @returns {Promise<string>} Best region ID
     */
    async selectBestRegion() {
      console.log('🌍 Selecting best region...');

      // Use geolocation hint from timezone if available
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        let suggestedRegion = 'us-east'; // default

        if (tz) {
          // Map timezone to nearest RunPod region
          if (tz.includes('America/Los_Angeles') || tz.includes('America/Vancouver') || tz.includes('Pacific')) {
            suggestedRegion = 'us-west';
          } else if (tz.includes('Europe') || tz.includes('Africa')) {
            suggestedRegion = 'eu-west';
          } else if (tz.includes('Asia') || tz.includes('Australia') || tz.includes('Pacific/Auckland')) {
            suggestedRegion = 'asia-pacific';
          } else {
            suggestedRegion = 'us-east'; // Americas East default
          }
        }

        // Store estimated latency based on region proximity (ms)
        const estimatedLatencies = {
          'us-east': tz.includes('America') && !tz.includes('Los_Angeles') ? 30 : 100,
          'us-west': tz.includes('Pacific') || tz.includes('Los_Angeles') ? 30 : 100,
          'eu-west': tz.includes('Europe') ? 30 : 120,
          'asia-pacific': tz.includes('Asia') || tz.includes('Australia') ? 30 : 150
        };

        this.config.regions.forEach(region => {
          const key = region.toUpperCase().replace('-', '_');
          if (GPU_REGIONS[key]) {
            GPU_REGIONS[key].latency = estimatedLatencies[region] || 100;
          }
        });

        console.log(`📍 Selected region: ${suggestedRegion} (based on timezone: ${tz})`);
        return suggestedRegion;

      } catch (error) {
        console.warn('Region selection fallback:', error);
        return 'us-east';
      }
    }

    /**
     * Get current tier
     * @returns {string}
     */
    getCurrentTier() {
      return this.state.currentTier;
    }

    /**
     * Get tier info
     * @param {string} tierName - Tier name
     * @returns {Object}
     */
    getTierInfo(tierName) {
      return TIERS[tierName?.toUpperCase()] || TIERS.FREE;
    }

    /**
     * Upgrade to a higher tier
     * @param {string} targetTier - Target tier name
     * @returns {Promise<boolean>}
     */
    async upgradeTier(targetTier) {
      return await this.switchTier(targetTier);
    }

    /**
     * Downgrade to a lower tier
     * @param {string} targetTier - Target tier name
     * @returns {Promise<boolean>}
     */
    async downgradeTier(targetTier) {
      return await this.switchTier(targetTier);
    }

    /**
     * Switch to a different tier
     * @param {string} newTier - Target tier name
     * @returns {Promise<boolean>}
     */
    async switchTier(newTier) {
      const tierInfo = this.getTierInfo(newTier);
      if (!tierInfo) {
        console.error(`Invalid tier: ${newTier}`);
        return false;
      }

      console.log(`🔄 Switching from ${this.state.currentTier} to ${newTier}...`);

      // Check bandwidth requirement
      if (this.state.bandwidth < tierInfo.minBandwidth) {
        console.warn(`Bandwidth too low for ${newTier} tier`);
        this.emitError('bandwidth_insufficient', {
          required: tierInfo.minBandwidth,
          actual: this.state.bandwidth
        });
        return false;
      }

      const previousTier = this.state.currentTier;

      // Handle tier-specific transitions
      if (newTier === 'premium' && previousTier !== 'premium') {
        // Upgrade to premium - provision GPU
        this.disposeWebGL(); // Clean up WebGL first
        const success = await this.startSession();
        if (!success) {
          console.warn('Failed to provision GPU, falling back');
          await this.fallbackToWebGL();
          return false;
        }
      } else if (previousTier === 'premium' && newTier !== 'premium') {
        // Downgrade from premium - destroy GPU
        await this.endSession();
      }

      // Handle WebGL avatar for standard tier
      if (newTier === 'standard') {
        // Load 3D WebGL avatar
        const webglSuccess = await this.loadWebGLAvatar(tierInfo.model);
        if (!webglSuccess) {
          console.warn('WebGL avatar failed, falling back to CSS');
          this.state.currentTier = 'free';
          this.updateAvatarFrameTier('free');
          this.emitTierChange('free', previousTier);
          return false;
        }
      } else if (newTier === 'free' && previousTier === 'standard') {
        // Downgrading from standard to free - dispose WebGL
        this.disposeWebGL();
      }

      this.state.currentTier = newTier;
      this.updateAvatarFrameTier(newTier);
      this.emitTierChange(newTier, previousTier);

      return true;
    }

    /**
     * Start streaming - loads the avatar based on current/recommended tier
     * This is the main entry point to begin avatar rendering
     * @returns {Promise<boolean>}
     */
    async startStreaming() {
      console.log('🎬 Starting avatar streaming...');

      // Use the detected tier or default to standard
      const targetTier = this.state.currentTier || 'standard';

      try {
        // Switch to the target tier, which will load the appropriate avatar
        const success = await this.switchTier(targetTier);

        if (success) {
          this.state.isStreaming = true;
          console.log(`✅ Avatar streaming started (${targetTier} tier)`);
        } else {
          // Tier switch failed, try fallback to WebGL standard
          console.warn('Tier switch failed, attempting WebGL fallback...');
          await this.fallbackToWebGL();
          this.state.isStreaming = true;
        }

        return true;
      } catch (error) {
        console.error('Failed to start streaming:', error);
        // Last resort: try cartoon fallback
        this.fallbackToCartoon();
        return false;
      }
    }

    /**
     * Stop streaming - disposes WebGL resources and stops rendering
     */
    stopStreaming() {
      console.log('🛑 Stopping avatar streaming...');

      this.state.isStreaming = false;

      // Dispose WebGL resources
      this.disposeWebGL();

      // If we have a premium session, end it
      if (this.state.currentTier === 'premium' && this.state.sessionActive) {
        this.endSession();
      }

      console.log('✅ Avatar streaming stopped');
    }

    /**
     * Update avatar frame UI for tier
     * @param {string} tier - Tier name
     */
    updateAvatarFrameTier(tier) {
      if (!this.avatarFrame) return;

      // Remove all tier classes
      this.avatarFrame.classList.remove(
        'tier-free', 'tier-standard', 'tier-premium', 'tier-fallback',
        'transitioning'
      );

      // Add transition effect
      this.avatarFrame.classList.add('transitioning');

      // Add new tier class
      setTimeout(() => {
        this.avatarFrame.classList.add(`tier-${tier}`);
        this.avatarFrame.classList.remove('transitioning');
      }, 500);

      // Update live badge
      const liveBadge = this.avatarFrame.querySelector('.avatar-live-badge');
      if (liveBadge) {
        if (tier === 'premium') {
          liveBadge.innerHTML = '<span class="live-dot"></span> LIVE HD';
          liveBadge.classList.add('premium', 'hd');
          liveBadge.style.display = 'flex';
        } else if (tier === 'standard') {
          liveBadge.innerHTML = '<span class="live-dot"></span> LIVE';
          liveBadge.classList.remove('premium', 'hd');
          liveBadge.style.display = 'flex';
        } else {
          liveBadge.style.display = 'none';
        }
      }
    }

    /**
     * Start premium GPU session
     * @returns {Promise<boolean>}
     */
    async startSession() {
      if (this.state.isProvisioning) {
        console.warn('Already provisioning');
        return false;
      }

      console.log('🚀 Starting premium GPU session...');
      this.state.isProvisioning = true;
      this.state.provisioningProgress = 0;

      try {
        // Provision GPU pod on RunPod
        const pod = await this.provisionPod();
        if (!pod) {
          throw new Error('Failed to provision pod');
        }

        this.state.podId = pod.id;
        this.state.podIp = pod.ip;
        this.state.streamUrl = `wss://${pod.ip}:8888`;
        this.state.sessionId = pod.session_id;
        this.state.sessionStartTime = Date.now();

        // Connect to Pixel Streaming
        const connected = await this.connectPixelStream(this.state.streamUrl);
        if (!connected) {
          throw new Error('Failed to connect to pixel stream');
        }

        this.state.isConnected = true;
        this.state.isProvisioning = false;

        // Start idle timer
        this.startIdleTimer();

        // Start session timer
        this.startSessionTimer();

        this.emitConnectionChange(true);
        console.log('✅ Premium GPU session started');

        return true;

      } catch (error) {
        console.error('Failed to start GPU session:', error);
        this.state.isProvisioning = false;
        this.emitError('session_start_failed', error.message);
        return false;
      }
    }

    /**
     * End premium GPU session
     * @returns {Promise<void>}
     */
    async endSession() {
      console.log('⏹️ Ending GPU session...');

      // Stop timers
      this.stopIdleTimer();
      this.stopSessionTimer();

      // Disconnect stream
      this.disconnectPixelStream();

      // Destroy pod
      if (this.state.podId) {
        await this.destroyPod(this.state.podId);
      }

      // Calculate final cost
      const sessionDuration = Date.now() - (this.state.sessionStartTime || Date.now());
      const hoursFraction = sessionDuration / 3600000;
      this.state.sessionCostCents = Math.ceil(hoursFraction * TIERS.PREMIUM.cost * 100);

      // Log session to backend
      await this.logSession({
        session_id: this.state.sessionId,
        pod_id: this.state.podId,
        duration_ms: sessionDuration,
        cost_cents: this.state.sessionCostCents
      });

      // Reset state
      this.state.isConnected = false;
      this.state.podId = null;
      this.state.podIp = null;
      this.state.streamUrl = null;
      this.state.sessionStartTime = null;

      this.emitConnectionChange(false);
      console.log('✅ GPU session ended');
    }

    /**
     * Provision GPU pod via API (RunPod)
     * @param {string} region - Region ID
     * @returns {Promise<Object>} Pod info
     */
    async provisionPod(region = null) {
      console.log('☁️ Provisioning GPU pod on RunPod...');

      this.state.provisioningProgress = 10;

      try {
        const response = await fetch(`${this.config.apiBase}/api/v1/gpu/provision`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('pmerit_auth_token')}`
          },
          body: JSON.stringify({
            region: region || await this.selectBestRegion(),
            gpu_type: this.config.gpuType,
            image: 'pmerit-unreal-metahuman' // Custom container with Unreal + Pixel Streaming
          })
        });

        if (!response.ok) {
          throw new Error(`Provision failed: ${response.status}`);
        }

        this.state.provisioningProgress = 30;

        const data = await response.json();

        // Wait for pod to be ready
        const ready = await this.waitForPodReady(data.pod_id || data.session?.pod_id);
        if (!ready) {
          throw new Error('Pod failed to become ready');
        }

        this.state.provisioningProgress = 100;

        return {
          id: data.pod_id || data.session?.pod_id,
          ip: data.ip_address || data.session?.stream_url?.replace('wss://gpu-stream.pmerit.com/', ''),
          session_id: data.session_id || data.session?.session_id
        };

      } catch (error) {
        console.error('Pod provision error:', error);
        this.state.provisioningProgress = 0;
        return null;
      }
    }

    /**
     * Wait for pod to be ready
     * @param {string} podId - Pod ID
     * @param {number} maxWait - Max wait time in ms
     * @returns {Promise<boolean>}
     */
    async waitForPodReady(podId, maxWait = 120000) {
      console.log('⏳ Waiting for pod to be ready...');

      const startTime = Date.now();
      const pollInterval = 5000; // 5 seconds

      while (Date.now() - startTime < maxWait) {
        try {
          const status = await this.getPodStatus(podId);

          // Update progress
          const elapsed = Date.now() - startTime;
          this.state.provisioningProgress = 30 + Math.min(60, (elapsed / maxWait) * 60);

          if (status?.status === 'active' && status?.ip) {
            return true;
          }

          await new Promise(resolve => setTimeout(resolve, pollInterval));

        } catch (error) {
          console.warn('Status check error:', error);
        }
      }

      return false;
    }

    /**
     * Get pod status
     * @param {string} podId - Pod ID
     * @returns {Promise<Object>}
     */
    async getPodStatus(podId) {
      try {
        const response = await fetch(`${this.config.apiBase}/api/v1/gpu/status/${podId}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('pmerit_auth_token')}`
          }
        });

        if (!response.ok) return null;

        return await response.json();

      } catch (error) {
        return null;
      }
    }

    /**
     * Destroy GPU pod
     * @param {string} podId - Pod ID
     * @returns {Promise<boolean>}
     */
    async destroyPod(podId) {
      console.log('🗑️ Destroying GPU pod...');

      try {
        const response = await fetch(`${this.config.apiBase}/api/v1/gpu/destroy`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('pmerit_auth_token')}`
          },
          body: JSON.stringify({ session_id: podId })
        });

        return response.ok;

      } catch (error) {
        console.error('Failed to destroy pod:', error);
        return false;
      }
    }

    /**
     * Connect to Pixel Streaming
     * @param {string} streamUrl - WebSocket URL
     * @returns {Promise<boolean>}
     */
    async connectPixelStream(streamUrl) {
      console.log('🔗 Connecting to Pixel Streaming...');

      return new Promise((resolve) => {
        try {
          // Create stream container if needed
          if (!this.streamContainer) {
            this.streamContainer = document.createElement('div');
            this.streamContainer.id = 'pixel-stream-container';
            this.streamContainer.style.cssText = `
              position: absolute;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              border-radius: 18px;
              overflow: hidden;
            `;

            if (this.avatarFrame) {
              this.avatarFrame.appendChild(this.streamContainer);
            }
          }

          // Initialize Pixel Streaming (requires Unreal's PixelStreaming.js)
          if (typeof PixelStreaming !== 'undefined') {
            this.state.pixelStreaming = new PixelStreaming({
              container: this.streamContainer,
              signallingServerUrl: streamUrl,
              autoPlayVideo: true,
              startVideoMuted: true
            });

            this.state.pixelStreaming.addEventListener('connect', () => {
              console.log('✅ Pixel Streaming connected');
              resolve(true);
            });

            this.state.pixelStreaming.addEventListener('error', (error) => {
              console.error('Pixel Streaming error:', error);
              resolve(false);
            });

            this.state.pixelStreaming.connect();

          } else {
            // Fallback: Create video element for WHEP/WebRTC stream
            console.log('Using WebRTC fallback...');

            const video = document.createElement('video');
            video.autoplay = true;
            video.playsInline = true;
            video.muted = true;
            video.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';

            this.streamContainer.appendChild(video);

            // Connect via WebRTC
            this.connectWebRTC(streamUrl, video)
              .then(resolve)
              .catch(() => resolve(false));
          }

        } catch (error) {
          console.error('Pixel Stream connection error:', error);
          resolve(false);
        }
      });
    }

    /**
     * Connect via WebRTC (fallback)
     * @param {string} url - Signaling URL
     * @param {HTMLVideoElement} videoElement - Video element
     * @returns {Promise<boolean>}
     */
    async connectWebRTC(url, videoElement) {
      try {
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        pc.ontrack = (event) => {
          videoElement.srcObject = event.streams[0];
        };

        // Signal exchange would happen here with your signaling server
        // This is a simplified example

        this.state.peerConnection = pc;
        return true;

      } catch (error) {
        console.error('WebRTC connection failed:', error);
        return false;
      }
    }

    /**
     * Disconnect from Pixel Stream
     */
    disconnectPixelStream() {
      if (this.state.pixelStreaming) {
        this.state.pixelStreaming.disconnect();
        this.state.pixelStreaming = null;
      }

      if (this.state.peerConnection) {
        this.state.peerConnection.close();
        this.state.peerConnection = null;
      }

      if (this.streamContainer) {
        this.streamContainer.innerHTML = '';
      }
    }

    /**
     * Send input to stream (for interactive avatar)
     * @param {Object} input - Input data
     */
    sendInputToStream(input) {
      if (this.state.pixelStreaming) {
        this.state.pixelStreaming.emitUIInteraction(input);
      }

      // Reset idle timer on activity
      this.resetIdleTimer();
    }

    /**
     * Handle stream message
     * @param {Object} message - Message from stream
     */
    handleStreamMessage(message) {
      // Process messages from Unreal (e.g., animation events, speech)
      console.log('Stream message:', message);

      this.resetIdleTimer();
    }

    /**
     * Start idle timer
     */
    startIdleTimer() {
      this.stopIdleTimer();

      this.state.idleTimer = setTimeout(() => {
        this.handleIdleTimeout();
      }, this.config.idleTimeout);
    }

    /**
     * Reset idle timer
     */
    resetIdleTimer() {
      this.state.lastActivity = Date.now();

      if (this.state.isConnected) {
        this.startIdleTimer();
      }
    }

    /**
     * Stop idle timer
     */
    stopIdleTimer() {
      if (this.state.idleTimer) {
        clearTimeout(this.state.idleTimer);
        this.state.idleTimer = null;
      }
    }

    /**
     * Handle idle timeout
     */
    async handleIdleTimeout() {
      console.log('⏰ Idle timeout reached');

      // Downgrade to save costs
      await this.switchTier('standard');
    }

    /**
     * Start session timer (max duration)
     */
    startSessionTimer() {
      this.stopSessionTimer();

      this.state.sessionTimer = setInterval(() => {
        const duration = Date.now() - this.state.sessionStartTime;
        const hoursFraction = duration / 3600000;
        const costCents = Math.ceil(hoursFraction * TIERS.PREMIUM.cost * 100);

        this.state.sessionCostCents = costCents;
        this.emitCostUpdate(costCents);

        // Check max duration
        if (duration >= this.config.maxSessionDuration) {
          console.log('⏰ Max session duration reached');
          this.switchTier('standard');
        }

      }, 60000); // Update every minute
    }

    /**
     * Stop session timer
     */
    stopSessionTimer() {
      if (this.state.sessionTimer) {
        clearInterval(this.state.sessionTimer);
        this.state.sessionTimer = null;
      }
    }

    /**
     * Get current session cost
     * @returns {number} Cost in cents
     */
    getSessionCost() {
      if (!this.state.sessionStartTime) return 0;

      const duration = Date.now() - this.state.sessionStartTime;
      const hoursFraction = duration / 3600000;
      return Math.ceil(hoursFraction * TIERS.PREMIUM.cost * 100);
    }

    /**
     * Get formatted session cost
     * @returns {string}
     */
    getFormattedCost() {
      const cents = this.getSessionCost();
      return `$${(cents / 100).toFixed(2)}`;
    }

    /**
     * Log session to backend
     * @param {Object} data - Session data
     */
    async logSession(data) {
      try {
        await fetch(`${this.config.apiBase}/api/v1/gpu/log-session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('pmerit_auth_token')}`
          },
          body: JSON.stringify(data)
        });
      } catch (error) {
        console.warn('Failed to log session:', error);
      }
    }

    /**
     * Fallback to WebGL (loads 3D avatar)
     */
    async fallbackToWebGL() {
      console.log('📉 Falling back to WebGL avatar');
      this.state.currentTier = 'standard';
      this.updateAvatarFrameTier('standard');

      // Load the 3D WebGL avatar
      const success = await this.loadWebGLAvatar(TIERS.STANDARD.model);
      if (!success) {
        console.warn('WebGL fallback failed, using CSS avatar');
        this.fallbackToCartoon();
        return;
      }

      this.emitTierChange('standard', 'premium');
    }

    /**
     * Fallback to cartoon
     */
    fallbackToCartoon() {
      console.log('📉 Falling back to cartoon avatar');
      this.disposeWebGL();
      this.state.currentTier = 'free';
      this.updateAvatarFrameTier('free');
      this.emitTierChange('free', this.state.currentTier);
    }

    // =========================================================================
    // WebGL 3D Avatar Rendering
    // =========================================================================

    /**
     * Load and render WebGL 3D avatar
     * @param {string} modelPath - Path to GLB model file
     * @returns {Promise<boolean>}
     */
    async loadWebGLAvatar(modelPath = null) {
      console.log('🎭 loadWebGLAvatar called');
      console.log('🎭 avatarFrame element:', this.avatarFrame);
      console.log('🎭 avatarFrame dimensions:', this.avatarFrame?.clientWidth, 'x', this.avatarFrame?.clientHeight);
      console.log('🎭 avatarFrame visible:', this.avatarFrame?.offsetParent !== null);

      // Use tier model if not specified
      const tierInfo = this.getTierInfo(this.state.currentTier);
      const path = modelPath || tierInfo?.model || TIERS.STANDARD.model;
      if (!path) {
        console.warn('No model path specified for WebGL avatar');
        return false;
      }

      // Check if Three.js is available
      if (typeof THREE === 'undefined') {
        console.error('Three.js not loaded. Cannot render WebGL avatar.');
        return false;
      }

      // Don't reload same model
      if (this.webgl.loadedModel === path && this.webgl.renderer) {
        return true;
      }

      console.log('🎭 Loading 3D avatar:', path);
      this.webgl.isLoading = true;

      try {
        // Dispose previous WebGL resources
        this.disposeWebGL();

        // Get container dimensions
        const container = this.avatarFrame;
        if (!container) {
          throw new Error('Avatar frame container not found');
        }

        // Get dimensions - use reasonable defaults if container is hidden
        // Container may be hidden initially, so fallback dimensions are important
        let width = container.clientWidth;
        let height = container.clientHeight;

        // If container is hidden/collapsed, use CSS variable values or defaults
        if (width < 50 || height < 50) {
          // Try to get from computed style
          const style = getComputedStyle(document.documentElement);
          const cssWidth = parseInt(style.getPropertyValue('--vh-container-max-width')) || 400;
          const cssHeight = parseInt(style.getPropertyValue('--vh-container-height')) || 380;
          width = width || cssWidth;
          height = height || cssHeight;
          console.log(`📐 Container hidden, using fallback dimensions: ${width}x${height}`);
        }

        // Ensure minimum dimensions for WebGL
        // Note: Sidebar avatar uses 180px height, so allow smaller dimensions
        width = Math.max(width, 150);
        height = Math.max(height, 150);

        // Canvas dimensions set

        // Create scene with transparent background (shows avatar-frame gradient)
        this.webgl.scene = new THREE.Scene();
        // Transparent background - let CSS gradient show through
        this.webgl.scene.background = null;

        // Create camera - will reposition after model loads for waist-up framing
        this.webgl.camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
        this.webgl.camera.position.set(0, 1.4, 2.5);
        this.webgl.camera.lookAt(0, 1.2, 0);

        // Find the avatar-stage container (or fall back to avatar-frame)
        const avatarStage = container.querySelector('.avatar-stage');
        const canvasContainer = avatarStage || container;

        // Remove any existing vh-canvas to prevent conflicts
        const existingCanvas = canvasContainer.querySelector('canvas#vh-canvas');
        if (existingCanvas) {
          existingCanvas.remove();
        }

        // Create new WebGL renderer with transparency
        this.webgl.renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true, // Enable transparency for CSS background to show
          powerPreference: 'high-performance'
        });

        // Transparent clear color
        this.webgl.renderer.setClearColor(0x000000, 0);

        // Get the canvas element from the renderer
        const canvas = this.webgl.renderer.domElement;

        // Set canvas ID and styling
        canvas.id = 'vh-canvas';
        canvas.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          border-radius: 18px;
          z-index: 10;
          display: block;
        `;

        // Set pixel dimensions for WebGL rendering
        canvas.width = width;
        canvas.height = height;

        // Append canvas to the container
        canvasContainer.appendChild(canvas);

        // Verify canvas is in DOM
        if (!canvas.parentElement) {
          throw new Error('Canvas not attached to DOM');
        }

        this.webgl.renderer.setSize(width, height);
        this.webgl.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.webgl.renderer.outputEncoding = THREE.sRGBEncoding;
        this.webgl.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.webgl.renderer.toneMappingExposure = 1.4; // Brighter for better skin tones
        this.webgl.renderer.shadowMap.enabled = true;
        this.webgl.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Add lighting
        this.setupLighting();

        // Load the model
        await this.loadGLBModel(path);

        // Create animation clock
        this.webgl.clock = new THREE.Clock();

        // Start animation loop
        this.startWebGLAnimation();

        // Handle resize
        this.setupResizeHandler();

        this.webgl.isLoading = false;
        this.webgl.loadedModel = path;

        console.log('✅ WebGL 3D avatar loaded successfully');
        return true;

      } catch (error) {
        console.error('Failed to load WebGL avatar:', error);
        this.webgl.isLoading = false;
        this.disposeWebGL();
        return false;
      }
    }

    /**
     * Set up scene lighting
     */
    setupLighting() {
      if (!this.webgl.scene) return;

      // === PROFESSIONAL 3-POINT STUDIO LIGHTING ===
      // Optimized for Humano3D PBR skin rendering

      // Ambient light - brighter for skin visibility
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
      this.webgl.scene.add(ambientLight);

      // Hemisphere light for natural sky/ground gradient
      const hemiLight = new THREE.HemisphereLight(0xffeedd, 0x444444, 0.6);
      hemiLight.position.set(0, 10, 0);
      this.webgl.scene.add(hemiLight);

      // KEY LIGHT - Main light, warm white, front-right
      const keyLight = new THREE.DirectionalLight(0xfff5e6, 1.4);
      keyLight.position.set(3, 4, 3);
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.width = 2048;
      keyLight.shadow.mapSize.height = 2048;
      keyLight.shadow.camera.near = 0.1;
      keyLight.shadow.camera.far = 20;
      keyLight.shadow.bias = -0.001;
      this.webgl.scene.add(keyLight);

      // FILL LIGHT - Softer, warm tone, front-left
      const fillLight = new THREE.DirectionalLight(0xffeedd, 0.5);
      fillLight.position.set(-3, 3, 2);
      this.webgl.scene.add(fillLight);

      // RIM LIGHT - Strong edge definition, behind model
      const rimLight = new THREE.DirectionalLight(0xffffff, 0.7);
      rimLight.position.set(0, 3, -4);
      this.webgl.scene.add(rimLight);

      // FACE LIGHT - Soft frontal fill for skin glow
      const faceLight = new THREE.PointLight(0xffffff, 0.3, 10);
      faceLight.position.set(0, 1.5, 2);
      this.webgl.scene.add(faceLight);

      // Ground plane for shadows (invisible)
      const groundGeometry = new THREE.PlaneGeometry(10, 10);
      const groundMaterial = new THREE.ShadowMaterial({ opacity: 0.2 });
      const ground = new THREE.Mesh(groundGeometry, groundMaterial);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = 0;
      ground.receiveShadow = true;
      this.webgl.scene.add(ground);

      console.log('💡 Professional studio lighting configured');
    }

    /**
     * Load GLB model using GLTFLoader
     * @param {string} path - Model path
     * @returns {Promise<void>}
     */
    async loadGLBModel(path) {
      console.log('🎭 loadGLBModel called with path:', path);

      return new Promise(async (resolve, reject) => {
        // Check for GLTFLoader
        if (typeof THREE.GLTFLoader === 'undefined') {
          console.error('🎭 THREE.GLTFLoader is undefined!');
          reject(new Error('GLTFLoader not available'));
          return;
        }
        console.log('🎭 THREE.GLTFLoader available');

        const loader = new THREE.GLTFLoader();

        // Configure meshopt decoder if available (required for compressed GLB models)
        // Three.js r152+ has native setMeshoptDecoder support
        if (typeof MeshoptDecoder !== 'undefined' && typeof loader.setMeshoptDecoder === 'function') {
          try {
            // Wait for WASM to be ready
            await MeshoptDecoder.ready;
            loader.setMeshoptDecoder(MeshoptDecoder);
            console.log('✅ MeshoptDecoder configured for GLTFLoader');
          } catch (e) {
            console.warn('⚠️ MeshoptDecoder setup failed:', e.message);
          }
        } else if (typeof MeshoptDecoder !== 'undefined') {
          // Fallback: Try to wait for decoder to be ready
          try {
            await MeshoptDecoder.ready;
            // For older Three.js versions without native support, the decoder won't work
            console.warn('⚠️ MeshoptDecoder available but GLTFLoader.setMeshoptDecoder not found - upgrade Three.js to r152+');
          } catch (e) {
            console.warn('⚠️ MeshoptDecoder not ready:', e.message);
          }
        } else {
          console.warn('⚠️ MeshoptDecoder not available - compressed GLB models may fail to load');
        }

        // Add loading progress
        loader.load(
          path,
          async (gltf) => {
            this.webgl.model = gltf.scene;

            // Calculate model bounds
            const rawBox = new THREE.Box3().setFromObject(this.webgl.model);
            const rawSize = rawBox.getSize(new THREE.Vector3());

            // Scale to fit ~1.8m height
            const targetHeight = 1.8;
            let scale = 1;
            if (rawSize.y > 0.01) {
              scale = targetHeight / rawSize.y;
            }
            this.webgl.model.scale.setScalar(scale);

            // Recalculate bounds after scaling
            const box = new THREE.Box3().setFromObject(this.webgl.model);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());

            // Center horizontally, place feet at y=0
            this.webgl.model.position.x = -center.x;
            this.webgl.model.position.y = -box.min.y;
            this.webgl.model.position.z = -center.z;

            // DEBUG: Log actual model bounds to understand coordinate system
            console.log('🔍 MODEL DEBUG:');
            console.log('  Raw box min:', rawBox.min.x.toFixed(2), rawBox.min.y.toFixed(2), rawBox.min.z.toFixed(2));
            console.log('  Raw box max:', rawBox.max.x.toFixed(2), rawBox.max.y.toFixed(2), rawBox.max.z.toFixed(2));
            console.log('  Raw size:', rawSize.x.toFixed(2), rawSize.y.toFixed(2), rawSize.z.toFixed(2));
            console.log('  Scale applied:', scale.toFixed(4));
            console.log('  Scaled box min:', box.min.x.toFixed(2), box.min.y.toFixed(2), box.min.z.toFixed(2));
            console.log('  Scaled box max:', box.max.x.toFixed(2), box.max.y.toFixed(2), box.max.z.toFixed(2));
            console.log('  Scaled center:', center.x.toFixed(2), center.y.toFixed(2), center.z.toFixed(2));
            console.log('  Scaled size:', size.x.toFixed(2), size.y.toFixed(2), size.z.toFixed(2));
            console.log('  Model position after centering:', this.webgl.model.position.x.toFixed(2), this.webgl.model.position.y.toFixed(2), this.webgl.model.position.z.toFixed(2));

            // Calculate actual model bounds AFTER repositioning
            const finalBox = new THREE.Box3().setFromObject(this.webgl.model);
            console.log('  Final box min (world):', finalBox.min.x.toFixed(2), finalBox.min.y.toFixed(2), finalBox.min.z.toFixed(2));
            console.log('  Final box max (world):', finalBox.max.x.toFixed(2), finalBox.max.y.toFixed(2), finalBox.max.z.toFixed(2));

            // GLB has embedded textures - configure materials for proper rendering
            this.webgl.model.traverse((child) => {
              if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;

                // Process materials (handle arrays for multi-material meshes)
                const materials = Array.isArray(child.material) ? child.material : [child.material];

                materials.forEach((mat) => {
                  if (!mat) return;

                  // Debug: Log material info
                  console.log('🎨 Mesh:', child.name, {
                    skinned: child.isSkinnedMesh,
                    hasMap: !!mat.map,
                    hasNormal: !!mat.normalMap,
                    hasMetalRough: !!mat.metalnessMap || !!mat.roughnessMap,
                    hasEmissive: !!mat.emissiveMap,
                    color: mat.color?.getHexString(),
                    type: mat.type
                  });

                  // === CRITICAL: Set sRGB encoding on all color textures ===
                  // Without this, textures appear washed out or white
                  if (mat.map) {
                    mat.map.encoding = THREE.sRGBEncoding;
                    mat.map.needsUpdate = true;
                  }
                  if (mat.emissiveMap) {
                    mat.emissiveMap.encoding = THREE.sRGBEncoding;
                    mat.emissiveMap.needsUpdate = true;
                  }
                  // Note: Normal, metalness, roughness maps should stay LinearEncoding

                  // Ensure material is double-sided for hair/cloth that may be single-sided
                  // mat.side = THREE.DoubleSide; // Uncomment if backfaces are missing

                  // For PBR materials, ensure proper settings
                  if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
                    // If metalness is too high with no metalness map, reduce it
                    if (!mat.metalnessMap && mat.metalness > 0.5) {
                      mat.metalness = 0.1;
                    }
                    // Ensure roughness isn't too extreme
                    if (!mat.roughnessMap) {
                      mat.roughness = Math.max(0.3, Math.min(0.9, mat.roughness || 0.5));
                    }
                  }

                  // If material has no textures and no color, give it a default skin tone
                  if (!mat.map && (!mat.color || mat.color.getHex() === 0xffffff)) {
                    // Default to a neutral skin-ish tone rather than pure white
                    mat.color = new THREE.Color(0xe0c8b8);
                    console.log('⚠️ Applied fallback skin color to material with no texture');
                  }

                  mat.needsUpdate = true;
                });
              }
            });

            console.log('✅ GLB textures configured with sRGB encoding');

            // Add to scene
            this.webgl.scene.add(this.webgl.model);

            // Debug: Log bounding box info
            console.log(`📐 Model bounds: size=${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)}`);

            // FACE FRAMING - Use ACTUAL world coordinates from finalBox
            // After positioning, model feet are at Y=0, top of head is at finalBox.max.y
            const actualHeight = finalBox.max.y - finalBox.min.y;
            const actualTop = finalBox.max.y;

            // Human face is at ~90% of height from feet
            // Eyes at ~94%, chin at ~87%, so center of face ~90%
            const faceY = actualTop * 0.92;  // 92% of actual model top

            // Camera should be at face level, looking slightly down
            const cameraY = faceY + 0.05;  // Slightly above face

            // Distance calculation: for portrait framing (head + shoulders)
            // We want to see from roughly shoulder height (75% of model) to top of head
            // With FOV=35deg, calculate distance needed
            const frameTop = actualTop;
            const frameBottom = actualTop * 0.65;  // Show from ~65% up (shoulders)
            const frameHeight = frameTop - frameBottom;
            const fovRad = (35 / 2) * (Math.PI / 180);  // Half FOV in radians
            const cameraZ = (frameHeight / 2) / Math.tan(fovRad) * 1.1;  // 1.1x buffer

            this.webgl.camera.position.set(0, cameraY, cameraZ);
            this.webgl.camera.lookAt(0, faceY, 0);

            console.log(`📷 Camera positioning:`);
            console.log(`  Actual model height: ${actualHeight.toFixed(2)}, top: ${actualTop.toFixed(2)}`);
            console.log(`  Face Y: ${faceY.toFixed(2)}, Camera Y: ${cameraY.toFixed(2)}, Camera Z: ${cameraZ.toFixed(2)}`);

            // Set up animations if present
            if (gltf.animations && gltf.animations.length > 0) {
              console.log(`🎬 Playing animation: ${gltf.animations[0].name || 'default'}`);
              this.webgl.mixer = new THREE.AnimationMixer(this.webgl.model);
              const action = this.webgl.mixer.clipAction(gltf.animations[0]);
              action.play();
            }

            // Force initial render
            if (this.webgl.renderer && this.webgl.scene && this.webgl.camera) {
              this.webgl.renderer.render(this.webgl.scene, this.webgl.camera);
            }

            console.log(`✅ 3D avatar loaded: ${path}`);

            // Debug: Log all bones and morph targets in the model
            this.debugModelStructure();

            // Initialize lip sync after model loads
            this.initLipSync();

            resolve();
          },
          (progress) => {
            if (progress.total > 0) {
              const percent = (progress.loaded / progress.total * 100).toFixed(0);
              console.log(`📦 Loading model: ${percent}%`);
            } else {
              console.log(`📦 Loading model: ${progress.loaded} bytes...`);
            }
          },
          (error) => {
            console.error('❌ Model load error:', error);
            reject(error);
          }
        );
      });
    }

    /**
     * Start WebGL animation loop
     */
    startWebGLAnimation() {
      if (this.webgl.animationId) {
        cancelAnimationFrame(this.webgl.animationId);
      }

      const animate = () => {
        this.webgl.animationId = requestAnimationFrame(animate);

        if (!this.webgl.renderer || !this.webgl.scene || !this.webgl.camera) {
          return;
        }

        // Update animation mixer (plays GLB animations)
        if (this.webgl.mixer && this.webgl.clock) {
          const delta = this.webgl.clock.getDelta();
          this.webgl.mixer.update(delta);
        }

        // Subtle idle animation (breathing/swaying) when no GLB animation
        if (this.webgl.model && !this.webgl.mixer) {
          const time = Date.now() * 0.001;
          // Store base Y to avoid drift
          if (this.webgl._baseY === undefined) {
            this.webgl._baseY = this.webgl.model.position.y;
          }
          // Subtle breathing motion
          this.webgl.model.position.y = this.webgl._baseY + Math.sin(time * 2) * 0.005;
          // Very subtle sway
          this.webgl.model.rotation.y = Math.sin(time * 0.5) * 0.02;
        }

        // Render frame
        this.webgl.renderer.render(this.webgl.scene, this.webgl.camera);
      };

      animate();
    }

    /**
     * Set up window resize handler
     */
    setupResizeHandler() {
      this._resizeHandler = () => {
        if (!this.avatarFrame || !this.webgl.renderer || !this.webgl.camera) return;

        const width = this.avatarFrame.clientWidth;
        const height = this.avatarFrame.clientHeight;

        // Skip if container is collapsed/hidden (dimensions too small)
        if (width < 50 || height < 50) return;

        // Update canvas pixel dimensions
        const canvas = this.webgl.renderer.domElement;
        if (canvas) {
          canvas.width = width;
          canvas.height = height;
        }

        this.webgl.camera.aspect = width / height;
        this.webgl.camera.updateProjectionMatrix();
        this.webgl.renderer.setSize(width, height);
      };

      window.addEventListener('resize', this._resizeHandler);

      // Also trigger resize when container becomes visible
      // This handles the case where model loads while container is hidden
      this._visibilityObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes' &&
              (mutation.attributeName === 'hidden' || mutation.attributeName === 'class')) {
            // Container visibility may have changed
            setTimeout(() => this._resizeHandler(), 100);
          }
        }
      });

      // Observe the vh-root container for visibility changes
      const vhRoot = this.avatarFrame?.closest('.vh-root') || this.avatarFrame?.parentElement;
      if (vhRoot) {
        this._visibilityObserver.observe(vhRoot, { attributes: true });
      }
    }

    /**
     * Dispose WebGL resources
     */
    disposeWebGL() {
      console.log('🧹 Disposing WebGL resources...');

      // Stop animation
      if (this.webgl.animationId) {
        cancelAnimationFrame(this.webgl.animationId);
        this.webgl.animationId = null;
      }

      // Remove resize handler
      if (this._resizeHandler) {
        window.removeEventListener('resize', this._resizeHandler);
        this._resizeHandler = null;
      }

      // Disconnect visibility observer
      if (this._visibilityObserver) {
        this._visibilityObserver.disconnect();
        this._visibilityObserver = null;
      }

      // Dispose mixer
      if (this.webgl.mixer) {
        this.webgl.mixer.stopAllAction();
        this.webgl.mixer = null;
      }

      // Dispose model
      if (this.webgl.model) {
        this.webgl.model.traverse((child) => {
          if (child.isMesh) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
              if (Array.isArray(child.material)) {
                child.material.forEach(m => m.dispose());
              } else {
                child.material.dispose();
              }
            }
          }
        });
        if (this.webgl.scene) {
          this.webgl.scene.remove(this.webgl.model);
        }
        this.webgl.model = null;
      }

      // Dispose scene objects
      if (this.webgl.scene) {
        while (this.webgl.scene.children.length > 0) {
          const child = this.webgl.scene.children[0];
          this.webgl.scene.remove(child);
        }
        this.webgl.scene = null;
      }

      // Dispose renderer
      if (this.webgl.renderer) {
        this.webgl.renderer.dispose();
        if (this.webgl.renderer.domElement && this.webgl.renderer.domElement.parentNode) {
          this.webgl.renderer.domElement.parentNode.removeChild(this.webgl.renderer.domElement);
        }
        this.webgl.renderer = null;
      }

      // Reset state
      this.webgl.camera = null;
      this.webgl.clock = null;
      this.webgl.loadedModel = null;

      console.log('✅ WebGL resources disposed');
    }

    /**
     * Debug: Log all bones and morph targets in the loaded model
     * Helps identify what's available for lip sync animation
     */
    debugModelStructure() {
      if (!this.webgl?.model) {
        console.warn('⚠️ No model loaded for debugging');
        return;
      }

      const bones = [];
      const morphTargets = [];
      const meshes = [];

      this.webgl.model.traverse((child) => {
        if (child.isBone) {
          bones.push({
            name: child.name,
            parent: child.parent?.name || 'root'
          });
        }

        if (child.isMesh || child.isSkinnedMesh) {
          meshes.push(child.name || 'unnamed');

          if (child.morphTargetDictionary) {
            const targets = Object.keys(child.morphTargetDictionary);
            targets.forEach(t => {
              if (!morphTargets.includes(t)) {
                morphTargets.push(t);
              }
            });
          }
        }
      });

      console.log('=== AVATAR MODEL STRUCTURE ===');
      console.log(`📦 Meshes (${meshes.length}):`, meshes.join(', '));
      console.log(`🦴 Bones (${bones.length}):`, bones.map(b => b.name).join(', '));
      console.log(`🎭 Morph Targets (${morphTargets.length}):`, morphTargets.join(', '));

      // Check for jaw-related bones
      const jawBones = bones.filter(b =>
        b.name.toLowerCase().includes('jaw') ||
        b.name.toLowerCase().includes('mandible')
      );
      if (jawBones.length > 0) {
        console.log(`✅ Found jaw bones:`, jawBones.map(b => b.name).join(', '));
      } else {
        console.warn(`⚠️ No jaw bones found. Available bones for fallback:`, bones.filter(b =>
          b.name.toLowerCase().includes('head') ||
          b.name.toLowerCase().includes('neck')
        ).map(b => b.name).join(', '));
      }

      // Check for mouth-related morph targets
      const mouthMorphs = morphTargets.filter(t =>
        t.toLowerCase().includes('mouth') ||
        t.toLowerCase().includes('jaw') ||
        t.toLowerCase().includes('viseme') ||
        t.toLowerCase().includes('lip')
      );
      if (mouthMorphs.length > 0) {
        console.log(`✅ Found mouth morph targets:`, mouthMorphs.join(', '));
      }

      console.log('=== END MODEL STRUCTURE ===');
    }

    // =========================================================================
    // Lip Sync - Connect TTS audio to avatar mouth movement
    // =========================================================================

    /**
     * Initialize lip sync listener for TTS viseme events
     * Listens to tts:viseme events emitted by tts.js
     */
    initLipSync() {
      console.log('👄 Initializing lip sync listener...');

      // Remove existing listener if any
      if (this._lipSyncHandler) {
        document.removeEventListener('tts:viseme', this._lipSyncHandler);
      }

      // Track viseme event count for debugging
      this._visemeCount = 0;

      this._lipSyncHandler = (event) => {
        const intensity = event.detail?.intensity || 0;
        this._visemeCount++;

        // Log first few viseme events for debugging
        if (this._visemeCount <= 5 || this._visemeCount % 30 === 0) {
          console.log(`👄 Viseme #${this._visemeCount} intensity: ${intensity.toFixed(3)}`);
        }

        this.applyMouthMovement(intensity);
      };

      document.addEventListener('tts:viseme', this._lipSyncHandler);
      console.log('👄 tts:viseme listener registered on document');

      // Also listen for TTS start/end to control animation state
      document.addEventListener('tts:start', () => {
        this._isSpeaking = true;
        this._visemeCount = 0; // Reset count for new speech
        console.log('🎤 TTS started - lip sync active, model loaded:', !!this.webgl?.model);
        // Start random blinks while speaking
        this.addSpeechBlink();
      });

      document.addEventListener('tts:end', () => {
        this._isSpeaking = false;
        console.log(`🎤 TTS ended - received ${this._visemeCount} viseme events`);
        // Reset mouth to closed position
        this.applyMouthMovement(0);
        // Clear blink timeout
        if (this._blinkTimeout) {
          clearTimeout(this._blinkTimeout);
          this._blinkTimeout = null;
        }
      });

      console.log('✅ Lip sync listener initialized (jaw bone rotation)');
    }

    /**
     * ARKit blend shape names for lip sync
     * Ready Player Me exports with these 52 ARKit morph targets
     */
    static ARKIT_VISEMES = {
      // Mouth shapes for speech
      jawOpen: 'jawOpen',
      jawForward: 'jawForward',
      jawLeft: 'jawLeft',
      jawRight: 'jawRight',
      mouthClose: 'mouthClose',
      mouthFunnel: 'mouthFunnel',
      mouthPucker: 'mouthPucker',
      mouthLeft: 'mouthLeft',
      mouthRight: 'mouthRight',
      mouthSmileLeft: 'mouthSmileLeft',
      mouthSmileRight: 'mouthSmileRight',
      mouthFrownLeft: 'mouthFrownLeft',
      mouthFrownRight: 'mouthFrownRight',
      mouthDimpleLeft: 'mouthDimpleLeft',
      mouthDimpleRight: 'mouthDimpleRight',
      mouthStretchLeft: 'mouthStretchLeft',
      mouthStretchRight: 'mouthStretchRight',
      mouthRollLower: 'mouthRollLower',
      mouthRollUpper: 'mouthRollUpper',
      mouthShrugLower: 'mouthShrugLower',
      mouthShrugUpper: 'mouthShrugUpper',
      mouthPressLeft: 'mouthPressLeft',
      mouthPressRight: 'mouthPressRight',
      mouthLowerDownLeft: 'mouthLowerDownLeft',
      mouthLowerDownRight: 'mouthLowerDownRight',
      mouthUpperUpLeft: 'mouthUpperUpLeft',
      mouthUpperUpRight: 'mouthUpperUpRight',
      // Eye shapes (for blink during speech)
      eyeBlinkLeft: 'eyeBlinkLeft',
      eyeBlinkRight: 'eyeBlinkRight'
    };

    /**
     * Apply mouth movement to avatar model based on audio intensity
     * Uses jaw bone rotation (works with no-morph avatar)
     * @param {number} intensity - Audio intensity [0..1]
     */
    applyMouthMovement(intensity) {
      if (!this.webgl?.model) return;

      // Clamp the intensity
      const mouthOpen = Math.min(Math.max(intensity, 0), 1);

      // Track if we found the jaw bone
      let foundJaw = false;

      this.webgl.model.traverse((child) => {
        // Jaw bone rotation (works without morph targets)
        if (child.isBone) {
          const boneName = child.name || '';
          const boneNameLower = boneName.toLowerCase();

          // Log all bones once for debugging
          if (!this._bonesLogged) {
            if (!this._boneNames) this._boneNames = [];
            this._boneNames.push(boneName);
          }

          // Find jaw bone - Ready Player Me/Mixamo uses various naming conventions:
          // "Jaw", "mixamorig:Jaw", "Head_Jaw", "CC_Base_Jaw", "jaw", etc.
          // Also check for "mandible" (anatomical name for jaw)
          if (boneNameLower === 'jaw' ||
              boneNameLower.includes('jaw') ||
              boneNameLower.includes(':jaw') ||
              boneNameLower === 'head_jaw' ||
              boneNameLower === 'cc_base_jaw' ||
              boneNameLower.includes('mandible') ||
              boneNameLower === 'mixamorig:jaw' ||
              boneName === 'Jaw' ||
              boneName === 'mixamorig:Jaw') {
            // Rotate jaw on X-axis: 0 = closed, ~0.3 rad = open
            // Negative X rotation opens the jaw (rotates down)
            child.rotation.x = -mouthOpen * 0.25;
            foundJaw = true;

            // Log jaw movement periodically (not every frame)
            if (!this._lastJawLog || Date.now() - this._lastJawLog > 500) {
              if (mouthOpen > 0.05) {
                console.log(`🦴 Jaw "${boneName}" rotation: ${child.rotation.x.toFixed(3)} (intensity: ${mouthOpen.toFixed(2)})`);
              }
              this._lastJawLog = Date.now();
            }
          }
        }
      });

      // Log all bone names once - ALWAYS log on first call
      if (!this._bonesLogged) {
        if (this._boneNames && this._boneNames.length > 0) {
          console.log('🦴 Avatar bones found:', this._boneNames.join(', '));
        } else {
          console.warn('⚠️ No bones found in avatar model!');
        }
        this._bonesLogged = true;
      }

      // If no jaw bone found, try fallback: animate the entire head slightly
      // This provides SOME visual feedback even without a jaw bone
      if (!foundJaw && !this._headFallbackWarned) {
        console.warn('⚠️ No jaw bone found in avatar. Using head scale fallback for lip sync.');
        this._headFallbackWarned = true;
        this._useHeadFallback = true;
      }

      // Head fallback animation: use multiple techniques for visible movement
      if (!foundJaw && this._useHeadFallback) {
        this.webgl.model.traverse((child) => {
          // Try morph targets first (Ready Player Me may have them even in "no-morph" export)
          if (child.isMesh && child.morphTargetDictionary && child.morphTargetInfluences) {
            const dict = child.morphTargetDictionary;
            const influences = child.morphTargetInfluences;

            // Try various mouth-related morph targets
            const mouthTargets = ['mouthOpen', 'jawOpen', 'viseme_aa', 'viseme_O', 'mouth_open', 'A', 'mouthWide'];
            for (const target of mouthTargets) {
              if (dict[target] !== undefined) {
                influences[dict[target]] = mouthOpen * 0.8;
                foundJaw = true;
                if (!this._morphTargetFound) {
                  console.log(`✅ Found morph target "${target}" for lip sync`);
                  this._morphTargetFound = true;
                }
              }
            }
          }

          // Bone-based head animation as secondary fallback
          if (child.isBone && !foundJaw) {
            const boneName = child.name || '';
            const boneNameLower = boneName.toLowerCase();

            // Find head bone for nod animation
            if (boneNameLower === 'head' ||
                boneNameLower.includes(':head') ||
                boneName === 'Head' ||
                boneName === 'mixamorig:Head') {
              // More visible head movement: slight nod while speaking
              // Use rotation instead of scale for more natural movement
              child.rotation.x = -mouthOpen * 0.08; // Nod forward when mouth opens
              child.rotation.z = Math.sin(Date.now() / 300) * mouthOpen * 0.02; // Slight sway
              foundJaw = true;
            }

            // Try neck bone too
            if (boneNameLower === 'neck' ||
                boneNameLower.includes(':neck') ||
                boneName === 'Neck' ||
                boneName === 'mixamorig:Neck') {
              child.rotation.x = -mouthOpen * 0.03; // Subtle neck movement
            }
          }
        });
      }
    }

    /**
     * Apply specific viseme shape
     * @param {Object} dict - Morph target dictionary
     * @param {Float32Array} influences - Morph target influences
     * @param {string} viseme - Viseme name (aa, ee, ih, oh, ou, etc.)
     * @param {number} intensity - Intensity [0..1]
     */
    applyViseme(dict, influences, viseme, intensity) {
      // Map phonemes to ARKit blend shape combinations
      const visemeMap = {
        // Open vowels (A, ah)
        'aa': { jawOpen: 0.8, mouthFunnel: 0.1 },
        'ah': { jawOpen: 0.7, mouthFunnel: 0.2 },
        // E vowels
        'ee': { jawOpen: 0.3, mouthSmileLeft: 0.4, mouthSmileRight: 0.4 },
        'eh': { jawOpen: 0.4, mouthStretchLeft: 0.3, mouthStretchRight: 0.3 },
        // I vowels
        'ih': { jawOpen: 0.25, mouthSmileLeft: 0.3, mouthSmileRight: 0.3 },
        // O vowels
        'oh': { jawOpen: 0.5, mouthFunnel: 0.5, mouthPucker: 0.3 },
        'oo': { jawOpen: 0.3, mouthPucker: 0.6, mouthFunnel: 0.4 },
        // U vowels
        'ou': { jawOpen: 0.4, mouthPucker: 0.5 },
        // Consonants
        'p': { mouthClose: 0.8, mouthPressLeft: 0.5, mouthPressRight: 0.5 },
        'b': { mouthClose: 0.7, mouthPressLeft: 0.4, mouthPressRight: 0.4 },
        'f': { mouthClose: 0.3, mouthRollLower: 0.5 },
        'v': { mouthClose: 0.2, mouthRollLower: 0.4 },
        'th': { jawOpen: 0.2, mouthShrugLower: 0.3 },
        's': { jawOpen: 0.15, mouthStretchLeft: 0.2, mouthStretchRight: 0.2 },
        'sh': { jawOpen: 0.2, mouthPucker: 0.3 },
        'k': { jawOpen: 0.3, mouthShrugUpper: 0.2 },
        'r': { jawOpen: 0.25, mouthPucker: 0.2 },
        'l': { jawOpen: 0.3, mouthShrugLower: 0.2 },
        'n': { jawOpen: 0.2 },
        'm': { mouthClose: 0.9 },
        // Default/neutral
        'sil': { jawOpen: 0, mouthClose: 0 }
      };

      const shapes = visemeMap[viseme] || visemeMap['aa'];

      for (const [shapeName, weight] of Object.entries(shapes)) {
        if (dict[shapeName] !== undefined) {
          influences[dict[shapeName]] = weight * intensity;
        }
      }
    }

    /**
     * Add random blink during speech for realism
     */
    addSpeechBlink() {
      if (!this.webgl?.model || !this._isSpeaking) return;

      // Random blink every 3-6 seconds while speaking
      const blinkDelay = 3000 + Math.random() * 3000;

      this._blinkTimeout = setTimeout(() => {
        this.performBlink();
        if (this._isSpeaking) {
          this.addSpeechBlink();
        }
      }, blinkDelay);
    }

    /**
     * Perform a single blink animation
     */
    performBlink() {
      if (!this.webgl?.model) return;

      this.webgl.model.traverse((child) => {
        if (!child.isMesh || !child.morphTargetInfluences || !child.morphTargetDictionary) {
          return;
        }

        const dict = child.morphTargetDictionary;
        const influences = child.morphTargetInfluences;

        // Quick blink animation (150ms close, 150ms open)
        if (dict.eyeBlinkLeft !== undefined && dict.eyeBlinkRight !== undefined) {
          // Close eyes
          influences[dict.eyeBlinkLeft] = 1;
          influences[dict.eyeBlinkRight] = 1;

          // Open eyes after 150ms
          setTimeout(() => {
            if (influences) {
              influences[dict.eyeBlinkLeft] = 0;
              influences[dict.eyeBlinkRight] = 0;
            }
          }, 150);
        }
      });
    }

    /**
     * Clean up lip sync listener
     */
    disposeLipSync() {
      if (this._lipSyncHandler) {
        document.removeEventListener('tts:viseme', this._lipSyncHandler);
        this._lipSyncHandler = null;
      }
      this._isSpeaking = false;
    }

    /**
     * Handle stream error
     * @param {Error} error - Error object
     */
    handleStreamError(error) {
      console.error('Stream error:', error);
      this.emitError('stream_error', error.message);

      // Attempt fallback
      this.fallbackToWebGL();
    }

    /**
     * Register tier change callback
     * @param {Function} callback - Callback(newTier, previousTier)
     */
    onTierChange(callback) {
      this.callbacks.onTierChange = callback;
    }

    /**
     * Register connection change callback
     * @param {Function} callback - Callback(isConnected)
     */
    onConnectionChange(callback) {
      this.callbacks.onConnectionChange = callback;
    }

    /**
     * Register error callback
     * @param {Function} callback - Callback(type, message)
     */
    onError(callback) {
      this.callbacks.onError = callback;
    }

    /**
     * Register cost update callback
     * @param {Function} callback - Callback(costCents)
     */
    onCostUpdate(callback) {
      this.callbacks.onCostUpdate = callback;
    }

    /**
     * Emit tier change event
     */
    emitTierChange(newTier, previousTier) {
      if (this.callbacks.onTierChange) {
        this.callbacks.onTierChange(newTier, previousTier);
      }
    }

    /**
     * Emit connection change event
     */
    emitConnectionChange(isConnected) {
      if (this.callbacks.onConnectionChange) {
        this.callbacks.onConnectionChange(isConnected);
      }
    }

    /**
     * Emit error event
     */
    emitError(type, message) {
      if (this.callbacks.onError) {
        this.callbacks.onError(type, message);
      }
    }

    /**
     * Emit cost update event
     */
    emitCostUpdate(costCents) {
      if (this.callbacks.onCostUpdate) {
        this.callbacks.onCostUpdate(costCents);
      }
    }

    /**
     * Get current state
     * @returns {Object}
     */
    getState() {
      return {
        currentTier: this.state.currentTier,
        isConnected: this.state.isConnected,
        bandwidth: this.state.bandwidth,
        sessionCostCents: this.getSessionCost(),
        isProvisioning: this.state.isProvisioning,
        provisioningProgress: this.state.provisioningProgress
      };
    }

    /**
     * Cleanup and destroy
     */
    async destroy() {
      console.log('🗑️ Destroying GPU Streaming...');

      // End session if active
      if (this.state.isConnected) {
        await this.endSession();
      }

      // Stop timers
      this.stopIdleTimer();
      this.stopSessionTimer();

      // Dispose WebGL resources
      this.disposeWebGL();

      // Dispose lip sync listeners
      this.disposeLipSync();

      // Remove stream container
      if (this.streamContainer && this.streamContainer.parentNode) {
        this.streamContainer.parentNode.removeChild(this.streamContainer);
        this.streamContainer = null;
      }

      console.log('✅ GPU Streaming destroyed');
    }
  }

  // Export tier definitions
  GPUStreaming.TIERS = TIERS;
  GPUStreaming.REGIONS = GPU_REGIONS;

  // Export to window
  window.GPUStreaming = GPUStreaming;

  // Factory function
  window.createGPUStreaming = async function(avatarFrameElement, config = {}) {
    const gpuStreaming = new GPUStreaming(config);
    await gpuStreaming.init(avatarFrameElement);
    // Export globally for TTS lip sync integration
    window.gpuStreaming = gpuStreaming;
    return gpuStreaming;
  };

  console.log('✅ GPUStreaming module loaded (v2.0.0 - RunPod GPU + Ready Player Me tutor avatar)');

})(window);
