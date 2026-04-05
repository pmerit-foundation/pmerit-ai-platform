/**
 * lesson.js - K-12 Lesson Page Controller
 *
 * @version 1.0.0
 * @created January 13, 2026 (Session 13)
 * @scope SCOPE_K12_EDUCATION
 *
 * Handles:
 * - Loading lesson data from API
 * - Rendering MOOSE content in iframe
 * - AI tutor chat integration
 * - Progress tracking (start/complete)
 * - Navigation between lessons
 */
(function() {
    'use strict';

    const API_BASE = window.CONFIG?.API_BASE_URL || 'https://api.pmerit.com';
    let currentLesson = null;
    let currentPersona = null;
    const pageLoadTime = Date.now();

    // Get lesson ID from URL
    function getLessonId() {
        const params = new URLSearchParams(window.location.search);
        return params.get('id') || params.get('lesson');
    }

    // Get auth headers
    function getAuthHeaders() {
        const token = localStorage.getItem('pmerit_token');
        return token ? { 'Authorization': `Bearer ${token}` } : {};
    }

    // Load lesson data
    async function loadLesson() {
        const lessonId = getLessonId();
        if (!lessonId) {
            showError('No lesson specified. Please select a lesson from your dashboard.');
            return;
        }

        const token = localStorage.getItem('pmerit_token');
        console.log('[Lesson] Loading lesson:', lessonId);
        console.log('[Lesson] Token exists:', !!token);

        try {
            const response = await fetch(`${API_BASE}/api/v1/k12/lessons/${lessonId}`, {
                headers: getAuthHeaders()
            });

            console.log('[Lesson] API response status:', response.status);

            if (!response.ok) {
                if (response.status === 401) {
                    // Distinguish between "not logged in" and "token expired"
                    if (token) {
                        console.warn('[Lesson] Token exists but got 401 - session may be expired');
                        showError('Your session has expired. Please log in again.');
                    } else {
                        showError('Please log in to view this lesson.');
                    }
                    return;
                }
                if (response.status === 404) {
                    showError('Lesson not found. It may have been moved or deleted.');
                    return;
                }
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            console.log('[Lesson] API response:', data);

            if (data.success && data.lesson) {
                // Merge nested response structure into flat object for rendering
                // API returns: { lesson: {...}, context: {...}, ai_context: {...}, standards: {...}, navigation: {...}, progress: {...} }
                const lessonData = {
                    ...data.lesson,
                    // Context fields
                    grade_code: data.context?.grade?.grade_code,
                    grade_name: data.context?.grade?.grade_name,
                    subject_name: data.context?.subject?.subject_name,
                    subject_code: data.context?.subject?.subject_code,
                    unit_id: data.context?.unit?.unit_id,
                    unit_title: data.context?.unit?.unit_title,
                    // Persona (API returns string code, not object)
                    persona: data.context?.persona ? { code: data.context.persona } : null,
                    // AI context for tutor
                    ai_context: data.ai_context?.teaching_approach,
                    common_struggles: data.ai_context?.common_misconceptions,
                    teaching_tips: data.ai_context?.teaching_tips,
                    prerequisite_concepts: data.ai_context?.prerequisite_concepts,
                    // Standards
                    mlr_standards: data.standards,
                    // Navigation
                    navigation: data.navigation,
                    // Progress
                    progress: data.progress
                };

                currentLesson = lessonData;
                currentPersona = lessonData.persona;
                renderLesson(lessonData);

                // Mark as started if authenticated
                if (token && data.progress?.status === 'not_started') {
                    markLessonStarted(lessonId);
                }
            } else {
                showError(data.error || 'Lesson not found');
            }
        } catch (err) {
            console.error('[Lesson] Load lesson error:', err);
            showError('Failed to load lesson. Please try again.');
        }
    }

    // Render lesson data to page
    function renderLesson(lesson) {
        // Title and meta
        document.getElementById('lesson-title').textContent = lesson.title;
        document.getElementById('estimated-time').textContent = `${lesson.estimated_minutes || 30} min`;
        document.getElementById('difficulty').textContent = getDifficultyLabel(lesson.difficulty_level);
        document.title = `${lesson.title} | PMERIT`;

        // Audio/Captions badges
        if (lesson.has_audio) {
            document.getElementById('audio-badge').style.display = 'inline-block';
        }
        if (lesson.has_captions) {
            document.getElementById('captions-badge').style.display = 'inline-block';
        }

        // Breadcrumb
        const breadcrumb = [];
        if (lesson.grade_code) breadcrumb.push(`Grade ${lesson.grade_code}`);
        if (lesson.subject_name) breadcrumb.push(lesson.subject_name);
        if (lesson.unit_title) breadcrumb.push(lesson.unit_title);
        document.getElementById('breadcrumb').textContent = breadcrumb.join(' • ');

        // Content display: iframe URL, inline HTML, or placeholder
        const iframe = document.getElementById('moose-frame');
        const frameWrapper = document.querySelector('.content-frame-wrapper');

        if (lesson.content_url) {
            // External content via iframe (MOOSE)
            iframe.src = lesson.content_url;
        } else if (lesson.content) {
            // Inline HTML content from database
            iframe.style.display = 'none';
            const contentDiv = document.createElement('div');
            contentDiv.className = 'inline-lesson-content';
            contentDiv.innerHTML = lesson.content; // Content is sanitized server-side
            frameWrapper.appendChild(contentDiv);
        } else {
            // No content - show placeholder
            iframe.style.display = 'none';
            const placeholder = document.createElement('div');
            placeholder.className = 'content-placeholder';
            placeholder.innerHTML = `
                <div class="placeholder-content">
                    <h2>${escapeHtml(lesson.title)}</h2>
                    ${lesson.description ? `<p class="lesson-description">${escapeHtml(lesson.description)}</p>` : ''}
                    <div class="placeholder-message">
                        <p>This lesson's interactive content is being prepared.</p>
                        <p>In the meantime, try asking your AI tutor questions about the topic!</p>
                    </div>
                </div>
            `;
            frameWrapper.appendChild(placeholder);
        }

        // MLR Standards
        if (lesson.mlr_standards?.MLR && lesson.mlr_standards.MLR.length > 0) {
            const standardsList = document.getElementById('standards-list');
            standardsList.innerHTML = lesson.mlr_standards.MLR
                .map(std => `<li><code>${std}</code></li>`)
                .join('');
            document.getElementById('standards-section').style.display = 'block';
        } else {
            document.getElementById('standards-section').style.display = 'none';
        }

        // Persona
        if (lesson.persona) {
            document.getElementById('persona-name').textContent = lesson.persona.name || 'AI Tutor';
            if (lesson.persona.avatar_url) {
                document.getElementById('persona-avatar').src = lesson.persona.avatar_url;
            }

            // Greeting based on persona
            const greetings = {
                'ms_sunshine': "Hi there, superstar! I'm Ms. Sunshine, and I'm SO excited to learn with you today!",
                'mr_explorer': "Hey adventurer! I'm Mr. Explorer. Ready for today's quest?",
                'coach_jordan': "What's up! Coach Jordan here. Let's crush this lesson together!",
                'mentor_alex': "Hello! I'm Mentor Alex. Let's work through this together - I'm here whenever you need help.",
                'professor_ada': "Welcome! I'm Professor Ada. Let's dive into this topic together.",
                'coach_mike': "Hey there! Coach Mike here. Ready to learn some practical skills!"
            };
            document.getElementById('tutor-greeting').textContent =
                greetings[lesson.persona.code] || "I'm here to help you learn!";
        }

        // Learning objectives (parse from ai_context)
        if (lesson.ai_context) {
            const objectives = extractObjectives(lesson.ai_context);
            const objectivesList = document.getElementById('objectives-list');
            objectivesList.innerHTML = objectives.map(obj => `<li>${obj}</li>`).join('');
        }

        // Navigation
        if (lesson.navigation?.previous_lesson) {
            const prevBtn = document.getElementById('prev-lesson');
            prevBtn.style.visibility = 'visible';
            prevBtn.href = `/portal/lesson.html?id=${lesson.navigation.previous_lesson.lesson_id}`;
            prevBtn.title = lesson.navigation.previous_lesson.title;
        }
        if (lesson.navigation?.next_lesson) {
            const nextBtn = document.getElementById('next-lesson');
            nextBtn.style.visibility = 'visible';
            nextBtn.href = `/portal/lesson.html?id=${lesson.navigation.next_lesson.lesson_id}`;
            nextBtn.title = lesson.navigation.next_lesson.title;
        }

        // Back to unit link
        if (lesson.unit_id) {
            document.getElementById('back-to-unit').href = `/portal/lessons.html?unit=${lesson.unit_id}`;
        } else {
            document.getElementById('back-to-unit').href = '/portal/pathways.html';
        }

        // Update complete button if already completed
        if (lesson.progress?.status === 'completed') {
            const btn = document.getElementById('mark-complete');
            const stars = lesson.progress.stars_earned || 3;
            btn.textContent = `✓ Completed ${'⭐'.repeat(stars)}`;
            btn.classList.add('completed');
            btn.disabled = true;
        }
    }

    // Extract learning objectives from ai_context
    function extractObjectives(aiContext) {
        if (!aiContext) return ['Complete this lesson to learn new skills'];

        const lines = aiContext.split(/[\n.]/);
        const objectives = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length > 20 && trimmed.length < 200) {
                // Skip meta-instructions, keep student-facing objectives
                const lowerTrimmed = trimmed.toLowerCase();
                if (!lowerTrimmed.includes('use ') &&
                    !lowerTrimmed.includes('teacher') &&
                    !lowerTrimmed.includes('instructor') &&
                    !lowerTrimmed.startsWith('this ')) {
                    objectives.push(trimmed);
                }
            }
            if (objectives.length >= 4) break;
        }

        return objectives.length > 0 ? objectives : ['Complete this lesson to learn new skills'];
    }

    // Capitalize first letter
    function capitalizeFirst(str) {
        if (!str && str !== 0) return '';
        // Convert to string in case it's a number
        const s = String(str);
        return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    }

    // Convert difficulty level integer to readable string
    function getDifficultyLabel(level) {
        if (level === null || level === undefined) return 'Beginner';
        const labels = {
            1: 'Beginner',
            2: 'Easy',
            3: 'Intermediate',
            4: 'Advanced',
            5: 'Expert'
        };
        return labels[level] || capitalizeFirst(level);
    }

    // Escape HTML to prevent XSS
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Mark lesson as started
    async function markLessonStarted(lessonId) {
        try {
            await fetch(`${API_BASE}/api/v1/k12/lessons/${lessonId}/start`, {
                method: 'POST',
                headers: getAuthHeaders()
            });
        } catch (err) {
            console.warn('Could not mark lesson as started:', err);
        }
    }

    // Mark lesson as complete
    async function markLessonComplete() {
        const lessonId = getLessonId();
        const token = localStorage.getItem('pmerit_token');

        if (!token) {
            alert('Please log in to track your progress');
            return;
        }

        const btn = document.getElementById('mark-complete');
        btn.disabled = true;
        btn.textContent = 'Saving...';

        try {
            const response = await fetch(`${API_BASE}/api/v1/k12/lessons/${lessonId}/complete`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    assessment_score: 100, // Default for manual completion
                    time_spent_seconds: Math.floor((Date.now() - pageLoadTime) / 1000)
                })
            });

            const data = await response.json();

            if (data.success) {
                const stars = data.progress?.stars_earned || 3;
                btn.textContent = `✓ Completed ${'⭐'.repeat(stars)}`;
                btn.classList.add('completed');

                // Navigate to next lesson if available
                if (currentLesson?.navigation?.next_lesson) {
                    setTimeout(() => {
                        if (confirm('Great job! Ready for the next lesson?')) {
                            window.location.href = `/portal/lesson.html?id=${currentLesson.navigation.next_lesson.lesson_id}`;
                        }
                    }, 500);
                }
            } else {
                btn.textContent = 'Mark Complete ✓';
                btn.disabled = false;
                alert(data.error || 'Failed to mark complete');
            }
        } catch (err) {
            console.error('Complete lesson error:', err);
            btn.textContent = 'Mark Complete ✓';
            btn.disabled = false;
            alert('Failed to mark lesson complete. Please try again.');
        }
    }

    // AI Chat functionality
    async function sendChatMessage() {
        const input = document.getElementById('chat-input');
        const message = input.value.trim();

        if (!message) return;

        input.value = '';
        input.disabled = true;
        document.getElementById('send-btn').disabled = true;

        // Add user message to chat
        addChatMessage(message, 'user');

        // Get AI response
        try {
            const response = await fetch(`${API_BASE}/api/v1/ai/tutor`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaders()
                },
                body: JSON.stringify({
                    message: message,
                    persona: currentPersona?.code || 'ms_sunshine',
                    context: {
                        lesson_id: currentLesson?.lesson_id,
                        lesson_title: currentLesson?.title,
                        ai_context: currentLesson?.ai_context,
                        common_struggles: currentLesson?.common_struggles,
                        teaching_tips: currentLesson?.teaching_tips
                    }
                })
            });

            const data = await response.json();

            if (data.success && data.response) {
                addChatMessage(data.response, 'tutor');
            } else {
                addChatMessage("I'm having trouble responding right now. Please try again!", 'tutor');
            }
        } catch (err) {
            console.error('Chat error:', err);
            addChatMessage("Oops! Something went wrong. Let's try that again.", 'tutor');
        } finally {
            input.disabled = false;
            document.getElementById('send-btn').disabled = false;
            input.focus();
        }
    }

    function addChatMessage(text, sender) {
        const messagesDiv = document.getElementById('chat-messages');
        const messageEl = document.createElement('div');
        messageEl.className = `chat-message ${sender}`;
        messageEl.textContent = text;
        messagesDiv.appendChild(messageEl);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function showError(message) {
        document.getElementById('lesson-title').textContent = 'Error';

        // Determine if this is an auth error
        const isAuthError = message.toLowerCase().includes('log in') ||
                           message.toLowerCase().includes('session');

        const loginButton = isAuthError
            ? `<a href="/signin.html?redirect=${encodeURIComponent(window.location.href)}" class="btn btn-primary">Log In</a>`
            : '';

        document.querySelector('.content-panel').innerHTML = `
            <div class="error-message">
                <h2>Unable to Load Lesson</h2>
                <p>${message}</p>
                <div class="error-actions">
                    ${loginButton}
                    <a href="/pathways.html" class="btn ${isAuthError ? 'btn-secondary' : 'btn-primary'}">Return to Pathways</a>
                </div>
            </div>
        `;
        // Hide tutor panel on error
        const tutorPanel = document.querySelector('.tutor-panel');
        if (tutorPanel) tutorPanel.style.display = 'none';
    }

    // Event listeners
    document.addEventListener('DOMContentLoaded', () => {
        loadLesson();

        document.getElementById('mark-complete').addEventListener('click', markLessonComplete);
        document.getElementById('send-btn').addEventListener('click', sendChatMessage);
        document.getElementById('chat-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendChatMessage();
        });
    });
})();
