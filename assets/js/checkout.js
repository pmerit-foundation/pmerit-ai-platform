/**
 * PMERIT Checkout Integration
 * Stripe Payment Processing - Frontend
 *
 * GAP-C8 Phase 3: Frontend Checkout Integration
 * Created: 2026-01-10 (Session 7)
 *
 * SECURITY:
 * - Only publishable key used in frontend (pk_live_...)
 * - All sensitive operations handled by backend
 * - Never expose secret keys in frontend code
 *
 * Usage:
 * 1. Include Stripe.js: <script src="https://js.stripe.com/v3/"></script>
 * 2. Include this file: <script src="/assets/js/checkout.js"></script>
 * 3. Call PMERITCheckout.subscribe(priceId) or PMERITCheckout.donate(amount)
 */

(function() {
  'use strict';

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  const CONFIG = {
    // API Base URL
    API_BASE: window.location.hostname === 'localhost'
      ? 'http://localhost:8787'
      : 'https://api.pmerit.com',

    // Stripe Publishable Key (Live)
    STRIPE_PUBLISHABLE_KEY: 'pk_live_51SfjNn1Uy2Gsjci2z7mdDxheSQCtVESBHHa6ha1MjhHI0MK8BERvkgBezle3pZKLTYBauvSUtYVCA8UQZGZ3qNui00xzpcTCpD',

    // Price IDs from Stripe Dashboard
    // TODO: Replace with actual Price IDs after creating products
    PRICES: {
      PREMIUM_INDIVIDUAL_MONTHLY: 'price_PLACEHOLDER_individual',
      PREMIUM_FAMILY_MONTHLY: 'price_PLACEHOLDER_family',
      PREMIUM_ANNUAL: 'price_PLACEHOLDER_annual',
    },

    // Minimum donation amount
    MIN_DONATION: 1,
    MAX_DONATION: 10000,
  };

  // Stripe instance (initialized on first use)
  let stripe = null;

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize Stripe.js
   */
  function initStripe() {
    if (stripe) return stripe;

    if (typeof Stripe === 'undefined') {
      console.error('[Checkout] Stripe.js not loaded. Include: <script src="https://js.stripe.com/v3/"></script>');
      return null;
    }

    stripe = Stripe(CONFIG.STRIPE_PUBLISHABLE_KEY);
    return stripe;
  }

  /**
   * Get authentication token from storage
   */
  function getAuthToken() {
    // Try localStorage first (persistent), then sessionStorage
    return localStorage.getItem('pmerit_token') || sessionStorage.getItem('pmerit_token');
  }

  /**
   * Get current user email from storage or global
   */
  function getCurrentUserEmail() {
    // Check various sources for user email
    if (window.PMERIT_USER?.email) return window.PMERIT_USER.email;
    if (window.currentUser?.email) return window.currentUser.email;

    const storedUser = localStorage.getItem('pmerit_user');
    if (storedUser) {
      try {
        const parsed = JSON.parse(storedUser);
        return parsed.email || null;
      } catch {
        return null;
      }
    }

    return null;
  }

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  /**
   * Show error message to user
   */
  function showError(message) {
    // Try to use existing notification system
    if (typeof window.showNotification === 'function') {
      window.showNotification(message, 'error');
      return;
    }

    // Fallback to alert
    alert(message);
  }

  /**
   * Show loading state on button
   */
  function setButtonLoading(button, loading) {
    if (!button) return;

    if (loading) {
      button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    } else {
      button.disabled = false;
      button.textContent = button.dataset.originalText || 'Subscribe';
    }
  }

  // ============================================================================
  // SUBSCRIPTION CHECKOUT
  // ============================================================================

  /**
   * Start subscription checkout flow
   * @param {string} priceId - Stripe Price ID
   * @param {HTMLElement} [button] - Optional button element for loading state
   */
  async function subscribe(priceId, button = null) {
    console.log('[Checkout] Starting subscription checkout:', priceId);

    if (!initStripe()) {
      showError('Payment system unavailable. Please refresh and try again.');
      return;
    }

    if (button) setButtonLoading(button, true);

    try {
      const headers = {
        'Content-Type': 'application/json',
      };

      // Add auth token if available
      const token = getAuthToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${CONFIG.API_BASE}/api/v1/payments/checkout`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          priceId,
          mode: 'subscription',
          successUrl: `${window.location.origin}/dashboard?payment=success`,
          cancelUrl: `${window.location.origin}/pricing?payment=cancelled`,
          customerEmail: getCurrentUserEmail(),
        }),
      });

      const data = await response.json();

      if (!data.success || !data.url) {
        throw new Error(data.error || 'Failed to create checkout session');
      }

      console.log('[Checkout] Redirecting to Stripe:', data.sessionId);

      // Redirect to Stripe Checkout
      window.location.href = data.url;

    } catch (error) {
      console.error('[Checkout] Error:', error);
      showError(error.message || 'Unable to start checkout. Please try again.');
    } finally {
      if (button) setButtonLoading(button, false);
    }
  }

  // ============================================================================
  // DONATION CHECKOUT
  // ============================================================================

  /**
   * Start donation checkout flow
   * @param {number} amount - Donation amount in dollars
   * @param {Object} [options] - Optional donor info
   * @param {HTMLElement} [button] - Optional button element for loading state
   */
  async function donate(amount, options = {}, button = null) {
    console.log('[Checkout] Starting donation checkout: $' + amount);

    // Validate amount
    if (!amount || amount < CONFIG.MIN_DONATION) {
      showError(`Minimum donation is $${CONFIG.MIN_DONATION}`);
      return;
    }

    if (amount > CONFIG.MAX_DONATION) {
      showError(`For donations over $${CONFIG.MAX_DONATION.toLocaleString()}, please contact us directly.`);
      return;
    }

    if (button) setButtonLoading(button, true);

    try {
      const response = await fetch(`${CONFIG.API_BASE}/api/v1/payments/donate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount,
          email: options.email || getCurrentUserEmail(),
          name: options.name || 'Anonymous',
          message: options.message || '',
        }),
      });

      const data = await response.json();

      if (!data.success || !data.url) {
        throw new Error(data.error || 'Failed to create donation session');
      }

      console.log('[Checkout] Redirecting to Stripe for donation');

      // Redirect to Stripe Checkout
      window.location.href = data.url;

    } catch (error) {
      console.error('[Checkout] Donation error:', error);
      showError(error.message || 'Unable to process donation. Please try again.');
    } finally {
      if (button) setButtonLoading(button, false);
    }
  }

  // ============================================================================
  // CUSTOMER PORTAL
  // ============================================================================

  /**
   * Open Stripe Customer Portal for subscription management
   * @param {HTMLElement} [button] - Optional button element for loading state
   */
  async function openPortal(button = null) {
    console.log('[Checkout] Opening customer portal');

    const token = getAuthToken();
    if (!token) {
      showError('Please sign in to manage your subscription.');
      window.location.href = '/signin?redirect=/account';
      return;
    }

    if (button) setButtonLoading(button, true);

    try {
      const response = await fetch(`${CONFIG.API_BASE}/api/v1/payments/portal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          returnUrl: `${window.location.origin}/account`,
        }),
      });

      const data = await response.json();

      if (!data.success || !data.url) {
        throw new Error(data.error || 'Failed to open customer portal');
      }

      // Redirect to Stripe Customer Portal
      window.location.href = data.url;

    } catch (error) {
      console.error('[Checkout] Portal error:', error);
      showError(error.message || 'Unable to open subscription portal. Please try again.');
    } finally {
      if (button) setButtonLoading(button, false);
    }
  }

  // ============================================================================
  // SUBSCRIPTION STATUS
  // ============================================================================

  /**
   * Get current user's subscription status
   * @returns {Promise<Object>} Subscription info
   */
  async function getSubscriptionStatus() {
    const token = getAuthToken();
    if (!token) {
      return { status: 'free', plan: null, hasStripeAccount: false };
    }

    try {
      const response = await fetch(`${CONFIG.API_BASE}/api/v1/payments/subscription`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error);
      }

      return data.subscription;

    } catch (error) {
      console.error('[Checkout] Get subscription error:', error);
      return { status: 'free', plan: null, hasStripeAccount: false };
    }
  }

  // ============================================================================
  // URL PARAMETER HANDLING
  // ============================================================================

  /**
   * Handle payment result from URL parameters
   * Shows success/error message based on ?payment= parameter
   */
  function handlePaymentResult() {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get('payment');

    if (!paymentStatus) return;

    // Remove the parameter from URL
    urlParams.delete('payment');
    const newUrl = urlParams.toString()
      ? `${window.location.pathname}?${urlParams.toString()}`
      : window.location.pathname;
    window.history.replaceState({}, '', newUrl);

    // Show appropriate message
    if (paymentStatus === 'success') {
      if (typeof window.showNotification === 'function') {
        window.showNotification('Payment successful! Thank you for supporting PMERIT.', 'success');
      } else {
        alert('Payment successful! Thank you for supporting PMERIT.');
      }
    } else if (paymentStatus === 'cancelled') {
      if (typeof window.showNotification === 'function') {
        window.showNotification('Payment was cancelled. You have not been charged.', 'info');
      }
      // Don't show alert for cancellation - user chose to cancel
    }
  }

  // ============================================================================
  // AUTO-INITIALIZATION
  // ============================================================================

  /**
   * Auto-wire subscription buttons on page load
   * Looks for [data-subscribe-price] attributes
   */
  function initializeButtons() {
    // Subscribe buttons
    document.querySelectorAll('[data-subscribe-price]').forEach(button => {
      button.addEventListener('click', function(e) {
        e.preventDefault();
        const priceId = this.dataset.subscribePrice;
        subscribe(priceId, this);
      });
    });

    // Donate buttons
    document.querySelectorAll('[data-donate-amount]').forEach(button => {
      button.addEventListener('click', function(e) {
        e.preventDefault();
        const amount = parseFloat(this.dataset.donateAmount);
        donate(amount, {}, this);
      });
    });

    // Portal buttons
    document.querySelectorAll('[data-open-portal]').forEach(button => {
      button.addEventListener('click', function(e) {
        e.preventDefault();
        openPortal(this);
      });
    });
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      handlePaymentResult();
      initializeButtons();
    });
  } else {
    handlePaymentResult();
    initializeButtons();
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  window.PMERITCheckout = {
    // Configuration
    CONFIG,

    // Methods
    subscribe,
    donate,
    openPortal,
    getSubscriptionStatus,

    // Utils
    initStripe,
    handlePaymentResult,
  };

  console.log('[PMERIT Checkout] Initialized. Use PMERITCheckout.subscribe(priceId) or PMERITCheckout.donate(amount)');

})();
