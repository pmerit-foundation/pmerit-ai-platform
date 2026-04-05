/**
 * PMERIT Platform Configuration
 * Phase 1: Environment detection and config management
 * Last Updated: October 2025
 *
 * This file must be loaded before all other application scripts.
 */

(function () {
  'use strict';

  // Detect environment based on hostname
  function detectEnvironment() {
    const hostname = window.location.hostname;

    // Development: localhost or 127.0.0.1
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'development';
    }

    // Staging: Cloudflare Pages preview URLs (*.pages.dev)
    if (hostname.includes('.pages.dev')) {
      return 'staging';
    }

    // Production: everything else (pmerit.com, etc.)
    return 'production';
  }

  // Configuration object
  const env = detectEnvironment();

  // API Base URL - Use actual backend in production
  const API_BASE_URL = env === 'development'
    ? 'http://localhost:8787'  // Local wrangler dev server
    : 'https://api.pmerit.com';

  const config = {
    ENV: env,

    // AI Chat URL (current)
    AI_CHAT_URL: 'https://pmerit-ai-chat.openai.azure.com',

    // Full API base URL (root)
    API_BASE_URL: API_BASE_URL,

    // API base with version path (for convenience) - used by admin pages
    API_BASE: `${API_BASE_URL}/api/v1`,

    // App version
    VERSION: '2.2.0'
  };

  // Make config globally available
  window.CONFIG = Object.freeze(config);

  // Avatar configuration (Phase 5)
  window.PMERIT = window.PMERIT || {};
  
  // Ensure AVATAR_BASE_URL always has trailing slash
  // NOTE: Avatar files are in /assets/models/avatars/ NOT /assets/avatars/
  let avatarBaseUrl = window.PMERIT.AVATAR_BASE_URL || '/assets/models/avatars/';
  if (!avatarBaseUrl.endsWith('/')) {
    avatarBaseUrl += '/';
  }

  window.PMERIT.AVATAR_BASE_URL = avatarBaseUrl;
  // Use Ready Player Me avatar with jaw bone animation (no morph targets)
  // See SCOPE_AVATAR.md decision AV-003
  window.PMERIT.AVATAR_MODEL = window.PMERIT.AVATAR_MODEL || 'pmerit-tutor-no-morph.glb';
  window.PMERIT.AVATAR_SCALE = window.PMERIT.AVATAR_SCALE || 1.0;
  window.PMERIT.CAMERA_POS = window.PMERIT.CAMERA_POS || [0, 1.4, 2.2];
  window.PMERIT.LIGHT_PRESET = window.PMERIT.LIGHT_PRESET || 'hemi-dir-soft';

  // Log environment in development
  if (config.ENV === 'development') {
    logger.debug('🔧 PMERIT Config loaded:', config);
  }
})();
