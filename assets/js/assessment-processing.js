/**
 * PMERIT Assessment Processing Module
 * Version: 1.0
 * Last Updated: November 2025
 *
 * Purpose: Handle assessment processing page logic
 *
 * Features:
 * - Brain animation with pulse rings
 * - Progress steps animation (4 steps, 2s each)
 * - Fun facts carousel (3s intervals)
 * - API submission to /api/v1/assessment/submit
 * - Error handling and recovery
 * - Redirect to results page on completion
 */

(function (window) {
  'use strict';

  /**
   * AssessmentProcessing - Main class for processing page
   */
  class AssessmentProcessing {
    constructor() {
      // Configuration
      this.config = {
        API_ENDPOINT: 'https://api.pmerit.com/api/v1/assessment/submit',
        RESULTS_PAGE: 'assessment-results.html',
        STEP_DURATION: 2000, // 2 seconds per step
        FACT_DURATION: 3000, // 3 seconds per fact
        TOTAL_STEPS: 4,
        TOTAL_FACTS: 5
      };

      // State
      this.currentStep = 1;
      this.currentFact = 0;
      this.sessionId = null;
      this.processingTimer = null;
      this.factsTimer = null;

      // Storage key from assessment-questions.js
      this.storageKey = 'pmerit-assessment-questions';
    }

    /**
     * Initialize the processing page
     */
    async init() {
      logger.debug('[AssessmentProcessing] Initializing...');

      // Setup error button handler
      this.setupErrorButton();

      // Get session ID and answers from localStorage
      const assessmentData = this.getAssessmentData();

      if (!assessmentData || !assessmentData.sessionId) {
        console.error('[AssessmentProcessing] No session ID found');
        this.showError('No assessment session found. Please start the assessment again.');
        return;
      }

      if (!assessmentData.answers || Object.keys(assessmentData.answers).length !== 120) {
        console.error('[AssessmentProcessing] Incomplete assessment data');
        this.showError('Assessment data is incomplete. Please complete all questions.');
        return;
      }

      this.sessionId = assessmentData.sessionId;

      // Start animations
      this.startProgressAnimation();
      this.startFactsCarousel();

      // Submit assessment to API
      await this.submitAssessment(assessmentData);
    }

    /**
     * Get assessment data from localStorage
     */
    getAssessmentData() {
      try {
        console.log('[AssessmentProcessing] Looking for storage key:', this.storageKey);
        const data = localStorage.getItem(this.storageKey);
        console.log('[AssessmentProcessing] Raw localStorage data:', data ? 'found (' + data.length + ' chars)' : 'null');

        if (data) {
          const parsed = JSON.parse(data);
          console.log('[AssessmentProcessing] Parsed data:', {
            sessionId: parsed.sessionId,
            answerCount: parsed.answers ? Object.keys(parsed.answers).length : 0,
            keys: parsed.answers ? Object.keys(parsed.answers).slice(0, 5) : []
          });
          return parsed;
        }

        // Debug: Check all localStorage keys
        console.log('[AssessmentProcessing] All localStorage keys:', Object.keys(localStorage));
      } catch (error) {
        console.error('[AssessmentProcessing] Error reading assessment data:', error);
      }
      return null;
    }

    /**
     * Setup error button handler
     */
    setupErrorButton() {
      const errorBtn = document.getElementById('error-return-btn');
      if (errorBtn) {
        errorBtn.addEventListener('click', () => {
          window.location.href = 'assessment-questions.html';
        });
      }
    }

    /**
     * Start progress step animation
     */
    startProgressAnimation() {
      this.processingTimer = setInterval(() => {
        if (this.currentStep < this.config.TOTAL_STEPS) {
          this.currentStep++;
          this.updateProgressStep(this.currentStep);
        } else {
          clearInterval(this.processingTimer);
        }
      }, this.config.STEP_DURATION);
    }

    /**
     * Update progress step display
     */
    updateProgressStep(step) {
      const steps = document.querySelectorAll('.step');

      steps.forEach((stepEl, index) => {
        const stepNumber = index + 1;

        if (stepNumber < step) {
          // Mark as completed
          stepEl.classList.remove('active');
          stepEl.classList.add('completed');
          stepEl.querySelector('.step-icon').textContent = '✓';
        } else if (stepNumber === step) {
          // Mark as active
          stepEl.classList.remove('completed');
          stepEl.classList.add('active');
          stepEl.querySelector('.step-icon').textContent = '●';
        } else {
          // Mark as pending
          stepEl.classList.remove('active', 'completed');
          stepEl.querySelector('.step-icon').textContent = '○';
        }
      });
    }

    /**
     * Start fun facts carousel
     */
    startFactsCarousel() {
      this.factsTimer = setInterval(() => {
        const facts = document.querySelectorAll('.fact');

        // Hide current fact
        facts[this.currentFact].classList.remove('active');

        // Move to next fact
        this.currentFact = (this.currentFact + 1) % this.config.TOTAL_FACTS;

        // Show next fact
        facts[this.currentFact].classList.add('active');
      }, this.config.FACT_DURATION);
    }

    /**
     * Submit assessment to API
     */
    async submitAssessment(assessmentData) {
      try {
        logger.debug('[AssessmentProcessing] Submitting assessment...', {
          sessionId: assessmentData.sessionId,
          answerCount: Object.keys(assessmentData.answers).length
        });

        // Submit to API - send raw answers format (backend handles transformation)
        const response = await fetch(this.config.API_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'omit',
          body: JSON.stringify({
            sessionId: assessmentData.sessionId,
            answers: assessmentData.answers
          })
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const result = await response.json();
        logger.debug('[AssessmentProcessing] Assessment submitted successfully', result);

        // Wait for all animations to complete, then redirect
        const totalAnimationTime = this.config.STEP_DURATION * this.config.TOTAL_STEPS;
        setTimeout(() => {
          this.redirectToResults(result.resultId || result.sessionId || assessmentData.sessionId);
        }, totalAnimationTime + 1000);

      } catch (error) {
        console.error('[AssessmentProcessing] Error submitting assessment:', error);

        // For development/testing: If API is not available or returns error, simulate success
        if (error.message.includes('404') || error.message.includes('Failed to fetch') || error.message.includes('501')) {
          console.warn('[AssessmentProcessing] API not available, simulating success for development');

          // Generate mock result ID and redirect after animations
          const totalAnimationTime = this.config.STEP_DURATION * this.config.TOTAL_STEPS;
          setTimeout(() => {
            this.redirectToResults(assessmentData.sessionId);
          }, totalAnimationTime + 1000);
        } else {
          this.showError('We encountered an issue processing your assessment. Please try again.');
        }
      }
    }

    /**
     * Redirect to results page
     */
    redirectToResults(resultId) {
      logger.debug('[AssessmentProcessing] Redirecting to results page...', resultId);

      // Clear timers
      if (this.processingTimer) {clearInterval(this.processingTimer);}
      if (this.factsTimer) {clearInterval(this.factsTimer);}

      // Redirect with result ID
      window.location.href = `${this.config.RESULTS_PAGE}?id=${resultId}`;
    }

    /**
     * Show error message
     */
    showError(message) {
      // Clear timers
      if (this.processingTimer) {clearInterval(this.processingTimer);}
      if (this.factsTimer) {clearInterval(this.factsTimer);}

      // Hide processing elements
      const brainAnimation = document.querySelector('.brain-animation');
      const progressSteps = document.querySelector('.progress-steps');
      const funFacts = document.querySelector('.fun-facts');

      if (brainAnimation) {brainAnimation.style.display = 'none';}
      if (progressSteps) {progressSteps.style.display = 'none';}
      if (funFacts) {funFacts.style.display = 'none';}

      // Show error message
      const errorEl = document.getElementById('error-message');
      if (errorEl) {
        const errorText = errorEl.querySelector('p');
        if (errorText) {
          errorText.textContent = message;
        }
        errorEl.classList.add('show');
      }
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      const processing = new AssessmentProcessing();
      processing.init();
    });
  } else {
    const processing = new AssessmentProcessing();
    processing.init();
  }

  logger.debug('[AssessmentProcessing] Module loaded successfully');

})(window);
