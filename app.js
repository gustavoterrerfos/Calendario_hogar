const config = window.HOGAR_CONFIG || {};

const state = {
  bootstrap: null,
  occurrences: [],
  agendaItems: [],
  monthCursor: new Date().toISOString().slice(0, 7),
  weekCursor: startOfWeek(new Date().toISOString().slice(0, 10)),
  dayCursor: new Date().toISOString().slice(0, 10),
  agendaFilters: { status: "", memberId: "", category: "" },
  collapsedAgendaDays: {},
  modal: null,
  loading: true,
};

const app = document.getElementById("app");

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function startOfWeek(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return formatDate(date);
}

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + amount);
  return formatDate(date);
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function humanDate(dateString) {
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(new Date(`${dateString}T00:00:00`));
}

function longDate(dateString) {
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${dateString}T00:00:00`));
}

function timeText(time) {
  return time ? time.slice(0, 5) : "Sin hora";
}

function durationText(value) {
  return `${value} min`;
}

function monthTitle(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

function buildUrl(action, params = {}) {
  if (!config.apiBaseUrl || !config.clientKey) {
    throw new Error("Falta configurar apiBaseUrl o clientKey en config.js");
  }
  const callbackName = `hogar_cb_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const url = new URL(config.apiBaseUrl);
  url.searchParams.set("action", action);
  url.searchParams.set("clientKey", config.clientKey);
  url.searchParams.set("callback", callbackName);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
    }
  });
  return { url: url.toString(), callbackName };
}

function api(action, params = {}) {
  return new Promise((resolve, reject) => {
    const { url, callbackName } = buildUrl(action, params);
    const script = document.createElement("script");
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("La API tardó demasiado en responder."));
    }, 20000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (payload) => {
      cleanup();
      if (!payload || payload.ok === false) {
        reject(new Error(payload?.error || "Error remoto"));
        return;
      }
      resolve(payload.data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("No se pudo cargar la API."));
    };
    script.src = url;
    document.body.appendChild(script);
  });
}

function callWithPayload(action, payload) {
  return api(action, { payload: JSON.stringify(payload) });
}

async function refreshData() {
  state.bootstrap = await api("bootstrap");
  const range = getCurrentRange();
  state.occurrences = await api("occurrences", range);
  state.agendaItems = await api("occurrences", {
    start: new Date().toISOString().slice(0, 10),
    status: state.agendaFilters.status,
    memberId: state.agendaFilters.memberId,
    category: state.agendaFilters.category
  });
}

function getCurrentRange() {
  const [year, month] = state.monthCursor.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const start = new Date(first);
  const offset = (start.getDay() || 7) - 1;
  start.setDate(start.getDate() - offset);
  const end = new Date(start);
  end.setDate(end.getDate() + 41);
  const values = [formatDate(start), formatDate(end), state.weekCursor, addDays(state.weekCursor, 6), state.dayCursor];
  values.sort();
  return { start: values[0], end: values[values.length - 1], ...state.agendaFilters };
}

function memberOptions(selected) {
  return [`<option value="">Sin asignar</option>`]
    .concat(
      state.bootstrap.members.map((member) => `<option value="${member.id}" ${selected === member.id ? "selected" : ""}>${esc(member.name)}</option>`),
    )
    .join("");
}

function listOptions(selected) {
  return [`<option value="">Sin lista variable</option>`]
    .concat(
      state.bootstrap.lists.map((list) => `<option value="${list.key}" ${selected === list.key ? "selected" : ""}>${esc(list.label)}</option>`),
    )
    .join("");
}

function statusBadge(status) {
  const labels = {
    pending: "Pendiente",
    completed: "Hecho",
    postponed: "Reprogramado",
    cancelled: "Cancelado",
  };
  return `<span class="badge ${status}">${labels[status] || status}</span>`;
}

function describeFrequency(rule) {
  if (rule.frequencyKind === "daily") return `Cada ${rule.frequencyInterval} días`;
  if (rule.frequencyKind === "weekly") return `Cada ${rule.frequencyInterval} semana(s) · ${rule.daysOfWeek.join(",")}`;
  if (rule.frequencyKind === "monthly") return rule.dayOfMonth ? `Mensual día ${rule.dayOfMonth}` : `Cada ${rule.frequencyInterval} mes(es)`;
  return rule.frequencyKind;
}

function getMonthGrid(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const start = new Date(first);
  const offset = (start.getDay() || 7) - 1;
  start.setDate(start.getDate() - offset);
  const weeks = [];
  for (let row = 0; row < 6; row += 1) {
    const week = [];
    for (let col = 0; col < 7; col += 1) {
      const current = new Date(start);
      current.setDate(start.getDate() + row * 7 + col);
      week.push(formatDate(current));
    }
    weeks.push(week);
  }
  return weeks;
}

function byDate(items) {
  return items.reduce((acc, item) => {
    if (!acc[item.scheduledDate]) acc[item.scheduledDate] = [];
    acc[item.scheduledDate].push(item);
    return acc;
  }, {});
}

function getDashboard() {
  return state.bootstrap.dashboard;
}

function agendaGroups() {
  const items = state.agendaItems || [];
  const groups = [];
  let current = null;
  for (const item of items) {
    if (!current || current.date !== item.scheduledDate) {
      current = { date: item.scheduledDate, items: [] };
      groups.push(current);
    }
    current.items.push(item);
  }
  const next = {};
  groups.forEach((group) => {
    next[group.date] = state.collapsedAgendaDays[group.date] ?? true;
  });
  state.collapsedAgendaDays = next;
  return groups;
}

function renderRuleForm(rule = {}) {
  return `
    <form id="rule-form" class="form-grid">
      <input type="hidden" name="id" value="${rule.id || ""}" />
      <label><span>Nombre</span><input name="name" value="${esc(rule.name || "")}" required /></label>
      <label><span>Categoría</span><input name="category" value="${esc(rule.category || "limpieza")}" required /></label>
      <label><span>Frecuencia</span>
        <select name="frequencyKind">
          ${["daily", "weekly", "monthly"].map((kind) => `<option value="${kind}" ${rule.frequencyKind === kind ? "selected" : ""}>${kind}</option>`).join("")}
        </select>
      </label>
      <label><span>Intervalo</span><input name="frequencyInterval" type="number" min="1" value="${rule.frequencyInterval || 1}" required /></label>
      <label><span>Días semana (1-7 csv)</span><input name="daysOfWeek" value="${(rule.daysOfWeek || []).join(",")}" /></label>
      <label><span>Día del mes</span><input name="dayOfMonth" type="number" min="1" max="31" value="${rule.dayOfMonth || ""}" /></label>
      <label><span>Duración</span><input name="durationMinutes" type="number" min="1" value="${rule.durationMinutes || 15}" required /></label>
      <label><span>Inicio</span><input name="startDate" type="date" value="${rule.startDate || new Date().toISOString().slice(0, 10)}" required /></label>
      <label><span>Primera vez</span><input name="firstOccurrenceDate" type="date" value="${rule.firstOccurrenceDate || ""}" /></label>
      <label><span>Hora preferida</span><input name="preferredTime" type="time" value="${rule.preferredTime || ""}" /></label>
      <label><span>Franja</span><input name="preferredSlot" value="${esc(rule.preferredSlot || "")}" placeholder="morning / evening" /></label>
      <label><span>Modo responsable</span>
        <select name="responsibleMode">
          ${["unassigned", "fixed", "alternate"].map((mode) => `<option value="${mode}" ${rule.responsibleMode === mode ? "selected" : ""}>${mode}</option>`).join("")}
        </select>
      </label>
      <label><span>Responsable fijo</span><select name="responsibleMemberId">${memberOptions(rule.responsibleMemberId)}</select></label>
      <label><span>Responsables alternos (ids csv)</span><input name="responsibleMemberIds" value="${(rule.responsibleMemberIds || []).join(",")}" /></label>
      <label><span>Prioridad</span><input name="priority" type="number" min="1" max="3" value="${rule.priority || 2}" /></label>
      <label><span>Lista variable</span><select name="listKey">${listOptions(rule.listKey)}</select></label>
      <label><span>Separación mínima</span><input name="minSeparationDays" type="number" min="0" max="90" value="${rule.minSeparationDays || ""}" /></label>
      <label><span>No coincidir con reglas (ids csv)</span><input name="avoidSameDayRuleIds" value="${(rule.avoidSameDayRuleIds || []).join(",")}" /></label>
      <label><span>Flexibilidad (días)</span><input name="flexibilityDays" type="number" min="0" max="7" value="${rule.flexibilityDays ?? 2}" /></label>
      <label class="checkbox-row"><input type="checkbox" name="appearsInChecklist" ${rule.appearsInChecklist !== false ? "checked" : ""} /><span>Checklist</span></label>
      <label class="checkbox-row"><input type="checkbox" name="publishToCalendar" ${rule.publishToCalendar !== false ? "checked" : ""} /><span>Calendario</span></label>
      <label class="checkbox-row"><input type="checkbox" name="active" ${rule.active !== false ? "checked" : ""} /><span>Activa</span></label>
      <label class="full"><span>Notas</span><textarea name="notes" rows="2">${esc(rule.notes || "")}</textarea></label>
      <div class="full modal-actions">
        <button class="button button-primary" type="submit">${rule.id ? "Guardar regla" : "Crear regla"}</button>
        <button class="button" type="button" data-close-modal>Cerrar</button>
      </div>
    </form>
  `;
}

function renderOneOffForm(task = {}) {
  return `
    <form id="oneoff-form" class="form-grid">
      <input type="hidden" name="id" value="${task.id || ""}" />
      <label><span>Título</span><input name="title" value="${esc(task.title || "")}" required /></label>
      <label><span>Categoría</span><input name="category" value="${esc(task.category || "casa")}" required /></label>
      <label><span>Fecha</span><input name="scheduledDate" type="date" value="${task.scheduledDate || new Date().toISOString().slice(0, 10)}" required /></label>
      <label><span>Hora</span><input name="scheduledTime" type="time" value="${task.scheduledTime || ""}" /></label>
      <label><span>Duración</span><input name="durationMinutes" type="number" min="1" value="${task.durationMinutes || 30}" required /></label>
      <label><span>Responsable</span><select name="memberId">${memberOptions(task.memberId)}</select></label>
      <label><span>Prioridad</span><input name="priority" type="number" min="1" max="3" value="${task.priority || 2}" /></label>
      <label class="checkbox-row"><input type="checkbox" name="appearsInChecklist" ${task.appearsInChecklist !== false ? "checked" : ""} /><span>Checklist</span></label>
      <label class="checkbox-row"><input type="checkbox" name="publishToCalendar" ${task.publishToCalendar !== false ? "checked" : ""} /><span>Calendario</span></label>
      <label><span>Estado</span>
        <select name="status">
          ${["pending", "completed", "postponed", "cancelled"].map((status) => `<option value="${status}" ${task.status === status ? "selected" : ""}>${status}</option>`).join("")}
        </select>
      </label>
      <label class="full"><span>Notas</span><textarea name="notes" rows="2">${esc(task.notes || "")}</textarea></label>
      <div class="full modal-actions">
        <button class="button button-primary" type="submit">${task.id ? "Guardar puntual" : "Crear puntual"}</button>
        <button class="button" type="button" data-close-modal>Cerrar</button>
      </div>
    </form>
  `;
}

function renderModal() {
  if (!state.modal) {
    return `<div id="modal" class="modal"></div>`;
  }
  return `
    <div id="modal" class="modal open">
      <div class="modal-body">
        <div class="section-head">
          <h3>${esc(state.modal.title)}</h3>
          <button class="button" type="button" data-close-modal>Cerrar</button>
        </div>
        ${state.modal.body}
      </div>
    </div>
  `;
}

function renderLists() {
  return state.bootstrap.lists
    .map(
      (list) => `
        <section class="card">
          <div class="section-head">
            <div>
              <h3>${esc(list.label)}</h3>
              <p class="muted">Rotación cíclica para evitar repeticiones consecutivas.</p>
            </div>
            <button class="button" data-action="save-list" data-list="${list.key}">Guardar</button>
          </div>
          <div class="list-editor" data-list-editor="${list.key}">
            ${list.items
              .map(
                (item, index) => `
                  <div class="list-row" data-item-id="${item.id}">
                    <span>${index + 1}</span>
                    <input data-field="label" value="${esc(item.label)}" />
                    <input data-field="notes" value="${esc(item.notes || "")}" placeholder="Nota opcional" />
                    <label><input data-field="isActive" type="checkbox" ${item.isActive ? "checked" : ""} /> Activo</label>
                    <button class="button button-danger" data-action="remove-list-item" data-list="${list.key}" data-id="${item.id}">Quitar</button>
                  </div>`,
              )
              .join("")}
            <button class="button" data-action="add-list-item" data-list="${list.key}">Añadir elemento</button>
          </div>
        </section>
      `,
    )
    .join("");
}

function renderCalendar() {
  const weeks = getMonthGrid(state.monthCursor);
  const itemsByDate = byDate(state.occurrences);
  const currentMonth = state.monthCursor.slice(5, 7);
  return `
    <section class="card">
      <div class="section-head">
        <div>
          <h2>Calendario mensual</h2>
          <p class="muted">Cuadrícula mensual lista para imprimir.</p>
        </div>
        <div class="toolbar">
          <button class="button" data-action="prev-month">Anterior</button>
          <strong>${esc(monthTitle(state.monthCursor))}</strong>
          <button class="button" data-action="next-month">Siguiente</button>
          <button class="button button-primary" data-action="print">Imprimir</button>
        </div>
      </div>
      <div class="calendar-grid">
        <div class="calendar-header">${["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => `<span>${d}</span>`).join("")}</div>
        ${weeks
          .map(
            (week) => `
              <div class="calendar-week">
                ${week
                  .map((date) => {
                    const month = date.slice(5, 7);
                    const list = itemsByDate[date] || [];
                    return `
                      <div class="calendar-day ${month !== currentMonth ? "other-month" : ""}">
                        <div class="calendar-day-top">
                          <strong>${Number(date.slice(8, 10))}</strong>
                          <button class="button" data-action="set-day" data-date="${date}">Día</button>
                        </div>
                        <div class="calendar-items">
                          ${list
                            .slice(0, 4)
                            .map((item) => `<div class="calendar-item">${timeText(item.scheduledTime)} · ${esc(item.title)}</div>`)
                            .join("")}
                          ${list.length > 4 ? `<div class="subtle">+${list.length - 4} más</div>` : ""}
                        </div>
                      </div>
                    `;
                  })
                  .join("")}
              </div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderWeeklyChecklist() {
  const end = addDays(state.weekCursor, 6);
  const list = state.occurrences.filter((item) => item.scheduledDate >= state.weekCursor && item.scheduledDate <= end && item.appearsInChecklist);
  const grouped = byDate(list);
  return `
    <section class="card">
      <div class="section-head">
        <div>
          <h2>Checklist semanal</h2>
          <p class="muted">Agrupada por día y preparada para A4.</p>
        </div>
        <div class="toolbar">
          <button class="button" data-action="shift-week" data-days="-7">Semana anterior</button>
          <strong>${humanDate(state.weekCursor)} - ${humanDate(end)}</strong>
          <button class="button" data-action="shift-week" data-days="7">Semana siguiente</button>
          <button class="button button-primary" data-action="print">Imprimir</button>
        </div>
      </div>
      <div class="checklist-days">
        ${Array.from({ length: 7 }, (_, index) => addDays(state.weekCursor, index))
          .map(
            (date) => `
              <div class="checklist-day">
                <h3>${esc(longDate(date))}</h3>
                ${(grouped[date] || [])
                  .map(
                    (item) => `
                      <label class="check-row">
                        <input type="checkbox" data-action="toggle-complete" data-id="${item.id}" data-status="${item.status}" ${item.status === "completed" ? "checked" : ""} />
                        <span><strong>${esc(item.title)}</strong><br /><small>${timeText(item.scheduledTime)} · ${durationText(item.durationMinutes)}${item.memberName ? ` · ${esc(item.memberName)}` : ""}</small></span>
                      </label>
                    `,
                  )
                  .join("") || '<p class="muted">Sin tareas</p>'}
              </div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderDailyChecklist() {
  const list = state.occurrences.filter((item) => item.scheduledDate === state.dayCursor && item.appearsInChecklist);
  return `
    <section class="card">
      <div class="section-head">
        <div>
          <h2>Checklist diaria</h2>
          <p class="muted">Una vista rápida y clara para el día.</p>
        </div>
        <div class="toolbar">
          <button class="button" data-action="shift-day" data-days="-1">Día anterior</button>
          <strong>${esc(longDate(state.dayCursor))}</strong>
          <button class="button" data-action="shift-day" data-days="1">Día siguiente</button>
          <button class="button button-primary" data-action="print">Imprimir</button>
        </div>
      </div>
      <div class="daily-list">
        ${list
          .map(
            (item) => `
              <label class="daily-row">
                <input type="checkbox" data-action="toggle-complete" data-id="${item.id}" data-status="${item.status}" ${item.status === "completed" ? "checked" : ""} />
                <span>${timeText(item.scheduledTime)}</span>
                <span><strong>${esc(item.title)}</strong>${item.memberName ? `<br /><small>${esc(item.memberName)}</small>` : ""}</span>
                <span>${durationText(item.durationMinutes)}</span>
              </label>
            `,
          )
          .join("") || '<p class="muted">No hay tareas para este día.</p>'}
      </div>
    </section>
  `;
}

function renderAgenda() {
  const groups = agendaGroups();
  return `
    <section class="card">
      <div class="section-head">
        <div>
          <h2>Agenda</h2>
          <p class="muted">Comprimida por defecto, con scroll interno y apertura por día.</p>
        </div>
      </div>
      <div class="agenda-panel">
        <div class="agenda-toolbar no-print">
          <form id="agenda-filters" class="toolbar wrap">
            <select name="memberId">
              <option value="">Todos los responsables</option>
              ${state.bootstrap.members.map((member) => `<option value="${member.id}" ${state.agendaFilters.memberId === member.id ? "selected" : ""}>${esc(member.name)}</option>`).join("")}
            </select>
            <input name="category" placeholder="Categoría" value="${esc(state.agendaFilters.category || "")}" />
            <select name="status">
              <option value="">Todos los estados</option>
              ${["pending", "completed", "postponed", "cancelled"].map((status) => `<option value="${status}" ${state.agendaFilters.status === status ? "selected" : ""}>${status}</option>`).join("")}
            </select>
            <button class="button button-primary" type="submit">Filtrar</button>
            <button class="button" type="button" data-action="collapse-all-agenda">Comprimir todo</button>
            <button class="button" type="button" data-action="expand-all-agenda">Expandir todo</button>
          </form>
        </div>
        <div class="agenda-scroll">
          <div class="agenda-list">
            ${groups
              .map(
                (group) => `
                  <section class="agenda-group ${state.collapsedAgendaDays[group.date] ? "collapsed" : ""}">
                    <button class="agenda-head" type="button" data-action="toggle-agenda-day" data-date="${group.date}">
                      <div>
                        <div class="subtle">${esc(longDate(group.date))}</div>
                        <strong>${group.items.length} tarea(s) · ${group.items.reduce((sum, item) => sum + item.durationMinutes, 0)} min</strong>
                      </div>
                      <span>${state.collapsedAgendaDays[group.date] ? "Mostrar" : "Ocultar"}</span>
                    </button>
                    <div class="agenda-body">
                      ${group.items
                        .map(
                          (item) => `
                            <article class="agenda-item">
                              <div>
                                <div class="subtle">${humanDate(item.scheduledDate)} · ${timeText(item.scheduledTime)}</div>
                                <strong>${esc(item.title)}</strong>
                                <div class="subtle">${esc(item.category)} · ${durationText(item.durationMinutes)}${item.memberName ? ` · ${esc(item.memberName)}` : ""}</div>
                              </div>
                              <div class="toolbar wrap">
                                ${statusBadge(item.status)}
                                <button class="button" data-action="edit-occurrence" data-id="${item.id}">Editar</button>
                                <button class="button" data-action="toggle-complete" data-id="${item.id}" data-status="${item.status}">${item.status === "completed" ? "Deshacer" : "Hecha"}</button>
                              </div>
                            </article>
                          `,
                        )
                        .join("")}
                    </div>
                  </section>
                `,
              )
              .join("") || '<p class="muted">No hay elementos para esos filtros.</p>'}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderApp() {
  if (state.loading) {
    app.innerHTML = `<div class="loading-card">Cargando hogar...</div>`;
    return;
  }

  const dashboard = getDashboard();
  app.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">HP</div>
          <div>
            <strong>${esc(state.bootstrap.household.name)}</strong>
            <div class="subtle">GitHub Pages + Apps Script + Sheets</div>
          </div>
        </div>
        <nav class="nav">
          ${[
            ["inicio", "Inicio"],
            ["plan", "Plan de tareas"],
            ["puntuales", "Tareas puntuales"],
            ["listas", "Listas editables"],
            ["calendario", "Calendario"],
            ["semanal", "Checklist semanal"],
            ["diaria", "Checklist diaria"],
            ["agenda", "Agenda"],
            ["ajustes", "Ajustes"],
            ["ayuda", "Ayuda / iPhone"],
          ].map(([id, label]) => `<a href="#${id}">${label}</a>`).join("")}
        </nav>
        <p class="sidebar-note">Uso doméstico gratis. Añádela a pantalla de inicio desde Safari o Chrome.</p>
      </aside>
      <main class="main">
        <header class="topbar no-print">
          <div>
            <h1>Hogar Planificador</h1>
            <p class="muted">Organización doméstica completa, pensada para móvil y para una pareja sin tocar Excel.</p>
          </div>
          <div class="toolbar wrap">
            <button class="button" data-action="new-rule">Nueva regla</button>
            <button class="button" data-action="new-oneoff">Nueva puntual</button>
            <button class="button button-primary" data-action="regenerate">Regenerar futuro</button>
          </div>
        </header>

        <section id="inicio">
          <div class="cards-grid">
            <section class="card stat"><span class="subtle">Hoy</span><strong>${dashboard.todayTasks.length}</strong><span>${dashboard.todayMinutes} min</span></section>
            <section class="card stat"><span class="subtle">Semana</span><strong>${dashboard.weeklyMinutes}</strong><span>min planificados</span></section>
            <section class="card stat"><span class="subtle">Próximas</span><strong>${dashboard.upcoming.length}</strong><span>en agenda</span></section>
            <section class="card stat"><span class="subtle">Sobrecargados</span><strong>${dashboard.overloadedDays.length}</strong><span>días</span></section>
          </div>
          <div class="two-columns">
            <section class="card">
              <div class="section-head">
                <div>
                  <h2>Tareas de hoy</h2>
                  <p class="muted">Marca rápido desde aquí.</p>
                </div>
              </div>
              <div class="list-stack">
                ${dashboard.todayTasks.map((item) => `
                  <div class="task-line">
                    <div>
                      <strong>${esc(item.title)}</strong>
                      <div class="subtle">${timeText(item.scheduledTime)} · ${durationText(item.durationMinutes)}${item.memberName ? ` · ${esc(item.memberName)}` : ""}</div>
                    </div>
                    <div class="toolbar wrap">
                      ${statusBadge(item.status)}
                      <button class="button" data-action="toggle-complete" data-id="${item.id}" data-status="${item.status}">${item.status === "completed" ? "Deshacer" : "Hecha"}</button>
                    </div>
                  </div>
                `).join("") || '<p class="muted">Hoy está ligero.</p>'}
              </div>
            </section>
            <section class="card">
              <div class="section-head">
                <div>
                  <h2>Próximas tareas</h2>
                  <p class="muted">Vista corta para mantener contexto.</p>
                </div>
              </div>
              <div class="list-stack">
                ${dashboard.upcoming.slice(0, 8).map((item) => `
                  <div class="task-line">
                    <div>
                      <strong>${esc(item.title)}</strong>
                      <div class="subtle">${humanDate(item.scheduledDate)} · ${timeText(item.scheduledTime)}</div>
                    </div>
                    ${statusBadge(item.status)}
                  </div>
                `).join("")}
              </div>
              ${dashboard.overloadedDays.length ? `<div class="help-box"><strong>Revisar carga:</strong> ${dashboard.overloadedDays.map((day) => `${humanDate(day.date)} (${day.minutes} min)`).join(", ")}</div>` : ""}
            </section>
          </div>
        </section>

        <section id="plan" class="card">
          <div class="section-head">
            <div>
              <h2>Plan maestro</h2>
              <p class="muted">Reglas recurrentes, duplicado rápido y regeneración desde fecha efectiva.</p>
            </div>
            <button class="button" data-action="new-rule">Nueva regla</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Tarea</th><th>Frecuencia</th><th>Duración</th><th>Responsable</th><th>Próxima</th><th></th></tr></thead>
              <tbody>
                ${state.bootstrap.rules.map((rule) => `
                  <tr>
                    <td><strong>${esc(rule.name)}</strong><div class="subtle">${esc(rule.category)}</div></td>
                    <td>${esc(describeFrequency(rule))}</td>
                    <td>${durationText(rule.durationMinutes)}</td>
                    <td>${esc(rule.responsibleSummary)}</td>
                    <td>${rule.nextOccurrence ? `${humanDate(rule.nextOccurrence.scheduledDate)} · ${timeText(rule.nextOccurrence.scheduledTime)}` : "Sin futura"}</td>
                    <td>
                      <div class="toolbar wrap">
                        <button class="button" data-action="edit-rule" data-id="${rule.id}">Editar</button>
                        <button class="button" data-action="duplicate-rule" data-id="${rule.id}">Duplicar</button>
                        <button class="button button-danger" data-action="delete-rule" data-id="${rule.id}">Borrar</button>
                      </div>
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </section>

        <section id="puntuales" class="card">
          <div class="section-head">
            <div>
              <h2>Tareas puntuales</h2>
              <p class="muted">Entran automáticamente en agenda, calendario, checklist y <code>.ics</code>.</p>
            </div>
            <button class="button" data-action="new-oneoff">Nueva puntual</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Título</th><th>Fecha</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                ${state.bootstrap.oneOffs.map((item) => `
                  <tr>
                    <td><strong>${esc(item.title)}</strong><div class="subtle">${esc(item.category)}</div></td>
                    <td>${humanDate(item.scheduledDate)} · ${timeText(item.scheduledTime)}</td>
                    <td>${statusBadge(item.status)}</td>
                    <td>
                      <div class="toolbar wrap">
                        <button class="button" data-action="edit-oneoff" data-id="${item.id}">Editar</button>
                        <button class="button button-danger" data-action="delete-oneoff" data-id="${item.id}">Borrar</button>
                      </div>
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </section>

        <section id="listas">${renderLists()}</section>
        <section id="calendario">${renderCalendar()}</section>
        <section id="semanal">${renderWeeklyChecklist()}</section>
        <section id="diaria">${renderDailyChecklist()}</section>
        <section id="agenda">${renderAgenda()}</section>

        <section id="ajustes" class="card">
          <div class="section-head">
            <div>
              <h2>Ajustes</h2>
              <p class="muted">Carga máxima, horizonte, hora por defecto y enlace del calendario.</p>
            </div>
          </div>
          <form id="settings-form" class="form-grid">
            <label><span>Zona horaria</span><input value="${esc(state.bootstrap.settings.timezone)}" disabled /></label>
            <label><span>Idioma</span><input value="${esc(state.bootstrap.settings.locale)}" disabled /></label>
            <label><span>Max lunes-viernes</span><input name="maxWeekdayMinutes" type="number" value="${state.bootstrap.settings.maxWeekdayMinutes}" /></label>
            <label><span>Max sábado</span><input name="maxSaturdayMinutes" type="number" value="${state.bootstrap.settings.maxSaturdayMinutes}" /></label>
            <label><span>Max domingo</span><input name="maxSundayMinutes" type="number" value="${state.bootstrap.settings.maxSundayMinutes}" /></label>
            <label><span>Horizonte (meses)</span><input name="planningHorizonMonths" type="number" value="${state.bootstrap.settings.planningHorizonMonths}" /></label>
            <label><span>Hora por defecto</span><input name="defaultTime" type="time" value="${state.bootstrap.settings.defaultTime}" /></label>
            <label><span>Fecha efectiva</span><input name="effectiveDate" type="date" value="${new Date().toISOString().slice(0, 10)}" /></label>
            <label class="full"><span>Feed <code>.ics</code></span><input value="${esc(state.bootstrap.feedUrl)}" disabled /></label>
            <div class="full modal-actions">
              <button class="button button-primary" type="submit">Guardar ajustes</button>
              <button class="button" type="button" data-action="copy-feed">Copiar enlace</button>
            </div>
          </form>
        </section>

        <section id="ayuda" class="card">
          <div class="section-head">
            <div>
              <h2>Ayuda / iPhone</h2>
              <p class="muted">Instalación tipo app y calendario suscrito.</p>
            </div>
          </div>
          <ol>
            <li>Abre esta web en Safari y pulsa compartir.</li>
            <li>Usa <strong>Añadir a pantalla de inicio</strong>.</li>
            <li>Para el calendario, copia el enlace <code>.ics</code> y suscríbelo desde Ajustes del iPhone.</li>
            <li>La suscripción es de solo lectura y se actualiza cuando regeneras el futuro.</li>
          </ol>
          <div class="help-box">
            <strong>Enlace actual del calendario</strong><br />
            <code>${esc(state.bootstrap.feedUrl)}</code>
            <div class="toolbar wrap" style="margin-top:12px;">
              <button class="button button-primary" data-action="copy-feed">Copiar enlace del calendario</button>
              <a class="button" target="_blank" href="${esc(state.bootstrap.feedUrl)}">Abrir feed</a>
            </div>
          </div>
        </section>
      </main>
    </div>
    ${renderModal()}
  `;
  bindEvents();
}

function formToObject(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  form.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    data[input.name] = input.checked;
  });
  return data;
}

function readListEditor(listKey) {
  const editor = document.querySelector(`[data-list-editor="${listKey}"]`);
  return [...editor.querySelectorAll(".list-row")]
    .map((row) => ({
      id: row.dataset.itemId || "",
      label: row.querySelector('[data-field="label"]').value,
      notes: row.querySelector('[data-field="notes"]').value,
      isActive: row.querySelector('[data-field="isActive"]').checked,
    }))
    .filter((item) => item.label.trim());
}

function openModal(title, body) {
  state.modal = { title, body };
  renderApp();
}

function closeModal() {
  state.modal = null;
  renderApp();
}

async function saveRule(form) {
  await callWithPayload("saveRule", formToObject(form));
  state.modal = null;
  await boot();
}

async function saveOneOff(form) {
  await callWithPayload("saveOneOff", formToObject(form));
  state.modal = null;
  await boot();
}

async function boot() {
  state.loading = true;
  renderApp();
  await refreshData();
  state.loading = false;
  renderApp();
}

function bindEvents() {
  document.getElementById("rule-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveRule(event.currentTarget);
    } catch (error) {
      alert(error.message);
    }
  });

  document.getElementById("oneoff-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveOneOff(event.currentTarget);
    } catch (error) {
      alert(error.message);
    }
  });

  document.getElementById("settings-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await callWithPayload("saveSettings", formToObject(event.currentTarget));
      await boot();
    } catch (error) {
      alert(error.message);
    }
  });

  document.getElementById("agenda-filters")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.agendaFilters = formToObject(event.currentTarget);
    await boot();
    location.hash = "#agenda";
  });

  document.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", closeModal));

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      const action = event.currentTarget.dataset.action;
      const id = event.currentTarget.dataset.id;
      try {
        if (action === "new-rule") {
          openModal("Nueva regla", renderRuleForm());
        }
        if (action === "edit-rule") {
          const rule = state.bootstrap.rules.find((entry) => entry.id === id);
          openModal("Editar regla", renderRuleForm(rule));
        }
        if (action === "duplicate-rule") {
          await api("duplicateRule", { id });
          await boot();
        }
        if (action === "delete-rule" && confirm("¿Borrar esta regla?")) {
          await api("deleteRule", { id });
          await boot();
        }
        if (action === "new-oneoff") {
          openModal("Nueva tarea puntual", renderOneOffForm());
        }
        if (action === "edit-oneoff") {
          const task = state.bootstrap.oneOffs.find((entry) => entry.id === id);
          openModal("Editar tarea puntual", renderOneOffForm(task));
        }
        if (action === "delete-oneoff" && confirm("¿Borrar esta tarea puntual?")) {
          await api("deleteOneOff", { id });
          await boot();
        }
        if (action === "toggle-complete") {
          const status = event.currentTarget.dataset.status;
          await callWithPayload("updateOccurrence", {
            id,
            status: status === "completed" ? "pending" : "completed",
          });
          await boot();
        }
        if (action === "regenerate") {
          await api("regenerate", { effectiveDate: new Date().toISOString().slice(0, 10) });
          await boot();
        }
        if (action === "prev-month") {
          const [year, month] = state.monthCursor.split("-").map(Number);
          state.monthCursor = formatDate(new Date(year, month - 2, 1)).slice(0, 7);
          await boot();
        }
        if (action === "next-month") {
          const [year, month] = state.monthCursor.split("-").map(Number);
          state.monthCursor = formatDate(new Date(year, month, 1)).slice(0, 7);
          await boot();
        }
        if (action === "shift-week") {
          state.weekCursor = addDays(state.weekCursor, Number(event.currentTarget.dataset.days));
          await boot();
        }
        if (action === "shift-day") {
          state.dayCursor = addDays(state.dayCursor, Number(event.currentTarget.dataset.days));
          await boot();
        }
        if (action === "set-day") {
          state.dayCursor = event.currentTarget.dataset.date;
          location.hash = "#diaria";
        }
        if (action === "copy-feed") {
          await navigator.clipboard.writeText(state.bootstrap.feedUrl);
          alert("Enlace copiado");
        }
        if (action === "print") {
          window.print();
        }
        if (action === "toggle-agenda-day") {
          const date = event.currentTarget.dataset.date;
          state.collapsedAgendaDays[date] = !state.collapsedAgendaDays[date];
          renderApp();
          location.hash = "#agenda";
        }
        if (action === "collapse-all-agenda") {
          Object.keys(state.collapsedAgendaDays).forEach((key) => {
            state.collapsedAgendaDays[key] = true;
          });
          renderApp();
        }
        if (action === "expand-all-agenda") {
          Object.keys(state.collapsedAgendaDays).forEach((key) => {
            state.collapsedAgendaDays[key] = false;
          });
          renderApp();
        }
        if (action === "edit-occurrence") {
          const occurrence = state.bootstrap.agenda.find((entry) => entry.id === id);
          const title = prompt("Nuevo título", occurrence.title);
          if (title === null) return;
          const scheduledDate = prompt("Nueva fecha YYYY-MM-DD", occurrence.scheduledDate);
          if (scheduledDate === null) return;
          const scheduledTime = prompt("Nueva hora HH:MM (vacío para sin hora)", occurrence.scheduledTime || "");
          if (scheduledTime === null) return;
          await callWithPayload("updateOccurrence", {
            id,
            title,
            scheduledDate,
            scheduledTime,
            manualOverride: true,
          });
          await boot();
        }
        if (action === "add-list-item") {
          const list = state.bootstrap.lists.find((entry) => entry.key === event.currentTarget.dataset.list);
          list.items.push({ id: "", label: "", notes: "", isActive: true });
          renderApp();
        }
        if (action === "remove-list-item") {
          const list = state.bootstrap.lists.find((entry) => entry.key === event.currentTarget.dataset.list);
          list.items = list.items.filter((item) => item.id !== id);
          renderApp();
        }
        if (action === "save-list") {
          const listKey = event.currentTarget.dataset.list;
          await callWithPayload("saveList", { listKey, items: readListEditor(listKey) });
          await boot();
        }
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

async function init() {
  try {
    await boot();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  } catch (error) {
    app.innerHTML = `<div class="loading-card"><h1>Error</h1><p>${esc(error.message)}</p><p class="subtle">Revisa <code>config.js</code> y el despliegue del Apps Script.</p></div>`;
  }
}

init();
