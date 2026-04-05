/**
 * PMERIT Admin Route Guard
 * Last Updated: December 2025 (Session 58)
 *
 * This script should be included on admin pages INSTEAD of auth-check.js.
 * It validates:
 * 1. User is authenticated
 * 2. User has appropriate admin role (tier1_admin or tier2_admin)
 * 3. User has access to the specific admin tier they're trying to view
 *
 * Usage:
 * <script src="../assets/js/config.js"></script>
 * <script src="../assets/js/auth.js"></script>
 * <script src="../assets/js/admin-auth-check.js"></script>
 *
 * Page Configuration:
 * - tier1.html: Requires 'tier1_admin' role
 * - tier2.html: Requires 'tier2_admin' or 'tier1_admin' role
 */

(function () {
  'use strict';

  const API_BASE = 'https://api.pmerit.com/api/v1';

  // Determine required role based on current page
  function getRequiredRole() {
    const path = window.location.pathname.toLowerCase();
    if (path.includes('tier1')) {
      return 'tier1_admin';
    }
    if (path.includes('tier2')) {
      return 'tier2_admin'; // tier1_admin can also access
    }
    // Default: any admin
    return 'any_admin';
  }

  // Check if user role meets requirements
  function hasRequiredRole(userRole, requiredRole) {
    if (requiredRole === 'any_admin') {
      return userRole === 'tier1_admin' || userRole === 'tier2_admin';
    }
    if (requiredRole === 'tier2_admin') {
      return userRole === 'tier1_admin' || userRole === 'tier2_admin';
    }
    if (requiredRole === 'tier1_admin') {
      return userRole === 'tier1_admin';
    }
    return false;
  }

  // Show access denied message
  function showAccessDenied(message) {
    // Replace page content with access denied message
    document.body.innerHTML = `
      <div style="
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        min-height: 100dvh;
        font-family: 'Inter', system-ui, sans-serif;
        background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
        text-align: center;
        padding: 20px;
      ">
        <div style="
          background: white;
          padding: 48px;
          border-radius: 16px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.1);
          max-width: 500px;
        ">
          <div style="font-size: 64px; margin-bottom: 24px;">
            <i class="fas fa-shield-alt" style="color: #e74c3c;"></i>
          </div>
          <h1 style="
            font-size: 28px;
            font-weight: 700;
            color: #1a1a2e;
            margin-bottom: 16px;
          ">Access Denied</h1>
          <p style="
            font-size: 16px;
            color: #666;
            margin-bottom: 32px;
            line-height: 1.6;
          ">${message}</p>
          <div style="display: flex; gap: 16px; justify-content: center; flex-wrap: wrap;">
            <a href="/" style="
              display: inline-flex;
              align-items: center;
              gap: 8px;
              padding: 12px 24px;
              background: #375b8d;
              color: white;
              text-decoration: none;
              border-radius: 8px;
              font-weight: 600;
              transition: background 0.2s;
            ">
              <i class="fas fa-home"></i> Go Home
            </a>
            <button onclick="window.AUTH.logout()" style="
              display: inline-flex;
              align-items: center;
              gap: 8px;
              padding: 12px 24px;
              background: #f8f9fa;
              color: #333;
              border: 1px solid #ddd;
              border-radius: 8px;
              font-weight: 600;
              cursor: pointer;
              font-size: 14px;
            ">
              <i class="fas fa-sign-out-alt"></i> Sign Out
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // Main validation function
  async function validateAdminAccess() {
    // Wait for AUTH to be available
    if (typeof window.AUTH === 'undefined') {
      console.error('admin-auth-check.js: AUTH module not loaded. Include auth.js before admin-auth-check.js');
      return;
    }

    // Step 1: Check if user is authenticated at all
    if (!window.AUTH.isAuthenticated()) {
      const currentUrl = window.location.pathname + window.location.search + window.location.hash;
      sessionStorage.setItem('pmerit_redirect_after_login', currentUrl);
      window.location.href = '/?auth=signin';
      return;
    }

    const token = window.AUTH.getToken();
    const requiredRole = getRequiredRole();

    // Mock tokens can't be admin
    if (token && token.startsWith('mock-')) {
      showAccessDenied('Mock authentication cannot access admin areas. Please sign in with a real account.');
      return;
    }

    // Step 2: Verify admin status with backend
    try {
      const response = await fetch(`${API_BASE}/admin/me`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (!data.success) {
        if (response.status === 401) {
          // Token invalid - redirect to login
          window.AUTH.logout(false);
          sessionStorage.setItem('pmerit_redirect_after_login', window.location.pathname);
          window.location.href = '/?auth=signin';
          return;
        }

        if (response.status === 403) {
          // Not an admin
          showAccessDenied('You do not have administrator privileges. Please contact your system administrator if you believe this is an error.');
          return;
        }

        // Other error
        showAccessDenied('Unable to verify your administrator access. Please try again later.');
        return;
      }

      // Step 3: Check if user has required role for this page
      const userRole = data.user?.role;

      if (!hasRequiredRole(userRole, requiredRole)) {
        if (requiredRole === 'tier1_admin' && userRole === 'tier2_admin') {
          showAccessDenied('This area is restricted to System Administrators (Tier 1). You are logged in as a Content Administrator (Tier 2).');
        } else {
          showAccessDenied('You do not have the required access level for this page.');
        }
        return;
      }

      // Success! Store admin user data for use by the page
      window.ADMIN_USER = data.user;
      console.log('Admin access verified:', data.user.email, 'Role:', data.user.role);

      // Dispatch event so page can react to admin validation complete
      window.dispatchEvent(new CustomEvent('adminValidated', { detail: data.user }));

    } catch (error) {
      console.error('Admin validation error:', error);
      showAccessDenied('Network error while verifying administrator access. Please check your connection and try again.');
    }
  }

  // Run validation immediately
  validateAdminAccess();
})();
