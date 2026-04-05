/**
 * PMERIT Classroom Session Module
 * Phase 5: Virtual Classroom - Session Management & API Integration
 *
 * @version 1.0.0
 * @created December 6, 2025
 */

window.ClassroomSession = (function () {
  'use strict';

  const API_BASE_URL = window.CONFIG?.API_BASE_URL || 'https://api.pmerit.com';

  // Session state
  let sessionState = {
    sessionId: null,
    userId: null,
    courseId: null,
    lessonId: null,
    startedAt: null,
    course: null,
    lesson: null,
    interactions: [],
    handRaises: 0,
    questionsAsked: 0,
    progressPercent: 0
  };

  /**
   * Initialize a classroom session
   * @param {string} courseId - Course ID or slug
   * @param {string} [lessonId] - Optional lesson ID
   * @param {Object} [options] - Options { allowGuest: boolean }
   * @returns {Promise<Object>} Session data
   */
  async function startSession(courseId, lessonId = null, options = {}) {
    const user = window.AUTH?.getCurrentUser();
    const allowGuest = options.allowGuest !== false; // Default to allowing guest mode

    // Allow guest/preview mode without authentication
    if (!user || !user.id) {
      if (!allowGuest) {
        throw new Error('User must be logged in to start a classroom session');
      }
      // Guest preview mode - use localStorage for tracking
      console.log('📖 Starting classroom in guest preview mode');
      sessionState.userId = 'guest';
      sessionState.courseId = courseId;
      sessionState.lessonId = lessonId;
      sessionState.guestMode = true;
      sessionState.sessionId = `guest-${Date.now()}`;
      sessionState.startedAt = new Date().toISOString();

      // Return minimal session data for guest mode
      return {
        success: true,
        sessionId: sessionState.sessionId,
        course: { id: courseId, title: 'Preview Mode' },
        lesson: null,
        resumed: false,
        guestMode: true
      };
    }

    sessionState.userId = user.id;
    sessionState.courseId = courseId;
    sessionState.lessonId = lessonId;
    sessionState.guestMode = false;

    try {
      const payload = {
        user_id: user.id,
        course_id: courseId
      };
      if (lessonId) {
        payload.lesson_id = lessonId;
      }

      const response = await fetch(`${API_BASE_URL}/api/v1/classroom/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to start session');
      }

      // Update session state
      sessionState.sessionId = data.session.session_id;
      sessionState.startedAt = data.session.started_at;
      sessionState.course = data.course;
      sessionState.lesson = data.lesson;

      // Check if this was a resumed session
      if (data.session.resumed) {
        console.log('📚 Resumed existing classroom session:', sessionState.sessionId);
      } else {
        console.log('🎓 Started new classroom session:', sessionState.sessionId);
      }

      return {
        success: true,
        sessionId: sessionState.sessionId,
        course: sessionState.course,
        lesson: sessionState.lesson,
        resumed: data.session.resumed || false
      };

    } catch (error) {
      console.error('Failed to start classroom session:', error);
      throw error;
    }
  }

  /**
   * Get current session details
   * @returns {Promise<Object>} Session details
   */
  async function getSession() {
    if (!sessionState.sessionId) {
      throw new Error('No active session');
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/classroom/sessions/${sessionState.sessionId}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to get session');
      }

      return data.session;

    } catch (error) {
      console.error('Failed to get session:', error);
      throw error;
    }
  }

  /**
   * Update session progress
   * @param {Object} updates - Progress updates
   * @returns {Promise<Object>} Updated session
   */
  async function updateProgress(updates) {
    if (!sessionState.sessionId) {
      throw new Error('No active session');
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/classroom/sessions/${sessionState.sessionId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updates)
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to update session');
      }

      // Update local state
      if (updates.progress_percentage !== undefined) {
        sessionState.progressPercent = updates.progress_percentage;
      }

      return data.session;

    } catch (error) {
      console.error('Failed to update session:', error);
      throw error;
    }
  }

  /**
   * End the classroom session
   * @param {string} [notes] - Optional notes to save
   * @returns {Promise<Object>} Final session data
   */
  async function endSession(notes = null) {
    if (!sessionState.sessionId) {
      throw new Error('No active session');
    }

    try {
      const payload = {
        end_session: true
      };
      if (notes) {
        payload.notes = notes;
      }

      const response = await fetch(`${API_BASE_URL}/api/v1/classroom/sessions/${sessionState.sessionId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to end session');
      }

      console.log('✅ Classroom session ended:', sessionState.sessionId);

      // Clear session state
      const finalSession = { ...sessionState, ...data.session };
      sessionState = {
        sessionId: null,
        userId: null,
        courseId: null,
        lessonId: null,
        startedAt: null,
        course: null,
        lesson: null,
        interactions: [],
        handRaises: 0,
        questionsAsked: 0,
        progressPercent: 0
      };

      return finalSession;

    } catch (error) {
      console.error('Failed to end session:', error);
      throw error;
    }
  }

  /**
   * Log an interaction (hand raise, question, etc.)
   * @param {string} type - Interaction type: hand_raise, question, pause, resume, skip, note, bookmark
   * @param {Object} [details] - Additional details
   * @returns {Promise<Object>} Interaction data
   */
  async function logInteraction(type, details = {}) {
    if (!sessionState.sessionId) {
      console.warn('No active session for interaction logging');
      return null;
    }

    // Guest mode - store interactions locally only
    if (sessionState.guestMode) {
      const interaction = {
        id: `local-${Date.now()}`,
        type: type,
        timestamp: new Date().toISOString(),
        details: details
      };

      // Update local counters
      if (type === 'hand_raise') {
        sessionState.handRaises++;
      }
      if (type === 'question') {
        sessionState.questionsAsked++;
      }

      sessionState.interactions.push(interaction);
      console.log('📝 Guest interaction logged:', type);
      return interaction;
    }

    try {
      const payload = {
        session_id: sessionState.sessionId,
        interaction_type: type,
        student_question: details.question || null,
        ai_response: details.response || null,
        response_time_ms: details.responseTimeMs || null,
        lesson_position: details.position || null
      };

      const response = await fetch(`${API_BASE_URL}/api/v1/classroom/interactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to log interaction');
      }

      // Update local counters
      if (type === 'hand_raise') {
        sessionState.handRaises++;
      }
      if (type === 'question') {
        sessionState.questionsAsked++;
      }

      sessionState.interactions.push({
        id: data.interaction.interaction_id,
        type: type,
        timestamp: data.interaction.created_at
      });

      return data.interaction;

    } catch (error) {
      console.error('Failed to log interaction:', error);
      return null;
    }
  }

  /**
   * Raise hand / Ask question (shortcut)
   * @param {string} question - The student's question
   * @returns {Promise<Object>} Interaction data
   */
  async function raiseHand(question) {
    return logInteraction('hand_raise', { question });
  }

  /**
   * Get lesson details
   * @param {string} lessonId - Lesson ID
   * @returns {Promise<Object>} Lesson data with navigation
   */
  async function getLessonDetails(lessonId) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/lessons/${lessonId}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to get lesson');
      }

      return {
        lesson: data.lesson,
        navigation: data.navigation
      };

    } catch (error) {
      console.error('Failed to get lesson details:', error);
      throw error;
    }
  }

  /**
   * Get course modules and lessons
   * @param {string} courseId - Course ID
   * @returns {Promise<Array>} Modules with lessons
   */
  async function getCourseModules(courseId) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/courses/${courseId}/modules`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to get modules');
      }

      // Fetch lessons for each module (use module_id from API response)
      const modulesWithLessons = await Promise.all(
        data.modules.map(async (module) => {
          try {
            const moduleId = module.module_id || module.id;
            const lessonsResp = await fetch(`${API_BASE_URL}/api/v1/modules/${moduleId}/lessons`);
            const lessonsData = await lessonsResp.json();
            return {
              ...module,
              id: moduleId, // Normalize to 'id' for backward compatibility
              lessons: lessonsData.success ? lessonsData.lessons : []
            };
          } catch (e) {
            return { ...module, id: module.module_id || module.id, lessons: [] };
          }
        })
      );

      return modulesWithLessons;

    } catch (error) {
      console.error('Failed to get course modules:', error);
      throw error;
    }
  }

  /**
   * Get user's session history for a course
   * @param {string} [courseId] - Optional course filter
   * @returns {Promise<Object>} Session history
   */
  async function getSessionHistory(courseId = null) {
    const user = window.AUTH?.getCurrentUser();
    if (!user || !user.id) {
      throw new Error('User must be logged in');
    }

    try {
      let url = `${API_BASE_URL}/api/v1/users/${user.id}/classroom/sessions`;
      if (courseId) {
        url += `?course_id=${courseId}`;
      }

      const response = await fetch(url);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to get session history');
      }

      return {
        sessions: data.sessions,
        totals: data.totals
      };

    } catch (error) {
      console.error('Failed to get session history:', error);
      throw error;
    }
  }

  /**
   * Get current session state (local)
   * @returns {Object} Current session state
   */
  function getState() {
    return { ...sessionState };
  }

  /**
   * Check if there's an active session
   * @returns {boolean}
   */
  function hasActiveSession() {
    // Check if sessionId exists and is a valid UUID format
    if (!sessionState.sessionId) return false;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(sessionState.sessionId);
  }

  /**
   * Check if current session is guest mode
   * @returns {boolean}
   */
  function isGuestMode() {
    return !!sessionState.guestMode;
  }

  // Public API
  return {
    startSession,
    isGuestMode,
    getSession,
    updateProgress,
    endSession,
    logInteraction,
    raiseHand,
    getLessonDetails,
    getCourseModules,
    getSessionHistory,
    getState,
    hasActiveSession
  };

})();
