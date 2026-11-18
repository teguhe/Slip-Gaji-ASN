/* ============================================================
   SIMGAJI ASN — Aero Glass dashboard controller
   Vanilla JS. Mode demo berjalan tanpa backend; mode API memakai
   Firebase ID Token dan endpoint FastAPI.
   ============================================================ */

(function () {
  'use strict';

  const DEMO_OPD = 'BADAN KEPEGAWAIAN DAN PENGEMBANGAN SUMBER DAYA MANUSIA';
  const DEMO_OPD_TITLE = 'Badan Kepegawaian dan Pengembangan Sumber Daya Manusia';
  const DEMO_PERIOD = '2026-10';
  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const API_BASE = '';
  const MONTH_NAMES = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ];
  const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

  const PERIODS = (() => {
    const out = [];
    for (let year = 2026; year <= 2027; year += 1) {
      const maxMonth = year === 2026 ? 12 : 6;
      for (let month = 1; month <= maxMonth; month += 1) {
        out.push(`${year}-${String(month).padStart(2, '0')}`);
      }
    }
    return out;
  })();

  const TREND = [
    { period: '2026-05', value: 22400000 },
    { period: '2026-06', value: 23150000 },
    { period: '2026-07', value: 22800000 },
    { period: '2026-08', value: 23650000 },
    { period: '2026-09', value: 24050000 },
    { period: '2026-10', value: 23863924.55 },
  ];

  const SEED_IMPORTS = [
    {
      time: '03/10/2026 09:14',
      file: 'SIMGAJI_PNS_OKT_2026.xlsx',
      opd: DEMO_OPD,
      rows: 6,
      inserted: 6,
      updated: 0,
      status: 'success',
    },
    {
      time: '02/09/2026 10:02',
      file: 'SIMGAJI_PNS_SEP_2026.xlsx',
      opd: DEMO_OPD,
      rows: 6,
      inserted: 6,
      updated: 0,
      status: 'success',
    },
    {
      time: '01/08/2026 08:45',
      file: 'SIMGAJI_PNS_AGU_2026.xlsx',
      opd: DEMO_OPD,
      rows: 6,
      inserted: 5,
      updated: 1,
      status: 'success',
    },
  ];

  const SEED_ACTIVITIES = [
    {
      type: 'import',
      tone: 'green',
      title: 'Import SIMGAJI berhasil',
      detail: 'SIMGAJI_PNS_OKT_2026.xlsx • 6 baris',
      time: '09:14',
    },
    {
      type: 'potongan',
      tone: 'amber',
      title: 'Potongan internal diperbarui',
      detail: 'Bank Jateng • Cicilan 14/36',
      time: '08:52',
    },
    {
      type: 'sync',
      tone: '',
      title: 'Sinkronisasi OPD',
      detail: 'Profil OPD terverifikasi',
      time: '08:40',
    },
  ];

  const DEMO_POS = [
    { id: 1, opd_id: 1, opd_nama: DEMO_OPD, nama_pos: 'Iuran KORPRI', kategori: 'bulanan', is_active: true },
    { id: 2, opd_id: 1, opd_nama: DEMO_OPD, nama_pos: 'Dharma Wanita', kategori: 'bulanan', is_active: true },
    { id: 3, opd_id: 1, opd_nama: DEMO_OPD, nama_pos: 'Infaq / Zakat', kategori: 'bulanan', is_active: true },
    { id: 4, opd_id: 1, opd_nama: DEMO_OPD, nama_pos: 'Koperasi Dimas', kategori: 'bulanan', is_active: true },
    { id: 5, opd_id: 1, opd_nama: DEMO_OPD, nama_pos: 'Pinjaman Bank Jateng', kategori: 'berjangka', is_active: true },
    { id: 6, opd_id: 1, opd_nama: DEMO_OPD, nama_pos: 'Angsuran Koperasi', kategori: 'berjangka', is_active: true },
    { id: 7, opd_id: 1, opd_nama: DEMO_OPD, nama_pos: 'Sekolah / Pendidikan', kategori: 'bulanan', is_active: true },
  ];

  const DEMO_LOANS = [
    {
      id: 'demo-loan-1',
      nip: '196812211991011001',
      nama: 'CELSO EDGAR NASCIMENTO',
      pos_id: 5,
      pos_nama: 'Pinjaman Bank Jateng',
      opd_nama: DEMO_OPD,
      nominal_per_bulan: 1200000,
      start_period: '2025-09',
      end_period: '2028-08',
      tenor_bulan: 36,
      keterangan: 'Pinjaman modal',
      created_by: 'bendahara@example.com',
    },
    {
      id: 'demo-loan-2',
      nip: '197505102000121004',
      nama: 'BUDI SANTOSO',
      pos_id: 5,
      pos_nama: 'Pinjaman Bank Jateng',
      opd_nama: DEMO_OPD,
      nominal_per_bulan: 750000,
      start_period: '2026-03',
      end_period: '2028-02',
      tenor_bulan: 24,
      keterangan: 'Pinjaman renovasi',
      created_by: 'bendahara@example.com',
    },
    {
      id: 'demo-loan-3',
      nip: '199002172015031006',
      nama: 'AHMAD FAUZI',
      pos_id: 6,
      pos_nama: 'Angsuran Koperasi',
      opd_nama: DEMO_OPD,
      nominal_per_bulan: 900000,
      start_period: '2026-08',
      end_period: '2029-07',
      tenor_bulan: 36,
      keterangan: 'Angsuran koperasi',
      created_by: 'bendahara@example.com',
    },
  ];

  const state = {
    view: 'dashboard',
    period: DEMO_PERIOD,
    mode: storageGet('simgaji.mode', localStorage) === 'api' ? 'api' : 'demo',
    token: storageGet('simgaji.token', sessionStorage) || '',
    opd: DEMO_OPD_TITLE,
    opdRaw: DEMO_OPD,
    employees: [],
    demoEmployees: [],
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
    pendingConnection: false,
  };

  let searchQuery = '';
  let clockTimer = null;

  /* ============================== HELPERS ============================== */

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

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
    return `${MONTH_NAMES[month - 1] || month} ${year}`;
  }

  function periodShort(period) {
    const [, month] = String(period).split('-').map(Number);
    return MONTH_SHORT[month - 1] || period;
  }

  function addMonths(period, count) {
    const [year, month] = period.split('-').map(Number);
    const date = new Date(year, month - 1 + Number(count), 1);
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

  /* ============================== DEMO DATA ============================== */

  function makeInternal(pos, nominal, info, extra = {}) {
    return {
      id: uid('pot'),
      pos,
      nominal,
      info,
      kategori: 'bulanan',
      ...extra,
    };
  }

  function buildDemoEmployees() {
    const employees = [
      {
        nip: '196812211991011001',
        nama: 'CELSO EDGAR NASCIMENTO',
        kdpangkat: 'IV/a',
        norek: '3033034147',
        income: {
          gapok: 5235000,
          tjistri: 523500,
          tjanak: 104700,
          tjberas: 217260,
          tjaskes: 284812.92,
          tjumum: 0,
        },
        resmi: {
          iwpPegawai: 58632.37,
          iwpTaspen: 469056,
          pph: 234528,
          jkkJkm: 50256,
          lain: 0,
        },
        internal: [
          makeInternal('Iuran KORPRI', 20000, 'Bulanan • Oktober 2026'),
          makeInternal('Koperasi Dimas', 250000, 'Simpawan wajib • Oktober 2026'),
          makeInternal('Pinjaman Bank Jateng', 1200000, 'Cicilan 14 dari 36 • s.d. September 2029', { kategori: 'berjangka', cicilan: 14, tenor: 36 }),
          makeInternal('Infaq / Zakat', 50000, 'Bulanan • Oktober 2026'),
        ],
      },
      {
        nip: '198203152006042003',
        nama: 'SITI RAHMAWATI',
        kdpangkat: 'III/c',
        norek: '3033035521',
        income: {
          gapok: 4620000,
          tjistri: 462000,
          tjanak: 92400,
          tjberas: 191760,
          tjaskes: 251928,
          tjumum: 0,
        },
        resmi: {
          iwpPegawai: 51744,
          iwpTaspen: 414000,
          pph: 168000,
          jkkJkm: 44352,
          lain: 0,
        },
        internal: [
          makeInternal('Iuran KORPRI', 20000, 'Bulanan • Oktober 2026'),
          makeInternal('Dharma Wanita', 25000, 'Bulanan • Oktober 2026'),
          makeInternal('Infaq / Zakat', 50000, 'Bulanan • Oktober 2026'),
          makeInternal('Koperasi Dimas', 150000, 'Angsuran • Oktober 2026'),
        ],
      },
      {
        nip: '197505102000121004',
        nama: 'BUDI SANTOSO',
        kdpangkat: 'III/b',
        norek: '3033037712',
        income: {
          gapok: 3980000,
          tjistri: 398000,
          tjanak: 79600,
          tjberas: 165180,
          tjaskes: 216910,
          tjumum: 0,
        },
        resmi: {
          iwpPegawai: 44576,
          iwpTaspen: 356000,
          pph: 96000,
          jkkJkm: 38208,
          lain: 0,
        },
        internal: [
          makeInternal('Iuran KORPRI', 20000, 'Bulanan • Oktober 2026'),
          makeInternal('Koperasi Dimas', 200000, 'Simpawan wajib • Oktober 2026'),
          makeInternal('Pinjaman Bank Jateng', 750000, 'Cicilan 8 dari 24 • s.d. Mei 2028', { kategori: 'berjangka', cicilan: 8, tenor: 24 }),
          makeInternal('Infaq / Zakat', 25000, 'Bulanan • Oktober 2026'),
        ],
      },
      {
        nip: '198811052012022005',
        nama: 'MARIA FRANSISKA',
        kdpangkat: 'III/d',
        norek: '3033039984',
        income: {
          gapok: 5780000,
          tjistri: 0,
          tjanak: 115600,
          tjberas: 239820,
          tjaskes: 314940,
          tjumum: 100000,
        },
        resmi: {
          iwpPegawai: 64736,
          iwpTaspen: 520000,
          pph: 280000,
          jkkJkm: 55488,
          lain: 0,
        },
        internal: [
          makeInternal('Iuran KORPRI', 20000, 'Bulanan • Oktober 2026'),
          makeInternal('Koperasi Dimas', 300000, 'Simpawan wajib • Oktober 2026'),
          makeInternal('Infaq / Zakat', 100000, 'Bulanan • Oktober 2026'),
          makeInternal('Sekolah / Pendidikan', 150000, 'Bulanan • Oktober 2026'),
        ],
      },
      {
        nip: '199002172015031006',
        nama: 'AHMAD FAUZI',
        kdpangkat: 'III/a',
        norek: '3033041120',
        income: {
          gapok: 4250000,
          tjistri: 425000,
          tjanak: 85000,
          tjberas: 176400,
          tjaskes: 231675,
          tjumum: 0,
        },
        resmi: {
          iwpPegawai: 47600,
          iwpTaspen: 380000,
          pph: 120000,
          jkkJkm: 40800,
          lain: 0,
        },
        internal: [
          makeInternal('Iuran KORPRI', 20000, 'Bulanan • Oktober 2026'),
          makeInternal('Koperasi Dimas', 250000, 'Simpawan wajib • Oktober 2026'),
          makeInternal('Pinjaman Bank Jateng', 900000, 'Cicilan 3 dari 36 • s.d. Desember 2029', { kategori: 'berjangka', cicilan: 3, tenor: 36 }),
          makeInternal('Infaq / Zakat', 50000, 'Bulanan • Oktober 2026'),
        ],
      },
      {
        nip: '199406282019012007',
        nama: 'DEWI LESTARI',
        kdpangkat: 'II/d',
        norek: '3033042266',
        income: {
          gapok: 3650000,
          tjistri: 0,
          tjanak: 0,
          tjberas: 151410,
          tjaskes: 198925,
          tjumum: 75000,
        },
        resmi: {
          iwpPegawai: 40880,
          iwpTaspen: 326000,
          pph: 72000,
          jkkJkm: 35040,
          lain: 0,
        },
        internal: [
          makeInternal('Iuran KORPRI', 20000, 'Bulanan • Oktober 2026'),
          makeInternal('Dharma Wanita', 25000, 'Bulanan • Oktober 2026'),
          makeInternal('Infaq / Zakat', 50000, 'Bulanan • Oktober 2026'),
          makeInternal('Koperasi Dimas', 100000, 'Simpawan wajib • Oktober 2026'),
        ],
      },
    ];

    return employees.map((config) => {
      const employee = {
        nip: config.nip,
        nama: config.nama,
        kdpangkat: config.kdpangkat,
        norek: config.norek,
        opd: DEMO_OPD,
        income: config.income,
        resmi: config.resmi,
        internalPotongan: config.internal || [],
        basePotonganInternal: 0,
        summaryOnly: false,
      };
      return recomputeEmployee(employee);
    });
  }

  function loadDemoData() {
    state.demoEmployees = buildDemoEmployees();
    state.employees = deepClone(state.demoEmployees);
    state.opd = DEMO_OPD_TITLE;
    state.opdRaw = DEMO_OPD;
    state.imports = deepClone(SEED_IMPORTS);
    state.activities = deepClone(SEED_ACTIVITIES);
    state.trend = deepClone(TREND);
    state.posList = deepClone(DEMO_POS);
    state.loans = deepClone(DEMO_LOANS);
    state.selected = new Set();
    state.potonganNip = state.employees[0] ? state.employees[0].nip : '';
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
    renderPrintPreview();
    updateProfileUI();
  }

  function renderChrome() {
    const period = periodLabel(state.period);
    const modeLabel = state.mode === 'api' ? 'Terhubung API' : 'Mode Demo';

    const nodes = [
      ['#profile-opd', state.opd],
      ['#toolbar-opd', shortOpd(state.opd, 62)],
      ['#dashboard-opd', state.opd],
      ['#status-opd', `OPD: ${shortOpd(state.opd, 46)}`],
      ['#status-period', `Periode: ${period}`],
      ['#dashboard-period', period],
      ['#data-mode-label', modeLabel],
      ['#status-data-mode', state.mode === 'api' ? 'API' : 'Demo'],
      ['#chart-caption', state.mode === 'api' ? `${state.period.slice(0, 4)} • est.` : state.period.slice(0, 4)],
      ['#loan-period', period],
      ['#potongan-mode-note-text', state.mode === 'api'
        ? 'Mode API: pos, pinjaman, dan import potongan disimpan ke PostgreSQL.'
        : 'Mode demo: perubahan pos dan pinjaman disimpan pada sesi ini.'],
    ];
    nodes.forEach(([selector, value]) => {
      const node = $(selector);
      if (node) node.textContent = value;
    });

    const chip = $('#data-mode-chip');
    if (chip) chip.classList.toggle('is-api', state.mode === 'api');

    const navCount = $('#nav-count');
    if (navCount) navCount.textContent = String(state.employees.length);
  }

  function renderDashboard(totals) {
    const setText = (selector, value) => {
      const node = $(selector);
      if (node) node.textContent = value;
    };

    setText('#metric-pegawai', String(totals.pegawai));
    setText('#metric-kotor', formatRupiah(totals.kotor, 0));
    setText('#metric-potongan', formatRupiah(totals.totalPotongan, 0));
    setText('#metric-thp', formatRupiah(totals.thp, 0));
    setText('#metric-pegawai-sub', `Periode ${periodLabel(state.period)}`);
    setText('#metric-kotor-sub', `${totals.pegawai} pegawai • sebelum potongan`);
    setText(
      '#metric-potongan-sub',
      `SIMGAJI ${formatRupiah(totals.potonganSimgaji, 0)} • internal ${formatRupiah(totals.potonganInternal, 0)}`,
    );
    setText(
      '#metric-thp-sub',
      totals.pegawai
        ? `Rata-rata ${formatRupiah(totals.thp / totals.pegawai, 0)}`
        : 'Bersih diterima ASN',
    );

    renderChart(totals);
    renderComposition(totals);
  }

  function renderChart(totals) {
    const container = $('#chart-bars');
    if (!container) return;

    const values = state.trend.map((entry, index) => {
      if (state.mode === 'api') {
        return { ...entry, value: totals.thp * (0.91 + index * 0.017) };
      }
      return entry;
    });
    const maxValue = Math.max(
      1,
      ...values.map((entry) => Number(entry.value) || 0),
    );
    const axisMax = Math.max(10_000_000, Math.ceil(maxValue / 10_000_000) * 10_000_000);

    const labels = $$('.chart-y span');
    if (labels.length === 4) {
      labels[0].textContent = formatCompact(axisMax);
      labels[1].textContent = formatCompact((axisMax * 2) / 3);
      labels[2].textContent = formatCompact(axisMax / 3);
      labels[3].textContent = 'Rp 0';
    }

    container.innerHTML = values.map((entry) => {
      const value = Number(entry.value) || 0;
      const height = Math.max(4, Math.min(100, (value / axisMax) * 100));
      const active = entry.period === state.period;
      return `
        <div class="chart-bar${active ? ' active' : ''}" title="${escapeHtml(periodLabel(entry.period))}: ${escapeHtml(formatRupiah(value, 0))}">
          <span class="chart-bar-fill" style="--h:${height.toFixed(2)}%"></span>
          <span class="chart-bar-label">${escapeHtml(periodShort(entry.period))}</span>
        </div>`;
    }).join('');
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
          <td><span class="pangkat-badge">${escapeHtml(employee.kdpangkat || '—')}</span></td>
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

  function renderPotongan() {
    const select = $('#potongan-nip');
    if (!select) return;

    const current = state.potonganNip || select.value || (state.employees[0] ? state.employees[0].nip : '');
    select.innerHTML = state.employees.map((employee) => (
      `<option value="${escapeHtml(employee.nip)}">${escapeHtml(employee.nip)} — ${escapeHtml(employee.nama)}</option>`
    )).join('');

    if (state.employees.some((employee) => employee.nip === current)) {
      select.value = current;
      state.potonganNip = current;
    } else if (state.employees[0]) {
      select.value = state.employees[0].nip;
      state.potonganNip = state.employees[0].nip;
    } else {
      state.potonganNip = '';
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
    if (pangkat) pangkat.textContent = employee.kdpangkat || '—';
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
            <span>Rincian item belum dimuat dari API</span>
          </div>
          <span class="deduction-amount">${formatRupiah(base, 0)}</span>
        </div>`);
    }

    items.forEach((item) => {
      const deleteControl = item.readOnly ? '' : `
          <button type="button" class="delete-deduction" data-delete-potongan="${escapeHtml(item.id)}"
                  title="Hapus potongan" aria-label="Hapus ${escapeHtml(item.pos)}">
            <svg class="icon"><use href="#icon-trash"></use></svg>
          </button>`;
      rows.push(`
        <div class="deduction-item">
          <span class="deduction-icon"><svg class="icon"><use href="#icon-receipt"></use></svg></span>
          <div class="deduction-copy">
            <strong title="${escapeHtml(item.pos)}">${escapeHtml(item.pos)}</strong>
            <span>${escapeHtml(item.info || 'Bulanan')}</span>
          </div>
          <span class="deduction-amount">${formatRupiah(item.nominal, 0)}</span>
          ${deleteControl}
        </div>`);
    });

    container.innerHTML = rows.join('');
    if (empty) empty.hidden = rows.length > 0;
    if (totalNode) totalNode.textContent = formatRupiah(employee.potonganInternal, 0);
  }

  function periodShortLabel(period) {
    if (!/^\d{4}-\d{2}$/.test(String(period))) return String(period || '—');
    const [year, month] = period.split('-').map(Number);
    return `${MONTH_SHORT[month - 1] || month} ${year}`;
  }

  function monthNumber(period) {
    const [year, month] = String(period).split('-').map(Number);
    return (year * 12) + (month - 1);
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

    const rows = [...state.posList].sort((a, b) => (
      String(a.kategori).localeCompare(String(b.kategori))
      || String(a.nama_pos).localeCompare(String(b.nama_pos))
    ));
    body.innerHTML = rows.map((pos) => `
      <tr>
        <td><strong>${escapeHtml(pos.nama_pos)}</strong></td>
        <td><span class="status-pill neutral">${escapeHtml(pos.kategori)}</span></td>
        <td>${pos.is_active ? '<span class="status-pill">Aktif</span>' : '<span class="status-pill error">Nonaktif</span>'}</td>
        <td>
          <button type="button" class="pos-toggle" data-pos-toggle="${escapeHtml(pos.id)}">
            ${pos.is_active ? 'Nonaktifkan' : 'Aktifkan'}
          </button>
        </td>
      </tr>`).join('');

    const empty = $('#pos-empty');
    if (empty) empty.hidden = rows.length > 0;
    const count = $('#pos-list-count');
    if (count) count.textContent = `${rows.length} pos • ${rows.filter((pos) => pos.is_active).length} aktif`;
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
    return {
      id: Number(raw.id),
      opd_id: raw.opd_id == null ? null : Number(raw.opd_id),
      opd_nama: raw.opd_nama || state.opd,
      nama_pos: raw.nama_pos,
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
      return detail.map((item) => item.msg || String(item)).join('; ');
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

  function updateProfileUI() {
    const isApi = state.mode === 'api';
    const profile = state.profile;
    const superAdmin = Boolean(profile && profile.is_super_admin);
    const name = isApi
      ? (profile ? (profile.display_name || profile.email || 'Pengguna API') : 'Memuat profil…')
      : 'Bendahara OPD';
    const roleLabel = isApi
      ? (superAdmin ? 'Super Admin' : 'Bendahara')
      : 'Bendahara';
    const opdLabel = isApi
      ? (profile && profile.opd_name
        ? profile.opd_name
        : (superAdmin ? 'Semua OPD' : 'Belum ditetapkan'))
      : state.opd;
    const email = isApi ? (profile ? profile.email : '—') : 'mode-demo@local';
    const method = isApi
      ? (profile ? (profile.auth_method === 'api_key' ? 'API Key' : 'Firebase Auth') : 'API')
      : 'Mode Demo';
    const avatar = initialsFrom(name, email);

    const setText = (selector, value) => {
      const node = $(selector);
      if (node) node.textContent = value;
    };

    setText('#profile-name', isApi ? (profile ? (profile.display_name || profile.email) : 'Memuat…') : 'Bendahara OPD');
    setText('#profile-role', roleLabel);
    setText('#profile-opd', opdLabel);
    const sidebarAvatar = $('#profile-avatar');
    if (sidebarAvatar) sidebarAvatar.textContent = avatar;

    setText('#profile-dialog-name', name);
    setText('#profile-dialog-email', email);
    setText('#profile-dialog-role', roleLabel);
    setText('#profile-dialog-opd', opdLabel);
    setText('#profile-dialog-method', method);
    setText('#profile-dialog-status', isApi ? (profile && profile.needs_opd ? 'Perlu OPD' : 'Aktif') : 'Demo');
    const dialogAvatar = $('#profile-dialog-avatar');
    if (dialogAvatar) dialogAvatar.textContent = avatar;

    const roleBadge = $('#profile-dialog-role');
    if (roleBadge) roleBadge.classList.toggle('super', superAdmin);

    const changeButton = $('#btn-profile-change-opd');
    if (changeButton) changeButton.hidden = !(isApi && superAdmin);
    const logoutButton = $('#btn-profile-logout');
    if (logoutButton) logoutButton.hidden = !isApi;
    const statusChange = $('#status-change-opd-btn');
    if (statusChange) statusChange.hidden = !(isApi && superAdmin);
    const statusLogout = $('#status-logout-btn');
    if (statusLogout) statusLogout.hidden = !isApi;

    const showOpdBox = isApi && Boolean((profile && profile.needs_opd) || state.profileChangeMode);
    const opdBox = $('#profile-opd-box');
    if (opdBox) opdBox.hidden = !showOpdBox;
    if (showOpdBox) populateProfileOpdSelect();
  }

  async function loadAuthProfile(token = state.token) {
    const data = await apiRequest('/api/v1/auth/me', {}, token);
    state.profile = data;
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
        if (changeOpd && !(state.profile && state.profile.is_super_admin)) {
          changeOpd = false;
        }
        if ((state.profile && state.profile.needs_opd) || changeOpd) {
          if (!state.opdOptions.length) await loadOpdOptions();
        }
      } catch (error) {
        toast('Gagal memuat profil', error.message, 'error');
      }
    } else {
      changeOpd = false;
    }

    state.profileChangeMode = Boolean(
      changeOpd || (state.mode === 'api' && state.profile && state.profile.needs_opd),
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

  function logout() {
    const wasApi = state.mode === 'api';
    state.mode = 'demo';
    state.token = '';
    state.profile = null;
    state.opdOptions = [];
    state.profileChangeMode = false;
    storageSet('simgaji.mode', 'demo', localStorage);
    storageRemove('simgaji.token', sessionStorage);
    loadDemoData();
    closeModal();
    renderAll();
    updateProfileUI();
    toast(
      'Logout',
      wasApi ? 'Sesi API diakhiri; aplikasi kembali ke mode demo.' : 'Mode demo tetap aktif.',
      'info',
    );
  }

  async function connectApiSession(token) {
    const profile = await apiRequest('/api/v1/auth/me', {}, token);
    state.mode = 'api';
    state.token = token;
    state.profile = profile;
    state.opd = profile.opd_name || (profile.is_super_admin ? 'Semua OPD' : 'Belum ditetapkan');
    state.opdRaw = profile.opd_name || '';
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
      toast('Tentukan OPD', 'Akun baru harus memilih OPD sebelum mengakses data gaji.', 'info');
      await openProfileDialog();
      return profile;
    }

    const data = await loadApiData(token);
    applyApiData(data, token);
    return profile;
  }

  async function loadPotonganReferenceData() {
    if (state.mode !== 'api' || !state.token) {
      if (!state.posList.length) state.posList = deepClone(DEMO_POS);
      if (!state.loans.length) state.loans = deepClone(DEMO_LOANS);
      return;
    }

    try {
      const query = new URLSearchParams({ period: state.period });
      const [posData, loanData] = await Promise.all([
        apiRequest('/api/v1/potongan/pos'),
        apiRequest(`/api/v1/potongan/berjangka?${query.toString()}`),
      ]);
      state.posList = (posData || []).map(mapApiPos);
      state.loans = (loanData || []).map(mapApiLoan);
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
          id: `api-${nip}-${index}`,
          pos: detail.pos_nama,
          nominal: Number(detail.nominal) || 0,
          info: detail.cicilan_info || detail.keterangan || `Bulanan • ${periodLabel(period)}`,
          kategori: detail.cicilan_info ? 'berjangka' : 'bulanan',
          keterangan: detail.keterangan || '',
          readOnly: true,
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
    const tenor = Math.max(1, Math.min(120, Number(tenorNode.value) || 1));
    const endNode = $('#loan-end');
    const previewNode = $('#loan-preview');
    if (endNode) endNode.textContent = periodLabel(addMonths(start.value || state.period, tenor - 1));
    if (previewNode) previewNode.textContent = `1 / ${tenor} bulan`;
  }

  function openLoanDialog() {
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
    if (!Number.isInteger(tenor) || tenor < 1 || tenor > 120) {
      showInlineError('loan', 'Tenor harus antara 1 dan 120 bulan.');
      return;
    }
    const keterangan = $('#loan-keterangan').value.trim();
    const end = addMonths(start, tenor - 1);

    if (state.mode === 'api' && state.token) {
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
      return;
    }

    // Mode demo
    const loan = {
      id: uid('loan'),
      nip,
      nama: employee.nama,
      pos_id: pos.id,
      pos_nama: pos.nama_pos,
      opd_nama: state.opd,
      nominal_per_bulan: nominal,
      start_period: start,
      end_period: end,
      tenor_bulan: tenor,
      keterangan,
      created_by: 'Demo',
    };
    state.loans.unshift(loan);

    const progress = loanProgressFor(loan, state.period);
    if (progress.cicilan) {
      employee.internalPotongan = employee.internalPotongan || [];
      employee.internalPotongan.push({
        id: uid('pot'),
        pos: pos.nama_pos,
        nominal,
        info: `Cicilan ${progress.cicilan} dari ${tenor} • ${periodLabel(start)} – ${periodLabel(end)}`,
        kategori: 'berjangka',
        period: start,
        start,
        end,
        tenor,
        cicilan: progress.cicilan,
        keterangan,
      });
      recomputeEmployee(employee);
    }

    addActivity('potongan', 'Pinjaman berjangka dibuat', `${employee.nama} • ${pos.nama_pos} • ${tenor} bulan`, 'amber');
    renderAll();
    closeModal();
    toast('Pinjaman dicatat', `${pos.nama_pos} • ${tenor} bulan s.d. ${periodLabel(end)}.`, 'success');
  }

  function showInlineError(name, message) {
    const node = $(`#${name}-error`);
    if (!node) return;
    node.textContent = message || 'Terjadi kesalahan.';
    node.hidden = false;
  }

  function openPosDialog() {
    renderPosTable();
    const form = $('#form-pos');
    if (form) form.reset();
    const error = $('#pos-error');
    if (error) error.hidden = true;
    openModal('pos');
  }

  async function submitPos(event) {
    event.preventDefault();
    const error = $('#pos-error');
    if (error) error.hidden = true;
    const nama = $('#pos-nama').value.trim();
    const kategori = $('#pos-kategori').value;
    if (!nama) {
      showInlineError('pos', 'Nama pos potongan wajib diisi.');
      return;
    }
    if (state.posList.some((pos) => pos.nama_pos.trim().toLowerCase() === nama.toLowerCase())) {
      showInlineError('pos', 'Nama pos potongan sudah ada pada OPD ini.');
      return;
    }

    if (state.mode === 'api' && state.token) {
      const button = $('#form-pos button[type="submit"]');
      if (button) button.disabled = true;
      try {
        const saved = await apiRequest('/api/v1/potongan/pos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nama_pos: nama, kategori }),
        });
        state.posList.push(mapApiPos(saved));
        addActivity('potongan', 'Pos potongan ditambahkan', `${nama} • ${kategori}`, 'amber');
        renderAll();
        const form = $('#form-pos');
        if (form) form.reset();
        toast('Pos ditambahkan', `${nama} (${kategori}) tersimpan.`, 'success');
        await loadPotonganReferenceData();
      } catch (caught) {
        showInlineError('pos', caught.message);
      } finally {
        if (button) button.disabled = false;
      }
      return;
    }

    const newId = state.posList.reduce((max, pos) => Math.max(max, Number(pos.id) || 0), 0) + 1;
    state.posList.push({
      id: newId,
      opd_id: 1,
      opd_nama: state.opd,
      nama_pos: nama,
      kategori,
      is_active: true,
    });
    addActivity('potongan', 'Pos potongan ditambahkan', `${nama} • ${kategori}`, 'amber');
    renderAll();
    const form = $('#form-pos');
    if (form) form.reset();
    toast('Pos ditambahkan', `${nama} (${kategori}) untuk sesi demo.`, 'success');
  }

  async function togglePos(posId) {
    const pos = findPos(posId);
    if (!pos) return;
    const target = !pos.is_active;

    if (state.mode === 'api' && state.token) {
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
      return;
    }

    pos.is_active = target;
    renderAll();
    toast(target ? 'Pos diaktifkan' : 'Pos dinonaktifkan', pos.nama_pos, 'info');
  }

  function openManualImport() {
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

  function showManualResult(data, demo = false) {
    const error = $('#manual-error');
    if (error) error.hidden = true;
    const result = $('#manual-result');
    if (result) result.hidden = false;
    const setText = (selector, value) => {
      const node = $(selector);
      if (node) node.textContent = value;
    };
    setText('#manual-result-title', demo ? 'Simulasi mode demo' : 'Import potongan berhasil');
    setText('#manual-result-rows', String(Number(data.total_rows) || 0));
    setText('#manual-result-inserted', String(Number(data.inserted) || 0));
    setText('#manual-result-updated', String(Number(data.updated) || 0));
    setText('#manual-result-period', `${data.pos || '—'} • ${data.period || state.period}`);
    setManualProgress(100, demo ? 'Mode demo — tidak ada data yang disimpan.' : 'Import selesai.');
  }

  async function runManualImport() {
    if (state.manualImportRunning) return;
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

    if (state.mode !== 'api' || !state.token) {
      setManualProgress(100, 'Mode demo — file tidak dikirim ke server.');
      showManualResult({
        total_rows: 0,
        inserted: 0,
        updated: 0,
        pos: pos.nama_pos,
        period,
      }, true);
      addActivity('potongan', 'Import potongan demo', `${file.name} • ${pos.nama_pos}`, 'amber');
      toast('Mode demo', 'Import tidak dikirim ke server. Gunakan mode API untuk penyimpanan nyata.', 'info');
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
    if (state.mode !== 'api' || !state.token) {
      const count = state.loans.filter((loan) => loanProgressFor(loan, state.period).status === 'aktif').length;
      addActivity('potongan', 'Realisasi cicilan demo', `${count} pinjaman • ${periodLabel(state.period)}`, 'amber');
      toast('Mode demo', `Realisasi ${count} pinjaman disimulasikan untuk ${periodLabel(state.period)}.`, 'info');
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

  function renderPrintPreview() {
    const preview = $('#preview-pages');
    const printRoot = $('#print-root');
    if (!preview || !printRoot) return;

    const employees = getPrintEmployees();
    const pages = chunk(employees, 5);

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
          <div class="paper-label">Halaman ${pageIndex + 1} dari ${pages.length} • F4 215 × 330 mm</div>
          ${page.map((employee, index) => renderSlip(employee, pageIndex * 5 + index)).join('')}
        </section>`).join('') + `
        <div class="print-help">Pratinjau diperkecil. Klik <strong>Cetak</strong> untuk output F4 215 × 330 mm.</div>`;

      printRoot.innerHTML = pages.map((page) => `
        <div class="print-page">
          ${page.map((employee, index) => renderSlip(employee, index)).join('')}
        </div>`).join('');
    }

    const info = $('#print-selection-info');
    if (info) {
      info.textContent = employees.length
        ? `${employees.length} pegawai • ${pages.length} halaman`
        : '0 pegawai • 0 halaman';
    }
    const pageCount = $('#print-page-count');
    if (pageCount) pageCount.textContent = '5 slip / halaman';

    const useSelected = $('#print-use-selected');
    if (useSelected) useSelected.checked = state.printUseSelected;

    renderPrintListbox();
  }

  function renderPrintListbox() {
    const list = $('#print-employee-listbox');
    if (!list) return;

    list.innerHTML = state.employees.map((employee) => {
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
      sub.textContent = state.selected.size
        ? `${state.selected.size} dipilih`
        : 'Semua pegawai';
    }
  }

  function cicilanTag(item) {
    const text = String(item.info || '');
    const match = text.match(/Cicilan\s+(\d+)\s+dari\s+(\d+)/i);
    if (match) return ` (${match[1]}/${match[2]})`;
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
    const opd = employee.opd || state.opdRaw || DEMO_OPD;
    const incomeRows = [];
    const deductionRows = [];
    const internalRows = [];

    if (employee.income) {
      const income = employee.income;
      incomeRows.push(['Gaji Pokok', income.gapok]);
      incomeRows.push(['Tj. Istri / Suami', income.tjistri]);
      incomeRows.push(['Tj. Anak', income.tjanak]);
      incomeRows.push(['Tj. Beras', income.tjberas]);
      incomeRows.push(['Tj. Askes / Lainnya', income.tjaskes]);
      const known = ['gapok', 'tjistri', 'tjanak', 'tjberas', 'tjaskes']
        .reduce((sum, key) => sum + (Number(income[key]) || 0), 0);
      const other = (Number(employee.kotor) || 0) - known;
      if (Math.abs(other) >= 0.005) incomeRows.push(['Tunjangan Lain', other]);
    } else {
      incomeRows.push(['Penghasilan Kotor', employee.kotor]);
    }

    if (employee.resmi) {
      const resmi = employee.resmi;
      deductionRows.push(['IWP Beban Pegawai', resmi.iwpPegawai]);
      deductionRows.push(['IWP Taspen', resmi.iwpTaspen]);
      deductionRows.push(['PPh 21', resmi.pph]);
      deductionRows.push(['JKK & JKM', resmi.jkkJkm]);
      const known = ['iwpPegawai', 'iwpTaspen', 'pph', 'jkkJkm']
        .reduce((sum, key) => sum + (Number(resmi[key]) || 0), 0);
      const other = (Number(employee.potonganSimgaji) || 0) - known;
      if (Math.abs(other) >= 0.005) deductionRows.push(['Potongan Lain', other]);
    } else {
      deductionRows.push(['Potongan SIMGAJI', employee.potonganSimgaji]);
    }

    const baseInternal = Number(employee.basePotonganInternal) || 0;
    if (baseInternal > 0) internalRows.push(['Potongan Internal', baseInternal]);

    const items = employee.internalPotongan || [];
    items.slice(0, 4).forEach((item) => {
      internalRows.push([`${item.pos}${cicilanTag(item)}`, item.nominal]);
    });
    if (items.length > 4) {
      const rest = items.slice(4).reduce((sum, item) => sum + (Number(item.nominal) || 0), 0);
      internalRows.push([`Lainnya (+${items.length - 4})`, rest]);
    }
    if (!internalRows.length) {
      internalRows.push([
        Number(employee.potonganInternal) > 0 ? 'Potongan Internal' : 'Tidak ada potongan',
        employee.potonganInternal,
      ]);
    }

    return `
      <article class="slip">
        <div class="slip-head">
          <div class="slip-opd" title="${escapeHtml(opd)}">${escapeHtml(opd)}</div>
          <div class="slip-period">SLIP GAJI — ${escapeHtml(periodLabel(state.period).toUpperCase())}</div>
        </div>
        <div class="slip-bio">
          <span><b>NIP/Nama:</b> ${escapeHtml(employee.nip)} / ${escapeHtml(employee.nama)}</span>
          <span><b>Pangkat/Gol:</b> ${escapeHtml(employee.kdpangkat || '—')}</span>
          <span><b>No. Rekening:</b> ${escapeHtml(employee.norek || '—')}</span>
        </div>
        <div class="slip-grid">
          <div class="slip-col">
            <div class="slip-col-title">PENGHASILAN</div>
            ${slipRows(incomeRows)}
            <div class="slip-row total"><span>KOTOR</span><span>${formatAmount(employee.kotor)}</span></div>
          </div>
          <div class="slip-col">
            <div class="slip-col-title">POTONGAN RESMI</div>
            ${slipRows(deductionRows)}
            <div class="slip-row total"><span>Subtotal SIMGAJI</span><span>${formatAmount(employee.potonganSimgaji)}</span></div>
          </div>
          <div class="slip-col">
            <div class="slip-col-title">POTONGAN LAINNYA</div>
            ${slipRows(internalRows)}
            <div class="slip-row total"><span>Subtotal Potongan</span><span>${formatAmount(employee.potonganInternal)}</span></div>
          </div>
        </div>
        <div class="slip-foot">
          <span>Total Potongan: <strong>Rp ${formatAmount(employee.totalPotongan)}</strong></span>
          <span class="net">DITERIMA BERSIH: <strong>Rp ${formatAmount(employee.thp)}</strong></span>
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
      fileStatus.textContent = 'Siap';
    }
    const opdStatus = $('#opd-check-status');
    if (opdStatus) {
      opdStatus.className = 'status-pill warn';
      opdStatus.textContent = 'Akan diverifikasi';
    }
    const fileOpd = $('#opd-file-value');
    if (fileOpd) fileOpd.textContent = 'Diperiksa dari kolom nmskpd';
    const accountOpd = $('#opd-account-value');
    if (accountOpd) accountOpd.textContent = state.opd;

    setImportRunning(false);
    resetImportPanels();
    setProgress(0, 'File siap diimpor.', 'Klik “Mulai Import” untuk memvalidasi dan menyimpan.');
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
    if (!state.currentFile || state.importRunning) return;

    state.importRunning = true;
    setImportRunning(true);
    const error = $('#import-error');
    const result = $('#import-result');
    if (error) error.hidden = true;
    if (result) result.hidden = true;
    setProgress(8, 'Membaca file…', 'Memeriksa struktur kolom dan OPD.');

    const filename = state.currentFile.name;

    if (state.mode === 'api' && state.token) {
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
        toast('Import berhasil', `${body.inserted || 0} baru, ${body.updated || 0} diperbarui.`, 'success');
        renderAll();

        if ((body.periods || []).includes(state.period)) {
          loadApiData(state.token).then((data) => {
            applyApiData(data, state.token);
            renderAll();
          }).catch(() => {});
        }
      } catch (caught) {
        if (timer) window.clearInterval(timer);
        showImportError(caught.message || 'Import gagal.', caught.errors || []);
        toast('Import gagal', caught.message || 'Periksa file dan koneksi.', 'error');
      }
      return;
    }

    // Demo import: simulasi progres dan hasil upsert.
    let progress = 10;
    const timer = window.setInterval(() => {
      progress = Math.min(92, progress + 7 + Math.random() * 8);
      const stage = progress < 40
        ? 'Memvalidasi 43 kolom dan nmskpd…'
        : progress < 72
          ? 'Mencocokkan OPD dan NIP…'
          : 'Melakukan upsert (nip, tglgaji)…';
      setProgress(progress, stage, 'Mode demo — tidak mengirim file ke server.');
    }, 170);

    window.setTimeout(() => {
      window.clearInterval(timer);
      const result = {
        status: 'success',
        opd: state.opdRaw || state.opd,
        total_rows: state.employees.length || 6,
        inserted: 0,
        updated: state.employees.length || 6,
        periods: [state.period],
        warnings: [],
      };
      showImportResult(result);
      addImportHistory(result, filename);
      addActivity('import', 'Import SIMGAJI berhasil', `${filename} • ${result.total_rows} baris`, 'green');
      toast('Import demo berhasil', `${result.updated} baris diperbarui (mode demo).`, 'success');
      renderAll();
    }, 1550);
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
      nominal,
      info: infoParts.join(' • '),
      kategori: 'bulanan',
      period,
      keterangan,
    };
    employee.internalPotongan = employee.internalPotongan || [];
    employee.internalPotongan.push(item);
    recomputeEmployee(employee);
    addActivity('potongan', 'Potongan bulanan ditambahkan', `${employee.nama} • ${pos}`, 'amber');
    renderAll();
    resetBulananForm();
    toast('Potongan disimpan', `${pos} ${formatRupiah(nominal, 0)} untuk ${employee.nama}.`, 'success');
  }

  function deletePotongan(id) {
    const employee = currentPotonganEmployee();
    if (!employee) return;
    const items = employee.internalPotongan || [];
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return;
    if (items[index].readOnly) {
      toast('Tidak dapat dihapus', 'Potongan ini berasal dari data API.', 'error');
      return;
    }
    const [removed] = items.splice(index, 1);
    recomputeEmployee(employee);
    addActivity('potongan', 'Potongan dihapus', `${employee.nama} • ${removed.pos}`, 'amber');
    renderAll();
    toast('Potongan dihapus', `${removed.pos} dihapus dari sesi demo.`, 'info');
  }

  /* ============================== API / CONNECTION ============================== */

  function mapApiEmployee(raw) {
    return {
      nip: raw.nip,
      nama: raw.nama,
      kdpangkat: raw.kdpangkat || '—',
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
    state.opd = data.opd || 'Semua OPD';
    state.opdRaw = data.opd || '';
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

    storageSet('simgaji.mode', 'api', localStorage);
    storageSet('simgaji.token', token, sessionStorage);
    renderAll();
    void loadPotonganReferenceData();
  }

  function fallbackToDemo(message) {
    state.mode = 'demo';
    state.token = '';
    state.profile = null;
    state.opdOptions = [];
    state.profileChangeMode = false;
    storageSet('simgaji.mode', 'demo', localStorage);
    storageRemove('simgaji.token', sessionStorage);
    loadDemoData();
    renderAll();
    updateProfileUI();
    if (message) toast('Beralih ke mode demo', message, 'error');
  }

  function openConnectionModal() {
    const mode = state.mode;
    const demoRadio = $('#mode-demo');
    const apiRadio = $('#mode-api');
    if (demoRadio) demoRadio.checked = mode !== 'api';
    if (apiRadio) apiRadio.checked = mode === 'api';
    const tokenWrap = $('#connection-token-wrap');
    if (tokenWrap) tokenWrap.hidden = mode !== 'api';
    const tokenInput = $('#api-token');
    if (tokenInput) tokenInput.value = state.token || '';
    const error = $('#connection-error');
    if (error) error.hidden = true;
    openModal('connection');
  }

  async function applyConnection() {
    const modeNode = document.querySelector('input[name="data-mode"]:checked');
    const mode = modeNode ? modeNode.value : 'demo';
    const error = $('#connection-error');
    if (error) error.hidden = true;

    if (mode === 'demo') {
      state.mode = 'demo';
      state.token = '';
      state.profile = null;
      state.opdOptions = [];
      state.profileChangeMode = false;
      storageSet('simgaji.mode', 'demo', localStorage);
      storageRemove('simgaji.token', sessionStorage);
      loadDemoData();
      renderAll();
      updateProfileUI();
      closeModal();
      toast('Mode demo aktif', 'Dashboard memakai contoh data lokal.', 'info');
      return;
    }

    const tokenInput = $('#api-token');
    const token = tokenInput ? tokenInput.value.trim() : '';
    if (!token) {
      if (error) {
        error.textContent = 'Firebase ID Token wajib diisi untuk mode API.';
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
        toast('Terhubung ke API', `${state.employees.length} pegawai dimuat.`, 'success');
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

  async function refreshData() {
    if (state.mode === 'api' && state.token) {
      if (state.profile && state.profile.needs_opd) {
        await openProfileDialog();
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
      return;
    }
    loadDemoData();
    renderAll();
    toast('Mode demo', 'Contoh data berhasil dimuat ulang.', 'info');
  }


  async function fetchSlipData(nip, period) {
    return await apiRequest(`/api/v1/payroll/${nip}?period=${period}`);
  }

  async function fetchOpdSlipData(period) {
    const data = await apiRequest(`/api/v1/payroll/opd/summary?period=${period}`);
    return data.employees;
  }

  async function doPrint(dataList, period) {
    const win = window.open('', '_blank', 'width=800,height=600');
    const template = await (await fetch('/template_slip_f4.html')).text();
    win.document.write(template);
    win.document.close();
    win.onload = () => {
        win.renderSlips(dataList, period);
        win.print();
    };
  }

  /* ============================== VIEW / WINDOW ============================== */

  const VIEW_TITLES = {
    dashboard: 'Dashboard',
    import: 'Import SIMGAJI',
    potongan: 'Potongan',
    print: 'Cetak Slip',
  };

  function setView(view, silent = false) {
    const next = VIEW_TITLES[view] ? view : 'dashboard';
    state.view = next;

    $$('.view').forEach((section) => {
      const active = section.dataset.view === next;
      section.hidden = !active;
      section.classList.toggle('active', active);
    });

    $$('[data-view-link]').forEach((button) => {
      const isSide = button.classList.contains('side-nav-item');
      const active = button.dataset.viewLink === next;
      if (isSide) {
        button.classList.toggle('active', active);
        if (active) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      }
    });

    const crumb = $('#toolbar-crumb');
    if (crumb) crumb.textContent = VIEW_TITLES[next];
    const content = $('#app-content');
    if (content) content.scrollTop = 0;
    const startMenu = $('#start-menu');
    if (startMenu) startMenu.hidden = true;
    const orb = $('#start-orb');
    if (orb) orb.setAttribute('aria-expanded', 'false');

    if (next === 'print') renderPrintPreview();
    if (next === 'potongan') renderPotongan();
    if (next === 'dashboard') renderDashboard(computeTotals());
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
    toast('Jendela diminimize', 'Klik tombol SIMGAJI ASN pada taskbar untuk membuka.', 'info');
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
    toast('Aplikasi ditutup', 'Klik ikon SIMGAJI ASN di desktop untuk membuka kembali.', 'info');
  }

  function toggleMaximize() {
    const windowNode = $('#app-window');
    if (!windowNode) return;
    const maximized = windowNode.classList.toggle('is-maximized');
    const maximizeButton = document.querySelector('[data-window-action="maximize"]');
    if (maximizeButton) {
      maximizeButton.setAttribute('aria-label', maximized ? 'Restore' : 'Maximize');
      maximizeButton.setAttribute('data-window-action', maximized ? 'restore' : 'maximize');
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
    else if (action === 'maximize') toggleMaximize();
    else if (action === 'restore') {
      const windowNode = $('#app-window');
      if (windowNode && windowNode.classList.contains('is-maximized')) toggleMaximize();
      else restoreWindow();
    } else if (action === 'close') openModal('close');
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
    const target = tab === 'berjangka' ? 'berjangka' : 'bulanan';
    $$('[role="tab"]').forEach((button) => {
      const selected = button.dataset.tab === target;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    $$('[role="tabpanel"]').forEach((panel) => {
      panel.hidden = panel.id !== `tab-panel-${target}`;
    });
  }

  /* ============================== EVENTS ============================== */

  function buildPeriodSelects() {
    const options = PERIODS.map((period) => (
      `<option value="${period}">${periodLabel(period)}</option>`
    )).join('');
    ['#period-select', '#bulanan-period', '#manual-period', '#loan-start'].forEach((selector) => {
      const select = $(selector);
      if (select) select.innerHTML = options;
    });
    const periodSelect = $('#period-select');
    if (periodSelect) periodSelect.value = state.period;
    const bulananPeriod = $('#bulanan-period');
    if (bulananPeriod) bulananPeriod.value = state.period;
    const manualPeriod = $('#manual-period');
    if (manualPeriod) manualPeriod.value = state.period;
    const loanStart = $('#loan-start');
    if (loanStart) loanStart.value = state.period;
  }

  function bindEvents() {
    // Navigasi
    document.addEventListener('click', (event) => {
      const viewButton = event.target.closest('[data-view-link]');
      if (viewButton) {
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
        event.preventDefault();
        const dialog = openDialogButton.dataset.openModal;
        if (dialog === 'loan') openLoanDialog();
        else if (dialog === 'pos') openPosDialog();
        else if (dialog === 'manual-import') openManualImport();
        else openModal(dialog);
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
        state.period = periodSelect.value;
        state.selected = new Set();
        const bulananPeriod = $('#bulanan-period');
        if (bulananPeriod) bulananPeriod.value = state.period;
        const manualPeriod = $('#manual-period');
        if (manualPeriod) manualPeriod.value = state.period;
        const loanStart = $('#loan-start');
        if (loanStart) loanStart.value = state.period;
        renderAll();
        if (state.mode === 'api' && state.token) {
          loadApiData(state.token).then((data) => {
            applyApiData(data, state.token);
            renderAll();
            toast('Periode diperbarui', periodLabel(state.period), 'info');
          }).catch((caught) => {
            toast('Gagal memuat periode', caught.message || 'Periksa koneksi.', 'error');
          });
        } else {
          toast('Periode demo', `Menampilkan data ${periodLabel(state.period)}.`, 'info');
        }
      });
    }

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
      dropZone.addEventListener('click', () => fileInput.click());
      dropZone.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          fileInput.click();
        }
      });
      fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
      });
      ['dragenter', 'dragover'].forEach((type) => {
        dropZone.addEventListener(type, (event) => {
          event.preventDefault();
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
    $$('[role="tab"]').forEach((button) => {
      button.addEventListener('click', () => setTab(button.dataset.tab));
      button.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const tabs = $$('[role="tab"]');
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

    // Form potongan
    const potonganNip = $('#potongan-nip');
    if (potonganNip) {
      potonganNip.addEventListener('change', () => {
        state.potonganNip = potonganNip.value;
        updatePotonganEmployee(state.potonganNip);
        if (state.mode === 'api') {
          loadEmployeePotongan(state.potonganNip, state.period);
        }
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
    ['#bulanan-nominal', '#loan-nominal'].forEach((selector) => {
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
    const posTableBody = $('#pos-table-body');
    if (posTableBody) {
      posTableBody.addEventListener('click', (event) => {
        const toggle = event.target.closest('[data-pos-toggle]');
        if (toggle) {
          event.preventDefault();
          togglePos(toggle.dataset.posToggle);
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
      printButton.addEventListener('click', () => {
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
    const connectionButton = $('#btn-connection');
    if (connectionButton) connectionButton.addEventListener('click', openConnectionModal);
    const modeChip = $('#data-mode-chip');
    if (modeChip) modeChip.addEventListener('click', openConnectionModal);
    const trayConnection = $('#tray-connection');
    if (trayConnection) trayConnection.addEventListener('click', openConnectionModal);
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
    const profileLogout = $('#btn-profile-logout');
    if (profileLogout) profileLogout.addEventListener('click', logout);

    const btnPrintSelected = $('#btn-print-selected');
    if (btnPrintSelected) btnPrintSelected.addEventListener('click', async () => {
        const period = $('#print-period').value;
        const search = $('#print-search').value.toLowerCase();
        const selected = state.employees.filter(e => 
            (e.nip.includes(search) || e.nama.toLowerCase().includes(search))
        );
        if (selected.length === 0) { toast('Error', 'ASN tidak ditemukan', 'error'); return; }
        const details = await Promise.all(selected.map(e => fetchSlipData(e.nip, period)));
        await doPrint(details, period);
    });

    const btnPrintOpd = $('#btn-print-opd');
    if (btnPrintOpd) btnPrintOpd.addEventListener('click', async () => {
        const period = $('#print-period').value;
        const list = await fetchOpdSlipData(period);
        const details = await Promise.all(list.map(e => fetchSlipData(e.nip, period)));
        await doPrint(details, period);
    });

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
    $$('input[name="data-mode"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        const wrap = $('#connection-token-wrap');
        if (wrap) wrap.hidden = radio.value !== 'api' || !radio.checked;
      });
    });
    const confirmClose = $('#btn-confirm-close');
    if (confirmClose) confirmClose.addEventListener('click', closeWindow);

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
    buildPeriodSelects();
    loadDemoData();
    bindEvents();
    updateClock();
    if (clockTimer) window.clearInterval(clockTimer);
    clockTimer = window.setInterval(updateClock, 15000);
    renderAll();
    setView('dashboard', true);

    if (state.mode === 'api') {
      if (!state.token) {
        state.mode = 'demo';
        storageSet('simgaji.mode', 'demo', localStorage);
        updateProfileUI();
        return;
      }
      setStatus('Menghubungkan ke API…');
      connectApiSession(state.token)
        .then((profile) => {
          setStatus('Data API siap.');
          if (!profile.needs_opd) {
            toast('Terhubung ke API', `${state.employees.length} pegawai dimuat.`, 'success');
          }
        })
        .catch((caught) => fallbackToDemo(caught.message || 'Token atau koneksi tidak valid.'));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
