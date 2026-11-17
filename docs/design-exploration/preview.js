/* global document, location, history, window, FormData, URLSearchParams */
/* Isolated design study. All data below is illustrative and held in memory. */
const concepts = {
  daybreak: { name: 'Daybreak', line: 'A fresh start, every day.', description: 'Open sky, warm amber and generous shapes. A friendly daily companion with a rising-sun identity.', type: 'Bricolage Grotesque + Nunito Sans', colors: ['#17354b', '#235b7b', '#eaf3fa', '#f6bc54'], bg: '#eaf3fa' },
  grove: { name: 'Grove', line: 'Make room for the everyday.', description: 'Forest green, soft leaf tones and a journal-like heading. A slower, personal space for repeatable routines.', type: 'Lora + Source Sans 3', colors: ['#214b37', '#eef3ec', '#c8d8bd', '#fbfdf9'], bg: '#eef3ec' },
  signal: { name: 'Signal', line: 'Get up. Get going.', description: 'Confident yellow, sturdy type and a direct three-column layout. A working tool with the clarity of a well-made sign.', type: 'Archivo', colors: ['#20251f', '#f4d447', '#ffffff', '#f3f4ee'], bg: '#f3f4ee' },
  tide: { name: 'Tide', line: 'Find your daily rhythm.', description: 'Deep blue, muted sea glass and warm sand. A quiet evening-friendly workspace, with flat surfaces and no glow.', type: 'Manrope', colors: ['#152630', '#203641', '#95cfca', '#e5c29e'], bg: '#152630' },
  folio: { name: 'Folio', line: 'One day. A clear page.', description: 'White, ink and a precise crimson accent. A calendar-inspired layout with an oversized day and a folded-paper mark.', type: 'Barlow Condensed + Barlow', colors: ['#202c38', '#ac2945', '#eef2f5', '#f9eef0'], bg: '#ffffff' },
};
const icons = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.6 7M3 4v7h7m2-4v5l3 2"/>',
  list: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  settings: '<path d="M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
};
function icon(name) { return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.list}</svg>`; }
function mark() {
  const shapes = {
    daybreak: '<path d="M9 26a11 11 0 0 1 22 0" fill="currentColor"/><path d="M5 29h30M20 5v5M6 13l4 4M34 13l-4 4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
    grove: '<path d="M9 33 20 10l11 23M14 25h12" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 15C18 4 27 2 31 4c0 8-4 12-11 11" fill="currentColor"/>',
    signal: '<path d="M4 34V23h10V13h10V4h11v30H24V24H14v10z" fill="currentColor"/>',
    tide: '<circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" stroke-width="2"/><path d="m9 28 11-17 11 17M12 24c6-9 10 8 17-2" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>',
    folio: '<path d="M7 4h19l8 8v24H7z" fill="currentColor"/><path d="M26 4v9h8" fill="none" stroke="var(--surface)" stroke-width="2"/><path d="m13 29 7-14 7 14m-11-5h8" fill="none" stroke="var(--surface)" stroke-width="2.3" stroke-linejoin="round"/>',
  };
  return `<svg class="logo-mark" viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">${shapes[concept]}</svg>`;
}
const freshItems = () => [
  { id: 1, group: 'habits', title: 'Morning walk', meta: 'Every day', done: true },
  { id: 2, group: 'habits', title: 'Read ten pages', meta: 'Every day', done: true },
  { id: 3, group: 'habits', title: 'Stretch for five minutes', meta: 'Weekdays', done: false },
  { id: 4, group: 'habits', title: 'Take a screen break', meta: 'Reminder at 2:00 PM', done: false },
  { id: 5, group: 'tasks', title: 'Send revised estimate', meta: 'Reminder at 11:00 AM', carried: 2, done: false, note: 'Check the final scope before sending the revised estimate.' },
  { id: 6, group: 'tasks', title: 'Book the dentist', meta: '1 of 2 subtasks', done: false, note: 'Find an available afternoon appointment.', subtasks: ['Check available dates', 'Call to book'] },
  { id: 7, group: 'tasks', title: 'Back up project files', meta: '', done: true },
  { id: 8, group: 'due', title: 'Review homepage draft', meta: 'Work', due: 'Due today', done: false, note: 'Review the navigation and mobile layout.' },
  { id: 9, group: 'due', title: 'Pick up prescription', meta: 'Personal', due: '1 day overdue', done: false },
];
let concept = new URLSearchParams(location.search).get('concept') || 'daybreak';
if (!concepts[concept]) concept = 'daybreak';
let items = freshItems();
let screen = 'today';
let expanded = null;
let adding = null;
const todayItems = () => items.filter(item => ['habits', 'tasks', 'due'].includes(item.group));
const app = document.querySelector('#app');
const escapeText = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
function announce(message) { document.querySelector('.announcement').textContent = message; }
function brand() { return `<a class="brand" href="#today" aria-label="Astir Today">${mark()}<span>astir</span></a>`; }
function navigation() {
  const remaining = todayItems().filter(item => !item.done).length;
  return `<nav class="app-nav" aria-label="Workspace">
    <a href="#today" ${screen === 'today' ? 'aria-current="page"' : ''}>${icon('sun')}<span>Today</span><span class="nav-count">${remaining}</span></a>
    <a href="#history" ${screen === 'history' ? 'aria-current="page"' : ''}>${icon('history')}<span>History</span></a>
    <p class="nav-label">Your lists</p>
    <a href="#work" ${screen === 'work' ? 'aria-current="page"' : ''}>${icon('list')}<span>Work</span><span class="nav-count">${items.filter(i => i.meta === 'Work' && !i.done).length}</span></a>
    <a href="#personal" ${screen === 'personal' ? 'aria-current="page"' : ''}>${icon('list')}<span>Personal</span><span class="nav-count">${items.filter(i => i.meta === 'Personal' && !i.done).length}</span></a>
    <a class="settings-link" href="#settings" ${screen === 'settings' ? 'aria-current="page"' : ''}>${icon('settings')}<span>Settings</span></a>
  </nav>`;
}
function sidebar() { return `<aside class="sidebar">${brand()}${navigation()}<div class="rail-bottom"><p class="brand-line">${concepts[concept].line}</p><p class="sample-label">Sample workspace</p></div></aside>`; }
function ring() {
  const total = todayItems().length, done = todayItems().filter(i => i.done).length;
  return `<div class="progress-ring" role="img" aria-label="${done} of ${total} complete"><svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true"><circle class="ring-track" cx="60" cy="60" r="49"/><circle class="ring-fill" cx="60" cy="60" r="49" stroke-dasharray="${308 * done / total} 308"/></svg><span class="ring-number">${done}<small>of ${total}</small></span></div>`;
}
function progress() {
  const done = todayItems().filter(i => i.done).length;
  return `<section class="day-progress" aria-label="Daily progress">${ring()}<div class="progress-copy"><h2>${todayItems().length - done} to go</h2><p>${done} done today</p><p class="reset-time">${icon('clock')}Resets at midnight</p></div><svg class="sunrise-art" viewBox="0 0 260 140" width="260" height="140" aria-hidden="true"><path d="M35 123a95 95 0 0 1 190 0"/><path d="M130 0v17M38 31l14 15M222 31l-14 15M2 123h256"/></svg></section>`;
}
function heading(title = 'Today', subtitle = 'Tuesday, November 17') { return `<div class="day-heading"><div><p class="date">${subtitle}</p><h1>${title}</h1></div><button class="primary add-task" type="button">${icon('plus')}<span>Add task</span></button></div>`; }
function row(item) {
  return `<li class="task-row ${item.done ? 'is-done' : ''}"><div class="task-line"><label class="check-target"><input type="checkbox" data-item="${item.id}" ${item.done ? 'checked' : ''}><span class="check-shape">${icon('check')}</span><span class="visually-hidden">Complete ${escapeText(item.title)}</span></label><button class="task-title" type="button" data-details="${item.id}" aria-expanded="${expanded === item.id}"><span>${escapeText(item.title)}</span><span class="task-meta">${escapeText(item.meta)}${item.carried ? `<span class="carried">Carried ${item.carried} days</span>` : ''}</span></button>${item.due ? `<span class="due-tag ${item.id === 9 ? 'overdue' : ''}">${escapeText(item.due)}</span>` : ''}<button class="detail-button" type="button" data-details="${item.id}" aria-label="Details for ${escapeText(item.title)}" aria-expanded="${expanded === item.id}">${icon('arrow')}</button></div>${expanded === item.id ? `<div class="task-details"><p>${escapeText(item.note || 'No notes for this item.')}</p>${item.subtasks ? `<ul class="subtask-list">${item.subtasks.map((s, n) => `<li><label><input type="checkbox" ${n === 0 ? 'checked' : ''}>${escapeText(s)}</label></li>`).join('')}</ul>` : ''}<button class="text-button" type="button" data-details="${item.id}">Close details</button></div>` : ''}</li>`;
}
const groupNames = { habits: 'Habits', tasks: 'Today only', due: 'Due from your lists', work: 'Work', personal: 'Personal' };
function section(group, filter) {
  const selected = items.filter(filter || (item => item.group === group));
  const done = selected.filter(item => item.done).length;
  return `<section class="task-section ${group}" aria-labelledby="${group}-heading"><header class="section-heading"><h2 id="${group}-heading">${groupNames[group]}</h2><span>${done}/${selected.length}</span></header>${group === 'habits' ? '<p class="section-caption">A little, every day.</p>' : group === 'tasks' ? '<p class="section-caption">For the day in front of you.</p>' : group === 'due' ? '<p class="section-caption">Work with a date attached.</p>' : ''}<ul class="task-list">${selected.map(row).join('')}</ul>${!selected.length ? '<p class="empty-state">Nothing here yet. Add your first task below.</p>' : ''}${group !== 'due' ? `<button class="add-row" type="button" data-add="${group}">${icon('plus')}Add ${group === 'habits' ? 'a habit' : 'a task'}</button>` : ''}${adding === group ? `<form class="add-form" data-group="${group}"><label for="new-title">${group === 'habits' ? 'Habit' : 'Task'} name</label><div><input id="new-title" name="title" maxlength="500" autocomplete="off" required><button class="primary" type="submit">Add</button><button class="cancel-add" type="button" aria-label="Cancel adding">${icon('close')}</button></div><p class="form-error" role="alert"></p></form>` : ''}</section>`;
}
function today() {
  const sections = `<div class="task-sections">${section('habits')}${section('tasks')}${section('due')}</div>`;
  if (concept === 'signal') return `<div class="signal-intro">${heading()}${progress()}</div>${sections}`;
  if (concept === 'grove') return `${heading()}<div class="grove-layout">${sections}<aside class="progress-column">${progress()}<p class="reset-note">A new day starts at midnight.<br>Unfinished tasks come with you.</p></aside></div>`;
  if (concept === 'folio') return `<div class="folio-layout"><div class="folio-day">${heading()}${progress()}</div>${sections}</div>`;
  if (concept === 'tide') return `<div class="tide-intro">${heading()}${progress()}</div>${sections}`;
  return `${heading()}${progress()}${sections}`;
}
function otherScreen() {
  if (screen === 'history') return `${heading('History', 'Your past days')}<section class="history-preview"><h2>Monday, November 16</h2><p class="section-caption">Illustrative past day</p><div class="history-stats"><strong>7 of 9</strong><span>completed</span></div><h3>Habits</h3><p>Morning walk, Read ten pages, Stretch for five minutes</p><h3>Tasks completed</h3><p>Back up project files, Review estimate, Water the plants, Plan the week</p></section>`;
  if (screen === 'settings') return `${heading('Settings', 'Make Astir fit your day')}<section class="settings-preview"><h2>Your day</h2><form id="settings-form"><label for="timezone">Time zone</label><select name="timezone" id="timezone"><option>America/New_York</option><option>America/Chicago</option><option>Europe/London</option></select><label for="day-start">Start a new day at</label><select name="day-start" id="day-start"><option>Midnight</option><option>4:00 AM</option><option>6:00 AM</option></select><p>Changes apply from the next reset.</p><button class="primary" type="submit">Save sample settings</button><p role="status" class="settings-status"></p></form></section>`;
  return `${heading(groupNames[screen], 'Your lists')}${section(screen, item => item.meta.toLowerCase() === screen)}`;
}
function render() {
  document.documentElement.dataset.concept = concept;
  document.documentElement.style.colorScheme = concept === 'tide' ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = concepts[concept].bg;
  document.title = `Astir / ${concepts[concept].name} — design study`;
  document.querySelectorAll('.concept-picker [data-concept]').forEach(a => { if (a.dataset.concept === concept) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  app.innerHTML = `<div class="workspace-frame">${sidebar()}<main class="workspace" id="workspace" tabindex="-1">${screen === 'today' ? today() : otherScreen()}<footer class="workspace-footer"><span>${concepts[concept].line}</span><span>Everything here is sample data.</span></footer></main></div>`;
  const c = concepts[concept];
  document.querySelector('#design-note').innerHTML = `<div><h2>${c.name}</h2><p>${c.description}</p></div><div class="type-note"><span>Typography</span><strong>${c.type}</strong></div><div class="palette" aria-label="Color palette">${c.colors.map(color => `<span style="background:${color}" title="${color}"><span class="visually-hidden">${color}</span></span>`).join('')}</div>`;
}
document.addEventListener('click', event => {
  const conceptLink = event.target.closest('.concept-picker [data-concept]');
  if (conceptLink) { event.preventDefault(); concept = conceptLink.dataset.concept; history.replaceState({}, '', `?concept=${concept}#${screen}`); render(); return; }
  if (event.target.closest('.reset-demo')) { items = freshItems(); adding = null; expanded = null; screen = 'today'; history.replaceState({}, '', `?concept=${concept}#today`); render(); announce('Sample workspace reset.'); return; }
  const details = event.target.closest('[data-details]');
  if (details) { expanded = expanded === Number(details.dataset.details) ? null : Number(details.dataset.details); render(); document.querySelector(`[data-details="${details.dataset.details}"]`).focus(); return; }
  const add = event.target.closest('[data-add], .add-task');
  if (add) { if (screen !== 'today' && !['work','personal'].includes(screen)) screen = 'today'; adding = add.dataset.add || (['work', 'personal'].includes(screen) ? screen : 'tasks'); render(); document.querySelector('#new-title').focus(); return; }
  if (event.target.closest('.cancel-add')) { adding = null; render(); }
});
document.addEventListener('change', event => {
  if (!event.target.matches('[data-item]')) return;
  const id = Number(event.target.dataset.item);
  const item = items.find(i => i.id === id);
  item.done = event.target.checked;
  render();
  document.querySelector(`[data-item="${id}"]`).focus();
  announce(`${item.title} ${item.done ? 'completed' : 'reopened'}.`);
});
document.addEventListener('submit', event => {
  if (event.target.id === 'settings-form') { event.preventDefault(); event.target.querySelector('.settings-status').textContent = 'Sample settings saved for this preview.'; return; }
  if (!event.target.matches('.add-form')) return;
  event.preventDefault();
  const title = new FormData(event.target).get('title').trim();
  if (!title) { event.target.querySelector('.form-error').textContent = 'Enter a task name, then choose Add.'; return; }
  const group = event.target.dataset.group;
  items.push({ id: Math.max(...items.map(i => i.id)) + 1, group: ['work', 'personal'].includes(group) ? 'list' : group, title, meta: group === 'habits' ? 'Every day' : ['work', 'personal'].includes(group) ? groupNames[group] : '', done: false });
  adding = null;
  render();
  document.querySelector(`[data-add="${group}"]`)?.focus();
  announce(`${title} added to the sample workspace.`);
});
window.addEventListener('hashchange', () => { screen = ['today', 'history', 'work', 'personal', 'settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today'; adding = null; expanded = null; render(); });
screen = ['today', 'history', 'work', 'personal', 'settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today';
render();
