import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const COLORS = ["#4f6df5", "#17b26a", "#f79009", "#e5484d", "#9b5de5", "#00b8d9"];
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

// ---------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------
let session = null;
let myProfile = null; // { id, email, role }
let trips = [];
let viewDate = new Date();
viewDate.setDate(1);
let realtimeChannel = null;

// ---------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

const authView = $("authView");
const appView = $("appView");
const loginForm = $("loginForm");
const loginError = $("loginError");
const mfaForm = $("mfaForm");
const mfaError = $("mfaError");
const resendCodeBtn = $("resendCodeBtn");
const setPasswordForm = $("setPasswordForm");
const setPasswordError = $("setPasswordError");

const whoami = $("whoami");
const usersBtn = $("usersBtn");
const addTripBtn = $("addTripBtn");
const logoutBtn = $("logoutBtn");

const monthLabel = $("monthLabel");
const calendarGrid = $("calendarGrid");
const weekdaysEl = $("weekdays");
const upcomingList = $("upcomingList");
const allList = $("allList");

const tripModal = $("tripModal");
const tripForm = $("tripForm");
const tripFormError = $("tripFormError");
const modalTitle = $("modalTitle");
const tripIdInput = $("tripId");
const tripNameInput = $("tripName");
const tripPlaceInput = $("tripPlace");
const tripStartInput = $("tripStart");
const tripEndInput = $("tripEnd");
const tripNotesInput = $("tripNotes");
const deleteTripBtn = $("deleteTripBtn");
const historyBtn = $("historyBtn");
const colorPicker = $("colorPicker");
const saveTripBtn = $("saveTripBtn");

const historyModal = $("historyModal");
const historyList = $("historyList");

const usersModal = $("usersModal");
const mfaGate = $("mfaGate");
const usersPanel = $("usersPanel");
const sendAdminCodeBtn = $("sendAdminCodeBtn");
const adminMfaForm = $("adminMfaForm");
const adminMfaError = $("adminMfaError");
const inviteForm = $("inviteForm");
const inviteError = $("inviteError");
const inviteSuccess = $("inviteSuccess");
const usersTable = $("usersTable");

let selectedColor = COLORS[0];
let pendingLoginEmail = "";
let pendingLoginPassword = "";

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function showError(el, message) {
  el.textContent = message;
  el.classList.remove("hidden");
}
function hideError(el) {
  el.classList.add("hidden");
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseISODate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function stripTime(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function formatRange(startISO, endISO) {
  const s = parseISODate(startISO);
  const e = parseISODate(endISO);
  const opts = { day: "numeric", month: "short" };
  const sStr = s.toLocaleDateString("ru-RU", opts);
  const eStr = e.toLocaleDateString("ru-RU", opts);
  return sStr === eStr ? sStr : `${sStr} — ${eStr}`;
}
function roleLabel(role) {
  return { admin: "Суперпользователь", editor: "Редактор", viewer: "Читатель" }[role] ?? role;
}
async function callFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    // supabase-js wraps non-2xx responses in error; try to read our JSON message
    let message = error.message;
    try {
      const ctx = await error.context?.json?.();
      if (ctx?.error) message = ctx.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// ---------------------------------------------------------------------
// Auth flow
// ---------------------------------------------------------------------
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError(loginError);
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    showError(loginError, "Неверный email или пароль.");
    return;
  }
  session = data.session;

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("id, email, role")
    .eq("id", session.user.id)
    .single();
  if (profileErr || !profile) {
    showError(loginError, "Учётная запись не настроена. Обратитесь к суперпользователю.");
    await supabase.auth.signOut();
    return;
  }
  myProfile = profile;

  if (profile.role === "admin") {
    pendingLoginEmail = email;
    pendingLoginPassword = password;
    try {
      await callFunction("send-mfa-code", { purpose: "login" });
    } catch (err) {
      showError(loginError, "Не удалось отправить код: " + err.message);
      return;
    }
    loginForm.classList.add("hidden");
    mfaForm.classList.remove("hidden");
  } else {
    await enterApp();
  }
});

mfaForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError(mfaError);
  const code = $("mfaCode").value.trim();
  try {
    await callFunction("verify-mfa-code", { code, purpose: "login" });
  } catch (err) {
    showError(mfaError, err.message || "Неверный код");
    return;
  }
  mfaForm.classList.add("hidden");
  mfaForm.reset();
  await enterApp();
});

resendCodeBtn.addEventListener("click", async () => {
  hideError(mfaError);
  try {
    await callFunction("send-mfa-code", { purpose: "login" });
    resendCodeBtn.textContent = "Код отправлен ✓";
    setTimeout(() => (resendCodeBtn.textContent = "Отправить код ещё раз"), 2500);
  } catch (err) {
    showError(mfaError, err.message);
  }
});

logoutBtn.addEventListener("click", async () => {
  await supabase.auth.signOut();
  teardownApp();
});

async function enterApp() {
  authView.classList.add("hidden");
  appView.classList.remove("hidden");
  loginForm.classList.remove("hidden");
  loginForm.reset();
  mfaForm.classList.add("hidden");

  whoami.textContent = `${myProfile.email} · ${roleLabel(myProfile.role)}`;
  const canEdit = myProfile.role === "admin" || myProfile.role === "editor";
  addTripBtn.classList.toggle("hidden", !canEdit);
  usersBtn.classList.toggle("hidden", myProfile.role !== "admin");

  renderWeekdays();
  await loadTrips();
  subscribeRealtime();
}

function teardownApp() {
  session = null;
  myProfile = null;
  trips = [];
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  appView.classList.add("hidden");
  authView.classList.remove("hidden");
}

setPasswordForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError(setPasswordError);
  const password = $("newPassword").value;
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    showError(setPasswordError, error.message);
    return;
  }
  setPasswordForm.classList.add("hidden");
  setPasswordForm.reset();
  await afterAuthenticated();
});

// Restore session on page load. An invite/recovery link lands here with
// #type=invite|recovery in the URL hash — supabase-js auto-establishes a
// session from it, but the user still needs to choose a password.
const isInviteLink = /type=(invite|recovery)/.test(window.location.hash);

supabase.auth.getSession().then(async ({ data }) => {
  if (!data.session) return;
  session = data.session;
  if (isInviteLink) {
    loginForm.classList.add("hidden");
    setPasswordForm.classList.remove("hidden");
    return;
  }
  await afterAuthenticated();
});

async function afterAuthenticated() {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, role")
    .eq("id", session.user.id)
    .single();
  if (profile) {
    myProfile = profile;
    await enterApp();
  }
}

// ---------------------------------------------------------------------
// Trips: load + realtime
// ---------------------------------------------------------------------
async function loadTrips() {
  const { data, error } = await supabase
    .from("trips")
    .select("*")
    .order("start_date", { ascending: true });
  if (error) {
    console.error(error);
    return;
  }
  trips = data;
  renderAll();
}

function subscribeRealtime() {
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  realtimeChannel = supabase
    .channel("trips-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, () => {
      loadTrips();
    })
    .subscribe();
}

// ---------------------------------------------------------------------
// Calendar rendering
// ---------------------------------------------------------------------
function tripsOnDay(dateObj) {
  return trips.filter((t) => {
    const start = parseISODate(t.start_date);
    const end = parseISODate(t.end_date);
    return dateObj >= stripTime(start) && dateObj <= stripTime(end);
  });
}

function renderWeekdays() {
  weekdaysEl.innerHTML = "";
  WEEKDAYS.forEach((w) => {
    const span = document.createElement("span");
    span.textContent = w;
    weekdaysEl.appendChild(span);
  });
}

function renderCalendar() {
  monthLabel.textContent = `${MONTHS[viewDate.getMonth()]} ${viewDate.getFullYear()}`;
  calendarGrid.innerHTML = "";

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const today = new Date();
  const cells = [];

  for (let i = 0; i < firstWeekday; i++) {
    const dayNum = daysInPrevMonth - firstWeekday + 1 + i;
    cells.push({ date: new Date(year, month - 1, dayNum), outside: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), outside: false });
  }
  while (cells.length % 7 !== 0 || cells.length < 42) {
    const last = cells[cells.length - 1].date;
    const next = new Date(last);
    next.setDate(next.getDate() + 1);
    cells.push({ date: next, outside: true });
    if (cells.length >= 42) break;
  }

  cells.forEach(({ date, outside }) => {
    const cell = document.createElement("div");
    cell.className = "day-cell" + (outside ? " outside" : "") + (isSameDay(date, today) ? " today" : "");

    const num = document.createElement("div");
    num.className = "day-num";
    num.textContent = date.getDate();
    cell.appendChild(num);

    const dayTrips = tripsOnDay(date);
    dayTrips.slice(0, 3).forEach((t) => {
      const chip = document.createElement("div");
      chip.className = "trip-chip";
      chip.style.background = t.color || COLORS[0];
      chip.textContent = t.name;
      chip.title = `${t.name}${t.place ? " — " + t.place : ""}`;
      chip.addEventListener("click", () => openModal(t));
      cell.appendChild(chip);
    });
    if (dayTrips.length > 3) {
      const more = document.createElement("div");
      more.className = "day-num";
      more.textContent = `+${dayTrips.length - 3} ещё`;
      cell.appendChild(more);
    }
    calendarGrid.appendChild(cell);
  });
}

function renderLists() {
  const today = stripTime(new Date());
  const sorted = [...trips].sort((a, b) => a.start_date.localeCompare(b.start_date));
  const upcoming = sorted.filter((t) => parseISODate(t.end_date) >= today).slice(0, 5);

  upcomingList.innerHTML = "";
  if (upcoming.length === 0) {
    upcomingList.innerHTML = '<div class="empty-hint">Поездок не запланировано</div>';
  } else {
    upcoming.forEach((t) => upcomingList.appendChild(tripCard(t)));
  }

  allList.innerHTML = "";
  if (sorted.length === 0) {
    allList.innerHTML = '<div class="empty-hint">Пока нет поездок</div>';
  } else {
    sorted.forEach((t) => allList.appendChild(tripCard(t)));
  }
}

function tripCard(t) {
  const card = document.createElement("div");
  card.className = "trip-card";
  card.style.borderLeftColor = t.color || COLORS[0];
  card.innerHTML = `
    <div class="name">${escapeHtml(t.name)}</div>
    <div class="meta">${t.place ? escapeHtml(t.place) + " · " : ""}${formatRange(t.start_date, t.end_date)}</div>
  `;
  card.addEventListener("click", () => openModal(t));
  return card;
}

function renderAll() {
  renderCalendar();
  renderLists();
}

// ---------------------------------------------------------------------
// Trip modal (view / create / edit)
// ---------------------------------------------------------------------
function buildColorPicker() {
  colorPicker.innerHTML = "";
  COLORS.forEach((c) => {
    const sw = document.createElement("div");
    sw.className = "color-swatch" + (c === selectedColor ? " selected" : "");
    sw.style.background = c;
    sw.addEventListener("click", () => {
      if (!canEditTrips()) return;
      selectedColor = c;
      buildColorPicker();
    });
    colorPicker.appendChild(sw);
  });
}

function canEditTrips() {
  return myProfile && (myProfile.role === "admin" || myProfile.role === "editor");
}

let currentTripId = null;

function openModal(trip) {
  hideError(tripFormError);
  tripForm.reset();
  currentTripId = trip ? trip.id : null;
  const editable = canEditTrips();

  if (trip) {
    modalTitle.textContent = editable ? "Редактировать поездку" : "Поездка";
    tripIdInput.value = trip.id;
    tripNameInput.value = trip.name;
    tripPlaceInput.value = trip.place || "";
    tripStartInput.value = trip.start_date;
    tripEndInput.value = trip.end_date;
    tripNotesInput.value = trip.notes || "";
    selectedColor = trip.color || COLORS[0];
    deleteTripBtn.classList.toggle("hidden", !editable);
    historyBtn.classList.remove("hidden");
  } else {
    modalTitle.textContent = "Новая поездка";
    tripIdInput.value = "";
    const todayISO = toISODate(new Date());
    tripStartInput.value = todayISO;
    tripEndInput.value = todayISO;
    selectedColor = COLORS[trips.length % COLORS.length];
    deleteTripBtn.classList.add("hidden");
    historyBtn.classList.add("hidden");
  }

  [tripNameInput, tripPlaceInput, tripStartInput, tripEndInput, tripNotesInput].forEach((el) => {
    el.disabled = !editable;
  });
  saveTripBtn.classList.toggle("hidden", !editable);

  buildColorPicker();
  tripModal.classList.remove("hidden");
  if (editable) tripNameInput.focus();
}

function closeModal() {
  tripModal.classList.add("hidden");
}

addTripBtn.addEventListener("click", () => openModal(null));
$("closeModal").addEventListener("click", closeModal);
$("cancelBtn").addEventListener("click", closeModal);
tripModal.addEventListener("click", (e) => {
  if (e.target === tripModal) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!tripModal.classList.contains("hidden")) closeModal();
  if (!historyModal.classList.contains("hidden")) historyModal.classList.add("hidden");
  if (!usersModal.classList.contains("hidden")) usersModal.classList.add("hidden");
});

tripForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError(tripFormError);
  if (!canEditTrips()) return;

  const start = tripStartInput.value;
  const end = tripEndInput.value;
  if (end < start) {
    showError(tripFormError, "Дата окончания не может быть раньше даты начала.");
    return;
  }

  const payload = {
    name: tripNameInput.value.trim(),
    place: tripPlaceInput.value.trim(),
    start_date: start,
    end_date: end,
    notes: tripNotesInput.value.trim(),
    color: selectedColor,
  };

  let result;
  if (tripIdInput.value) {
    result = await supabase.from("trips").update(payload).eq("id", tripIdInput.value);
  } else {
    result = await supabase.from("trips").insert(payload);
  }
  if (result.error) {
    showError(tripFormError, result.error.message);
    return;
  }
  closeModal();
  await loadTrips();
});

deleteTripBtn.addEventListener("click", async () => {
  const id = tripIdInput.value;
  if (!id || !canEditTrips()) return;
  if (!confirm("Удалить эту поездку?")) return;
  const { error } = await supabase.from("trips").delete().eq("id", id);
  if (error) {
    showError(tripFormError, error.message);
    return;
  }
  closeModal();
  await loadTrips();
});

// ---------------------------------------------------------------------
// History modal
// ---------------------------------------------------------------------
historyBtn.addEventListener("click", async () => {
  if (!currentTripId) return;
  const { data, error } = await supabase
    .from("trip_history")
    .select("*")
    .eq("trip_id", currentTripId)
    .order("changed_at", { ascending: false });

  historyList.innerHTML = "";
  if (error) {
    historyList.innerHTML = `<div class="empty-hint">${escapeHtml(error.message)}</div>`;
  } else if (!data.length) {
    historyList.innerHTML = '<div class="empty-hint">Изменений пока нет</div>';
  } else {
    data.forEach((row) => historyList.appendChild(historyRow(row)));
  }
  historyModal.classList.remove("hidden");
});
$("closeHistoryModal").addEventListener("click", () => historyModal.classList.add("hidden"));
historyModal.addEventListener("click", (e) => {
  if (e.target === historyModal) historyModal.classList.add("hidden");
});

const ACTION_LABEL = { insert: "Создано", update: "Изменено", delete: "Удалено" };

function historyRow(row) {
  const el = document.createElement("div");
  el.className = "history-row";
  const when = new Date(row.changed_at).toLocaleString("ru-RU");
  let diffHtml = "";
  if (row.action === "update" && row.old_data && row.new_data) {
    const fields = ["name", "place", "start_date", "end_date", "notes", "color"];
    const changes = fields
      .filter((f) => row.old_data[f] !== row.new_data[f])
      .map((f) => `<li><b>${f}</b>: «${escapeHtml(String(row.old_data[f] ?? ""))}» → «${escapeHtml(String(row.new_data[f] ?? ""))}»</li>`)
      .join("");
    diffHtml = changes ? `<ul class="history-diff">${changes}</ul>` : "";
  }
  el.innerHTML = `
    <div class="history-top">
      <span class="history-action history-${row.action}">${ACTION_LABEL[row.action] || row.action}</span>
      <span class="history-when">${when}</span>
    </div>
    <div class="history-who">${escapeHtml(row.changed_by_email || "неизвестно")}</div>
    ${diffHtml}
  `;
  return el;
}

// ---------------------------------------------------------------------
// Users / admin panel
// ---------------------------------------------------------------------
usersBtn.addEventListener("click", async () => {
  usersModal.classList.remove("hidden");
  hideError(inviteError);
  inviteSuccess.classList.add("hidden");
  await checkAdminGate();
});
$("closeUsersModal").addEventListener("click", () => usersModal.classList.add("hidden"));
usersModal.addEventListener("click", (e) => {
  if (e.target === usersModal) usersModal.classList.add("hidden");
});

async function checkAdminGate() {
  const { data } = await supabase
    .from("admin_mfa_sessions")
    .select("verified_at")
    .eq("user_id", myProfile.id)
    .maybeSingle();
  const fresh = data && Date.now() - new Date(data.verified_at).getTime() < 12 * 60 * 60 * 1000;
  if (fresh) {
    mfaGate.classList.add("hidden");
    usersPanel.classList.remove("hidden");
    await loadUsers();
  } else {
    mfaGate.classList.remove("hidden");
    usersPanel.classList.add("hidden");
    adminMfaForm.classList.add("hidden");
  }
}

sendAdminCodeBtn.addEventListener("click", async () => {
  try {
    await callFunction("send-mfa-code", { purpose: "admin_action" });
    adminMfaForm.classList.remove("hidden");
    sendAdminCodeBtn.textContent = "Код отправлен ✓";
  } catch (err) {
    alert("Не удалось отправить код: " + err.message);
  }
});

adminMfaForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError(adminMfaError);
  const code = $("adminMfaCode").value.trim();
  try {
    await callFunction("verify-mfa-code", { code, purpose: "admin_action" });
    adminMfaForm.reset();
    await checkAdminGate();
  } catch (err) {
    showError(adminMfaError, err.message);
  }
});

async function loadUsers() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, role, created_at")
    .order("created_at", { ascending: true });
  usersTable.innerHTML = "";
  if (error) {
    usersTable.innerHTML = `<div class="empty-hint">${escapeHtml(error.message)}</div>`;
    return;
  }
  data.forEach((u) => usersTable.appendChild(userRow(u)));
}

function userRow(u) {
  const row = document.createElement("div");
  row.className = "user-row";
  const isSelf = u.id === myProfile.id;
  const isAdmin = u.role === "admin";

  row.innerHTML = `
    <div class="user-email">${escapeHtml(u.email)}${isSelf ? " (вы)" : ""}</div>
    <div class="user-role">${roleLabel(u.role)}</div>
    <div class="user-actions"></div>
  `;

  const actions = row.querySelector(".user-actions");
  if (!isAdmin && !isSelf) {
    const select = document.createElement("select");
    ["editor", "viewer"].forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = roleLabel(r);
      if (r === u.role) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener("change", async () => {
      try {
        await callFunction("set-user-role", { userId: u.id, role: select.value });
        await loadUsers();
      } catch (err) {
        alert("Ошибка: " + err.message);
        await loadUsers();
      }
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn btn-danger btn-sm";
    removeBtn.textContent = "Удалить";
    removeBtn.addEventListener("click", async () => {
      if (!confirm(`Удалить доступ пользователя ${u.email}?`)) return;
      try {
        await callFunction("remove-user", { userId: u.id });
        await loadUsers();
      } catch (err) {
        alert("Ошибка: " + err.message);
      }
    });

    actions.appendChild(select);
    actions.appendChild(removeBtn);
  }
  return row;
}

inviteForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError(inviteError);
  inviteSuccess.classList.add("hidden");
  const email = $("inviteEmail").value.trim();
  const role = $("inviteRole").value;
  try {
    await callFunction("invite-user", { email, role });
    inviteSuccess.textContent = `Приглашение отправлено на ${email}`;
    inviteSuccess.classList.remove("hidden");
    inviteForm.reset();
    await loadUsers();
  } catch (err) {
    showError(inviteError, err.message);
  }
});

// ---------------------------------------------------------------------
// Month navigation
// ---------------------------------------------------------------------
$("prevMonth").addEventListener("click", () => {
  viewDate.setMonth(viewDate.getMonth() - 1);
  renderCalendar();
});
$("nextMonth").addEventListener("click", () => {
  viewDate.setMonth(viewDate.getMonth() + 1);
  renderCalendar();
});
$("todayBtn").addEventListener("click", () => {
  viewDate = new Date();
  viewDate.setDate(1);
  renderCalendar();
});
