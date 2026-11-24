/* ============================================================
   SLIP GAJI ASN — Aero Glass dashboard controller
   Vanilla JS. Menggunakan Firebase Auth (Google Sign-In)
   dan REST API FastAPI + PostgreSQL backend.
   ============================================================ */

(function () {
  'use strict';

  function getDefaultPeriod() {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const year = nextMonth.getFullYear();
    const month = String(nextMonth.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  const DEFAULT_PERIOD = getDefaultPeriod();
  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const API_BASE = '';
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCTALsRFzfV-Xf72bi_wVmd6g69YQ_4jYY',
    authDomain: 'slip-gaji-asn.firebaseapp.com',
    projectId: 'slip-gaji-asn',
    storageBucket: 'slip-gaji-asn.firebasestorage.app',
    messagingSenderId: '146666463438',
    appId: '1:146666463438:web:807395d2fa089605a2b09f',
    measurementId: 'G-H5FGMDF88N',
  };
  const MONTH_NAMES = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ];
  const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

  const PERIODS = (() => {
    const out = [];
    const now = new Date();
    const currentYear = now.getFullYear();
    for (let year = Math.min(2025, currentYear - 1); year <= Math.max(2027, currentYear + 1); year += 1) {
      for (let month = 1; month <= 14; month += 1) {
        out.push(`${year}-${String(month).padStart(2, '0')}`);
      }
    }
    return out;
  })();

  const state = {
    view: 'dashboard',
    period: DEFAULT_PERIOD,
    availablePeriods: [],
    periodRecap: {
      total_months: 0,
      oldest_period: null,
      oldest_period_label: null,
      newest_period: null,
      newest_period_label: null,
      available_periods: [],
    },
    mode: 'api',
    token: storageGet('simgaji.token', sessionStorage) || '',
    photoURL: storageGet('simgaji.photoURL', localStorage) || '',
    opd: '',
    opdRaw: '',
    employees: [],
    imports: [],
    activities: [],
    trend: [],
    selected: new Set(),
    currentFile: null,
    importRunning: false,
    potonganNip: '',
    posList: [],
    loans: [],
    loanSaving: false,
    manualImportRunning: false,
    profile: null,
    opdOptions: [],
    profileChangeMode: false,
    printUseSelected: true,
    printZoom: storageGet('simgaji.printZoom', 'fit', localStorage) || 'fit',
    printEmployeeFilter: '',
    pendingConnection: false,
    masterOpdList: [],
    masterOpdFilter: '',
    editingOpdId: null,
    masterUserList: [],
    masterUserFilter: '',
    masterUserRoleFilter: 'all',
    editingUserId: null,
    masterGajiTab: 'gaji-stats',
    masterGajiStats: null,
    masterGajiList: [],
    masterGajiFilter: '',
    penyesuaianList: [],
    rekapBulanan: null,
    rekapBerjangka: null,
    potonganTab: 'rekap-bulanan',
    monitoringLogs: [],
    monitoringFilterAction: '',
    monitoringSearch: '',
  };

  let searchQuery = '';
  let clockTimer = null;

  /* ============================== HELPERS ============================== */

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const setText = (selector, value, root = document) => {
    const node = $(selector, root);
    if (node) node.textContent = value == null ? '' : String(value);
  };

  function storageGet(key, storage) {
    try {
      return storage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function storageSet(key, value, storage) {
    try {
      storage.setItem(key, value);
    } catch (error) {
      /* storage bisa diblokir di mode privat */
    }
  }

  function storageRemove(key, storage) {
    try {
      storage.removeItem(key);
    } catch (error) {
      /* noop */
    }
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function deepClone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function uid(prefix = 'id') {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return `${prefix}-${window.crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char]));
  }

  function periodLabel(period) {
    if (!/^\d{4}-\d{2}$/.test(String(period))) return String(period || '—');
    const [year, month] = period.split('-').map(Number);
    if (month === 13) return `Gaji 13 ${year}`;
    if (month === 14) return `Gaji THR ${year}`;
    return `${MONTH_NAMES[month - 1] || month} ${year}`;
  }

  function periodShort(period) {
    const [, month] = String(period).split('-').map(Number);
    if (month === 13) return 'G13';
    if (month === 14) return 'THR';
    return MONTH_SHORT[month - 1] || period;
  }

  const KDPANGKAT_MAP = {
    '1A': 'I/a',
    '1B': 'I/b',
    '1C': 'I/c',
    '1D': 'I/d',
    '2A': 'II/a',
    '2B': 'II/b',
    '2C': 'II/c',
    '2D': 'II/d',
    '3A': 'III/a',
    '3B': 'III/b',
    '3C': 'III/c',
    '3D': 'III/d',
    '4A': 'IV/a',
    '4B': 'IV/b',
    '4C': 'IV/c',
    '4D': 'IV/d',
    '4E': 'IV/e',
  };

  function formatKdpangkat(val) {
    if (!val) return '—';
    const s = String(val).trim();
    if (!s || s === '—' || s === '-') return '—';
    const upper = s.toUpperCase();
    if (KDPANGKAT_MAP[upper]) return KDPANGKAT_MAP[upper];
    const dashMatch = upper.match(/^(\d[A-E])\s*[-/]\s*([IV]+)\/([A-E])$/i);
    if (dashMatch) return `${dashMatch[2].toUpperCase()}/${dashMatch[3].toLowerCase()}`;
    const romanMatch = upper.match(/^([IV]+)\/([A-E])$/i);
    if (romanMatch) return `${romanMatch[1].toUpperCase()}/${romanMatch[2].toLowerCase()}`;
    return s;
  }

  function getAllPeriods() {
    const list = Array.from(new Set([...(state.availablePeriods || []), ...PERIODS]));
    if (state.period && !list.includes(state.period)) {
      list.push(state.period);
    }
    return list.sort();
  }

  function addMonths(period, count) {
    const [year, month] = period.split('-').map(Number);
    const m = Math.min(12, Math.max(1, month));
    const date = new Date(year, m - 1 + Number(count), 1);
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
  }

  function sumValues(object) {
    return Object.values(object || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
  }

  function formatRupiah(value, decimals = 0) {
    const number = Number(value) || 0;
    const negative = number < 0;
    const formatted = Math.abs(number).toLocaleString('id-ID', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    return `${negative ? '-' : ''}Rp ${formatted}`;
  }

  function formatAmount(value) {
    return (Number(value) || 0).toLocaleString('id-ID', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function formatCompact(value) {
    const number = Number(value) || 0;
    if (Math.abs(number) >= 1000000) {
      return `Rp ${(number / 1000000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
    }
    return formatRupiah(number, 0);
  }

  function formatNumber(value) {
    const num = Number(value) || 0;
    return new Intl.NumberFormat('id-ID').format(num);
  }

  function formatBytes(bytes) {
    const size = Number(bytes) || 0;
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(2)} MB`;
  }

  function formatMoneyInput(value) {
    const number = Number(value) || 0;
    return number.toLocaleString('id-ID', { maximumFractionDigits: 2 });
  }

  function parseMoneyInput(raw) {
    let value = String(raw == null ? '' : raw).trim().replace(/\s+/g, '').replace(/^rp\.?/i, '');
    if (!value) return 0;

    let negative = false;
    if (/^\(.*\)$/.test(value)) {
      negative = true;
      value = value.slice(1, -1);
    }
    if (value.startsWith('-')) {
      negative = !negative;
      value = value.slice(1);
    }
    value = value.replace(/-$/, '');

    if (value.includes('.') && value.includes(',')) {
      if (value.lastIndexOf(',') > value.lastIndexOf('.')) {
        value = value.replace(/\./g, '').replace(/,/g, '.');
      } else {
        value = value.replace(/,/g, '');
      }
    } else if (value.includes(',')) {
      value = value.replace(/,/g, '.');
    } else if (value.includes('.')) {
      const parts = value.split('.');
      if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3 && parts[0] !== '0')) {
        value = parts.join('');
      }
    }

    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return negative ? -number : number;
  }

  function relativeTimeLabel() {
    return new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  }

  function shortOpd(value, limit = 58) {
    const text = String(value || '—');
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
  }

  function chunk(items, size) {
    const out = [];
    for (let index = 0; index < items.length; index += size) {
      out.push(items.slice(index, index + size));
    }
    return out;
  }

  function findEmployee(nip) {
    return state.employees.find((employee) => employee.nip === nip) || null;
  }

  function getFilteredEmployees() {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return state.employees;
    return state.employees.filter((employee) => (
      String(employee.nama).toLowerCase().includes(query)
      || String(employee.nip).includes(query)
    ));
  }

  function computeTotals() {
    const totals = {
      pegawai: state.employees.length,
      kotor: 0,
      potonganSimgaji: 0,
      potonganInternal: 0,
      totalPotongan: 0,
      thp: 0,
    };
    state.employees.forEach((employee) => {
      totals.kotor += Number(employee.kotor) || 0;
      totals.potonganSimgaji += Number(employee.potonganSimgaji) || 0;
      totals.potonganInternal += Number(employee.potonganInternal) || 0;
      totals.totalPotongan += Number(employee.totalPotongan) || 0;
      totals.thp += Number(employee.thp) || 0;
    });
    return totals;
  }

  function recomputeEmployee(employee) {
    if (employee.income && employee.resmi) {
      employee.kotor = sumValues(employee.income);
      employee.potonganSimgaji = sumValues(employee.resmi);
    }
    const itemsTotal = (employee.internalPotongan || []).reduce(
      (sum, item) => sum + (Number(item.nominal) || 0),
      0,
    );
    employee.potonganInternal = (Number(employee.basePotonganInternal) || 0) + itemsTotal;
    employee.totalPotongan = (Number(employee.potonganSimgaji) || 0) + employee.potonganInternal;
    employee.thp = (Number(employee.kotor) || 0) - employee.totalPotongan;
    return employee;
  }

  /* ============================== RENDER ============================== */

  function setStatus(message) {
    const node = $('#status-message');
    if (node) node.textContent = message;
  }

  function renderAll() {
    renderChrome();
    const totals = computeTotals();
    renderDashboard(totals);
    renderEmployeeTable();
    renderActivity();
    renderImportHistory();
    populatePosSelects();
    renderLoansTable();
    renderPotongan();
    renderPosTable();
    renderRekapBulanan();
    renderRekapBerjangka();
    renderPrintPreview();
    updateProfileUI();
  }

  function renderChrome() {
    const period = periodLabel(state.period);
    const modeLabel = 'Terhubung API';
    const isSuperAdmin = Boolean(state.profile && state.profile.is_super_admin);

    const opdText = isSuperAdmin ? 'Tidak Terikat OPD' : (state.opd || 'Belum Ada OPD');
    const toolbarOpd = isSuperAdmin ? 'Super Admin (Tidak Terikat OPD)' : shortOpd(state.opd || 'Belum Ada OPD', 62);
    const dashboardOpd = isSuperAdmin ? 'Seluruh OPD Daerah (Super Admin)' : (state.opd || 'Belum Ada OPD');
    const statusOpd = isSuperAdmin ? 'OPD: Tidak Terikat OPD' : `OPD: ${shortOpd(state.opd || '—', 46)}`;

    const nodes = [
      ['#profile-opd', opdText],
      ['#toolbar-opd', toolbarOpd],
      ['#dashboard-opd', dashboardOpd],
      ['#status-opd', statusOpd],
      ['#status-period', `Periode: ${period}`],
      ['#dashboard-period', period],
      ['#toolbar-period-val', period],
      ['#data-mode-label', modeLabel],
      ['#status-data-mode', 'API'],
      ['#chart-caption', state.period ? state.period.slice(0, 4) : ''],
      ['#loan-period', period],
      ['#potongan-mode-note-text', 'Pos potongan dan pinjaman tersimpan di basis data PostgreSQL.'],
    ];
    nodes.forEach(([selector, value]) => {
      const node = $(selector);
      if (node) node.textContent = value;
    });

    const chip = $('#data-mode-chip');
    if (chip) chip.classList.add('is-api');
  }

  function renderDashboard(totals) {
    updateDashboardGreeting();
    renderChart(totals);
    renderComposition(totals);
    renderPeriodRecap();
  }

  function updateDashboardGreeting() {
    const nameEl = $('#dashboard-admin-name');
    const metaEl = $('#dashboard-admin-meta');
    if (!nameEl) return;
    const name = state.profile?.display_name || state.profile?.nama_bendahara || state.profile?.email || 'Admin Bendahara';
    nameEl.textContent = name;
    if (metaEl) {
      if (state.profile?.role === 'super_admin' || state.profile?.is_super_admin) {
        metaEl.textContent = 'Super Administrator • Tidak Terikat OPD';
      } else {
        const opd = state.profile?.opd_name || state.opd || 'Bendahara OPD';
        const jab = state.profile?.jabatan || 'Bendahara Pengeluaran';
        metaEl.textContent = `${jab} • ${opd}`;
      }
    }
  }

  function renderPeriodRecap() {
    const recap = state.periodRecap || {};
    const setText = (selector, value) => {
      const node = $(selector);
      if (node) node.textContent = value;
    };
    setText('#recap-total-months', `${recap.total_months || 0} Bulan`);
    setText('#recap-oldest-period', recap.oldest_period_label || recap.oldest_period || '—');
    setText('#recap-newest-period', recap.newest_period_label || recap.newest_period || '—');
  }

  function renderChart(totals) {
    const container = $('#chart-bars');
    if (!container) return;

    let items = (state.trend && state.trend.length > 0)
      ? state.trend
      : (totals && totals.thp > 0
          ? [{ period: state.period, period_label: periodLabel(state.period), value: totals.thp }]
          : []);

    if (items.length === 0) {
      container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:#8fa7b8;font-size:12px;font-style:italic;">Belum ada arsip data gaji untuk menampilkan tren.</div>';
      return;
    }

    const values = items.map((entry) => ({
      period: entry.period,
      period_label: entry.period_label || periodLabel(entry.period),
      value: Number(entry.value) || 0,
    }));

    const maxValue = Math.max(1, ...values.map((entry) => entry.value));
    const axisMax = Math.max(10_000_000, Math.ceil(maxValue / 10_000_000) * 10_000_000);

    const labels = $$('.chart-y span');
    if (labels.length === 4) {
      labels[0].textContent = formatCompact(axisMax);
      labels[1].textContent = formatCompact((axisMax * 2) / 3);
      labels[2].textContent = formatCompact(axisMax / 3);
      labels[3].textContent = 'Rp 0';
    }

    const captionNode = $('#chart-caption');
    if (captionNode) {
      if (values.length > 0) {
        const first = values[0].period.slice(0, 4);
        const last = values[values.length - 1].period.slice(0, 4);
        captionNode.textContent = first === last ? first : `${first}–${last}`;
      } else {
        captionNode.textContent = new Date().getFullYear().toString();
      }
    }

    container.innerHTML = values.map((entry) => {
      const value = entry.value;
      const height = Math.max(4, Math.min(100, (value / axisMax) * 100));
      const active = entry.period === state.period;
      return `
        <div class="chart-bar${active ? ' active' : ''}" data-period="${escapeHtml(entry.period)}" style="cursor:pointer;" title="${escapeHtml(entry.period_label)}: ${escapeHtml(formatRupiah(value, 0))}">
          <span class="chart-bar-fill" style="--h:${height.toFixed(2)}%"></span>
          <span class="chart-bar-label">${escapeHtml(periodShort(entry.period))}</span>
        </div>`;
    }).join('');

    container.querySelectorAll('.chart-bar').forEach((bar) => {
      bar.addEventListener('click', () => {
        const p = bar.getAttribute('data-period');
        if (p && p !== state.period) {
          setPeriod(p);
        }
      });
    });
  }

  function renderComposition(totals) {
    const total = totals.totalPotongan;
    const resmi = totals.potonganSimgaji;
    const internal = totals.potonganInternal;
    const resmiPct = total > 0 ? (resmi / total) * 100 : 0;
    const internalPct = total > 0 ? (internal / total) * 100 : 0;

    const setWidth = (selector, width) => {
      const node = $(selector);
      if (node) node.style.width = `${Math.max(0, Math.min(100, width)).toFixed(2)}%`;
    };
    setWidth('#compose-resmi-bar', resmiPct);
    setWidth('#compose-internal-bar', internalPct);

    const setText = (selector, value) => {
      const node = $(selector);
      if (node) node.textContent = value;
    };
    setText('#compose-total', formatRupiah(total, 0));
    setText('#compose-resmi-value', formatRupiah(resmi, 0));
    setText('#compose-internal-value', formatRupiah(internal, 0));
  }

  function renderEmployeeTable() {
    const body = $('#employee-table-body');
    if (!body) return;

    const employees = getFilteredEmployees();
    body.innerHTML = employees.map((employee) => {
      const selected = state.selected.has(employee.nip);
      return `
        <tr data-nip="${escapeHtml(employee.nip)}" class="${selected ? 'is-selected' : ''}">
          <td class="check-col">
            <input type="checkbox" class="employee-check" id="check-${escapeHtml(employee.nip)}"
                   data-nip="${escapeHtml(employee.nip)}"
                   aria-label="Pilih ${escapeHtml(employee.nama)}" ${selected ? 'checked' : ''}>
            <label class="check-label" for="check-${escapeHtml(employee.nip)}"></label>
          </td>
          <td>
            <div class="employee-name">
              <strong title="${escapeHtml(employee.nama)}">${escapeHtml(employee.nama)}</strong>
              <span>${escapeHtml(employee.nip)}</span>
            </div>
          </td>
          <td><span class="pangkat-badge">${escapeHtml(formatKdpangkat(employee.kdpangkat))}</span></td>
          <td class="money-col">${formatRupiah(employee.kotor, 2)}</td>
          <td class="money-col deduction-value">${formatRupiah(employee.totalPotongan, 2)}</td>
          <td class="money-col thp-value">${formatRupiah(employee.thp, 2)}</td>
          <td class="action-col">
            <button type="button" class="row-action" data-action="print-one"
                    data-nip="${escapeHtml(employee.nip)}" title="Cetak slip ${escapeHtml(employee.nama)}"
                    aria-label="Cetak slip ${escapeHtml(employee.nama)}">
              <svg class="icon"><use href="#icon-printer"></use></svg>
            </button>
          </td>
        </tr>`;
    }).join('');

    const empty = $('#employee-empty');
    if (empty) empty.hidden = employees.length > 0;

    const countLabel = $('#employee-count-label');
    if (countLabel) {
      countLabel.textContent = employees.length === state.employees.length
        ? `${state.employees.length} pegawai`
        : `${employees.length} dari ${state.employees.length} pegawai`;
    }

    updateSelectionControls();
  }

  function updateSelectionControls() {
    const checkAll = $('#select-all-employees');
    if (!checkAll) return;
    const employees = getFilteredEmployees();
    const selectedVisible = employees.filter((employee) => state.selected.has(employee.nip)).length;
    checkAll.checked = employees.length > 0 && selectedVisible === employees.length;
    checkAll.indeterminate = selectedVisible > 0 && selectedVisible < employees.length;
  }

  function renderActivity() {
    const container = $('#activity-list');
    if (!container) return;
    if (!state.activities.length) {
      container.innerHTML = '<div class="empty-state compact"><strong>Belum ada aktivitas</strong></div>';
      return;
    }
    const iconMap = {
      import: '#icon-upload',
      potongan: '#icon-receipt',
      sync: '#icon-connection',
    };
    container.innerHTML = state.activities.slice(0, 6).map((activity) => `
      <div class="activity-item">
        <span class="activity-icon ${escapeHtml(activity.tone || '')}">
          <svg class="icon"><use href="${iconMap[activity.type] || '#icon-info'}"></use></svg>
        </span>
        <div class="activity-copy">
          <strong>${escapeHtml(activity.title)}</strong>
          <span>${escapeHtml(activity.detail)}</span>
        </div>
        <span class="activity-time">${escapeHtml(activity.time)}</span>
      </div>`).join('');
  }

  function renderImportHistory() {
    const body = $('#import-history-body');
    if (!body) return;
    if (!state.imports.length) {
      body.innerHTML = '<tr><td colspan="5" class="muted-cell">Belum ada riwayat import.</td></tr>';
      return;
    }
    body.innerHTML = state.imports.slice(0, 8).map((item) => `
      <tr>
        <td>${escapeHtml(item.time)}</td>
        <td><strong>${escapeHtml(item.file)}</strong></td>
        <td title="${escapeHtml(item.opd)}">${escapeHtml(shortOpd(item.opd, 42))}</td>
        <td>${Number(item.rows) || 0}</td>
        <td><span class="status-pill ${item.status === 'success' ? '' : 'error'}">${item.status === 'success' ? 'Berhasil' : 'Gagal'}</span></td>
      </tr>`).join('');
  }

  function currentPotonganEmployee() {
    return findEmployee(state.potonganNip) || state.employees[0] || null;
  }

  function selectPotonganEmployee(nip) {
    if (!nip) return;
    state.potonganNip = nip;
    const hiddenNip = $('#potongan-nip');
    if (hiddenNip) hiddenNip.value = nip;

    const emp = findEmployee(nip);
    const searchInput = $('#potongan-search-input');
    const clearBtn = $('#btn-potongan-clear');
    if (searchInput) {
      searchInput.value = emp ? `${emp.nip} — ${emp.nama}` : nip;
    }
    if (clearBtn) {
      clearBtn.hidden = !searchInput || !searchInput.value;
    }
    const dropdown = $('#potongan-search-dropdown');
    if (dropdown) dropdown.hidden = true;

    updatePotonganEmployee(nip);
    if (state.mode === 'api') {
      loadEmployeePotongan(nip, state.period);
    }
  }

  function renderPotonganSearchDropdown(query = '') {
    const dropdown = $('#potongan-search-dropdown');
    if (!dropdown) return;
    const q = (query || '').trim().toLowerCase();
    const list = state.employees || [];
    const filtered = q
      ? list.filter((emp) => (emp.nip || '').toLowerCase().includes(q) || (emp.nama || '').toLowerCase().includes(q)).slice(0, 15)
      : list.slice(0, 15);

    if (!filtered.length) {
      dropdown.innerHTML = '<div class="picker-dropdown-empty">Tidak ada ASN yang cocok.</div>';
      dropdown.hidden = false;
      return;
    }

    dropdown.innerHTML = filtered.map((emp) => `
      <div class="picker-dropdown-item ${emp.nip === state.potonganNip ? 'active' : ''}" data-nip="${escapeHtml(emp.nip)}">
        <div class="pdi-nip">${escapeHtml(emp.nip)}</div>
        <div class="pdi-name">
          <strong>${escapeHtml(emp.nama)}</strong>
          <span class="pdi-sub">${escapeHtml(formatKdpangkat(emp.kdpangkat))}</span>
        </div>
      </div>
    `).join('');
    dropdown.hidden = false;
  }

  async function openBrowsePegawaiModal(context = 'potongan') {
    state.browsePegawaiContext = context;
    const titleEl = $('#browse-pegawai-title');
    const descEl = $('#browse-pegawai-desc');
    if (context === 'penyesuaian') {
      if (titleEl) titleEl.textContent = 'Pilih Pegawai ASN — Penyesuaian Gaji';
      if (descEl) descEl.textContent = 'Cari dan pilih pegawai ASN berdasarkan NIP, Nama, atau Pangkat untuk mencatat penyesuaian gaji.';
    } else {
      if (titleEl) titleEl.textContent = 'Pilih Pegawai ASN — Potongan';
      if (descEl) descEl.textContent = 'Cari dan pilih pegawai ASN berdasarkan NIP, Nama, atau Pangkat untuk menampilkan dan mengelola potongan gaji.';
    }

    if ((!state.employees || !state.employees.length) && (!state.masterGajiList || !state.masterGajiList.length)) {
      if (state.token) {
        try {
          await loadMasterGajiList();
        } catch (_) {}
      }
    }

    renderBrowsePegawaiTable('');
    const searchInput = $('#browse-pegawai-search');
    if (searchInput) searchInput.value = '';
    openModal('browse-pegawai');
    if (searchInput) {
      window.setTimeout(() => searchInput.focus(), 50);
    }
  }

  function handleSelectBrowsePegawai(nip) {
    if (!nip) return;
    if (state.browsePegawaiContext === 'penyesuaian') {
      const list = (state.employees && state.employees.length) ? state.employees : (state.masterGajiList || []);
      const emp = list.find((e) => e.nip === nip);
      const nipInput = $('#penyesuaian-nip');
      const namaInput = $('#penyesuaian-nama');
      if (nipInput) nipInput.value = nip;
      if (namaInput) namaInput.value = emp ? emp.nama : '';
      closeModal();
      const nominalInput = $('#penyesuaian-nominal');
      if (nominalInput) nominalInput.focus();
    } else {
      selectPotonganEmployee(nip);
      closeModal();
    }
  }

  function renderBrowsePegawaiTable(query = '') {
    const tbody = $('#tbody-browse-pegawai');
    const countBadge = $('#browse-pegawai-count');
    if (!tbody) return;

    const q = (query || '').trim().toLowerCase();
    const list = (state.employees && state.employees.length) ? state.employees : (state.masterGajiList || []);
    const filtered = list.filter((emp) => {
      if (!q) return true;
      return (
        (emp.nip || '').toLowerCase().includes(q) ||
        (emp.nama || '').toLowerCase().includes(q) ||
        (emp.kdpangkat || '').toLowerCase().includes(q) ||
        formatKdpangkat(emp.kdpangkat).toLowerCase().includes(q) ||
        (emp.norek || '').toLowerCase().includes(q)
      );
    });

    if (countBadge) {
      countBadge.textContent = `${filtered.length} dari ${list.length} pegawai`;
    }

    if (!filtered.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="table-empty">
            ${q ? 'Tidak ada ASN yang cocok dengan pencarian.' : 'Belum ada data pegawai untuk OPD ini.'}
          </td>
        </tr>
      `;
      return;
    }

    const currentNip = state.browsePegawaiContext === 'penyesuaian'
      ? ($('#penyesuaian-nip')?.value || '')
      : state.potonganNip;

    tbody.innerHTML = filtered.map((emp, idx) => {
      const isCurrent = emp.nip === currentNip;
      return `
        <tr class="browse-pegawai-row ${isCurrent ? 'selected-row' : ''}" data-nip="${escapeHtml(emp.nip)}" style="cursor: pointer;">
          <td style="text-align: center;">${idx + 1}</td>
          <td><code class="mono">${escapeHtml(emp.nip)}</code></td>
          <td><strong>${escapeHtml(emp.nama)}</strong></td>
          <td style="text-align: center;">${escapeHtml(formatKdpangkat(emp.kdpangkat))}</td>
          <td>${escapeHtml(emp.norek || '—')}</td>
          <td style="text-align: center;">
            <button type="button" class="${isCurrent ? '' : 'default'} btn-select-emp" data-nip="${escapeHtml(emp.nip)}">
              ${isCurrent ? 'Terpilih' : 'Pilih'}
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderPotongan() {
    const current = state.potonganNip || (state.employees[0] ? state.employees[0].nip : '');
    if (state.employees.some((employee) => employee.nip === current)) {
      state.potonganNip = current;
    } else if (state.employees[0]) {
      state.potonganNip = state.employees[0].nip;
    } else {
      state.potonganNip = '';
    }

    const hiddenNip = $('#potongan-nip');
    if (hiddenNip) hiddenNip.value = state.potonganNip;

    const searchInput = $('#potongan-search-input');
    const clearBtn = $('#btn-potongan-clear');
    const emp = findEmployee(state.potonganNip);
    if (searchInput) {
      if (emp) {
        searchInput.value = `${emp.nip} — ${emp.nama}`;
        searchInput.placeholder = 'Ketik NIP atau Nama ASN…';
      } else {
        searchInput.value = '';
        searchInput.placeholder = state.employees.length ? 'Pilih pegawai ASN…' : 'Belum ada data pegawai';
      }
    }
    if (clearBtn) {
      clearBtn.hidden = !searchInput || !searchInput.value;
    }

    updatePotonganEmployee(state.potonganNip);

    const bulananPeriod = $('#bulanan-period');
    const manualPeriod = $('#manual-period');
    const loanStart = $('#loan-start');
    if (bulananPeriod && !bulananPeriod.value) bulananPeriod.value = state.period;
    if (manualPeriod && !manualPeriod.value) manualPeriod.value = state.period;
    if (loanStart && !loanStart.value) loanStart.value = state.period;
  }

  function updatePotonganEmployee(nip) {
    const employee = findEmployee(nip);
    const name = $('#potongan-nama');
    const pangkat = $('#potongan-pangkat');
    const total = $('#potongan-total-internal');
    const listSub = $('#potongan-list-sub');

    if (!employee) {
      if (name) name.textContent = '—';
      if (pangkat) pangkat.textContent = '—';
      if (total) total.textContent = 'Rp 0';
      if (listSub) listSub.textContent = 'Belum ada pegawai';
      renderPotonganList(null);
      return;
    }

    state.potonganNip = employee.nip;
    if (name) name.textContent = employee.nama;
    if (pangkat) pangkat.textContent = formatKdpangkat(employee.kdpangkat);
    if (total) total.textContent = formatRupiah(employee.potonganInternal, 0);
    if (listSub) listSub.textContent = `${employee.nama} • ${periodLabel(state.period)}`;
    renderPotonganList(employee);
  }

  function renderPotonganList(employee) {
    const container = $('#potongan-list');
    const empty = $('#potongan-empty');
    const totalNode = $('#potongan-list-total');
    if (!container) return;

    if (!employee) {
      container.innerHTML = '';
      if (empty) empty.hidden = false;
      if (totalNode) totalNode.textContent = 'Rp 0';
      return;
    }

    const items = employee.internalPotongan || [];
    const base = Number(employee.basePotonganInternal) || 0;
    const rows = [];

    if (base > 0) {
      rows.push(`
        <div class="deduction-item">
          <span class="deduction-icon"><svg class="icon"><use href="#icon-receipt"></use></svg></span>
          <div class="deduction-copy">
            <strong>Potongan internal tersimpan</strong>
          </div>
          <span class="deduction-amount">${formatRupiah(base, 0)}</span>
        </div>`);
    }

    // Urutkan data potongan: bulanan dulu baru berjangka
    const sortedItems = [...items].sort((a, b) => {
      const katA = (a.kategori || (a.readOnly || a.cicilan_info ? 'berjangka' : 'bulanan')).toLowerCase();
      const katB = (b.kategori || (b.readOnly || b.cicilan_info ? 'berjangka' : 'bulanan')).toLowerCase();
      if (katA !== katB) {
        if (katA === 'bulanan') return -1;
        if (katB === 'bulanan') return 1;
      }
      return String(a.pos || a.pos_nama || '').localeCompare(String(b.pos || b.pos_nama || ''));
    });

    sortedItems.forEach((item) => {
      const badgeKat = (item.kategori || (item.readOnly || item.cicilan_info ? 'berjangka' : 'bulanan')).toLowerCase();
      const badgeHtml = badgeKat === 'bulanan'
        ? '<span class="deduction-badge bulanan">Bulanan</span>'
        : '<span class="deduction-badge berjangka">Berjangka</span>';

      const cicilanTag = item.cicilan_info
        ? ` <span style="font-weight: normal; font-size: 9px; color: #8a6417;">(${escapeHtml(item.cicilan_info)})</span>`
        : '';

      const editControl = `
        <button type="button" class="edit-deduction" data-edit-potongan="${escapeHtml(item.id)}"
                title="Ubah data potongan" aria-label="Ubah ${escapeHtml(item.pos)}">
          <svg class="icon"><use href="#icon-edit"></use></svg>
        </button>`;

      const deleteControl = item.readOnly ? '' : `
        <button type="button" class="delete-deduction" data-delete-potongan="${escapeHtml(item.id)}"
                title="Hapus potongan" aria-label="Hapus ${escapeHtml(item.pos)}">
          <svg class="icon"><use href="#icon-trash"></use></svg>
        </button>`;

      rows.push(`
        <div class="deduction-item">
          <span class="deduction-icon"><svg class="icon"><use href="#icon-receipt"></use></svg></span>
          <div class="deduction-copy">
            <div style="display: flex; align-items: center; gap: 5px;">
              ${badgeHtml}
              <strong title="${escapeHtml(item.pos)}">${escapeHtml(item.pos)}${cicilanTag}</strong>
            </div>
          </div>
          <span class="deduction-amount">${formatRupiah(item.nominal, 0)}</span>
          <div class="deduction-actions">
            ${editControl}
            ${deleteControl}
          </div>
        </div>`);
    });

    container.innerHTML = rows.join('');
    if (empty) empty.hidden = rows.length > 0;
    if (totalNode) totalNode.textContent = formatRupiah(employee.potonganInternal, 0);
  }

  function periodShortLabel(period) {
    if (!/^\d{4}-\d{2}$/.test(String(period))) return String(period || '—');
    const [year, month] = period.split('-').map(Number);
    if (month === 13) return `Gaji 13 ${year}`;
    if (month === 14) return `THR ${year}`;
    return `${MONTH_SHORT[month - 1] || month} ${year}`;
  }

  function monthNumber(period) {
    const [year, month] = String(period).split('-').map(Number);
    return (year * 12) + (Math.min(12, month) - 1);
  }

  function loanProgressFor(loan, period) {
    const tenor = Number(loan.tenor_bulan) || Math.max(1, monthNumber(loan.end_period) - monthNumber(loan.start_period) + 1);
    const start = monthNumber(loan.start_period);
    const current = monthNumber(period);
    if (current < start) {
      return { cicilan: null, sisa: tenor, status: 'belum_mulai' };
    }
    const cicilan = current - start + 1;
    if (cicilan >= tenor) {
      return { cicilan: tenor, sisa: 0, status: cicilan === tenor ? 'aktif' : 'selesai' };
    }
    return { cicilan, sisa: tenor - cicilan, status: 'aktif' };
  }

  function findPos(id) {
    return state.posList.find((pos) => String(pos.id) === String(id)) || null;
  }

  function tenorBadge(loan) {
    const progress = loanProgressFor(loan, state.period);
    const tenor = Number(loan.tenor_bulan) || 1;
    const pct = Math.max(0, Math.min(100, ((progress.cicilan || 0) / tenor) * 100));
    return `
      <span class="tenor-badge" title="${progress.sisa ?? tenor} bulan tersisa">
        <span class="tenor-mini"><span style="width:${pct.toFixed(1)}%"></span></span>
        <strong>${progress.cicilan || 0} / ${tenor}</strong>
        <em>bulan</em>
      </span>`;
  }

  function loanStatusBadge(status) {
    if (status === 'aktif') return '<span class="status-pill">Aktif</span>';
    if (status === 'belum_mulai') return '<span class="status-pill neutral">Belum mulai</span>';
    return '<span class="status-pill neutral">Selesai</span>';
  }

  function renderLoansTable() {
    const body = $('#loan-table-body');
    if (!body) return;

    const loans = state.loans
      .filter((loan) => loanProgressFor(loan, state.period).status !== 'selesai')
      .sort((a, b) => monthNumber(b.start_period) - monthNumber(a.start_period));

    body.innerHTML = loans.map((loan) => {
      const employee = findEmployee(loan.nip);
      const nama = loan.nama || (employee ? employee.nama : '—');
      const progress = loanProgressFor(loan, state.period);
      return `
        <tr>
          <td>
            <div class="employee-name">
              <strong title="${escapeHtml(nama)}">${escapeHtml(nama)}</strong>
              <span>${escapeHtml(loan.nip)}</span>
            </div>
          </td>
          <td title="${escapeHtml(loan.pos_nama || '—')}">${escapeHtml(loan.pos_nama || '—')}</td>
          <td class="money-col">${formatRupiah(loan.nominal_per_bulan, 0)}</td>
          <td>${escapeHtml(periodShortLabel(loan.start_period))}</td>
          <td>${Number(loan.tenor_bulan) || 0} bln</td>
          <td>${tenorBadge(loan)}</td>
          <td>${loanStatusBadge(progress.status)}</td>
        </tr>`;
    }).join('');

    const empty = $('#loan-empty');
    if (empty) empty.hidden = loans.length > 0;
    const count = $('#loan-count');
    if (count) {
      const total = loans.reduce((sum, loan) => sum + (Number(loan.nominal_per_bulan) || 0), 0);
      count.textContent = loans.length
        ? `${loans.length} pinjaman aktif • ${formatRupiah(total, 0)} / bulan`
        : `Belum ada pinjaman aktif • ${periodLabel(state.period)}`;
    }
  }

  function renderPosTable() {
    const body = $('#pos-table-body');
    if (!body) return;

    const editingId = $('#pos-edit-id')?.value || '';

    const rows = [...state.posList].sort((a, b) => (
      String(a.kategori).localeCompare(String(b.kategori))
      || String(a.nama_pos).localeCompare(String(b.nama_pos))
    ));
    body.innerHTML = rows.map((pos) => {
      const isEditing = editingId && String(pos.id) === String(editingId);
      return `
      <tr class="${isEditing ? 'is-editing' : ''}" data-pos-row="${escapeHtml(pos.id)}">
        <td><strong>${escapeHtml(pos.nama_pos)}</strong></td>
        <td><span class="status-pill neutral">${escapeHtml(pos.kategori)}</span></td>
        <td>${pos.is_active ? '<span class="status-pill">Aktif</span>' : '<span class="status-pill error">Nonaktif</span>'}</td>
        <td>
          <div class="pos-actions">
            <button type="button" class="pos-btn edit" data-pos-edit="${escapeHtml(pos.id)}" title="Edit pos potongan">
              Edit
            </button>
            <button type="button" class="pos-btn toggle" data-pos-toggle="${escapeHtml(pos.id)}" title="${pos.is_active ? 'Nonaktifkan pos' : 'Aktifkan pos'}">
              ${pos.is_active ? 'Nonaktifkan' : 'Aktifkan'}
            </button>
          </div>
        </td>
      </tr>`;
    }).join('');

    const empty = $('#pos-empty');
    if (empty) empty.hidden = rows.length > 0;
    const count = $('#pos-list-count');
    if (count) count.textContent = `${rows.length} pos • ${rows.filter((pos) => pos.is_active).length} aktif`;
  }

  function renderRekapBulanan() {
    const body = $('#rekap-bulanan-table-body');
    if (!body) return;

    const periodText = periodLabel(state.period);
    const labelPeriod = $('#rekap-bulanan-period-label');
    if (labelPeriod) labelPeriod.textContent = periodText;
    const subPeriod = $('#rekap-bulanan-period-sub');
    if (subPeriod) subPeriod.textContent = `Periode ${periodText}`;

    const rekap = state.rekapBulanan;
    if (!rekap || !Array.isArray(rekap.items)) {
      const bulananPos = state.posList.filter((p) => p.kategori === 'bulanan');
      const totalPosEl = $('#rekap-bulanan-total-pos');
      if (totalPosEl) totalPosEl.textContent = `${bulananPos.length} Pos`;
      const totalPegawaiEl = $('#rekap-bulanan-total-pegawai');
      if (totalPegawaiEl) totalPegawaiEl.textContent = `0 ASN`;
      const totalNominalEl = $('#rekap-bulanan-total-nominal');
      if (totalNominalEl) totalNominalEl.textContent = `Rp 0`;

      body.innerHTML = bulananPos.map((pos) => `
        <tr>
          <td><strong>${escapeHtml(pos.nama_pos)}</strong></td>
          <td><span class="status-pill neutral">bulanan</span></td>
          <td style="text-align: center;"><span class="badge">0 ASN</span></td>
          <td class="money-col mono">Rp 0</td>
          <td style="text-align: center;">${pos.is_active ? '<span class="status-pill">Aktif</span>' : '<span class="status-pill error">Nonaktif</span>'}</td>
          <td style="text-align: center;">
            <div class="pos-rekap-actions">
              <button type="button" class="pos-rekap-btn primary" data-open-pos-detail="${escapeHtml(pos.id)}" data-pos-nama="${escapeHtml(pos.nama_pos)}" title="Lihat rincian pegawai terpotong">
                Rincian
              </button>
              <button type="button" class="pos-rekap-btn" data-import-pos="${escapeHtml(pos.id)}" title="Import Excel khusus pos ini">
                Import
              </button>
            </div>
          </td>
        </tr>
      `).join('');

      const empty = $('#rekap-bulanan-empty');
      if (empty) empty.hidden = bulananPos.length > 0;
      return;
    }

    const totalPosEl = $('#rekap-bulanan-total-pos');
    if (totalPosEl) totalPosEl.textContent = `${rekap.total_pos || 0} Pos`;
    const totalPegawaiEl = $('#rekap-bulanan-total-pegawai');
    if (totalPegawaiEl) totalPegawaiEl.textContent = `${rekap.total_pegawai || 0} ASN`;
    const totalNominalEl = $('#rekap-bulanan-total-nominal');
    if (totalNominalEl) totalNominalEl.textContent = formatRupiah(rekap.total_nominal || 0, 0);

    const items = rekap.items || [];
    body.innerHTML = items.map((item) => `
      <tr>
        <td><strong>${escapeHtml(item.nama_pos)}</strong></td>
        <td><span class="status-pill neutral">bulanan</span></td>
        <td style="text-align: center;">
          <span class="badge ${item.jumlah_pegawai > 0 ? 'tone-blue' : ''}">${item.jumlah_pegawai} ASN</span>
        </td>
        <td class="money-col mono"><strong>${formatRupiah(item.total_nominal, 0)}</strong></td>
        <td style="text-align: center;">${item.is_active ? '<span class="status-pill">Aktif</span>' : '<span class="status-pill error">Nonaktif</span>'}</td>
        <td style="text-align: center;">
          <div class="pos-rekap-actions">
            <button type="button" class="pos-rekap-btn primary" data-open-pos-detail="${escapeHtml(item.pos_id)}" data-pos-nama="${escapeHtml(item.nama_pos)}" title="Lihat rincian pegawai terpotong">
              Rincian (${item.jumlah_pegawai})
            </button>
            <button type="button" class="pos-rekap-btn" data-import-pos="${escapeHtml(item.pos_id)}" title="Import Excel khusus pos ini">
              Import
            </button>
          </div>
        </td>
      </tr>
    `).join('');

    const empty = $('#rekap-bulanan-empty');
    if (empty) empty.hidden = items.length > 0;
  }

  let activeDetailPos = null;

  async function openRekapPosDetail(posId, namaPos) {
    activeDetailPos = { id: posId, nama: namaPos };
    const heading = $('#rekap-pos-detail-heading');
    if (heading) heading.textContent = namaPos;
    const meta = $('#rekap-pos-detail-meta');
    if (meta) meta.textContent = `Memuat rincian pegawai periode ${periodLabel(state.period)}...`;
    const body = $('#rekap-pos-detail-table-body');
    if (body) body.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:12px; color:#688195;">Memuat data...</td></tr>';
    const empty = $('#rekap-pos-detail-empty');
    if (empty) empty.hidden = true;
    const totalEl = $('#rekap-pos-detail-total');
    if (totalEl) totalEl.textContent = 'Total: —';

    openModal('rekap-pos-detail');

    if (!state.token) return;

    try {
      const data = await apiRequest(`/api/v1/potongan/rekap-bulanan/${encodeURIComponent(posId)}?period=${encodeURIComponent(state.period)}`);
      if (meta) meta.textContent = `${data.total_pegawai} Pegawai Terpotong • Periode ${periodLabel(state.period)}`;
      if (totalEl) totalEl.textContent = `Total: ${formatRupiah(data.total_nominal, 0)}`;

      const items = data.items || [];
      if (!items.length) {
        if (body) body.innerHTML = '';
        if (empty) empty.hidden = false;
        return;
      }

      if (body) {
        body.innerHTML = items.map((item) => `
          <tr>
            <td class="mono">${escapeHtml(item.nip)}</td>
            <td><strong>${escapeHtml(item.nama)}</strong></td>
            <td class="money-col mono">${formatRupiah(item.nominal, 0)}</td>
            <td style="text-align:center;">
              <div style="display:inline-flex; gap:4px; align-items:center;">
                <button type="button" class="pos-btn" data-jump-asn="${escapeHtml(item.nip)}" title="Buka di Potongan per ASN">
                  Lihat ASN
                </button>
                <button type="button" class="pos-btn" data-delete-detail-item="${escapeHtml(item.id)}" title="Hapus potongan pegawai ini">
                  Hapus
                </button>
              </div>
            </td>
          </tr>
        `).join('');
      }
      if (empty) empty.hidden = true;
    } catch (err) {
      if (meta) meta.textContent = `Gagal memuat: ${err.message}`;
      toast('Gagal memuat detail', err.message, 'error');
    }
  }

  async function deleteDetailItem(itemId) {
    if (!confirm('Apakah Anda yakin ingin menghapus potongan ini?')) return;
    if (!state.token) return;

    try {
      await apiRequest(`/api/v1/potongan/item/${encodeURIComponent(itemId)}`, {
        method: 'DELETE',
      });
      toast('Potongan Dihapus', 'Data potongan berhasil dihapus.', 'info');

      // Refresh detail modal
      if (activeDetailPos) {
        await openRekapPosDetail(activeDetailPos.id, activeDetailPos.nama);
      }
      // Refresh rekap bulanan & data potongan
      await loadPotonganReferenceData();
    } catch (err) {
      toast('Gagal menghapus', err.message, 'error');
    }
  }

  async function loadRekapBulanan() {
    if (state.mode !== 'api' || !state.token) return;
    try {
      const data = await apiRequest(`/api/v1/potongan/rekap-bulanan?period=${encodeURIComponent(state.period)}`);
      state.rekapBulanan = data;
      renderRekapBulanan();
    } catch (err) {
      console.warn('Gagal memuat rekap bulanan:', err);
    }
  }

  function renderRekapBerjangka() {
    const body = $('#rekap-berjangka-table-body');
    if (!body) return;

    const periodText = periodLabel(state.period);
    const labelPeriod = $('#rekap-berjangka-period-label');
    if (labelPeriod) labelPeriod.textContent = periodText;
    const subPeriod = $('#rekap-berjangka-period-sub');
    if (subPeriod) subPeriod.textContent = `Periode ${periodText}`;

    const rekap = state.rekapBerjangka;
    if (!rekap || !Array.isArray(rekap.items)) {
      const berjangkaPos = state.posList.filter((p) => p.kategori === 'berjangka');
      const totalPosEl = $('#rekap-berjangka-total-pos');
      if (totalPosEl) totalPosEl.textContent = `${berjangkaPos.length} Pos`;
      const totalPegawaiEl = $('#rekap-berjangka-total-pegawai');
      if (totalPegawaiEl) totalPegawaiEl.textContent = `0 ASN`;
      const totalNominalEl = $('#rekap-berjangka-total-nominal');
      if (totalNominalEl) totalNominalEl.textContent = `Rp 0`;

      body.innerHTML = berjangkaPos.map((pos) => `
        <tr>
          <td><strong>${escapeHtml(pos.nama_pos)}</strong></td>
          <td><span class="status-pill info">berjangka</span></td>
          <td style="text-align: center;"><span class="badge">0 ASN</span></td>
          <td class="money-col mono">Rp 0</td>
          <td style="text-align: center;">${pos.is_active ? '<span class="status-pill">Aktif</span>' : '<span class="status-pill error">Nonaktif</span>'}</td>
          <td style="text-align: center;">
            <div class="pos-rekap-actions">
              <button type="button" class="pos-rekap-btn primary" data-open-pos-berjangka-detail="${escapeHtml(pos.id)}" data-pos-nama="${escapeHtml(pos.nama_pos)}" title="Lihat rincian pegawai dengan cicilan aktif">
                Rincian
              </button>
            </div>
          </td>
        </tr>
      `).join('');

      const empty = $('#rekap-berjangka-empty');
      if (empty) empty.hidden = berjangkaPos.length > 0;
      return;
    }

    const totalPosEl = $('#rekap-berjangka-total-pos');
    if (totalPosEl) totalPosEl.textContent = `${rekap.total_pos || 0} Pos`;
    const totalPegawaiEl = $('#rekap-berjangka-total-pegawai');
    if (totalPegawaiEl) totalPegawaiEl.textContent = `${rekap.total_pegawai || 0} ASN`;
    const totalNominalEl = $('#rekap-berjangka-total-nominal');
    if (totalNominalEl) totalNominalEl.textContent = formatRupiah(rekap.total_nominal || 0, 0);

    const items = rekap.items || [];
    body.innerHTML = items.map((item) => `
      <tr>
        <td><strong>${escapeHtml(item.nama_pos)}</strong></td>
        <td><span class="status-pill info">berjangka</span></td>
        <td style="text-align: center;">
          <span class="badge ${item.jumlah_pegawai > 0 ? 'tone-blue' : ''}">${item.jumlah_pegawai} ASN</span>
        </td>
        <td class="money-col mono"><strong>${formatRupiah(item.total_nominal, 0)}</strong></td>
        <td style="text-align: center;">${item.is_active ? '<span class="status-pill">Aktif</span>' : '<span class="status-pill error">Nonaktif</span>'}</td>
        <td style="text-align: center;">
          <div class="pos-rekap-actions">
            <button type="button" class="pos-rekap-btn primary" data-open-pos-berjangka-detail="${escapeHtml(item.pos_id)}" data-pos-nama="${escapeHtml(item.nama_pos)}" title="Lihat rincian pegawai dengan cicilan aktif">
              Rincian (${item.jumlah_pegawai})
            </button>
          </div>
        </td>
      </tr>
    `).join('');

    const empty = $('#rekap-berjangka-empty');
    if (empty) empty.hidden = items.length > 0;
  }

  async function loadRekapBerjangka() {
    if (state.mode !== 'api' || !state.token) return;
    try {
      const data = await apiRequest(`/api/v1/potongan/rekap-berjangka?period=${encodeURIComponent(state.period)}`);
      state.rekapBerjangka = data;
      renderRekapBerjangka();
    } catch (err) {
      console.warn('Gagal memuat rekap berjangka:', err);
    }
  }

  async function openRekapBerjangkaDetail(posId, namaPos) {
    const heading = $('#rekap-berjangka-detail-heading');
    if (heading) heading.textContent = namaPos;
    const meta = $('#rekap-berjangka-detail-meta');
    if (meta) meta.textContent = `Memuat rincian pinjaman periode ${periodLabel(state.period)}...`;
    const body = $('#rekap-berjangka-detail-table-body');
    if (body) body.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:12px; color:#688195;">Memuat data...</td></tr>';
    const empty = $('#rekap-berjangka-detail-empty');
    if (empty) empty.hidden = true;
    const totalEl = $('#rekap-berjangka-detail-total');
    if (totalEl) totalEl.textContent = 'Total: —';

    openModal('rekap-berjangka-detail');

    if (!state.token) return;

    try {
      const data = await apiRequest(`/api/v1/potongan/rekap-berjangka/${encodeURIComponent(posId)}?period=${encodeURIComponent(state.period)}`);
      if (meta) meta.textContent = `${data.total_pegawai} Pegawai • ${data.total_pinjaman} Pinjaman Aktif • Periode ${periodLabel(state.period)}`;
      if (totalEl) totalEl.textContent = `Total: ${formatRupiah(data.total_nominal, 0)}`;

      const items = data.items || [];
      if (!items.length) {
        if (body) body.innerHTML = '';
        if (empty) empty.hidden = false;
        return;
      }

      if (body) {
        body.innerHTML = items.map((item) => `
          <tr>
            <td class="mono">${escapeHtml(item.nip)}</td>
            <td><strong>${escapeHtml(item.nama)}</strong></td>
            <td class="money-col mono">${formatRupiah(item.nominal_per_bulan, 0)}</td>
            <td style="text-align:center;">
              <span class="badge ${item.status === 'aktif' ? 'tone-green' : 'tone-blue'}">${escapeHtml(item.progres_label)}</span>
            </td>
            <td style="text-align:center;">
              <button type="button" class="pos-btn" data-jump-asn="${escapeHtml(item.nip)}" title="Buka di Potongan per ASN">
                Lihat ASN
              </button>
            </td>
          </tr>
        `).join('');
      }
      if (empty) empty.hidden = true;
    } catch (err) {
      if (meta) meta.textContent = `Gagal memuat: ${err.message}`;
      toast('Gagal memuat detail berjangka', err.message, 'error');
    }
  }

  function openImportForPos(posId) {
    openManualImport();
    const posSelect = $('#manual-pos');
    if (posSelect) posSelect.value = String(posId);
  }

  function fillPosSelect(selector, kategori) {
    const select = $(selector);
    if (!select) return;
    const current = select.value;
    const options = state.posList.filter((pos) => pos.is_active !== false && pos.kategori === kategori);
    if (!options.length) {
      select.innerHTML = `<option value="">Belum ada pos ${kategori}</option>`;
      select.disabled = true;
      return;
    }
    select.disabled = false;
    select.innerHTML = options.map((pos) => (
      `<option value="${escapeHtml(pos.id)}" data-nama="${escapeHtml(pos.nama_pos)}">${escapeHtml(pos.nama_pos)}</option>`
    )).join('');
    if (options.some((pos) => String(pos.id) === current)) select.value = current;
    else select.value = String(options[0].id);
  }

  function populatePosSelects() {
    fillPosSelect('#bulanan-pos', 'bulanan');
    fillPosSelect('#manual-pos', 'bulanan');
    fillPosSelect('#loan-pos', 'berjangka');
  }

  function mapApiPos(raw) {
    const nama = raw.nama_pos || raw.nama || '';
    return {
      id: Number(raw.id),
      opd_id: raw.opd_id == null ? null : Number(raw.opd_id),
      opd_nama: raw.opd_nama || state.opd,
      nama_pos: nama,
      nama,
      kategori: raw.kategori,
      is_active: Boolean(raw.is_active),
      created_at: raw.created_at || null,
    };
  }

  function mapApiLoan(raw) {
    return {
      id: String(raw.id),
      nip: raw.nip,
      nama: raw.nama,
      pos_id: Number(raw.pos_id),
      pos_nama: raw.pos_nama,
      opd_nama: raw.opd_nama,
      nominal_per_bulan: Number(raw.nominal_per_bulan) || 0,
      start_period: raw.start_period,
      end_period: raw.end_period,
      tenor_bulan: Number(raw.tenor_bulan) || 0,
      keterangan: raw.keterangan,
      created_by: raw.created_by,
    };
  }

  async function apiRequest(path, options = {}, tokenOverride = null) {
    const token = tokenOverride || state.token;
    if (!token) throw new Error('Token API belum diatur.');
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(apiErrorMessage(body, `Permintaan gagal (HTTP ${response.status}).`));
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  function apiErrorMessage(body, fallback) {
    const detail = body && body.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      return detail.map((item) => {
        if (typeof item === 'string') return item;
        if (item && item.msg) {
          const field = Array.isArray(item.loc) ? item.loc.filter((x) => x !== 'body').join('.') : '';
          return field ? `${field}: ${item.msg}` : item.msg;
        }
        return String(item);
      }).join('; ');
    }
    if (detail && detail.message) return detail.message;
    return fallback;
  }

  function initialsFrom(name, email) {
    const parts = String(name || email || '?').trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return String(name || email || '?').slice(0, 2).toUpperCase();
  }

  function populateProfileOpdSelect() {
    const select = $('#profile-opd-select');
    if (!select) return;
    const currentValue = select.value;
    if (!state.opdOptions.length) {
      select.innerHTML = '<option value="">Belum ada OPD terdaftar</option>';
      select.disabled = true;
      return;
    }
    select.disabled = false;
    select.innerHTML = state.opdOptions.map((opd) => (
      `<option value="${escapeHtml(opd.id)}">${escapeHtml(opd.nmskpd)}</option>`
    )).join('');
    const preferred = currentValue || (state.profile && state.profile.opd_id ? String(state.profile.opd_id) : '');
    if (state.opdOptions.some((opd) => String(opd.id) === preferred)) {
      select.value = preferred;
    } else {
      select.value = String(state.opdOptions[0].id);
    }
  }

  function isUserLocked() {
    return Boolean(state.profile && !state.profile.is_super_admin && state.profile.needs_opd);
  }

  function setAvatarElement(node, photoUrl, fallbackInitials, isIconBox = false) {
    if (!node) return;
    let src = photoUrl;
    if (src && /googleusercontent\.com/i.test(src)) {
      src = src.replace(/=s\d+(-c)?/i, '=s256-c');
    }
    if (src) {
      const fallbackAction = isIconBox
        ? 'this.parentElement.innerHTML=\'<svg class="icon"><use href="#icon-user"></use></svg>\';'
        : `this.parentElement.textContent='${escapeHtml(fallbackInitials || '—')}';`;
      node.innerHTML = `<img src="${escapeHtml(src)}" alt="Avatar" referrerpolicy="no-referrer" onerror="this.onerror=null;${fallbackAction}">`;
    } else {
      if (isIconBox) {
        node.innerHTML = '<svg class="icon"><use href="#icon-user"></use></svg>';
      } else {
        node.textContent = fallbackInitials || '—';
      }
    }
  }

  function updateProfileUI() {
    const profile = state.profile;
    const superAdmin = Boolean(profile && profile.is_super_admin);
    const isLocked = isUserLocked();

    const name = profile ? (profile.display_name || profile.email || 'Pengguna') : '—';
    const roleLabel = superAdmin ? 'Super Admin' : (isLocked ? 'Menunggu Penugasan' : 'Bendahara OPD');
    const opdLabel = superAdmin
      ? 'Tidak Terikat OPD'
      : (profile && profile.opd_name ? profile.opd_name : (isLocked ? 'Belum ditetapkan (Terkunci)' : '—'));
    const email = profile ? profile.email : '—';
    const method = 'Google Auth (Gmail)';
    const avatar = initialsFrom(name, email);
    const photo = (profile && profile.photo_url) || state.photoURL || (window.firebase && firebase.auth && firebase.auth().currentUser && firebase.auth().currentUser.photoURL) || '';

    if (photo && !state.photoURL) {
      state.photoURL = photo;
      storageSet('simgaji.photoURL', photo, localStorage);
    }

    const setText = (selector, value) => {
      const node = $(selector);
      if (node) node.textContent = value;
    };

    setText('#profile-name', name);
    setText('#profile-role', roleLabel);
    setText('#profile-opd', opdLabel);

    setAvatarElement($('#profile-avatar'), photo, avatar);
    setAvatarElement($('#start-avatar'), photo, avatar);

    setText('#profile-dialog-name', name);
    setText('#profile-dialog-email', email);
    setText('#profile-dialog-role', roleLabel);
    setText('#profile-dialog-opd', opdLabel);
    setText('#profile-dialog-method', method);
    setText('#profile-dialog-status', isLocked ? 'Belum Ada OPD (Terkunci)' : (profile ? 'Aktif' : 'Belum Login'));
    setText('#profile-dialog-isolation', superAdmin ? 'Akses Global (Lintas OPD)' : 'Isolasi OPD Terdaftar');

    const startMenuRole = $('#start-menu-role');
    if (startMenuRole) startMenuRole.textContent = superAdmin ? 'Super Administrator' : 'Bendahara OPD';

    setAvatarElement($('#profile-dialog-avatar'), photo, avatar);
    setAvatarElement($('#dashboard-welcome-avatar'), photo, null, true);

    const roleBadge = $('#profile-dialog-role');
    if (roleBadge) roleBadge.classList.toggle('super', superAdmin);
    const sidebarRole = $('#profile-role');
    if (sidebarRole) sidebarRole.classList.toggle('super', superAdmin);

    const isLoggedIn = Boolean(state.token || profile);

    // Menu Ganti OPD disembunyikan sepenuhnya untuk Super Admin dan bendahara
    const changeButton = $('#btn-profile-change-opd');
    if (changeButton) changeButton.hidden = true;
    const logoutButton = $('#btn-profile-logout');
    if (logoutButton) logoutButton.hidden = !isLoggedIn;
    const statusChange = $('#status-change-opd-btn');
    if (statusChange) statusChange.hidden = true;
    const statusLogout = $('#status-logout-btn');
    if (statusLogout) statusLogout.hidden = !isLoggedIn;

    // Sembunyikan menu operasional bendahara (Potongan Rekap, Potongan per ASN, Cetak Slip) untuk Super Admin
    // Master Gaji tetap ditampilkan untuk Super Admin (monitoring & statistik global)
    const bendaharaNavSelectors = [
      '.side-nav-item[data-view-link="potongan"]',
      '.side-nav-item[data-view-link="potongan-asn"]',
      '.side-nav-item[data-view-link="print"]',
      '#start-menu [data-view-link="potongan"]',
      '#start-menu [data-view-link="potongan-asn"]',
      '#start-menu [data-view-link="print"]',
      '#start-profile-settings',
    ];
    bendaharaNavSelectors.forEach((sel) => {
      const el = $(sel);
      if (el) el.hidden = superAdmin;
    });

    // Disable semua tombol import data gaji & potongan untuk Super Admin
    const importGajiButtons = $$(
      '#btn-master-gaji-import, ' +
      'button[data-view-link="import"], ' +
      '#btn-import, ' +
      '#file-input'
    );
    importGajiButtons.forEach((btn) => {
      btn.disabled = superAdmin;
      if (superAdmin) {
        btn.setAttribute('title', 'Super Admin tidak dapat mengimpor data gaji. Hak akses import hanya untuk Bendahara OPD.');
      } else {
        btn.removeAttribute('title');
      }
    });

    const potonganButtons = $$(
      'button[data-open-modal="manual-import"], ' +
      '#btn-run-manual-import, ' +
      'button[data-open-modal="loan"], ' +
      '#btn-save-loan, ' +
      'button[data-open-modal="pos"], ' +
      '#btn-save-pos, ' +
      '#btn-save-edit-potongan, ' +
      '#btn-save-penyesuaian, ' +
      '#btn-browse-penyesuaian-pegawai, ' +
      '#form-bulanan button[type="submit"], ' +
      '#form-penyesuaian button[type="submit"]'
    );
    potonganButtons.forEach((btn) => {
      btn.disabled = superAdmin;
      if (superAdmin) {
        btn.setAttribute('title', 'Super Admin hanya memiliki hak pantau. Pengelolaan potongan dan penyesuaian gaji dilakukan oleh Bendahara OPD.');
      } else {
        btn.removeAttribute('title');
      }
    });

    // Admin-only Master navigation in sidebar & start menu
    const navAdmin = $('#nav-admin-group');
    if (navAdmin) navAdmin.hidden = !superAdmin;
    const startAdmin = $('#start-admin-group');
    if (startAdmin) startAdmin.hidden = !superAdmin;

    // Multi-tenant lock banner for users without assigned OPD
    const lockBanner = $('#tenant-locked-banner');
    if (lockBanner) lockBanner.hidden = !isLocked;

    updateDashboardGreeting();

    // Signature settings in signature modal
    const sigJab = profile?.jabatan || storageGet('simgaji.jabatan', localStorage) || 'Bendahara Pengeluaran';
    const sigNama = profile?.nama_bendahara || storageGet('simgaji.nama_bendahara', localStorage) || '';
    const sigNip = profile?.nip_bendahara || storageGet('simgaji.nip_bendahara', localStorage) || '';

    const modalJabatan = $('#sig-modal-jabatan');
    if (modalJabatan) modalJabatan.value = sigJab;
    const modalNama = $('#sig-modal-nama');
    if (modalNama) modalNama.value = sigNama;
    const modalNip = $('#sig-modal-nip');
    if (modalNip) modalNip.value = sigNip;

    // OPD selection box di modal profil selalu disembunyikan
    const opdBox = $('#profile-opd-box');
    if (opdBox) opdBox.hidden = true;
    const addOpdBox = $('#super-admin-add-opd');
    if (addOpdBox) addOpdBox.hidden = true;
  }

  async function loadAuthProfile(token = state.token) {
    const data = await apiRequest('/api/v1/auth/me', {}, token);
    state.profile = data;
    if (data && data.photo_url) {
      state.photoURL = data.photo_url;
      storageSet('simgaji.photoURL', data.photo_url, localStorage);
    }
    updateProfileUI();
    return data;
  }

  async function loadOpdOptions() {
    if (state.mode !== 'api' || !state.token) return [];
    const data = await apiRequest('/api/v1/auth/opd-options');
    state.opdOptions = Array.isArray(data) ? data : [];
    populateProfileOpdSelect();
    return state.opdOptions;
  }

  async function openProfileDialog(changeOpd = false) {
    if (state.mode === 'api' && state.token) {
      try {
        if (!state.profile) await loadAuthProfile();
        // Super Admin tidak terikat ke OPD manapun; fitur ganti OPD dinonaktifkan
        changeOpd = false;
        if (state.profile && state.profile.needs_opd && !state.profile.is_super_admin) {
          if (!state.opdOptions.length) await loadOpdOptions();
        }
      } catch (error) {
        toast('Gagal memuat profil', error.message, 'error');
      }
    } else {
      changeOpd = false;
    }

    state.profileChangeMode = Boolean(
      !state.profile?.is_super_admin && (changeOpd || (state.mode === 'api' && state.profile && state.profile.needs_opd)),
    );
    const error = $('#profile-error');
    if (error) error.hidden = true;
    updateProfileUI();
    openModal('profile');
  }

  async function saveProfileOpd() {
    if (state.mode !== 'api' || !state.token) return;
    const select = $('#profile-opd-select');
    const opdId = Number(select ? select.value : 0);
    const error = $('#profile-error');
    if (error) error.hidden = true;
    if (!Number.isInteger(opdId) || opdId <= 0) {
      if (error) {
        error.textContent = 'Pilih OPD terlebih dahulu.';
        error.hidden = false;
      }
      return;
    }

    const button = $('#btn-save-profile-opd');
    if (button) button.disabled = true;
    try {
      const profile = await apiRequest('/api/v1/auth/me/opd', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opd_id: opdId }),
      });
      state.profile = profile;
      state.opd = profile.opd_name || state.opd;
      state.opdRaw = profile.opd_name || '';
      state.profileChangeMode = false;
      updateProfileUI();
      toast('OPD diperbarui', profile.opd_name || 'OPD aktif tersimpan.', 'success');
      closeModal();
      const dashboard = await loadApiData(state.token);
      applyApiData(dashboard, state.token);
      await loadAuthProfile(state.token);
    } catch (caught) {
      if (error) {
        error.textContent = caught.message || 'Gagal menyimpan OPD.';
        error.hidden = false;
      }
    } finally {
      if (button) button.disabled = false;
    }
  }

  function openSignatureModal() {
    const currentJabatan = state.profile?.jabatan || storageGet('simgaji.jabatan', localStorage) || 'Bendahara Pengeluaran';
    const currentNama = state.profile?.nama_bendahara || storageGet('simgaji.nama_bendahara', localStorage) || '';
    const currentNip = state.profile?.nip_bendahara || storageGet('simgaji.nip_bendahara', localStorage) || '';

    const jabatanInput = $('#sig-modal-jabatan');
    if (jabatanInput) jabatanInput.value = currentJabatan;
    const namaInput = $('#sig-modal-nama');
    if (namaInput) namaInput.value = currentNama;
    const nipInput = $('#sig-modal-nip');
    if (nipInput) nipInput.value = currentNip;

    const error = $('#sig-modal-error');
    if (error) error.hidden = true;

    openModal('signature-settings');
    setTimeout(() => {
      if (!currentNama && namaInput) namaInput.focus();
      else if (jabatanInput) jabatanInput.focus();
    }, 60);
  }

  async function saveSignatureModal() {
    const btn = $('#btn-save-signature-modal');
    const jabatanInput = $('#sig-modal-jabatan');
    const namaInput = $('#sig-modal-nama');
    const nipInput = $('#sig-modal-nip');

    const jabatan = (jabatanInput ? jabatanInput.value : '').trim() || 'Bendahara Pengeluaran';
    const nama_bendahara = (namaInput ? namaInput.value : '').trim() || null;
    const nip_bendahara = (nipInput ? nipInput.value : '').trim() || null;

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Menyimpan...';
    }

    if (!state.profile) state.profile = {};
    state.profile.jabatan = jabatan;
    state.profile.nama_bendahara = nama_bendahara;
    state.profile.nip_bendahara = nip_bendahara;

    storageSet('simgaji.jabatan', jabatan, localStorage);
    if (nama_bendahara) storageSet('simgaji.nama_bendahara', nama_bendahara, localStorage);
    else storageRemove('simgaji.nama_bendahara', localStorage);
    if (nip_bendahara) storageSet('simgaji.nip_bendahara', nip_bendahara, localStorage);
    else storageRemove('simgaji.nip_bendahara', localStorage);

    if (state.mode === 'api' && state.token) {
      try {
        const updated = await apiRequest('/api/v1/auth/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jabatan,
            nama_bendahara,
            nip_bendahara,
          }),
        });
        state.profile.jabatan = updated.jabatan;
        state.profile.nama_bendahara = updated.nama_bendahara;
        state.profile.nip_bendahara = updated.nip_bendahara;
      } catch (err) {
        console.warn('Gagal sinkronisasi pengaturan ke backend:', err);
      }
    }

    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Simpan & Terapkan';
    }

    closeModal();
    toast('Tanda Tangan Disimpan', 'Data penandatangan bendahara berhasil disimpan dan diterapkan ke slip cetak.', 'success');
    renderPrintPreview();
  }

  async function addOpd() {
    if (state.mode !== 'api' || !state.token) return;
    const input = $('#new-opd-name');
    const name = input ? input.value.trim() : '';
    const error = $('#profile-error');
    if (error) error.hidden = true;
    if (!name || name.length < 3) {
      if (error) {
        error.textContent = 'Nama OPD minimal 3 karakter.';
        error.hidden = false;
      }
      return;
    }
    const button = $('#btn-add-opd');
    if (button) button.disabled = true;
    try {
      const created = await apiRequest('/api/v1/auth/opd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nmskpd: name }),
      });
      if (input) input.value = '';
      await loadOpdOptions();
      const select = $('#profile-opd-select');
      if (select) select.value = String(created.id);
      toast('OPD Terdaftar', `OPD "${created.nmskpd}" berhasil ditambahkan.`, 'success');
    } catch (caught) {
      if (error) {
        error.textContent = caught.message || 'Gagal menambahkan OPD.';
        error.hidden = false;
      }
    } finally {
      if (button) button.disabled = false;
    }
  }

  /* ============================== MASTER DATA CONTROLLER ============================== */

  async function loadMasterOpd() {
    if (state.mode !== 'api' || !state.token) {
      state.masterOpdList = [];
      renderMasterOpdTable();
      return;
    }
    try {
      setStatus('Memuat data master OPD…');
      const list = await apiRequest('/api/v1/master/opd');
      state.masterOpdList = Array.isArray(list) ? list : [];
      renderMasterOpdTable();
      setStatus(`Master OPD siap (${state.masterOpdList.length} OPD).`);
    } catch (error) {
      toast('Gagal memuat Master OPD', error.message, 'error');
      setStatus('Gagal memuat Master OPD.');
    }
  }

  function renderMasterOpdTable() {
    const tbody = $('#master-opd-tbody');
    const empty = $('#master-opd-empty');
    const countNode = $('#master-opd-count');
    if (!tbody) return;

    const query = (state.masterOpdFilter || '').trim().toLowerCase();
    const filtered = state.masterOpdList.filter((opd) => {
      if (!query) return true;
      return (opd.nmskpd || '').toLowerCase().includes(query) || String(opd.id).includes(query);
    });

    filtered.sort((a, b) => {
      const nameA = (a.nmskpd || '').trim().toLowerCase();
      const nameB = (b.nmskpd || '').trim().toLowerCase();
      return nameA.localeCompare(nameB, 'id');
    });

    if (countNode) countNode.textContent = `${filtered.length} dari ${state.masterOpdList.length} OPD`;

    if (!filtered.length) {
      tbody.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    tbody.innerHTML = filtered.map((opd, index) => {
      const createdStr = opd.created_at ? new Date(opd.created_at).toLocaleDateString('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric'
      }) : '—';
      return `
        <tr data-opd-id="${escapeHtml(opd.id)}">
          <td style="text-align: center;">${index + 1}</td>
          <td><strong>${escapeHtml(opd.nmskpd)}</strong></td>
          <td style="text-align: center;"><span class="pill-soft">${opd.user_count || 0} akun</span></td>
          <td style="text-align: center;"><span class="pill-soft">${(opd.payroll_count || 0).toLocaleString('id-ID')} baris</span></td>
          <td>${createdStr}</td>
          <td style="text-align: center; white-space: nowrap;">
            <button type="button" class="btn-table-action btn-table-manage" data-action="edit-opd" data-id="${opd.id}" title="Kelola / Ubah Nama OPD">
              <svg class="icon"><use href="#icon-edit"></use></svg>
              Kelola
            </button>
            <button type="button" class="btn-table-action btn-table-danger" data-action="delete-opd" data-id="${opd.id}" data-name="${escapeHtml(opd.nmskpd)}" title="Hapus OPD">
              <svg class="icon"><use href="#icon-trash"></use></svg>
              Hapus
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function openMasterOpdModal(opd = null) {
    state.editingOpdId = opd ? opd.id : null;
    const title = $('#modal-master-opd-title');
    if (title) title.textContent = opd ? `Ubah Nama OPD #${opd.id}` : 'Tambah OPD Baru';
    const input = $('#master-opd-name');
    if (input) input.value = opd ? opd.nmskpd : '';
    const error = $('#master-opd-error');
    if (error) error.hidden = true;
    openModal('master-opd');
  }

  async function saveMasterOpd() {
    if (state.mode !== 'api' || !state.token) return;
    const input = $('#master-opd-name');
    const name = input ? input.value.trim() : '';
    const error = $('#master-opd-error');
    if (error) error.hidden = true;

    if (!name || name.length < 3) {
      if (error) {
        error.textContent = 'Nama OPD minimal 3 karakter.';
        error.hidden = false;
      }
      return;
    }

    const button = $('#btn-save-master-opd');
    if (button) button.disabled = true;

    try {
      if (state.editingOpdId) {
        await apiRequest(`/api/v1/master/opd/${state.editingOpdId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nmskpd: name }),
        });
        toast('OPD Diperbarui', `Nama OPD berhasil diubah menjadi "${name}".`, 'success');
      } else {
        await apiRequest('/api/v1/master/opd', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nmskpd: name }),
        });
        toast('OPD Terdaftar', `OPD "${name}" berhasil ditambahkan.`, 'success');
      }
      closeModal();
      await loadMasterOpd();
      await loadOpdOptions();
    } catch (caught) {
      if (error) {
        error.textContent = caught.message || 'Gagal menyimpan OPD.';
        error.hidden = false;
      }
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function deleteMasterOpd(opdId, opdName) {
    if (!window.confirm(`Yakin ingin menghapus OPD "${opdName}"?\n\nPerhatian: OPD yang memiliki data pegawai atau riwayat payroll tidak dapat dihapus.`)) {
      return;
    }
    try {
      setStatus(`Menghapus OPD "${opdName}"…`);
      const res = await apiRequest(`/api/v1/master/opd/${opdId}`, {
        method: 'DELETE',
      });
      toast('OPD Dihapus', res.message || `OPD "${opdName}" berhasil dihapus.`, 'success');
      await loadMasterOpd();
      await loadOpdOptions();
    } catch (error) {
      toast('Gagal Menghapus OPD', error.message, 'error');
    }
  }

  function openMasterOpdImportModal() {
    if (state.mode !== 'api' || !state.token) return;
    const fileInput = $('#master-opd-import-file');
    if (fileInput) fileInput.value = '';
    const error = $('#master-opd-import-error');
    if (error) error.hidden = true;
    openModal('master-opd-import');
  }

  async function submitMasterOpdImport() {
    if (state.mode !== 'api' || !state.token) return;
    const fileInput = $('#master-opd-import-file');
    const error = $('#master-opd-import-error');
    const submitBtn = $('#btn-submit-import-opd');
    if (error) error.hidden = true;

    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
      if (error) {
        error.textContent = 'Pilih file Excel (.xlsx / .xls) terlebih dahulu.';
        error.hidden = false;
      }
      return;
    }

    const file = fileInput.files[0];
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls'].includes(ext)) {
      if (error) {
        error.textContent = 'Format berkas harus .xlsx atau .xls.';
        error.hidden = false;
      }
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Mengimpor…';
    }

    try {
      const res = await apiRequest('/api/v1/master/opd/import', {
        method: 'POST',
        body: formData,
      });

      closeModal();
      toast('Import OPD Berhasil', res.message || `${res.imported} OPD baru ditambahkan, ${res.skipped} dilewati.`, 'success');
      await loadMasterOpd();
      await loadOpdOptions();
    } catch (caught) {
      if (error) {
        error.textContent = caught.message || 'Gagal mengimpor data OPD.';
        error.hidden = false;
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<svg class="icon"><use href="#icon-upload"></use></svg> Mulai Import';
      }
    }
  }

  function openMasterOpdPrintModal() {
    if (state.mode !== 'api' || !state.token) return;

    const adminInput = $('#master-opd-print-admin');
    const dateInput = $('#master-opd-print-date');
    const titleInput = $('#master-opd-print-title-input');
    const summaryNode = $('#master-opd-print-summary');
    const error = $('#master-opd-print-error');

    if (error) error.hidden = true;

    const curAdminName = state.profile?.display_name || state.profile?.nama_bendahara || state.profile?.email || 'Super Admin';
    const curAdminEmail = state.profile?.email || 'teguhe@gmail.com';

    if (adminInput) adminInput.value = `${curAdminName} (${curAdminEmail})`;
    if (dateInput) dateInput.value = formatIndonesianDateTime(new Date());
    if (titleInput && !titleInput.value) {
      titleInput.value = 'DAFTAR ORGANISASI PERANGKAT DAERAH (OPD)';
    }

    if (summaryNode) {
      summaryNode.innerHTML = `Siap mencetak <strong>${state.masterOpdList.length}</strong> data OPD Pemerintah Kota Salatiga.`;
    }

    openModal('master-opd-print');
  }

  async function doPrintMasterOpd() {
    if (state.mode !== 'api' || !state.token) return;

    const adminInput = $('#master-opd-print-admin');
    const dateInput = $('#master-opd-print-date');
    const titleInput = $('#master-opd-print-title-input');
    const errorNode = $('#master-opd-print-error');
    const btnPrint = $('#btn-do-print-master-opd');

    if (errorNode) errorNode.hidden = true;

    const opdList = [...state.masterOpdList].sort((a, b) => {
      const nameA = (a.nmskpd || '').trim().toLowerCase();
      const nameB = (b.nmskpd || '').trim().toLowerCase();
      return nameA.localeCompare(nameB, 'id');
    });

    if (!opdList.length) {
      if (errorNode) {
        errorNode.textContent = 'Belum ada data OPD yang dapat dicetak.';
        errorNode.hidden = false;
      }
      return;
    }

    const title = titleInput?.value.trim() || 'DAFTAR ORGANISASI PERANGKAT DAERAH (OPD)';
    const printDate = dateInput?.value.trim() || formatIndonesianDateTime(new Date());
    const adminName = state.profile?.display_name || state.profile?.nama_bendahara || 'Super Admin';
    const adminEmail = state.profile?.email || 'teguhe@gmail.com';

    if (btnPrint) btnPrint.disabled = true;

    try {
      // 1. Catat log ke server (AuditLog)
      await apiRequest('/api/v1/master/opd/print-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          total_opd: opdList.length,
          print_date: printDate,
          title: title,
        }),
      });

      closeModal();
      toast('Laporan OPD Dicetak', `${opdList.length} data OPD siap dicetak. Aksi dicatat dalam log audit.`, 'info');

      // 2. Buat dokumen jendela cetak
      const win = window.open('', '_blank', 'width=1100,height=750');
      if (!win) {
        toast('Popup Diblokir', 'Mohon izinkan pop-up peramban untuk mencetak laporan.', 'error');
        return;
      }

      const now = new Date();
      const cityDate = `${now.getDate()} ${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;

      const rowsHtml = opdList.map((opd, idx) => {
        const created = opd.created_at ? new Date(opd.created_at).toLocaleDateString('id-ID', {
          day: '2-digit', month: 'short', year: 'numeric'
        }) : '—';
        const userCount = Number(opd.user_count) || 0;
        const payrollCount = Number(opd.payroll_count) || 0;

        return `
          <tr>
            <td class="text-center">${idx + 1}</td>
            <td><strong>${escapeHtml(opd.nmskpd)}</strong></td>
            <td class="text-center">${userCount} akun</td>
            <td class="text-center">${payrollCount.toLocaleString('id-ID')} baris</td>
            <td class="text-center">${escapeHtml(created)}</td>
          </tr>
        `;
      }).join('');

      const docHtml = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 12mm 15mm 12mm 15mm;
    }
    * { box-sizing: border-box; }
    body {
      font-family: Arial, "Helvetica Neue", sans-serif;
      font-size: 9pt;
      color: #111;
      margin: 0;
      padding: 0;
      line-height: 1.35;
    }
    .header-wrap {
      text-align: center;
      border-bottom: 2.5px solid #000;
      padding-bottom: 6px;
      margin-bottom: 12px;
    }
    .header-wrap h1 {
      margin: 0;
      font-size: 13pt;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .header-wrap h2 {
      margin: 3px 0 0;
      font-size: 10.5pt;
      font-weight: 600;
      letter-spacing: 0.3px;
      text-transform: uppercase;
      color: #0b3d62;
    }
    .header-wrap p {
      margin: 3px 0 0;
      font-size: 8.5pt;
      color: #444;
    }
    .meta-box {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
      font-size: 8.5pt;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
    }
    .meta-box td {
      padding: 4px 8px;
      vertical-align: top;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.5pt;
      margin-bottom: 16px;
    }
    .data-table th, .data-table td {
      border: 1px solid #475569;
      padding: 5px 6px;
      vertical-align: middle;
    }
    .data-table th {
      background-color: #e2e8f0;
      font-weight: 700;
      text-align: center;
      color: #0f172a;
    }
    .data-table tr:nth-child(even) {
      background-color: #f8fafc;
    }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .footer-block {
      margin-top: 14px;
      display: flex;
      justify-content: flex-end;
      page-break-inside: avoid;
    }
    .sign-box {
      width: 65mm;
      text-align: center;
      font-size: 9pt;
    }
    .sign-space { height: 16mm; }
    .sign-name { font-weight: 700; text-decoration: underline; }
    .sign-role { font-size: 8pt; color: #333; margin-top: 2px; }
    .print-note {
      margin-top: 20px;
      font-size: 7.5pt;
      color: #64748b;
      border-top: 1px dashed #cbd5e1;
      padding-top: 4px;
      display: flex;
      justify-content: space-between;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="header-wrap">
    <h1>PEMERINTAH KOTA SALATIGA</h1>
    <h2>${escapeHtml(title)}</h2>
    <p>Aplikasi Penggajian dan Cetak Slip Gaji ASN • Modul Master OPD (Landscape)</p>
  </div>
  <table class="meta-box">
    <tr>
      <td style="width: 160px;"><strong>Tanggal &amp; Waktu Cetak</strong></td>
      <td style="width: 8px;">:</td>
      <td style="width: 38%;">${escapeHtml(printDate)}</td>
      <td style="width: 160px;"><strong>Admin yang Mencetak</strong></td>
      <td style="width: 8px;">:</td>
      <td><strong>${escapeHtml(adminName)}</strong> (${escapeHtml(adminEmail)})</td>
    </tr>
    <tr>
      <td><strong>Kategori Dokumen</strong></td>
      <td>:</td>
      <td>Master Organisasi Perangkat Daerah (Multi-tenant • Format Landscape)</td>
      <td><strong>Total Data OPD</strong></td>
      <td>:</td>
      <td><strong>${opdList.length}</strong> OPD Terdaftar</td>
    </tr>
  </table>
  <table class="data-table">
    <thead>
      <tr>
        <th style="width: 36px;">No</th>
        <th>Nama Organisasi Perangkat Daerah (OPD)</th>
        <th style="width: 140px;">Pengguna Terhubung</th>
        <th style="width: 160px;">Data Gaji Bulanan</th>
        <th style="width: 130px;">Tanggal Terdaftar</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
  <div class="footer-block">
    <div class="sign-box">
      <div>Salatiga, ${escapeHtml(cityDate)}</div>
      <div style="font-weight: 600; margin-top: 3px;">Admin yang Mencetak,</div>
      <div class="sign-space"></div>
      <div class="sign-name">${escapeHtml(adminName)}</div>
      <div class="sign-role">${escapeHtml(adminEmail)}</div>
    </div>
  </div>
  <div class="print-note">
    <span>Dicetak melalui Aplikasi Penggajian dan Cetak Slip Gaji ASN • Dokumen Resmi Internal Pemerintah Kota Salatiga</span>
    <span>ID Sesi / Tanggal: ${escapeHtml(printDate)}</span>
  </div>
</body>
</html>`;

      win.document.open();
      win.document.write(docHtml);
      win.document.close();
      win.onload = () => {
        win.focus();
        win.print();
      };
    } catch (caught) {
      if (errorNode) {
        errorNode.textContent = caught.message || 'Gagal mencatat log cetak atau mencetak dokumen OPD.';
        errorNode.hidden = false;
      }
    } finally {
      if (btnPrint) btnPrint.disabled = false;
    }
  }

  async function loadMasterUsers() {
    if (state.mode !== 'api' || !state.token) {
      state.masterUserList = [];
      renderMasterUsersTable();
      return;
    }
    try {
      setStatus('Memuat data master pengguna…');
      if (!state.opdOptions.length) await loadOpdOptions();
      const list = await apiRequest('/api/v1/master/users');
      state.masterUserList = Array.isArray(list) ? list : [];
      renderMasterUsersTable();
      setStatus(`Master Pengguna siap (${state.masterUserList.length} pengguna).`);
    } catch (error) {
      toast('Gagal memuat Master Pengguna', error.message, 'error');
      setStatus('Gagal memuat Master Pengguna.');
    }
  }

  function renderMasterUsersTable() {
    const tbody = $('#master-user-tbody');
    const empty = $('#master-user-empty');
    const countNode = $('#master-user-count');
    if (!tbody) return;

    const query = (state.masterUserFilter || '').trim().toLowerCase();
    const roleFilter = state.masterUserRoleFilter || 'all';

    const filtered = state.masterUserList.filter((u) => {
      if (roleFilter === 'super_admin' && u.role !== 'super_admin') return false;
      if (roleFilter === 'bendahara_opd' && u.role !== 'bendahara_opd') return false;
      if (roleFilter === 'unassigned' && (u.opd_id || u.role === 'super_admin')) return false;

      if (!query) return true;
      return (
        (u.email || '').toLowerCase().includes(query) ||
        (u.display_name || '').toLowerCase().includes(query) ||
        (u.opd_name || '').toLowerCase().includes(query)
      );
    });

    if (countNode) countNode.textContent = `${filtered.length} dari ${state.masterUserList.length} pengguna`;

    if (!filtered.length) {
      tbody.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    tbody.innerHTML = filtered.map((u) => {
      const isSuper = u.role === 'super_admin';
      const isDefault = Boolean(u.is_default_super_admin);
      const roleBadge = isSuper
        ? `<span class="badge-role super">Super Admin</span>`
        : `<span class="badge-role bendahara">Bendahara OPD</span>`;

      let opdDisplay = '';
      if (u.opd_name) {
        opdDisplay = `<strong>${escapeHtml(u.opd_name)}</strong>`;
      } else if (isSuper) {
        opdDisplay = `<span class="pill-soft">Semua OPD (Akses Global)</span>`;
      } else {
        opdDisplay = `<span class="badge-opd-unassigned"><svg class="icon"><use href="#icon-lock"></use></svg> Belum Ada OPD (Terkunci)</span>`;
      }

      const statusBadge = u.is_active
        ? `<span class="badge-status active">Aktif</span>`
        : `<span class="badge-status inactive">Nonaktif</span>`;

      const defaultTag = isDefault
        ? `<span class="badge-default-super" title="Super Admin Bawaan (Locked)">Bawaan</span>`
        : '';

      const createdStr = u.created_at ? new Date(u.created_at).toLocaleDateString('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric'
      }) : '—';

      return `
        <tr data-user-id="${escapeHtml(u.id)}">
          <td>
            <strong>${escapeHtml(u.email)}</strong>${defaultTag}
          </td>
          <td>${escapeHtml(u.display_name || '—')}</td>
          <td>${roleBadge}</td>
          <td>${opdDisplay}</td>
          <td style="text-align: center;">${statusBadge}</td>
          <td>${createdStr}</td>
          <td style="text-align: center; white-space: nowrap;">
            <button type="button" class="btn-table-action btn-table-manage" data-action="manage-user" data-id="${u.id}" title="Kelola Penugasan OPD & Role">
              <svg class="icon"><use href="#icon-edit"></use></svg>
              Kelola
            </button>
            ${!isDefault ? `
              ${isSuper ? `
                <button type="button" class="btn-table-action btn-table-demote" data-action="toggle-role-user" data-id="${u.id}" data-current-role="${u.role}" title="Turunkan peran menjadi Bendahara OPD">
                  <svg class="icon"><use href="#icon-user"></use></svg>
                  Demosi
                </button>
              ` : `
                <button type="button" class="btn-table-action btn-table-promote" data-action="toggle-role-user" data-id="${u.id}" data-current-role="${u.role}" title="Promosikan menjadi Super Admin">
                  <svg class="icon"><use href="#icon-shield"></use></svg>
                  Promosi
                </button>
              `}
              <button type="button" class="btn-table-action btn-table-danger" data-action="delete-user" data-id="${u.id}" data-email="${escapeHtml(u.email)}" title="Hapus Pengguna">
                <svg class="icon"><use href="#icon-trash"></use></svg>
                Hapus
              </button>
            ` : `
              <span class="pill-soft" style="font-size: 10px; color: #9a3412; background: #ffedd5; border: 1px solid #fed7aa; font-weight: 600;">Dilindungi</span>
            `}
          </td>
        </tr>
      `;
    }).join('');
  }

  function openMasterUserModal(user) {
    state.editingUserId = user.id;
    const isDefault = Boolean(user.is_default_super_admin);

    const emailNode = $('#master-user-modal-email');
    if (emailNode) emailNode.textContent = user.email;
    const nameNode = $('#master-user-modal-name');
    if (nameNode) nameNode.textContent = user.display_name || '—';
    const joinedNode = $('#master-user-modal-joined');
    if (joinedNode) joinedNode.textContent = user.created_at ? new Date(user.created_at).toLocaleString('id-ID') : '—';
    const typeNode = $('#master-user-modal-type');
    if (typeNode) typeNode.textContent = isDefault ? 'Super User Bawaan (Locked)' : 'Pengguna Terdaftar';

    const roleSelect = $('#master-user-modal-role');
    if (roleSelect) {
      roleSelect.value = user.role;
      roleSelect.disabled = isDefault;
    }

    const opdSelect = $('#master-user-modal-opd');
    if (opdSelect) {
      let optionsHtml = '<option value="">-- Belum Ditugaskan (Akses Dikunci) --</option>';
      state.opdOptions.forEach((opd) => {
        optionsHtml += `<option value="${escapeHtml(opd.id)}">${escapeHtml(opd.nmskpd)}</option>`;
      });
      opdSelect.innerHTML = optionsHtml;
      opdSelect.value = user.opd_id ? String(user.opd_id) : '';
    }

    const activeCheck = $('#master-user-modal-active');
    if (activeCheck) {
      activeCheck.checked = Boolean(user.is_active);
      activeCheck.disabled = isDefault;
    }

    const lockNote = $('#master-user-modal-lock-note');
    if (lockNote) lockNote.hidden = !isDefault;

    const error = $('#master-user-error');
    if (error) error.hidden = true;

    openModal('master-user');
  }

  async function saveMasterUser() {
    if (state.mode !== 'api' || !state.token || !state.editingUserId) return;
    const roleSelect = $('#master-user-modal-role');
    const opdSelect = $('#master-user-modal-opd');
    const activeCheck = $('#master-user-modal-active');
    const error = $('#master-user-error');
    if (error) error.hidden = true;

    const role = roleSelect ? roleSelect.value : null;
    const opdVal = opdSelect ? opdSelect.value : '';
    const isActive = activeCheck ? activeCheck.checked : true;

    const payload = {};
    if (roleSelect && !roleSelect.disabled) payload.role = role;
    if (activeCheck && !activeCheck.disabled) payload.is_active = isActive;

    if (opdVal) {
      payload.opd_id = Number(opdVal);
      payload.clear_opd = false;
    } else {
      payload.clear_opd = true;
    }

    const button = $('#btn-save-master-user');
    if (button) button.disabled = true;

    try {
      await apiRequest(`/api/v1/master/users/${state.editingUserId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      toast('Pengguna Diperbarui', 'Pengaturan peran dan OPD pengguna berhasil disimpan.', 'success');
      closeModal();
      await loadMasterUsers();
    } catch (caught) {
      if (error) {
        error.textContent = caught.message || 'Gagal menyimpan data pengguna.';
        error.hidden = false;
      }
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function toggleMasterUserRole(userId, currentRole) {
    const newRole = currentRole === 'super_admin' ? 'bendahara_opd' : 'super_admin';
    const actionLabel = newRole === 'super_admin' ? 'Promosikan menjadi Super Admin' : 'Turunkan menjadi Bendahara OPD';

    if (!window.confirm(`Konfirmasi: ${actionLabel}?`)) return;

    try {
      setStatus(`Mengubah role pengguna…`);
      await apiRequest(`/api/v1/master/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      toast('Role Diperbarui', `Role pengguna berhasil diubah menjadi ${newRole === 'super_admin' ? 'Super Admin' : 'Bendahara OPD'}.`, 'success');
      await loadMasterUsers();
    } catch (error) {
      toast('Gagal Mengubah Role', error.message, 'error');
    }
  }

  async function deleteMasterUser(userId, email) {
    if (!window.confirm(`Hapus pengguna "${email}"?\n\nPengguna ini tidak akan bisa login lagi ke sistem.`)) {
      return;
    }
    try {
      setStatus(`Menghapus pengguna "${email}"…`);
      const res = await apiRequest(`/api/v1/master/users/${userId}`, {
        method: 'DELETE',
      });
      toast('Pengguna Dihapus', res.message || `Pengguna "${email}" berhasil dihapus.`, 'success');
      await loadMasterUsers();
    } catch (error) {
      toast('Gagal Menghapus Pengguna', error.message, 'error');
    }
  }

  async function openMasterUserAddModal() {
    if (state.mode !== 'api' || !state.token) return;
    if (!state.opdOptions.length) await loadOpdOptions();

    const emailInput = $('#master-user-add-email');
    if (emailInput) emailInput.value = '';
    const nameInput = $('#master-user-add-name');
    if (nameInput) nameInput.value = '';

    const opdSelect = $('#master-user-add-opd');
    if (opdSelect) {
      let optionsHtml = '<option value="">-- Pilih OPD Penugasan --</option>';
      state.opdOptions.forEach((opd) => {
        optionsHtml += `<option value="${escapeHtml(opd.id)}">${escapeHtml(opd.nmskpd)}</option>`;
      });
      opdSelect.innerHTML = optionsHtml;
      opdSelect.value = '';
    }

    const error = $('#master-user-add-error');
    if (error) error.hidden = true;

    openModal('master-user-add');
  }

  async function saveMasterUserAdd() {
    if (state.mode !== 'api' || !state.token) return;

    const emailInput = $('#master-user-add-email');
    const nameInput = $('#master-user-add-name');
    const opdSelect = $('#master-user-add-opd');
    const error = $('#master-user-add-error');
    if (error) error.hidden = true;

    const email = emailInput ? emailInput.value.trim() : '';
    const name = nameInput ? nameInput.value.trim() : '';
    const opdId = opdSelect ? Number(opdSelect.value) : 0;

    if (!email || !email.includes('@') || !email.includes('.')) {
      if (error) {
        error.textContent = 'Masukkan alamat email yang valid.';
        error.hidden = false;
      }
      return;
    }

    if (!opdId || opdId <= 0) {
      if (error) {
        error.textContent = 'Pilih OPD penugasan bendahara.';
        error.hidden = false;
      }
      return;
    }

    const button = $('#btn-save-new-user');
    if (button) button.disabled = true;

    try {
      const created = await apiRequest('/api/v1/master/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          opd_id: opdId,
          display_name: name || null,
        }),
      });

      toast('Pengguna Ditambahkan', `Bendahara "${created.email}" berhasil didaftarkan untuk OPD "${created.opd_name}".`, 'success');
      closeModal();
      await loadMasterUsers();
    } catch (caught) {
      if (error) {
        error.textContent = caught.message || 'Gagal menambahkan pengguna.';
        error.hidden = false;
      }
    } finally {
      if (button) button.disabled = false;
    }
  }

  function formatIndonesianDateTime(d = new Date()) {
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const dayName = days[d.getDay()];
    const dateNum = d.getDate();
    const monthName = MONTH_NAMES[d.getMonth()] || '';
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    const secs = String(d.getSeconds()).padStart(2, '0');
    return `${dayName}, ${dateNum} ${monthName} ${year} ${hours}:${mins}:${secs} WIB`;
  }

  function getFilteredMasterUsersForPrint() {
    const roleFilter = $('#master-user-print-role')?.value || 'all';
    const statusFilter = $('#master-user-print-status')?.value || 'all';

    return state.masterUserList.filter((u) => {
      if (roleFilter === 'super_admin' && u.role !== 'super_admin') return false;
      if (roleFilter === 'bendahara_opd' && u.role !== 'bendahara_opd') return false;
      if (roleFilter === 'unassigned' && (u.opd_id || u.role === 'super_admin')) return false;

      if (statusFilter === 'active' && !u.is_active) return false;
      if (statusFilter === 'inactive' && u.is_active) return false;

      return true;
    });
  }

  function updateMasterUserPrintSummary() {
    const summaryNode = $('#master-user-print-summary');
    if (!summaryNode) return;
    const users = getFilteredMasterUsersForPrint();
    summaryNode.innerHTML = `Siap mencetak <strong>${users.length}</strong> akun pengguna dari total <strong>${state.masterUserList.length}</strong> pengguna terdaftar.`;
  }

  function openMasterUserPrintModal() {
    if (state.mode !== 'api' || !state.token) return;

    const adminInput = $('#master-user-print-admin');
    const dateInput = $('#master-user-print-date');
    const titleInput = $('#master-user-print-title-input');
    const roleSelect = $('#master-user-print-role');
    const statusSelect = $('#master-user-print-status');
    const errorNode = $('#master-user-print-error');

    if (errorNode) errorNode.hidden = true;

    const curAdminName = state.profile?.display_name || state.profile?.nama_bendahara || state.profile?.email || 'Super Admin';
    const curAdminEmail = state.profile?.email || 'teguhe@gmail.com';

    if (adminInput) adminInput.value = `${curAdminName} (${curAdminEmail})`;
    if (dateInput) dateInput.value = formatIndonesianDateTime(new Date());
    if (titleInput && !titleInput.value) {
      titleInput.value = 'DAFTAR AKUN PENGGUNA & HAK AKSES SISTEM PENGGAJIAN ASN';
    }
    if (roleSelect) roleSelect.value = state.masterUserRoleFilter || 'all';
    if (statusSelect) statusSelect.value = 'all';

    updateMasterUserPrintSummary();
    openModal('master-user-print');
  }

  async function doPrintMasterUsers() {
    if (state.mode !== 'api' || !state.token) return;

    const adminInput = $('#master-user-print-admin');
    const dateInput = $('#master-user-print-date');
    const titleInput = $('#master-user-print-title-input');
    const roleSelect = $('#master-user-print-role');
    const statusSelect = $('#master-user-print-status');
    const errorNode = $('#master-user-print-error');
    const btnPrint = $('#btn-do-print-master-user');

    if (errorNode) errorNode.hidden = true;

    const users = getFilteredMasterUsersForPrint();
    if (!users.length) {
      if (errorNode) {
        errorNode.textContent = 'Tidak ada data pengguna yang memenuhi kriteria filter.';
        errorNode.hidden = false;
      }
      return;
    }

    const title = titleInput?.value.trim() || 'DAFTAR AKUN PENGGUNA & HAK AKSES SISTEM PENGGAJIAN ASN';
    const printDate = dateInput?.value.trim() || formatIndonesianDateTime(new Date());
    const adminName = state.profile?.display_name || state.profile?.nama_bendahara || 'Super Admin';
    const adminEmail = state.profile?.email || 'teguhe@gmail.com';
    const roleFilter = roleSelect?.value || 'all';
    const statusFilter = statusSelect?.value || 'all';

    const roleLabels = {
      all: 'Semua Peran',
      super_admin: 'Super Admin Saja',
      bendahara_opd: 'Bendahara OPD Saja',
      unassigned: 'Belum Ada OPD (Terkunci)',
    };
    const statusLabels = {
      all: 'Semua Status',
      active: 'Hanya Akun Aktif',
      inactive: 'Hanya Akun Nonaktif',
    };

    if (btnPrint) btnPrint.disabled = true;

    try {
      // 1. Catat log ke server (AuditLog)
      await apiRequest('/api/v1/master/users/print-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          total_users: users.length,
          filter_role: roleFilter,
          filter_status: statusFilter,
          print_date: printDate,
          title: title,
        }),
      });

      closeModal();
      toast('Laporan Pengguna Dicetak', `${users.length} akun pengguna siap dicetak. Aksi dicatat dalam log audit.`, 'info');

      // 2. Buat dokumen jendela cetak yang rapi
      const win = window.open('', '_blank', 'width=1100,height=750');
      if (!win) {
        toast('Popup Diblokir', 'Mohon izinkan pop-up peramban untuk mencetak laporan.', 'error');
        return;
      }

      const now = new Date();
      const cityDate = `${now.getDate()} ${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;

      const rowsHtml = users.map((u, idx) => {
        const isSuper = u.role === 'super_admin';
        const roleLabel = isSuper ? 'Super Admin' : (u.opd_id ? 'Bendahara OPD' : 'Terkunci (Tanpa OPD)');
        const roleBadgeClass = isSuper ? 'badge-admin' : 'badge-opd';
        const opdText = u.opd_name || (isSuper ? 'Seluruh OPD (Pemerintah Kota)' : '— (Belum Ditugaskan)');
        const statusText = u.is_active ? 'Aktif' : 'Nonaktif';
        const statusClass = u.is_active ? 'badge-active' : 'badge-inactive';
        const joined = u.created_at ? new Date(u.created_at).toLocaleDateString('id-ID', {
          day: '2-digit', month: '2-digit', year: 'numeric'
        }) : '—';

        return `
          <tr>
            <td class="text-center">${idx + 1}</td>
            <td><strong>${escapeHtml(u.email)}</strong></td>
            <td>${escapeHtml(u.display_name || '—')}</td>
            <td><span class="badge ${roleBadgeClass}">${escapeHtml(roleLabel)}</span></td>
            <td>${escapeHtml(opdText)}</td>
            <td class="text-center"><span class="${statusClass}">${statusText}</span></td>
            <td class="text-center">${escapeHtml(joined)}</td>
          </tr>
        `;
      }).join('');

      const docHtml = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 12mm 15mm 12mm 15mm;
    }
    * { box-sizing: border-box; }
    body {
      font-family: Arial, "Helvetica Neue", sans-serif;
      font-size: 9pt;
      color: #111;
      margin: 0;
      padding: 0;
      line-height: 1.35;
    }
    .header-wrap {
      text-align: center;
      border-bottom: 2.5px solid #000;
      padding-bottom: 6px;
      margin-bottom: 12px;
    }
    .header-wrap h1 {
      margin: 0;
      font-size: 13pt;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .header-wrap h2 {
      margin: 3px 0 0;
      font-size: 10.5pt;
      font-weight: 600;
      letter-spacing: 0.3px;
      text-transform: uppercase;
      color: #0b3d62;
    }
    .header-wrap p {
      margin: 3px 0 0;
      font-size: 8.5pt;
      color: #444;
    }
    .meta-box {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
      font-size: 8.5pt;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
    }
    .meta-box td {
      padding: 4px 8px;
      vertical-align: top;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.5pt;
      margin-bottom: 16px;
    }
    .data-table th, .data-table td {
      border: 1px solid #475569;
      padding: 5px 6px;
      vertical-align: middle;
    }
    .data-table th {
      background-color: #e2e8f0;
      font-weight: 700;
      text-align: center;
      color: #0f172a;
    }
    .data-table tr:nth-child(even) {
      background-color: #f8fafc;
    }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .badge {
      display: inline-block;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 7.5pt;
      font-weight: 600;
    }
    .badge-admin { background: #e0e7ff; color: #3730a3; border: 0.5px solid #c7d2fe; }
    .badge-opd { background: #ecfdf5; color: #065f46; border: 0.5px solid #a7f3d0; }
    .badge-active { color: #047857; font-weight: 700; }
    .badge-inactive { color: #b91c1c; font-weight: 700; }
    .footer-block {
      margin-top: 14px;
      display: flex;
      justify-content: flex-end;
      page-break-inside: avoid;
    }
    .sign-box {
      width: 65mm;
      text-align: center;
      font-size: 9pt;
    }
    .sign-space { height: 16mm; }
    .sign-name { font-weight: 700; text-decoration: underline; }
    .sign-role { font-size: 8pt; color: #333; margin-top: 2px; }
    .print-note {
      margin-top: 20px;
      font-size: 7.5pt;
      color: #64748b;
      border-top: 1px dashed #cbd5e1;
      padding-top: 4px;
      display: flex;
      justify-content: space-between;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="header-wrap">
    <h1>PEMERINTAH KOTA SALATIGA</h1>
    <h2>${escapeHtml(title)}</h2>
    <p>Aplikasi Penggajian dan Cetak Slip Gaji ASN • Modul Manajemen Pengguna (Landscape)</p>
  </div>
  <table class="meta-box">
    <tr>
      <td style="width: 160px;"><strong>Tanggal &amp; Waktu Cetak</strong></td>
      <td style="width: 8px;">:</td>
      <td style="width: 38%;">${escapeHtml(printDate)}</td>
      <td style="width: 160px;"><strong>Admin yang Mencetak</strong></td>
      <td style="width: 8px;">:</td>
      <td><strong>${escapeHtml(adminName)}</strong> (${escapeHtml(adminEmail)})</td>
    </tr>
    <tr>
      <td><strong>Kriteria Filter</strong></td>
      <td>:</td>
      <td>Peran: ${escapeHtml(roleLabels[roleFilter] || roleFilter)} | Status: ${escapeHtml(statusLabels[statusFilter] || statusFilter)}</td>
      <td><strong>Total Data Pengguna</strong></td>
      <td>:</td>
      <td><strong>${users.length}</strong> Akun Terdaftar (Format Landscape)</td>
    </tr>
  </table>
  <table class="data-table">
    <thead>
      <tr>
        <th style="width: 36px;">No</th>
        <th style="width: 230px;">Email Akun (Google)</th>
        <th style="width: 180px;">Nama Pengguna</th>
        <th style="width: 130px;">Peran Akses</th>
        <th>Penugasan OPD</th>
        <th style="width: 80px;">Status</th>
        <th style="width: 110px;">Terdaftar</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
  <div class="footer-block">
    <div class="sign-box">
      <div>Salatiga, ${escapeHtml(cityDate)}</div>
      <div style="font-weight: 600; margin-top: 3px;">Admin yang Mencetak,</div>
      <div class="sign-space"></div>
      <div class="sign-name">${escapeHtml(adminName)}</div>
      <div class="sign-role">${escapeHtml(adminEmail)}</div>
    </div>
  </div>
  <div class="print-note">
    <span>Dicetak melalui Aplikasi Penggajian dan Cetak Slip Gaji ASN • Dokumen Resmi Internal Pemerintah Kota Salatiga</span>
    <span>ID Sesi / Tanggal: ${escapeHtml(printDate)}</span>
  </div>
</body>
</html>`;

      win.document.open();
      win.document.write(docHtml);
      win.document.close();
      win.onload = () => {
        win.focus();
        win.print();
      };
    } catch (caught) {
      if (errorNode) {
        errorNode.textContent = caught.message || 'Gagal mencatat log cetak atau mencetak dokumen.';
        errorNode.hidden = false;
      }
    } finally {
      if (btnPrint) btnPrint.disabled = false;
    }
  }

  /* ============================== MANAJEMEN DATABASE ============================== */

  async function populateDatabaseOpdSelect() {
    const select = $('#db-del-opd');
    if (!select) return;
    try {
      if (!state.opdOptions || !state.opdOptions.length) {
        await loadOpdOptions();
      }
      const curVal = select.value;
      let html = '<option value="">-- Pilih OPD --</option>';
      html += '<option value="SEMUA OPD">-- SEMUA OPD (Seluruh Daerah) --</option>';
      const sorted = [...(state.opdOptions || [])].sort((a, b) =>
        (a.nmskpd || '').localeCompare(b.nmskpd || '', 'id', { sensitivity: 'base' })
      );
      sorted.forEach((opd) => {
        html += `<option value="${escapeHtml(opd.nmskpd)}">${escapeHtml(opd.nmskpd)}</option>`;
      });
      select.innerHTML = html;
      if (curVal) select.value = curVal;
    } catch (err) {
      console.warn('Gagal memuat opsi OPD database:', err);
    }
  }

  function populateDatabasePeriodSelect() {
    const select = $('#db-del-period');
    if (!select) return;
    const curVal = select.value;
    const all = getAllPeriods();
    let html = '<option value="">-- Pilih Periode --</option>';
    all.forEach((p) => {
      html += `<option value="${p}">${periodLabel(p)}</option>`;
    });
    select.innerHTML = html;
    if (curVal) {
      select.value = curVal;
    } else if (state.period) {
      select.value = state.period;
    }
  }

  function generateRestoreSecurityCode() {
    state.restoreSecurityCode = String(Math.floor(10000 + Math.random() * 90000));
    const codeEl = $('#restore-random-code');
    if (codeEl) codeEl.textContent = state.restoreSecurityCode;
    const inputEl = $('#restore-security-input');
    if (inputEl) inputEl.value = '';
    updateRestoreState();
  }

  function updateRestoreState() {
    const checkboxes = $$('.cb-restore-table');
    const checked = $$('.cb-restore-table:checked');
    const count = checked.length;
    const summaryEl = $('#restore-table-summary');
    if (summaryEl) {
      if (count === 0) {
        summaryEl.innerHTML = '<span style="color: #dc2626;">Pilih minimal satu kategori data yang ingin dipulihkan.</span>';
      } else if (count === checkboxes.length) {
        summaryEl.textContent = `Semua ${count} kategori data dipilih untuk dipulihkan.`;
        summaryEl.style.color = '#64748b';
      } else {
        summaryEl.textContent = `${count} dari ${checkboxes.length} kategori data dipilih untuk dipulihkan.`;
        summaryEl.style.color = '#0284c7';
      }
    }

    const inputEl = $('#restore-security-input');
    const hintEl = $('#restore-security-hint');
    const btn = $('#btn-db-restore');
    const val = (inputEl?.value || '').trim();
    const isMatch = val.length === 5 && val === state.restoreSecurityCode;

    if (isMatch) {
      if (hintEl) hintEl.innerHTML = '<span style="color: #15803d; font-weight: 600;">✓ Kode pengaman valid</span>';
      if (btn && count > 0) {
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
        btn.style.boxShadow = '0 0 0 2px rgba(220, 38, 38, 0.2)';
      }
    } else {
      if (hintEl) {
        if (val.length > 0) {
          hintEl.innerHTML = '<span style="color: #dc2626;">Kode pengaman tidak cocok.</span>';
        } else {
          hintEl.innerHTML = 'Ketik 5 angka pengaman di atas untuk mengaktifkan pemulihan.';
          hintEl.style.color = '#dc2626';
        }
      }
      if (btn) {
        btn.style.opacity = '0.6';
        btn.style.boxShadow = 'none';
      }
    }
  }

  function updateWipeSummary() {
    const checkboxes = $$('.cb-wipe-table');
    const checked = $$('.cb-wipe-table:checked');
    const count = checked.length;

    const masterCb = $('#cb-wipe-master');
    if (masterCb) {
      masterCb.checked = count === checkboxes.length && checkboxes.length > 0;
      masterCb.indeterminate = count > 0 && count < checkboxes.length;
    }

    const badge = $('#db-wipe-selected-badge');
    if (badge) {
      badge.textContent = `${count} dari ${checkboxes.length} kategori dipilih`;
      if (count === 0) {
        badge.style.background = '#f1f5f9';
        badge.style.color = '#64748b';
        badge.style.borderColor = '#cbd5e1';
      } else {
        badge.style.background = '#fee2e2';
        badge.style.color = '#991b1b';
        badge.style.borderColor = '#fca5a5';
      }
    }

    checkboxes.forEach((cb) => {
      const tr = cb.closest('tr');
      if (tr) {
        tr.classList.toggle('is-selected', cb.checked);
      }
    });

    const confirmInput = $('#db-wipe-confirm-text');
    const wipeSubmitBtn = $('#btn-db-wipe');
    const hint = $('#db-wipe-hint');
    const isConfirmed = confirmInput && confirmInput.value.trim().toUpperCase() === 'HAPUS DATA';

    if (wipeSubmitBtn) {
      if (count > 0 && isConfirmed) {
        wipeSubmitBtn.style.opacity = '1';
        wipeSubmitBtn.style.cursor = 'pointer';
        wipeSubmitBtn.style.boxShadow = '0 0 0 2px rgba(220, 38, 38, 0.2)';
        if (hint) {
          hint.innerHTML = '<span style="color: #15803d; font-weight: 600;">✓ Konfirmasi cocok. Tombol pembersihan siap dieksekusi.</span>';
        }
      } else {
        wipeSubmitBtn.style.opacity = '0.6';
        wipeSubmitBtn.style.cursor = 'pointer';
        wipeSubmitBtn.style.boxShadow = 'none';
        if (hint) {
          if (!isConfirmed && confirmInput && confirmInput.value.trim().length > 0) {
            hint.innerHTML = '<span style="color: #dc2626;">Teks konfirmasi belum sesuai. Ketik persis: <strong>HAPUS DATA</strong></span>';
          } else if (!isConfirmed) {
            hint.innerHTML = 'Ketik kata <strong>HAPUS DATA</strong> dengan huruf kapital untuk mengesahkan pembersihan data.';
          } else if (count === 0) {
            hint.innerHTML = '<span style="color: #d97706;">Pilih minimal satu kategori data yang hendak dibersihkan di atas.</span>';
          }
        }
      }
    }
  }

  async function loadDatabaseStats() {
    if (state.mode !== 'api' || !state.token) return;
    if (!(state.profile && state.profile.is_super_admin)) {
      toast('Akses Dibatasi', 'Halaman Manajemen Database hanya untuk Super Admin.', 'warning');
      setView('dashboard');
      return;
    }

    setStatus('Memuat status & statistik database…');
    try {
      const stats = await apiRequest('/api/v1/database/stats');
      const payrollEl = $('#db-stat-payroll');
      if (payrollEl) payrollEl.textContent = `${formatNumber(stats.payroll_monthly || 0)} baris`;

      const potonganEl = $('#db-stat-potongan');
      if (potonganEl) {
        potonganEl.textContent = `${formatNumber(stats.payroll_potongan_item || 0)} item / ${formatNumber(stats.potongan_berjangka || 0)} tenor`;
      }

      const penyesuaianPosEl = $('#db-stat-penyesuaian-pos');
      if (penyesuaianPosEl) {
        penyesuaianPosEl.textContent = `${formatNumber(stats.payroll_penyesuaian || 0)} koreksi / ${formatNumber(stats.ref_pos_potongan || 0)} pos`;
      }

      const mastersEl = $('#db-stat-masters');
      if (mastersEl) {
        mastersEl.textContent = `${formatNumber(stats.app_users || 0)} user / ${formatNumber(stats.ref_opd || 0)} OPD`;
      }

      const auditEl = $('#db-stat-audit');
      if (auditEl) {
        auditEl.textContent = `${formatNumber(stats.audit_logs || 0)} log`;
      }

      setStatus('Statistik basis data berhasil dimuat.');
    } catch (error) {
      toast('Gagal Memuat Statistik Database', error.message, 'error');
      setStatus('Gagal memuat statistik basis data.');
    }

    try {
      await populateDatabaseOpdSelect();
      populateDatabasePeriodSelect();
    } catch (dropdownErr) {
      console.warn('Gagal memuat opsi dropdown database:', dropdownErr);
    }

    if (!state.restoreSecurityCode) {
      generateRestoreSecurityCode();
    } else {
      updateRestoreState();
    }
    updateWipeSummary();
  }

  async function downloadDatabaseBackup() {
    if (state.mode !== 'api' || !state.token) return;
    const btn = $('#btn-db-backup');
    if (btn) btn.disabled = true;
    setStatus('Menyiapkan cadangan basis data…');

    try {
      const data = await apiRequest('/api/v1/database/backup');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const now = new Date();
      const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
      const timePart = now.toTimeString().slice(0, 8).replace(/:/g, '');
      const filename = `backup_slip_gaji_${datePart}_${timePart}.json`;
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const totalRecs = Number(data.total_records) || (data.counts ? Object.values(data.counts).reduce((a, b) => a + Number(b), 0) : 0);
      addActivity('backup', 'Cadangan Basis Data (JSON)', `${filename} • ${formatNumber(totalRecs)} baris data`, 'blue');
      toast('Backup Berhasil', `File cadangan basis data berhasil diunduh (${formatNumber(totalRecs)} baris data).`, 'success');
      setStatus('Cadangan basis data berhasil diunduh.');
      await loadDatabaseStats();
    } catch (error) {
      toast('Gagal Mengunduh Backup', error.message, 'error');
      setStatus('Gagal mencadangkan basis data.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function submitDatabaseRestore() {
    if (state.mode !== 'api' || !state.token) return;
    const fileInput = $('#db-restore-file');
    const file = fileInput?.files?.[0];
    if (!file) {
      toast('File Cadangan Belum Dipilih', 'Pilih berkas JSON cadangan terlebih dahulu.', 'warning');
      return;
    }

    const checkedBoxes = $$('.cb-restore-table:checked');
    const tables = Array.from(checkedBoxes).map((cb) => cb.value);
    if (tables.length === 0) {
      toast('Kategori Data Belum Dipilih', 'Pilih minimal satu kategori data yang hendak dipulihkan.', 'warning');
      return;
    }

    const inputEl = $('#restore-security-input');
    const typedCode = (inputEl?.value || '').trim();
    if (!state.restoreSecurityCode || typedCode !== state.restoreSecurityCode) {
      toast('Kode Pengaman Tidak Sesuai', 'Ketik 5 angka kode pengaman verifikasi yang tertera dengan benar.', 'warning');
      if (inputEl) {
        inputEl.focus();
        inputEl.style.borderColor = '#dc2626';
        setTimeout(() => { inputEl.style.borderColor = '#fca5a5'; }, 2000);
      }
      return;
    }

    if (!window.confirm(`PERINGATAN PEMULIHAN BASIS DATA!\n\nMemulihkan database dari berkas "${file.name}" untuk kategori:\n${tables.join(', ')}\n\nOperasi ini akan menimpa data sistem dalam transaksi atomik.\n\nApakah Anda benar-benar yakin ingin melanjutkan?`)) {
      return;
    }

    const btn = $('#btn-db-restore');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<svg class="icon"><use href="#icon-refresh"></use></svg> Memulihkan Data…';
    }
    setStatus('Sedang memulihkan basis data dari berkas cadangan…');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('tables', JSON.stringify(tables));

      const res = await apiRequest('/api/v1/database/restore', {
        method: 'POST',
        body: formData,
      });

      toast('Pemulihan Selesai', res.message || 'Basis data berhasil dipulihkan secara penuh.', 'success');
      addActivity('database', 'Pemulihan Basis Data (Restore)', `Berkas: ${file.name} • Kategori: ${tables.join(', ')}`, 'green');
      if (fileInput) fileInput.value = '';
      setStatus('Basis data berhasil dipulihkan.');
      await loadOpdOptions();
      await loadDatabaseStats();
      renderAll();
    } catch (error) {
      toast('Gagal Memulihkan Database', error.message, 'error');
      setStatus('Gagal memulihkan basis data.');
    } finally {
      generateRestoreSecurityCode();
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<svg class="icon"><use href="#icon-upload"></use></svg> Pulihkan Data Sekarang';
      }
    }
  }

  async function submitDatabaseDeletePeriod() {
    if (state.mode !== 'api' || !state.token) return;
    const opd = ($('#db-del-opd')?.value || '').trim();
    const period = ($('#db-del-period')?.value || '').trim();
    const delPayroll = Boolean($('#cb-del-payroll')?.checked);
    const delPotongan = Boolean($('#cb-del-potongan')?.checked);
    const delPenyesuaian = Boolean($('#cb-del-penyesuaian')?.checked);

    if (!opd) {
      toast('OPD Belum Dipilih', 'Silakan pilih OPD yang hendak dibersihkan datanya.', 'warning');
      return;
    }
    if (!period) {
      toast('Periode Belum Dipilih', 'Silakan pilih Periode gaji yang hendak dibersihkan.', 'warning');
      return;
    }
    if (!delPayroll && !delPotongan && !delPenyesuaian) {
      toast('Cakupan Kosong', 'Pilih minimal satu cakupan data yang hendak dihapus (Payroll, Potongan, atau Penyesuaian).', 'warning');
      return;
    }

    const periodName = periodLabel(period);
    if (!window.confirm(`KONFIRMASI PENGHAPUSAN DATA PERIODE:\n\nOPD: ${opd}\nPeriode: ${periodName}\n\nTindakan ini permanen dan akan menghapus data yang dicentang pada periode tersebut.\n\nLanjutkan penghapusan?`)) {
      return;
    }

    const btn = $('#btn-db-del-period');
    if (btn) btn.disabled = true;
    setStatus(`Menghapus data periode ${periodName} OPD ${opd}…`);

    try {
      const res = await apiRequest('/api/v1/database/delete-period', {
        method: 'POST',
        body: JSON.stringify({
          opd_name: opd,
          nmskpd: opd,
          period: period,
          delete_payroll: delPayroll,
          delete_potongan: delPotongan,
          delete_penyesuaian: delPenyesuaian,
        }),
      });

      toast('Data Periode Dihapus', res.message || 'Data periode berhasil dihapus.', 'success');
      addActivity('database', 'Hapus Data Periode OPD', `${opd} • ${periodName}`, 'amber');
      setStatus('Data periode berhasil dihapus.');
      await loadDatabaseStats();
      if (state.opd === opd && state.period === period) {
        state.employees = [];
        renderAll();
      }
    } catch (error) {
      toast('Gagal Menghapus Data Periode', error.message, 'error');
      setStatus('Gagal menghapus data periode.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function submitDatabaseWipe() {
    if (state.mode !== 'api' || !state.token) return;
    const checkboxes = $$('.cb-wipe-table:checked');
    const tables = Array.from(checkboxes).map((cb) => cb.value);

    if (tables.length === 0) {
      toast('Belum Ada Kategori Dipilih', 'Pilih minimal satu kategori data yang hendak dibersihkan.', 'warning');
      return;
    }

    const confirmInput = $('#db-wipe-confirm-text');
    if (!confirmInput || confirmInput.value.trim().toUpperCase() !== 'HAPUS DATA') {
      toast('Konfirmasi Keamanan Diperlukan', 'Ketik kata "HAPUS DATA" pada kolom konfirmasi untuk mengesahkan tindakan.', 'warning');
      if (confirmInput) {
        confirmInput.focus();
        confirmInput.style.borderColor = '#dc2626';
        setTimeout(() => { confirmInput.style.borderColor = '#fca5a5'; }, 2000);
      }
      return;
    }

    if (!window.confirm(`PERINGATAN PEMUSNAHAN DATA TINGKAT TINGGI!\n\nAnda akan menghapus data permanen untuk kategori:\n${tables.join(', ')}\n\nSuper Admin utama (teguhe@gmail.com) tetap dilindungi.\n\nApakah Anda benar-benar yakin ingin melanjutkan pembersihan ini?`)) {
      return;
    }

    const btn = $('#btn-db-wipe');
    if (btn) btn.disabled = true;
    setStatus('Sedang membersihkan kategori data terpilih…');

    try {
      const res = await apiRequest('/api/v1/database/wipe', {
        method: 'POST',
        body: JSON.stringify({
          tables,
          confirmation: true,
        }),
      });

      toast('Pembersihan Berhasil', res.message || 'Kategori data terpilih telah dibersihkan.', 'success');
      addActivity('database', 'Pembersihan Data (Wipe)', `Kategori: ${tables.join(', ')}`, 'red');
      if (confirmInput) confirmInput.value = '';
      updateWipeSummary();
      setStatus('Pembersihan data selesai.');
      await loadOpdOptions();
      await loadDatabaseStats();
      renderAll();
    } catch (error) {
      toast('Gagal Membersihkan Data', error.message, 'error');
      setStatus('Gagal membersihkan data basis data.');
    } finally {
      if (btn) btn.disabled = false;
      updateWipeSummary();
    }
  }

  function clearAllData() {
    state.mode = 'api';
    state.token = '';
    state.profile = null;
    state.employees = [];
    state.masterGajiList = [];
    state.masterGajiStats = null;
    state.penyesuaianList = [];
    state.monitoringLogs = [];
    state.opdOptions = [];
    state.posList = [];
    state.loans = [];
    state.selected = new Set();
    state.opd = 'Belum terhubung';
    state.opdRaw = '';
    state.potonganNip = '';
    state.profileChangeMode = false;

    storageRemove('simgaji.token', sessionStorage);
    storageRemove('simgaji.mode', localStorage);

    // Reset metric cards & dashboard
    setText('#metric-pegawai', '0');
    setText('#metric-kotor', 'Rp 0');
    setText('#metric-potongan', 'Rp 0');
    setText('#metric-thp', 'Rp 0');
    setText('#compose-resmi-value', 'Rp 0');
    setText('#compose-internal-value', 'Rp 0');
    const chartBars = $('#chart-bars');
    if (chartBars) chartBars.innerHTML = '';
    const employeeTbody = $('#employee-table-body');
    if (employeeTbody) employeeTbody.innerHTML = '';

    // Reset master gaji
    setText('#stats-total-pegawai', '0');
    setText('#stats-total-kotor', 'Rp 0');
    setText('#stats-total-potongan', 'Rp 0');
    setText('#stats-total-thp', 'Rp 0');
    setText('#stats-sub-gapok', 'Gapok: Rp 0');
    setText('#stats-sub-potongan', 'Resmi: Rp 0 • Internal: Rp 0');
    setText('#stats-sub-penyesuaian', 'Penyesuaian: Rp 0');

    const tbTj = $('#tbody-breakdown-tunjangan');
    if (tbTj) tbTj.innerHTML = '<tr><td colspan="2" class="table-empty">Silakan login terlebih dahulu</td></tr>';
    const tbPot = $('#tbody-breakdown-potongan');
    if (tbPot) tbPot.innerHTML = '<tr><td colspan="2" class="table-empty">Silakan login terlebih dahulu</td></tr>';
    const tbExcel = $('#tbody-excel-gaji');
    if (tbExcel) tbExcel.innerHTML = '<tr><td colspan="12" class="table-empty">Silakan login terlebih dahulu.</td></tr>';
    const tbPeny = $('#tbody-penyesuaian');
    if (tbPeny) tbPeny.innerHTML = '<tr><td colspan="8" class="table-empty">Silakan login terlebih dahulu.</td></tr>';
    const tbMon = $('#monitoring-tbody');
    if (tbMon) tbMon.innerHTML = '<tr><td colspan="6" class="table-empty">Silakan login terlebih dahulu.</td></tr>';
    const tbOpd = $('#master-opd-tbody');
    if (tbOpd) tbOpd.innerHTML = '';
    const tbUsers = $('#master-user-tbody');
    if (tbUsers) tbUsers.innerHTML = '';

    // Reset profile display
    setText('#profile-name', '—');
    setText('#profile-role', '—');
    setText('#profile-opd', '—');
    setText('#status-data-mode', 'Belum Login');
    storageRemove('simgaji.photoURL', localStorage);
    state.photoURL = '';
    setAvatarElement($('#profile-avatar'), '', '—');
    setAvatarElement($('#profile-dialog-avatar'), '', '—');
    setAvatarElement($('#start-avatar'), '', '—');
    setAvatarElement($('#dashboard-welcome-avatar'), '', null, true);
  }

  function showLoginScreen() {
    const loginScreen = $('#login-screen');
    const appWindow = $('#app-window');
    const taskbar = document.querySelector('.taskbar');
    const closedShortcut = $('#closed-shortcut');
    const startMenu = $('#start-menu');

    if (loginScreen) loginScreen.hidden = false;
    if (appWindow) appWindow.hidden = true;
    if (taskbar) taskbar.hidden = true;
    if (closedShortcut) closedShortcut.hidden = true;
    if (startMenu) startMenu.hidden = true;

    const error = $('#login-page-error');
    if (error) error.hidden = true;

    try {
      if (window.location.pathname !== '/login') {
        history.replaceState(null, '', '/login');
      }
    } catch (_) {}
  }

  function showAppScreen() {
    const loginScreen = $('#login-screen');
    const appWindow = $('#app-window');
    const taskbar = document.querySelector('.taskbar');
    const closedShortcut = $('#closed-shortcut');

    if (loginScreen) loginScreen.hidden = true;
    if (appWindow) {
      appWindow.hidden = false;
      appWindow.classList.remove('is-closed', 'is-minimized');
      appWindow.classList.add('is-maximized');
      const maxBtn = document.querySelector('[data-window-action="maximize"], [data-window-action="restore"]');
      if (maxBtn) {
        maxBtn.setAttribute('aria-label', 'Restore');
        maxBtn.setAttribute('title', 'Restore Down');
        maxBtn.setAttribute('data-window-action', 'restore');
      }
    }
    if (taskbar) taskbar.hidden = false;
    if (closedShortcut) closedShortcut.hidden = true;

    try {
      if (window.location.pathname === '/login') {
        history.replaceState(null, '', '/');
      }
    } catch (_) {}
  }

  function logout() {
    clearAllData();
    if (typeof window.firebase !== 'undefined' && firebase.auth) {
      try {
        firebase.auth().signOut();
      } catch (_) {}
    }
    closeModal();
    updateProfileUI();
    toast('Logout', 'Anda telah keluar dari aplikasi.', 'info');
    showLoginScreen();
  }

  /* ============================== MASTER GAJI ============================== */

  const INCOME_LABELS = {
    gapok: 'Gaji Pokok',
    tjistri: 'Tunjangan Suami / Istri',
    tjanak: 'Tunjangan Anak',
    tjtpp: 'Tambahan Penghasilan Pegawai (TPP)',
    tjeselon: 'Tunjangan Eselon / Struktural',
    tjfungsi: 'Tunjangan Fungsional Tertentu',
    tjstruk: 'Tunjangan Tugas Struktural',
    tjguru: 'Tunjangan Tenaga Kependidikan / Guru',
    tjlangka: 'Tunjangan Kelangkaan Profesi',
    tjtkd: 'Tunjangan Kinerja Daerah (TKD)',
    tjterpencil: 'Tunjangan Daerah Terpencil',
    tjkhusus: 'Tunjangan Khusus ASN',
    tjberas: 'Tunjangan Beras (Natura / Pangan)',
    tjpajak: 'Tunjangan Pajak Penghasilan (PPh 21)',
    tjaskes: 'Tunjangan Jaminan Kesehatan (BPJS Kes)',
    tjumum: 'Tunjangan Umum Golongan',
    tjkk: 'Tunjangan Kecelakaan Kerja (JKK)',
    tjkm: 'Tunjangan Kematian (JKM)',
    ttaperap: 'Tunjangan Tapera Pegawai',
    tbulat: 'Pembulatan Gaji',
  };

  const DEDUCTION_LABELS = {
    iwp_beban_pegawai: 'IWP Beban Pegawai (1%)',
    iwp_beban_pembkerja: 'IWP Beban Pemda / Pemberi Kerja',
    iwp_taspen: 'IWP Taspen Pegawai (8%)',
    ppajak: 'Pajak Penghasilan (PPh Pasal 21)',
    pbulog: 'Potongan Beras Bulog',
    ptaperum: 'Iuran Tabungan Perumahan (Taperum)',
    psewa: 'Sewa Rumah Dinas / Mess Pemda',
    phutang: 'Potongan Hutang / Lebih Bayar Daerah',
    pkorpri: 'Iuran Wajib KORPRI',
    pirdhata: 'Iuran Pirdhata',
    pkoperasi: 'Potongan Koperasi Pegawai (SIMGAJI)',
    pjkk: 'Iuran Jaminan Kecelakaan Kerja (JKK)',
    pjkm: 'Iuran Jaminan Kematian (JKM)',
    ptaperap: 'Potongan Tapera Pegawai',
    ptaperai: 'Potongan Tapera Instansi',
  };

  async function loadMasterGaji() {
    if (!state.token) {
      promptLogin('Silakan login untuk mengakses Master Gaji.');
      return;
    }

    const opdLabel = $('#master-gaji-opd-label');
    if (opdLabel) {
      const isSuper = Boolean(state.profile && state.profile.is_super_admin);
      const displayOpd = isSuper ? 'Semua OPD (Akses Global)' : (state.opd || 'Semua OPD');
      opdLabel.textContent = `OPD: ${displayOpd} • Periode: ${periodLabel(state.period)}`;
    }

    // Selalu muat statistik ringkasan dan komposisi potongan untuk card di atas tab
    await loadMasterGajiStats();

    const activeTab = state.masterGajiTab || 'gaji-stats';
    if (activeTab === 'gaji-excel') {
      await loadMasterGajiList();
    } else if (activeTab === 'gaji-penyesuaian') {
      await loadPenyesuaianList();
    }
  }

  async function loadMasterGajiStats() {
    if (!state.token) return;
    try {
      setStatus('Memuat statistik data gaji…');
      const stats = await apiRequest(`/api/v1/payroll/stats?period=${encodeURIComponent(state.period)}`);
      state.masterGajiStats = stats;

      setText('#stats-total-pegawai', String(stats.total_pegawai || 0));
      setText('#stats-total-kotor', formatRupiah(stats.total_kotor || 0));
      setText('#stats-sub-gapok', `Gapok: ${formatRupiah(stats.total_gapok || 0)}`);

      const totalPotongan = (Number(stats.total_potongan_simgaji || 0) + Number(stats.total_potongan_internal || 0));
      setText('#stats-total-potongan', formatRupiah(totalPotongan));
      setText(
        '#stats-sub-potongan',
        `Resmi: ${formatRupiah(stats.total_potongan_simgaji || 0)} • Internal: ${formatRupiah(stats.total_potongan_internal || 0)}`
      );

      setText('#stats-total-thp', formatRupiah(stats.total_thp || 0));
      setText('#stats-sub-penyesuaian', `Penyesuaian: ${formatRupiah(stats.total_penyesuaian || 0)}`);

      renderComposition({
        totalPotongan,
        potonganSimgaji: Number(stats.total_potongan_simgaji || 0),
        potonganInternal: Number(stats.total_potongan_internal || 0),
      });

      // Render breakdown tunjangan
      const tbodyTj = $('#tbody-breakdown-tunjangan');
      if (tbodyTj) {
        const rows = Object.entries(stats.breakdown_tunjangan || {});
        if (!rows.length) {
          tbodyTj.innerHTML = '<tr><td colspan="2" class="table-empty">Belum ada data penghasilan</td></tr>';
        } else {
          tbodyTj.innerHTML = rows
            .map(([col, val]) => `
              <tr>
                <td><strong>${escapeHtml(INCOME_LABELS[col] || col)}</strong></td>
                <td class="num-col">${formatRupiah(val)}</td>
              </tr>
            `)
            .join('');
        }
      }

      // Render breakdown potongan resmi
      const tbodyPot = $('#tbody-breakdown-potongan');
      if (tbodyPot) {
        const rows = Object.entries(stats.breakdown_potongan_resmi || {});
        if (!rows.length) {
          tbodyPot.innerHTML = '<tr><td colspan="2" class="table-empty">Belum ada data potongan</td></tr>';
        } else {
          tbodyPot.innerHTML = rows
            .map(([col, val]) => `
              <tr>
                <td><strong>${escapeHtml(DEDUCTION_LABELS[col] || col)}</strong></td>
                <td class="num-col">${formatRupiah(val)}</td>
              </tr>
            `)
            .join('');
        }
      }

      setStatus(`Statistik data gaji ${periodLabel(state.period)} siap.`);
    } catch (error) {
      toast('Gagal memuat statistik gaji', error.message, 'error');
    }
  }

  async function loadMasterGajiList() {
    if (!state.token) return;
    try {
      setStatus('Memuat daftar gaji bulanan import…');
      const list = await apiRequest(`/api/v1/payroll/monthly-list?period=${encodeURIComponent(state.period)}`);
      state.masterGajiList = Array.isArray(list) ? list : [];
      renderMasterGajiList();
      setStatus(`Data import gaji siap (${state.masterGajiList.length} ASN).`);
    } catch (error) {
      toast('Gagal memuat daftar gaji', error.message, 'error');
    }
  }

  function renderMasterGajiList() {
    const tbody = $('#tbody-excel-gaji');
    const subtitle = $('#excel-data-subtitle');
    if (!tbody) return;

    const query = (state.masterGajiFilter || '').trim().toLowerCase();
    const filtered = state.masterGajiList.filter((row) => {
      if (!query) return true;
      return (
        (row.nip || '').toLowerCase().includes(query) ||
        (row.nama || '').toLowerCase().includes(query) ||
        (row.norek || '').toLowerCase().includes(query)
      );
    });

    if (subtitle) {
      subtitle.textContent = `Menampilkan ${filtered.length} dari ${state.masterGajiList.length} ASN periode ${periodLabel(state.period)}`;
    }

    if (!filtered.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="12" class="table-empty">
            ${query ? 'Tidak ada pegawai yang cocok dengan kata kunci pencarian.' : 'Tidak ada data gaji untuk periode ini.'}
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filtered
      .map((row, idx) => `
        <tr>
          <td style="text-align: center;">${idx + 1}</td>
          <td><code class="mono">${escapeHtml(row.nip)}</code></td>
          <td><strong>${escapeHtml(row.nama)}</strong></td>
          <td style="text-align: center;">${escapeHtml(formatKdpangkat(row.kdpangkat))}</td>
          <td>${escapeHtml(row.norek || '—')}</td>
          <td class="num-col">${formatRupiah(row.gapok)}</td>
          <td class="num-col">${formatRupiah(row.total_tunjangan)}</td>
          <td class="num-col">${formatRupiah(row.kotor)}</td>
          <td class="num-col">${formatRupiah(row.potongan_simgaji)}</td>
          <td class="num-col">${formatRupiah(row.potongan_internal)}</td>
          <td class="num-col ${Number(row.penyesuaian) > 0 ? 'text-amber' : ''}">${formatRupiah(row.penyesuaian)}</td>
          <td class="num-col"><strong>${formatRupiah(row.take_home_pay)}</strong></td>
        </tr>
      `)
      .join('');
  }

  async function loadPenyesuaianList() {
    if (!state.token) return;
    try {
      setStatus('Memuat data penyesuaian gaji…');
      const periodInput = $('#penyesuaian-period');
      if (periodInput) periodInput.value = state.period;

      const list = await apiRequest(`/api/v1/payroll/penyesuaian?period=${encodeURIComponent(state.period)}`);
      state.penyesuaianList = Array.isArray(list) ? list : [];
      renderPenyesuaianTable();
      setStatus(`Penyesuaian gaji siap (${state.penyesuaianList.length} data).`);
    } catch (error) {
      toast('Gagal memuat penyesuaian', error.message, 'error');
    }
  }

  function renderPenyesuaianTable() {
    const tbody = $('#tbody-penyesuaian');
    const sub = $('#penyesuaian-table-sub');
    if (!tbody) return;

    if (sub) {
      sub.textContent = `${state.penyesuaianList.length} penyesuaian tercatat untuk periode ${periodLabel(state.period)}`;
    }

    if (!state.penyesuaianList.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Belum ada data penyesuaian gaji pada periode ini.</td></tr>';
      return;
    }

    const isSuper = Boolean(state.profile && state.profile.is_super_admin);
    tbody.innerHTML = state.penyesuaianList
      .map((item, idx) => `
        <tr>
          <td style="text-align: center;">${idx + 1}</td>
          <td><code class="mono">${escapeHtml(item.nip)}</code></td>
          <td><strong>${escapeHtml(item.nama || '—')}</strong></td>
          <td>${escapeHtml(item.jenis_penyesuaian)}</td>
          <td class="num-col"><strong>${formatRupiah(item.nominal)}</strong></td>
          <td>${escapeHtml(item.keterangan || '—')}</td>
          <td style="text-align: center;">
            <span class="badge-status ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>
          </td>
          <td style="text-align: center;">
            <button type="button" class="btn-table-icon danger" data-delete-penyesuaian="${escapeHtml(item.id)}" title="${isSuper ? 'Akses hanya untuk Bendahara OPD' : 'Hapus penyesuaian'}" ${isSuper ? 'disabled' : ''}>
              <svg class="icon"><use href="#icon-trash"></use></svg>
            </button>
          </td>
        </tr>
      `)
      .join('');

    tbody.querySelectorAll('[data-delete-penyesuaian]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-delete-penyesuaian');
        if (id) deletePenyesuaianGaji(id);
      });
    });
  }

  async function savePenyesuaianGaji(event) {
    if (event) event.preventDefault();
    if (!state.token) return;
    if (state.profile && state.profile.is_super_admin) {
      toast('Akses Dibatasi', 'Super Admin tidak dapat menginput penyesuaian gaji. Hak akses hanya untuk Bendahara OPD.', 'warning');
      return;
    }

    const nipInput = $('#penyesuaian-nip');
    const namaInput = $('#penyesuaian-nama');
    const jenisInput = $('#penyesuaian-jenis');
    const nominalInput = $('#penyesuaian-nominal');
    const statusInput = $('#penyesuaian-status');
    const ketInput = $('#penyesuaian-keterangan');
    const saveBtn = $('#btn-save-penyesuaian');

    const nip = nipInput ? nipInput.value.trim() : '';
    const nama = namaInput ? namaInput.value.trim() : '';
    const currentPeriod = state.period;
    const jenis = jenisInput ? jenisInput.value : 'Tunda Bayar';
    const nominal = nominalInput ? Number(nominalInput.value) : 0;
    const penStatus = statusInput ? statusInput.value : 'ditunda';
    const ket = ketInput ? ketInput.value.trim() : '';

    if (!nip) {
      toast('Validasi Gagal', 'Silakan pilih pegawai ASN terlebih dahulu.', 'error');
      openBrowsePegawaiModal('penyesuaian');
      return;
    }
    if (!nominal || nominal <= 0) {
      toast('Validasi Gagal', 'Nominal penyesuaian harus lebih besar dari 0.', 'error');
      if (nominalInput) nominalInput.focus();
      return;
    }

    try {
      if (saveBtn) saveBtn.disabled = true;
      setStatus('Menyimpan data penyesuaian gaji…');

      await apiRequest('/api/v1/payroll/penyesuaian', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nip,
          nama: nama || null,
          period: currentPeriod,
          jenis_penyesuaian: jenis,
          nominal,
          status: penStatus,
          keterangan: ket || null,
        }),
      });

      toast('Penyesuaian Disimpan', `Penyesuaian gaji untuk NIP ${nip} sebesar ${formatRupiah(nominal)} berhasil dicatat.`, 'success');

      // Clear form inputs
      if (nipInput) nipInput.value = '';
      const namaInput = $('#penyesuaian-nama');
      if (namaInput) namaInput.value = '';
      if (nominalInput) nominalInput.value = '';
      if (ketInput) ketInput.value = '';

      await loadPenyesuaianList();
      void loadMasterGajiStats();
      void loadApiData(state.token);
    } catch (error) {
      toast('Gagal Menyimpan Penyesuaian', error.message, 'error');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async function deletePenyesuaianGaji(id) {
    if (!state.token || !id) return;
    if (state.profile && state.profile.is_super_admin) {
      toast('Akses Dibatasi', 'Super Admin tidak dapat menghapus penyesuaian gaji.', 'warning');
      return;
    }
    if (!window.confirm('Apakah Anda yakin ingin menghapus data penyesuaian gaji ini?')) return;

    try {
      setStatus('Menghapus data penyesuaian gaji…');
      const res = await apiRequest(`/api/v1/payroll/penyesuaian/${id}`, {
        method: 'DELETE',
      });
      toast('Penyesuaian Dihapus', res.message || 'Penyesuaian gaji berhasil dihapus.', 'success');
      await loadPenyesuaianList();
      void loadMasterGajiStats();
      void loadApiData(state.token);
    } catch (error) {
      toast('Gagal Menghapus Penyesuaian', error.message, 'error');
    }
  }

  /* ============================== MONITORING AKTIVITAS ============================== */

  async function loadMonitoringAudit() {
    if (!state.token) {
      promptLogin('Silakan login untuk mengakses Monitoring Aktivitas.');
      return;
    }

    try {
      setStatus('Memuat log aktivitas…');
      let url = '/api/v1/monitoring/audit?limit=100';
      if (state.monitoringFilterAction) {
        url += `&action=${encodeURIComponent(state.monitoringFilterAction)}`;
      }

      const list = await apiRequest(url);
      state.monitoringLogs = Array.isArray(list) ? list : [];
      renderMonitoringTable();
      setStatus(`Monitoring Aktivitas siap (${state.monitoringLogs.length} entri).`);
    } catch (error) {
      toast('Gagal memuat log aktivitas', error.message, 'error');
    }
  }

  function renderMonitoringTable() {
    const tbody = $('#monitoring-tbody');
    const subtitle = $('#monitoring-subtitle');
    if (!tbody) return;

    const query = (state.monitoringSearch || '').trim().toLowerCase();
    const filtered = state.monitoringLogs.filter((log) => {
      if (!query) return true;
      const detailsStr = log.details ? JSON.stringify(log.details).toLowerCase() : '';
      return (
        (log.user_email || '').toLowerCase().includes(query) ||
        (log.action || '').toLowerCase().includes(query) ||
        detailsStr.includes(query)
      );
    });

    if (subtitle) {
      subtitle.textContent = `Menampilkan ${filtered.length} dari ${state.monitoringLogs.length} aktivitas sistem terbaru`;
    }

    if (!filtered.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="table-empty">
            ${query ? 'Tidak ada aktivitas yang cocok dengan kata kunci pencarian.' : 'Belum ada log aktivitas yang tercatat.'}
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filtered
      .map((log, idx) => {
        const dateStr = log.created_at ? new Date(log.created_at).toLocaleString('id-ID', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        }) : '—';

        let detailText = '—';
        if (log.details && typeof log.details === 'object') {
          detailText = Object.entries(log.details)
            .map(([k, v]) => `${escapeHtml(k)}: <strong>${escapeHtml(String(v))}</strong>`)
            .join(' • ');
        }

        return `
          <tr>
            <td style="text-align: center;">${idx + 1}</td>
            <td><span class="mono">${escapeHtml(dateStr)}</span></td>
            <td><strong>${escapeHtml(log.user_email)}</strong></td>
            <td><span class="badge-action">${escapeHtml(log.action)}</span></td>
            <td><div style="font-size: 11px;">${detailText}</div></td>
            <td><code class="mono">${escapeHtml(log.ip_address || '—')}</code></td>
          </tr>
        `;
      })
      .join('');
  }

  async function connectApiSession(token) {
    const profile = await apiRequest('/api/v1/auth/me', {}, token);
    state.mode = 'api';
    state.token = token;
    state.profile = profile;
    state.opd = profile.is_super_admin ? 'Tidak Terikat OPD' : (profile.opd_name || 'Belum ditetapkan');
    state.opdRaw = profile.is_super_admin ? '' : (profile.opd_name || '');
    state.employees = [];
    state.posList = [];
    state.loans = [];
    state.selected = new Set();
    state.potonganNip = '';
    storageSet('simgaji.mode', 'api', localStorage);
    storageSet('simgaji.token', token, sessionStorage);
    renderAll();
    updateProfileUI();

    if (profile.needs_opd) {
      if (!profile.is_super_admin) {
        toast('Akun Belum Ada OPD', 'Akun Anda baru dan belum ditugaskan ke OPD oleh Super Admin. Seluruh aksi terkunci.', 'warning');
        return profile;
      }
    }

    const data = await loadApiData(token);
    applyApiData(data, token);
    if (!profile.is_super_admin) {
      await loadPotonganReferenceData();
    }
    return profile;
  }

  async function loadPotonganReferenceData() {
    if (!state.token) return;
    if (state.profile && state.profile.is_super_admin) {
      state.posList = [];
      state.loans = [];
      state.rekapBulanan = null;
      state.rekapBerjangka = null;
      return;
    }

    try {
      const query = new URLSearchParams({ period: state.period });
      const [posData, loanData, rekapData, rekapBerjangkaData] = await Promise.all([
        apiRequest('/api/v1/potongan/pos'),
        apiRequest(`/api/v1/potongan/berjangka?${query.toString()}`),
        apiRequest(`/api/v1/potongan/rekap-bulanan?${query.toString()}`).catch((e) => {
          console.warn('Gagal memuat rekap bulanan:', e);
          return null;
        }),
        apiRequest(`/api/v1/potongan/rekap-berjangka?${query.toString()}`).catch((e) => {
          console.warn('Gagal memuat rekap berjangka:', e);
          return null;
        }),
      ]);
      state.posList = (posData || []).map(mapApiPos);
      state.loans = (loanData || []).map(mapApiLoan);
      state.rekapBulanan = rekapData;
      state.rekapBerjangka = rekapBerjangkaData;
      renderAll();
      if (state.potonganNip) {
        await loadEmployeePotongan(state.potonganNip, state.period);
      }
    } catch (error) {
      toast('Gagal memuat potongan', error.message, 'error');
    }
  }

  async function loadEmployeePotongan(nip, period) {
    if (state.mode !== 'api' || !state.token || !nip) return;
    try {
      const data = await apiRequest(
        `/api/v1/payroll/${encodeURIComponent(nip)}?period=${encodeURIComponent(period)}`,
      );
      if (state.potonganNip !== nip) return;
      const employee = findEmployee(nip);
      if (!employee) return;
      const details = Array.isArray(data.rincian_potongan_internal)
        ? data.rincian_potongan_internal
        : [];
      const totalInternal = Number(data.potongan_internal) || 0;
      if (details.length || totalInternal === 0) {
        employee.internalPotongan = details.map((detail, index) => ({
          id: detail.id || `api-${nip}-${index}`,
          pos_id: detail.pos_id,
          pos: detail.pos_nama || detail.pos,
          pos_nama: detail.pos_nama || detail.pos,
          nominal: Number(detail.nominal) || 0,
          info: detail.cicilan_info || detail.keterangan || `Bulanan • ${periodLabel(period)}`,
          kategori: detail.cicilan_info ? 'berjangka' : (detail.kategori || 'bulanan'),
          keterangan: detail.keterangan || '',
          readOnly: Boolean(detail.cicilan_info || detail.kategori === 'berjangka'),
        }));
        employee.basePotonganInternal = 0;
        recomputeEmployee(employee);
      }
      updatePotonganEmployee(nip);
      renderEmployeeTable();
      renderDashboard(computeTotals());
      renderPrintPreview();
    } catch (error) {
      // 404 berarti belum ada payroll pada periode tersebut; bukan error UI.
      if (error.status && error.status !== 404) {
        toast('Gagal memuat rincian', error.message, 'error');
      }
    }
  }

  function updateLoanPreview() {
    const start = $('#loan-start');
    const tenorNode = $('#loan-tenor');
    if (!start || !tenorNode) return;
    const tenor = Math.max(1, Math.min(240, Number(tenorNode.value) || 1));
    const endNode = $('#loan-end');
    const previewNode = $('#loan-preview');
    if (endNode) endNode.textContent = periodLabel(addMonths(start.value || state.period, tenor - 1));
    if (previewNode) previewNode.textContent = `1 / ${tenor} bulan`;
  }

  function openLoanDialog() {
    if (state.profile && state.profile.is_super_admin) {
      toast('Akses Dibatasi', 'Super Admin tidak dapat mendaftarkan pinjaman.', 'warning');
      return;
    }
    if (isUserLocked()) {
      toast('Akses Terkunci', 'Akun Anda belum memiliki penugasan OPD dari Super Admin.', 'error');
      return;
    }
    if (!state.employees.length) {
      toast('Belum ada pegawai', 'Import data SIMGAJI terlebih dahulu.', 'error');
      return;
    }
    populatePosSelects();
    const employee = currentPotonganEmployee();
    const nipInput = $('#loan-nip');
    const datalist = $('#loan-nip-options');
    if (datalist) {
      datalist.innerHTML = state.employees.map((item) => (
        `<option value="${escapeHtml(item.nip)}">${escapeHtml(item.nama)}</option>`
      )).join('');
    }
    if (nipInput && employee) nipInput.value = employee.nip;
    const nama = $('#loan-nama');
    if (nama) nama.textContent = employee ? employee.nama : '—';
    const nominal = $('#loan-nominal');
    if (nominal) nominal.value = '';
    const start = $('#loan-start');
    if (start) start.value = state.period;
    const tenor = $('#loan-tenor');
    if (tenor) tenor.value = '36';
    const keterangan = $('#loan-keterangan');
    if (keterangan) keterangan.value = '';
    const error = $('#loan-error');
    if (error) error.hidden = true;
    updateLoanPreview();
    openModal('loan');
  }

  async function saveLoan() {
    if (state.loanSaving) return;
    if (state.profile && state.profile.is_super_admin) {
      showInlineError('loan', 'Super Admin tidak dapat mendaftarkan pinjaman.');
      return;
    }
    const error = $('#loan-error');
    if (error) error.hidden = true;

    const nip = ($('#loan-nip').value || '').trim();
    const employee = findEmployee(nip);
    if (!employee) {
      showInlineError('loan', 'NIP tidak ditemukan pada data pegawai OPD ini.');
      return;
    }
    const pos = findPos($('#loan-pos').value);
    if (!pos) {
      showInlineError('loan', 'Pilih pos potongan berjangka. Tambahkan pos terlebih dahulu jika belum ada.');
      return;
    }
    const nominal = parseMoneyInput($('#loan-nominal').value);
    if (!Number.isFinite(nominal) || nominal <= 0) {
      showInlineError('loan', 'Nominal per bulan harus lebih besar dari 0.');
      return;
    }
    const start = $('#loan-start').value || state.period;
    const tenor = Number($('#loan-tenor').value);
    if (!Number.isInteger(tenor) || tenor < 1 || tenor > 240) {
      showInlineError('loan', 'Tenor harus antara 1 dan 240 bulan.');
      return;
    }
    const keterangan = $('#loan-keterangan').value.trim();
    const end = addMonths(start, tenor - 1);

    if (!state.token) {
      logout();
      return;
    }

    const button = $('#btn-save-loan');
    state.loanSaving = true;
    if (button) button.disabled = true;
    try {
      await apiRequest('/api/v1/potongan/berjangka', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nip,
          pos_id: Number(pos.id),
          nominal_per_bulan: nominal.toFixed(2),
          start_period: start,
          tenor_bulan: tenor,
          keterangan: keterangan || null,
        }),
      });
      closeModal();
      toast('Pinjaman tersimpan', `${pos.nama_pos} • ${tenor} bulan untuk ${employee.nama}.`, 'success');
      addActivity('potongan', 'Pinjaman berjangka dibuat', `${employee.nama} • ${pos.nama_pos} • ${tenor} bulan`, 'amber');
      await loadPotonganReferenceData();
      await loadEmployeePotongan(nip, state.period);
    } catch (caught) {
      showInlineError('loan', caught.message);
    } finally {
      state.loanSaving = false;
      if (button) button.disabled = false;
    }
  }

  function showInlineError(name, message) {
    const node = $(`#${name}-error`);
    if (!node) return;
    node.textContent = message || 'Terjadi kesalahan.';
    node.hidden = false;
  }

  function openPosDialog() {
    if (isUserLocked()) {
      toast('Akses Terkunci', 'Akun Anda belum memiliki penugasan OPD dari Super Admin.', 'error');
      return;
    }
    cancelEditPos();
    openModal('pos');
  }

  function editPos(posId) {
    const pos = findPos(posId);
    if (!pos) return;

    const editIdInput = $('#pos-edit-id');
    const namaInput = $('#pos-nama');
    const kategoriInput = $('#pos-kategori');
    const legend = $('#pos-form-legend');
    const submitLabel = $('#pos-submit-label');
    const submitIcon = $('#pos-submit-icon');
    const cancelBtn = $('#btn-pos-cancel');
    const error = $('#pos-error');

    if (editIdInput) editIdInput.value = pos.id;
    if (namaInput) {
      namaInput.value = pos.nama_pos;
      namaInput.focus();
      namaInput.select();
    }
    if (kategoriInput) kategoriInput.value = pos.kategori;
    if (legend) legend.textContent = `Edit Pos Potongan`;
    if (submitLabel) submitLabel.textContent = 'Simpan';
    if (submitIcon) submitIcon.setAttribute('href', '#icon-check');
    if (cancelBtn) cancelBtn.hidden = false;
    if (error) error.hidden = true;

    renderPosTable();
  }

  function cancelEditPos() {
    const editIdInput = $('#pos-edit-id');
    const form = $('#form-pos');
    const legend = $('#pos-form-legend');
    const submitLabel = $('#pos-submit-label');
    const submitIcon = $('#pos-submit-icon');
    const cancelBtn = $('#btn-pos-cancel');
    const error = $('#pos-error');

    if (editIdInput) editIdInput.value = '';
    if (form) form.reset();
    if (legend) legend.textContent = 'Tambah Pos';
    if (submitLabel) submitLabel.textContent = 'Tambah';
    if (submitIcon) submitIcon.setAttribute('href', '#icon-plus');
    if (cancelBtn) cancelBtn.hidden = true;
    if (error) error.hidden = true;

    renderPosTable();
  }

  async function submitPos(event) {
    event.preventDefault();
    const error = $('#pos-error');
    if (error) error.hidden = true;

    const editingId = ($('#pos-edit-id')?.value || '').trim();
    const nama = $('#pos-nama').value.trim();
    const kategori = $('#pos-kategori').value;

    if (!nama) {
      showInlineError('pos', 'Nama pos potongan wajib diisi.');
      return;
    }

    const isDuplicate = state.posList.some((pos) => {
      if (editingId && String(pos.id) === String(editingId)) return false;
      return pos.nama_pos.trim().toLowerCase() === nama.toLowerCase();
    });
    if (isDuplicate) {
      showInlineError('pos', 'Nama pos potongan sudah ada pada OPD ini.');
      return;
    }

    if (!state.token) {
      logout();
      return;
    }

    const button = $('#btn-pos-submit') || $('#form-pos button[type="submit"]');
    if (button) button.disabled = true;

    try {
      if (editingId) {
        // Mode Update / Edit
        const saved = await apiRequest(`/api/v1/potongan/pos/${encodeURIComponent(editingId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nama_pos: nama, kategori }),
        });
        const index = state.posList.findIndex((item) => String(item.id) === String(editingId));
        if (index >= 0) state.posList[index] = mapApiPos(saved);
        addActivity('potongan', 'Pos potongan diperbarui', `${nama} • ${kategori}`, 'cyan');
        cancelEditPos();
        renderAll();
        toast('Pos Diperbarui', `${nama} (${kategori}) berhasil diperbarui.`, 'success');
      } else {
        // Mode Tambah Baru
        const saved = await apiRequest('/api/v1/potongan/pos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nama_pos: nama, kategori }),
        });
        state.posList.push(mapApiPos(saved));
        addActivity('potongan', 'Pos potongan ditambahkan', `${nama} • ${kategori}`, 'amber');
        cancelEditPos();
        renderAll();
        toast('Pos Ditambahkan', `${nama} (${kategori}) tersimpan.`, 'success');
      }
      await loadPotonganReferenceData();
    } catch (caught) {
      showInlineError('pos', caught.message);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function togglePos(posId) {
    const pos = findPos(posId);
    if (!pos) return;
    const target = !pos.is_active;

    if (!state.token) {
      logout();
      return;
    }

    try {
      const saved = await apiRequest(`/api/v1/potongan/pos/${encodeURIComponent(pos.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: target }),
      });
      const index = state.posList.findIndex((item) => String(item.id) === String(pos.id));
      if (index >= 0) state.posList[index] = mapApiPos(saved);
      renderAll();
      toast(target ? 'Pos diaktifkan' : 'Pos dinonaktifkan', saved.nama_pos, 'info');
    } catch (caught) {
      toast('Gagal mengubah pos', caught.message, 'error');
    }
  }

  function openManualImport() {
    if (state.profile && state.profile.is_super_admin) {
      toast('Akses Dibatasi', 'Super Admin tidak dapat mengimpor data potongan.', 'warning');
      return;
    }
    if (isUserLocked()) {
      toast('Akses Terkunci', 'Akun Anda belum memiliki penugasan OPD dari Super Admin.', 'error');
      return;
    }
    populatePosSelects();
    const file = $('#manual-file');
    if (file) file.value = '';
    const fileName = $('#manual-file-name');
    if (fileName) fileName.textContent = 'Belum ada file';
    const info = $('#manual-file-info');
    if (info) {
      info.hidden = true;
      info.textContent = '—';
    }
    const period = $('#manual-period');
    if (period) period.value = state.period;
    const result = $('#manual-result');
    if (result) result.hidden = true;
    const error = $('#manual-error');
    if (error) error.hidden = true;
    const bar = $('#manual-progress-bar');
    if (bar) bar.style.width = '0%';
    const status = $('#manual-status');
    if (status) status.textContent = 'Pilih file, pos, dan periode.';
    openModal('manual-import');
  }

  function setManualProgress(percent, message) {
    const bar = $('#manual-progress-bar');
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    const status = $('#manual-status');
    if (status) status.textContent = message;
  }

  function showManualError(message, errors = []) {
    const result = $('#manual-result');
    if (result) result.hidden = true;
    const box = $('#manual-error');
    if (box) box.hidden = false;
    const messageNode = $('#manual-error-message');
    if (messageNode) messageNode.textContent = message || 'Import gagal.';
    const list = $('#manual-error-list');
    if (list) {
      list.innerHTML = (errors || []).slice(0, 8).map((item) => {
        const row = item && item.row ? `Baris ${item.row}: ` : '';
        const column = item && item.column ? `${item.column} — ` : '';
        const text = item && item.message ? item.message : String(item);
        return `<li>${escapeHtml(`${row}${column}${text}`)}</li>`;
      }).join('');
    }
    setManualProgress(0, 'Import gagal.');
  }

  function showManualResult(data) {
    const error = $('#manual-error');
    if (error) error.hidden = true;
    const result = $('#manual-result');
    if (result) result.hidden = false;
    const setText = (selector, value) => {
      const node = $(selector);
      if (node) node.textContent = value;
    };
    setText('#manual-result-title', 'Import potongan berhasil');
    setText('#manual-result-rows', String(Number(data.total_rows) || 0));
    setText('#manual-result-inserted', String(Number(data.inserted) || 0));
    setText('#manual-result-updated', String(Number(data.updated) || 0));
    setText('#manual-result-period', `${data.pos || '—'} • ${data.period || state.period}`);
    setManualProgress(100, 'Import selesai.');
  }

  async function runManualImport() {
    if (state.manualImportRunning) return;
    if (state.profile && state.profile.is_super_admin) {
      showManualError('Super Admin tidak dapat mengimpor data potongan.');
      return;
    }
    const file = $('#manual-file').files && $('#manual-file').files[0];
    const pos = findPos($('#manual-pos').value);
    const period = $('#manual-period').value || state.period;
    const error = $('#manual-error');
    if (error) error.hidden = true;

    if (!file) {
      showManualError('Pilih file Excel terlebih dahulu.');
      return;
    }
    if (!pos) {
      showManualError('Pilih pos potongan bulanan.');
      return;
    }

    if (!state.token) {
      logout();
      return;
    }

    const button = $('#btn-run-manual-import');
    state.manualImportRunning = true;
    if (button) button.disabled = true;
    setManualProgress(25, 'Mengunggah file…');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('pos_id', String(pos.id));
      formData.append('period', period);
      const data = await apiRequest('/api/v1/potongan/import-excel', {
        method: 'POST',
        body: formData,
      });
      showManualResult(data);
      addActivity('potongan', 'Import potongan berhasil', `${data.filename} • ${data.inserted} baru, ${data.updated} diperbarui`, 'green');
      toast('Import potongan berhasil', `${data.inserted} baru, ${data.updated} diperbarui.`, 'success');
      const dashboard = await loadApiData(state.token);
      applyApiData(dashboard, state.token);
      await loadEmployeePotongan(state.potonganNip, state.period);
      await loadPotonganReferenceData();
    } catch (caught) {
      const errors = caught.body && caught.body.detail && Array.isArray(caught.body.detail.errors)
        ? caught.body.detail.errors
        : [];
      showManualError(caught.message, errors);
      toast('Import potongan gagal', caught.message, 'error');
    } finally {
      state.manualImportRunning = false;
      if (button) button.disabled = false;
    }
  }

  async function generateBerjangka() {
    const button = $('#btn-generate-berjangka');
    if (!state.token) {
      logout();
      return;
    }

    if (button) button.disabled = true;
    try {
      const data = await apiRequest('/api/v1/potongan/berjangka/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period: state.period }),
      });
      addActivity('potongan', 'Realisasi cicilan', `${data.generated} baru • ${data.updated} diperbarui`, 'green');
      toast(
        'Realisasi selesai',
        `${data.generated} cicilan dibuat, ${data.updated} diperbarui, ${data.skipped} dilewati.`,
        'success',
      );
      const dashboard = await loadApiData(state.token);
      applyApiData(dashboard, state.token);
      await loadEmployeePotongan(state.potonganNip, state.period);
      await loadPotonganReferenceData();
    } catch (caught) {
      toast('Realisasi gagal', caught.message, 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  /* ============================== PRINT ============================== */

  function getPrintEmployees() {
    if (state.printUseSelected && state.selected.size) {
      return state.employees.filter((employee) => state.selected.has(employee.nip));
    }
    return state.employees;
  }

  const PRINT_ZOOM_STEPS = [0.4, 0.5, 0.65, 0.78, 0.9, 1.0, 1.25, 1.5];

  function getEffectivePrintZoom(val) {
    if (val === 'fit') {
      const viewport = $('#print-paper-viewport') || $('.paper-viewport');
      if (viewport && viewport.clientWidth > 0) {
        const availableWidth = viewport.clientWidth - 35;
        const fitRatio = availableWidth / 1248;
        return Math.min(1.5, Math.max(0.35, Number(fitRatio.toFixed(2))));
      }
      return 0.65;
    }
    const num = Number(val);
    return Number.isFinite(num) && num > 0 ? num : 0.65;
  }

  function applyPrintZoom(val) {
    state.printZoom = val || 'fit';
    const effective = getEffectivePrintZoom(state.printZoom);
    const preview = $('#preview-pages');
    if (preview) {
      preview.style.setProperty('--print-zoom', String(effective));
      $$('.paper', preview).forEach((p) => {
        p.style.zoom = String(effective);
        const isZoomSupported = ('zoom' in p.style) && (p.style.zoom === String(effective));
        if (!isZoomSupported) {
          p.style.transform = `scale(${effective})`;
          p.style.transformOrigin = 'top center';
          const baseHeightPx = 215 * 3.7795;
          const heightDiff = (effective - 1) * baseHeightPx;
          p.style.marginBottom = `${Math.round(heightDiff + 18)}px`;
        } else {
          p.style.transform = '';
          p.style.marginBottom = '';
        }
      });
    }
    const select = $('#print-zoom-select');
    if (select) {
      const match = Array.from(select.options).some((o) => o.value === String(val));
      if (match) {
        select.value = String(val);
      }
    }
    storageSet('simgaji.printZoom', String(val), localStorage);
  }

  function stepPrintZoom(direction) {
    const currentVal = state.printZoom || 'fit';
    const currentNum = getEffectivePrintZoom(currentVal);

    let next;
    if (direction > 0) {
      next = PRINT_ZOOM_STEPS.find((s) => s > currentNum + 0.03) || PRINT_ZOOM_STEPS[PRINT_ZOOM_STEPS.length - 1];
    } else {
      next = [...PRINT_ZOOM_STEPS].reverse().find((s) => s < currentNum - 0.03) || PRINT_ZOOM_STEPS[0];
    }
    applyPrintZoom(String(next));
  }

  function renderPageSlots(pageEmployees, baseIndex) {
    const slots = [];
    for (let slotIdx = 0; slotIdx < 3; slotIdx++) {
      if (slotIdx > 0) {
        slots.push('<div class="cut-separator"><span class="cut-scissors">✂</span></div>');
      }
      const employee = pageEmployees[slotIdx];
      if (employee) {
        slots.push(renderSlip(employee, baseIndex + slotIdx));
      } else {
        slots.push('<div class="slip slip-empty" aria-hidden="true"></div>');
      }
    }
    return slots.join('');
  }

  async function ensurePrintEmployeesLoaded() {
    if (state.mode !== 'api' || !state.token) return;
    if (!state.penyesuaianLoadedPeriod || state.penyesuaianLoadedPeriod !== state.period) {
      try {
        const pList = await apiRequest(`/api/v1/payroll/penyesuaian?period=${encodeURIComponent(state.period)}`);
        state.penyesuaianList = Array.isArray(pList) ? pList : [];
        state.penyesuaianLoadedPeriod = state.period;
      } catch (e) {
        console.warn('Gagal memuat penyesuaian gaji untuk slip:', e);
      }
    }
    const employeesToPrint = getPrintEmployees();
    const targets = employeesToPrint.filter(
      (e) => Number(e.potonganInternal) > 0 && (!e.internalPotongan || !e.internalPotongan.length)
    );
    if (!targets.length) return;
    await Promise.all(
      targets.map(async (emp) => {
        try {
          const data = await apiRequest(
            `/api/v1/payroll/${encodeURIComponent(emp.nip)}?period=${encodeURIComponent(state.period)}`
          );
          const details = Array.isArray(data.rincian_potongan_internal)
            ? data.rincian_potongan_internal
            : [];
          emp.internalPotongan = details.map((detail, index) => ({
            id: detail.id || `api-${emp.nip}-${index}`,
            pos_id: detail.pos_id,
            pos: detail.pos_nama || detail.pos,
            pos_nama: detail.pos_nama || detail.pos,
            nominal: Number(detail.nominal) || 0,
            info: detail.cicilan_info || detail.keterangan || `Bulanan • ${periodLabel(state.period)}`,
            kategori: detail.cicilan_info ? 'berjangka' : (detail.kategori || 'bulanan'),
            keterangan: detail.keterangan || '',
            readOnly: Boolean(detail.cicilan_info || detail.kategori === 'berjangka'),
          }));
          if (data.rincian_penyesuaian && data.rincian_penyesuaian.length) {
            emp.rincian_penyesuaian = data.rincian_penyesuaian;
          }
          emp.basePotonganInternal = 0;
        } catch (e) {
          console.warn(`Gagal memuat rincian potongan ${emp.nip}:`, e);
        }
      })
    );
  }

  function renderPrintPreview() {
    const preview = $('#preview-pages');
    const printRoot = $('#print-root');
    if (!preview || !printRoot) return;

    const employees = getPrintEmployees();
    const pages = chunk(employees, 3);

    if (!employees.length) {
      preview.innerHTML = `
        <div class="print-empty">
          <svg class="icon"><use href="#icon-printer"></use></svg>
          <strong>Belum ada slip untuk dicetak</strong>
          <span>Pilih pegawai pada dashboard atau import data terlebih dahulu.</span>
        </div>`;
      printRoot.innerHTML = '';
    } else {
      preview.innerHTML = pages.map((page, pageIndex) => `
        <section class="paper">
          ${renderPageSlots(page, pageIndex * 3)}
        </section>`).join('') + `
        <div class="print-help">Pratinjau diperkecil. Klik <strong>Cetak</strong> untuk output F4 Landscape 330 × 215 mm.</div>`;

      printRoot.innerHTML = pages.map((page, pageIndex) => `
        <div class="print-page">
          ${renderPageSlots(page, pageIndex * 3)}
        </div>`).join('');
    }

    applyPrintZoom(state.printZoom || 'fit');

    const info = $('#print-selection-info');
    if (info) {
      info.textContent = employees.length
        ? `${employees.length} pegawai • ${pages.length} halaman`
        : '0 pegawai • 0 halaman';
    }
    const pageCount = $('#print-page-count');
    if (pageCount) pageCount.textContent = '3 slip / halaman (F4 Landscape)';

    const useSelected = $('#print-use-selected');
    if (useSelected) useSelected.checked = state.printUseSelected;

    renderPrintListbox();
  }

  function renderPrintListbox() {
    const list = $('#print-employee-listbox');
    if (!list) return;

    const query = (state.printEmployeeFilter || '').toLowerCase().trim();
    const filteredEmployees = query
      ? state.employees.filter((emp) =>
          (emp.nama || '').toLowerCase().includes(query) || (emp.nip || '').includes(query)
        )
      : state.employees;

    list.innerHTML = filteredEmployees.map((employee) => {
      const selected = state.selected.has(employee.nip);
      return `
        <li role="option" tabindex="0" data-nip="${escapeHtml(employee.nip)}"
            aria-selected="${selected}" aria-label="${escapeHtml(`${employee.nama}, NIP ${employee.nip}`)}">
          <strong>${escapeHtml(employee.nama)}</strong>
          <span>${escapeHtml(employee.nip)}</span>
        </li>`;
    }).join('');

    const sub = $('#print-list-sub');
    if (sub) {
      const selectedCount = state.selected.size ? `${state.selected.size} dipilih` : 'Semua pegawai';
      sub.textContent = query
        ? `${selectedCount} • ${filteredEmployees.length}/${state.employees.length} ASN`
        : selectedCount;
    }
  }

  function cicilanTag(item) {
    const text = String(item.info || item.cicilan_info || '');
    const match = text.match(/Cicilan\s+(\d+)\s+dari\s+(\d+)/i);
    if (match) return ` (${match[1]}/${match[2]})`;
    const fracMatch = text.match(/\((\d+\/\d+)\)/);
    if (fracMatch) return ` ${fracMatch[0]}`;
    if (item.kategori === 'berjangka' && item.tenor) return ` (1/${item.tenor})`;
    return '';
  }

  function slipRows(rows) {
    return rows.map(([label, value]) => `
      <div class="slip-row">
        <span>${escapeHtml(label)}</span>
        <span>${formatAmount(value)}</span>
      </div>`).join('');
  }

  function renderSlip(employee, index) {
    const opd = employee.opd || state.opdRaw || state.opd || '—';
    const incomeRows = [];
    const internalRows = [];

    if (employee.income) {
      const income = employee.income;
      if (Number(income.gapok)) incomeRows.push(['Gaji Pokok', income.gapok]);
      if (Number(income.tjistri)) incomeRows.push(['Tj. Istri / Suami', income.tjistri]);
      if (Number(income.tjanak)) incomeRows.push(['Tj. Anak', income.tjanak]);
      if (Number(income.tjberas)) incomeRows.push(['Tj. Beras', income.tjberas]);
      if (Number(income.tjaskes)) incomeRows.push(['Tj. Askes / Lainnya', income.tjaskes]);
      const known = ['gapok', 'tjistri', 'tjanak', 'tjberas', 'tjaskes']
        .reduce((sum, key) => sum + (Number(income[key]) || 0), 0);
      const other = (Number(employee.kotor) || 0) - known;
      if (Math.abs(other) >= 0.005) incomeRows.push(['Tunjangan Lain', other]);
    }

    const activePos = (state.posList || []).filter((p) => p.is_active !== false);
    if (activePos.length) {
      const items = employee.internalPotongan || [];
      const usedItemIndices = new Set();
      activePos.forEach((pos) => {
        const posName = pos.nama_pos || pos.nama || '';
        const matchingIdx = items.findIndex(
          (it, idx) =>
            !usedItemIndices.has(idx) &&
            ((posName &&
              String(it.pos || it.pos_nama || '').trim().toLowerCase() === String(posName).trim().toLowerCase()) ||
              (pos.id && (String(it.pos_id) === String(pos.id) || String(it.id) === String(pos.id))))
        );
        if (matchingIdx >= 0) {
          const item = items[matchingIdx];
          usedItemIndices.add(matchingIdx);
          const label = item.pos || item.pos_nama || posName;
          internalRows.push([`${label}${cicilanTag(item)}`, Number(item.nominal) || 0]);
        } else {
          internalRows.push([posName, 0]);
        }
      });
      items.forEach((item, idx) => {
        if (!usedItemIndices.has(idx)) {
          const label = item.pos || item.pos_nama || 'Potongan Lain';
          internalRows.push([`${label}${cicilanTag(item)}`, Number(item.nominal) || 0]);
        }
      });
    } else {
      const items = employee.internalPotongan || [];
      items.forEach((item) => {
        const label = item.pos || item.pos_nama || 'Potongan Lain';
        internalRows.push([`${label}${cicilanTag(item)}`, Number(item.nominal) || 0]);
      });
      if (!internalRows.length) {
        const baseInternal = Number(employee.basePotonganInternal) || Number(employee.potonganInternal) || 0;
        internalRows.push([
          baseInternal > 0 ? 'Potongan Internal' : 'Tidak ada potongan',
          baseInternal,
        ]);
      }
    }

    const kotor = Number(employee.kotor) || 0;
    const simgaji = Number(employee.potonganSimgaji) || 0;
    const gajiBersih = kotor - simgaji;

    const curJabatan = state.profile?.jabatan || storageGet('simgaji.jabatan', localStorage) || 'Bendahara Pengeluaran';
    const curNama = state.profile?.nama_bendahara || storageGet('simgaji.nama_bendahara', localStorage) || null;
    const curNip = state.profile?.nip_bendahara || storageGet('simgaji.nip_bendahara', localStorage) || null;

    const signTitle = escapeHtml(curJabatan) + ',';
    const signName = curNama
      ? escapeHtml(curNama)
      : '( ............................................................ )';
    const signNip = curNip
      ? `NIP. ${escapeHtml(curNip)}`
      : 'NIP. .........................................................';

    let penyesuaianPreviewHtml = '';
    const penyList = (employee.rincian_penyesuaian && employee.rincian_penyesuaian.length)
      ? employee.rincian_penyesuaian
      : (state.penyesuaianList || []).filter((p) => p.nip === employee.nip);

    if (penyList.length) {
      const penyRows = penyList.map((py) => {
        const jenis = py.jenis_penyesuaian || py.jenis || 'Penyesuaian';
        const alasan = py.keterangan || py.alasan || '';
        const nominal = Number(py.nominal) || 0;
        const desc = alasan ? `${escapeHtml(jenis)} — ${escapeHtml(alasan)}` : escapeHtml(jenis);
        return `
          <div class="slip-penyesuaian-row">
            <span>${desc}</span>
            <span>Rp ${formatAmount(nominal)}</span>
          </div>
        `;
      }).join('');
      penyesuaianPreviewHtml = `
        <div class="slip-penyesuaian">
          <div class="slip-penyesuaian-title">Informasi Penyesuaian</div>
          ${penyRows}
        </div>
      `;
    }

    return `
      <article class="slip">
        <div class="slip-header-block">
          <div class="slip-opd" title="${escapeHtml(opd)}">${escapeHtml(opd)}</div>
          <div class="slip-meta-grid">
            <div class="slip-meta-row"><span class="meta-lbl">Periode</span><span class="meta-sep">:</span><span class="meta-val">${escapeHtml(periodLabel(state.period))}</span></div>
            <div class="slip-meta-row"><span class="meta-lbl">NIP</span><span class="meta-sep">:</span><span class="meta-val">${escapeHtml(employee.nip)}</span></div>
            <div class="slip-meta-row"><span class="meta-lbl">Nama</span><span class="meta-sep">:</span><span class="meta-val">${escapeHtml(employee.nama)}</span></div>
            <div class="slip-meta-row"><span class="meta-lbl">Pangkat/Gol</span><span class="meta-sep">:</span><span class="meta-val">${escapeHtml(formatKdpangkat(employee.kdpangkat))}</span></div>
            <div class="slip-meta-row"><span class="meta-lbl">No. Rekening</span><span class="meta-sep">:</span><span class="meta-val">${escapeHtml(employee.norek || '—')}</span></div>
          </div>
        </div>
        <div class="slip-calc-block">
          <div class="slip-section-title">PENGHASILAN</div>
          ${slipRows(incomeRows)}
          <div class="slip-row total"><span>Penghasilan Kotor</span><span>${formatAmount(kotor)}</span></div>
          <div class="slip-row"><span>Potongan SIMGAJI</span><span>${formatAmount(simgaji)}</span></div>
          <div class="slip-row total highlight"><span>Gaji Bersih</span><span>${formatAmount(gajiBersih)}</span></div>

          <div class="slip-section-title" style="margin-top: 1.5mm;">POTONGAN LAINNYA</div>
          ${slipRows(internalRows)}
          <div class="slip-row total highlight"><span>Total Potongan</span><span>${formatAmount(employee.potonganInternal)}</span></div>
        </div>
        <div class="slip-foot">
          <span class="net">DITERIMA BERSIH: <strong>Rp ${formatAmount(employee.thp)}</strong></span>
        </div>
        ${penyesuaianPreviewHtml}
        <div class="slip-sign">
          <div class="slip-sign-box">
            <div class="sign-date">Salatiga, .... ${escapeHtml(periodLabel(state.period))}</div>
            <div class="sign-title">${signTitle}</div>
            <div class="sign-space"></div>
            <div class="sign-name">${signName}</div>
            <div class="sign-nip">${signNip}</div>
          </div>
        </div>
      </article>`;
  }

  /* ============================== IMPORT ============================== */

  function setProgress(percent, status, hint) {
    const pct = Math.max(0, Math.min(100, Number(percent) || 0));
    const bar = $('#import-progress-bar');
    const track = $('#import-progress');
    const statusNode = $('#import-status');
    const pctNode = $('#import-status-pct');
    const hintNode = $('#import-status-hint');
    if (bar) bar.style.width = `${pct}%`;
    if (track) track.setAttribute('aria-valuenow', String(Math.round(pct)));
    if (statusNode) statusNode.textContent = status;
    if (pctNode) pctNode.textContent = `${Math.round(pct)}%`;
    if (hintNode && hint !== undefined) hintNode.textContent = hint;
  }

  function setImportRunning(running) {
    state.importRunning = running;
    const importButton = $('#btn-import');
    const clearButton = $('#btn-clear-file');
    if (importButton) importButton.disabled = running || !state.currentFile;
    if (clearButton) clearButton.disabled = running || !state.currentFile;
  }

  function resetImportPanels() {
    const result = $('#import-result');
    const error = $('#import-error');
    if (result) result.hidden = true;
    if (error) error.hidden = true;
    setProgress(0, 'Belum ada file dipilih.', 'Pilih file SIMGAJI untuk memulai validasi.');
  }

  function clearFile() {
    state.currentFile = null;
    const input = $('#file-input');
    if (input) input.value = '';
    const card = $('#file-card');
    if (card) card.hidden = true;
    const fileStatus = $('#file-status');
    if (fileStatus) {
      fileStatus.className = 'status-pill neutral';
      fileStatus.textContent = 'Siap';
    }
    const opdStatus = $('#opd-check-status');
    if (opdStatus) {
      opdStatus.className = 'status-pill neutral';
      opdStatus.textContent = 'Menunggu file';
    }
    const firstCol = $('#first-col-value');
    if (firstCol) firstCol.textContent = '—';
    const periodFile = $('#period-file-value');
    if (periodFile) periodFile.textContent = '—';
    const fileOpd = $('#opd-file-value');
    if (fileOpd) fileOpd.textContent = '—';
    const accountOpd = $('#opd-account-value');
    if (accountOpd) accountOpd.textContent = state.opd;
    setImportRunning(false);
    resetImportPanels();
  }

  function handleFile(file) {
    if (!file) return;
    const name = String(file.name || '');
    const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    if (!['xls', 'xlsx'].includes(extension)) {
      clearFile();
      showImportError('Format file harus .xls atau .xlsx.', []);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      clearFile();
      showImportError('Ukuran file melebihi batas 20 MB.', []);
      return;
    }

    state.currentFile = file;
    const card = $('#file-card');
    if (card) card.hidden = false;
    const nameNode = $('#file-name');
    if (nameNode) nameNode.textContent = name;
    const sizeNode = $('#file-size');
    if (sizeNode) sizeNode.textContent = `${formatBytes(file.size)} • ${extension.toUpperCase()}`;
    const fileStatus = $('#file-status');
    if (fileStatus) {
      fileStatus.className = 'status-pill';
      fileStatus.textContent = 'Membaca…';
    }
    const opdStatus = $('#opd-check-status');
    if (opdStatus) {
      opdStatus.className = 'status-pill warn';
      opdStatus.textContent = 'Membaca struktur…';
    }
    const firstCol = $('#first-col-value');
    if (firstCol) firstCol.textContent = 'Membaca…';
    const periodFile = $('#period-file-value');
    if (periodFile) periodFile.textContent = 'Membaca…';
    const fileOpd = $('#opd-file-value');
    if (fileOpd) fileOpd.textContent = 'Membaca…';
    const accountOpd = $('#opd-account-value');
    if (accountOpd) accountOpd.textContent = state.opd;

    setImportRunning(false);
    resetImportPanels();
    setProgress(15, 'Membaca struktur file…', 'Mengekstrak kolom pertama (tglgaji) sebagai data periode.');

    const importButton = $('#btn-import');
    if (importButton) importButton.disabled = true;

    if (state.token) {
      const formData = new FormData();
      formData.append('file', file);
      fetch(`${API_BASE}/api/v1/payroll/inspect-excel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${state.token}` },
        body: formData,
      })
      .then((res) => res.json().then((body) => ({ ok: res.ok, status: res.status, body })))
      .then(({ ok, body }) => {
        if (!ok) {
          const detail = body && body.detail;
          const msg = typeof detail === 'string' ? detail : (detail && detail.message) || 'Gagal membaca file Excel.';
          const errs = detail && Array.isArray(detail.errors) ? detail.errors : [];
          if (fileStatus) {
            fileStatus.className = 'status-pill error';
            fileStatus.textContent = 'Gagal';
          }
          if (opdStatus) {
            opdStatus.className = 'status-pill error';
            opdStatus.textContent = 'Struktur Salah';
          }
          if (firstCol) firstCol.textContent = 'Tidak Valid';
          if (periodFile) periodFile.textContent = 'Tidak Valid';
          showImportError(msg, errs);
          return;
        }

        if (firstCol) firstCol.textContent = `${body.first_column} (Format Tanggal)`;
        if (periodFile) periodFile.textContent = `${body.period_label} (${body.period})`;
        if (fileOpd) fileOpd.textContent = body.opd || '—';
        if (fileStatus) {
          fileStatus.className = 'status-pill';
          fileStatus.textContent = 'Terverifikasi';
        }

        if (body.is_opd_match) {
          if (opdStatus) {
            opdStatus.className = 'status-pill' + (body.warning ? ' warn' : '');
            opdStatus.textContent = body.warning ? 'Sesuai (Multi-OPD)' : 'Cocok';
          }
          const hint = body.warning || `${body.total_rows} baris data terdeteksi. Klik “Mulai Import” untuk memproses.`;
          setProgress(0, `File siap diimpor untuk Periode ${body.period_label}.`, hint);
          if (importButton) importButton.disabled = false;
          const errorBox = $('#import-error');
          if (errorBox) errorBox.hidden = true;
        } else {
          if (opdStatus) {
            opdStatus.className = 'status-pill error';
            opdStatus.textContent = 'OPD Berbeda';
          }
          showImportError(body.warning || 'OPD file tidak sesuai dengan hak akses akun login Anda.', []);
          if (importButton) importButton.disabled = true;
        }
      })
      .catch((err) => {
        if (fileStatus) {
          fileStatus.className = 'status-pill';
          fileStatus.textContent = 'Siap';
        }
        if (firstCol) firstCol.textContent = 'tglgaji';
        if (periodFile) periodFile.textContent = 'Akan dibaca saat import';
        if (importButton) importButton.disabled = false;
      });
    } else {
      if (importButton) importButton.disabled = false;
    }
  }

  function showImportError(message, errors = []) {
    const result = $('#import-result');
    if (result) result.hidden = true;
    const box = $('#import-error');
    const messageNode = $('#import-error-message');
    const listNode = $('#import-error-list');
    if (box) box.hidden = false;
    if (messageNode) messageNode.textContent = message || 'Import gagal.';
    if (listNode) {
      listNode.innerHTML = (errors || []).slice(0, 8).map((error) => {
        const row = error && error.row ? `Baris ${error.row}: ` : '';
        const column = error && error.column ? `${error.column} — ` : '';
        const text = error && error.message ? error.message : String(error);
        return `<li>${escapeHtml(`${row}${column}${text}`)}</li>`;
      }).join('');
    }
    const status = $('#import-status');
    if (status) status.textContent = 'Import gagal.';
    const pct = $('#import-status-pct');
    if (pct) pct.textContent = '—';
    const hint = $('#import-status-hint');
    if (hint) hint.textContent = 'Perbaiki file lalu coba lagi.';
    const bar = $('#import-progress-bar');
    if (bar) bar.style.width = '0%';
    const opdStatus = $('#opd-check-status');
    if (opdStatus) {
      opdStatus.className = 'status-pill error';
      opdStatus.textContent = 'Perlu diperiksa';
    }
    setImportRunning(false);
  }

  function showImportResult(result) {
    const box = $('#import-result');
    const error = $('#import-error');
    if (error) error.hidden = true;
    if (box) box.hidden = false;

    const setText = (selector, value) => {
      const node = $(selector);
      if (node) node.textContent = value;
    };
    setText('#result-rows', String(Number(result.total_rows) || 0));
    setText('#result-inserted', String(Number(result.inserted) || 0));
    setText('#result-updated', String(Number(result.updated) || 0));
    setText('#result-period', `Periode ${(result.periods || [state.period]).join(', ')}`);

    const fileStatus = $('#file-status');
    if (fileStatus) {
      fileStatus.className = 'status-pill';
      fileStatus.textContent = 'Selesai';
    }
    const opdStatus = $('#opd-check-status');
    if (opdStatus) {
      opdStatus.className = 'status-pill';
      opdStatus.textContent = 'Cocok';
    }
    const fileOpd = $('#opd-file-value');
    if (fileOpd) fileOpd.textContent = result.opd || state.opd;

    setImportRunning(false);
    setProgress(100, 'Import selesai.', 'Data payroll berhasil di-upsert.');
  }

  function addImportHistory(result, filename) {
    state.imports.unshift({
      time: `${new Date().toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${relativeTimeLabel()}`,
      file: filename || (state.currentFile ? state.currentFile.name : 'SIMGAJI.xlsx'),
      opd: result.opd || state.opdRaw || state.opd,
      rows: Number(result.total_rows) || 0,
      inserted: Number(result.inserted) || 0,
      updated: Number(result.updated) || 0,
      status: 'success',
    });
    state.imports = state.imports.slice(0, 10);
  }

  function addActivity(type, title, detail, tone = '') {
    state.activities.unshift({
      type,
      title,
      detail,
      tone,
      time: relativeTimeLabel(),
    });
    state.activities = state.activities.slice(0, 8);
  }

  async function runImport() {
    if (state.profile && state.profile.is_super_admin) {
      toast('Akses Dibatasi', 'Super Admin tidak dapat mengimpor data gaji. Hak akses import hanya untuk Bendahara OPD.', 'warning');
      return;
    }
    if (isUserLocked()) {
      toast('Akses Terkunci', 'Akun Anda belum memiliki penugasan OPD dari Super Admin. Import SIMGAJI tidak dapat dilakukan.', 'error');
      return;
    }
    if (!state.currentFile || state.importRunning) return;
    if (!state.token) {
      logout();
      return;
    }

    state.importRunning = true;
    setImportRunning(true);
    const error = $('#import-error');
    const result = $('#import-result');
    if (error) error.hidden = true;
    if (result) result.hidden = true;
    setProgress(8, 'Membaca file…', 'Memeriksa struktur kolom dan OPD.');

    const filename = state.currentFile.name;
    let timer = null;
    try {
      let progress = 12;
      timer = window.setInterval(() => {
        progress = Math.min(88, progress + Math.random() * 8);
        setProgress(progress, 'Mengunggah dan memproses…', 'Server memvalidasi OPD dan melakukan upsert.');
      }, 180);

      const formData = new FormData();
      formData.append('file', state.currentFile);

      const response = await fetch(`${API_BASE}/api/v1/payroll/import-excel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${state.token}` },
        body: formData,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = body.detail;
        const message = typeof detail === 'string'
          ? detail
          : (detail && detail.message) || `Import gagal (HTTP ${response.status}).`;
        const errors = detail && Array.isArray(detail.errors) ? detail.errors : [];
        throw Object.assign(new Error(message), { errors });
      }

      window.clearInterval(timer);
      setProgress(100, 'Import selesai.', 'Data berhasil disimpan ke PostgreSQL.');
      showImportResult(body);
      addImportHistory(body, filename);
      addActivity('import', 'Import SIMGAJI berhasil', `${filename} • ${body.total_rows || 0} baris`, 'green');

      if (body.periods && body.periods.length) {
        state.period = body.periods[0];
      }
      await loadAvailablePeriods();
      toast('Import berhasil', `Data gaji periode ${periodLabel(state.period)} (${body.inserted || 0} baru, ${body.updated || 0} diperbarui) berhasil disimpan.`, 'success');
      renderAll();

      if (state.token) {
        loadApiData(state.token).then((data) => {
          applyApiData(data, state.token);
          renderAll();
        }).catch(() => {});
      }
    } catch (caught) {
      if (timer) window.clearInterval(timer);
      showImportError(caught.message || 'Import gagal.', caught.errors || []);
      toast('Import gagal', caught.message || 'Periksa file dan koneksi.', 'error');
    } finally {
      state.importRunning = false;
      setImportRunning(false);
    }
  }

  /* ============================== POTONGAN ACTIONS ============================== */

  function showFormError(name, message) {
    const node = $(`#${name}-error`);
    if (!node) return;
    node.textContent = message;
    node.hidden = false;
  }

  function hideFormError(name) {
    const node = $(`#${name}-error`);
    if (node) node.hidden = true;
  }

  function resetBulananForm() {
    const form = $('#form-bulanan');
    if (form) form.reset();
    const period = $('#bulanan-period');
    if (period) period.value = state.period;
    hideFormError('bulanan');
  }

  function submitBulanan(event) {
    event.preventDefault();
    if (state.profile && state.profile.is_super_admin) {
      toast('Akses Dibatasi', 'Super Admin tidak dapat menginput potongan.', 'warning');
      return;
    }
    if (isUserLocked()) {
      toast('Akses Terkunci', 'Akun Anda belum memiliki penugasan OPD dari Super Admin.', 'error');
      return;
    }
    hideFormError('bulanan');

    const employee = currentPotonganEmployee();
    if (!employee) {
      showFormError('bulanan', 'Pilih pegawai terlebih dahulu.');
      return;
    }
    const posSelect = $('#bulanan-pos');
    const posId = posSelect.value;
    const pos = posSelect.selectedOptions[0]
      ? (posSelect.selectedOptions[0].dataset.nama || posSelect.selectedOptions[0].textContent)
      : '';
    const nominal = parseMoneyInput($('#bulanan-nominal').value);
    if (!posId || !pos) {
      showFormError('bulanan', 'Pilih pos potongan terlebih dahulu.');
      return;
    }
    const period = $('#bulanan-period').value || state.period;
    const keterangan = $('#bulanan-keterangan').value.trim();

    if (!Number.isFinite(nominal) || nominal <= 0) {
      showFormError('bulanan', 'Nominal harus lebih besar dari 0.');
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(period)) {
      showFormError('bulanan', 'Periode tidak valid.');
      return;
    }

    const infoParts = [`Bulanan • ${periodLabel(period)}`];
    if (keterangan) infoParts.push(keterangan);
    const item = {
      id: uid('pot'),
      pos,
      pos_id: posId,
      nominal,
      info: infoParts.join(' • '),
      kategori: 'bulanan',
      period,
      keterangan,
      readOnly: false,
    };

    if (!state.token) {
      logout();
      return;
    }

    apiRequest('/api/v1/potongan/item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nip: employee.nip,
        pos_id: Number(posId),
        period,
        nominal,
      }),
    })
    .then((created) => {
      item.id = created.id;
      employee.internalPotongan = employee.internalPotongan || [];
      const existIdx = employee.internalPotongan.findIndex(
        (x) => String(x.pos_id) === String(posId) && !x.readOnly
      );
      if (existIdx >= 0) {
        employee.internalPotongan[existIdx] = item;
      } else {
        employee.internalPotongan.push(item);
      }
      recomputeEmployee(employee);
      addActivity('potongan', 'Potongan bulanan disimpan ke database', `${employee.nama} • ${pos}`, 'amber');
      renderAll();
      resetBulananForm();
      toast('Potongan disimpan', `${pos} ${formatRupiah(nominal, 0)} tersimpan ke server.`, 'success');
      void loadPotonganReferenceData();
    })
    .catch((error) => {
      showFormError('bulanan', error.message || 'Gagal menyimpan ke server');
      toast('Gagal Menyimpan', error.message || 'Terjadi kesalahan saat menyimpan.', 'error');
    });
  }

  function openEditPotonganModal(id) {
    const employee = currentPotonganEmployee();
    if (!employee) return;
    const items = employee.internalPotongan || [];
    const item = items.find((it) => it.id === id);
    if (!item) return;

    const idInput = $('#edit-potongan-id');
    const rawNipInput = $('#edit-potongan-raw-nip');
    const periodInput = $('#edit-potongan-period');
    const namaNode = $('#edit-potongan-nama');
    const nipNode = $('#edit-potongan-nip');
    const periodTextNode = $('#edit-potongan-period-text');
    const jenisTextNode = $('#edit-potongan-jenis-text');
    const posSelect = $('#edit-potongan-pos');
    const nominalInput = $('#edit-potongan-nominal');
    const ketInput = $('#edit-potongan-keterangan');
    const errNode = $('#edit-potongan-error');

    if (idInput) idInput.value = item.id;
    if (rawNipInput) rawNipInput.value = employee.nip;
    if (periodInput) periodInput.value = item.period || state.period;
    if (namaNode) namaNode.textContent = employee.nama;
    if (nipNode) nipNode.textContent = employee.nip;
    if (periodTextNode) periodTextNode.textContent = periodLabel(item.period || state.period);

    const isBerjangka = Boolean(item.readOnly || item.cicilan_info || item.kategori === 'berjangka');
    if (jenisTextNode) {
      jenisTextNode.textContent = isBerjangka
        ? `Berjangka (${item.info || 'Cicilan'})`
        : 'Bulanan';
    }

    if (posSelect) {
      posSelect.innerHTML = '';
      if (isBerjangka) {
        const opt = document.createElement('option');
        opt.value = item.pos_id || '';
        opt.textContent = `${item.pos} (Berjangka)`;
        opt.selected = true;
        posSelect.appendChild(opt);
        posSelect.disabled = true;
      } else {
        posSelect.disabled = false;
        const bulananPos = (state.posList || []).filter(
          (p) => p.kategori === 'bulanan' && (p.is_active !== false || String(p.id) === String(item.pos_id))
        );
        bulananPos.forEach((p) => {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = p.nama_pos;
          if (String(p.id) === String(item.pos_id) || (p.nama_pos && p.nama_pos === item.pos)) {
            opt.selected = true;
          }
          posSelect.appendChild(opt);
        });
        if (!posSelect.value && item.pos_id) {
          posSelect.value = item.pos_id;
        }
      }
    }

    if (nominalInput) {
      nominalInput.value = formatMoneyInput(item.nominal || 0);
    }
    if (ketInput) {
      ketInput.value = item.keterangan || '';
    }
    if (errNode) errNode.hidden = true;

    // Sinkronkan juga ke form bulanan cepat di sebelah kanan untuk kenyamanan pengguna
    const bulananPos = $('#bulanan-pos');
    const bulananNominal = $('#bulanan-nominal');
    const bulananPeriod = $('#bulanan-period');
    const bulananKet = $('#bulanan-keterangan');
    if (bulananPos && item.pos_id) bulananPos.value = item.pos_id;
    if (bulananNominal) bulananNominal.value = formatMoneyInput(item.nominal || 0);
    if (bulananPeriod) bulananPeriod.value = item.period || state.period;
    if (bulananKet) bulananKet.value = item.keterangan || '';

    openModal('edit-potongan');
  }

  async function submitEditPotongan(event) {
    if (event) event.preventDefault();
    const employee = currentPotonganEmployee();
    if (!employee) return;

    const id = $('#edit-potongan-id')?.value;
    const rawNip = $('#edit-potongan-raw-nip')?.value || employee.nip;
    const period = $('#edit-potongan-period')?.value || state.period;
    const posSelect = $('#edit-potongan-pos');
    const nominalInput = $('#edit-potongan-nominal');
    const ketInput = $('#edit-potongan-keterangan');
    const errNode = $('#edit-potongan-error');

    const nominal = parseMoneyInput(nominalInput ? nominalInput.value : '0');
    if (nominal <= 0 || isNaN(nominal)) {
      if (errNode) {
        errNode.textContent = 'Nominal potongan harus lebih besar dari 0.';
        errNode.hidden = false;
      }
      return;
    }

    const posId = posSelect ? posSelect.value : null;
    const keterangan = ketInput ? ketInput.value.trim() : '';

    const items = employee.internalPotongan || [];
    const item = items.find((it) => it.id === id);
    if (!item) {
      if (errNode) {
        errNode.textContent = 'Item potongan tidak ditemukan.';
        errNode.hidden = false;
      }
      return;
    }

    const isBerjangka = Boolean(item.readOnly || item.cicilan_info || item.kategori === 'berjangka');
    const targetPosId = posId || item.pos_id;

    if (!targetPosId && !isBerjangka) {
      if (errNode) {
        errNode.textContent = 'Pilih pos potongan terlebih dahulu.';
        errNode.hidden = false;
      }
      return;
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id));

    try {
      if (errNode) errNode.hidden = true;
      setStatus('Menyimpan perubahan potongan…');

      let updatedData = null;
      if (isUuid) {
        updatedData = await apiRequest(`/api/v1/potongan/item/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pos_id: targetPosId ? Number(targetPosId) : undefined,
            nominal: nominal,
          }),
        });
      } else {
        updatedData = await apiRequest('/api/v1/potongan/item', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nip: rawNip,
            pos_id: Number(targetPosId),
            period: period,
            nominal: nominal,
          }),
        });
      }

      if (updatedData && updatedData.id) {
        item.id = updatedData.id;
      }
      item.nominal = nominal;
      if (!isBerjangka && targetPosId) {
        item.pos_id = targetPosId;
        const matchingPos = (state.posList || []).find((p) => String(p.id) === String(targetPosId));
        if (matchingPos) {
          item.pos = matchingPos.nama_pos;
          item.pos_nama = matchingPos.nama_pos;
        }
      }
      if (keterangan) {
        item.keterangan = keterangan;
        item.info = isBerjangka ? item.info : `Bulanan • ${periodLabel(period)} • ${keterangan}`;
      }

      recomputeEmployee(employee);
      addActivity('potongan', 'Data potongan berhasil diperbarui', `${employee.nama} • ${item.pos}`, 'amber');
      renderAll();
      closeModal('edit-potongan');
      toast('Potongan Diperbarui', `${item.pos} sebesar ${formatRupiah(nominal, 0)} berhasil disimpan.`, 'success');
      void loadPotonganReferenceData();
    } catch (err) {
      if (errNode) {
        errNode.textContent = err.message || 'Gagal menyimpan perubahan ke server.';
        errNode.hidden = false;
      }
      toast('Gagal Menyimpan', err.message || 'Terjadi kesalahan saat menyimpan.', 'error');
    } finally {
      setStatus('Siap');
    }
  }

  function deletePotongan(id) {
    const employee = currentPotonganEmployee();
    if (!employee) return;
    const items = employee.internalPotongan || [];
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return;
    if (items[index].readOnly) {
      toast('Tidak dapat dihapus', 'Potongan ini berasal dari cicilan pinjaman berjangka.', 'error');
      return;
    }

    if (!state.token) {
      logout();
      return;
    }

    if (id && !id.startsWith('pot_')) {
      apiRequest(`/api/v1/potongan/item/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      .then(() => {
        const [removed] = items.splice(index, 1);
        recomputeEmployee(employee);
        addActivity('potongan', 'Potongan dihapus dari database', `${employee.nama} • ${removed.pos}`, 'amber');
        renderAll();
        toast('Potongan dihapus', `${removed.pos} berhasil dihapus dari database.`, 'info');
        void loadPotonganReferenceData();
      })
      .catch((error) => {
        toast('Gagal Menghapus', error.message || 'Terjadi kesalahan saat menghapus.', 'error');
      });
    }
  }

  /* ============================== API / CONNECTION ============================== */

  function mapApiEmployee(raw) {
    return {
      nip: raw.nip,
      nama: raw.nama,
      kdpangkat: formatKdpangkat(raw.kdpangkat),
      norek: raw.norek || '—',
      opd: raw.opd,
      kotor: Number(raw.penghasilan_kotor) || 0,
      potonganSimgaji: Number(raw.potongan_simgaji) || 0,
      potonganInternal: Number(raw.potongan_internal) || 0,
      totalPotongan: Number(raw.total_potongan) || 0,
      thp: Number(raw.take_home_pay) || 0,
      income: null,
      resmi: null,
      internalPotongan: [],
      basePotonganInternal: Number(raw.potongan_internal) || 0,
      summaryOnly: true,
    };
  }

  async function loadApiData(token) {
    const response = await fetch(
      `${API_BASE}/api/v1/dashboard/summary?period=${encodeURIComponent(state.period)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = body.detail;
      const message = typeof detail === 'string'
        ? detail
        : (detail && detail.message) || `Gagal memuat data (HTTP ${response.status}).`;
      throw new Error(message);
    }
    return body;
  }

  function applyApiData(data, token, resetSessionHistory = false) {
    state.mode = 'api';
    state.token = token;
    const isSuperAdmin = Boolean(state.profile && state.profile.is_super_admin);
    state.opd = isSuperAdmin ? 'Tidak Terikat OPD' : (data.opd || 'Semua OPD');
    state.opdRaw = isSuperAdmin ? '' : (data.opd || '');
    state.employees = (data.employees || []).map(mapApiEmployee);
    state.selected = new Set();
    state.potonganNip = state.employees[0] ? state.employees[0].nip : '';
    state.posList = [];
    state.loans = [];

    if (resetSessionHistory) {
      state.imports = [];
      state.activities = [{
        type: 'sync',
        tone: '',
        title: 'Data API dimuat',
        detail: `${state.employees.length} pegawai • ${periodLabel(state.period)}`,
        time: relativeTimeLabel(),
      }];
    }

    if (data.period_recap) {
      state.periodRecap = data.period_recap;
      if (Array.isArray(data.period_recap.available_periods)) {
        state.availablePeriods = data.period_recap.available_periods;
      }
      buildPeriodSelects();
    }

    if (Array.isArray(data.trend)) {
      state.trend = data.trend;
    }

    storageSet('simgaji.mode', 'api', localStorage);
    storageSet('simgaji.token', token, sessionStorage);
    renderAll();
    if (!isSuperAdmin) {
      void loadPotonganReferenceData();
    }
  }

  async function loadAvailablePeriods() {
    if (!state.token) return;
    try {
      const recap = await apiRequest('/api/v1/payroll/periods');
      if (recap) {
        state.periodRecap = recap;
        if (Array.isArray(recap.available_periods)) {
          state.availablePeriods = recap.available_periods;
        }
        buildPeriodSelects();
        renderPeriodRecap();
      }
    } catch {
      // fallback silent
    }
  }

  function promptLogin(message) {
    logout();
    if (message) toast('Autentikasi Diperlukan', message, 'warning');
  }

  function openConnectionModal() {
    const tokenInput = $('#api-token');
    if (tokenInput) tokenInput.value = state.token || '';
    const error = $('#connection-error');
    if (error) error.hidden = true;

    const authInfo = $('#user-signed-in-info');
    if (state.profile && state.token) {
      if (authInfo) authInfo.hidden = false;
      const emailEl = $('#auth-info-email');
      if (emailEl) emailEl.textContent = state.profile.email;
      const roleEl = $('#auth-info-role');
      if (roleEl) {
        roleEl.textContent = `${state.profile.role === 'super_admin' ? 'Super Admin' : 'Bendahara OPD'} • ${state.profile.opd_name || 'Semua OPD'}`;
      }
    } else {
      if (authInfo) authInfo.hidden = true;
    }
    openModal('connection');
  }

  async function applyConnection() {
    const error = $('#connection-error');
    if (error) error.hidden = true;

    const tokenInput = $('#api-token');
    const token = tokenInput ? tokenInput.value.trim() : '';
    if (!token) {
      if (error) {
        error.textContent = 'Silakan klik "Masuk dengan Google" atau tempel Firebase ID Token.';
        error.hidden = false;
      }
      return;
    }

    const button = $('#btn-apply-connection');
    if (button) button.disabled = true;
    try {
      const profile = await connectApiSession(token);
      if (!profile.needs_opd) {
        closeModal();
        toast('Terhubung ke API', `Login berhasil sebagai ${profile.email}.`, 'success');
      }
    } catch (caught) {
      if (error) {
        error.textContent = caught.message || 'Gagal terhubung ke API.';
        error.hidden = false;
      }
    } finally {
      if (button) button.disabled = false;
    }
  }

  function initFirebase() {
    if (typeof window.firebase === 'undefined' || !firebase.initializeApp) {
      return;
    }
    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(FIREBASE_CONFIG);
      }
      firebase.auth().onAuthStateChanged(async (user) => {
        if (user) {
          try {
            if (user.photoURL) {
              state.photoURL = user.photoURL;
              storageSet('simgaji.photoURL', user.photoURL, localStorage);
            }
            const token = await user.getIdToken();
            state.token = token;
            storageSet('simgaji.token', token, sessionStorage);
            if (!state.profile) {
              await connectApiSession(token);
              closeModal();
            } else {
              updateProfileUI();
            }
          } catch (_) {}
        }
      });
      firebase.auth().onIdTokenChanged(async (user) => {
        if (user) {
          try {
            const token = await user.getIdToken();
            state.token = token;
            storageSet('simgaji.token', token, sessionStorage);
          } catch (_) {}
        }
      });
    } catch (err) {
      console.warn('Firebase init warning:', err);
    }
  }

  async function loginWithGoogle(errorSelector = '#connection-error') {
    const error = $(errorSelector) || $('#login-page-error') || $('#connection-error');
    if (error) error.hidden = true;
    const btn = $('#btn-google-login');
    const pageBtn = $('#login-page-google-btn');
    if (btn) btn.disabled = true;
    if (pageBtn) pageBtn.disabled = true;

    try {
      if (typeof window.firebase === 'undefined' || !firebase.auth) {
        throw new Error('Firebase SDK belum termuat. Pastikan ada koneksi internet.');
      }
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const cred = await firebase.auth().signInWithPopup(provider);
      if (cred.user && cred.user.photoURL) {
        state.photoURL = cred.user.photoURL;
        storageSet('simgaji.photoURL', cred.user.photoURL, localStorage);
      }
      const token = await cred.user.getIdToken(true);

      const tokenInput = $('#api-token');
      if (tokenInput) tokenInput.value = token;

      const profile = await connectApiSession(token);
      showAppScreen();
      closeModal();
      if (!profile.needs_opd) {
        toast('Login Berhasil', `Masuk sebagai ${cred.user.email}.`, 'success');
      }
    } catch (caught) {
      if (error) {
        if (window.location.protocol === 'file:') {
          error.innerHTML = 'Aplikasi dibuka langsung dari file (<code>file://</code>). Google OAuth membutuhkan web server.<br>Silakan buka melalui server lokal (misalnya <code>http://localhost:8000</code>).';
        } else if (caught.code === 'auth/unauthorized-domain') {
          const currentHost = window.location.hostname || window.location.host;
          error.innerHTML = 'Domain <b>' + currentHost + '</b> belum diizinkan di Firebase.<br>Silakan buka <b>Firebase Console &rarr; Authentication &rarr; Settings &rarr; Authorized domains</b> lalu tambahkan: <code>' + currentHost + '</code>';
        } else {
          error.textContent = caught.message || 'Gagal login dengan Google.';
        }
        error.hidden = false;
      }
      toast('Login Gagal', caught.message || 'Gagal login dengan Google.', 'error');
    } finally {
      if (btn) btn.disabled = false;
      if (pageBtn) pageBtn.disabled = false;
    }
  }

  async function applyLoginPageToken() {
    const tokenInput = $('#login-page-token');
    const token = tokenInput ? tokenInput.value.trim() : '';
    const error = $('#login-page-error');
    if (error) error.hidden = true;

    if (!token) {
      if (error) {
        error.textContent = 'Silakan masukkan Firebase ID Token terlebih dahulu.';
        error.hidden = false;
      }
      return;
    }

    const btn = $('#login-page-token-btn');
    if (btn) btn.disabled = true;
    try {
      const profile = await connectApiSession(token);
      showAppScreen();
      if (!profile.needs_opd) {
        toast('Login Berhasil', `Masuk sebagai ${profile.email}.`, 'success');
      }
    } catch (caught) {
      if (error) {
        error.textContent = caught.message || 'Gagal masuk dengan token.';
        error.hidden = false;
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function refreshData() {
    if (!state.token) {
      logout();
      return;
    }
    if (isUserLocked()) {
      toast('Akun Belum Ada OPD', 'Akun Anda belum memiliki penugasan OPD dari Super Admin.', 'warning');
      return;
    }
    setStatus('Memuat ulang data…');
    try {
      const data = await loadApiData(state.token);
      applyApiData(data, state.token);
      toast('Data diperbarui', 'Ringkasan dashboard berhasil dimuat ulang.', 'success');
    } catch (caught) {
      toast('Gagal memuat ulang', caught.message || 'Periksa koneksi dan token.', 'error');
    }
  }


  async function fetchSlipData(nip, period) {
    return await apiRequest(`/api/v1/payroll/${nip}?period=${period}`);
  }

  async function fetchOpdSlipData(period) {
    const data = await apiRequest(`/api/v1/payroll/opd/summary?period=${period}`);
    return data.employees;
  }

  async function doPrint(dataList, period) {
    if (state.mode === 'api' && state.token && (!state.penyesuaianList || !state.penyesuaianList.length || state.penyesuaianLoadedPeriod !== period)) {
      try {
        const pList = await apiRequest(`/api/v1/payroll/penyesuaian?period=${encodeURIComponent(period)}`);
        state.penyesuaianList = Array.isArray(pList) ? pList : [];
        state.penyesuaianLoadedPeriod = period;
      } catch (e) {
        console.warn('Gagal memuat penyesuaian gaji untuk cetak:', e);
      }
    }
    dataList.forEach((data) => {
      if (!data.rincian_penyesuaian || !data.rincian_penyesuaian.length) {
        const matching = (state.penyesuaianList || []).filter((p) => p.nip === data.nip);
        if (matching.length) {
          data.rincian_penyesuaian = matching;
        }
      }
    });
    const win = window.open('', '_blank', 'width=800,height=600');
    const template = await (await fetch('/template_slip_f4.html')).text();
    const curJab = state.profile?.jabatan || storageGet('simgaji.jabatan', localStorage) || 'Bendahara Pengeluaran';
    const curNama = state.profile?.nama_bendahara || storageGet('simgaji.nama_bendahara', localStorage) || null;
    const curNip = state.profile?.nip_bendahara || storageGet('simgaji.nip_bendahara', localStorage) || null;
    win.document.write(template);
    win.document.close();
    win.onload = () => {
        win.renderSlips(dataList, period, {
          jabatan: curJab,
          nama_bendahara: curNama,
          nip_bendahara: curNip,
        }, state.posList || []);
        win.print();
    };
  }

  /* ============================== VIEW / WINDOW ============================== */

  const VIEW_TITLES = {
    dashboard: 'Dashboard',
    'master-gaji': 'Master Gaji',
    import: 'Import SIMGAJI',
    potongan: 'Potongan Rekap',
    'potongan-asn': 'Potongan per ASN',
    print: 'Cetak Slip',
    monitoring: 'Monitoring Aktivitas',
    'master-opd': 'Master OPD',
    'master-user': 'Master Pengguna',
    database: 'Manajemen Database',
  };

  function setView(view, silent = false) {
    const next = VIEW_TITLES[view] ? view : 'dashboard';

    // Guard untuk Super Admin: sembunyikan & cegah akses modul operasional bendahara tertentu
    const superAdminDisallowed = ['import', 'potongan', 'potongan-asn', 'print'];
    if (state.profile && state.profile.is_super_admin && superAdminDisallowed.includes(next)) {
      toast('Akses Dibatasi', `Menu ${VIEW_TITLES[next] || next} khusus untuk Bendahara OPD. Super Admin tidak terikat ke OPD operasional.`, 'warning');
      setView('dashboard');
      return;
    }

    state.view = next;

    $$('.view').forEach((section) => {
      const active = section.dataset.view === next;
      section.hidden = !active;
      section.classList.toggle('active', active);
    });

    const activeNavKey = next === 'import' ? 'master-gaji' : next;
    $$('[data-view-link]').forEach((button) => {
      const isSide = button.classList.contains('side-nav-item');
      const active = button.dataset.viewLink === activeNavKey;
      if (isSide) {
        button.classList.toggle('active', active);
        if (active) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      }
    });

    const crumb = $('#toolbar-crumb');
    if (crumb) crumb.textContent = next === 'import' ? 'Master Gaji • Import SIMGAJI' : VIEW_TITLES[next];
    const content = $('#app-content');
    if (content) content.scrollTop = 0;
    const startMenu = $('#start-menu');
    if (startMenu) startMenu.hidden = true;
    const orb = $('#start-orb');
    if (orb) orb.setAttribute('aria-expanded', 'false');

    if (next === 'print') {
      renderPrintPreview();
      const posPromise = (!state.posList || !state.posList.length)
        ? loadPotonganReferenceData()
        : Promise.resolve();
      posPromise.then(async () => {
        renderPrintPreview();
        await ensurePrintEmployeesLoaded();
        renderPrintPreview();
      });
      setTimeout(() => applyPrintZoom(state.printZoom || 'fit'), 40);
    }
    if (next === 'potongan') {
      renderRekapBulanan();
      void loadRekapBulanan();
      renderRekapBerjangka();
      void loadRekapBerjangka();
      void loadLoans();
    }
    if (next === 'potongan-asn') {
      renderPotongan();
      if (state.potonganNip) {
        void loadEmployeePotongan(state.potonganNip, state.period);
      }
    }
    if (next === 'dashboard') renderDashboard(computeTotals());
    if (next === 'master-gaji') loadMasterGaji();
    if (next === 'monitoring') loadMonitoringAudit();
    if (next === 'master-opd') loadMasterOpd();
    if (next === 'master-user') loadMasterUsers();
    if (next === 'database') {
      if (!(state.profile && state.profile.is_super_admin)) {
        toast('Akses Dibatasi', 'Halaman Manajemen Database hanya untuk Super Admin.', 'warning');
        setView('dashboard');
        return;
      }
      loadDatabaseStats();
    }
    setStatus(`Halaman ${VIEW_TITLES[next]} siap.`);
    if (!silent) {
      // no-op; hook for page transitions
    }
  }

  function updateClock() {
    const now = new Date();
    const time = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const date = now.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeNode = $('#clock-time');
    const dateNode = $('#clock-date');
    if (timeNode) timeNode.textContent = time;
    if (dateNode) dateNode.textContent = date;
  }

  function minimizeWindow() {
    const windowNode = $('#app-window');
    if (!windowNode) return;
    windowNode.classList.add('is-minimized');
    const appButton = $('#taskbar-app');
    if (appButton) appButton.classList.remove('active');
    const shortcut = $('#closed-shortcut');
    if (shortcut) shortcut.hidden = true;
    toast('Jendela diminimize', 'Klik tombol SLIP GAJI ASN pada taskbar untuk membuka.', 'info');
  }

  function restoreWindow() {
    const windowNode = $('#app-window');
    if (!windowNode) return;
    windowNode.classList.remove('is-minimized', 'is-closed');
    const appButton = $('#taskbar-app');
    if (appButton) appButton.classList.add('active');
    const shortcut = $('#closed-shortcut');
    if (shortcut) shortcut.hidden = true;
    setStatus('Jendela aktif.');
  }

  function closeWindow() {
    const windowNode = $('#app-window');
    if (!windowNode) return;
    windowNode.classList.add('is-closed');
    const appButton = $('#taskbar-app');
    if (appButton) appButton.classList.remove('active');
    const shortcut = $('#closed-shortcut');
    if (shortcut) shortcut.hidden = false;
    closeModal();
    toast('Aplikasi ditutup', 'Klik ikon SLIP GAJI ASN di desktop untuk membuka kembali.', 'info');
  }

  function toggleMaximize(force) {
    const windowNode = $('#app-window');
    if (!windowNode) return;
    const isCurrentlyMax = windowNode.classList.contains('is-maximized');
    const shouldMaximize = typeof force === 'boolean' ? force : !isCurrentlyMax;
    windowNode.classList.toggle('is-maximized', shouldMaximize);
    const maximizeButton = document.querySelector('[data-window-action="maximize"], [data-window-action="restore"]');
    if (maximizeButton) {
      maximizeButton.setAttribute('aria-label', shouldMaximize ? 'Restore' : 'Maximize');
      maximizeButton.setAttribute('title', shouldMaximize ? 'Restore Down' : 'Maximize');
      maximizeButton.setAttribute('data-window-action', shouldMaximize ? 'restore' : 'maximize');
    }
  }

  function toggleStartMenu() {
    const menu = $('#start-menu');
    const orb = $('#start-orb');
    if (!menu) return;
    const open = menu.hidden;
    menu.hidden = !open;
    if (orb) orb.setAttribute('aria-expanded', String(open));
  }

  function handleWindowAction(action) {
    if (action === 'minimize') minimizeWindow();
    else if (action === 'maximize') toggleMaximize(true);
    else if (action === 'restore') toggleMaximize(false);
    else if (action === 'close') openModal('close');
  }

  /* ============================== MODALS / TOAST ============================== */

  function openModal(name) {
    const layer = $('#modal-layer');
    if (!layer) return;
    layer.hidden = false;
    $$('[data-modal]', layer).forEach((modal) => {
      modal.hidden = modal.dataset.modal !== name;
    });
    const modal = layer.querySelector(`[data-modal="${name}"]`);
    if (modal) {
      const focusTarget = modal.querySelector('button, input, select');
      if (focusTarget) window.setTimeout(() => focusTarget.focus(), 30);
    }
    const startMenu = $('#start-menu');
    if (startMenu) startMenu.hidden = true;
    const orb = $('#start-orb');
    if (orb) orb.setAttribute('aria-expanded', 'false');
  }

  function closeModal() {
    const layer = $('#modal-layer');
    if (layer) layer.hidden = true;
    state.profileChangeMode = false;
  }

  function toast(title, message, type = 'info') {
    const stack = $('#toast-stack');
    if (!stack) return;
    const icons = {
      success: '#icon-check',
      error: '#icon-warning',
      info: '#icon-info',
    };
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.innerHTML = `
      <svg class="icon"><use href="${icons[type] || icons.info}"></use></svg>
      <div class="toast-copy"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message || '')}</span></div>`;
    stack.appendChild(node);
    while (stack.children.length > 3) stack.removeChild(stack.firstElementChild);
    window.setTimeout(() => {
      node.classList.add('is-out');
      window.setTimeout(() => node.remove(), 180);
    }, 4200);
  }

  /* ============================== TABS ============================== */

  function setTab(tab) {
    const validTabs = ['rekap-bulanan', 'rekap-berjangka', 'berjangka'];
    const target = validTabs.includes(tab) ? tab : 'rekap-bulanan';
    const shell = $('#potongan-tabs');
    if (!shell) return;

    shell.querySelectorAll('button[role="tab"]').forEach((button) => {
      const selected = button.dataset.tab === target;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    shell.querySelectorAll('[role="tabpanel"]').forEach((panel) => {
      panel.hidden = panel.id !== `tab-panel-${target}`;
    });
    state.potonganTab = target;
    if (target === 'rekap-bulanan') {
      renderRekapBulanan();
      void loadRekapBulanan();
    } else if (target === 'rekap-berjangka') {
      renderRekapBerjangka();
      void loadRekapBerjangka();
    } else if (target === 'berjangka') {
      renderLoansTable();
      void loadLoans();
    }
  }

  /* ============================== EVENTS ============================== */

  let pickerYear = parseInt((state.period || DEFAULT_PERIOD).split('-')[0], 10) || new Date().getFullYear();

  function updateToolbarPeriodUI() {
    const label = $('#toolbar-period-val');
    if (label) label.textContent = periodLabel(state.period);
    const ind = $('#period-active-indicator');
    if (ind) ind.innerHTML = `Periode Aktif: <strong>${escapeHtml(periodLabel(state.period))}</strong>`;
  }

  function renderPeriodPicker(year) {
    pickerYear = Number(year) || pickerYear;
    const yearDisplay = $('#period-display-year');
    if (yearDisplay) yearDisplay.textContent = String(pickerYear);

    const grid = $('#period-month-grid');
    const specialGrid = $('#period-special-grid');
    if (!grid) return;

    const available = new Set(state.availablePeriods || []);
    let html = '';
    for (let m = 1; m <= 12; m += 1) {
      const pStr = `${pickerYear}-${String(m).padStart(2, '0')}`;
      const isActive = pStr === state.period;
      const hasData = available.has(pStr);
      const mName = MONTH_SHORT[m - 1] || String(m);

      html += `
        <button type="button" class="month-cell-btn ${isActive ? 'is-active' : ''}" data-period="${pStr}" title="${MONTH_NAMES[m - 1]} ${pickerYear}${hasData ? ' (Ada Data)' : ''}">
          <span>${escapeHtml(mName)}</span>
          ${hasData ? '<span class="has-data-dot" title="Data tersedia"></span>' : ''}
        </button>
      `;
    }
    grid.innerHTML = html;

    if (specialGrid) {
      const p13 = `${pickerYear}-13`;
      const p14 = `${pickerYear}-14`;
      const is13Active = p13 === state.period;
      const is14Active = p14 === state.period;
      const hasData13 = available.has(p13);
      const hasData14 = available.has(p14);

      specialGrid.innerHTML = `
        <button type="button" class="special-period-btn ${is13Active ? 'is-active' : ''}" data-period="${p13}" title="Gaji 13 ${pickerYear}${hasData13 ? ' (Ada Data)' : ''}">
          <span>Gaji 13</span>
          ${hasData13 ? '<span class="has-data-dot" title="Data tersedia"></span>' : ''}
        </button>
        <button type="button" class="special-period-btn ${is14Active ? 'is-active' : ''}" data-period="${p14}" title="Gaji THR ${pickerYear}${hasData14 ? ' (Ada Data)' : ''}">
          <span>Gaji THR</span>
          ${hasData14 ? '<span class="has-data-dot" title="Data tersedia"></span>' : ''}
        </button>
      `;
    }

    updateToolbarPeriodUI();
  }

  function setPeriod(newPeriod) {
    if (!newPeriod) return;
    state.period = newPeriod;
    state.selected = new Set();
    ['#period-select', '#bulanan-period', '#manual-period', '#loan-start', '#db-del-period'].forEach((selector) => {
      const el = $(selector);
      if (el) el.value = state.period;
    });

    const [y] = state.period.split('-').map(Number);
    if (y) pickerYear = y;

    updateToolbarPeriodUI();
    renderPeriodPicker(pickerYear);
    renderAll();
    if (state.view === 'master-gaji') {
      void loadMasterGaji();
    }
    if (state.token) {
      loadApiData(state.token).then(async (data) => {
        applyApiData(data, state.token);
        await loadPotonganReferenceData();
        renderAll();
        if (state.view === 'master-gaji') {
          void loadMasterGaji();
        }
        if (state.view === 'print') {
          await ensurePrintEmployeesLoaded();
          renderPrintPreview();
        }
        toast('Periode diperbarui', periodLabel(state.period), 'info');
      }).catch((caught) => {
        toast('Gagal memuat periode', caught.message || 'Periksa koneksi.', 'error');
      });
    } else {
      toast('Periode diperbarui', periodLabel(state.period), 'info');
    }
  }

  function initPeriodPicker() {
    const trigger = $('#btn-period-trigger');
    const panel = $('#period-floating-panel');
    const closeBtn = $('#period-panel-close');
    const prevYear = $('#period-prev-year');
    const nextYear = $('#period-next-year');
    const btnNextMonth = $('#btn-period-next-month');
    const btnCurrentMonth = $('#btn-period-current-month');
    const grid = $('#period-month-grid');

    if (trigger && panel) {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = panel.hidden;
        panel.hidden = !isHidden;
        trigger.setAttribute('aria-expanded', String(isHidden));
        if (isHidden) {
          const [y] = (state.period || '').split('-').map(Number);
          if (y) pickerYear = y;
          renderPeriodPicker(pickerYear);
        }
      });
    }

    if (closeBtn && panel && trigger) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
      });
    }

    if (prevYear) {
      prevYear.addEventListener('click', (e) => {
        e.stopPropagation();
        pickerYear -= 1;
        renderPeriodPicker(pickerYear);
      });
    }

    if (nextYear) {
      nextYear.addEventListener('click', (e) => {
        e.stopPropagation();
        pickerYear += 1;
        renderPeriodPicker(pickerYear);
      });
    }

    if (btnNextMonth && panel && trigger) {
      btnNextMonth.addEventListener('click', (e) => {
        e.stopPropagation();
        setPeriod(getDefaultPeriod());
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
      });
    }

    if (btnCurrentMonth && panel && trigger) {
      btnCurrentMonth.addEventListener('click', (e) => {
        e.stopPropagation();
        const now = new Date();
        const curPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        setPeriod(curPeriod);
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
      });
    }

    if (panel && trigger) {
      panel.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-period]');
        if (btn) {
          e.stopPropagation();
          setPeriod(btn.dataset.period);
          panel.hidden = true;
          trigger.setAttribute('aria-expanded', 'false');
        }
      });
    }

    document.addEventListener('click', (e) => {
      if (panel && !panel.hidden && !e.target.closest('#period-floating-wrapper')) {
        panel.hidden = true;
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel && !panel.hidden) {
        panel.hidden = true;
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
      }
    });

    renderPeriodPicker(pickerYear);
    updateToolbarPeriodUI();
  }

  function buildPeriodSelects() {
    const all = getAllPeriods();
    const options = all.map((period) => (
      `<option value="${period}">${periodLabel(period)}</option>`
    )).join('');
    ['#period-select', '#bulanan-period', '#manual-period', '#loan-start', '#db-del-period'].forEach((selector) => {
      const select = $(selector);
      if (select) {
        select.innerHTML = options;
        select.value = state.period;
      }
    });
    updateToolbarPeriodUI();
    renderPeriodPicker(pickerYear);
  }

  function bindEvents() {
    const titleBar = $('#title-bar');
    if (titleBar) {
      titleBar.addEventListener('dblclick', (event) => {
        if (event.target.closest('.title-bar-controls')) return;
        toggleMaximize();
      });
    }

    // Navigasi
    document.addEventListener('click', (event) => {
      const viewButton = event.target.closest('[data-view-link]');
      if (viewButton) {
        if (viewButton.disabled) return;
        event.preventDefault();
        setView(viewButton.dataset.viewLink);
        return;
      }

      const windowButton = event.target.closest('[data-window-action]');
      if (windowButton) {
        event.preventDefault();
        const action = windowButton.dataset.windowAction;
        if (action === 'close') openModal('close');
        else handleWindowAction(action);
        return;
      }

      const openDialogButton = event.target.closest('[data-open-modal]');
      if (openDialogButton) {
        if (openDialogButton.disabled) return;
        event.preventDefault();
        const dialog = openDialogButton.dataset.openModal;
        if (dialog === 'loan') openLoanDialog();
        else if (dialog === 'pos') openPosDialog();
        else if (dialog === 'manual-import') openManualImport();
        else if (dialog === 'browse-pegawai') openBrowsePegawaiModal();
        else if (dialog === 'signature-settings') openSignatureModal();
        else openModal(dialog);
        return;
      }

      const btnZoomInDelegated = event.target.closest('#btn-zoom-in');
      if (btnZoomInDelegated) {
        event.preventDefault();
        stepPrintZoom(1);
        return;
      }

      const btnZoomOutDelegated = event.target.closest('#btn-zoom-out');
      if (btnZoomOutDelegated) {
        event.preventDefault();
        stepPrintZoom(-1);
        return;
      }

      const closeButton = event.target.closest('[data-close-modal]');
      if (closeButton) {
        event.preventDefault();
        closeModal();
        return;
      }

      const printOne = event.target.closest('[data-action="print-one"]');
      if (printOne) {
        event.preventDefault();
        const nip = printOne.dataset.nip;
        state.selected = new Set([nip]);
        state.printUseSelected = true;
        const useSelected = $('#print-use-selected');
        if (useSelected) useSelected.checked = true;
        renderEmployeeTable();
        setView('print');
        return;
      }

      const editButton = event.target.closest('[data-edit-potongan]');
      if (editButton) {
        event.preventDefault();
        openEditPotonganModal(editButton.dataset.editPotongan);
        return;
      }

      const deleteButton = event.target.closest('[data-delete-potongan]');
      if (deleteButton) {
        event.preventDefault();
        deletePotongan(deleteButton.dataset.deletePotongan);
        return;
      }

      if (!event.target.closest('#start-menu') && !event.target.closest('#start-orb')) {
        const menu = $('#start-menu');
        if (menu) menu.hidden = true;
        const orb = $('#start-orb');
        if (orb) orb.setAttribute('aria-expanded', 'false');
      }
    });

    // Period
    const periodSelect = $('#period-select');
    if (periodSelect) {
      periodSelect.addEventListener('change', () => {
        setPeriod(periodSelect.value);
      });
    }
    initPeriodPicker();

    // Pencarian pegawai
    const search = $('#employee-search');
    if (search) {
      search.addEventListener('input', () => {
        searchQuery = search.value;
        renderEmployeeTable();
      });
    }

    // Pilihan cetak
    const selectAll = $('#select-all-employees');
    if (selectAll) {
      selectAll.addEventListener('change', () => {
        const employees = getFilteredEmployees();
        if (selectAll.checked) employees.forEach((employee) => state.selected.add(employee.nip));
        else employees.forEach((employee) => state.selected.delete(employee.nip));
        renderEmployeeTable();
        if (state.view === 'print') renderPrintPreview();
      });
    }

    const employeeBody = $('#employee-table-body');
    if (employeeBody) {
      employeeBody.addEventListener('change', (event) => {
        const checkbox = event.target.closest('.employee-check');
        if (!checkbox) return;
        if (checkbox.checked) state.selected.add(checkbox.dataset.nip);
        else state.selected.delete(checkbox.dataset.nip);
        const row = checkbox.closest('tr');
        if (row) row.classList.toggle('is-selected', checkbox.checked);
        updateSelectionControls();
        if (state.view === 'print') renderPrintPreview();
      });
    }

    // Import: drop zone dan file input
    const dropZone = $('#drop-zone');
    const fileInput = $('#file-input');
    if (dropZone && fileInput) {
      dropZone.addEventListener('click', () => {
        if (state.profile && state.profile.is_super_admin) {
          toast('Akses Dibatasi', 'Super Admin tidak dapat mengimpor data gaji. Hak akses import hanya untuk Bendahara OPD.', 'warning');
          return;
        }
        fileInput.click();
      });
      dropZone.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (state.profile && state.profile.is_super_admin) {
            toast('Akses Dibatasi', 'Super Admin tidak dapat mengimpor data gaji. Hak akses import hanya untuk Bendahara OPD.', 'warning');
            return;
          }
          fileInput.click();
        }
      });
      fileInput.addEventListener('change', () => {
        if (state.profile && state.profile.is_super_admin) return;
        if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
      });
      ['dragenter', 'dragover'].forEach((type) => {
        dropZone.addEventListener(type, (event) => {
          event.preventDefault();
          if (state.profile && state.profile.is_super_admin) return;
          dropZone.classList.add('is-dragover');
        });
      });
      ['dragleave', 'drop'].forEach((type) => {
        dropZone.addEventListener(type, (event) => {
          event.preventDefault();
          dropZone.classList.remove('is-dragover');
        });
      });
      dropZone.addEventListener('drop', (event) => {
        if (state.profile && state.profile.is_super_admin) {
          toast('Akses Dibatasi', 'Super Admin tidak dapat mengimpor data gaji.', 'warning');
          return;
        }
        const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
        if (file) handleFile(file);
      });
    }

    const importButton = $('#btn-import');
    if (importButton) importButton.addEventListener('click', runImport);
    const clearButton = $('#btn-clear-file');
    if (clearButton) clearButton.addEventListener('click', clearFile);
    const resultDashboard = $('#btn-result-dashboard');
    if (resultDashboard) resultDashboard.addEventListener('click', () => setView('dashboard'));
    const resultAgain = $('#btn-result-again');
    if (resultAgain) {
      resultAgain.addEventListener('click', () => {
        clearFile();
        if (dropZone) dropZone.focus();
      });
    }

    // Tabs potongan
    const potonganTabs = $('#potongan-tabs');
    if (potonganTabs) {
      potonganTabs.querySelectorAll('button[role="tab"]').forEach((button) => {
        button.addEventListener('click', () => setTab(button.dataset.tab));
        button.addEventListener('keydown', (event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const tabs = Array.from(potonganTabs.querySelectorAll('button[role="tab"]'));
          const index = tabs.indexOf(button);
          let nextIndex = index;
          if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
          if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
          if (event.key === 'Home') nextIndex = 0;
          if (event.key === 'End') nextIndex = tabs.length - 1;
          tabs[nextIndex].focus();
          setTab(tabs[nextIndex].dataset.tab);
        });
      });
    }

    const btnRefreshRekapBulanan = $('#btn-refresh-rekap-bulanan');
    if (btnRefreshRekapBulanan) {
      btnRefreshRekapBulanan.addEventListener('click', async () => {
        btnRefreshRekapBulanan.disabled = true;
        await loadPotonganReferenceData();
        btnRefreshRekapBulanan.disabled = false;
        toast('Rekap Disegarkan', 'Data rekap potongan bulanan berhasil diperbarui.', 'info');
      });
    }

    const tableRekapBulanan = $('#table-rekap-bulanan');
    if (tableRekapBulanan) {
      tableRekapBulanan.addEventListener('click', (e) => {
        const detailBtn = e.target.closest('[data-open-pos-detail]');
        if (detailBtn) {
          e.preventDefault();
          openRekapPosDetail(detailBtn.dataset.openPosDetail, detailBtn.dataset.posNama || 'Pos Potongan');
          return;
        }
        const importBtn = e.target.closest('[data-import-pos]');
        if (importBtn) {
          e.preventDefault();
          openImportForPos(importBtn.dataset.importPos);
        }
      });
    }

    const tableRekapPosDetail = $('#table-rekap-pos-detail');
    if (tableRekapPosDetail) {
      tableRekapPosDetail.addEventListener('click', (e) => {
        const jumpBtn = e.target.closest('[data-jump-asn]');
        if (jumpBtn) {
          e.preventDefault();
          const nip = jumpBtn.dataset.jumpAsn;
          selectPotonganEmployee(nip);
          closeModal();
          setView('potongan-asn');
          return;
        }
        const delBtn = e.target.closest('[data-delete-detail-item]');
        if (delBtn) {
          e.preventDefault();
          deleteDetailItem(delBtn.dataset.deleteDetailItem);
        }
      });
    }

    const btnRefreshRekapBerjangka = $('#btn-refresh-rekap-berjangka');
    if (btnRefreshRekapBerjangka) {
      btnRefreshRekapBerjangka.addEventListener('click', async () => {
        btnRefreshRekapBerjangka.disabled = true;
        await loadPotonganReferenceData();
        btnRefreshRekapBerjangka.disabled = false;
        toast('Rekap Disegarkan', 'Data rekap potongan berjangka berhasil diperbarui.', 'info');
      });
    }

    const tableRekapBerjangka = $('#table-rekap-berjangka');
    if (tableRekapBerjangka) {
      tableRekapBerjangka.addEventListener('click', (e) => {
        const detailBtn = e.target.closest('[data-open-pos-berjangka-detail]');
        if (detailBtn) {
          e.preventDefault();
          openRekapBerjangkaDetail(detailBtn.dataset.openPosBerjangkaDetail, detailBtn.dataset.posNama || 'Pos Potongan Berjangka');
        }
      });
    }

    const tableRekapBerjangkaDetail = $('#table-rekap-berjangka-detail');
    if (tableRekapBerjangkaDetail) {
      tableRekapBerjangkaDetail.addEventListener('click', (e) => {
        const jumpBtn = e.target.closest('[data-jump-asn]');
        if (jumpBtn) {
          e.preventDefault();
          const nip = jumpBtn.dataset.jumpAsn;
          selectPotonganEmployee(nip);
          closeModal();
          setView('potongan-asn');
        }
      });
    }

    // Form potongan — pencarian & pemilihan ASN
    const btnBrowsePegawai = $('#btn-browse-potongan-pegawai');
    if (btnBrowsePegawai) {
      btnBrowsePegawai.addEventListener('click', (e) => {
        e.preventDefault();
        openBrowsePegawaiModal('potongan');
      });
    }

    const browseSearch = $('#browse-pegawai-search');
    if (browseSearch) {
      browseSearch.addEventListener('input', (e) => {
        renderBrowsePegawaiTable(e.target.value);
      });
      browseSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const firstRowBtn = $('#tbody-browse-pegawai .btn-select-emp');
          if (firstRowBtn && firstRowBtn.dataset.nip) {
            handleSelectBrowsePegawai(firstRowBtn.dataset.nip);
          }
        }
      });
    }

    const tableBrowse = $('#table-browse-pegawai');
    if (tableBrowse) {
      tableBrowse.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-select-emp');
        const row = e.target.closest('.browse-pegawai-row');
        const nip = (btn && btn.dataset.nip) || (row && row.dataset.nip);
        if (nip) {
          handleSelectBrowsePegawai(nip);
        }
      });
      tableBrowse.addEventListener('dblclick', (e) => {
        const row = e.target.closest('.browse-pegawai-row');
        if (row && row.dataset.nip) {
          handleSelectBrowsePegawai(row.dataset.nip);
        }
      });
    }

    const searchInput = $('#potongan-search-input');
    const dropdown = $('#potongan-search-dropdown');
    const clearBtn = $('#btn-potongan-clear');

    if (searchInput) {
      searchInput.addEventListener('focus', (e) => {
        e.target.select();
        if (clearBtn) clearBtn.hidden = !e.target.value;
        renderPotonganSearchDropdown(e.target.value);
      });

      searchInput.addEventListener('input', (e) => {
        if (clearBtn) clearBtn.hidden = !e.target.value;
        renderPotonganSearchDropdown(e.target.value);
      });

      searchInput.addEventListener('keydown', (e) => {
        if (!dropdown || dropdown.hidden) {
          if (e.key === 'ArrowDown') {
            renderPotonganSearchDropdown(searchInput.value);
            return;
          }
        }
        const items = dropdown ? Array.from(dropdown.querySelectorAll('.picker-dropdown-item')) : [];
        const activeIdx = items.findIndex((it) => it.classList.contains('active'));

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const nextIdx = (activeIdx + 1) % items.length;
          items.forEach((it, i) => it.classList.toggle('active', i === nextIdx));
          if (items[nextIdx]) items[nextIdx].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prevIdx = (activeIdx - 1 + items.length) % items.length;
          items.forEach((it, i) => it.classList.toggle('active', i === prevIdx));
          if (items[prevIdx]) items[prevIdx].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const selectedItem = items[activeIdx >= 0 ? activeIdx : 0];
          if (selectedItem && selectedItem.dataset.nip) {
            selectPotonganEmployee(selectedItem.dataset.nip);
          } else {
            const val = searchInput.value.trim().toLowerCase();
            const found = (state.employees || []).find((emp) => emp.nip === val || (emp.nama || '').toLowerCase() === val);
            if (found) selectPotonganEmployee(found.nip);
          }
          if (dropdown) dropdown.hidden = true;
        } else if (e.key === 'Escape') {
          if (dropdown) dropdown.hidden = true;
        }
      });

      searchInput.addEventListener('blur', () => {
        window.setTimeout(() => {
          if (dropdown) dropdown.hidden = true;
          const emp = findEmployee(state.potonganNip);
          if (emp) {
            searchInput.value = `${emp.nip} — ${emp.nama}`;
            if (clearBtn) clearBtn.hidden = false;
          } else if (!state.employees.length) {
            searchInput.value = '';
            if (clearBtn) clearBtn.hidden = true;
          }
        }, 220);
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
        clearBtn.hidden = true;
        renderPotonganSearchDropdown('');
      });
    }

    if (dropdown) {
      dropdown.addEventListener('click', (e) => {
        const item = e.target.closest('.picker-dropdown-item');
        if (item && item.dataset.nip) {
          selectPotonganEmployee(item.dataset.nip);
        }
      });
    }

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#potongan-combobox-wrap')) {
        const dd = $('#potongan-search-dropdown');
        if (dd) dd.hidden = true;
      }
    });

    const potonganNip = $('#potongan-nip');
    if (potonganNip) {
      potonganNip.addEventListener('change', () => {
        selectPotonganEmployee(potonganNip.value);
      });
    }
    const formBulanan = $('#form-bulanan');
    if (formBulanan) {
      formBulanan.addEventListener('submit', submitBulanan);
      formBulanan.addEventListener('reset', () => window.setTimeout(() => {
        const period = $('#bulanan-period');
        if (period) period.value = state.period;
        hideFormError('bulanan');
      }, 0));
    }
    const formEditPotongan = $('#form-edit-potongan');
    if (formEditPotongan) {
      formEditPotongan.addEventListener('submit', submitEditPotongan);
    }
    ['#bulanan-nominal', '#loan-nominal', '#edit-potongan-nominal'].forEach((selector) => {
      const input = $(selector);
      if (!input) return;
      input.addEventListener('blur', () => {
        const value = parseMoneyInput(input.value);
        if (input.value.trim()) input.value = formatMoneyInput(value);
      });
    });

    const loanNip = $('#loan-nip');
    if (loanNip) {
      loanNip.addEventListener('input', () => {
        const employee = findEmployee(loanNip.value.trim());
        const nama = $('#loan-nama');
        if (nama) nama.textContent = employee ? employee.nama : '—';
      });
    }
    const loanStart = $('#loan-start');
    if (loanStart) loanStart.addEventListener('change', updateLoanPreview);
    const loanTenor = $('#loan-tenor');
    if (loanTenor) {
      loanTenor.addEventListener('input', updateLoanPreview);
      loanTenor.addEventListener('change', updateLoanPreview);
    }
    const saveLoanButton = $('#btn-save-loan');
    if (saveLoanButton) saveLoanButton.addEventListener('click', saveLoan);

    const generateButton = $('#btn-generate-berjangka');
    if (generateButton) generateButton.addEventListener('click', generateBerjangka);

    const formPos = $('#form-pos');
    if (formPos) formPos.addEventListener('submit', submitPos);
    const cancelPosBtn = $('#btn-pos-cancel');
    if (cancelPosBtn) cancelPosBtn.addEventListener('click', cancelEditPos);
    const posTableBody = $('#pos-table-body');
    if (posTableBody) {
      posTableBody.addEventListener('click', (event) => {
        const editBtn = event.target.closest('[data-pos-edit]');
        if (editBtn) {
          event.preventDefault();
          editPos(editBtn.dataset.posEdit);
          return;
        }
        const toggle = event.target.closest('[data-pos-toggle]');
        if (toggle) {
          event.preventDefault();
          togglePos(toggle.dataset.posToggle);
        }
      });
      posTableBody.addEventListener('dblclick', (event) => {
        const row = event.target.closest('[data-pos-row]');
        if (row && row.dataset.posRow) {
          editPos(row.dataset.posRow);
        }
      });
    }

    const manualFile = $('#manual-file');
    if (manualFile) {
      manualFile.addEventListener('change', () => {
        const file = manualFile.files && manualFile.files[0];
        const info = $('#manual-file-info');
        if (info) {
          info.hidden = !file;
          info.textContent = file ? `${file.name} • ${formatBytes(file.size)}` : '—';
        }
        const name = $('#manual-file-name');
        if (name) name.textContent = file ? file.name : 'Belum ada file';
      });
    }
    const runManualButton = $('#btn-run-manual-import');
    if (runManualButton) runManualButton.addEventListener('click', runManualImport);

    const filePickerButton = $('.file-picker-button');
    if (filePickerButton) {
      filePickerButton.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          const input = $('#manual-file');
          if (input) input.click();
        }
      });
    }

    // Print
    const printButton = $('#btn-print');
    if (printButton) {
      printButton.addEventListener('click', async () => {
        if (!state.posList || !state.posList.length) {
          await loadPotonganReferenceData();
        }
        await ensurePrintEmployeesLoaded();
        renderPrintPreview();
        window.setTimeout(() => window.print(), 80);
      });
    }
    const printUseSelected = $('#print-use-selected');
    if (printUseSelected) {
      printUseSelected.addEventListener('change', () => {
        state.printUseSelected = printUseSelected.checked;
        renderPrintPreview();
      });
    }
    const selectAllPrint = $('#btn-select-all-print');
    if (selectAllPrint) {
      selectAllPrint.addEventListener('click', () => {
        // "Pilih Semua" selalu memilih seluruh pegawai; kosongkan lewat checkbox masing-masing.
        state.selected = new Set(state.employees.map((employee) => employee.nip));
        state.printUseSelected = true;
        const useSelected = $('#print-use-selected');
        if (useSelected) useSelected.checked = true;
        renderEmployeeTable();
        renderPrintPreview();
      });
    }

    // Print Zoom Controls
    const zoomSelect = $('#print-zoom-select');
    if (zoomSelect) {
      zoomSelect.addEventListener('change', () => {
        applyPrintZoom(zoomSelect.value);
      });
    }
    const btnZoomIn = $('#btn-zoom-in');
    if (btnZoomIn) {
      btnZoomIn.addEventListener('click', () => {
        stepPrintZoom(1);
      });
    }
    const btnZoomOut = $('#btn-zoom-out');
    if (btnZoomOut) {
      btnZoomOut.addEventListener('click', () => {
        stepPrintZoom(-1);
      });
    }
    const paperViewport = $('#print-paper-viewport') || $('.paper-viewport');
    if (paperViewport) {
      paperViewport.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
          e.preventDefault();
          stepPrintZoom(e.deltaY < 0 ? 1 : -1);
        }
      }, { passive: false });
    }
    window.addEventListener('resize', () => {
      if (state.view === 'print' && state.printZoom === 'fit') {
        applyPrintZoom('fit');
      }
    });

    const printSearchInput = $('#print-employee-search');
    if (printSearchInput) {
      printSearchInput.addEventListener('input', (e) => {
        state.printEmployeeFilter = e.target.value;
        renderPrintListbox();
      });
    }

    const printSplitter = $('#print-splitter');
    const printPanel = $('#print-employee-panel');
    if (printSplitter && printPanel) {
      const savedWidth = storageGet('simgaji.printPanelWidth', localStorage);
      if (savedWidth) {
        const parsed = Number(savedWidth);
        if (parsed >= 180 && parsed <= 750) {
          printPanel.style.width = `${parsed}px`;
        }
      }

      let isDragging = false;
      let startX = 0;
      let startWidth = 0;

      printSplitter.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isDragging = true;
        startX = e.clientX;
        startWidth = printPanel.getBoundingClientRect().width;
        printSplitter.classList.add('is-dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const onMouseMove = (moveEvent) => {
          if (!isDragging) return;
          const deltaX = moveEvent.clientX - startX;
          const maxAllowed = Math.min(650, window.innerWidth - 320);
          const newWidth = Math.max(190, Math.min(maxAllowed, startWidth + deltaX));
          printPanel.style.width = `${newWidth}px`;
          if (state.view === 'print' && state.printZoom === 'fit') {
            applyPrintZoom('fit');
          }
        };

        const onMouseUp = () => {
          if (!isDragging) return;
          isDragging = false;
          printSplitter.classList.remove('is-dragging');
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          const finalWidth = Math.round(printPanel.getBoundingClientRect().width);
          storageSet('simgaji.printPanelWidth', String(finalWidth), localStorage);
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
          if (state.view === 'print' && state.printZoom === 'fit') {
            applyPrintZoom('fit');
          }
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      });

      printSplitter.addEventListener('dblclick', () => {
        printPanel.style.width = '';
        storageRemove('simgaji.printPanelWidth', localStorage);
        if (state.view === 'print' && state.printZoom === 'fit') {
          applyPrintZoom('fit');
        }
        toast('Lebar Panel Reset', 'Lebar panel Pilih Pegawai dikembalikan ke ukuran standar.', 'info');
      });

      if (window.ResizeObserver) {
        const ro = new ResizeObserver((entries) => {
          for (const entry of entries) {
            if (entry.target === printPanel && !isDragging) {
              const w = Math.round(entry.contentRect.width);
              if (w >= 180 && w <= 750) {
                storageSet('simgaji.printPanelWidth', String(w), localStorage);
              }
              if (state.view === 'print' && state.printZoom === 'fit') {
                applyPrintZoom('fit');
              }
            }
          }
        });
        ro.observe(printPanel);
      }
    }

    const printListbox = $('#print-employee-listbox');
    if (printListbox) {
      const toggleOption = (option) => {
        if (!option) return;
        const nip = option.dataset.nip;
        if (!nip) return;
        const hadKeyboardFocus = document.activeElement === option;
        if (state.selected.has(nip)) state.selected.delete(nip);
        else state.selected.add(nip);
        state.printUseSelected = true;
        const useSelected = $('#print-use-selected');
        if (useSelected) useSelected.checked = true;
        renderEmployeeTable();
        renderPrintPreview();
        if (hadKeyboardFocus) {
          const nextOption = printListbox.querySelector(`[role="option"][data-nip="${nip}"]`);
          if (nextOption) nextOption.focus();
        }
      };

      printListbox.addEventListener('click', (event) => {
        toggleOption(event.target.closest('[role="option"]'));
      });

      printListbox.addEventListener('keydown', (event) => {
        const option = event.target.closest('[role="option"]');
        if (!option) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleOption(option);
          return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const options = $$('[role="option"]', printListbox);
          const index = options.indexOf(option);
          const next = options[index + (event.key === 'ArrowDown' ? 1 : -1)];
          if (next) next.focus();
        }
      });
    }

    // Toolbar
    const refreshButton = $('#btn-refresh');
    if (refreshButton) refreshButton.addEventListener('click', refreshData);
    const aboutButton = $('#btn-about');
    if (aboutButton) aboutButton.addEventListener('click', () => openModal('about'));
    const modeChip = $('#data-mode-chip');
    if (modeChip) modeChip.addEventListener('click', openConnectionModal);
    const startConnection = $('#start-connection');
    if (startConnection) startConnection.addEventListener('click', openConnectionModal);
    const startAbout = $('#start-about');
    if (startAbout) startAbout.addEventListener('click', () => openModal('about'));

    // Profil pengguna & session
    const profileCard = $('#profile-card');
    if (profileCard) {
      profileCard.addEventListener('click', () => openProfileDialog());
      profileCard.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openProfileDialog();
        }
      });
    }
    const statusProfile = $('#status-profile-btn');
    if (statusProfile) statusProfile.addEventListener('click', () => openProfileDialog());
    const statusChangeOpd = $('#status-change-opd-btn');
    if (statusChangeOpd) statusChangeOpd.addEventListener('click', () => openProfileDialog(true));
    const statusLogout = $('#status-logout-btn');
    if (statusLogout) statusLogout.addEventListener('click', logout);
    const profileChangeButton = $('#btn-profile-change-opd');
    if (profileChangeButton) profileChangeButton.addEventListener('click', () => openProfileDialog(true));
    const saveProfileButton = $('#btn-save-profile-opd');
    if (saveProfileButton) saveProfileButton.addEventListener('click', saveProfileOpd);
    const addOpdButton = $('#btn-add-opd');
    if (addOpdButton) addOpdButton.addEventListener('click', addOpd);
    const newOpdInput = $('#new-opd-name');
    if (newOpdInput) {
      newOpdInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addOpd();
        }
      });
    }
    const profileLogout = $('#btn-profile-logout');
    if (profileLogout) profileLogout.addEventListener('click', logout);
    const saveSigModalBtn = $('#btn-save-signature-modal');
    if (saveSigModalBtn) saveSigModalBtn.addEventListener('click', saveSignatureModal);
    const openSettingsPrintBtn = $('#btn-open-settings-print');
    if (openSettingsPrintBtn) {
      openSettingsPrintBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openSignatureModal();
      });
    }
    const startProfileSettings = $('#start-profile-settings');
    if (startProfileSettings) {
      startProfileSettings.addEventListener('click', (e) => {
        e.preventDefault();
        const menu = $('#start-menu');
        if (menu) menu.hidden = true;
        openSignatureModal();
      });
    }

    const btnPrintSelected = $('#btn-print-selected');
    if (btnPrintSelected) btnPrintSelected.addEventListener('click', async () => {
        const period = ($('#print-period')?.value) || state.period;
        const search = ($('#print-search')?.value || '').toLowerCase();
        const selected = state.employees.filter(e => 
            (e.nip.includes(search) || e.nama.toLowerCase().includes(search))
        );
        if (selected.length === 0) { toast('Error', 'ASN tidak ditemukan', 'error'); return; }
        const details = await Promise.all(selected.map(e => fetchSlipData(e.nip, period)));
        await doPrint(details, period);
    });

    const btnPrintOpd = $('#btn-print-opd');
    if (btnPrintOpd) btnPrintOpd.addEventListener('click', async () => {
        const period = ($('#print-period')?.value) || state.period;
        const list = await fetchOpdSlipData(period);
        const details = await Promise.all(list.map(e => fetchSlipData(e.nip, period)));
        await doPrint(details, period);
    });

    // Master OPD
    const openAddOpdBtn = $('#btn-open-add-opd');
    if (openAddOpdBtn) openAddOpdBtn.addEventListener('click', () => openMasterOpdModal());
    const openImportOpdBtn = $('#btn-open-import-opd');
    if (openImportOpdBtn) openImportOpdBtn.addEventListener('click', openMasterOpdImportModal);
    const submitImportOpdBtn = $('#btn-submit-import-opd');
    if (submitImportOpdBtn) submitImportOpdBtn.addEventListener('click', submitMasterOpdImport);
    const openPrintOpdBtn = $('#btn-open-print-opd');
    if (openPrintOpdBtn) openPrintOpdBtn.addEventListener('click', openMasterOpdPrintModal);
    const doPrintOpdBtn = $('#btn-do-print-master-opd');
    if (doPrintOpdBtn) doPrintOpdBtn.addEventListener('click', doPrintMasterOpd);
    const refreshMasterOpdBtn = $('#btn-refresh-master-opd');
    if (refreshMasterOpdBtn) refreshMasterOpdBtn.addEventListener('click', loadMasterOpd);
    const searchMasterOpdInput = $('#master-opd-search');
    if (searchMasterOpdInput) {
      searchMasterOpdInput.addEventListener('input', (e) => {
        state.masterOpdFilter = e.target.value;
        renderMasterOpdTable();
      });
    }
    const saveMasterOpdBtn = $('#btn-save-master-opd');
    if (saveMasterOpdBtn) saveMasterOpdBtn.addEventListener('click', saveMasterOpd);

    const masterOpdTbody = $('#master-opd-tbody');
    if (masterOpdTbody) {
      masterOpdTbody.addEventListener('click', (e) => {
        const editBtn = e.target.closest('[data-action="edit-opd"]');
        if (editBtn) {
          const id = Number(editBtn.dataset.id);
          const opd = state.masterOpdList.find((item) => item.id === id);
          if (opd) openMasterOpdModal(opd);
          return;
        }
        const delBtn = e.target.closest('[data-action="delete-opd"]');
        if (delBtn) {
          const id = Number(delBtn.dataset.id);
          const name = delBtn.dataset.name || '';
          deleteMasterOpd(id, name);
          return;
        }
      });
    }

    // Master User
    const openAddUserBtn = $('#btn-open-add-user');
    if (openAddUserBtn) openAddUserBtn.addEventListener('click', openMasterUserAddModal);
    const openPrintUserBtn = $('#btn-open-print-user');
    if (openPrintUserBtn) openPrintUserBtn.addEventListener('click', openMasterUserPrintModal);
    const doPrintUserBtn = $('#btn-do-print-master-user');
    if (doPrintUserBtn) doPrintUserBtn.addEventListener('click', doPrintMasterUsers);
    const printUserRole = $('#master-user-print-role');
    if (printUserRole) printUserRole.addEventListener('change', updateMasterUserPrintSummary);
    const printUserStatus = $('#master-user-print-status');
    if (printUserStatus) printUserStatus.addEventListener('change', updateMasterUserPrintSummary);
    const saveNewUserBtn = $('#btn-save-new-user');
    if (saveNewUserBtn) saveNewUserBtn.addEventListener('click', saveMasterUserAdd);
    const refreshMasterUserBtn = $('#btn-refresh-master-user');
    if (refreshMasterUserBtn) refreshMasterUserBtn.addEventListener('click', loadMasterUsers);
    const searchMasterUserInput = $('#master-user-search');
    if (searchMasterUserInput) {
      searchMasterUserInput.addEventListener('input', (e) => {
        state.masterUserFilter = e.target.value;
        renderMasterUsersTable();
      });
    }
    const roleFilterMasterUser = $('#master-user-role-filter');
    if (roleFilterMasterUser) {
      roleFilterMasterUser.addEventListener('change', (e) => {
        state.masterUserRoleFilter = e.target.value;
        renderMasterUsersTable();
      });
    }
    const saveMasterUserBtn = $('#btn-save-master-user');
    if (saveMasterUserBtn) saveMasterUserBtn.addEventListener('click', saveMasterUser);

    const masterUserTbody = $('#master-user-tbody');
    if (masterUserTbody) {
      masterUserTbody.addEventListener('click', (e) => {
        const manageBtn = e.target.closest('[data-action="manage-user"]');
        if (manageBtn) {
          const id = manageBtn.dataset.id;
          const user = state.masterUserList.find((u) => u.id === id);
          if (user) openMasterUserModal(user);
          return;
        }
        const toggleRoleBtn = e.target.closest('[data-action="toggle-role-user"]');
        if (toggleRoleBtn) {
          const id = toggleRoleBtn.dataset.id;
          const currentRole = toggleRoleBtn.dataset.currentRole;
          toggleMasterUserRole(id, currentRole);
          return;
        }
        const delBtn = e.target.closest('[data-action="delete-user"]');
        if (delBtn) {
          const id = delBtn.dataset.id;
          const email = delBtn.dataset.email || '';
          deleteMasterUser(id, email);
          return;
        }
      });
    }

    // Manajemen Database
    const refreshDbBtn = $('#btn-refresh-database');
    if (refreshDbBtn) refreshDbBtn.addEventListener('click', loadDatabaseStats);

    const backupDbBtn = $('#btn-db-backup');
    if (backupDbBtn) backupDbBtn.addEventListener('click', downloadDatabaseBackup);

    const restoreDbBtn = $('#btn-db-restore');
    if (restoreDbBtn) restoreDbBtn.addEventListener('click', submitDatabaseRestore);

    const restoreSelectAllBtn = $('#btn-restore-select-all');
    if (restoreSelectAllBtn) {
      restoreSelectAllBtn.addEventListener('click', () => {
        $$('.cb-restore-table').forEach((cb) => { cb.checked = true; });
        updateRestoreState();
      });
    }

    const restoreSelectTxBtn = $('#btn-restore-select-tx');
    if (restoreSelectTxBtn) {
      restoreSelectTxBtn.addEventListener('click', () => {
        $$('.cb-restore-table').forEach((cb) => {
          cb.checked = ['payroll', 'potongan', 'penyesuaian'].includes(cb.value);
        });
        updateRestoreState();
      });
    }

    const restoreClearAllBtn = $('#btn-restore-clear-all');
    if (restoreClearAllBtn) {
      restoreClearAllBtn.addEventListener('click', () => {
        $$('.cb-restore-table').forEach((cb) => { cb.checked = false; });
        updateRestoreState();
      });
    }

    $$('.cb-restore-table').forEach((cb) => {
      cb.addEventListener('change', updateRestoreState);
    });

    const refreshRestoreCodeBtn = $('#btn-refresh-restore-code');
    if (refreshRestoreCodeBtn) {
      refreshRestoreCodeBtn.addEventListener('click', generateRestoreSecurityCode);
    }

    const restoreSecurityInput = $('#restore-security-input');
    if (restoreSecurityInput) {
      restoreSecurityInput.addEventListener('input', updateRestoreState);
      restoreSecurityInput.addEventListener('keyup', updateRestoreState);
    }

    const delPeriodDbBtn = $('#btn-db-del-period');
    if (delPeriodDbBtn) delPeriodDbBtn.addEventListener('click', submitDatabaseDeletePeriod);

    const wipeSelectTxBtn = $('#btn-db-wipe-select-tx');
    if (wipeSelectTxBtn) {
      wipeSelectTxBtn.addEventListener('click', () => {
        $$('.cb-wipe-table').forEach((cb) => {
          cb.checked = ['payroll', 'potongan', 'penyesuaian'].includes(cb.value);
        });
        updateWipeSummary();
        toast('Pilihan Diperbarui', 'Kategori transaksi terpilih (Payroll, Potongan, Penyesuaian).', 'info');
      });
    }

    const wipeSelectMasterBtn = $('#btn-db-wipe-select-master');
    if (wipeSelectMasterBtn) {
      wipeSelectMasterBtn.addEventListener('click', () => {
        $$('.cb-wipe-table').forEach((cb) => {
          cb.checked = ['pos', 'users', 'opd'].includes(cb.value);
        });
        updateWipeSummary();
        toast('Pilihan Diperbarui', 'Kategori master data terpilih (Pos Potongan, Pengguna, OPD).', 'info');
      });
    }

    const wipeSelectAllBtn = $('#btn-db-wipe-select-all');
    if (wipeSelectAllBtn) {
      wipeSelectAllBtn.addEventListener('click', () => {
        $$('.cb-wipe-table').forEach((cb) => {
          cb.checked = true;
        });
        updateWipeSummary();
        toast('Pilihan Diperbarui', 'Semua kategori data dicentang.', 'info');
      });
    }

    const wipeClearBtn = $('#btn-db-wipe-clear');
    if (wipeClearBtn) {
      wipeClearBtn.addEventListener('click', () => {
        $$('.cb-wipe-table').forEach((cb) => {
          cb.checked = false;
        });
        updateWipeSummary();
        toast('Pilihan Dikosongkan', 'Semua centang kategori data dibatalkan.', 'info');
      });
    }

    const wipeMasterCb = $('#cb-wipe-master');
    if (wipeMasterCb) {
      wipeMasterCb.addEventListener('change', (e) => {
        $$('.cb-wipe-table').forEach((cb) => {
          cb.checked = e.target.checked;
        });
        updateWipeSummary();
      });
    }

    const wipeTable = $('#db-wipe-table');
    if (wipeTable) {
      wipeTable.addEventListener('click', (e) => {
        const tr = e.target.closest('tr.wipe-row');
        if (!tr) return;
        if (e.target.tagName.toLowerCase() === 'input') return;
        const cb = tr.querySelector('.cb-wipe-table');
        if (cb) {
          cb.checked = !cb.checked;
          updateWipeSummary();
        }
      });
    }

    $$('.cb-wipe-table').forEach((cb) => {
      cb.addEventListener('change', updateWipeSummary);
    });

    const wipeConfirmInput = $('#db-wipe-confirm-text');
    if (wipeConfirmInput) {
      wipeConfirmInput.addEventListener('input', updateWipeSummary);
      wipeConfirmInput.addEventListener('keyup', updateWipeSummary);
    }

    const wipeSubmitBtn = $('#btn-db-wipe');
    if (wipeSubmitBtn) wipeSubmitBtn.addEventListener('click', submitDatabaseWipe);

    // Taskbar dan window controls
    const taskbarApp = $('#taskbar-app');
    if (taskbarApp) {
      taskbarApp.addEventListener('click', () => {
        const windowNode = $('#app-window');
        if (!windowNode) return;
        if (windowNode.classList.contains('is-minimized') || windowNode.classList.contains('is-closed')) {
          restoreWindow();
        } else {
          minimizeWindow();
        }
      });
    }
    const startOrb = $('#start-orb');
    if (startOrb) startOrb.addEventListener('click', toggleStartMenu);
    const showDesktop = $('#show-desktop');
    if (showDesktop) {
      showDesktop.addEventListener('click', () => {
        const windowNode = $('#app-window');
        if (!windowNode) return;
        if (windowNode.classList.contains('is-minimized') || windowNode.classList.contains('is-closed')) restoreWindow();
        else minimizeWindow();
      });
    }
    const shortcut = $('#closed-shortcut');
    if (shortcut) {
      const open = () => restoreWindow();
      shortcut.addEventListener('click', open);
      shortcut.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
    }

    // Modal
    const modalLayer = $('#modal-layer');
    if (modalLayer) {
      modalLayer.addEventListener('click', (event) => {
        if (event.target === modalLayer) closeModal();
      });
    }
    const applyButton = $('#btn-apply-connection');
    if (applyButton) applyButton.addEventListener('click', applyConnection);
    const googleLoginBtn = $('#btn-google-login');
    if (googleLoginBtn) googleLoginBtn.addEventListener('click', () => loginWithGoogle('#connection-error'));
    const loginPageGoogleBtn = $('#login-page-google-btn');
    if (loginPageGoogleBtn) loginPageGoogleBtn.addEventListener('click', () => loginWithGoogle('#login-page-error'));
    const loginPageTokenBtn = $('#login-page-token-btn');
    if (loginPageTokenBtn) loginPageTokenBtn.addEventListener('click', applyLoginPageToken);
    const startLogoutBtn = $('#start-logout');
    if (startLogoutBtn) startLogoutBtn.addEventListener('click', logout);
    const dialogLogoutBtn = $('#btn-dialog-logout');
    if (dialogLogoutBtn) dialogLogoutBtn.addEventListener('click', logout);
    const statusLogoutBtn = $('#status-logout-btn');
    if (statusLogoutBtn) statusLogoutBtn.addEventListener('click', logout);
    const confirmClose = $('#btn-confirm-close');
    if (confirmClose) confirmClose.addEventListener('click', closeWindow);

    // Master Gaji Events
    const refreshMasterGajiBtn = $('#btn-refresh-master-gaji');
    if (refreshMasterGajiBtn) refreshMasterGajiBtn.addEventListener('click', loadMasterGaji);

    const masterGajiTabs = $('#master-gaji-tabs');
    if (masterGajiTabs) {
      masterGajiTabs.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('button[role="tab"]');
        if (!tabBtn) return;
        const targetTab = tabBtn.dataset.tab;
        if (!targetTab) return;

        masterGajiTabs.querySelectorAll('button[role="tab"]').forEach((b) => {
          const isTarget = b === tabBtn;
          b.setAttribute('aria-selected', String(isTarget));
          b.tabIndex = isTarget ? 0 : -1;
        });

        masterGajiTabs.querySelectorAll('[role="tabpanel"]').forEach((panel) => {
          panel.hidden = panel.id !== `tab-panel-${targetTab}`;
        });

        state.masterGajiTab = targetTab;
        void loadMasterGaji();
      });
    }

    const excelGajiSearch = $('#excel-gaji-search');
    if (excelGajiSearch) {
      excelGajiSearch.addEventListener('input', (e) => {
        state.masterGajiFilter = e.target.value;
        renderMasterGajiList();
      });
    }

    const formPenyesuaian = $('#form-penyesuaian');
    if (formPenyesuaian) {
      formPenyesuaian.addEventListener('submit', savePenyesuaianGaji);
    }

    const btnBrowsePenyesuaian = $('#btn-browse-penyesuaian-pegawai');
    if (btnBrowsePenyesuaian) {
      btnBrowsePenyesuaian.addEventListener('click', (e) => {
        e.preventDefault();
        openBrowsePegawaiModal('penyesuaian');
      });
    }

    const penyesuaianNip = $('#penyesuaian-nip');
    if (penyesuaianNip) {
      penyesuaianNip.addEventListener('click', () => {
        openBrowsePegawaiModal('penyesuaian');
      });
    }

    const btnResetPenyesuaian = $('#btn-reset-penyesuaian');
    if (btnResetPenyesuaian) {
      btnResetPenyesuaian.addEventListener('click', () => {
        setTimeout(() => {
          const currentPeriod = state.period;
          const periodInput = $('#penyesuaian-period');
          if (periodInput) periodInput.value = currentPeriod;
          const nipInput = $('#penyesuaian-nip');
          if (nipInput) nipInput.value = '';
          const namaInput = $('#penyesuaian-nama');
          if (namaInput) namaInput.value = '';
        }, 10);
      });
    }

    // Monitoring Aktivitas Events
    const refreshMonitoringBtn = $('#btn-refresh-monitoring');
    if (refreshMonitoringBtn) refreshMonitoringBtn.addEventListener('click', loadMonitoringAudit);

    const monitoringSearchInput = $('#monitoring-search');
    if (monitoringSearchInput) {
      monitoringSearchInput.addEventListener('input', (e) => {
        state.monitoringSearch = e.target.value;
        renderMonitoringTable();
      });
    }

    const monitoringFilterAction = $('#monitoring-filter-action');
    if (monitoringFilterAction) {
      monitoringFilterAction.addEventListener('change', (e) => {
        state.monitoringFilterAction = e.target.value;
        void loadMonitoringAudit();
      });
    }

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        const layer = $('#modal-layer');
        if (layer && !layer.hidden) {
          closeModal();
          return;
        }
        const menu = $('#start-menu');
        if (menu && !menu.hidden) {
          menu.hidden = true;
          const orb = $('#start-orb');
          if (orb) orb.setAttribute('aria-expanded', 'false');
        }
      }
    });
  }

  /* ============================== BOOT ============================== */

  function init() {
    state.mode = 'api';
    buildPeriodSelects();
    bindEvents();
    initFirebase();
    updateClock();
    if (clockTimer) window.clearInterval(clockTimer);
    clockTimer = window.setInterval(updateClock, 15000);

    if (state.token) {
      setStatus('Menghubungkan ke API…');
      connectApiSession(state.token)
        .then((profile) => {
          showAppScreen();
          renderAll();
          setView('dashboard', true);
          setStatus('Data API siap.');
          if (!profile.needs_opd) {
            toast('Terhubung ke API', `Selamat datang, ${profile.display_name || profile.email}.`, 'success');
          }
        })
        .catch(() => {
          logout();
        });
    } else {
      clearAllData();
      showLoginScreen();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
