/**
 * k12-curriculum-nav.js - K-12 Curriculum Navigation Module
 *
 * @version 1.0.0
 * @created January 13, 2026 (Session 13)
 * @scope SCOPE_K12_EDUCATION
 *
 * Shared module for K-12 dashboards to load and display curriculum navigation.
 * Loads subjects from API based on user's grade level.
 *
 * Usage:
 *   <script src="/assets/js/k12-curriculum-nav.js"></script>
 *   <script>
 *     K12CurriculumNav.init({ gradeId: 'grade-uuid', containerId: 'subjects-grid' });
 *   </script>
 */
(function() {
    'use strict';

    const API_BASE = window.CONFIG?.API_BASE_URL || 'https://api.pmerit.com';

    // Subject icons mapping
    const SUBJECT_ICONS = {
        'MATH': { icon: 'fas fa-calculator', emoji: '🔢', color: '#3498DB' },
        'ELA': { icon: 'fas fa-book-open', emoji: '📖', color: '#E67E22' },
        'SCI': { icon: 'fas fa-flask', emoji: '🔬', color: '#27AE60' },
        'SS': { icon: 'fas fa-globe', emoji: '🌍', color: '#8E44AD' },
        'LCR': { icon: 'fas fa-heart', emoji: '🎨', color: '#E74C3C' }
    };

    // Module state
    let config = {
        gradeId: null,
        containerId: 'subjects-grid',
        onSubjectClick: null,
        showLessonCount: true,
        cardStyle: 'default' // 'default', 'k2', 'gamified', 'dark', 'professional'
    };

    /**
     * Initialize the curriculum navigation
     * @param {Object} options - Configuration options
     * @param {string} options.gradeId - The grade UUID
     * @param {string} options.containerId - The container element ID
     * @param {Function} options.onSubjectClick - Callback when subject clicked
     * @param {boolean} options.showLessonCount - Show lesson count on cards
     * @param {string} options.cardStyle - Card style variant
     */
    function init(options = {}) {
        config = { ...config, ...options };

        if (config.gradeId) {
            loadSubjects(config.gradeId);
        } else {
            // Try to get grade from user profile
            loadUserGradeAndSubjects();
        }
    }

    /**
     * Load user's grade from profile, then load subjects
     */
    async function loadUserGradeAndSubjects() {
        try {
            const token = localStorage.getItem('pmerit_token');
            if (!token) {
                showMessage('Please log in to see your subjects');
                return;
            }

            // Get user profile with grade info
            const response = await fetch(`${API_BASE}/api/v1/users/me`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const data = await response.json();
                if (data.user?.grade_id) {
                    config.gradeId = data.user.grade_id;
                    loadSubjects(config.gradeId);
                } else {
                    showMessage('Grade level not set');
                }
            }
        } catch (err) {
            console.error('Failed to load user profile:', err);
            showMessage('Failed to load subjects');
        }
    }

    /**
     * Load subjects for a grade
     */
    async function loadSubjects(gradeId) {
        const container = document.getElementById(config.containerId);
        if (!container) {
            console.error('Curriculum nav container not found:', config.containerId);
            return;
        }

        // Show loading
        container.innerHTML = '<div class="curriculum-nav-loading">Loading subjects...</div>';

        try {
            const token = localStorage.getItem('pmerit_token');
            const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

            const response = await fetch(`${API_BASE}/api/v1/k12/grades/${gradeId}/subjects`, { headers });
            const data = await response.json();

            if (data.success && data.subjects) {
                renderSubjects(container, data.subjects, data.grade);
            } else {
                showMessage('No subjects available', container);
            }
        } catch (err) {
            console.error('Failed to load subjects:', err);
            showMessage('Failed to load subjects', container);
        }
    }

    /**
     * Render subject cards
     */
    function renderSubjects(container, subjects, grade) {
        if (!subjects || subjects.length === 0) {
            container.innerHTML = '<div class="curriculum-nav-empty">No subjects available</div>';
            return;
        }

        container.innerHTML = subjects.map(subject => {
            const iconData = SUBJECT_ICONS[subject.subject_code] || SUBJECT_ICONS['LCR'];
            const lessonCount = subject.lesson_count || 0;
            const unitCount = subject.unit_count || 0;

            return renderSubjectCard(subject, iconData, lessonCount, unitCount, grade);
        }).join('');

        // Add click handlers
        container.querySelectorAll('.curriculum-subject-card').forEach(card => {
            card.addEventListener('click', (e) => {
                const subjectId = card.dataset.subjectId;
                const gradeId = card.dataset.gradeId;

                if (config.onSubjectClick) {
                    config.onSubjectClick(subjectId, gradeId);
                } else {
                    // Default: navigate to units page
                    window.location.href = `/portal/units.html?grade=${gradeId}&subject=${subjectId}`;
                }
            });
        });
    }

    /**
     * Render a single subject card based on style
     */
    function renderSubjectCard(subject, iconData, lessonCount, unitCount, grade) {
        const gradeId = grade?.grade_id || config.gradeId;

        switch (config.cardStyle) {
            case 'k2':
                return `
                    <a href="/portal/units.html?grade=${gradeId}&subject=${subject.subject_id}"
                       class="curriculum-subject-card k2-style"
                       data-subject-id="${subject.subject_id}"
                       data-grade-id="${gradeId}"
                       style="--card-color: ${iconData.color}">
                        <div class="card-icon">${iconData.emoji}</div>
                        <div class="card-name">${subject.subject_name}</div>
                        ${config.showLessonCount ? `<div class="card-count">${lessonCount} lessons</div>` : ''}
                    </a>
                `;

            case 'gamified':
                return `
                    <a href="/portal/units.html?grade=${gradeId}&subject=${subject.subject_id}"
                       class="curriculum-subject-card gamified-style"
                       data-subject-id="${subject.subject_id}"
                       data-grade-id="${gradeId}">
                        <div class="card-icon" style="color: ${iconData.color}">
                            <i class="${iconData.icon}"></i>
                        </div>
                        <div class="card-info">
                            <div class="card-name">${subject.subject_name}</div>
                            ${config.showLessonCount ? `
                                <div class="card-progress">
                                    <span class="xp-badge">${unitCount} units</span>
                                    <span class="lesson-badge">${lessonCount} lessons</span>
                                </div>
                            ` : ''}
                        </div>
                        <i class="fas fa-chevron-right card-arrow"></i>
                    </a>
                `;

            case 'dark':
                return `
                    <a href="/portal/units.html?grade=${gradeId}&subject=${subject.subject_id}"
                       class="curriculum-subject-card dark-style"
                       data-subject-id="${subject.subject_id}"
                       data-grade-id="${gradeId}">
                        <div class="card-icon-wrapper" style="background: linear-gradient(135deg, ${iconData.color}, ${iconData.color}88)">
                            <i class="${iconData.icon}"></i>
                        </div>
                        <div class="card-content">
                            <div class="card-name">${subject.subject_name}</div>
                            <div class="card-meta">${unitCount} units • ${lessonCount} lessons</div>
                        </div>
                    </a>
                `;

            case 'professional':
                return `
                    <a href="/portal/units.html?grade=${gradeId}&subject=${subject.subject_id}"
                       class="curriculum-subject-card professional-style"
                       data-subject-id="${subject.subject_id}"
                       data-grade-id="${gradeId}">
                        <div class="card-header">
                            <i class="${iconData.icon}" style="color: ${iconData.color}"></i>
                            <span class="card-name">${subject.subject_name}</span>
                        </div>
                        <div class="card-stats">
                            <span>${unitCount} units</span>
                            <span>${lessonCount} lessons</span>
                        </div>
                    </a>
                `;

            default:
                return `
                    <a href="/portal/units.html?grade=${gradeId}&subject=${subject.subject_id}"
                       class="curriculum-subject-card default-style"
                       data-subject-id="${subject.subject_id}"
                       data-grade-id="${gradeId}">
                        <div class="card-icon">
                            <i class="${iconData.icon}" style="color: ${iconData.color}"></i>
                        </div>
                        <div class="card-name">${subject.subject_name}</div>
                        ${config.showLessonCount ? `<div class="card-count">${lessonCount} lessons</div>` : ''}
                    </a>
                `;
        }
    }

    /**
     * Show a message in the container
     */
    function showMessage(message, container) {
        container = container || document.getElementById(config.containerId);
        if (container) {
            container.innerHTML = `<div class="curriculum-nav-message">${message}</div>`;
        }
    }

    /**
     * Get subject icon data
     */
    function getSubjectIcon(subjectCode) {
        return SUBJECT_ICONS[subjectCode] || SUBJECT_ICONS['LCR'];
    }

    // Expose module
    window.K12CurriculumNav = {
        init,
        loadSubjects,
        getSubjectIcon,
        SUBJECT_ICONS
    };
})();
