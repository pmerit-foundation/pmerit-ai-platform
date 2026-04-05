/**
 * PMERIT Auth Modal Controller
 * Version: 1.0
 * Last Updated: October 25, 2025
 *
 * Manages the Auth Modal component with Sign Up and Sign In tabs
 * Features: Tab switching, form handling, focus management, accessibility
 */

(function () {
  'use strict';

  // Ensure logger is available (fallback if logger.js hasn't loaded yet)
  if (typeof window.logger === 'undefined') {
    window.logger = {
      debug: function() {},
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console)
    };
  }
  const logger = window.logger;

  const AuthModal = {
    modal: null,
    backdrop: null,
    closeButton: null,
    signupTab: null,
    signinTab: null,
    signupPanel: null,
    signinPanel: null,
    signupForm: null,
    signinForm: null,
    previousFocus: null,
    isOpen: false,
    currentTab: 'signup',
    currentSignupStep: 'step1', // step1, adult, child
    accountType: 'adult', // adult or child

    /**
     * Initialize the Auth Modal
     */
    init: function () {
      // Get modal elements
      this.modal = document.getElementById('auth-modal');

      if (!this.modal) {
        console.warn('AuthModal: Modal element not found. Include partials/auth-modal.html');
        return;
      }

      this.backdrop = this.modal.querySelector('.auth-modal-backdrop');
      this.closeButton = this.modal.querySelector('.auth-modal-close');
      this.signupTab = document.getElementById('signup-tab');
      this.signinTab = document.getElementById('signin-tab');
      this.signupPanel = document.getElementById('signup-panel');
      this.signinPanel = document.getElementById('signin-panel');
      this.signupForm = document.getElementById('signup-form');
      this.signinForm = document.getElementById('signin-form');

      // Bind event listeners
      this.bindEvents();

      // Check for URL parameter to auto-open
      this.checkAutoOpen();

      // eslint-disable-next-line no-console
      logger.debug('✅ AuthModal initialized');
    },

    /**
     * Bind all event listeners
     */
    bindEvents: function () {
      // Close button
      if (this.closeButton) {
        this.closeButton.addEventListener('click', () => this.close());
      }

      // Backdrop click
      if (this.backdrop) {
        this.backdrop.addEventListener('click', (e) => {
          if (e.target === this.backdrop) {
            this.close();
          }
        });
      }

      // ESC key
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isOpen) {
          this.close();
        }
      });

      // Tab switching
      if (this.signupTab) {
        this.signupTab.addEventListener('click', () => this.switchTab('signup'));
      }
      if (this.signinTab) {
        this.signinTab.addEventListener('click', () => this.switchTab('signin'));
      }

      // Tab switch links
      const switchLinks = this.modal.querySelectorAll('[data-switch-to]');
      switchLinks.forEach(link => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const targetTab = link.getAttribute('data-switch-to');
          this.switchTab(targetTab);
        });
      });

      // Form submissions
      if (this.signupForm) {
        this.signupForm.addEventListener('submit', (e) => this.handleSignup(e));
      }
      if (this.signinForm) {
        this.signinForm.addEventListener('submit', (e) => this.handleSignin(e));
      }

      // Password toggle buttons
      const passwordToggles = this.modal.querySelectorAll('.password-toggle');
      passwordToggles.forEach(toggle => {
        toggle.addEventListener('click', (e) => {
          e.preventDefault();
          const targetId = toggle.getAttribute('data-target');
          const input = document.getElementById(targetId);
          if (input) {
            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            const icon = toggle.querySelector('i');
            if (icon) {
              icon.className = isPassword ? 'fas fa-eye-slash' : 'fas fa-eye';
            }
          }
        });
      });

      // Keyboard navigation for tabs
      if (this.signupTab && this.signinTab) {
        this.signupTab.addEventListener('keydown', (e) => this.handleTabKeyboard(e, 'signup'));
        this.signinTab.addEventListener('keydown', (e) => this.handleTabKeyboard(e, 'signin'));
      }

      // K-12 Multi-step form navigation
      this.bindK12FormEvents();
    },

    /**
     * Bind K-12 multi-step form events
     */
    bindK12FormEvents: function () {
      console.log('🔐 bindK12FormEvents called, modal:', !!this.modal);
      // DEBUG: Uncomment alert below if console.log isn't showing
      // alert('bindK12FormEvents running - modal found: ' + !!this.modal);

      // Account type checkboxes (single-select behavior)
      const accountTypeCheckboxes = this.modal?.querySelectorAll('.account-type-checkbox');
      const accountTypeCards = this.modal?.querySelectorAll('.account-type-card');
      console.log('🔐 Found checkboxes:', accountTypeCheckboxes?.length, 'cards:', accountTypeCards?.length);

      accountTypeCheckboxes?.forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
          const selectedValue = e.target.value;

          // Uncheck all other checkboxes and remove selected class
          accountTypeCheckboxes.forEach(cb => {
            if (cb !== e.target) {
              cb.checked = false;
              cb.closest('.account-type-option')?.querySelector('.account-type-card')?.classList.remove('selected');
            }
          });

          // Ensure clicked checkbox stays checked
          e.target.checked = true;
          e.target.closest('.account-type-option')?.querySelector('.account-type-card')?.classList.add('selected');

          this.accountType = selectedValue;
        });
      });

      // Also handle card clicks for better UX
      accountTypeCards?.forEach(card => {
        card.addEventListener('click', () => {
          const checkbox = card.closest('.account-type-option')?.querySelector('.account-type-checkbox');
          if (checkbox && !checkbox.checked) {
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
      });

      // Continue button (step 1 -> step 2)
      const nextStepBtn = this.modal?.querySelector('#signup-next-step');
      console.log('🔐 Continue button found:', !!nextStepBtn, nextStepBtn);
      if (nextStepBtn) {
        nextStepBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log('🔐 Continue clicked, accountType:', this.accountType);
          this.goToSignupStep(this.accountType === 'child' ? 'child' : 'adult');
        });
      } else {
        console.warn('🔐 Continue button NOT found! Check if modal HTML is loaded.');
      }

      // Back buttons
      const backButtons = this.modal?.querySelectorAll('.back-to-step1');
      backButtons?.forEach(btn => {
        btn.addEventListener('click', () => {
          this.goToSignupStep('step1');
        });
      });

      // Set max date for DOB (today)
      const dobInput = document.getElementById('child-dob');
      if (dobInput) {
        const today = new Date().toISOString().split('T')[0];
        dobInput.setAttribute('max', today);
      }
    },

    /**
     * Navigate between signup steps
     */
    goToSignupStep: function (step) {
      console.log('🔐 goToSignupStep called with:', step);
      this.currentSignupStep = step;

      // Hide all steps using inline style with !important (more reliable than CSS classes)
      const allSteps = this.modal?.querySelectorAll('.signup-step');
      console.log('🔐 Found signup steps:', allSteps?.length);
      allSteps?.forEach(s => {
        s.style.setProperty('display', 'none', 'important');
        s.classList.remove('active');
      });

      // Show target step
      const stepMap = {
        'step1': 'signup-step-1',
        'adult': 'signup-step-adult',
        'child': 'signup-step-child'
      };

      const targetStep = document.getElementById(stepMap[step]);
      if (targetStep) {
        targetStep.style.setProperty('display', 'block', 'important');
        targetStep.classList.add('active');
        console.log('🔐 Showing step:', step, 'element:', targetStep.id);

        // Focus first input in the new step
        setTimeout(() => {
          const firstInput = targetStep.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([aria-hidden="true"])');
          if (firstInput) {
            firstInput.focus();
          }
        }, 100);
      }
    },

    /**
     * Open the modal with specified tab
     * @param {string} tab - 'signup' or 'signin'
     */
    open: function (tab = 'signup') {
      if (this.isOpen || !this.modal) {return;}

      // Dispatch analytics event
      this.dispatchAnalytics('auth_modal_open', { initialTab: tab });

      this.isOpen = true;
      this.previousFocus = document.activeElement;

      // Show modal
      this.modal.classList.add('active');
      this.modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';

      // Switch to requested tab
      this.switchTab(tab, true);

      // Focus first input after a short delay
      setTimeout(() => {
        const activePanel = tab === 'signup' ? this.signupPanel : this.signinPanel;
        const firstInput = activePanel?.querySelector('input:not([type="hidden"])');
        if (firstInput) {
          firstInput.focus();
        }
      }, 100);
    },

    /**
     * Close the modal
     */
    close: function () {
      if (!this.isOpen || !this.modal) {return;}

      this.isOpen = false;

      // Hide modal
      this.modal.classList.remove('active');
      this.modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';

      // Clear forms and messages
      this.clearForms();
      this.clearMessages();

      // Restore focus
      if (this.previousFocus) {
        this.previousFocus.focus();
        this.previousFocus = null;
      }
    },

    /**
     * Switch between tabs
     * @param {string} tab - 'signup' or 'signin'
     * @param {boolean} silent - Don't dispatch analytics
     */
    switchTab: function (tab, silent = false) {
      if (this.currentTab === tab) {return;}

      this.currentTab = tab;

      // Dispatch analytics event
      if (!silent) {
        this.dispatchAnalytics('auth_tab_switch', { tab });
      }

      // Update tabs
      if (tab === 'signup') {
        this.signupTab?.classList.add('active');
        this.signupTab?.setAttribute('aria-selected', 'true');
        this.signinTab?.classList.remove('active');
        this.signinTab?.setAttribute('aria-selected', 'false');

        this.signupPanel?.classList.add('active');
        this.signupPanel?.setAttribute('aria-hidden', 'false');
        this.signinPanel?.classList.remove('active');
        this.signinPanel?.setAttribute('aria-hidden', 'true');
      } else {
        this.signinTab?.classList.add('active');
        this.signinTab?.setAttribute('aria-selected', 'true');
        this.signupTab?.classList.remove('active');
        this.signupTab?.setAttribute('aria-selected', 'false');

        this.signinPanel?.classList.add('active');
        this.signinPanel?.setAttribute('aria-hidden', 'false');
        this.signupPanel?.classList.remove('active');
        this.signupPanel?.setAttribute('aria-hidden', 'true');
      }

      // Clear messages when switching
      this.clearMessages();
    },

    /**
     * Handle tab keyboard navigation
     */
    handleTabKeyboard: function (e, currentTab) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const newTab = currentTab === 'signup' ? 'signin' : 'signup';
        this.switchTab(newTab);
        const targetTabEl = newTab === 'signup' ? this.signupTab : this.signinTab;
        targetTabEl?.focus();
      }
    },

    /**
     * Handle sign up form submission
     */
    handleSignup: async function (e) {
      e.preventDefault();

      // Determine which step we're on
      if (this.currentSignupStep === 'child') {
        return this.handleK12Signup(e);
      }

      // Adult registration flow
      const firstname = document.getElementById('signup-firstname')?.value.trim();
      const lastname = document.getElementById('signup-lastname')?.value.trim();
      const email = document.getElementById('signup-email')?.value.trim();
      const password = document.getElementById('signup-password')?.value;

      // Clear previous messages
      this.clearMessages();

      // Basic validation
      if (!firstname || !lastname || !email || !password) {
        this.showMessage('signup', 'error', 'All fields are required');
        return;
      }

      // Password strength validation (matches backend requirements)
      if (!this.validatePassword(password)) {
        this.showMessage('signup', 'error', 'Password must be 8+ chars with uppercase, lowercase, number, and special character');
        return;
      }

      // Check localStorage availability
      if (!this.checkStorageAvailable()) {
        this.showCookieWarning();
        return;
      }

      // Disable form
      this.setFormLoading('signup', true);

      // Dispatch analytics event
      this.dispatchAnalytics('signup_attempt', { email, accountType: 'adult' });

      try {
        // Check if AUTH module is loaded
        if (!window.AUTH || typeof window.AUTH.signup !== 'function') {
          console.error('AUTH module not loaded');
          this.showMessage('signup', 'error', 'Authentication service not ready. Please refresh the page.');
          this.setFormLoading('signup', false);
          return;
        }

        // Call AUTH.signup
        const result = await window.AUTH.signup(email, password, firstname, lastname);

        if (result.success) {
          // Check if email verification is required
          if (result.requiresVerification) {
            let message = 'Account created! Please check your email for verification.';
            this.showMessage('signup', 'success', message);

            // Store email for verification flow
            sessionStorage.setItem('pmerit_pending_verification', email);

            // Redirect to account page after delay
            setTimeout(() => {
              window.location.href = '/account.html';
            }, 3000);
          } else {
            // Mock/offline mode - redirect immediately
            this.showMessage('signup', 'success', 'Account created! Redirecting...');
            setTimeout(() => {
              window.location.href = '/account.html';
            }, 1000);
          }
        } else {
          this.showMessage('signup', 'error', result.message || 'Sign up failed');
          this.setFormLoading('signup', false);
        }
      } catch (error) {
        console.error('Sign up error:', error);
        this.showMessage('signup', 'error', 'An unexpected error occurred');
        this.setFormLoading('signup', false);
      }
    },

    /**
     * Validate password strength
     */
    validatePassword: function (password) {
      const hasMinLength = password.length >= 8;
      const hasUppercase = /[A-Z]/.test(password);
      const hasLowercase = /[a-z]/.test(password);
      const hasNumber = /[0-9]/.test(password);
      const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
      return hasMinLength && hasUppercase && hasLowercase && hasNumber && hasSpecial;
    },

    /**
     * Handle K-12 child registration
     */
    handleK12Signup: async function (e) {
      e.preventDefault();

      // Get child's information
      const childFirstname = document.getElementById('child-firstname')?.value.trim();
      const childLastname = document.getElementById('child-lastname')?.value.trim();
      const childDob = document.getElementById('child-dob')?.value;
      const childGrade = document.getElementById('child-grade')?.value;

      // Get parent's information
      const parentFirstname = document.getElementById('parent-firstname')?.value.trim();
      const parentLastname = document.getElementById('parent-lastname')?.value.trim();
      const parentEmail = document.getElementById('parent-email')?.value.trim();
      const parentPassword = document.getElementById('parent-password')?.value;
      const parentConsent = document.getElementById('parent-consent')?.checked;

      // Clear previous messages
      this.clearMessages();

      // Validate child info
      if (!childFirstname || !childLastname || !childDob || !childGrade) {
        this.showMessage('signup', 'error', 'Please fill in all child information fields');
        return;
      }

      // Validate parent info
      if (!parentFirstname || !parentLastname || !parentEmail || !parentPassword) {
        this.showMessage('signup', 'error', 'Please fill in all parent/guardian information fields');
        return;
      }

      // Validate consent
      if (!parentConsent) {
        this.showMessage('signup', 'error', 'Parent/guardian consent is required');
        return;
      }

      // Validate password
      if (!this.validatePassword(parentPassword)) {
        this.showMessage('signup', 'error', 'Password must be 8+ chars with uppercase, lowercase, number, and special character');
        return;
      }

      // Calculate age from DOB
      const birthDate = new Date(childDob);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }

      // Validate age range (3-19 for K-12)
      if (age < 3 || age > 19) {
        this.showMessage('signup', 'error', 'Child must be between 3 and 19 years old for K-12 registration');
        return;
      }

      // Check localStorage availability
      if (!this.checkStorageAvailable()) {
        this.showCookieWarning();
        return;
      }

      // Disable form
      this.setFormLoading('signup', true);

      // Dispatch analytics event
      this.dispatchAnalytics('signup_attempt', {
        email: parentEmail,
        accountType: 'k12_child',
        gradeLevel: childGrade,
        childAge: age
      });

      try {
        // Call K-12 registration endpoint
        const apiUrl = window.CONFIG?.API_BASE_URL || 'https://api.pmerit.com';
        const response = await fetch(`${apiUrl}/api/v1/auth/register-k12`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // Child info
            childFirstName: childFirstname,
            childLastName: childLastname,
            childDob: childDob,
            childGrade: childGrade,
            // Parent info
            parentFirstName: parentFirstname,
            parentLastName: parentLastname,
            parentEmail: parentEmail,
            parentPassword: parentPassword
          })
        });

        const result = await response.json();

        if (result.success) {
          // Show success message
          this.showMessage('signup', 'success',
            `Account created for ${childFirstname}! A consent email has been sent to ${parentEmail}. ` +
            'Please check your email to complete the registration.'
          );

          // Store email for verification flow
          sessionStorage.setItem('pmerit_pending_verification', parentEmail);
          sessionStorage.setItem('pmerit_k12_registration', 'true');

          // Determine grade-appropriate dashboard for K-12 student
          const redirectUrl = this.getK12DashboardFromGrade(childGrade);

          // Redirect to grade-appropriate dashboard after delay
          setTimeout(() => {
            window.location.href = redirectUrl;
          }, 4000);
        } else {
          this.showMessage('signup', 'error', result.error || result.message || 'Registration failed');
          this.setFormLoading('signup', false);
        }
      } catch (error) {
        console.error('K-12 sign up error:', error);
        this.showMessage('signup', 'error', 'An unexpected error occurred. Please try again.');
        this.setFormLoading('signup', false);
      }
    },

    /**
     * Handle sign in form submission
     */
    handleSignin: async function (e) {
      e.preventDefault();

      // Get form data
      const email = document.getElementById('signin-email')?.value.trim();
      const password = document.getElementById('signin-password')?.value;

      // Clear previous messages
      this.clearMessages();

      // Basic validation
      if (!email || !password) {
        this.showMessage('signin', 'error', 'Email and password are required');
        return;
      }

      if (password.length < 8) {
        this.showMessage('signin', 'error', 'Invalid email or password');
        return;
      }

      // Check localStorage availability
      if (!this.checkStorageAvailable()) {
        this.showCookieWarning();
        return;
      }

      // Disable form
      this.setFormLoading('signin', true);

      // Dispatch analytics event
      this.dispatchAnalytics('signin_attempt', { email });

      try {
        // Check if AUTH module is loaded
        if (!window.AUTH || typeof window.AUTH.signin !== 'function') {
          console.error('AUTH module not loaded');
          this.showMessage('signin', 'error', 'Authentication service not ready. Please refresh the page.');
          this.setFormLoading('signin', false);
          return;
        }

        // Call AUTH.signin
        const result = await window.AUTH.signin(email, password);

        if (result.success) {
          this.showMessage('signin', 'success', 'Signed in! Redirecting...');

          // Priority order for redirect:
          // 1. Stored redirect URL (from protected route deep link)
          // 2. Backend-provided redirect_url (grade-based routing)
          // 3. Fallback to getDefaultDashboard()
          let redirectUrl = sessionStorage.getItem('pmerit_redirect_after_login');
          sessionStorage.removeItem('pmerit_redirect_after_login');

          // If no stored redirect, use backend-provided redirect_url or fallback
          if (!redirectUrl) {
            redirectUrl = result.redirect_url || this.getDefaultDashboard(result.user);
          }

          // Redirect after short delay
          setTimeout(() => {
            window.location.href = redirectUrl;
          }, 1000);
        } else {
          // Handle specific error codes with descriptive messages
          const errorMessage = this.getSigninErrorMessage(result);
          this.showSigninError(result.error, errorMessage, result.remainingAttempts);
          this.setFormLoading('signin', false);
        }
      } catch (error) {
        console.error('Sign in error:', error);
        this.showMessage('signin', 'error', 'An unexpected error occurred');
        this.setFormLoading('signin', false);
      }
    },

    /**
     * Get the K-12 dashboard URL from grade code
     * Used for K-12 signup flow where we have the grade but not full user object
     * @param {string} gradeCode - Grade code (K, 1-12)
     * @returns {string} Dashboard URL
     */
    getK12DashboardFromGrade: function (gradeCode) {
      if (!gradeCode) return '/dashboard.html';

      // Convert grade to number for comparison (K = 0)
      const grade = gradeCode === 'K' ? 0 : parseInt(gradeCode, 10);

      if (isNaN(grade)) return '/dashboard.html';

      if (grade <= 2) return '/portal/k12-dashboard-k2.html';
      if (grade <= 5) return '/portal/k12-dashboard-35.html';
      if (grade <= 8) return '/portal/k12-dashboard-68.html';
      if (grade <= 12) return '/portal/k12-dashboard-912.html';

      return '/dashboard.html';
    },

    /**
     * Get the appropriate dashboard URL based on user type
     * @param {object} user - User object with K-12 fields
     * @returns {string} Dashboard URL
     */
    getDefaultDashboard: function (user) {
      // Check if user has K-12 profile (uiType indicates K-12 student)
      if (user?.uiType) {
        const uiType = user.uiType;
        // Route to age-appropriate dashboard
        switch (uiType) {
          case 'k2':
            return '/portal/k12-dashboard-k2.html';
          case '35':
            return '/portal/k12-dashboard-35.html';
          case '68':
            return '/portal/k12-dashboard-68.html';
          case '912':
            return '/portal/k12-dashboard-912.html';
          default:
            // Fallback to appropriate dashboard based on gradeCode
            if (user?.gradeCode) {
              const grade = user.gradeCode === 'K' ? 0 : parseInt(user.gradeCode, 10);
              if (grade <= 2) return '/portal/k12-dashboard-k2.html';
              if (grade <= 5) return '/portal/k12-dashboard-35.html';
              if (grade <= 8) return '/portal/k12-dashboard-68.html';
              return '/portal/k12-dashboard-912.html';
            }
        }
      }

      // Check gradeCode as fallback (might not have uiType yet)
      if (user?.gradeCode) {
        const grade = user.gradeCode === 'K' ? 0 : parseInt(user.gradeCode, 10);
        if (!isNaN(grade)) {
          if (grade <= 2) return '/portal/k12-dashboard-k2.html';
          if (grade <= 5) return '/portal/k12-dashboard-35.html';
          if (grade <= 8) return '/portal/k12-dashboard-68.html';
          if (grade <= 12) return '/portal/k12-dashboard-912.html';
        }
      }

      // Default: Adult dashboard (account page)
      return '/account.html';
    },

    /**
     * Get descriptive error message based on error code
     */
    getSigninErrorMessage: function (result) {
      switch (result.error) {
        case 'USER_NOT_FOUND':
          return 'No account found with this email address.';
        case 'INVALID_PASSWORD':
          return 'Incorrect password.';
        case 'EMAIL_NOT_VERIFIED':
          return 'Please verify your email before signing in.';
        case 'ACCOUNT_LOCKED':
          return 'Account temporarily locked due to too many failed attempts.';
        default:
          return result.message || 'Sign in failed. Please try again.';
      }
    },

    /**
     * Show sign-in error with helpful links
     */
    showSigninError: function (errorCode, message, remainingAttempts) {
      const messageEl = document.getElementById('signin-message');
      if (!messageEl) return;

      // Build error message with helpful links
      let html = `<span class="error-text">${message}</span>`;

      // Add remaining attempts warning if applicable
      if (typeof remainingAttempts === 'number' && remainingAttempts > 0 && remainingAttempts <= 3) {
        html += `<br><small class="attempts-warning">${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} remaining before lockout.</small>`;
      }

      // Add helpful links based on error type
      if (errorCode === 'USER_NOT_FOUND') {
        html += `<div class="error-actions">
          <a href="#" data-switch-to="signup" class="error-link">Create an account</a>
          <span class="error-divider">or</span>
          <a href="#" class="error-link" onclick="AuthModal.showFindAccountFlow(); return false;">Find my account</a>
        </div>`;
      } else if (errorCode === 'INVALID_PASSWORD') {
        html += `<div class="error-actions">
          <a href="#" class="error-link" onclick="AuthModal.showForgotPasswordFlow(); return false;">Forgot password?</a>
        </div>`;
      } else if (errorCode === 'EMAIL_NOT_VERIFIED') {
        html += `<div class="error-actions">
          <a href="#" class="error-link" onclick="AuthModal.resendVerification(); return false;">Resend verification email</a>
        </div>`;
      }

      messageEl.innerHTML = html;
      messageEl.className = 'auth-modal-message error';
      messageEl.style.display = 'block';

      // Bind switch-to links
      const switchLinks = messageEl.querySelectorAll('[data-switch-to]');
      switchLinks.forEach(link => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const targetTab = link.getAttribute('data-switch-to');
          this.switchTab(targetTab);
        });
      });
    },

    /**
     * Show forgot password flow
     */
    showForgotPasswordFlow: function () {
      const email = document.getElementById('signin-email')?.value.trim();
      if (email) {
        // Store email and redirect to forgot password page
        sessionStorage.setItem('pmerit_forgot_password_email', email);
      }
      window.location.href = '/forgot-password.html';
    },

    /**
     * Show find account flow (for users who forgot their email)
     */
    showFindAccountFlow: function () {
      window.location.href = '/find-account.html';
    },

    /**
     * Resend verification email
     */
    resendVerification: async function () {
      const email = document.getElementById('signin-email')?.value.trim();
      if (!email) {
        this.showMessage('signin', 'error', 'Please enter your email address');
        return;
      }

      try {
        const apiUrl = window.CONFIG?.API_BASE_URL || 'https://api.pmerit.com';
        const response = await fetch(`${apiUrl}/api/v1/auth/resend-verification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });

        const result = await response.json();

        if (result.success) {
          this.showMessage('signin', 'success', 'Verification email sent! Please check your inbox.');
        } else {
          this.showMessage('signin', 'error', result.message || 'Failed to send verification email');
        }
      } catch (error) {
        console.error('Resend verification error:', error);
        this.showMessage('signin', 'error', 'An error occurred. Please try again.');
      }
    },

    /**
     * Show message in the specified panel
     */
    showMessage: function (panel, type, message) {
      const messageEl = document.getElementById(`${panel}-message`);
      if (!messageEl) {return;}

      messageEl.textContent = message;
      messageEl.className = `auth-modal-message ${type}`;
      messageEl.style.display = 'block';
    },

    /**
     * Clear all messages
     */
    clearMessages: function () {
      ['signup', 'signin'].forEach(panel => {
        const messageEl = document.getElementById(`${panel}-message`);
        if (messageEl) {
          messageEl.textContent = '';
          messageEl.className = 'auth-modal-message';
          messageEl.style.display = 'none';
        }
      });
      this.hideCookieWarning();
    },

    /**
     * Clear all forms
     */
    clearForms: function () {
      if (this.signupForm) {this.signupForm.reset();}
      if (this.signinForm) {this.signinForm.reset();}

      // Reset K-12 form state
      this.currentSignupStep = 'step1';
      this.accountType = 'adult';
      this.goToSignupStep('step1');

      // Reset account type checkbox to adult
      const adultCheckbox = document.querySelector('.account-type-checkbox[value="adult"]');
      const childCheckbox = document.querySelector('.account-type-checkbox[value="child"]');
      if (adultCheckbox) {
        adultCheckbox.checked = true;
        adultCheckbox.closest('.account-type-option')?.querySelector('.account-type-card')?.classList.add('selected');
      }
      if (childCheckbox) {
        childCheckbox.checked = false;
        childCheckbox.closest('.account-type-option')?.querySelector('.account-type-card')?.classList.remove('selected');
      }
    },

    /**
     * Set form loading state
     */
    setFormLoading: function (panel, loading) {
      const form = panel === 'signup' ? this.signupForm : this.signinForm;
      const submitBtn = form?.querySelector('button[type="submit"]');

      if (!submitBtn) {return;}

      const inputs = form.querySelectorAll('input, button');

      if (loading) {
        inputs.forEach(input => {
          input.disabled = true;
        });
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
      } else {
        inputs.forEach(input => {
          input.disabled = false;
        });
        submitBtn.textContent = panel === 'signup' ? 'Create Account' : 'Sign In';
      }
    },

    /**
     * Check if localStorage is available
     */
    checkStorageAvailable: function () {
      try {
        const test = '__storage_test__';
        localStorage.setItem(test, test);
        localStorage.removeItem(test);
        return true;
      } catch (e) {
        return false;
      }
    },

    /**
     * Show cookie/storage warning
     */
    showCookieWarning: function () {
      const warning = document.getElementById('cookie-warning');
      if (warning) {
        warning.classList.remove('hidden');
      }
    },

    /**
     * Hide cookie/storage warning
     */
    hideCookieWarning: function () {
      const warning = document.getElementById('cookie-warning');
      if (warning) {
        warning.classList.add('hidden');
      }
    },

    /**
     * Check for auto-open URL parameter
     */
    checkAutoOpen: function () {
      const urlParams = new URLSearchParams(window.location.search);
      const openParam = urlParams.get('open');
      const authParam = urlParams.get('auth');

      // Check for ?auth=signin or ?auth=signup (from protected route redirect)
      if (authParam && !window.AUTH?.isAuthenticated()) {
        const tab = authParam === 'signup' ? 'signup' : 'signin';
        setTimeout(() => this.open(tab), 100);

        // Clean up URL
        const newUrl = window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
        return;
      }

      // Legacy: Check for ?open=dashboard
      if (openParam === 'dashboard' && !window.AUTH?.isAuthenticated()) {
        setTimeout(() => this.open('signup'), 100);
      }
    },

    /**
     * Dispatch analytics event
     */
    dispatchAnalytics: function (eventName, data = {}) {
      // Log to console for Phase 3.1
      // eslint-disable-next-line no-console
      logger.debug(`📊 Analytics: ${eventName}`, data);

      // Dispatch custom event for future analytics integration
      window.dispatchEvent(new CustomEvent('pmerit-analytics', {
        detail: { event: eventName, ...data }
      }));
    }
  };

  // Export globally (init is called after partial is loaded via fetch in index.html)
  window.AuthModal = AuthModal;

  // eslint-disable-next-line no-console
  logger.debug('🔐 AuthModal controller loaded');
})();
