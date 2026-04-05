/**
 * Proctor Controller - AI Proctoring for Secure Assessments
 * Phase 2: Digital Desk Classroom Redesign
 *
 * Manages exam sessions with:
 * - Timer management
 * - Violation detection and tracking
 * - Tab/window focus monitoring
 * - Integration with Vision AI (Phase 3)
 * - Exam submission and grading
 *
 * @module proctor-controller
 */

(function (window) {
  'use strict';

  /**
   * Proctor violation types
   */
  const VIOLATION_TYPES = {
    TAB_SWITCH: 'tab_switch',
    WINDOW_BLUR: 'window_blur',
    COPY_PASTE: 'copy_paste',
    RIGHT_CLICK: 'right_click',
    KEYBOARD_SHORTCUT: 'keyboard_shortcut',
    FACE_NOT_VISIBLE: 'face_not_visible',
    MULTIPLE_FACES: 'multiple_faces',
    GAZE_AWAY: 'gaze_away',
    PHONE_DETECTED: 'phone_detected',
    VOICE_DETECTED: 'voice_detected'
  };

  /**
   * Proctor severity levels
   */
  const SEVERITY = {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical'
  };

  /**
   * ProctorController class
   */
  class ProctorController {
    /**
     * @constructor
     * @param {Object} config - Configuration options
     */
    constructor(config = {}) {
      this.config = {
        apiBase: config.apiBase || window.CONFIG?.API_BASE_URL || 'https://api.pmerit.com',
        maxViolations: config.maxViolations || 3,
        warningThreshold: config.warningThreshold || 2,
        autoSubmitOnMaxViolations: config.autoSubmitOnMaxViolations !== false,
        enableVisionAI: config.enableVisionAI || false,
        enableAudioMonitoring: config.enableAudioMonitoring || false,
        timerWarningMinutes: config.timerWarningMinutes || 5,
        timerCriticalMinutes: config.timerCriticalMinutes || 1
      };

      // State
      this.state = {
        active: false,
        examId: null,
        examData: null,
        startTime: null,
        endTime: null,
        timeRemaining: 0,
        currentQuestion: 0,
        totalQuestions: 0,
        answers: {},
        flaggedQuestions: new Set(),
        violations: [],
        violationCount: 0,
        isFullscreen: false,
        cameraEnabled: false,
        micEnabled: false
      };

      // Timer
      this.timerInterval = null;

      // DOM elements cache
      this.dom = {};

      // Event listeners
      this.boundHandlers = {
        handleVisibilityChange: this.handleVisibilityChange.bind(this),
        handleBlur: this.handleBlur.bind(this),
        handleFocus: this.handleFocus.bind(this),
        handleKeydown: this.handleKeydown.bind(this),
        handleContextMenu: this.handleContextMenu.bind(this),
        handleCopy: this.handleCopy.bind(this),
        handlePaste: this.handlePaste.bind(this),
        handleBeforeUnload: this.handleBeforeUnload.bind(this)
      };

      // Callbacks
      this.callbacks = {
        onViolation: config.onViolation || null,
        onWarning: config.onWarning || null,
        onTimeUpdate: config.onTimeUpdate || null,
        onExamEnd: config.onExamEnd || null,
        onQuestionChange: config.onQuestionChange || null
      };
    }

    /**
     * Initialize proctor mode
     * @param {Object} examData - Exam configuration
     * @returns {Promise<boolean>}
     */
    async init(examData) {
      console.log('🔒 Initializing Proctor Mode...');

      try {
        this.state.examId = examData.exam_id || examData.id;
        this.state.examData = examData;
        this.state.totalQuestions = examData.questions?.length || 0;
        this.state.timeRemaining = (examData.duration_minutes || 60) * 60; // Convert to seconds

        // Cache DOM elements
        this.cacheDOMElements();

        // Setup event listeners for violation detection
        this.attachEventListeners();

        // Update UI to proctor mode
        this.activateProctorUI();

        // Start the exam timer
        this.startTimer();

        // Log exam start
        await this.logExamEvent('exam_started', {
          exam_id: this.state.examId,
          total_questions: this.state.totalQuestions,
          duration_minutes: examData.duration_minutes
        });

        this.state.active = true;
        this.state.startTime = Date.now();

        console.log('✅ Proctor Mode activated');
        return true;

      } catch (error) {
        console.error('Failed to initialize proctor mode:', error);
        return false;
      }
    }

    /**
     * Cache DOM elements
     */
    cacheDOMElements() {
      this.dom = {
        body: document.body,
        proctorStatus: document.getElementById('proctor-status'),
        statusText: this.dom.proctorStatus?.querySelector('.status-text'),
        examTimer: document.getElementById('exam-timer'),
        examContainer: document.getElementById('exam-container'),
        questionProgress: document.getElementById('question-progress'),
        violationWarning: document.getElementById('violation-warning'),
        avatarFrame: document.getElementById('avatar-frame'),
        leftPanel: document.querySelector('.left-panel'),
        rightPanel: document.querySelector('.right-panel')
      };
    }

    /**
     * Attach event listeners for violation detection
     */
    attachEventListeners() {
      // Visibility change (tab switch)
      document.addEventListener('visibilitychange', this.boundHandlers.handleVisibilityChange);

      // Window blur/focus
      window.addEventListener('blur', this.boundHandlers.handleBlur);
      window.addEventListener('focus', this.boundHandlers.handleFocus);

      // Keyboard shortcuts
      document.addEventListener('keydown', this.boundHandlers.handleKeydown);

      // Right-click prevention
      document.addEventListener('contextmenu', this.boundHandlers.handleContextMenu);

      // Copy/paste prevention
      document.addEventListener('copy', this.boundHandlers.handleCopy);
      document.addEventListener('paste', this.boundHandlers.handlePaste);

      // Prevent leaving page
      window.addEventListener('beforeunload', this.boundHandlers.handleBeforeUnload);
    }

    /**
     * Detach event listeners
     */
    detachEventListeners() {
      document.removeEventListener('visibilitychange', this.boundHandlers.handleVisibilityChange);
      window.removeEventListener('blur', this.boundHandlers.handleBlur);
      window.removeEventListener('focus', this.boundHandlers.handleFocus);
      document.removeEventListener('keydown', this.boundHandlers.handleKeydown);
      document.removeEventListener('contextmenu', this.boundHandlers.handleContextMenu);
      document.removeEventListener('copy', this.boundHandlers.handleCopy);
      document.removeEventListener('paste', this.boundHandlers.handlePaste);
      window.removeEventListener('beforeunload', this.boundHandlers.handleBeforeUnload);
    }

    /**
     * Activate proctor UI styling
     */
    activateProctorUI() {
      // Add proctor mode class to body
      document.body.classList.add('proctor-mode', 'exam-active');

      // Update proctor status indicator
      if (this.dom.proctorStatus) {
        this.dom.proctorStatus.classList.remove('off');
        this.dom.proctorStatus.classList.add('active');
        const statusText = this.dom.proctorStatus.querySelector('.status-text');
        if (statusText) {
          statusText.textContent = 'AI Proctor Active';
        }
      }

      // Move avatar to corner (proctor position)
      if (this.dom.avatarFrame) {
        this.dom.avatarFrame.classList.add('proctor-mode');
      }
    }

    /**
     * Deactivate proctor UI
     */
    deactivateProctorUI() {
      document.body.classList.remove('proctor-mode', 'exam-active');

      if (this.dom.proctorStatus) {
        this.dom.proctorStatus.classList.remove('active');
        this.dom.proctorStatus.classList.add('off');
        const statusText = this.dom.proctorStatus.querySelector('.status-text');
        if (statusText) {
          statusText.textContent = 'Proctor: Off';
        }
      }

      if (this.dom.avatarFrame) {
        this.dom.avatarFrame.classList.remove('proctor-mode');
      }
    }

    /**
     * Start exam timer
     */
    startTimer() {
      this.timerInterval = setInterval(() => {
        this.state.timeRemaining--;

        // Update timer display
        this.updateTimerDisplay();

        // Check for time warnings
        const minutesLeft = this.state.timeRemaining / 60;

        if (minutesLeft <= this.config.timerCriticalMinutes) {
          this.setTimerState('critical');
        } else if (minutesLeft <= this.config.timerWarningMinutes) {
          this.setTimerState('warning');
        }

        // Callback
        if (this.callbacks.onTimeUpdate) {
          this.callbacks.onTimeUpdate(this.state.timeRemaining);
        }

        // Auto-submit when time is up
        if (this.state.timeRemaining <= 0) {
          this.endExam('time_expired');
        }

      }, 1000);
    }

    /**
     * Update timer display
     */
    updateTimerDisplay() {
      const timerEl = document.getElementById('exam-timer');
      if (!timerEl) return;

      const hours = Math.floor(this.state.timeRemaining / 3600);
      const minutes = Math.floor((this.state.timeRemaining % 3600) / 60);
      const seconds = this.state.timeRemaining % 60;

      let display = '';
      if (hours > 0) {
        display = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      } else {
        display = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      }

      timerEl.textContent = display;
    }

    /**
     * Set timer visual state
     * @param {string} state - 'normal', 'warning', or 'critical'
     */
    setTimerState(state) {
      const timerEl = document.getElementById('exam-timer');
      if (!timerEl) return;

      timerEl.classList.remove('warning', 'critical');
      if (state !== 'normal') {
        timerEl.classList.add(state);
      }
    }

    /**
     * Handle visibility change (tab switch)
     */
    handleVisibilityChange() {
      if (document.hidden && this.state.active) {
        this.recordViolation(VIOLATION_TYPES.TAB_SWITCH, SEVERITY.HIGH);
      }
    }

    /**
     * Handle window blur
     */
    handleBlur() {
      if (this.state.active) {
        this.recordViolation(VIOLATION_TYPES.WINDOW_BLUR, SEVERITY.MEDIUM);
      }
    }

    /**
     * Handle window focus
     */
    handleFocus() {
      // Could be used to track time away from exam
    }

    /**
     * Handle keyboard shortcuts
     * @param {KeyboardEvent} e
     */
    handleKeydown(e) {
      if (!this.state.active) return;

      // Block common shortcuts during exam
      const blockedCombos = [
        { ctrl: true, key: 'c' },  // Copy
        { ctrl: true, key: 'v' },  // Paste
        { ctrl: true, key: 'a' },  // Select all
        { ctrl: true, key: 'p' },  // Print
        { ctrl: true, key: 's' },  // Save
        { ctrl: true, shift: true, key: 'i' },  // Dev tools
        { key: 'F12' },  // Dev tools
        { key: 'PrintScreen' }  // Screenshot
      ];

      for (const combo of blockedCombos) {
        const match = (
          (!combo.ctrl || e.ctrlKey) &&
          (!combo.shift || e.shiftKey) &&
          (!combo.alt || e.altKey) &&
          (e.key.toLowerCase() === combo.key?.toLowerCase() || e.key === combo.key)
        );

        if (match) {
          e.preventDefault();
          e.stopPropagation();
          this.recordViolation(VIOLATION_TYPES.KEYBOARD_SHORTCUT, SEVERITY.MEDIUM, {
            key: e.key,
            ctrl: e.ctrlKey,
            shift: e.shiftKey
          });
          return false;
        }
      }
    }

    /**
     * Handle right-click
     * @param {MouseEvent} e
     */
    handleContextMenu(e) {
      if (this.state.active) {
        e.preventDefault();
        this.recordViolation(VIOLATION_TYPES.RIGHT_CLICK, SEVERITY.LOW);
      }
    }

    /**
     * Handle copy event
     * @param {ClipboardEvent} e
     */
    handleCopy(e) {
      if (this.state.active) {
        e.preventDefault();
        this.recordViolation(VIOLATION_TYPES.COPY_PASTE, SEVERITY.MEDIUM);
      }
    }

    /**
     * Handle paste event
     * @param {ClipboardEvent} e
     */
    handlePaste(e) {
      if (this.state.active) {
        e.preventDefault();
        this.recordViolation(VIOLATION_TYPES.COPY_PASTE, SEVERITY.MEDIUM);
      }
    }

    /**
     * Handle before unload
     * @param {BeforeUnloadEvent} e
     */
    handleBeforeUnload(e) {
      if (this.state.active) {
        e.preventDefault();
        e.returnValue = 'You have an exam in progress. Are you sure you want to leave?';
        return e.returnValue;
      }
    }

    /**
     * Record a violation
     * @param {string} type - Violation type
     * @param {string} severity - Severity level
     * @param {Object} details - Additional details
     */
    async recordViolation(type, severity, details = {}) {
      const violation = {
        type,
        severity,
        timestamp: new Date().toISOString(),
        question_index: this.state.currentQuestion,
        details
      };

      this.state.violations.push(violation);
      this.state.violationCount++;

      console.warn(`⚠️ Proctor Violation: ${type} (${severity})`);

      // Show warning modal
      this.showViolationWarning(violation);

      // Callback
      if (this.callbacks.onViolation) {
        this.callbacks.onViolation(violation);
      }

      // Log to backend
      await this.logExamEvent('violation', violation);

      // Check if max violations reached
      if (this.state.violationCount >= this.config.maxViolations) {
        if (this.config.autoSubmitOnMaxViolations) {
          this.endExam('max_violations');
        }
      } else if (this.state.violationCount >= this.config.warningThreshold) {
        if (this.callbacks.onWarning) {
          this.callbacks.onWarning(this.config.maxViolations - this.state.violationCount);
        }
      }
    }

    /**
     * Show violation warning modal
     * @param {Object} violation
     */
    showViolationWarning(violation) {
      // Remove existing warning
      const existing = document.querySelector('.violation-warning');
      if (existing) existing.remove();

      const backdrop = document.createElement('div');
      backdrop.className = 'violation-backdrop';

      const modal = document.createElement('div');
      modal.className = 'violation-warning';
      modal.innerHTML = `
        <div class="warning-icon">⚠️</div>
        <div class="warning-title">Proctoring Alert</div>
        <div class="warning-message">${this.getViolationMessage(violation.type)}</div>
        <div class="warning-count">
          Violations: ${this.state.violationCount} / ${this.config.maxViolations}
        </div>
        <button class="btn btn-primary" onclick="this.closest('.violation-warning').remove(); document.querySelector('.violation-backdrop').remove();">
          I Understand
        </button>
      `;

      document.body.appendChild(backdrop);
      document.body.appendChild(modal);

      // Auto-dismiss after 5 seconds
      setTimeout(() => {
        backdrop.remove();
        modal.remove();
      }, 5000);
    }

    /**
     * Get human-readable violation message
     * @param {string} type
     * @returns {string}
     */
    getViolationMessage(type) {
      const messages = {
        [VIOLATION_TYPES.TAB_SWITCH]: 'You switched away from the exam tab. Please stay focused on your exam.',
        [VIOLATION_TYPES.WINDOW_BLUR]: 'You clicked outside the exam window. Please keep the exam window in focus.',
        [VIOLATION_TYPES.COPY_PASTE]: 'Copy/paste is not allowed during the exam.',
        [VIOLATION_TYPES.RIGHT_CLICK]: 'Right-click is disabled during the exam.',
        [VIOLATION_TYPES.KEYBOARD_SHORTCUT]: 'That keyboard shortcut is not allowed during the exam.',
        [VIOLATION_TYPES.FACE_NOT_VISIBLE]: 'Your face is not visible. Please ensure you are in front of the camera.',
        [VIOLATION_TYPES.MULTIPLE_FACES]: 'Multiple faces detected. Only the test-taker should be visible.',
        [VIOLATION_TYPES.GAZE_AWAY]: 'You appear to be looking away from the screen.',
        [VIOLATION_TYPES.PHONE_DETECTED]: 'A phone or other device was detected.',
        [VIOLATION_TYPES.VOICE_DETECTED]: 'Voices or audio were detected in the environment.'
      };

      return messages[type] || 'A proctoring violation was detected.';
    }

    /**
     * Save answer for current question
     * @param {number} questionIndex
     * @param {any} answer
     */
    saveAnswer(questionIndex, answer) {
      this.state.answers[questionIndex] = {
        answer,
        timestamp: new Date().toISOString()
      };
    }

    /**
     * Flag/unflag a question for review
     * @param {number} questionIndex
     */
    toggleFlagQuestion(questionIndex) {
      if (this.state.flaggedQuestions.has(questionIndex)) {
        this.state.flaggedQuestions.delete(questionIndex);
      } else {
        this.state.flaggedQuestions.add(questionIndex);
      }
      this.updateQuestionProgress();
    }

    /**
     * Navigate to a question
     * @param {number} index
     */
    goToQuestion(index) {
      if (index >= 0 && index < this.state.totalQuestions) {
        this.state.currentQuestion = index;
        this.updateQuestionProgress();

        if (this.callbacks.onQuestionChange) {
          this.callbacks.onQuestionChange(index, this.state.examData.questions[index]);
        }
      }
    }

    /**
     * Update question progress dots
     */
    updateQuestionProgress() {
      const container = document.getElementById('question-progress');
      if (!container) return;

      let html = '';
      for (let i = 0; i < this.state.totalQuestions; i++) {
        const isCurrent = i === this.state.currentQuestion;
        const isAnswered = this.state.answers[i] !== undefined;
        const isFlagged = this.state.flaggedQuestions.has(i);

        let classes = 'question-dot';
        if (isCurrent) classes += ' current';
        if (isAnswered) classes += ' answered';
        if (isFlagged) classes += ' flagged';

        html += `<div class="${classes}" onclick="window.proctorController?.goToQuestion(${i})">${i + 1}</div>`;
      }

      container.innerHTML = html;
    }

    /**
     * End the exam
     * @param {string} reason - 'completed', 'time_expired', 'max_violations'
     */
    async endExam(reason = 'completed') {
      console.log(`📝 Ending exam: ${reason}`);

      // Stop timer
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }

      this.state.active = false;
      this.state.endTime = Date.now();

      // Calculate stats
      const duration = Math.floor((this.state.endTime - this.state.startTime) / 1000);
      const answeredCount = Object.keys(this.state.answers).length;

      // Prepare submission data
      const submission = {
        exam_id: this.state.examId,
        answers: this.state.answers,
        flagged_questions: Array.from(this.state.flaggedQuestions),
        violations: this.state.violations,
        duration_seconds: duration,
        end_reason: reason,
        submitted_at: new Date().toISOString()
      };

      // Submit to backend
      try {
        const response = await fetch(`${this.config.apiBase}/api/v1/assessment/submit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('pmerit_auth_token')}`
          },
          body: JSON.stringify(submission)
        });

        const result = await response.json();
        console.log('✅ Exam submitted:', result);

        // Log exam end
        await this.logExamEvent('exam_ended', {
          reason,
          duration_seconds: duration,
          questions_answered: answeredCount,
          violations: this.state.violationCount
        });

      } catch (error) {
        console.error('Failed to submit exam:', error);
        // Store locally for retry
        localStorage.setItem(`pmerit_exam_backup_${this.state.examId}`, JSON.stringify(submission));
      }

      // Cleanup
      this.detachEventListeners();
      this.deactivateProctorUI();

      // Callback
      if (this.callbacks.onExamEnd) {
        this.callbacks.onExamEnd({
          reason,
          duration,
          answeredCount,
          violations: this.state.violationCount
        });
      }

      // Show completion screen
      this.showCompletionScreen(reason);
    }

    /**
     * Show exam completion screen
     * @param {string} reason
     */
    showCompletionScreen(reason) {
      const messages = {
        completed: 'Your exam has been submitted successfully!',
        time_expired: 'Time is up! Your exam has been automatically submitted.',
        max_violations: 'Your exam has been submitted due to multiple violations.'
      };

      const examContainer = document.getElementById('exam-container') || document.querySelector('.player-area');
      if (examContainer) {
        examContainer.innerHTML = `
          <div style="text-align: center; padding: 60px;">
            <div style="font-size: 64px; margin-bottom: 20px;">
              ${reason === 'completed' ? '✅' : reason === 'time_expired' ? '⏰' : '⚠️'}
            </div>
            <h2 style="margin-bottom: 16px;">Exam Submitted</h2>
            <p style="color: var(--text-secondary); margin-bottom: 24px;">
              ${messages[reason] || 'Your exam has been submitted.'}
            </p>
            <p style="font-size: 14px; color: var(--text-secondary);">
              Questions answered: ${Object.keys(this.state.answers).length} / ${this.state.totalQuestions}
            </p>
            <a href="../dashboard.html" class="btn btn-primary" style="margin-top: 24px;">
              Return to Dashboard
            </a>
          </div>
        `;
      }
    }

    /**
     * Log exam event to backend
     * @param {string} eventType
     * @param {Object} data
     */
    async logExamEvent(eventType, data) {
      try {
        await fetch(`${this.config.apiBase}/api/v1/assessment/log`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('pmerit_auth_token')}`
          },
          body: JSON.stringify({
            exam_id: this.state.examId,
            event_type: eventType,
            data,
            timestamp: new Date().toISOString()
          })
        });
      } catch (error) {
        console.warn('Failed to log exam event:', error);
      }
    }

    /**
     * Get current state
     * @returns {Object}
     */
    getState() {
      return {
        active: this.state.active,
        examId: this.state.examId,
        timeRemaining: this.state.timeRemaining,
        currentQuestion: this.state.currentQuestion,
        totalQuestions: this.state.totalQuestions,
        answeredCount: Object.keys(this.state.answers).length,
        violationCount: this.state.violationCount,
        flaggedCount: this.state.flaggedQuestions.size
      };
    }

    /**
     * Report a vision AI violation (called from VisionAI module)
     * @param {string} type
     * @param {Object} details
     */
    reportVisionViolation(type, details) {
      if (this.state.active) {
        this.recordViolation(type, SEVERITY.HIGH, details);
      }
    }

    // =========================================
    // VISION AI INTEGRATION
    // =========================================

    /**
     * Set Vision AI instance for integration
     * @param {Object} visionInstance - VisionAI module instance
     */
    setVisionAI(visionInstance) {
      this.visionAI = visionInstance;

      // Register violation callback
      if (visionInstance && typeof visionInstance.onViolation === 'function') {
        visionInstance.onViolation((type, confidence, details) => {
          this.onVisionViolation(type, confidence, details);
        });
      }

      console.log('🔗 VisionAI integrated with ProctorController');
    }

    /**
     * Handle violation from Vision AI
     * @param {string} type - Violation type
     * @param {number} confidence - Detection confidence (0-1)
     * @param {Object} details - Additional details
     */
    onVisionViolation(type, confidence, details = {}) {
      if (!this.state.active) return;

      // Only record if confidence is above threshold
      if (confidence >= 0.7) {
        const severity = confidence >= 0.9 ? SEVERITY.CRITICAL :
                        confidence >= 0.8 ? SEVERITY.HIGH : SEVERITY.MEDIUM;

        this.recordViolation(type, severity, {
          ...details,
          confidence,
          source: 'vision_ai'
        });

        // Trigger avatar warning
        this.triggerAvatarWarning(this.getViolationMessage(type));
      }
    }

    // =========================================
    // AVATAR BEHAVIOR
    // =========================================

    /**
     * Move avatar to corner monitoring position
     */
    moveAvatarToCorner() {
      const avatarFrame = document.getElementById('avatar-frame') ||
                          document.querySelector('.avatar-frame');

      if (avatarFrame) {
        avatarFrame.classList.add('proctor-mode', 'monitoring');

        // Update live badge
        const liveBadge = avatarFrame.querySelector('.avatar-live-badge');
        if (liveBadge) {
          liveBadge.innerHTML = '<span class="live-dot"></span> MONITORING';
          liveBadge.classList.add('proctor');
        }
      }
    }

    /**
     * Restore avatar to original position
     */
    restoreAvatarPosition() {
      const avatarFrame = document.getElementById('avatar-frame') ||
                          document.querySelector('.avatar-frame');

      if (avatarFrame) {
        avatarFrame.classList.remove('proctor-mode', 'monitoring');

        // Restore live badge
        const liveBadge = avatarFrame.querySelector('.avatar-live-badge');
        if (liveBadge) {
          liveBadge.innerHTML = '<span class="live-dot"></span> LIVE';
          liveBadge.classList.remove('proctor');
        }
      }
    }

    /**
     * Trigger avatar verbal warning
     * @param {string} message - Warning message to speak
     */
    async triggerAvatarWarning(message) {
      // Update avatar state to speaking/warning
      const avatarFrame = document.getElementById('avatar-frame') ||
                          document.querySelector('.avatar-frame');

      if (avatarFrame) {
        avatarFrame.classList.add('warning');

        // Show captions
        const captions = avatarFrame.querySelector('.avatar-captions');
        if (captions) {
          captions.textContent = message;
          captions.classList.add('visible');
        }
      }

      // Use TTS if available
      if (window.VirtualHumanAPI && typeof window.VirtualHumanAPI.speak === 'function') {
        try {
          await window.VirtualHumanAPI.speak(message, { priority: 'high' });
        } catch (error) {
          console.warn('TTS not available for proctor warning:', error);
        }
      }

      // Clear warning state after delay
      setTimeout(() => {
        if (avatarFrame) {
          avatarFrame.classList.remove('warning');
          const captions = avatarFrame.querySelector('.avatar-captions');
          if (captions) captions.classList.remove('visible');
        }
      }, 5000);
    }

    // =========================================
    // CAMERA PRIVACY SHUTTER
    // =========================================

    /**
     * Show camera off shutter animation
     */
    showCameraShutter() {
      // Remove existing shutter
      const existing = document.querySelector('.camera-shutter');
      if (existing) existing.remove();

      const shutter = document.createElement('div');
      shutter.className = 'camera-shutter';
      shutter.innerHTML = `
        <div class="shutter-icon">📷</div>
        <div class="shutter-text">Camera Off</div>
        <div class="shutter-subtext">Proctoring has ended</div>
      `;

      document.body.appendChild(shutter);

      // Auto-remove after animation
      setTimeout(() => {
        shutter.classList.add('opening');
        setTimeout(() => shutter.remove(), 600);
      }, 2000);
    }

    // =========================================
    // ENHANCED API COMMUNICATION
    // =========================================

    /**
     * Create exam session on backend
     * @param {string} examId - Exam ID
     * @returns {Promise<Object>} Session data
     */
    async createExamSession(examId) {
      try {
        const response = await fetch(`${this.config.apiBase}/api/v1/exams/${examId}/start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('pmerit_auth_token')}`
          },
          body: JSON.stringify({
            exam_id: examId,
            started_at: new Date().toISOString(),
            user_agent: navigator.userAgent,
            screen_resolution: `${window.screen.width}x${window.screen.height}`
          })
        });

        if (!response.ok) throw new Error('Failed to create exam session');

        const data = await response.json();
        this.state.sessionId = data.session_id;
        return data;

      } catch (error) {
        console.error('Failed to create exam session:', error);
        // Continue anyway - session can be synced later
        return null;
      }
    }

    /**
     * Update exam session status
     * @param {Object} data - Update data
     */
    async updateExamSession(data) {
      if (!this.state.sessionId) return;

      try {
        await fetch(`${this.config.apiBase}/api/v1/exams/sessions/${this.state.sessionId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('pmerit_auth_token')}`
          },
          body: JSON.stringify({
            ...data,
            updated_at: new Date().toISOString()
          })
        });
      } catch (error) {
        console.warn('Failed to update exam session:', error);
      }
    }

    /**
     * Submit violation to backend
     * @param {Object} violation - Violation data
     */
    async submitViolationToAPI(violation) {
      if (!this.state.sessionId) return;

      try {
        await fetch(`${this.config.apiBase}/api/v1/exams/sessions/${this.state.sessionId}/violations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('pmerit_auth_token')}`
          },
          body: JSON.stringify(violation)
        });
      } catch (error) {
        console.warn('Failed to submit violation:', error);
        // Store locally for retry
        const stored = JSON.parse(localStorage.getItem('pmerit_pending_violations') || '[]');
        stored.push({ ...violation, session_id: this.state.sessionId });
        localStorage.setItem('pmerit_pending_violations', JSON.stringify(stored));
      }
    }

    /**
     * Finalize exam session
     * @param {Object} result - Final exam result
     */
    async finalizeExamSession(result) {
      if (!this.state.sessionId) return;

      try {
        await fetch(`${this.config.apiBase}/api/v1/exams/sessions/${this.state.sessionId}/finalize`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('pmerit_auth_token')}`
          },
          body: JSON.stringify({
            ...result,
            ended_at: new Date().toISOString(),
            duration_seconds: Math.floor((this.state.endTime - this.state.startTime) / 1000),
            total_violations: this.state.violationCount,
            violations: this.state.violations
          })
        });

        // Show camera shutter animation
        this.showCameraShutter();

      } catch (error) {
        console.error('Failed to finalize exam session:', error);
      }
    }

    // =========================================
    // ENHANCED PROCTOR UI MODE
    // =========================================

    /**
     * Enter full proctor mode with all UI transformations
     */
    enterProctorMode() {
      // Add proctor classes
      document.body.classList.add('proctor-mode', 'exam-active');

      // Dim UI
      this.dimUI();

      // Retract sidebars
      this.retractSidebars();

      // Move avatar to corner
      this.moveAvatarToCorner();

      // Update proctor status
      this.updateProctorStatus('active');

      console.log('🔐 Entered Proctor Mode');
    }

    /**
     * Exit proctor mode and restore UI
     */
    exitProctorMode() {
      // Remove proctor classes
      document.body.classList.remove('proctor-mode', 'exam-active');

      // Restore UI
      this.restoreUI();

      // Expand sidebars
      this.expandSidebars();

      // Restore avatar position
      this.restoreAvatarPosition();

      // Update proctor status
      this.updateProctorStatus('off');

      console.log('🔓 Exited Proctor Mode');
    }

    /**
     * Update proctor status indicator
     * @param {string} status - 'off', 'active', 'warning', 'violation'
     */
    updateProctorStatus(status) {
      const indicator = document.getElementById('proctor-status') ||
                        document.querySelector('.proctor-status');

      if (!indicator) return;

      // Remove all state classes
      indicator.classList.remove('off', 'active', 'warning', 'violation');
      indicator.classList.add(status);

      // Update text
      const statusText = indicator.querySelector('.status-text');
      if (statusText) {
        const texts = {
          off: 'Proctor: Off',
          active: 'AI Proctor Active',
          warning: 'Warning Issued',
          violation: 'Violation Detected'
        };
        statusText.textContent = texts[status] || 'Proctor: Off';
      }
    }

    /**
     * Dim UI during exam
     */
    dimUI() {
      const appContainer = document.querySelector('.app-container');
      if (appContainer) {
        appContainer.style.transition = 'filter 0.5s ease';
        appContainer.style.filter = 'saturate(0.7)';
      }
    }

    /**
     * Restore UI after exam
     */
    restoreUI() {
      const appContainer = document.querySelector('.app-container');
      if (appContainer) {
        appContainer.style.filter = 'none';
      }
    }

    /**
     * Retract sidebars during exam
     */
    retractSidebars() {
      const leftPanel = document.querySelector('.left-panel');
      const rightPanel = document.querySelector('.right-panel');

      if (leftPanel) {
        leftPanel.style.transition = 'transform 0.5s ease, opacity 0.5s ease';
        leftPanel.style.transform = 'translateX(-100%)';
        leftPanel.style.opacity = '0';
        leftPanel.style.pointerEvents = 'none';
      }

      if (rightPanel) {
        rightPanel.style.transition = 'transform 0.5s ease, opacity 0.5s ease';
        rightPanel.style.transform = 'translateX(100%)';
        rightPanel.style.opacity = '0';
        rightPanel.style.pointerEvents = 'none';
      }
    }

    /**
     * Expand sidebars after exam
     */
    expandSidebars() {
      const leftPanel = document.querySelector('.left-panel');
      const rightPanel = document.querySelector('.right-panel');

      if (leftPanel) {
        leftPanel.style.transform = 'translateX(0)';
        leftPanel.style.opacity = '1';
        leftPanel.style.pointerEvents = 'auto';
      }

      if (rightPanel) {
        rightPanel.style.transform = 'translateX(0)';
        rightPanel.style.opacity = '1';
        rightPanel.style.pointerEvents = 'auto';
      }
    }
  }

  // Export violation types for external use
  ProctorController.VIOLATION_TYPES = VIOLATION_TYPES;
  ProctorController.SEVERITY = SEVERITY;

  // Export to window
  window.ProctorController = ProctorController;

  // Create global instance
  window.proctorController = null;

  // Factory function
  window.createProctorSession = async function(examData, config = {}) {
    window.proctorController = new ProctorController(config);

    // Create session on backend
    await window.proctorController.createExamSession(examData.exam_id || examData.id);

    // Initialize proctor mode
    await window.proctorController.init(examData);

    return window.proctorController;
  };

  console.log('✅ ProctorController module loaded (v2.0 - Digital Desk)');

})(window);
