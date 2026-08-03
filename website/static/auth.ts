/// <reference path="declarations.d.ts" />

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Auth State
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

let isLoggedIn = false;

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Element References
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const authModal      = document.getElementById('authModal')      as HTMLElement;
const authModalClose = document.getElementById('authModalClose') as HTMLButtonElement;
const loginBtn       = document.getElementById('loginBtn')       as HTMLButtonElement;
const navUser        = document.getElementById('navUser')        as HTMLElement;
const navUsername    = document.getElementById('navUsername')    as HTMLElement;
const userMenuBtn    = document.getElementById('userMenuBtn')    as HTMLButtonElement;
const userDropdown   = document.getElementById('userDropdown')   as HTMLElement;
const logoutBtn      = document.getElementById('logoutBtn')      as HTMLButtonElement;
const loginSubmit    = document.getElementById('loginSubmit')    as HTMLButtonElement;
const registerSubmit = document.getElementById('registerSubmit') as HTMLButtonElement;
const loginError     = document.getElementById('loginError')     as HTMLElement;
const registerError  = document.getElementById('registerError')  as HTMLElement;

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

async function fetchJSON(url: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(url, options);
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Server error (${res.status}). Please try again.`);
  }
  return res.json();
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Modal
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.auth-form').forEach(f => f.classList.add('hidden'));
    const targetId = (tab as HTMLElement).dataset.tabTarget!;
    const target = document.getElementById(targetId);
    target?.classList.remove('hidden');
  });
});

loginBtn.addEventListener('click', () => {
  authModal.classList.remove('hidden');
});

authModalClose.addEventListener('click', () => {
  authModal.classList.add('hidden');
  clearAuthForms();
});

authModal.addEventListener('click', (e) => {
  if (e.target === authModal) {
    authModal.classList.add('hidden');
    clearAuthForms();
  }
});

function clearAuthForms(): void {
  (document.getElementById('loginEmail')       as HTMLInputElement).value = '';
  (document.getElementById('loginPassword')    as HTMLInputElement).value = '';
  (document.getElementById('registerUsername') as HTMLInputElement).value = '';
  (document.getElementById('registerEmail')    as HTMLInputElement).value = '';
  (document.getElementById('registerPassword') as HTMLInputElement).value = '';
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

document.addEventListener('click', (e) => {
  if (!navUser.contains(e.target as Node)) {
    userDropdown.classList.add('hidden');
  }
});

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Login
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

loginSubmit.addEventListener('click', async () => {
  const email    = (document.getElementById('loginEmail')    as HTMLInputElement).value.trim();
  const password = (document.getElementById('loginPassword') as HTMLInputElement).value;

  loginError.classList.add('hidden');

  if (!email || !password) {
    loginError.textContent = 'Email and password are required.';
    loginError.classList.remove('hidden');
    return;
  }

  loginSubmit.disabled = true;
  loginSubmit.textContent = 'Logging in...';

  try {
    const data = await fetchJSON('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (data.success) {
      onLogin(data.username);
      authModal.classList.add('hidden');
      clearAuthForms();
    } else {
      loginError.textContent = data.message || 'Login failed. Please try again.';
      loginError.classList.remove('hidden');
    }
  } catch (e: any) {
    loginError.textContent = e.message || 'Network error. Please check your connection.';
    loginError.classList.remove('hidden');
  } finally {
    loginSubmit.disabled = false;
    loginSubmit.textContent = 'Login';
  }
});

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Register
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

registerSubmit.addEventListener('click', async () => {
  const username = (document.getElementById('registerUsername') as HTMLInputElement).value.trim();
  const email    = (document.getElementById('registerEmail')    as HTMLInputElement).value.trim();
  const password = (document.getElementById('registerPassword') as HTMLInputElement).value;

  registerError.classList.add('hidden');

  if (!username || !email || !password) {
    registerError.textContent = 'All fields are required.';
    registerError.classList.remove('hidden');
    return;
  }

  registerSubmit.disabled = true;
  registerSubmit.textContent = 'Registering...';

  try {
    const data = await fetchJSON('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });

    if (data.success) {
      onLogin(data.username);
      authModal.classList.add('hidden');
      clearAuthForms();
    } else {
      registerError.textContent = data.message || 'Registration failed. Please try again.';
      registerError.classList.remove('hidden');
    }
  } catch (e: any) {
    registerError.textContent = e.message || 'Network error. Please check your connection.';
    registerError.classList.remove('hidden');
  } finally {
    registerSubmit.disabled = false;
    registerSubmit.textContent = 'Register';
  }
});

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Logout
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

logoutBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch (e) {
    console.warn('Logout request failed:', e);
  }

  isLoggedIn = false;
  currentSlug = null;
  currentTitle = null;

  loginBtn.classList.remove('hidden');
  navUser.classList.add('hidden');
  userDropdown.classList.add('hidden');

  const notLoggedInMsg = document.getElementById('notLoggedInMsg') as HTMLElement;
  const loggedInLoad   = document.getElementById('loggedInLoad')   as HTMLElement;
  notLoggedInMsg.classList.remove('hidden');
  loggedInLoad.classList.add('hidden');

  const currentCompositionTitle = document.getElementById('currentCompositionTitle') as HTMLElement;
  currentCompositionTitle.textContent = 'Untitled';

  clearAuthForms();
});

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// onLogin
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function onLogin(username: string): void {
  isLoggedIn = true;
  navUsername.textContent = username;
  loginBtn.classList.add('hidden');
  navUser.classList.remove('hidden');

  const notLoggedInMsg = document.getElementById('notLoggedInMsg') as HTMLElement;
  const loggedInLoad   = document.getElementById('loggedInLoad')   as HTMLElement;
  notLoggedInMsg.classList.add('hidden');
  loggedInLoad.classList.remove('hidden');

  loadCompositionList();
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Check auth state on page load
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

async function checkAuth(): Promise<void> {
  try {
    const data = await fetchJSON('/api/me');
    if (data.loggedIn) onLogin(data.username);
  } catch (e) {
    console.warn('Auth check failed:', e);
  }
}

checkAuth();