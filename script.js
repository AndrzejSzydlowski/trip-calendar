// --- Хранилище ---
const STORAGE_KEY = "trip-calendar:trips";

function loadTrips() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTrips(trips) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trips));
  } catch {
    /* ignore quota / private mode errors */
  }
}

let trips = loadTrips();

const COLORS = ["#4f6df5", "#17b26a", "#f79009", "#e5484d", "#9b5de5", "#00b8d9"];

// --- Состояние календаря ---
let viewDate = new Date();
viewDate.setDate(1);

const monthLabel = document.getElementById("monthLabel");
const calendarGrid = document.getElementById("calendarGrid");
const weekdaysEl = document.getElementById("weekdays");
const upcomingList = document.getElementById("upcomingList");
const allList = document.getElementById("allList");

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

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

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function tripsOnDay(dateObj) {
  return trips.filter((t) => {
    const start = parseISODate(t.start);
    const end = parseISODate(t.end);
    return dateObj >= stripTime(start) && dateObj <= stripTime(end);
  });
}

function stripTime(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
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
  // Monday-first index: 0=Mon..6=Sun
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

function formatRange(startISO, endISO) {
  const s = parseISODate(startISO);
  const e = parseISODate(endISO);
  const opts = { day: "numeric", month: "short" };
  const sStr = s.toLocaleDateString("ru-RU", opts);
  const eStr = e.toLocaleDateString("ru-RU", opts);
  return sStr === eStr ? sStr : `${sStr} — ${eStr}`;
}

function renderLists() {
  const today = stripTime(new Date());
  const sorted = [...trips].sort((a, b) => a.start.localeCompare(b.start));

  const upcoming = sorted.filter((t) => parseISODate(t.end) >= today).slice(0, 5);
  upcomingList.innerHTML = "";
  if (upcoming.length === 0) {
    upcomingList.innerHTML = '<div class="empty-hint">Поездок не запланировано</div>';
  } else {
    upcoming.forEach((t) => upcomingList.appendChild(tripCard(t)));
  }

  allList.innerHTML = "";
  if (sorted.length === 0) {
    allList.innerHTML = '<div class="empty-hint">Пока нет поездок — добавьте первую!</div>';
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
    <div class="meta">${t.place ? escapeHtml(t.place) + " · " : ""}${formatRange(t.start, t.end)}</div>
  `;
  card.addEventListener("click", () => openModal(t));
  return card;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderAll() {
  renderCalendar();
  renderLists();
}

// --- Модалка ---
const modal = document.getElementById("tripModal");
const tripForm = document.getElementById("tripForm");
const modalTitle = document.getElementById("modalTitle");
const tripIdInput = document.getElementById("tripId");
const tripNameInput = document.getElementById("tripName");
const tripPlaceInput = document.getElementById("tripPlace");
const tripStartInput = document.getElementById("tripStart");
const tripEndInput = document.getElementById("tripEnd");
const tripNotesInput = document.getElementById("tripNotes");
const deleteTripBtn = document.getElementById("deleteTripBtn");
const colorPicker = document.getElementById("colorPicker");

let selectedColor = COLORS[0];

function buildColorPicker() {
  colorPicker.innerHTML = "";
  COLORS.forEach((c) => {
    const sw = document.createElement("div");
    sw.className = "color-swatch" + (c === selectedColor ? " selected" : "");
    sw.style.background = c;
    sw.addEventListener("click", () => {
      selectedColor = c;
      buildColorPicker();
    });
    colorPicker.appendChild(sw);
  });
}

function openModal(trip) {
  tripForm.reset();
  if (trip) {
    modalTitle.textContent = "Редактировать поездку";
    tripIdInput.value = trip.id;
    tripNameInput.value = trip.name;
    tripPlaceInput.value = trip.place || "";
    tripStartInput.value = trip.start;
    tripEndInput.value = trip.end;
    tripNotesInput.value = trip.notes || "";
    selectedColor = trip.color || COLORS[0];
    deleteTripBtn.classList.remove("hidden");
  } else {
    modalTitle.textContent = "Новая поездка";
    tripIdInput.value = "";
    const todayISO = toISODate(new Date());
    tripStartInput.value = todayISO;
    tripEndInput.value = todayISO;
    selectedColor = COLORS[trips.length % COLORS.length];
    deleteTripBtn.classList.add("hidden");
  }
  buildColorPicker();
  modal.classList.remove("hidden");
  tripNameInput.focus();
}

function closeModal() {
  modal.classList.add("hidden");
}

document.getElementById("addTripBtn").addEventListener("click", () => openModal(null));
document.getElementById("closeModal").addEventListener("click", closeModal);
document.getElementById("cancelBtn").addEventListener("click", closeModal);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.classList.contains("hidden")) closeModal();
});

tripForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const start = tripStartInput.value;
  const end = tripEndInput.value;
  if (end < start) {
    alert("Дата окончания не может быть раньше даты начала.");
    return;
  }
  const id = tripIdInput.value || crypto.randomUUID();
  const tripData = {
    id,
    name: tripNameInput.value.trim(),
    place: tripPlaceInput.value.trim(),
    start,
    end,
    notes: tripNotesInput.value.trim(),
    color: selectedColor,
  };

  const idx = trips.findIndex((t) => t.id === id);
  if (idx >= 0) {
    trips[idx] = tripData;
  } else {
    trips.push(tripData);
  }
  saveTrips(trips);
  closeModal();
  renderAll();
});

deleteTripBtn.addEventListener("click", () => {
  const id = tripIdInput.value;
  if (!id) return;
  if (!confirm("Удалить эту поездку?")) return;
  trips = trips.filter((t) => t.id !== id);
  saveTrips(trips);
  closeModal();
  renderAll();
});

// --- Навигация по месяцам ---
document.getElementById("prevMonth").addEventListener("click", () => {
  viewDate.setMonth(viewDate.getMonth() - 1);
  renderCalendar();
});
document.getElementById("nextMonth").addEventListener("click", () => {
  viewDate.setMonth(viewDate.getMonth() + 1);
  renderCalendar();
});
document.getElementById("todayBtn").addEventListener("click", () => {
  viewDate = new Date();
  viewDate.setDate(1);
  renderCalendar();
});

// --- Инициализация ---
renderWeekdays();
renderAll();
