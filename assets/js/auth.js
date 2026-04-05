/**
 * PMERIT Authentication Module
 * Last Updated: December 2025
 *
 * This module provides authentication via the PMERIT API backend.
 * Uses real API calls to /api/v1/auth/* endpoints.
 * Falls back to mock implementation if API is unavailable (offline mode).
 */

(function () {
  'use strict';

  // API Configuration
  const API_BASE = 'https://api.pmerit.com/api/v1';
  const USE_MOCK_FALLBACK = true; // Set to false to disable mock fallback

  // Session configuration (GAP-1: 24 hour max session)
  const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

  // Token management utilities with session expiration
  const TokenManager = {
    getToken: () => {
      // Check if session has expired
      const expiry = localStorage.getItem('pmerit_session_expiry');
      if (expiry && Date.now() > parseInt(expiry, 10)) {
        // Session expired - clear everything
        TokenManager.clear();
        return null;
      }
      return localStorage.getItem('pmerit_token');
    },

    setToken: (token) => {
      localStorage.setItem('pmerit_token', token);
      // Set session expiry (24 hours from now)
      localStorage.setItem('pmerit_session_expiry', (Date.now() + SESSION_MAX_AGE_MS).toString());
    },

    removeToken: () => localStorage.removeItem('pmerit_token'),

    getUser: () => {
      // Check session expiry before returning user
      const expiry = localStorage.getItem('pmerit_session_expiry');
      if (expiry && Date.now() > parseInt(expiry, 10)) {
        TokenManager.clear();
        return null;
      }
      try {
        const userJson = localStorage.getItem('pmerit_user');
        return userJson ? JSON.parse(userJson) : null;
      } catch (e) {
        console.error('Error parsing user data:', e);
        return null;
      }
    },

    setUser: (user) => localStorage.setItem('pmerit_user', JSON.stringify(user)),
    removeUser: () => localStorage.removeItem('pmerit_user'),

    clear: () => {
      localStorage.removeItem('pmerit_token');
      localStorage.removeItem('pmerit_user');
      localStorage.removeItem('pmerit_session_expiry');
    },

    // Check if session is still valid (not expired)
    isSessionValid: () => {
      const expiry = localStorage.getItem('pmerit_session_expiry');
      if (!expiry) return false;
      return Date.now() < parseInt(expiry, 10);
    },

    // Get remaining session time in milliseconds
    getSessionTimeRemaining: () => {
      const expiry = localStorage.getItem('pmerit_session_expiry');
      if (!expiry) return 0;
      const remaining = parseInt(expiry, 10) - Date.now();
      return remaining > 0 ? remaining : 0;
    }
  };

  const AUTH = {
    /**
     * Sign in a user
     * @param {string} email - User email
     * @param {string} password - User password
     * @returns {Promise<{success: boolean, message: string, user?: object}>}
     */
    signin: async function (email, password) {
      // Basic validation
      if (!email || !password) {
        return { success: false, message: 'Email and password are required' };
      }

      if (password.length < 6) {
        return { success: false, message: 'Password must be at least 6 characters' };
      }

      try {
        const response = await fetch(`${API_BASE}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (data.success) {
          // Store token
          TokenManager.setToken(data.token);

          // Store user data - normalize to always use 'id' property
          const userData = data.user || {};
          const user = {
            id: userData.userId || userData.id || data.userId,
            email: userData.email || email,
            firstName: userData.firstName || data.firstName || email.split('@')[0],
            lastName: userData.lastName || data.lastName || 'User',
            emailVerified: userData.emailVerified || data.emailVerified || false,
            role: userData.role || 'user',  // Admin role: tier1_admin, tier2_admin, or user
            subscriptionTier: userData.subscriptionTier || 'basic',
            // K-12 specific fields (from /auth/me or login)
            isMinor: userData.isMinor || false,
            accountType: userData.accountType || 'adult',  // 'adult' or 'k12'
            gradeCode: userData.gradeCode || null,
            uiType: userData.uiType || null,
            personaOverride: userData.personaOverride || null,
            // Dashboard routing (from backend grade-based routing)
            dashboardUrl: data.redirect_url || '/dashboard.html'
          };
          TokenManager.setUser(user);

          // H7 Language Propagation: Sync language preference from database
          this._syncLanguageFromDatabase(data.token);

          return {
            success: true,
            message: 'Signed in successfully',
            user: user,
            redirect_url: data.redirect_url || null  // Grade-based routing from backend
          };
        }

        return {
          success: false,
          message: data.message || 'Invalid email or password',
          error: data.error || null,
          remainingAttempts: data.remainingAttempts
        };
      } catch (error) {
        console.error('Sign in error:', error);

        // Fallback to mock if enabled and network fails
        if (USE_MOCK_FALLBACK) {
          console.warn('API unavailable, using mock sign in');
          return this._mockSignin(email, password);
        }

        return {
          success: false,
          message: 'Network error. Please check your connection and try again.'
        };
      }
    },

    /**
     * Mock signin fallback (offline mode)
     * @private
     */
    _mockSignin: function (email, password) {
      const user = {
        id: 'mock-user-' + Date.now(),
        email: email,
        firstName: email.split('@')[0],
        lastName: 'User',
        emailVerified: true,
        createdAt: new Date().toISOString()
      };

      TokenManager.setToken('mock-token-' + Date.now());
      TokenManager.setUser(user);

      return {
        success: true,
        message: 'Signed in (offline mode)',
        user: user
      };
    },

    /**
     * H7 Language Propagation: Sync language preference from database on login
     * Runs in background (non-blocking) to update localStorage with DB preference
     * @private
     */
    _syncLanguageFromDatabase: async function (token) {
      try {
        const response = await fetch(`${API_BASE}/user/preferences`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          console.warn('[Auth] Language sync failed:', response.status);
          return;
        }

        const prefs = await response.json();

        if (prefs.preferred_language && prefs.preferred_language !== 'en') {
          // Sync DB preference to localStorage
          const currentLang = localStorage.getItem('pmerit_language');

          if (currentLang !== prefs.preferred_language) {
            console.log(`[Auth] Syncing language from DB: ${prefs.preferred_language}`);
            localStorage.setItem('pmerit_language', prefs.preferred_language);

            // Apply translations if LanguageManager is available
            if (window.LanguageManager && typeof window.LanguageManager.setLanguage === 'function') {
              window.LanguageManager.setLanguage(prefs.preferred_language);
            }
          }
        }
      } catch (error) {
        console.warn('[Auth] Language sync error (non-critical):', error);
        // Non-blocking - user can still use localStorage language
      }
    },

    /**
     * Sign up a new user
     * @param {string} email - User email
     * @param {string} password - User password
     * @param {string} firstName - User first name
     * @param {string} lastName - User last name
     * @returns {Promise<{success: boolean, message: string, user?: object, requiresVerification?: boolean}>}
     */
    signup: async function (email, password, firstName, lastName) {
      // Basic validation
      if (!email || !password || !firstName || !lastName) {
        return { success: false, message: 'All fields are required' };
      }

      // Password strength validation (matches backend requirements)
      const passwordErrors = [];
      if (password.length < 8) {
        passwordErrors.push('at least 8 characters');
      }
      if (!/[A-Z]/.test(password)) {
        passwordErrors.push('one uppercase letter');
      }
      if (!/[a-z]/.test(password)) {
        passwordErrors.push('one lowercase letter');
      }
      if (!/[0-9]/.test(password)) {
        passwordErrors.push('one number');
      }
      if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
        passwordErrors.push('one special character');
      }
      if (passwordErrors.length > 0) {
        return { success: false, message: `Password must include: ${passwordErrors.join(', ')}` };
      }

      try {
        const response = await fetch(`${API_BASE}/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, firstName, lastName })
        });

        const data = await response.json();

        if (data.success) {
          // Store token and user data
          if (data.token) {
            TokenManager.setToken(data.token);
          }

          const user = {
            id: data.userId,
            email: email,
            firstName: firstName,
            lastName: lastName,
            emailVerified: false,
            createdAt: new Date().toISOString()
          };
          TokenManager.setUser(user);

          return {
            success: true,
            message: data.message || 'Account created successfully. Please check your email for verification.',
            user: user,
            requiresVerification: true,
            verificationCode: data.verificationCode // For development/testing only
          };
        }

        return {
          success: false,
          message: data.message || 'Registration failed. Please try again.'
        };
      } catch (error) {
        console.error('Registration error:', error);

        // Fallback to mock if enabled and network fails
        if (USE_MOCK_FALLBACK) {
          console.warn('API unavailable, using mock registration');
          return this._mockSignup(email, password, firstName, lastName);
        }

        return {
          success: false,
          message: 'Network error. Please check your connection and try again.'
        };
      }
    },

    /**
     * Mock signup fallback (offline mode)
     * @private
     */
    _mockSignup: function (email, password, firstName, lastName) {
      const user = {
        id: 'mock-user-' + Date.now(),
        email: email,
        firstName: firstName,
        lastName: lastName,
        emailVerified: true, // Mock users are auto-verified
        createdAt: new Date().toISOString()
      };

      TokenManager.setToken('mock-token-' + Date.now());
      TokenManager.setUser(user);

      return {
        success: true,
        message: 'Account created (offline mode)',
        user: user,
        requiresVerification: false
      };
    },

    /**
     * Log out the current user
     * @param {boolean} redirect - Whether to redirect after logout (default: true)
     */
    logout: async function (redirect = true) {
      const token = TokenManager.getToken();

      // Clear local auth data first
      TokenManager.clear();

      // Optionally call backend to invalidate token
      if (token && !token.startsWith('mock-')) {
        try {
          await fetch(`${API_BASE}/auth/logout`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            }
          });
        } catch (error) {
          // Ignore logout errors - local data already cleared
          console.warn('Backend logout failed:', error);
        }
      }

      // Redirect to home page
      if (redirect) {
        window.location.href = '/';
      }
    },

    /**
     * Check if user is authenticated
     * @returns {boolean}
     */
    isAuthenticated: function () {
      const token = TokenManager.getToken();
      const user = TokenManager.getUser();
      return !!(token && user);
    },

    /**
     * Get current authenticated user from localStorage
     * @returns {object|null}
     */
    getCurrentUser: function () {
      return TokenManager.getUser();
    },

    /**
     * Fetch current user from backend API
     * Validates token and returns fresh user data
     * @returns {Promise<{success: boolean, user?: object, message?: string}>}
     */
    fetchCurrentUser: async function () {
      const token = TokenManager.getToken();

      if (!token) {
        return { success: false, message: 'Not authenticated' };
      }

      // Mock tokens don't need backend validation
      if (token.startsWith('mock-')) {
        const user = TokenManager.getUser();
        return user
          ? { success: true, user: user }
          : { success: false, message: 'No user data' };
      }

      try {
        const response = await fetch(`${API_BASE}/auth/me`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        const data = await response.json();

        if (data.success && data.user) {
          // Update local user data with fresh data from server
          TokenManager.setUser(data.user);
          return { success: true, user: data.user };
        }

        // Token invalid or expired - clear auth
        if (response.status === 401) {
          TokenManager.clear();
        }

        return {
          success: false,
          message: data.message || 'Failed to fetch user data'
        };
      } catch (error) {
        console.error('Fetch user error:', error);
        return {
          success: false,
          message: 'Network error'
        };
      }
    },

    /**
     * Verify email with code
     * @param {string} email - User email
     * @param {string} code - 6-digit verification code
     * @returns {Promise<{success: boolean, message: string}>}
     */
    verifyEmail: async function (email, code) {
      try {
        const response = await fetch(`${API_BASE}/auth/verify-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, code })
        });

        const data = await response.json();

        if (data.success) {
          // Update local user data to reflect verified status
          const user = TokenManager.getUser();
          if (user) {
            user.emailVerified = true;
            TokenManager.setUser(user);
          }
        }

        return {
          success: data.success,
          message: data.message || (data.success ? 'Email verified!' : 'Verification failed')
        };
      } catch (error) {
        console.error('Email verification error:', error);
        return {
          success: false,
          message: 'Network error. Please try again.'
        };
      }
    },

    /**
     * Resend verification email
     * @param {string} email - User email
     * @returns {Promise<{success: boolean, message: string}>}
     */
    resendVerification: async function (email) {
      try {
        const response = await fetch(`${API_BASE}/auth/resend-verification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });

        const data = await response.json();
        return {
          success: data.success,
          message: data.message || (data.success ? 'Verification email sent!' : 'Failed to send email')
        };
      } catch (error) {
        console.error('Resend verification error:', error);
        return {
          success: false,
          message: 'Network error. Please try again.'
        };
      }
    },

    /**
     * Request password reset
     * @param {string} email - User email
     * @returns {Promise<{success: boolean, message: string}>}
     */
    forgotPassword: async function (email) {
      try {
        const response = await fetch(`${API_BASE}/auth/forgot-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });

        const data = await response.json();
        return {
          success: data.success,
          message: data.message || 'If an account exists, a reset code has been sent.'
        };
      } catch (error) {
        console.error('Forgot password error:', error);
        return {
          success: false,
          message: 'Network error. Please try again.'
        };
      }
    },

    /**
     * Reset password with code
     * @param {string} email - User email
     * @param {string} code - Reset code
     * @param {string} newPassword - New password
     * @returns {Promise<{success: boolean, message: string}>}
     */
    resetPassword: async function (email, code, newPassword) {
      if (newPassword.length < 6) {
        return { success: false, message: 'Password must be at least 6 characters' };
      }

      try {
        const response = await fetch(`${API_BASE}/auth/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, code, newPassword })
        });

        const data = await response.json();
        return {
          success: data.success,
          message: data.message || (data.success ? 'Password reset successful!' : 'Reset failed')
        };
      } catch (error) {
        console.error('Reset password error:', error);
        return {
          success: false,
          message: 'Network error. Please try again.'
        };
      }
    },

    /**
     * Get the authentication token
     * @returns {string|null}
     */
    getToken: function () {
      return TokenManager.getToken();
    },

    /**
     * Get the user's dashboard URL based on their account type and grade
     * Returns grade-appropriate K-12 dashboard for students, parent dashboard for parents,
     * admin portal for admins, or default dashboard for adults
     * @returns {string} Dashboard URL
     */
    getDashboardUrl: function () {
      const user = TokenManager.getUser();
      if (!user) {
        return '/dashboard.html'; // Default fallback
      }

      // Use stored dashboardUrl if available (from login response)
      if (user.dashboardUrl) {
        return user.dashboardUrl;
      }

      // Fallback: compute from user data
      // Admin users
      if (user.role === 'tier1_admin' || user.role === 'tier2_admin' || user.role === 'admin') {
        return '/admin/tier2.html';
      }

      // Parent users
      if (user.accountType === 'parent') {
        return '/portal/parent-dashboard.html';
      }

      // K-12 students (have grade code)
      if (user.gradeCode) {
        const gradeCode = user.gradeCode;
        if (['K', '1', '2'].includes(gradeCode)) {
          return '/portal/k12-dashboard-k2.html';
        }
        if (['3', '4', '5'].includes(gradeCode)) {
          return '/portal/k12-dashboard-35.html';
        }
        if (['6', '7', '8'].includes(gradeCode)) {
          return '/portal/k12-dashboard-68.html';
        }
        if (['9', '10', '11', '12'].includes(gradeCode)) {
          return '/portal/k12-dashboard-912.html';
        }
      }

      // Default: Adult dashboard
      return '/dashboard.html';
    }
  };

  // Make AUTH globally available
  window.AUTH = AUTH;

  // Log auth module initialization
  console.log('🔐 PMERIT Auth module loaded (API: ' + API_BASE + ')');
})();
