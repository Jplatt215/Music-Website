"use strict";
/// <reference path="declarations.d.ts" />
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Auth State
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
let isLoggedIn = false;
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Element References
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
const authModal = document.getElementById('authModal');
const authModalClose = document.getElementById('authModalClose');
const loginBtn = document.getElementById('loginBtn');
const navUser = document.getElementById('navUser');
const navUsername = document.getElementById('navUsername');
const userMenuBtn = document.getElementById('userMenuBtn');
const userDropdown = document.getElementById('userDropdown');
const logoutBtn = document.getElementById('logoutBtn');
const loginSubmit = document.getElementById('loginSubmit');
const registerSubmit = document.getElementById('registerSubmit');
const loginError = document.getElementById('loginError');
const registerError = document.getElementById('registerError');
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Modal
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Switch between Login and Register tabs inside the modal
document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        console.log('tab clicked', tab.dataset.tabTarget);
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.auth-form').forEach(f => f.classList.add('hidden'));
        const targetId = tab.dataset.tabTarget;
        const target = document.getElementById(targetId);
        console.log('target element:', target);
        target?.classList.remove('hidden');
    });
});
authModalClose.addEventListener('click', () => {
    authModal.classList.add('hidden');
    clearAuthForms();
});
// Close modal when clicking outside of it
authModal.addEventListener('click', (e) => {
    if (e.target === authModal) {
        authModal.classList.add('hidden');
        clearAuthForms();
    }
});
function clearAuthForms() {
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('registerUsername').value = '';
    document.getElementById('registerEmail').value = '';
    document.getElementById('registerPassword').value = '';
    loginError.classList.add('hidden');
    registerError.classList.add('hidden');
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// User Dropdown
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
userMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    userDropdown.classList.toggle('hidden');
});
// Close dropdown when clicking anywhere else
document.addEventListener('click', (e) => {
    if (!navUser.contains(e.target)) {
        userDropdown.classList.add('hidden');
    }
});
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Login
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
loginSubmit.addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    loginError.classList.add('hidden');
    const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (data.success) {
        onLogin(data.username);
        authModal.classList.add('hidden');
    }
    else {
        loginError.textContent = data.message;
        loginError.classList.remove('hidden');
    }
});
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Register
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
registerSubmit.addEventListener('click', async () => {
    const username = document.getElementById('registerUsername').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    registerError.classList.add('hidden');
    const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password }),
    });
    const data = await res.json();
    if (data.success) {
        onLogin(data.username);
        authModal.classList.add('hidden');
    }
    else {
        registerError.textContent = data.message;
        registerError.classList.remove('hidden');
    }
});
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Logout
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
logoutBtn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    isLoggedIn = false;
    currentSlug = null;
    currentTitle = null;
    loginBtn.classList.remove('hidden');
    navUser.classList.add('hidden');
    userDropdown.classList.add('hidden');
    const notLoggedInMsg = document.getElementById('notLoggedInMsg');
    const loggedInLoad = document.getElementById('loggedInLoad');
    notLoggedInMsg.classList.remove('hidden');
    loggedInLoad.classList.add('hidden');
    const currentCompositionTitle = document.getElementById('currentCompositionTitle');
    currentCompositionTitle.textContent = 'Untitled';
});
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// onLogin — called after successful login or register
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function onLogin(username) {
    isLoggedIn = true;
    navUsername.textContent = username;
    loginBtn.classList.add('hidden');
    navUser.classList.remove('hidden');
    const notLoggedInMsg = document.getElementById('notLoggedInMsg');
    const loggedInLoad = document.getElementById('loggedInLoad');
    notLoggedInMsg.classList.add('hidden');
    loggedInLoad.classList.remove('hidden');
    loadCompositionList();
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Check auth state on page load
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
async function checkAuth() {
    const res = await fetch('/api/me');
    const data = await res.json();
    if (data.loggedIn)
        onLogin(data.username);
}
checkAuth();
