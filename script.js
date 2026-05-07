/**
 * MVJ College Attendance System - React frontend
 *
 * Firebase Auth still verifies login credentials.
 * Flask still owns attendance, users, and account-request APIs.
 */

const { useCallback, useEffect, useMemo, useState } = React;
const h = React.createElement;

const API_BASE = (window.APP_CONFIG?.apiBase || "").replace(/\/$/, "");
const ADMIN_REFRESH_MS = 10000;
const ROLE_OPTIONS = [
  ["admin", "Admin"],
  ["hod", "HOD"],
  ["teaching", "Teaching Staff"],
  ["lab_instructor", "Lab Instructor"],
  ["student", "Student"],
];
const REQUEST_ROLE_OPTIONS = ROLE_OPTIONS.filter(([value]) => value !== "admin");

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function formatRoleLabel(role) {
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) return "-";
  return normalizedRole
    .split("_")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatAccountStatusLabel(status) {
  return String(status || "").trim().toLowerCase() === "disabled" ? "Disabled" : "Active";
}

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatLongDate(date = new Date()) {
  return date.toLocaleDateString([], {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatRequestDate(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function calcDuration(entry, exit, includeSeconds = false) {
  if (!entry || !exit) return "-";
  const diff = Math.floor((new Date(exit) - new Date(entry)) / 1000);
  if (diff < 0) return "-";

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

async function callApi(path, method = "GET", body = null, token = null) {
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Server error");
  return data;
}

function Alert({ type = "error", message }) {
  if (!message) return null;
  return h("div", { className: `alert alert-${type}`, role: type === "error" ? "alert" : "status" }, message);
}

function CollegeEmblem({ small = false }) {
  return h("div", { className: `college-emblem${small ? " small" : ""}` },
    h("svg", { viewBox: "0 0 60 60", fill: "none", xmlns: "http://www.w3.org/2000/svg" },
      h("polygon", {
        points: "30,4 56,18 56,42 30,56 4,42 4,18",
        fill: "none",
        stroke: "var(--accent)",
        strokeWidth: "2.5",
      }),
      h("text", {
        x: "30",
        y: "36",
        textAnchor: "middle",
        fontSize: "18",
        fontWeight: "700",
        fontFamily: "Playfair Display, serif",
        fill: "var(--accent)",
      }, "M")
    )
  );
}

function StatusPill({ status, children }) {
  return h("span", { className: `status-pill ${status}` }, children);
}

function LoginView({ onLoginComplete }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [showRequest, setShowRequest] = useState(false);
  const [requestForm, setRequestForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "teaching",
  });
  const [requestError, setRequestError] = useState("");
  const [requestSuccess, setRequestSuccess] = useState("");
  const [requestLoading, setRequestLoading] = useState(false);

  async function handleLogin(event) {
    event.preventDefault();
    setLoginError("");

    if (!email.trim() || !password) {
      setLoginError("Please enter your email and password.");
      return;
    }

    setLoading(true);
    try {
      const userCred = await window._firebaseSignIn(window._firebaseAuth, email.trim(), password);
      const token = await userCred.user.getIdToken();
      const data = await callApi("/api/login", "POST", null, token);
      onLoginComplete(token, data);
    } catch (err) {
      let msg = err.message || "Login failed. Please try again.";
      if (err.code === "auth/wrong-password" || err.code === "auth/user-not-found" || err.code === "auth/invalid-credential") {
        msg = "Invalid email or password.";
      } else if (err.code === "auth/user-disabled") {
        msg = "This account has been disabled. Please contact your administrator.";
      } else if (err.code === "auth/too-many-requests") {
        msg = "Too many attempts. Please wait a moment and try again.";
      }
      setLoginError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function submitRequest(event) {
    event.preventDefault();
    setRequestError("");
    setRequestSuccess("");

    const payload = {
      name: requestForm.name.trim(),
      email: requestForm.email.trim(),
      password: requestForm.password,
      role: requestForm.role,
    };

    if (!payload.name || !payload.email || !payload.password || !payload.role) {
      setRequestError("Please fill in all request fields.");
      return;
    }

    if (payload.password.length < 6) {
      setRequestError("Password must be at least 6 characters.");
      return;
    }

    setRequestLoading(true);
    try {
      const data = await callApi("/api/account_requests", "POST", payload);
      setRequestSuccess(data.message || "Account request submitted.");
      setRequestForm({ name: "", email: "", password: "", role: "teaching" });
    } catch (err) {
      setRequestError(err.message);
    } finally {
      setRequestLoading(false);
    }
  }

  function updateRequestField(field, value) {
    setRequestForm(prev => ({ ...prev, [field]: value }));
  }

  return h("main", { className: "panel login-panel", "aria-live": "polite" },
    h("div", { className: "login-card" },
      h("div", { className: "college-brand" },
        h(CollegeEmblem),
        h("div", { className: "college-info" },
          h("h1", { className: "college-name" }, "MVJ College of Engineering"),
          h("p", { className: "system-label" }, "Attendance Management System")
        )
      ),
      h("div", { className: "divider" }, h("span", null, "Sign In")),
      h(Alert, { message: loginError }),
      h("form", { onSubmit: handleLogin },
        h("div", { className: "form-group" },
          h("label", { htmlFor: "email" }, "Institutional Email"),
          h("input", {
            type: "email",
            id: "email",
            placeholder: "you@mvjce.edu.in",
            autoComplete: "username",
            value: email,
            onChange: event => setEmail(event.target.value),
            required: true,
          })
        ),
        h("div", { className: "form-group" },
          h("label", { htmlFor: "password" }, "Password"),
          h("div", { className: "password-wrap" },
            h("input", {
              type: showPassword ? "text" : "password",
              id: "password",
              placeholder: "Password",
              autoComplete: "current-password",
              value: password,
              onChange: event => setPassword(event.target.value),
              required: true,
            }),
            h("button", {
              type: "button",
              id: "toggle-pw",
              "aria-label": showPassword ? "Hide password" : "Show password",
              onClick: () => setShowPassword(prev => !prev),
            }, showPassword ? "Hide" : "Show")
          )
        ),
        h("button", { className: "btn btn-primary", disabled: loading },
          loading ? h("span", { className: "btn-spinner" }) : h("span", { className: "btn-label" }, "Authenticate & Continue")
        )
      ),
      h("p", { className: "form-hint" }, "Authentication only. Attendance starts after you press the in-page sign-in button."),
      h("div", { className: "request-toggle-row" },
        h("button", {
          type: "button",
          className: "request-link",
          onClick: () => {
            setShowRequest(prev => !prev);
            setRequestError("");
            setRequestSuccess("");
          },
        }, showRequest ? "Hide request form" : "Request employee account")
      ),
      showRequest && h("form", { className: "account-request-form", onSubmit: submitRequest },
        h("div", { className: "divider" }, h("span", null, "Request Account")),
        h(Alert, { message: requestError }),
        h(Alert, { type: "success", message: requestSuccess }),
        h("div", { className: "form-group" },
          h("label", { htmlFor: "request-name" }, "Full Name"),
          h("input", {
            type: "text",
            id: "request-name",
            placeholder: "Dr. Ravi Kumar",
            autoComplete: "name",
            value: requestForm.name,
            onChange: event => updateRequestField("name", event.target.value),
          })
        ),
        h("div", { className: "form-group" },
          h("label", { htmlFor: "request-email" }, "Institutional Email"),
          h("input", {
            type: "email",
            id: "request-email",
            placeholder: "you@mvjce.edu.in",
            autoComplete: "email",
            value: requestForm.email,
            onChange: event => updateRequestField("email", event.target.value),
          })
        ),
        h("div", { className: "form-group" },
          h("label", { htmlFor: "request-password" }, "Password"),
          h("input", {
            type: "password",
            id: "request-password",
            placeholder: "Min 6 characters",
            autoComplete: "new-password",
            value: requestForm.password,
            onChange: event => updateRequestField("password", event.target.value),
          })
        ),
        h("div", { className: "form-group" },
          h("label", { htmlFor: "request-role" }, "Requested Role"),
          h("select", {
            id: "request-role",
            value: requestForm.role,
            onChange: event => updateRequestField("role", event.target.value),
          }, REQUEST_ROLE_OPTIONS.map(([value, label]) => h("option", { key: value, value }, label)))
        ),
        h("button", {
          type: "submit",
          className: "btn btn-outline request-submit-btn",
          disabled: requestLoading,
        }, requestLoading ? "Submitting..." : "Submit Request")
      )
    )
  );
}

function DashboardView({ token, profile, onLogout }) {
  const role = normalizeRole(profile?.role);
  const isAdmin = role === "admin";
  const [activeSession, setActiveSession] = useState(profile?.active_session || null);
  const [latestSession, setLatestSession] = useState(profile?.latest_session || null);
  const [tick, setTick] = useState(Date.now());
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceError, setAttendanceError] = useState("");
  const [attendanceSuccess, setAttendanceSuccess] = useState("");
  const [records, setRecords] = useState([]);
  const [attendanceDate, setAttendanceDate] = useState(todayLocal());
  const [attendanceFetchError, setAttendanceFetchError] = useState("");
  const [adminRefreshStatus, setAdminRefreshStatus] = useState("Waiting for records...");
  const [activeTab, setActiveTab] = useState("attendance");
  const [requests, setRequests] = useState([]);
  const [users, setUsers] = useState([]);

  const fetchAttendance = useCallback(async (isBackgroundRefresh = false) => {
    if (!isAdmin) return;
    setAttendanceFetchError("");
    try {
      const data = await callApi(`/api/attendance?date=${attendanceDate}`, "GET", null, token);
      setRecords(data.records || []);
      setAdminRefreshStatus(`Last updated at ${formatTime(data.generated_at || new Date().toISOString())}`);
    } catch (err) {
      setRecords([]);
      setAttendanceFetchError(err.message);
      setAdminRefreshStatus("Unable to refresh records");
    }
  }, [attendanceDate, isAdmin, token]);

  const fetchRequests = useCallback(async () => {
    if (!isAdmin) return;
    const data = await callApi("/api/account_requests?status=pending", "GET", null, token);
    setRequests(data.requests || []);
  }, [isAdmin, token]);

  const fetchUsers = useCallback(async () => {
    if (!isAdmin) return;
    const data = await callApi("/api/users", "GET", null, token);
    setUsers(data.users || []);
  }, [isAdmin, token]);

  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isAdmin) return undefined;
    fetchAttendance(true);
    fetchRequests().catch(() => setRequests([]));
    fetchUsers().catch(() => setUsers([]));

    const timer = setInterval(() => {
      fetchAttendance(true);
      fetchRequests().catch(() => setRequests([]));
    }, ADMIN_REFRESH_MS);

    const refreshOnFocus = () => {
      if (document.hidden) return;
      fetchAttendance(true);
      fetchRequests().catch(() => setRequests([]));
    };

    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);

    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [fetchAttendance, fetchRequests, fetchUsers, isAdmin]);

  async function handleAttendanceAction() {
    setAttendanceError("");
    setAttendanceSuccess("");
    setAttendanceLoading(true);

    try {
      if (activeSession) {
        const data = await callApi("/api/clock_out", "POST", null, token);
        setActiveSession(null);
        setLatestSession(data.record);
        const duration = calcDuration(data.record.entry_time, data.record.exit_time);
        setAttendanceSuccess(`Attendance sign-out stored successfully. In: ${formatTime(data.record.entry_time)} | Out: ${formatTime(data.record.exit_time)} | Active: ${duration}`);
      } else {
        const data = await callApi("/api/clock_in", "POST", null, token);
        setActiveSession(data.record);
        setLatestSession(data.record);
        setAttendanceSuccess("Attendance sign-in stored successfully.");
      }

      if (isAdmin) fetchAttendance(true);
    } catch (err) {
      setAttendanceError(err.message);
    } finally {
      setAttendanceLoading(false);
    }
  }

  async function logout() {
    await window._firebaseSignOut(window._firebaseAuth);
    onLogout();
  }

  const latestRecord = activeSession || latestSession || {};
  const actionMode = activeSession ? "clock-out" : "clock-in";
  const durationText = activeSession
    ? calcDuration(activeSession.entry_time, new Date(tick).toISOString(), true)
    : latestSession?.entry_time && latestSession?.exit_time
      ? calcDuration(latestSession.entry_time, latestSession.exit_time)
      : "Not started";
  const actionTitle = activeSession
    ? "Attendance session is running"
    : latestSession?.exit_time
      ? "Previous session has been stored"
      : "Ready to record your work session";
  const actionText = activeSession
    ? "When you leave, press attendance sign-out to store the full duration for this session."
    : latestSession?.exit_time
      ? "Press attendance sign-in when you are ready to start your next work session."
      : "Press attendance sign-in to begin your timer for this visit.";
  const attendanceStatus = activeSession
    ? `Active since ${formatTime(activeSession.entry_time)}`
    : latestSession?.exit_time
      ? `Signed out at ${formatTime(latestSession.exit_time)}`
      : "Awaiting sign in";

  return h("main", { className: "panel dashboard-panel", "aria-live": "polite" },
    h("header", { className: "dash-header" },
      h("div", { className: "college-brand compact" },
        h(CollegeEmblem, { small: true }),
        h("div", null,
          h("span", { className: "college-name-sm" }, "MVJ College of Engineering"),
          h("span", { className: "nav-sub" }, "Attendance Management System")
        )
      ),
      h("div", { className: "nav-right" },
        h("div", { className: "live-clock" }, new Date(tick).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })),
        h("div", { className: "nav-user" },
          h("div", { className: "nav-avatar" }, (profile?.name || "?")[0].toUpperCase()),
          h("div", { className: "nav-user-info" },
            h("span", null, profile?.name || "-"),
            h("span", { className: "nav-role" }, formatRoleLabel(role))
          )
        ),
        h("button", { className: "btn btn-outline", onClick: logout }, "Log Out Account")
      )
    ),
    h("section", { className: "welcome-banner" },
      h("div", { className: "welcome-left" },
        h("p", { className: "welcome-tag" }, "Good day,"),
        h("h2", { className: "welcome-name" }, profile?.name || "-"),
        h("div", { className: "role-badge" }, formatRoleLabel(role))
      ),
      h("div", { className: "welcome-right" },
        h("div", { className: "session-card" },
          h(SessionItem, { label: "Attendance In", value: latestRecord.entry_time ? formatTime(latestRecord.entry_time) : "-" }),
          h(SessionItem, { label: "Working Time", value: durationText }),
          h(SessionItem, { label: "Attendance Out", value: latestRecord.exit_time ? formatTime(latestRecord.exit_time) : activeSession ? "Not signed out yet" : "-" }),
          h(SessionItem, { label: "Status", value: attendanceStatus })
        )
      )
    ),
    h("section", { className: "attendance-action-panel" },
      h("div", { className: "attendance-action-copy" },
        h("p", { className: "attendance-kicker" }, "Attendance Action"),
        h("h3", null, actionTitle),
        h("p", null, actionText),
        h("div", { className: "attendance-action-meta" }, formatLongDate())
      ),
      h("div", { className: "attendance-action-controls" },
        h("button", {
          className: "btn btn-primary action-btn",
          disabled: attendanceLoading,
          onClick: handleAttendanceAction,
        }, attendanceLoading ? "Saving..." : actionMode === "clock-out" ? "Attendance Sign Out" : "Attendance Sign In")
      )
    ),
    h("div", { className: "dashboard-alerts" },
      h(Alert, { message: attendanceError }),
      h(Alert, { type: "success", message: attendanceSuccess })
    ),
    isAdmin
      ? h(AdminSection, {
          records,
          attendanceDate,
          setAttendanceDate,
          fetchAttendance,
          attendanceFetchError,
          adminRefreshStatus,
          activeTab,
          setActiveTab,
          requests,
          setRequests,
          fetchRequests,
          users,
          setUsers,
          fetchUsers,
          token,
          currentUserUid: profile?.uid,
        })
      : h(NonAdminSection)
  );
}

function SessionItem({ label, value }) {
  return h("div", { className: "session-item" },
    h("span", null, `${label}: `, h("strong", null, value))
  );
}

function AdminSection(props) {
  const latestSessions = getLatestSessionByUser(props.records);
  const checkedOut = latestSessions.filter(record => record.exit_time).length;
  const active = latestSessions.filter(record => !record.exit_time).length;
  const latestRecord = [...props.records]
    .filter(record => record.entry_time)
    .sort((a, b) => new Date(b.entry_time) - new Date(a.entry_time))[0];

  return h("section", { className: "admin-section" },
    h("div", { className: "stats-grid" },
      h(StatCard, { label: "Users Logged In Today", value: latestSessions.length, tone: "blue" }),
      h(StatCard, { label: "Latest User Login", value: latestRecord ? formatTime(latestRecord.entry_time) : "-", tone: "teal" }),
      h(StatCard, { label: "Still Active", value: active, tone: "orange" }),
      h(StatCard, { label: "Checked Out", value: checkedOut, tone: "gold" })
    ),
    h("section", { className: "insight-panel" },
      h("div", { className: "insight-head" },
        h("div", null,
          h("p", { className: "insight-kicker" }, "Admin Analytics"),
          h("h3", null, "Realtime Analytics Dashboard"),
          h("p", { className: "panel-desc" }, "Shows one live summary row per user, including admin accounts.")
        ),
        h("div", { className: "insight-meta" },
          h("span", null, props.adminRefreshStatus),
          h("span", { className: "date-chip" }, props.attendanceDate)
        )
      ),
      h("div", { className: "activity-head" },
        ["User", "Check In", "Check Out", "Total Active Hours", "Status"].map(label => h("span", { key: label }, label))
      ),
      h(LoginActivityList, { records: props.records })
    ),
    h("div", { className: "tabs" },
      h(TabButton, { id: "attendance", label: "Attendance Records", activeTab: props.activeTab, setActiveTab: props.setActiveTab }),
      h(TabButton, { id: "requests", label: "Requests", activeTab: props.activeTab, setActiveTab: props.setActiveTab, badge: props.requests.length }),
      h(TabButton, { id: "create", label: "Create User", activeTab: props.activeTab, setActiveTab: props.setActiveTab }),
      h(TabButton, { id: "manage", label: "Manage Users", activeTab: props.activeTab, setActiveTab: props.setActiveTab })
    ),
    props.activeTab === "attendance" && h(AttendanceTab, props),
    props.activeTab === "requests" && h(RequestsTab, props),
    props.activeTab === "create" && h(CreateUserTab, props),
    props.activeTab === "manage" && h(ManageUsersTab, props)
  );
}

function StatCard({ label, value, tone }) {
  return h("div", { className: "stat-card" },
    h("div", { className: `stat-icon ${tone}` }, h("span", null, "")),
    h("div", { className: "stat-info" },
      h("span", { className: "stat-value" }, value),
      h("span", { className: "stat-label" }, label)
    )
  );
}

function LoginActivityList({ records }) {
  if (!records.length) {
    return h("div", { className: "activity-list" },
      h("div", { className: "activity-empty" }, "No attendance records found yet.")
    );
  }

  const uniqueUserRecords = getLatestSessionByUser(records)
    .sort((a, b) => new Date(b.entry_time || 0) - new Date(a.entry_time || 0));

  return h("div", { className: "activity-list" },
    uniqueUserRecords.map(record => h("article", { className: "activity-row", key: record.id || record.uid },
      h("div", { className: "activity-main" },
        h("div", { className: "activity-name" }, record.name || "-"),
        h("div", { className: "activity-role" }, formatRoleLabel(record.role))
      ),
      h("div", { className: "activity-time" }, record.entry_time ? formatTime(record.entry_time) : "-"),
      h("div", { className: "activity-time" }, record.exit_time ? formatTime(record.exit_time) : "-"),
      h("div", { className: "activity-duration" }, record.entry_time ? calcDuration(record.entry_time, record.exit_time || new Date().toISOString()) : "-"),
      h("div", { className: "activity-status" },
        record.exit_time
          ? h(StatusPill, { status: "status-done" }, "Checked Out")
          : h(StatusPill, { status: "status-active" }, "Active")
      )
    ))
  );
}

function TabButton({ id, label, activeTab, setActiveTab, badge = 0 }) {
  return h("button", {
    className: `tab-btn${activeTab === id ? " active" : ""}`,
    onClick: () => setActiveTab(id),
  }, label, badge > 0 && h("span", { className: "tab-badge", "aria-label": `${badge} pending account requests` }, badge > 99 ? "99+" : badge));
}

function AttendanceTab({ records, attendanceDate, setAttendanceDate, fetchAttendance, attendanceFetchError }) {
  return h("div", { className: "tab-content active" },
    h("div", { className: "section-header" },
      h("p", { className: "panel-desc" }, "Shows every attendance session for the selected date, including multiple entries for the same user."),
      h("div", { className: "date-filter-row" },
        h("input", {
          type: "date",
          value: attendanceDate,
          onChange: event => setAttendanceDate(event.target.value),
        }),
        h("button", { className: "btn btn-sm", onClick: () => fetchAttendance(false) }, "Fetch Records"),
        h("button", { className: "btn btn-sm btn-ghost", onClick: () => exportAttendance(records, attendanceDate) }, "Export CSV")
      )
    ),
    h(Alert, { message: attendanceFetchError }),
    h("div", { className: "table-wrap" },
      h("table", null,
        h("thead", null,
          h("tr", null, ["#", "Name", "Role", "Entry Time", "Exit Time", "Duration", "Status"].map(label => h("th", { key: label }, label)))
        ),
        h("tbody", null,
          records.length
            ? records.map((record, index) => h("tr", { key: record.id || `${record.uid}-${index}` },
                h("td", null, index + 1),
                h("td", { style: { fontWeight: 600, color: "var(--text-primary)" } }, record.name || "-"),
                h("td", null, formatRoleLabel(record.role)),
                h("td", null, record.entry_time ? formatTime(record.entry_time) : "-"),
                h("td", null, record.exit_time ? formatTime(record.exit_time) : h("span", { style: { color: "var(--text-muted)" } }, "Not yet")),
                h("td", null, record.entry_time && record.exit_time ? calcDuration(record.entry_time, record.exit_time) : "-"),
                h("td", null, record.exit_time
                  ? h(StatusPill, { status: "status-done" }, "Checked Out")
                  : h(StatusPill, { status: "status-active" }, "Active"))
              ))
            : h("tr", { className: "empty-row" }, h("td", { colSpan: 7 }, "No attendance records found for this date."))
        )
      )
    )
  );
}

function exportAttendance(records, attendanceDate) {
  if (!records.length) {
    alert("No records to export. Fetch records first.");
    return;
  }

  const rows = [["Name", "Role", "Entry Time", "Exit Time", "Duration", "Status"]];
  records.forEach(record => {
    rows.push([
      record.name,
      formatRoleLabel(record.role),
      record.entry_time,
      record.exit_time || "",
      record.entry_time && record.exit_time ? calcDuration(record.entry_time, record.exit_time) : "",
      record.exit_time ? "Checked Out" : "Active",
    ]);
  });

  const csv = rows.map(row => row.map(value => `"${String(value || "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `attendance_${attendanceDate || todayLocal()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function RequestsTab({ requests, setRequests, fetchRequests, fetchUsers, token }) {
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loadingId, setLoadingId] = useState("");

  async function reviewRequest(item, action) {
    setError("");
    setSuccess("");
    const label = action === "accept" ? "Accept" : "Reject";
    if (!window.confirm(`${label} ${(item.name || item.email || "this request")}'s account request?`)) return;

    setLoadingId(`${item.id}-${action}`);
    try {
      const data = await callApi(`/api/account_requests/${encodeURIComponent(item.id)}/${action}`, "POST", null, token);
      setSuccess(data.message || `Request ${action}ed successfully.`);
      const next = requests.filter(requestItem => requestItem.id !== item.id);
      setRequests(next);
      await fetchRequests();
      if (action === "accept") fetchUsers().catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingId("");
    }
  }

  return h("div", { className: "tab-content active" },
    h("div", { className: "requests-panel" },
      h("div", { className: "section-header manage-users-head" },
        h("div", null, h("p", { className: "panel-desc" }, "Review new account requests. Accepted users can log in immediately with the password they chose.")),
        h("button", { className: "btn btn-sm btn-ghost", onClick: () => fetchRequests().catch(err => setError(err.message)) }, "Refresh Requests")
      ),
      h(Alert, { message: error }),
      h(Alert, { type: "success", message: success }),
      h("div", { className: "table-wrap" },
        h("table", { className: "users-table" },
          h("thead", null,
            h("tr", null, ["#", "Name", "Email", "Role", "Requested", "Action"].map(label => h("th", { key: label }, label)))
          ),
          h("tbody", null,
            requests.length
              ? requests.map((item, index) => h("tr", { key: item.id || item.uid },
                  h("td", null, index + 1),
                  h("td", { style: { fontWeight: 600, color: "var(--text-primary)" } }, item.name || "-"),
                  h("td", null, item.email || "-"),
                  h("td", null, formatRoleLabel(item.role)),
                  h("td", null, formatRequestDate(item.requested_at)),
                  h("td", null,
                    h("button", {
                      className: "btn btn-sm request-accept-btn",
                      disabled: loadingId === `${item.id}-accept`,
                      onClick: () => reviewRequest(item, "accept"),
                    }, loadingId === `${item.id}-accept` ? "Accepting..." : "Accept"),
                    h("button", {
                      className: "btn btn-sm user-delete-btn",
                      disabled: loadingId === `${item.id}-reject`,
                      onClick: () => reviewRequest(item, "reject"),
                    }, loadingId === `${item.id}-reject` ? "Rejecting..." : "Reject")
                  )
                ))
              : h("tr", { className: "empty-row" }, h("td", { colSpan: 6 }, "No pending account requests."))
          )
        )
      )
    )
  );
}

function CreateUserTab({ fetchUsers, token }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  function updateField(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function createUser() {
    setError("");
    setSuccess("");
    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      password: form.password,
      role: form.role,
    };

    if (!payload.name || !payload.email || !payload.password || !payload.role) {
      setError("Please fill in all fields and select a role.");
      return;
    }

    setLoading(true);
    try {
      const data = await callApi("/api/create_user", "POST", payload, token);
      setSuccess(`${data.message} (UID: ${data.uid})`);
      setForm({ name: "", email: "", password: "", role: "" });
      fetchUsers().catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return h("div", { className: "tab-content active" },
    h("div", { className: "create-user-panel" },
      h("p", { className: "panel-desc" }, "Add a new staff member or student to the system. They can log in immediately after creation."),
      h(Alert, { message: error }),
      h(Alert, { type: "success", message: success }),
      h("div", { className: "create-user-grid" },
        h(FormInput, { label: "Full Name", type: "text", value: form.name, placeholder: "Dr. Ravi Kumar", onChange: value => updateField("name", value) }),
        h(FormInput, { label: "Institutional Email", type: "email", value: form.email, placeholder: "ravi@mvjce.edu.in", onChange: value => updateField("email", value) }),
        h(FormInput, { label: "Temporary Password", type: "password", value: form.password, placeholder: "Min 6 characters", onChange: value => updateField("password", value) }),
        h("div", { className: "form-group" },
          h("label", null, "Role"),
          h("select", { value: form.role, onChange: event => updateField("role", event.target.value) },
            h("option", { value: "" }, "- Select Role -"),
            ROLE_OPTIONS.map(([value, label]) => h("option", { key: value, value }, label))
          )
        )
      ),
      h("button", { className: "btn btn-primary create-user-btn", disabled: loading, onClick: createUser }, loading ? "Creating..." : "Create User Account")
    )
  );
}

function FormInput({ label, type, value, placeholder, onChange }) {
  return h("div", { className: "form-group" },
    h("label", null, label),
    h("input", {
      type,
      value,
      placeholder,
      onChange: event => onChange(event.target.value),
    })
  );
}

function ManageUsersTab({ users, setUsers, fetchUsers, token, currentUserUid }) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loadingUid, setLoadingUid] = useState("");

  const filteredUsers = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();
    return users.filter(user => {
      const name = String(user.name || "").toLowerCase();
      const email = String(user.email || "").toLowerCase();
      const roleMatches = !roleFilter || normalizeRole(user.role) === roleFilter;
      const statusMatches = !statusFilter || String(user.account_status || "active").toLowerCase() === statusFilter;
      const searchMatches = !searchTerm || name.includes(searchTerm) || email.includes(searchTerm);
      return roleMatches && statusMatches && searchMatches;
    });
  }, [roleFilter, search, statusFilter, users]);

  async function toggleStatus(user) {
    setError("");
    setSuccess("");
    const isDisabled = String(user.account_status || "").toLowerCase() === "disabled";
    const nextStatus = isDisabled ? "active" : "disabled";
    const name = user.name || user.email || "this user";
    if (!window.confirm(`${nextStatus === "disabled" ? "Disable" : "Enable"} ${name}'s account?`)) return;

    setLoadingUid(user.uid);
    try {
      const data = await callApi(`/api/users/${encodeURIComponent(user.uid)}`, "PATCH", {
        account_status: nextStatus,
      }, token);
      setSuccess(data.message || "User updated successfully.");
      setUsers(prev => prev.map(item => item.uid === user.uid ? { ...item, account_status: nextStatus } : item));
      fetchUsers().catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingUid("");
    }
  }

  async function deleteUser(user) {
    setError("");
    setSuccess("");
    const name = user.name || user.email || "this user";
    if (!window.confirm(`Delete ${name}'s account permanently?`)) return;

    setLoadingUid(user.uid);
    try {
      const data = await callApi(`/api/users/${encodeURIComponent(user.uid)}`, "DELETE", null, token);
      setSuccess(data.message || "User deleted successfully.");
      setUsers(prev => prev.filter(item => item.uid !== user.uid));
      fetchUsers().catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingUid("");
    }
  }

  return h("div", { className: "tab-content active" },
    h("div", { className: "manage-users-panel" },
      h("div", { className: "section-header manage-users-head" },
        h("div", null, h("p", { className: "panel-desc" }, "Review all existing user accounts and remove users that should no longer access the system.")),
        h("button", { className: "btn btn-sm btn-ghost", onClick: () => fetchUsers().catch(err => setError(err.message)) }, "Refresh Users")
      ),
      h("div", { className: "manage-users-toolbar" },
        h("input", { type: "search", placeholder: "Search by name or email", value: search, onChange: event => setSearch(event.target.value) }),
        h("select", { value: roleFilter, onChange: event => setRoleFilter(event.target.value) },
          h("option", { value: "" }, "All Roles"),
          ROLE_OPTIONS.map(([value, label]) => h("option", { key: value, value }, label))
        ),
        h("select", { value: statusFilter, onChange: event => setStatusFilter(event.target.value) },
          h("option", { value: "" }, "All Statuses"),
          h("option", { value: "active" }, "Active"),
          h("option", { value: "disabled" }, "Disabled")
        )
      ),
      h(Alert, { message: error }),
      h(Alert, { type: "success", message: success }),
      h("div", { className: "table-wrap" },
        h("table", { className: "users-table" },
          h("thead", null,
            h("tr", null, ["#", "Name", "Email", "Role", "Status", "Action"].map(label => h("th", { key: label }, label)))
          ),
          h("tbody", null,
            filteredUsers.length
              ? filteredUsers.map((user, index) => {
                  const isCurrentUser = user.uid === currentUserUid;
                  const isDisabled = String(user.account_status || "").toLowerCase() === "disabled";
                  return h("tr", { key: user.uid || index },
                    h("td", null, index + 1),
                    h("td", { style: { fontWeight: 600, color: "var(--text-primary)" } }, user.name || "-"),
                    h("td", null, user.email || "-"),
                    h("td", null, formatRoleLabel(user.role)),
                    h("td", null,
                      h(StatusPill, { status: isDisabled ? "status-disabled" : "status-active" }, formatAccountStatusLabel(user.account_status))
                    ),
                    h("td", null,
                      isCurrentUser
                        ? h("button", { className: "btn btn-sm", disabled: true }, "Current Account")
                        : [
                            h("button", {
                              key: "toggle",
                              className: "btn btn-sm user-toggle-btn",
                              disabled: loadingUid === user.uid,
                              onClick: () => toggleStatus(user),
                            }, isDisabled ? "Enable" : "Disable"),
                            h("button", {
                              key: "delete",
                              className: "btn btn-sm user-delete-btn",
                              disabled: loadingUid === user.uid,
                              onClick: () => deleteUser(user),
                            }, "Delete"),
                          ]
                    )
                  );
                })
              : h("tr", { className: "empty-row" }, h("td", { colSpan: 6 }, "No user accounts found."))
          )
        )
      )
    )
  );
}

function NonAdminSection() {
  return h("section", { className: "non-admin-msg" },
    h("div", { className: "na-card" },
      h("div", { className: "na-icon" }, "A"),
      h("h3", null, "Attendance control is ready"),
      h("p", null, "Use the attendance sign-in button to start your work timer. When you leave later, log in again and press attendance sign-out to store the full duration."),
      h("div", { className: "na-tip" }, "Contact your administrator if you need attendance reports.")
    )
  );
}

function App() {
  const [firebaseReady, setFirebaseReady] = useState(Boolean(window._firebaseAuth));
  const [token, setToken] = useState(null);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    function markReady() {
      setFirebaseReady(true);
    }

    if (window._firebaseAuth) markReady();
    window.addEventListener("firebase-ready", markReady);
    return () => window.removeEventListener("firebase-ready", markReady);
  }, []);

  useEffect(() => {
    if (!firebaseReady || !window._firebaseOnAuth) return undefined;

    return window._firebaseOnAuth(window._firebaseAuth, async user => {
      if (!user) {
        setToken(null);
        setProfile(null);
        return;
      }

      try {
        const idToken = await user.getIdToken(true);
        const data = await callApi("/api/login", "POST", null, idToken);
        setToken(idToken);
        setProfile(data);
      } catch {
        setToken(null);
        setProfile(null);
      }
    });
  }, [firebaseReady]);

  function handleLoginComplete(nextToken, data) {
    setToken(nextToken);
    setProfile(data);
  }

  function handleLogout() {
    setToken(null);
    setProfile(null);
  }

  if (!firebaseReady) {
    return h("main", { className: "panel login-panel" },
      h("div", { className: "login-card" },
        h("div", { className: "divider" }, h("span", null, "Loading")),
        h("p", { className: "form-hint" }, "Preparing authentication...")
      )
    );
  }

  return token && profile
    ? h(DashboardView, { token, profile, onLogout: handleLogout })
    : h(LoginView, { onLoginComplete: handleLoginComplete });
}

ReactDOM.createRoot(document.getElementById("root")).render(h(App));
