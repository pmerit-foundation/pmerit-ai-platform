/**
 * PMERIT Dashboard Courses Module
 * Handles course enrollments, recommendations, and progress display
 *
 * @version 1.0.0
 * @created December 6, 2025
 * Phase 4: Dashboard & Courses
 */

(function () {
  'use strict';

  const API_BASE = 'https://api.pmerit.com/api/v1';

  const DashboardCourses = {
    /**
     * Fetch user's enrolled courses from API
     * @returns {Promise<{success: boolean, enrollments: Array, error?: string}>}
     */
    getEnrollments: async function () {
      const user = window.AUTH?.getCurrentUser();

      // Handle both 'id' (mock/local) and 'userId' (API response) property names
      const userId = user?.id || user?.userId;

      if (!user || !userId) {
        return { success: false, enrollments: [], error: 'User not authenticated' };
      }

      // Mock users don't have real enrollments
      if (userId.startsWith('mock-')) {
        return { success: true, enrollments: [], message: 'Mock user - no enrollments' };
      }

      try {
        const response = await fetch(`${API_BASE}/users/${userId}/enrollments`);
        const data = await response.json();

        if (data.success) {
          return { success: true, enrollments: data.enrollments || [] };
        }

        return { success: false, enrollments: [], error: data.error || 'Failed to fetch enrollments' };
      } catch (error) {
        console.error('Error fetching enrollments:', error);
        return { success: false, enrollments: [], error: 'Network error' };
      }
    },

    /**
     * Enroll user in a course
     * @param {string} courseId - Course UUID or slug
     * @returns {Promise<{success: boolean, enrollment?: object, error?: string}>}
     */
    enrollInCourse: async function (courseId) {
      const user = window.AUTH?.getCurrentUser();

      // Handle both 'id' (mock/local) and 'userId' (API response) property names
      const userId = user?.id || user?.userId;

      if (!user || !userId) {
        return { success: false, error: 'User not authenticated' };
      }

      if (userId.startsWith('mock-')) {
        return { success: false, error: 'Mock users cannot enroll. Please sign up for a real account.' };
      }

      try {
        const response = await fetch(`${API_BASE}/courses/${courseId}/enroll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId })
        });

        const data = await response.json();
        return {
          success: data.success,
          enrollment: data.enrollment,
          error: data.error
        };
      } catch (error) {
        console.error('Error enrolling in course:', error);
        return { success: false, error: 'Network error' };
      }
    },

    /**
     * Unenroll (drop) user from a course
     * @param {string} courseId - Course UUID or slug
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    dropCourse: async function (courseId) {
      const user = window.AUTH?.getCurrentUser();

      // Handle both 'id' (mock/local) and 'userId' (API response) property names
      const userId = user?.id || user?.userId;

      if (!user || !userId) {
        return { success: false, error: 'User not authenticated' };
      }

      try {
        const response = await fetch(`${API_BASE}/courses/${courseId}/enroll`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId })
        });

        const data = await response.json();
        return {
          success: data.success,
          error: data.error
        };
      } catch (error) {
        console.error('Error dropping course:', error);
        return { success: false, error: 'Network error' };
      }
    },

    /**
     * Get all available courses
     * @param {string} pathwayId - Optional pathway filter
     * @returns {Promise<{success: boolean, courses: Array}>}
     */
    getCourses: async function (pathwayId = null) {
      try {
        let url = `${API_BASE}/courses`;
        if (pathwayId) {
          url += `?pathway_id=${pathwayId}`;
        }

        const response = await fetch(url);
        const data = await response.json();

        return {
          success: data.success,
          courses: data.courses || [],
          count: data.count || 0
        };
      } catch (error) {
        console.error('Error fetching courses:', error);
        return { success: false, courses: [], error: 'Network error' };
      }
    },

    /**
     * Get all pathways
     * @param {string} trackType - Optional track type filter (global_remote, local_education, local_career)
     * @returns {Promise<{success: boolean, pathways: Array}>}
     */
    getPathways: async function (trackType = null) {
      try {
        let url = `${API_BASE}/pathways`;
        if (trackType) {
          url += `?track_type=${trackType}`;
        }

        const response = await fetch(url);
        const data = await response.json();

        return {
          success: data.success,
          pathways: data.pathways || [],
          count: data.count || 0
        };
      } catch (error) {
        console.error('Error fetching pathways:', error);
        return { success: false, pathways: [], error: 'Network error' };
      }
    },

    /**
     * Get recommended pathways based on assessment results
     * @returns {Promise<{success: boolean, recommendations: Array}>}
     */
    getRecommendations: async function () {
      // Check for stored assessment results
      const assessmentResults = localStorage.getItem('pmerit_assessment_results');

      if (!assessmentResults) {
        return { success: false, recommendations: [], message: 'No assessment results found' };
      }

      try {
        const results = JSON.parse(assessmentResults);
        const hollandCode = results.hollandCode?.code || results.holland_code || '';
        const careerMatches = results.careerMatches || results.career_matches || [];

        // Map Holland codes to pathway recommendations
        const recommendations = this._mapHollandToPathways(hollandCode, careerMatches);

        return {
          success: true,
          recommendations: recommendations,
          hollandCode: hollandCode,
          basedOn: 'assessment_results'
        };
      } catch (error) {
        console.error('Error parsing assessment results:', error);
        return { success: false, recommendations: [], error: 'Invalid assessment data' };
      }
    },

    /**
     * Map Holland code to pathway recommendations
     * @private
     */
    _mapHollandToPathways: function (hollandCode, careerMatches) {
      // Holland code to pathway mapping
      const hollandPathwayMap = {
        'R': ['skilled-trades', 'healthcare-careers'], // Realistic
        'I': ['data-analytics', 'web-development'], // Investigative
        'A': ['ux-design', 'digital-marketing'], // Artistic
        'S': ['healthcare-careers', 'public-service', 'early-childhood'], // Social
        'E': ['project-management', 'business-analysis', 'digital-marketing'], // Enterprising
        'C': ['data-analytics', 'business-analysis'] // Conventional
      };

      const recommendations = [];
      const seenPathways = new Set();

      // Add pathways based on first two Holland letters
      for (let i = 0; i < Math.min(2, hollandCode.length); i++) {
        const letter = hollandCode[i].toUpperCase();
        const pathways = hollandPathwayMap[letter] || [];

        pathways.forEach(slug => {
          if (!seenPathways.has(slug)) {
            seenPathways.add(slug);
            recommendations.push({
              pathway_slug: slug,
              match_reason: `Strong ${this._getHollandDescription(letter)} orientation`,
              priority: i + 1
            });
          }
        });
      }

      return recommendations.slice(0, 4); // Return top 4 recommendations
    },

    /**
     * Get Holland code description
     * @private
     */
    _getHollandDescription: function (letter) {
      const descriptions = {
        'R': 'Realistic (hands-on, practical)',
        'I': 'Investigative (analytical, intellectual)',
        'A': 'Artistic (creative, expressive)',
        'S': 'Social (helping, teaching)',
        'E': 'Enterprising (leading, persuading)',
        'C': 'Conventional (organizing, detail-oriented)'
      };
      return descriptions[letter] || letter;
    },

    /**
     * Render enrolled courses HTML
     * @param {Array} enrollments - List of enrollment objects
     * @returns {string} HTML string
     */
    renderEnrolledCourses: function (enrollments) {
      if (!enrollments || enrollments.length === 0) {
        return `
          <div class="empty-state">
            <i class="fas fa-book-open fa-3x" style="color: var(--color-muted); margin-bottom: 1rem;"></i>
            <h3>No Enrolled Courses</h3>
            <p>You haven't enrolled in any courses yet. Browse our catalog to get started!</p>
            <a href="/courses.html" class="btn btn-primary">
              <i class="fas fa-search"></i> Browse Courses
            </a>
          </div>
        `;
      }

      const courseCards = enrollments.map(enrollment => {
        const progressPercent = enrollment.progress_percentage || 0;
        const statusClass = this._getStatusClass(enrollment.status);
        const statusLabel = this._getStatusLabel(enrollment.status);

        return `
          <div class="enrolled-course-card" data-course-id="${enrollment.course_id}">
            <div class="course-header">
              <h4>${enrollment.title}</h4>
              <span class="course-status ${statusClass}">${statusLabel}</span>
            </div>
            <p class="course-description">${enrollment.description || 'No description available'}</p>
            <div class="course-meta">
              <span><i class="fas fa-signal"></i> ${enrollment.difficulty_level || 'Beginner'}</span>
              <span><i class="fas fa-clock"></i> ${enrollment.estimated_hours || '?'} hours</span>
              ${enrollment.pathway_name ? `<span><i class="fas fa-route"></i> ${enrollment.pathway_name}</span>` : ''}
            </div>
            <div class="course-progress">
              <div class="progress-bar">
                <div class="progress-fill" style="width: ${progressPercent}%"></div>
              </div>
              <span class="progress-text">${Math.round(progressPercent)}% complete (${enrollment.lessons_completed || 0}/${enrollment.total_lessons || 0} lessons)</span>
            </div>
            <div class="course-actions">
              <a href="/portal/classroom.html?courseId=${enrollment.course_id}" class="btn btn-primary btn-sm">
                <i class="fas fa-play"></i> Continue Learning
              </a>
              <button class="btn btn-outline btn-sm" onclick="DashboardCourses.showCourseDetails('${enrollment.course_id}')">
                <i class="fas fa-info-circle"></i> Details
              </button>
              <button class="btn btn-danger btn-sm" onclick="DashboardCourses.confirmDropCourse('${enrollment.course_id}', '${enrollment.title.replace(/'/g, "\\'")}')">
                <i class="fas fa-times"></i> Drop
              </button>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="enrolled-courses-grid">
          ${courseCards}
        </div>
      `;
    },

    /**
     * Get status CSS class
     * @private
     */
    _getStatusClass: function (status) {
      const classes = {
        'not_started': 'status-pending',
        'in_progress': 'status-active',
        'completed': 'status-complete',
        'paused': 'status-paused'
      };
      return classes[status] || 'status-pending';
    },

    /**
     * Get status display label
     * @private
     */
    _getStatusLabel: function (status) {
      const labels = {
        'not_started': 'Not Started',
        'in_progress': 'In Progress',
        'completed': 'Completed',
        'paused': 'Paused'
      };
      return labels[status] || 'Not Started';
    },

    /**
     * Show course details modal
     */
    showCourseDetails: function (courseId) {
      // Placeholder for course details modal
      alert('Course details coming soon! Course ID: ' + courseId);
    },

    /**
     * Confirm and drop a course
     */
    confirmDropCourse: async function (courseId, courseTitle) {
      const confirmed = confirm(`Are you sure you want to drop "${courseTitle}"?\n\nYour progress will be saved, but you'll need to re-enroll to continue.`);

      if (!confirmed) return;

      const result = await this.dropCourse(courseId);

      if (result.success) {
        alert('Course dropped successfully.');
        // Refresh the enrollments display
        this.loadAndDisplayEnrollments();
      } else {
        alert('Failed to drop course: ' + (result.error || 'Unknown error'));
      }
    },

    /**
     * Load and display enrollments in the dashboard
     */
    loadAndDisplayEnrollments: async function () {
      const container = document.getElementById('enrolled-courses-container');
      if (!container) return;

      // Show loading state
      container.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Loading your courses...</div>';

      const result = await this.getEnrollments();

      if (result.success) {
        container.innerHTML = this.renderEnrolledCourses(result.enrollments);
      } else {
        container.innerHTML = `
          <div class="error-state">
            <i class="fas fa-exclamation-circle"></i>
            <p>Failed to load courses: ${result.error || 'Unknown error'}</p>
            <button class="btn btn-outline btn-sm" onclick="DashboardCourses.loadAndDisplayEnrollments()">
              <i class="fas fa-redo"></i> Retry
            </button>
          </div>
        `;
      }
    },

    /**
     * Load and display pathway progress (P4.5)
     */
    loadAndDisplayPathwayProgress: async function () {
      const container = document.getElementById('pathway-progress-container');
      if (!container) return;

      const enrollments = await this.getEnrollments();

      if (!enrollments.success || enrollments.enrollments.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <p>Enroll in courses to see your pathway progress.</p>
          </div>
        `;
        return;
      }

      // Group enrollments by pathway
      const pathwayGroups = {};
      enrollments.enrollments.forEach(enrollment => {
        const pathwaySlug = enrollment.pathway_slug || 'uncategorized';
        if (!pathwayGroups[pathwaySlug]) {
          pathwayGroups[pathwaySlug] = {
            name: enrollment.pathway_name || 'Individual Courses',
            trackType: enrollment.track_type || 'general',
            courses: [],
            totalLessons: 0,
            completedLessons: 0
          };
        }
        pathwayGroups[pathwaySlug].courses.push(enrollment);
        pathwayGroups[pathwaySlug].totalLessons += enrollment.total_lessons || 0;
        pathwayGroups[pathwaySlug].completedLessons += enrollment.lessons_completed || 0;
      });

      const pathwayCards = Object.entries(pathwayGroups).map(([slug, pathway]) => {
        const progressPercent = pathway.totalLessons > 0
          ? Math.round((pathway.completedLessons / pathway.totalLessons) * 100)
          : 0;

        const completedCourses = pathway.courses.filter(c => c.status === 'completed').length;
        const totalCourses = pathway.courses.length;

        return `
          <div class="pathway-progress-card">
            <div class="pathway-header">
              <h4>${pathway.name}</h4>
              <span class="track-badge">${this._formatTrackType(pathway.trackType)}</span>
            </div>
            <div class="pathway-stats">
              <span><i class="fas fa-book"></i> ${completedCourses}/${totalCourses} courses</span>
              <span><i class="fas fa-tasks"></i> ${pathway.completedLessons}/${pathway.totalLessons} lessons</span>
            </div>
            <div class="course-progress">
              <div class="progress-bar">
                <div class="progress-fill" style="width: ${progressPercent}%"></div>
              </div>
              <span class="progress-text">${progressPercent}% complete</span>
            </div>
            <a href="/pathways.html#${slug}" class="btn btn-outline btn-sm">
              <i class="fas fa-eye"></i> View Pathway
            </a>
          </div>
        `;
      }).join('');

      container.innerHTML = `
        <h3><i class="fas fa-route"></i> Learning Path Progress</h3>
        <div class="pathway-progress-grid">
          ${pathwayCards}
        </div>
      `;
    },

    /**
     * Format track type for display
     * @private
     */
    _formatTrackType: function (trackType) {
      const labels = {
        'global_remote': 'Global Remote',
        'local_education': 'Local Education',
        'local_career': 'Local Career',
        'general': 'General'
      };
      return labels[trackType] || trackType;
    },

    /**
     * Load and display pathway recommendations
     */
    loadAndDisplayRecommendations: async function () {
      const container = document.getElementById('recommendations-container');
      if (!container) return;

      const result = await this.getRecommendations();

      if (result.success && result.recommendations.length > 0) {
        const pathwaysResult = await this.getPathways();
        const pathwaysMap = {};

        if (pathwaysResult.success) {
          pathwaysResult.pathways.forEach(p => {
            pathwaysMap[p.pathway_slug] = p;
          });
        }

        const recommendationCards = result.recommendations.map(rec => {
          const pathway = pathwaysMap[rec.pathway_slug];
          if (!pathway) return '';

          return `
            <div class="recommendation-card">
              <div class="rec-icon"><i class="fas ${pathway.icon_class || 'fa-graduation-cap'}"></i></div>
              <h4>${pathway.pathway_name}</h4>
              <p>${pathway.description || ''}</p>
              <small class="match-reason">${rec.match_reason}</small>
              <a href="/pathways.html#${pathway.pathway_slug}" class="btn btn-outline btn-sm">
                <i class="fas fa-arrow-right"></i> Explore
              </a>
            </div>
          `;
        }).join('');

        container.innerHTML = `
          <h3><i class="fas fa-star"></i> Recommended for You</h3>
          <p class="subtitle">Based on your assessment results (Holland Code: ${result.hollandCode})</p>
          <div class="recommendations-grid">
            ${recommendationCards}
          </div>
        `;
      } else {
        container.innerHTML = `
          <div class="take-assessment-prompt">
            <i class="fas fa-clipboard-check fa-2x"></i>
            <h4>Discover Your Path</h4>
            <p>Take our free assessment to get personalized pathway recommendations!</p>
            <a href="/assessment-entry.html" class="btn btn-primary">
              <i class="fas fa-play"></i> Start Assessment
            </a>
          </div>
        `;
      }
    }
  };

  // Make available globally
  window.DashboardCourses = DashboardCourses;

  console.log('📚 PMERIT Dashboard Courses module loaded');
})();
