/**
 * MVJ College Attendance System — script.js
 *
 * Flow:
 *  1. Firebase Auth verifies email and password.
 *  2. The backend returns the user's profile and current attendance state.
 *  3. Attendance starts only when the user presses "Attendance Sign In".
 *  4. Attendance ends only when the user presses "Attendance Sign Out".
 */

const API_BASE = (window.APP_CONFIG?.apiBase || "").replace(/\/$/, "");
const ADMIN_REFRESH_MS = 10000;

// ── DOM references ──────────────────────────────────────────────────────────
const viewLogin = document.getElementById("view-login");
const viewDashboard = document.getElementById("view-dashboard");

const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const btnLogin = document.getElementById("btn-login");
const loginError = document.getElementById("login-error");
const togglePw = document.getElementById("toggle-pw");
const btnShowRequest = document.getElementById("btn-show-request");
const accountRequestForm = document.getElementById("account-request-form");
const requestName = document.getElementById("request-name");
const requestEmail = document.getElementById("request-email");
const requestPassword = document.getElementById("request-password");
const requestRole = document.getElementById("request-role");
const btnSubmitRequest = document.getElementById("btn-submit-request");
const requestError = document.getElementById("request-error");
const requestSuccess = document.getElementById("request-success");

const userName = document.getElementById("user-name");
const userRoleBadge = document.getElementById("user-role-badge");
const entryTimeDisplay = document.getElementById("entry-time-display");
const exitTimeDisplay = document.getElementById("exit-time-display");
const dateDisplay = document.getElementById("date-display");
const sessionDuration = document.getElementById("session-duration");
const attendanceStatusDisplay = document.getElementById("attendance-status-display");
const attendanceActionTitle = document.getElementById("attendance-action-title");
const attendanceActionText = document.getElementById("attendance-action-text");
const btnAttendanceAction = document.getElementById("btn-attendance-action");
const attendanceActionError = document.getElementById("attendance-action-error");
const attendanceActionSuccess = document.getElementById("attendance-action-success");

const navUserName = document.getElementById("nav-user-name");
const navRole = document.getElementById("nav-role");
const navAvatar = document.getElementById("nav-avatar");
const liveClock = document.getElementById("live-clock");

const btnLogout = document.getElementById("btn-logout");
const logoutSuccess = document.getElementById("logout-success");

const adminSection = document.getElementById("admin-section");
const nonAdminSection = document.getElementById("non-admin-section");
const attendanceDate = document.getElementById("attendance-date");
const btnFetchAtt = document.getElementById("btn-fetch-attendance");
const btnExport = document.getElementById("btn-export");
const attendanceTbody = document.getElementById("attendance-tbody");
const attendanceError = document.getElementById("attendance-error");

const statTotal = document.getElementById("stat-total");
const statActive = document.getElementById("stat-active");
const statLatestLogin = document.getElementById("stat-latest-login");
const statCheckedout = document.getElementById("stat-checkedout");
const statDate = document.getElementById("stat-date");
const adminRefreshStatus = document.getElementById("admin-refresh-status");
const loginActivityList = document.getElementById("login-activity-list");

const newName = document.getElementById("new-name");
const newEmail = document.getElementById("new-email");
const newPassword = document.getElementById("new-password");
const newRole = document.getElementById("new-role");
const btnCreate = document.getElementById("btn-create-user");
const createError = document.getElementById("create-user-error");
const createOk = document.getElementById("create-user-success");
const btnRefreshUsers = document.getElementById("btn-refresh-users");
const manageUsersError = document.getElementById("manage-users-error");
const manageUsersSuccess = document.getElementById("manage-users-success");
const usersTbody = document.getElementById("users-tbody");
const usersSearch = document.getElementById("users-search");
const usersRoleFilter = document.getElementById("users-role-filter");
const usersStatusFilter = document.getElementById("users-status-filter");
const requestsBadge = document.getElementById("requests-badge");
const btnRefreshRequests = document.getElementById("btn-refresh-requests");
const requestsError = document.getElementById("requests-error");
const requestsSuccess = document.getElementById("requests-success");
const requestsTbody = document.getElementById("requests-tbody");

// ── State ───────────────────────────────────────────────────────────────────
let currentIdToken = null;
let currentRole = null;
let currentUserUid = null;
let currentSessionRecord = null;
let latestSessionRecord = null;
let clockInterval = null;
let durationInterval = null;
let adminRefreshInterval = null;
let lastRecords = [];
let lastUsers = [];
let lastRequests = [];
let manualLogin = false;

// ── Utility helpers ─────────────────────────────────────────────────────────
function showAlert(el, msg) {
  el.textContent = msg;
  el.hidden = false;
  el.style.display = "block";
}

function hideAlert(el) {
  el.textContent = "";
  el.hidden = true;
  el.style.display = "none";
}

function setLoginLoading(loading) {
  btnLogin.querySelector(".btn-label").hidden = loading;
  btnLogin.querySelector(".btn-spinner").hidden = !loading;
  btnLogin.disabled = loading;
}

function setAttendanceActionLoading(loading) {
  btnAttendanceAction.disabled = loading;
  btnAttendanceAction.textContent = loading
    ? "Saving…"
    : btnAttendanceAction.dataset.mode === "clock-out"
      ? "Attendance Sign Out"
      : "Attendance Sign In";
}

function formatTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function formatRoleLabel(role) {
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) return "—";
  return normalizedRole
    .split("_")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatAccountStatusLabel(status) {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  return normalizedStatus === "disabled" ? "Disabled" : "Active";
}

function formatLongDate(date = new Date()) {
  return date.toLocaleDateString([], {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function calcDuration(entry, exit, includeSeconds = false) {
  if (!entry || !exit) return "—";
  const diff = Math.floor((new Date(exit) - new Date(entry)) / 1000);
  if (diff < 0) return "—";

  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;

  if (includeSeconds) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${h}h ${m}m`;
}

function getLatestSessionByUser(records) {
  const latestByUser = new Map();

  records.forEach(record => {
    const key = record.uid || `${record.name}-${record.entry_time}`;
    const existing = latestByUser.get(key);
    if (!existing || new Date(record.entry_time || 0) > new Date(existing.entry_time || 0)) {
      latestByUser.set(key, record);
    }
  });

  return [...latestByUser.values()];
}

async function callApi(path, method = "GET", body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${currentIdToken}`,
      "Content-Type": "application/json",
    },
  };

  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Server error");
  return data;
}

async function callPublicApi(path, method = "GET", body = null) {
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Server error");
  return data;
}

// ── View switchers ───────────────────────────────────────────────────────────
function stopDurationCounter() {
  if (!durationInterval) return;
  clearInterval(durationInterval);
  durationInterval = null;
}

function stopAdminRefresh() {
  if (!adminRefreshInterval) return;
  clearInterval(adminRefreshInterval);
  adminRefreshInterval = null;
}

function resetSessionDisplay() {
  currentSessionRecord = null;
  latestSessionRecord = null;
  dateDisplay.textContent = "—";
  entryTimeDisplay.textContent = "—";
  exitTimeDisplay.textContent = "—";
  sessionDuration.textContent = "Not started";
  attendanceStatusDisplay.textContent = "Awaiting sign in";
  attendanceActionTitle.textContent = "Ready to record your work session";
  attendanceActionText.textContent = "Authenticate first, then press sign in to start timing your attendance.";
  btnAttendanceAction.dataset.mode = "clock-in";
  btnAttendanceAction.textContent = "Attendance Sign In";
  hideAlert(attendanceActionError);
  hideAlert(attendanceActionSuccess);
}

function showLoginView() {
  viewLogin.style.display = "flex";
  viewDashboard.style.display = "none";
  emailInput.value = "";
  passwordInput.value = "";
  logoutSuccess.style.display = "none";
  hideAlert(loginError);
  hideAlert(requestError);
  hideAlert(requestSuccess);
  accountRequestForm.hidden = true;
  btnShowRequest.textContent = "Request employee account";
  [requestName, requestEmail, requestPassword].forEach(el => { el.value = ""; });
  requestRole.value = "teaching";
  hideAlert(attendanceActionError);
  hideAlert(attendanceActionSuccess);
  currentIdToken = null;
  currentRole = null;
  currentUserUid = null;
  if (clockInterval) clearInterval(clockInterval);
  stopDurationCounter();
  stopAdminRefresh();
  resetSessionDisplay();
}

function showDashboardView(data) {
  viewLogin.style.display = "none";
  viewDashboard.style.display = "block";
  logoutSuccess.style.display = "none";

  userName.textContent = data.name || "—";
  userRoleBadge.textContent = formatRoleLabel(data.role);
  navUserName.textContent = data.name || "—";
  navRole.textContent = formatRoleLabel(data.role);
  navAvatar.textContent = (data.name || "?")[0].toUpperCase();
  dateDisplay.textContent = formatLongDate();
  currentUserUid = data.uid || null;

  updateAttendanceState(data.active_session, data.latest_session);

  if (normalizeRole(data.role) === "admin") {
    adminSection.style.display = "block";
    nonAdminSection.style.display = "none";
    attendanceDate.value = todayLocal();
    statDate.textContent = todayLocal();
    startAdminRefresh();
    fetchAttendance();
    fetchUsers(true);
    fetchRequests(true);
  } else {
    adminSection.style.display = "none";
    nonAdminSection.style.display = "block";
    stopAdminRefresh();
  }

  startClock();
}

function updateAttendanceState(activeSession, latestSession) {
  stopDurationCounter();
  currentSessionRecord = activeSession || null;
  latestSessionRecord = latestSession || null;

  if (currentSessionRecord) {
    entryTimeDisplay.textContent = formatTime(currentSessionRecord.entry_time);
    exitTimeDisplay.textContent = "Not signed out yet";
    attendanceStatusDisplay.textContent = `Active since ${formatTime(currentSessionRecord.entry_time)}`;
    attendanceActionTitle.textContent = "Attendance session is running";
    attendanceActionText.textContent = "When you leave, press attendance sign-out to store the full duration for this session.";
    btnAttendanceAction.dataset.mode = "clock-out";
    btnAttendanceAction.textContent = "Attendance Sign Out";
    startDurationCounter(currentSessionRecord.entry_time);
    return;
  }

  btnAttendanceAction.dataset.mode = "clock-in";
  btnAttendanceAction.textContent = "Attendance Sign In";

  if (latestSessionRecord?.entry_time && latestSessionRecord?.exit_time) {
    entryTimeDisplay.textContent = formatTime(latestSessionRecord.entry_time);
    exitTimeDisplay.textContent = formatTime(latestSessionRecord.exit_time);
    sessionDuration.textContent = calcDuration(
      latestSessionRecord.entry_time,
      latestSessionRecord.exit_time
    );
    attendanceStatusDisplay.textContent = `Signed out at ${formatTime(latestSessionRecord.exit_time)}`;
    attendanceActionTitle.textContent = "Previous session has been stored";
    attendanceActionText.textContent = "Press attendance sign-in when you are ready to start your next work session.";
    return;
  }

  entryTimeDisplay.textContent = "—";
  exitTimeDisplay.textContent = "—";
  sessionDuration.textContent = "Not started";
  attendanceStatusDisplay.textContent = "Awaiting sign in";
  attendanceActionTitle.textContent = "Ready to record your work session";
  attendanceActionText.textContent = "Press attendance sign-in to begin your timer for this visit.";
}

function startClock() {
  if (clockInterval) clearInterval(clockInterval);
  const tick = () => {
    liveClock.textContent = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };
  tick();
  clockInterval = setInterval(tick, 1000);
}

function startDurationCounter(entryTime) {
  const tick = () => {
    sessionDuration.textContent = calcDuration(entryTime, new Date().toISOString(), true);
  };
  tick();
  durationInterval = setInterval(tick, 1000);
}

function startAdminRefresh() {
  stopAdminRefresh();
  adminRefreshStatus.textContent = `Auto-refreshing every ${ADMIN_REFRESH_MS / 1000} seconds`;
  adminRefreshInterval = setInterval(() => {
    if (normalizeRole(currentRole) === "admin") {
      fetchAttendance(true);
      fetchRequests(true);
    }
  }, ADMIN_REFRESH_MS);
}

// ── Password visibility toggle ───────────────────────────────────────────────
togglePw.addEventListener("click", () => {
  const isText = passwordInput.type === "text";
  passwordInput.type = isText ? "password" : "text";
  togglePw.setAttribute("aria-label", isText ? "Show password" : "Hide password");
});

btnShowRequest.addEventListener("click", () => {
  const willShow = accountRequestForm.hidden;
  accountRequestForm.hidden = !willShow;
  btnShowRequest.textContent = willShow ? "Hide request form" : "Request employee account";
  hideAlert(requestError);
  hideAlert(requestSuccess);
  if (willShow) {
    requestName.focus();
  }
});

accountRequestForm.addEventListener("submit", async event => {
  event.preventDefault();
  hideAlert(requestError);
  hideAlert(requestSuccess);

  const payload = {
    name: requestName.value.trim(),
    email: requestEmail.value.trim(),
    password: requestPassword.value,
    role: requestRole.value,
  };

  if (!payload.name || !payload.email || !payload.password || !payload.role) {
    showAlert(requestError, "Please fill in all request fields.");
    return;
  }

  if (payload.password.length < 6) {
    showAlert(requestError, "Password must be at least 6 characters.");
    return;
  }

  btnSubmitRequest.textContent = "Submitting…";
  btnSubmitRequest.disabled = true;

  try {
    const data = await callPublicApi("/api/account_requests", "POST", payload);
    showAlert(requestSuccess, data.message || "Account request submitted.");
    [requestName, requestEmail, requestPassword].forEach(el => { el.value = ""; });
    requestRole.value = "teaching";
  } catch (err) {
    showAlert(requestError, err.message);
  } finally {
    btnSubmitRequest.textContent = "Submit Request";
    btnSubmitRequest.disabled = false;
  }
});

// ── Authentication flow ─────────────────────────────────────────────────────
btnLogin.addEventListener("click", async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  hideAlert(loginError);

  if (!email || !password) {
    showAlert(loginError, "Please enter your email and password.");
    return;
  }

  setLoginLoading(true);
  manualLogin = true;

  try {
    const auth = window._firebaseAuth;
    const signIn = window._firebaseSignIn;
    const userCred = await signIn(auth, email, password);

    currentIdToken = await userCred.user.getIdToken();
    const data = await callApi("/api/login", "POST");
    currentRole = normalizeRole(data.role);
    showDashboardView(data);
  } catch (err) {
    let msg = err.message || "Login failed. Please try again.";
    if (err.code === "auth/wrong-password" || err.code === "auth/user-not-found") {
      msg = "Invalid email or password.";
    } else if (err.code === "auth/user-disabled") {
      msg = "This account has been disabled. Please contact your administrator.";
    } else if (err.code === "auth/too-many-requests") {
      msg = "Too many attempts. Please wait a moment and try again.";
    }
    showAlert(loginError, msg);
    currentIdToken = null;
  } finally {
    setLoginLoading(false);
    manualLogin = false;
  }
});

[emailInput, passwordInput].forEach(el => {
  el.addEventListener("keydown", event => {
    if (event.key === "Enter") btnLogin.click();
  });
});

// ── Attendance actions ──────────────────────────────────────────────────────
btnAttendanceAction.addEventListener("click", async () => {
  hideAlert(attendanceActionError);
  hideAlert(attendanceActionSuccess);
  setAttendanceActionLoading(true);

  try {
    if (btnAttendanceAction.dataset.mode === "clock-out") {
      const data = await callApi("/api/clock_out", "POST");
      updateAttendanceState(null, data.record);
      const duration = calcDuration(data.record.entry_time, data.record.exit_time);
      showAlert(
        attendanceActionSuccess,
        `Attendance sign-out stored successfully. In: ${formatTime(data.record.entry_time)} | Out: ${formatTime(data.record.exit_time)} | Active: ${duration}`
      );
    } else {
      const data = await callApi("/api/clock_in", "POST");
      updateAttendanceState(data.record, data.record);
      showAlert(attendanceActionSuccess, "Attendance sign-in stored successfully.");
    }

    if (normalizeRole(currentRole) === "admin") {
      fetchAttendance(true);
    }
  } catch (err) {
    showAlert(attendanceActionError, err.message);
  } finally {
    setAttendanceActionLoading(false);
  }
});

// ── Account logout ──────────────────────────────────────────────────────────
btnLogout.addEventListener("click", async () => {
  btnLogout.disabled = true;
  btnLogout.textContent = "Logging out…";

  try {
    await window._firebaseSignOut(window._firebaseAuth);
  } finally {
    btnLogout.disabled = false;
    btnLogout.textContent = "Log Out Account";
    showLoginView();
  }
});

// ── Tab switching ────────────────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(tab => tab.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(content => {
      content.style.display = "none";
      content.classList.remove("active");
    });
    btn.classList.add("active");
    const target = document.getElementById(`tab-${btn.dataset.tab}`);
    target.style.display = "block";
    target.classList.add("active");

    if (btn.dataset.tab === "manage" && normalizeRole(currentRole) === "admin") {
      fetchUsers();
    } else if (btn.dataset.tab === "requests" && normalizeRole(currentRole) === "admin") {
      fetchRequests();
    }
  });
});

// ── Admin: Fetch Attendance Records ─────────────────────────────────────────
async function fetchAttendance(isBackgroundRefresh = false) {
  attendanceError.style.display = "none";
  const date = attendanceDate.value || todayLocal();

  if (!isBackgroundRefresh) {
    btnFetchAtt.textContent = "Loading…";
    btnFetchAtt.disabled = true;
  }

  try {
    const data = await callApi(`/api/attendance?date=${date}`);
    const attendanceRecords = data.records || [];
    lastRecords = attendanceRecords;
    renderAttendanceTable(attendanceRecords);
    renderLoginActivity(attendanceRecords);
    updateStats(attendanceRecords, date);
    adminRefreshStatus.textContent = `Last updated at ${formatTime(data.generated_at || new Date().toISOString())}`;
  } catch (err) {
    attendanceError.style.display = "block";
    attendanceError.textContent = err.message;
    renderAttendanceTable([]);
    renderLoginActivity([]);
    adminRefreshStatus.textContent = "Unable to refresh records";
  } finally {
    if (!isBackgroundRefresh) {
      btnFetchAtt.textContent = "Fetch Records";
      btnFetchAtt.disabled = false;
    }
  }
}

btnFetchAtt.addEventListener("click", () => fetchAttendance());

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && normalizeRole(currentRole) === "admin") {
    fetchAttendance(true);
    fetchRequests(true);
  }
});

window.addEventListener("focus", () => {
  if (normalizeRole(currentRole) === "admin") {
    fetchAttendance(true);
    fetchRequests(true);
  }
});

function updateStats(records, date) {
  const latestSessions = getLatestSessionByUser(records);
  const checkedOut = latestSessions.filter(record => record.exit_time).length;
  const active = latestSessions.filter(record => !record.exit_time).length;
  const latestRecord = [...records]
    .filter(r => r.entry_time)
    .sort((a, b) => new Date(b.entry_time) - new Date(a.entry_time))[0];

  statTotal.textContent = latestSessions.length;
  statActive.textContent = active;
  statLatestLogin.textContent = latestRecord ? formatTime(latestRecord.entry_time) : "—";
  statCheckedout.textContent = checkedOut;
  statDate.textContent = date;
}

function renderAttendanceTable(records) {
  if (!records.length) {
    attendanceTbody.innerHTML = `<tr class="empty-row"><td colspan="7">No attendance records found for this date.</td></tr>`;
    return;
  }

  attendanceTbody.innerHTML = records.map((record, index) => {
    const duration = record.entry_time && record.exit_time
      ? calcDuration(record.entry_time, record.exit_time)
      : "—";
    const status = record.exit_time
      ? `<span class="status-pill status-done">Checked Out</span>`
      : `<span class="status-pill status-active">Active</span>`;

    return `<tr>
      <td>${index + 1}</td>
      <td style="font-weight:600;color:var(--text-primary)">${escHtml(record.name || "—")}</td>
      <td>${escHtml(formatRoleLabel(record.role))}</td>
      <td>${record.entry_time ? formatTime(record.entry_time) : "—"}</td>
      <td>${record.exit_time ? formatTime(record.exit_time) : `<span style="color:var(--text-muted)">Not yet</span>`}</td>
      <td>${duration}</td>
      <td>${status}</td>
    </tr>`;
  }).join("");
}

function renderLoginActivity(records) {
  if (!records.length) {
    loginActivityList.innerHTML = `<div class="activity-empty">No attendance records found yet.</div>`;
    return;
  }

  const uniqueUserRecords = getLatestSessionByUser(records)
    .sort((a, b) => new Date(b.entry_time || 0) - new Date(a.entry_time || 0));

  loginActivityList.innerHTML = uniqueUserRecords.map(record => `
    <article class="activity-row">
      <div class="activity-main">
        <div class="activity-name">${escHtml(record.name || "—")}</div>
        <div class="activity-role">${escHtml(formatRoleLabel(record.role))}</div>
      </div>
      <div class="activity-time">${record.entry_time ? formatTime(record.entry_time) : "—"}</div>
      <div class="activity-time">${record.exit_time ? formatTime(record.exit_time) : "—"}</div>
      <div class="activity-duration">${
        record.entry_time
          ? calcDuration(record.entry_time, record.exit_time || new Date().toISOString())
          : "—"
      }</div>
      <div class="activity-status">
        ${record.exit_time
          ? `<span class="status-pill status-done">Checked Out</span>`
          : `<span class="status-pill status-active">Active</span>`}
      </div>
    </article>
  `).join("");
}

// ── Admin: Account Requests ─────────────────────────────────────────────────
async function fetchRequests(isBackgroundRefresh = false) {
  hideAlert(requestsError);

  if (!isBackgroundRefresh) {
    btnRefreshRequests.textContent = "Loading…";
    btnRefreshRequests.disabled = true;

    if (!lastRequests.length) {
      requestsTbody.innerHTML = `<tr class="empty-row"><td colspan="6">Loading account requests...</td></tr>`;
    }
  }

  try {
    const data = await callApi("/api/account_requests?status=pending");
    lastRequests = data.requests || [];
    updateRequestsBadge(lastRequests.length);
    renderRequestsTable(lastRequests);
  } catch (err) {
    lastRequests = [];
    updateRequestsBadge(0);
    showAlert(requestsError, err.message);
    renderRequestsTable([]);
  } finally {
    if (!isBackgroundRefresh) {
      btnRefreshRequests.textContent = "Refresh Requests";
      btnRefreshRequests.disabled = false;
    }
  }
}

function updateRequestsBadge(count) {
  const pendingCount = Number(count) || 0;
  requestsBadge.textContent = pendingCount > 99 ? "99+" : String(pendingCount);
  requestsBadge.hidden = pendingCount === 0;
  requestsBadge.setAttribute("aria-label", `${pendingCount} pending account requests`);
}

function renderRequestsTable(requests) {
  if (!requests.length) {
    requestsTbody.innerHTML = `<tr class="empty-row"><td colspan="6">No pending account requests.</td></tr>`;
    return;
  }

  requestsTbody.innerHTML = requests.map((item, index) => {
    const requestedAt = item.requested_at
      ? new Date(item.requested_at).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";

    return `<tr>
      <td>${index + 1}</td>
      <td style="font-weight:600;color:var(--text-primary)">${escHtml(item.name || "—")}</td>
      <td>${escHtml(item.email || "—")}</td>
      <td>${escHtml(formatRoleLabel(item.role))}</td>
      <td>${escHtml(requestedAt)}</td>
      <td>
        <button class="btn btn-sm request-accept-btn" data-action="accept-request" data-request-id="${escHtml(item.id || "")}">Accept</button>
        <button class="btn btn-sm user-delete-btn" data-action="reject-request" data-request-id="${escHtml(item.id || "")}">Reject</button>
      </td>
    </tr>`;
  }).join("");
}

btnRefreshRequests.addEventListener("click", () => fetchRequests());

requestsTbody.addEventListener("click", async event => {
  const actionBtn = event.target.closest("[data-action]");
  if (!actionBtn) return;

  hideAlert(requestsError);
  hideAlert(requestsSuccess);

  const requestId = actionBtn.dataset.requestId;
  const accountRequest = lastRequests.find(item => item.id === requestId);
  const name = accountRequest?.name || accountRequest?.email || "this request";
  const isAccept = actionBtn.dataset.action === "accept-request";
  const actionLabel = isAccept ? "Accept" : "Reject";
  const confirmed = window.confirm(`${actionLabel} ${name}'s account request?`);
  if (!confirmed) return;

  actionBtn.disabled = true;
  actionBtn.textContent = isAccept ? "Accepting…" : "Rejecting…";

  try {
    const path = `/api/account_requests/${encodeURIComponent(requestId)}/${isAccept ? "accept" : "reject"}`;
    const data = await callApi(path, "POST");
    showAlert(requestsSuccess, data.message || `Request ${isAccept ? "accepted" : "rejected"} successfully.`);
    await fetchRequests(true);
    if (isAccept) fetchUsers(true);
  } catch (err) {
    showAlert(requestsError, err.message);
    if (actionBtn.isConnected) {
      actionBtn.disabled = false;
      actionBtn.textContent = actionLabel;
    }
  }
});

// ── Admin: Manage Users ─────────────────────────────────────────────────────
async function fetchUsers(isBackgroundRefresh = false) {
  hideAlert(manageUsersError);

  if (!isBackgroundRefresh) {
    btnRefreshUsers.textContent = "Loading…";
    btnRefreshUsers.disabled = true;

    if (!lastUsers.length) {
      usersTbody.innerHTML = `<tr class="empty-row"><td colspan="6">Loading user accounts...</td></tr>`;
    }
  }

  try {
    const data = await callApi("/api/users");
    lastUsers = data.users || [];
    applyUserFilters();
  } catch (err) {
    lastUsers = [];
    showAlert(manageUsersError, err.message);
    renderUsersTable([]);
  } finally {
    if (!isBackgroundRefresh) {
      btnRefreshUsers.textContent = "Refresh Users";
      btnRefreshUsers.disabled = false;
    }
  }
}

function renderUsersTable(users) {
  if (!users.length) {
    usersTbody.innerHTML = `<tr class="empty-row"><td colspan="6">No user accounts found.</td></tr>`;
    return;
  }

  usersTbody.innerHTML = users.map((user, index) => {
    const isCurrentUser = user.uid === currentUserUid;
    const isDisabled = String(user.account_status || "").toLowerCase() === "disabled";

    return `<tr>
      <td>${index + 1}</td>
      <td style="font-weight:600;color:var(--text-primary)">${escHtml(user.name || "—")}</td>
      <td>${escHtml(user.email || "—")}</td>
      <td>${escHtml(formatRoleLabel(user.role))}</td>
      <td>
        <span class="status-pill ${isDisabled ? "status-disabled" : "status-active"}">
          ${escHtml(formatAccountStatusLabel(user.account_status))}
        </span>
      </td>
      <td>
        ${isCurrentUser
          ? `<button class="btn btn-sm" disabled>Current Account</button>`
          : `<button class="btn btn-sm user-toggle-btn" data-action="toggle-status" data-uid="${escHtml(user.uid || "")}">
              ${isDisabled ? "Enable" : "Disable"}
            </button>
            <button class="btn btn-sm user-delete-btn" data-action="delete-user" data-uid="${escHtml(user.uid || "")}">Delete</button>`}
      </td>
    </tr>`;
  }).join("");
}

function applyUserFilters() {
  const searchTerm = usersSearch.value.trim().toLowerCase();
  const selectedRole = normalizeRole(usersRoleFilter.value);
  const selectedStatus = String(usersStatusFilter.value || "").trim().toLowerCase();

  const filteredUsers = lastUsers.filter(user => {
    const name = String(user.name || "").toLowerCase();
    const email = String(user.email || "").toLowerCase();
    const roleMatches = !selectedRole || normalizeRole(user.role) === selectedRole;
    const statusMatches = !selectedStatus || String(user.account_status || "active").toLowerCase() === selectedStatus;
    const searchMatches = !searchTerm || name.includes(searchTerm) || email.includes(searchTerm);
    return roleMatches && statusMatches && searchMatches;
  });

  renderUsersTable(filteredUsers);
}

btnRefreshUsers.addEventListener("click", () => fetchUsers());

[usersSearch, usersRoleFilter, usersStatusFilter].forEach(control => {
  control.addEventListener("input", applyUserFilters);
  control.addEventListener("change", applyUserFilters);
});

usersTbody.addEventListener("click", async event => {
  const actionBtn = event.target.closest("[data-action]");
  if (!actionBtn) return;

  hideAlert(manageUsersError);
  hideAlert(manageUsersSuccess);

  const uid = actionBtn.dataset.uid;
  const user = lastUsers.find(item => item.uid === uid);
  const name = user?.name || user?.email || "this user";

  if (actionBtn.dataset.action === "toggle-status") {
    const nextStatus = String(user?.account_status || "").toLowerCase() === "disabled" ? "active" : "disabled";
    const confirmed = window.confirm(`${nextStatus === "disabled" ? "Disable" : "Enable"} ${name}'s account?`);
    if (!confirmed) return;

    const originalText = actionBtn.textContent;
    actionBtn.disabled = true;
    actionBtn.textContent = nextStatus === "disabled" ? "Disabling…" : "Enabling…";

    try {
      const data = await callApi(`/api/users/${encodeURIComponent(uid)}`, "PATCH", {
        account_status: nextStatus,
      });
      showAlert(manageUsersSuccess, data.message || "User updated successfully.");
      await fetchUsers(true);
      if (usersStatusFilter.value && usersStatusFilter.value !== nextStatus) {
        usersStatusFilter.value = "";
      }
      applyUserFilters();
    } catch (err) {
      showAlert(manageUsersError, err.message);
      if (actionBtn.isConnected) {
        actionBtn.disabled = false;
        actionBtn.textContent = originalText;
      }
    }
    return;
  }

  const confirmed = window.confirm(`Delete ${name}'s account permanently?`);
  if (!confirmed) return;

  const originalText = actionBtn.textContent;
  actionBtn.disabled = true;
  actionBtn.textContent = "Deleting…";

  try {
    const data = await callApi(`/api/users/${encodeURIComponent(uid)}`, "DELETE");
    showAlert(manageUsersSuccess, data.message || "User deleted successfully.");
    await fetchUsers(true);
    applyUserFilters();
  } catch (err) {
    showAlert(manageUsersError, err.message);
    if (actionBtn.isConnected) {
      actionBtn.disabled = false;
      actionBtn.textContent = originalText;
    }
  }
});

// ── CSV Export ───────────────────────────────────────────────────────────────
btnExport.addEventListener("click", () => {
  if (!lastRecords.length) {
    alert("No records to export. Fetch records first.");
    return;
  }

  const rows = [["Name", "Role", "Entry Time", "Exit Time", "Duration", "Status"]];
  lastRecords.forEach(record => {
    const duration = record.entry_time && record.exit_time
      ? calcDuration(record.entry_time, record.exit_time)
      : "";
    const status = record.exit_time ? "Checked Out" : "Active";
    rows.push([
      record.name,
      formatRoleLabel(record.role),
      record.entry_time,
      record.exit_time || "",
      duration,
      status,
    ]);
  });

  const csv = rows.map(row => row.map(value => `"${value}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `attendance_${attendanceDate.value || todayLocal()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// ── Admin: Create User ───────────────────────────────────────────────────────
btnCreate.addEventListener("click", async () => {
  hideAlert(createError);
  hideAlert(createOk);

  const payload = {
    name: newName.value.trim(),
    email: newEmail.value.trim(),
    password: newPassword.value,
    role: newRole.value,
  };

  if (!payload.name || !payload.email || !payload.password || !payload.role) {
    showAlert(createError, "Please fill in all fields and select a role.");
    return;
  }

  btnCreate.textContent = "Creating…";
  btnCreate.disabled = true;

  try {
    const data = await callApi("/api/create_user", "POST", payload);
    showAlert(createOk, `✓ ${data.message}  (UID: ${data.uid})`);
    [newName, newEmail, newPassword].forEach(el => { el.value = ""; });
    newRole.value = "";
    fetchUsers(true);
  } catch (err) {
    showAlert(createError, err.message);
  } finally {
    btnCreate.textContent = "Create User Account";
    btnCreate.disabled = false;
  }
});

// ── XSS Helper ───────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── App initialisation ──────────────────────────────────────────────────────
window.initApp = function () {
  window._firebaseOnAuth(window._firebaseAuth, async user => {
    if (manualLogin) return;

    if (user) {
      try {
        currentIdToken = await user.getIdToken(true);
        const data = await callApi("/api/login", "POST");
        currentRole = normalizeRole(data.role);
        showDashboardView(data);
      } catch {
        showLoginView();
      }
    } else {
      showLoginView();
    }
  });
};
