let state = {
  settings: { partner1: 'Partner 1', partner2: 'Partner 2' },
  templates: [],
  monthlyData: {}
};
let deletePendingId = null;
let sliderDebounce = {};
let currentMonth = todayMonth();

// ── Month helpers ─────────────────────────────────────────────────────────────

function todayMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleString('default', { month: 'long', year: 'numeric' });
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthBills() {
  return (state.monthlyData[currentMonth] || {}).bills || [];
}

function allSettled() {
  const bills = monthBills();
  return bills.length > 0 && bills.every(b => b.settled);
}

// ── API ───────────────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function loadData() {
  state = await api('GET', '/api/data');
  if (!state.templates) state.templates = [];
  if (!state.monthlyData) state.monthlyData = {};
  render();
}

// ── Render ────────────────────────────────────────────────────────────────────

function fmt(n) { return '$' + Math.abs(n).toFixed(2); }

function calcBalance() {
  const { partner1, partner2 } = state.settings;
  let p1Share = 0, p2Share = 0, p1OwesP2 = 0, p2OwesP1 = 0;
  for (const bill of monthBills()) {
    const p1Pct = bill.partner1Percent / 100;
    const p2Pct = 1 - p1Pct;
    p1Share += bill.amount * p1Pct;
    p2Share += bill.amount * p2Pct;
    if (!bill.settled) {
      if (bill.owner === partner1) {
        p2OwesP1 += bill.amount * p2Pct;
      } else {
        p1OwesP2 += bill.amount * p1Pct;
      }
    }
  }
  return { p1Share, p2Share, net: p2OwesP1 - p1OwesP2 };
}

function renderMonthNav() {
  document.getElementById('monthLabel').textContent = monthLabel(currentMonth);
  const badge = document.getElementById('monthBadge');
  const markAllBtn = document.getElementById('markAllBtn');
  const bills = monthBills();
  badge.style.display = allSettled() ? '' : 'none';
  markAllBtn.disabled = bills.length === 0 || allSettled();
}

function renderSummary() {
  const { partner1, partner2 } = state.settings;
  const { p1Share, p2Share, net } = calcBalance();

  document.getElementById('p1Name').textContent = partner1;
  document.getElementById('p2Name').textContent = partner2;
  document.getElementById('p1Total').textContent = fmt(p1Share);
  document.getElementById('p2Total').textContent = fmt(p2Share);

  const amountEl = document.getElementById('balanceAmount');
  const labelEl = document.getElementById('balanceLabel');
  const arrowEl = document.getElementById('balanceArrow');

  if (Math.abs(net) < 0.01) {
    amountEl.textContent = 'Even';
    amountEl.className = 'balance-amount clear';
    labelEl.textContent = 'all settled up';
    arrowEl.textContent = '⇌';
  } else if (net > 0) {
    amountEl.textContent = fmt(net);
    amountEl.className = 'balance-amount owes';
    labelEl.textContent = `${partner2} still owes ${partner1}`;
    arrowEl.textContent = '←';
  } else {
    amountEl.textContent = fmt(net);
    amountEl.className = 'balance-amount owes';
    labelEl.textContent = `${partner1} still owes ${partner2}`;
    arrowEl.textContent = '→';
  }
}

function renderBills() {
  const { partner1, partner2 } = state.settings;
  const bills = monthBills();
  const hasBills = bills.length > 0;

  document.getElementById('emptyMonth').style.display = hasBills ? 'none' : '';
  document.getElementById('emptyMonthTitle').textContent =
    `No bills for ${monthLabel(currentMonth)} yet`;
  document.getElementById('utilitySection').style.display = hasBills ? '' : 'none';
  document.getElementById('subscriptionSection').style.display = hasBills ? '' : 'none';

  if (!hasBills) return;

  const utilities = bills.filter(b => b.splitType === 'utility');
  const subscriptions = bills.filter(b => b.splitType === 'subscription');

  renderBillList('utilityList', utilities, partner1, partner2, true);
  renderBillList('subscriptionList', subscriptions, partner1, partner2, false);
}

function renderBillList(containerId, bills, p1, p2, hasSlider) {
  const el = document.getElementById(containerId);
  if (bills.length === 0) {
    el.innerHTML = '<div class="empty-state">None this month</div>';
    return;
  }
  el.innerHTML = bills.map(bill => {
    const p1Pct = bill.partner1Percent;
    const p2Pct = 100 - p1Pct;
    const p1Amount = (bill.amount * p1Pct / 100).toFixed(2);
    const p2Amount = (bill.amount * p2Pct / 100).toFixed(2);
    const ownerLabel = bill.owner === p1 ? p1 : p2;

    const sliderHtml = hasSlider ? `
      <div class="inline-slider-wrap">
        <label>${escapeHtml(p1)} pays</label>
        <input type="range" class="slider inline-slider"
          min="1" max="99" value="${p1Pct}"
          data-id="${bill.id}"
          oninput="onInlineSlider(this)">
        <span class="inline-pct" id="pct-${bill.id}">${p1Pct}% / ${p2Pct}%</span>
      </div>` : '';

    const notesHtml = bill.notes ? `<div class="bill-notes">${escapeHtml(bill.notes)}</div>` : '';
    const settleClass = bill.settled ? 'btn-settle is-settled' : 'btn-settle';
    const settleLabel = bill.settled ? '&#10003; Paid' : 'Mark Paid';

    return `
      <div class="bill-card${bill.settled ? ' settled' : ''}" data-id="${bill.id}">
        <div class="bill-main">
          <div class="bill-top">
            <span class="bill-name">${escapeHtml(bill.name)}</span>
            <span class="bill-amount">${fmt(bill.amount)}</span>
            <span class="bill-owner-badge">paid by ${escapeHtml(ownerLabel)}</span>
          </div>
          <div class="bill-split-row">
            <span class="bill-split-info">
              ${escapeHtml(p1)}: <strong>${fmt(parseFloat(p1Amount))}</strong>
              &nbsp;&middot;&nbsp;
              ${escapeHtml(p2)}: <strong>${fmt(parseFloat(p2Amount))}</strong>
            </span>
          </div>
          ${sliderHtml}
          ${notesHtml}
        </div>
        <div class="bill-actions">
          <button class="${settleClass}" onclick="toggleSettle('${bill.id}')">${settleLabel}</button>
          <button class="btn-edit" onclick="openEditModal('${bill.id}')">Edit</button>
          <button class="btn-del" onclick="openDeleteModal('${bill.id}', '${escapeHtml(bill.name)}')">Del</button>
        </div>
      </div>`;
  }).join('');
}

function render() {
  renderMonthNav();
  renderSummary();
  renderBills();
  updateFormPartnerNames();
}

// ── Settle ────────────────────────────────────────────────────────────────────

async function toggleSettle(billId) {
  const bill = monthBills().find(b => b.id === billId);
  if (!bill) return;
  await api('PUT', `/api/months/${currentMonth}/bills/${billId}`, { settled: !bill.settled });
  await loadData();
}

document.getElementById('markAllBtn').addEventListener('click', async () => {
  await api('PUT', `/api/months/${currentMonth}/settle-all`);
  await loadData();
});

// ── Init month ────────────────────────────────────────────────────────────────

document.getElementById('initFromTemplatesBtn').addEventListener('click', async () => {
  await api('POST', `/api/months/${currentMonth}/init`);
  await loadData();
});

// ── Month navigation ──────────────────────────────────────────────────────────

document.getElementById('prevMonthBtn').addEventListener('click', () => {
  currentMonth = shiftMonth(currentMonth, -1);
  render();
});
document.getElementById('nextMonthBtn').addEventListener('click', () => {
  currentMonth = shiftMonth(currentMonth, 1);
  render();
});

// ── Inline slider (monthly bill) ──────────────────────────────────────────────

function onInlineSlider(input) {
  const id = input.dataset.id;
  const val = parseInt(input.value);
  const pctEl = document.getElementById(`pct-${id}`);
  if (pctEl) pctEl.textContent = `${val}% / ${100 - val}%`;

  const card = input.closest('.bill-card');
  const bill = monthBills().find(b => b.id === id);
  if (bill && card) {
    const { partner1, partner2 } = state.settings;
    const p1Amount = (bill.amount * val / 100).toFixed(2);
    const p2Amount = (bill.amount * (100 - val) / 100).toFixed(2);
    const infoEl = card.querySelector('.bill-split-info');
    if (infoEl) {
      infoEl.innerHTML = `${escapeHtml(partner1)}: <strong>${fmt(parseFloat(p1Amount))}</strong>
        &nbsp;&middot;&nbsp;
        ${escapeHtml(partner2)}: <strong>${fmt(parseFloat(p2Amount))}</strong>`;
    }
  }

  clearTimeout(sliderDebounce[id]);
  sliderDebounce[id] = setTimeout(async () => {
    await api('PUT', `/api/months/${currentMonth}/bills/${id}`, { partner1Percent: val });
    await loadData();
  }, 500);
}

// ── Modal helpers ─────────────────────────────────────────────────────────────

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) closeModal(el.id); });
});

// ── Add/Edit Monthly Bill Modal ───────────────────────────────────────────────

function updateFormPartnerNames() {
  const { partner1, partner2 } = state.settings;

  // Monthly bill form
  const g = document.getElementById('ownerRadioGroup');
  g.innerHTML = `
    <label class="radio-option">
      <input type="radio" name="owner" value="${escapeHtml(partner1)}" checked>
      ${escapeHtml(partner1)}
    </label>
    <label class="radio-option">
      <input type="radio" name="owner" value="${escapeHtml(partner2)}">
      ${escapeHtml(partner2)}
    </label>`;

  ['p1SliderLabel','p2SliderLabel'].forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.textContent = [partner1, partner2][i];
  });

  // Template form
  const tg = document.getElementById('tmplOwnerRadioGroup');
  tg.innerHTML = `
    <label class="radio-option">
      <input type="radio" name="tmplOwner" value="${escapeHtml(partner1)}" checked>
      ${escapeHtml(partner1)}
    </label>
    <label class="radio-option">
      <input type="radio" name="tmplOwner" value="${escapeHtml(partner2)}">
      ${escapeHtml(partner2)}
    </label>`;

  ['tmplP1Label','tmplP2Label'].forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.textContent = [partner1, partner2][i];
  });
}

function updateSliderDisplay(val, valId, val2Id) {
  val = parseInt(val);
  document.getElementById(valId).textContent = val + '%';
  document.getElementById(val2Id).textContent = (100 - val) + '%';
}

document.getElementById('splitSlider').addEventListener('input', e => {
  updateSliderDisplay(e.target.value, 'sliderValue', 'sliderValue2');
});

function openAddModal(splitType, forceOpen = false) {
  const bills = monthBills();
  if (!forceOpen && bills.length === 0 && splitType === 'utility') {
    // Let the empty state handle it
  }
  document.getElementById('modalTitle').textContent =
    splitType === 'utility' ? `Add Utility — ${monthLabel(currentMonth)}` : `Add Subscription — ${monthLabel(currentMonth)}`;
  document.getElementById('billId').value = '';
  document.getElementById('billSplitType').value = splitType;
  document.getElementById('billName').value = '';
  document.getElementById('billAmount').value = '';
  document.getElementById('billNotes').value = '';
  document.getElementById('splitSlider').value = 55;
  updateSliderDisplay(55, 'sliderValue', 'sliderValue2');
  document.getElementById('sliderGroup').style.display = splitType === 'utility' ? '' : 'none';
  updateFormPartnerNames();
  openModal('billModal');
}

function openEditModal(id) {
  const bill = monthBills().find(b => b.id === id);
  if (!bill) return;
  document.getElementById('modalTitle').textContent = 'Edit Bill';
  document.getElementById('billId').value = bill.id;
  document.getElementById('billSplitType').value = bill.splitType;
  document.getElementById('billName').value = bill.name;
  document.getElementById('billAmount').value = bill.amount;
  document.getElementById('billNotes').value = bill.notes || '';
  document.getElementById('splitSlider').value = bill.partner1Percent;
  updateSliderDisplay(bill.partner1Percent, 'sliderValue', 'sliderValue2');
  document.getElementById('sliderGroup').style.display = bill.splitType === 'utility' ? '' : 'none';
  updateFormPartnerNames();
  setTimeout(() => {
    document.querySelectorAll('input[name="owner"]').forEach(r => { r.checked = r.value === bill.owner; });
  }, 0);
  openModal('billModal');
}

document.getElementById('billForm').addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('billId').value;
  const owner = document.querySelector('input[name="owner"]:checked')?.value;
  const splitType = document.getElementById('billSplitType').value;
  const payload = {
    name: document.getElementById('billName').value.trim(),
    amount: parseFloat(document.getElementById('billAmount').value),
    owner,
    splitType,
    partner1Percent: parseInt(document.getElementById('splitSlider').value),
    notes: document.getElementById('billNotes').value.trim(),
  };
  if (id) {
    await api('PUT', `/api/months/${currentMonth}/bills/${id}`, payload);
  } else {
    await api('POST', `/api/months/${currentMonth}/bills`, payload);
  }
  closeModal('billModal');
  await loadData();
});

// ── Delete Modal ──────────────────────────────────────────────────────────────

function openDeleteModal(id, name) {
  deletePendingId = id;
  document.getElementById('deleteBillName').textContent = name;
  openModal('deleteModal');
}

document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
  if (!deletePendingId) return;
  await api('DELETE', `/api/months/${currentMonth}/bills/${deletePendingId}`);
  deletePendingId = null;
  closeModal('deleteModal');
  await loadData();
});

// ── Templates Modal ───────────────────────────────────────────────────────────

document.getElementById('templatesBtn').addEventListener('click', () => {
  renderTemplates();
  openModal('templatesModal');
});

function renderTemplates() {
  const { partner1, partner2 } = state.settings;
  const utilities = state.templates.filter(t => t.splitType === 'utility');
  const subscriptions = state.templates.filter(t => t.splitType === 'subscription');

  renderTmplList('tmplUtilityList', utilities, partner1, partner2);
  renderTmplList('tmplSubscriptionList', subscriptions, partner1, partner2);
}

function renderTmplList(containerId, tmpls, p1, p2) {
  const el = document.getElementById(containerId);
  if (tmpls.length === 0) {
    el.innerHTML = '<div class="tmpl-empty">None yet</div>';
    return;
  }
  el.innerHTML = tmpls.map(t => {
    const ownerLabel = t.owner === p1 ? p1 : p2;
    const split = t.splitType === 'subscription' ? '50/50' : `${t.partner1Percent}/${100 - t.partner1Percent}`;
    return `
      <div class="tmpl-row" data-id="${t.id}">
        <span class="tmpl-row-name">${escapeHtml(t.name)}</span>
        <span class="tmpl-row-amount">${fmt(t.amount)}</span>
        <span class="tmpl-row-owner">${escapeHtml(ownerLabel)} · ${split}</span>
        <div class="tmpl-row-actions">
          <button class="btn-edit" onclick="openTmplEditModal('${t.id}')">Edit</button>
          <button class="btn-del" onclick="deleteTmpl('${t.id}', '${escapeHtml(t.name)}')">Del</button>
        </div>
      </div>`;
  }).join('');
}

document.getElementById('tmplSlider').addEventListener('input', e => {
  updateSliderDisplay(e.target.value, 'tmplSliderValue', 'tmplSliderValue2');
});

function openTmplModal(splitType) {
  document.getElementById('tmplModalTitle').textContent =
    splitType === 'utility' ? 'Add Utility Template' : 'Add Subscription Template';
  document.getElementById('tmplId').value = '';
  document.getElementById('tmplSplitType').value = splitType;
  document.getElementById('tmplName').value = '';
  document.getElementById('tmplAmount').value = '';
  document.getElementById('tmplNotes').value = '';
  document.getElementById('tmplSlider').value = 55;
  updateSliderDisplay(55, 'tmplSliderValue', 'tmplSliderValue2');
  document.getElementById('tmplSliderGroup').style.display = splitType === 'utility' ? '' : 'none';
  updateFormPartnerNames();
  openModal('tmplModal');
}

function openTmplEditModal(id) {
  const t = state.templates.find(t => t.id === id);
  if (!t) return;
  document.getElementById('tmplModalTitle').textContent = 'Edit Template';
  document.getElementById('tmplId').value = t.id;
  document.getElementById('tmplSplitType').value = t.splitType;
  document.getElementById('tmplName').value = t.name;
  document.getElementById('tmplAmount').value = t.amount;
  document.getElementById('tmplNotes').value = t.notes || '';
  document.getElementById('tmplSlider').value = t.partner1Percent;
  updateSliderDisplay(t.partner1Percent, 'tmplSliderValue', 'tmplSliderValue2');
  document.getElementById('tmplSliderGroup').style.display = t.splitType === 'utility' ? '' : 'none';
  updateFormPartnerNames();
  setTimeout(() => {
    document.querySelectorAll('input[name="tmplOwner"]').forEach(r => { r.checked = r.value === t.owner; });
  }, 0);
  openModal('tmplModal');
}

async function deleteTmpl(id, name) {
  if (!confirm(`Delete template "${name}"? This won't affect existing months.`)) return;
  await api('DELETE', `/api/templates/${id}`);
  await loadData();
  renderTemplates();
}

document.getElementById('tmplForm').addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('tmplId').value;
  const owner = document.querySelector('input[name="tmplOwner"]:checked')?.value;
  const splitType = document.getElementById('tmplSplitType').value;
  const payload = {
    name: document.getElementById('tmplName').value.trim(),
    amount: parseFloat(document.getElementById('tmplAmount').value),
    owner,
    splitType,
    partner1Percent: parseInt(document.getElementById('tmplSlider').value),
    notes: document.getElementById('tmplNotes').value.trim(),
  };
  if (id) {
    await api('PUT', `/api/templates/${id}`, payload);
  } else {
    await api('POST', '/api/templates', payload);
  }
  closeModal('tmplModal');
  await loadData();
  renderTemplates();
});

// ── Settings Modal ────────────────────────────────────────────────────────────

document.getElementById('settingsBtn').addEventListener('click', () => {
  document.getElementById('settingsP1').value = state.settings.partner1;
  document.getElementById('settingsP2').value = state.settings.partner2;
  openModal('settingsModal');
});

document.getElementById('settingsForm').addEventListener('submit', async e => {
  e.preventDefault();
  const p1 = document.getElementById('settingsP1').value.trim();
  const p2 = document.getElementById('settingsP2').value.trim();
  if (!p1 || !p2) return;
  await api('PUT', '/api/settings', { partner1: p1, partner2: p2 });
  closeModal('settingsModal');
  await loadData();
});

// ── Pet Widget ────────────────────────────────────────────────────────────────

const petMessages = [
  ["This bill won't pay itself, but I believe in you!", "you've got this"],
  ["Bills are temporary. Snuggles are forever.", "scientific fact"],
  ["Just pretend the numbers are kibble amounts.", "very reasonable"],
  ["You're doing amazing, sweetie.", "truly"],
  ["One bill at a time. One treat at a time.", "words to live by"],
  ["Money comes and goes. Pets are forever.", "mostly true"],
  ["If I can chase my tail for hours, you can do this.", "inspirational"],
  ["Mortgage? More like bore-gage. Anyway, hi.", "living in the moment"],
];

async function fetchPet() {
  const wrap = document.getElementById('petImgWrap');
  const img = document.getElementById('petImg');
  const captionEl = document.getElementById('petCaption');
  const subEl = document.getElementById('petSubcaption');

  wrap.classList.add('loading');
  img.style.opacity = '0';

  const [caption, sub] = petMessages[Math.floor(Math.random() * petMessages.length)];
  captionEl.textContent = caption;
  subEl.textContent = sub;

  const isDog = Math.random() < 0.5;
  try {
    if (isDog) {
      const data = await fetch('https://dog.ceo/api/breeds/image/random').then(r => r.json());
      img.src = data.message;
    } else {
      img.src = `https://cataas.com/cat?width=400&height=300&t=${Date.now()}`;
    }
  } catch {
    wrap.classList.remove('loading');
  }
}

function onPetLoad() {
  document.getElementById('petImgWrap').classList.remove('loading');
  document.getElementById('petImg').style.opacity = '1';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadData();
fetchPet();
