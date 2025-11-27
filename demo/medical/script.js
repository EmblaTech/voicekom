document.addEventListener('DOMContentLoaded', async () => {
  // ---------- app state ----------
  const STORAGE_KEY = 'clinic_appointments_v1';
  const NOTIFIED_KEY = 'clinic_notified_refs_v1';
  let appointments = [];
  let editingRef = null;
  // pagination state
  const PAGE_SIZE_KEY = 'clinic_page_size';
  let currentPage = 1; // 1-based index
  let pageSize = parseInt(localStorage.getItem(PAGE_SIZE_KEY) || '25', 10);
  // sorting state
  let sortField = 'patientName'; // 'patientName' | 'apptDate' | 'doctor'
  let sortDir = 'asc'; // 'asc' | 'desc'

  // ---------- DOM refs ----------
  const tabs = document.querySelectorAll('.tab-btn');
  const pages = {
    appointments: document.getElementById('appointments-page'),
    billing: document.getElementById('billing-page'),
    research: document.getElementById('research-page'),
    reports: document.getElementById('reports-page'),
    help: document.getElementById('help-page'),
  };

  const listView = document.getElementById('appointmentsListView');
  const formView = document.getElementById('appointmentsFormView');

  const createBtnTop = document.getElementById('createBtnTop');
  const appointmentForm = document.getElementById('appointmentForm');
  const submitFormBtn = document.getElementById('submitFormBtn');
  const cancelForm = document.getElementById('cancelForm');
  const formTitle = document.getElementById('formTitle');
  const toastEl = document.getElementById('toast');

  const tbody = document.getElementById('appointmentsTbody');
  const searchInput = document.getElementById('searchInput');
  // pagination UI refs
  const itemsPerPageSelect = document.getElementById('itemsPerPage');
  const rangeLabelEl = document.getElementById('rangeLabel');
  const pageLabelEl = document.getElementById('pageLabel');
  const firstPageBtn = document.getElementById('firstPageBtn');
  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');
  const lastPageBtn = document.getElementById('lastPageBtn');
  // delete modal elements
  const deleteModal = document.getElementById('deleteModal');
  const deleteModalMessage = document.getElementById('deleteModalMessage');
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
  const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
  let pendingDeleteRef = null;
  let lastDeleteButton = null;
  // Track notified state per appointment (session-level)
  const notifiedOnce = new Set();
  // load persisted notified refs
  try {
    const storedNotified = JSON.parse(localStorage.getItem(NOTIFIED_KEY) || '[]');
    if (Array.isArray(storedNotified)) storedNotified.forEach(r => notifiedOnce.add(r));
  } catch(_) {}

  // ---------- init ----------
  attachTabListeners();
  attachUIListeners();
  // Load from localStorage first; if empty, try JSON file; if still empty, seed minimal
  appointments = loadAppointments();
  // Backfill missing refs for any existing stored appointments
  if (Array.isArray(appointments) && appointments.length) {
    let changed = false;
    appointments = appointments.map(a => {
      if (a && !a.ref) { changed = true; return { ...a, ref: makeRef() }; }
      return a;
    });
    if (changed) saveAppointments();
  }
  if (!Array.isArray(appointments) || appointments.length === 0) {
    try {
      const json = await loadFromJsonFile();
      if (Array.isArray(json) && json.length) {
        // backfill unique refs if missing
        appointments = (json || []).map(a => ({
          ...a,
          ref: a && a.ref ? a.ref : makeRef()
        }));
        saveAppointments();
      }
    } catch (e) {
      console.warn('Failed to load appointments.json, using minimal seed', e);
      appointments = [
        makeAppointmentObject('Alex', '0700000000', '2025-11-20', '09:00', 'Doctor Rob', 'Male', '23', ['Wheelchair'], 'Demo record A'),
        makeAppointmentObject('Ben', '0771234567', '2025-11-21', '10:30', 'Doctor Lee', 'Male', '31', [], 'Demo record B'),
        makeAppointmentObject('Clara', '0719992211', '2025-11-22', '14:00', 'Doctor Ben', 'Female', '28', ['Allergy'], 'Demo record C')
      ];
      saveAppointments();
    }
  }
  // one-time normalization of any pre-existing stored records
  appointments = appointments.map(a => {
    if (!a) return a;
    return {
      ...a,
      doctor: titleCase(normalizeDoctor(a.doctor)),
      gender: normalizeGender(a.gender)
    };
  });
  saveAppointments();
  renderAppointmentsTable();
  // initialize sort button UI
  (function(){ try { updateSortUI(); } catch(_) {} })();
  showTab('appointments');

  // Enhance doctor selects with rotating arrow indicator
  function enhanceSelectWithArrow(selectId){
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const wrapper = sel.closest('.doctor-select-wrapper');
    if (!wrapper) return; // markup already wrapped in HTML
    // Add open class on mousedown (before native UI opens) and remove on blur/change
    sel.addEventListener('mousedown', () => wrapper.classList.add('open'));
    sel.addEventListener('blur', () => wrapper.classList.remove('open'));
    sel.addEventListener('change', () => wrapper.classList.remove('open'));
    // Escape key closes visual state quickly
    sel.addEventListener('keydown', (e) => { if (e.key === 'Escape') wrapper.classList.remove('open'); });
  }
  enhanceSelectWithArrow('doctorSelect');
  enhanceSelectWithArrow('reportDoctorSelect');

  // Guard for VoiceKom initialization (if voicekom not loaded, don't crash)
  if (window.VoiceKom && typeof VoiceKom.init === 'function') {
    VoiceKom.init({
      wakeWords: [],
      sleepWords: [],
      containerId: 'speech-container',
      lang: 'en-US',

      transcription: {
      provider: 'default',
      apiKey: '' 
    },

    recognition: {
      provider: 'openai',
      apiKey: '' 
    },

    speakingThreshold: 0.2, 
    }).then(() => console.log('VoiceKom initialized')).catch(() => console.warn('VoiceKom init failed'));

  } else {
    console.warn('VoiceKom not available - voice features disabled');
  }

  // ---------- functions ----------

  function attachTabListeners() {
    tabs.forEach(t => {
      t.addEventListener('click', (ev) => {
        const tab = t.dataset.tab;
        // toggle active styling
        tabs.forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        // show the corresponding page container
        showPage(tab);
      });
    });
  }

  function showPage(tabName) {
    // hide all page-level containers
    Object.values(pages).forEach(p => p.classList.add('hidden'));
    const target = pages[tabName];
    if (target) {
      target.classList.remove('hidden');
    }
  }

  function showTab(tabName) {
    // helper to programmatically set the top tab active
    tabs.forEach(x => x.classList.toggle('active', x.dataset.tab === tabName));
    showPage(tabName);
  }

  function attachUIListeners() {
    createBtnTop.addEventListener('click', () => {
      openCreateForm();
    });

    cancelForm.addEventListener('click', (e) => {
      e.preventDefault();
      // clear any edit state and reset the form, then go back to list
      editingRef = null;
      appointmentForm.reset();
      showListView();
    });

    appointmentForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleFormSubmit();
    });

    searchInput.addEventListener('input', () => {
      // reset to first page on new search
      currentPage = 1;
      renderAppointmentsTable();
    });

    // pagination controls
    if (itemsPerPageSelect) {
      // initialize select to persisted pageSize
      if ([10,25,50,100].includes(pageSize)) {
        itemsPerPageSelect.value = String(pageSize);
      }
      itemsPerPageSelect.addEventListener('change', () => {
        const val = parseInt(itemsPerPageSelect.value || '25', 10);
        pageSize = isNaN(val) ? 25 : val;
        localStorage.setItem(PAGE_SIZE_KEY, String(pageSize));
        currentPage = 1;
        renderAppointmentsTable();
      });
    }
    firstPageBtn && firstPageBtn.addEventListener('click', () => {
      if (currentPage !== 1) {
        currentPage = 1;
        renderAppointmentsTable();
      }
    });
    prevPageBtn && prevPageBtn.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage -= 1;
        renderAppointmentsTable();
      }
    });
    nextPageBtn && nextPageBtn.addEventListener('click', () => {
      // increment; render will clamp and UI will disable when at last
      currentPage += 1;
      renderAppointmentsTable();
    });
    lastPageBtn && lastPageBtn.addEventListener('click', () => {
      // jump to a high page; render will clamp to last available page
      currentPage = Number.MAX_SAFE_INTEGER;
      renderAppointmentsTable();
    });
    // Sorting controls in table header
    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const f = btn.dataset.field;
        const d = btn.dataset.dir;
        if (!f || !d) return;
        sortField = f;
        sortDir = d === 'desc' ? 'desc' : 'asc';
        currentPage = 1;
        updateSortUI();
        renderAppointmentsTable();
      });
    });
    // ---------- Reports: setup (table hidden until Generate) ----------
    const reportTypeRadios = document.querySelectorAll('input[name="reportType"]');
    const reportStartInput = document.getElementById('reportStart');
    const reportEndInput = document.getElementById('reportEnd');
    const reportThead = document.getElementById('reportThead');
    const reportTbody = document.getElementById('reportTbody');
    const generateReportBtn = document.getElementById('generateReportBtn');
    const reportTableWrapper = document.getElementById('reportTableWrapper');
    const reportMeta = document.getElementById('reportMeta');
    const reportActions = document.getElementById('reportActions');
    const downloadReportBtn = document.getElementById('downloadReportBtn');

    const REPORT_COLUMNS = {
      patients: [
        'Patient Name','Patient Contact','Age','Gender',
        'Appointment Time','Appointment Date','Doctor name',
        'Room Number', 'Status', 'Consultation Fee'
      ],
      lab: [
        'Patient Name','Doctor (referred to lab)','Lab Operator','Lab Number',
        'Tests','Result Date','Status',
        'Test Cost','Lab maintenance cost','Total cost'
      ],
      payments: [
        'Doctor Name','Specialization','Service Name',
        'Patient Name','Amount charged (patient)','Doctor commission',
        'Doctor payout','Hospital payout','Payment date','Status'
      ]
    };

    function getSelectedReportType(){
      const r = document.querySelector('input[name="reportType"]:checked');
      let v = (r && r.value) ? String(r.value).trim().toLowerCase() : '';
      return REPORT_COLUMNS[v] ? v : '';
    }



    function renderDemoReport(type, doctors, start, end){
      if (!type) return;
      if (!reportThead || !reportTbody) return;
      const cols = REPORT_COLUMNS[type];
      if (!cols) return;
      // header
      reportThead.innerHTML = '';
      const headRow = document.createElement('tr');
      cols.forEach(label => {
        const th = document.createElement('th');
        th.textContent = label;
        headRow.appendChild(th);
      });
      reportThead.appendChild(headRow);

      reportTbody.innerHTML = '';
      const allRows = [];

  let renderedCount = 0;
  if (type === 'patients') {
        allRows.push(
      ['Oliver Smith','0712345601','34','Male','09:15','2025-11-02','Doctor Rob','Room 01','COMPLETED','Rs. 2,000/='],
      ['Emma Johnson','0712345602','28','Female','10:00','2025-11-03','Doctor Lee','Room 02','COMPLETED','Rs. 1,800/='],
      ['Noah Williams','0712345603','22','Male','11:30','2025-11-04','Doctor Ben','Room 03','PENDING','Rs. 2,300/='],
      ['Ava Brown','0712345604','31','Female','14:45','2025-11-05','Doctor Emily','Room 01','COMPLETED','Rs. 3,500/='],
      ['Liam Jones','0712345605','45','Male','09:00','2025-11-06','Doctor Michael','Room 02','COMPLETED','Rs. 4,200/='],
      ['Sophia Garcia','0712345606','27','Female','10:30','2025-11-07','Doctor Linda','Room 03','CANCELLED','-'],
      ['Mason Anderson','0712345607','52','Male','12:15','2025-11-08','Doctor Anna','Room 04','COMPLETED','Rs. 5,000/='],
      ['Isabella Davis','0712345608','36','Female','15:00','2025-11-09','Doctor Peter','Room 05','COMPLETED','Rs. 1,600/='],
      ['James Rodriguez','0712345609','40','Male','16:30','2025-11-10','Doctor Alan','Room 02','PENDING','Rs. 2,700/='],
      ['Mia Martinez','0712345610','24','Female','10:45','2025-11-11','Doctor Joe','Room 01','COMPLETED','Rs. 1,200/='],
      ['Benjamin Hernandez','0712345611','58','Male','13:30','2025-11-12','Doctor Nina','Room 03','COMPLETED','Rs. 6,200/='],
      ['Charlotte Lopez','0712345612','29','Female','09:20','2025-11-13','Doctor Greg','Room 04','PENDING','Rs. 2,100/='],
      ['Lucas Gonzalez','0712345613','33','Male','11:15','2025-11-14','Doctor Jason','Room 05','COMPLETED','Rs. 3,300/='],
      ['Amelia Wilson','0712345614','47','Female','08:30','2025-11-15','Doctor Mark','Room 02','COMPLETED','Rs. 2,900/='],
      ['Logan Thomas','0712345615','39','Male','14:10','2025-11-16','Doctor Paulo','Room 06','COMPLETED','Rs. 3,800/='],
      ['Evelyn Taylor','0712345616','26','Female','12:00','2025-11-17','Doctor Grace','Room 01','PENDING','Rs. 1,500/='],
      ['Owen Harris','0712345617','51','Male','09:40','2025-11-18','Doctor Rita','Room 03','COMPLETED','Rs. 4,500/='],
      ['Ella Sanchez','0712345618','30','Female','15:20','2025-11-19','Doctor Clara','Room 04','COMPLETED','Rs. 1,800/='],
      ['Daniel Clark','0712345619','37','Male','10:10','2025-11-20','Doctor Susan','Room 05','PENDING','Rs. 2,400/='],
      ['Scarlett Ramirez','0712345620','21','Female','11:50','2025-11-21','Doctor Maya','Room 01','COMPLETED','Rs. 1,100/='],
      ['Michael Lewis','0712345621','60','Male','13:05','2025-11-22','Doctor Rob','Room 02','COMPLETED','Rs. 5,900/='],
      ['Grace Robinson','0712345622','35','Female','09:55','2025-11-23','Doctor Lee','Room 03','PENDING','Rs. 2,300/='],
      ['Jacob Walker','0712345623','42','Male','16:00','2025-11-24','Doctor Ben','Room 04','COMPLETED','Rs. 3,600/='],
      ['Chloe Young','0712345624','19','Female','08:45','2025-11-25','Doctor Emily','Room 05','COMPLETED','Rs. 1,200/='],
      ['Sebastian King','0712345625','55','Male','12:40','2025-11-26','Doctor Michael','Room 01','CANCELLED','-'],
      ['Camila Hill','0712345626','28','Female','14:00','2025-11-27','Doctor Linda','Room 02','COMPLETED','Rs. 2,200/='],
      ['Jack Wright','0712345627','48','Male','10:25','2025-11-28','Doctor Anna','Room 03','PENDING','Rs. 3,300/='],
      ['Luna Scott','0712345628','23','Female','15:40','2025-11-29','Doctor Peter','Room 04','COMPLETED','Rs. 1,700/='],
      ['Aiden Green','0712345629','31','Male','09:05','2025-11-30','Doctor Alan','Room 05','COMPLETED','Rs. 2,000/='],
      ['Layla Adams','0712345630','27','Female','11:35','2025-12-01','Doctor Joe','Room 01','PENDING','Rs. 1,950/='],
      ['Ethan Baker','0712345631','44','Male','13:10','2025-12-02','Doctor Nina','Room 02','COMPLETED','Rs. 3,000/='],
      ['Zoe Nelson','0712345632','32','Female','10:50','2025-12-03','Doctor Greg','Room 03','COMPLETED','Rs. 1,600/='],
      ['Matthew Carter','0712345633','49','Male','09:30','2025-12-04','Doctor Jason','Room 04','PENDING','Rs. 4,200/='],
      ['Nora Mitchell','0712345634','26','Female','14:20','2025-12-05','Doctor Mark','Room 05','COMPLETED','Rs. 1,400/='],
      ['Samuel Roberts','0712345635','38','Male','08:55','2025-12-06','Doctor Paulo','Room 01','COMPLETED','Rs. 2,800/='],
      ['Aria Carter','0712345636','20','Female','11:05','2025-12-07','Doctor Grace','Room 02','COMPLETED','Rs. 900/='],
      ['David Phillips','0712345637','63','Male','15:30','2025-12-08','Doctor Rita','Room 03','PENDING','Rs. 5,200/='],
      ['Madison Campbell','0712345638','29','Female','12:10','2025-12-09','Doctor Clara','Room 04','COMPLETED','Rs. 1,500/='],
      ['Joseph Parker','0712345639','41','Male','09:45','2025-12-10','Doctor Susan','Room 05','COMPLETED','Rs. 2,700/='],
      ['Lily Evans','0712345640','33','Female','10:15','2025-12-11','Doctor Maya','Room 01','COMPLETED','Rs. 1,300/='],
      ['Carter Edwards','0712345641','46','Male','14:35','2025-12-12','Doctor Rob','Room 02','PENDING','Rs. 3,600/='],
      ['Hannah Collins','0712345642','37','Female','09:10','2025-12-13','Doctor Lee','Room 03','COMPLETED','Rs. 2,100/='],
      ['Wyatt Stewart','0712345643','58','Male','11:55','2025-12-14','Doctor Ben','Room 04','COMPLETED','Rs. 4,800/='],
      ['Penelope Sanchez','0712345644','30','Female','08:40','2025-12-15','Doctor Emily','Room 05','CANCELLED','-'],
      ['Gabriel Morris','0712345645','36','Male','13:00','2025-12-16','Doctor Michael','Room 01','COMPLETED','Rs. 2,500/='],
      ['Victoria Rogers','0712345646','25','Female','15:50','2025-12-17','Doctor Linda','Room 02','COMPLETED','Rs. 1,200/='],
      ['Isaac Reed','0712345647','54','Male','10:05','2025-12-18','Doctor Anna','Room 03','PENDING','Rs. 3,900/='],
      ['Ellie Cook','0712345648','22','Female','12:45','2025-12-19','Doctor Peter','Room 04','COMPLETED','Rs. 1,100/='],
      ['Julian Morgan','0712345649','43','Male','09:35','2025-12-20','Doctor Alan','Room 05','COMPLETED','Rs. 2,200/='],
      ['Violet Bell','0712345650','35','Female','14:15','2026-01-10','Doctor Joe','Room 01','COMPLETED','Rs. 1,750/='],
      ['Tyler Brooks','0771012345','38','Male','09:10','2025-11-04','Doctor Rob','Room 02','COMPLETED','Rs. 2,400/='],
      ['Megan Shaw','0712023456','29','Female','11:00','2025-11-09','Doctor Rob','Room 01','PENDING','Rs. 1,800/='],
      ['Ryan Stone','0773034567','46','Male','13:30','2025-11-15','Doctor Rob','Room 03','COMPLETED','Rs. 3,200/='],
      ['Sophie Lane','0714045678','34','Female','15:45','2025-11-21','Doctor Rob','Room 02','COMPLETED','Rs. 1,600/='],
      ['Brandon Holt','0775056789','51','Male','10:20','2025-12-02','Doctor Rob','Room 01','COMPLETED','Rs. 4,500/='],
      ['Emily Price','0716067890','27','Female','14:00','2025-12-08','Doctor Rob','Room 03','PENDING','Rs. 1,250/='],
      ['Connor Black','0777078901','42','Male','09:35','2025-12-16','Doctor Rob','Room 04','COMPLETED','Rs. 2,900/='],
      ['Natalie Reed','0718089012','31','Female','11:50','2026-01-05','Doctor Rob','Room 02','COMPLETED','Rs. 2,100/='],
      ['Patrick Cole','0779090123','59','Male','16:10','2026-01-12','Doctor Rob','Room 01','CANCELLED','-'],
      ['Zoe Hart','0719901234','23','Female','08:40','2026-01-20','Doctor Rob','Room 03','COMPLETED','Rs. 1,150/='],
      ['Aaron Miles','0711123456','36','Male','10:15','2025-11-05','Doctor Lee','Room 02','COMPLETED','Rs. 2,300/='],
      ['Chloe Grant','0771223344','28','Female','12:30','2025-11-11','Doctor Lee','Room 04','PENDING','Rs. 1,700/='],
      ['Dylan Price','0711334455','41','Male','14:55','2025-11-19','Doctor Lee','Room 03','COMPLETED','Rs. 3,600/='],
      ['Fiona Brooks','0771445566','33','Female','09:05','2025-11-26','Doctor Lee','Room 02','COMPLETED','Rs. 1,900/='],
      ['Gavin Hart','0711556677','47','Male','15:20','2025-12-03','Doctor Lee','Room 05','COMPLETED','Rs. 4,000/='],
      ['Isla Morris','0771667788','25','Female','11:40','2025-12-10','Doctor Lee','Room 01','PENDING','Rs. 1,050/='],
      ['Kevin Dale','0711778899','50','Male','13:00','2025-12-18','Doctor Lee','Room 03','COMPLETED','Rs. 3,250/='],
      ['Laura Pike','0771889900','32','Female','09:25','2026-01-03','Doctor Lee','Room 04','COMPLETED','Rs. 1,400/='],
      ['Mason Reed','0711990011','29','Male','16:00','2026-01-14','Doctor Lee','Room 02','COMPLETED','Rs. 2,750/='],
      ['Naomi West','0771001122','39','Female','10:50','2026-01-25','Doctor Lee','Room 05','PENDING','Rs. 2,000/='],
      ['Owen Fox','0712101234','45','Male','08:55','2025-11-06','Doctor Ben','Room 01','COMPLETED','Rs. 3,100/='],
      ['Paige Summers','0772202345','27','Female','11:30','2025-11-13','Doctor Ben','Room 02','COMPLETED','Rs. 1,600/='],
      ['Quentin Hale','0712303456','54','Male','14:10','2025-11-22','Doctor Ben','Room 03','PENDING','Rs. 3,800/='],
      ['Riley Knox','0772404567','30','Female','09:45','2025-12-01','Doctor Ben','Room 04','COMPLETED','Rs. 1,900/='],
      ['Sarah Miles','0712505678','35','Female','13:15','2025-12-07','Doctor Ben','Room 02','COMPLETED','Rs. 2,400/='],
      ['Thomas Grey','0772606789','49','Male','15:35','2025-12-15','Doctor Ben','Room 01','COMPLETED','Rs. 3,500/='],
      ['Vanessa Cole','0712707890','26','Female','10:05','2026-01-02','Doctor Ben','Room 03','PENDING','Rs. 1,200/='],
      ['Wesley Dean','0772808901','38','Male','12:20','2026-01-09','Doctor Ben','Room 04','COMPLETED','Rs. 2,950/='],
      ['Xavier Holt','0712909012','57','Male','16:45','2026-01-21','Doctor Ben','Room 05','COMPLETED','Rs. 4,200/='],
      ['Yvonne Clark','0772000123','31','Female','08:30','2026-01-29','Doctor Ben','Room 02','CANCELLED','-'],
      ['Aaron Wells','0770101001','34','Male','09:00','2025-10-02','Doctor Rob','Room 01','COMPLETED','Rs. 2,100/='],
      ['Bethany Cole','0710101002','28','Female','10:30','2025-10-03','Doctor Rob','Room 02','COMPLETED','Rs. 1,800/='],
      ['Cameron Drew','0770101003','41','Male','11:15','2025-10-04','Doctor Rob','Room 03','PENDING','Rs. 2,400/='],
      ['Daphne Knox','0710101004','37','Female','14:00','2025-10-05','Doctor Rob','Room 01','COMPLETED','Rs. 2,000/='],
      ['Elliot Price','0770101005','50','Male','09:45','2025-10-06','Doctor Rob','Room 02','COMPLETED','Rs. 3,200/='],
      ['Faye Nolan','0710101006','23','Female','15:30','2025-10-07','Doctor Rob','Room 03','CANCELLED','-'],
      ['Gordon Blake','0770101007','47','Male','08:15','2025-10-09','Doctor Rob','Room 01','COMPLETED','Rs. 3,000/='],
      ['Holly Vance','0710101008','31','Female','12:00','2025-10-11','Doctor Rob','Room 02','PENDING','Rs. 1,750/='],
      ['Isaac Ford','0770101009','56','Male','13:20','2025-10-14','Doctor Rob','Room 04','COMPLETED','Rs. 4,100/='],
      ['Jade Rivers','0710101010','29','Female','10:10','2025-10-18','Doctor Rob','Room 03','COMPLETED','Rs. 1,650/='],
      ['Kurt Benson','0770101011','62','Male','16:00','2025-10-22','Doctor Rob','Room 01','PENDING','Rs. 5,000/='],
      ['Lara Finch','0710101012','26','Female','09:30','2025-10-29','Doctor Rob','Room 02','COMPLETED','Rs. 1,900/='],
      ['Mason Clark','0770202001','38','Male','09:10','2025-10-01','Doctor Lee','Room 01','COMPLETED','Rs. 2,300/='],
      ['Nina Shaw','0710202002','33','Female','11:40','2025-10-03','Doctor Lee','Room 02','PENDING','Rs. 1,950/='],
      ['Omar Aziz','0770202003','45','Male','14:30','2025-10-05','Doctor Lee','Room 03','COMPLETED','Rs. 3,400/='],
      ['Paula Grant','0710202004','27','Female','10:25','2025-10-07','Doctor Lee','Room 01','COMPLETED','Rs. 1,700/='],
      ['Quincy Holt','0770202005','52','Male','15:00','2025-10-08','Doctor Lee','Room 02','COMPLETED','Rs. 4,300/='],
      ['Rita Nguyen','0710202006','30','Female','09:50','2025-10-10','Doctor Lee','Room 03','CANCELLED','-'],
      ['Sean Patel','0770202007','49','Male','13:10','2025-10-12','Doctor Lee','Room 04','COMPLETED','Rs. 3,000/='],
      ['Tina Marsh','0710202008','24','Female','16:15','2025-10-15','Doctor Lee','Room 02','PENDING','Rs. 1,200/='],
      ['Uriel Moss','0770202009','57','Male','08:40','2025-10-17','Doctor Lee','Room 01','COMPLETED','Rs. 4,800/='],
      ['Vera Lane','0710202010','35','Female','12:30','2025-10-21','Doctor Lee','Room 03','COMPLETED','Rs. 2,100/='],
      ['Warren Cole','0770202011','43','Male','11:05','2025-10-24','Doctor Lee','Room 04','PENDING','Rs. 3,250/='],
      ['Xena Park','0710202012','29','Female','14:45','2025-10-30','Doctor Lee','Room 05','COMPLETED','Rs. 1,600/='],
      ['Yanni Cruz','0770303001','36','Male','09:35','2025-10-02','Doctor Ben','Room 01','COMPLETED','Rs. 2,050/='],
      ['Zoe Park','0710303002','28','Female','10:50','2025-10-04','Doctor Ben','Room 02','PENDING','Rs. 1,800/='],
      ['Aisha Khan','0770303003','42','Female','13:15','2025-10-06','Doctor Ben','Room 03','COMPLETED','Rs. 3,300/='],
      ['Blake Jay','0710303004','31','Male','15:40','2025-10-08','Doctor Ben','Room 01','COMPLETED','Rs. 1,900/='],
      ['Celia Owens','0770303005','47','Female','09:20','2025-10-11','Doctor Ben','Room 02','COMPLETED','Rs. 3,600/='],
      ['Drew Hill','0710303006','26','Male','11:30','2025-10-13','Doctor Ben','Room 03','CANCELLED','-'],
      ['Emma Fox','0770303007','54','Female','14:00','2025-10-16','Doctor Ben','Room 04','COMPLETED','Rs. 4,200/='],
      ['Frank Dale','0710303008','39','Male','08:55','2025-10-19','Doctor Ben','Room 02','PENDING','Rs. 2,700/='],
      ['Gina Vale','0770303009','33','Female','12:10','2025-10-23','Doctor Ben','Room 05','COMPLETED','Rs. 1,750/='],
      ['Hank Rivers','0710303010','60','Male','16:05','2025-10-25','Doctor Ben','Room 01','COMPLETED','Rs. 5,100/='],
      ['Iris Cole','0770303011','25','Female','10:15','2025-10-28','Doctor Ben','Room 03','PENDING','Rs. 1,300/='],
      ['Jules Park','0710303012','46','Male','13:50','2025-10-31','Doctor Ben','Room 04','COMPLETED','Rs. 3,400/='],
      ['Abby Lane','0711100001','29','Female','09:00','2025-10-01','Doctor Emily','Room 01','COMPLETED','Rs. 2,200/='],
      ['Blake Turner','0711100002','41','Male','10:15','2025-10-03','Doctor Emily','Room 02','PENDING','Rs. 3,100/='],
      ['Cara Hill','0711100003','34','Female','11:30','2025-10-05','Doctor Emily','Room 03','COMPLETED','Rs. 2,800/='],
      ['Drew Parks','0711100004','52','Male','13:00','2025-10-07','Doctor Emily','Room 01','COMPLETED','Rs. 4,000/='],
      ['Elsa Grant','0711100005','26','Female','14:45','2025-10-10','Doctor Emily','Room 02','CANCELLED','-'],
      ['Finn Brookes','0711100006','37','Male','09:50','2025-10-18','Doctor Emily','Room 04','COMPLETED','Rs. 2,700/='],
      ['Gwen Riley','0711100007','30','Female','16:00','2025-10-25','Doctor Emily','Room 03','COMPLETED','Rs. 1,900/='],
      ['Harvey Cole','0711100008','48','Male','08:30','2025-10-02','Doctor Michael','Room 02','COMPLETED','Rs. 3,600/='],
      ['Ivy Marsh','0711100009','33','Female','10:00','2025-10-04','Doctor Michael','Room 01','PENDING','Rs. 2,100/='],
      ['Jon Price','0711100010','55','Male','11:20','2025-10-06','Doctor Michael','Room 03','COMPLETED','Rs. 4,200/='],
      ['Kara Finch','0711100011','27','Female','13:40','2025-10-09','Doctor Michael','Room 02','COMPLETED','Rs. 2,900/='],
      ['Levi Moore','0711100012','61','Male','15:15','2025-10-14','Doctor Michael','Room 04','PENDING','Rs. 5,000/='],
      ['Maya Cole','0711100013','22','Female','09:10','2025-10-20','Doctor Michael','Room 03','COMPLETED','Rs. 1,800/='],
      ['Nate Fox','0711100014','39','Male','16:30','2025-10-28','Doctor Michael','Room 01','COMPLETED','Rs. 3,200/='],
      ['Olive Dean','0711100015','31','Female','09:25','2025-10-01','Doctor Linda','Room 05','COMPLETED','Rs. 1,700/='],
      ['Paul Grey','0711100016','44','Male','10:40','2025-10-03','Doctor Linda','Room 02','COMPLETED','Rs. 3,300/='],
      ['Quinn Hale','0711100017','28','Male','12:00','2025-10-06','Doctor Linda','Room 04','PENDING','Rs. 2,000/='],
      ['Ria Spencer','0711100018','36','Female','14:30','2025-10-08','Doctor Linda','Room 03','COMPLETED','Rs. 2,400/='],
      ['Samir Khan','0711100019','50','Male','15:50','2025-10-13','Doctor Linda','Room 05','COMPLETED','Rs. 3,900/='],
      ['Tara Lin','0711100020','29','Female','09:05','2025-10-19','Doctor Linda','Room 02','CANCELLED','-'],
      ['Umar Aziz','0711100021','42','Male','11:15','2025-10-27','Doctor Linda','Room 04','COMPLETED','Rs. 2,600/='],
      ['Vera Stone','0711100022','34','Female','08:45','2025-10-02','Doctor Anna','Room 01','COMPLETED','Rs. 2,100/='],
      ['Will Burt','0711100023','47','Male','10:30','2025-10-04','Doctor Anna','Room 03','COMPLETED','Rs. 3,400/='],
      ['Xena Parks','0711100024','23','Female','12:20','2025-10-07','Doctor Anna','Room 02','PENDING','Rs. 1,650/='],
      ['Yusuf Ali','0711100025','58','Male','13:55','2025-10-11','Doctor Anna','Room 04','COMPLETED','Rs. 4,500/='],
      ['Zara Dean','0711100026','30','Female','15:05','2025-10-16','Doctor Anna','Room 01','COMPLETED','Rs. 2,300/='],
      ['Adam Holt','0711100027','35','Male','09:40','2025-10-21','Doctor Anna','Room 03','COMPLETED','Rs. 2,800/='],
      ['Bea Lunn','0711100028','26','Female','16:10','2025-10-29','Doctor Anna','Room 02','PENDING','Rs. 1,500/='],
      ['Cara Moon','0711100029','29','Female','09:55','2025-10-01','Doctor Peter','Room 05','COMPLETED','Rs. 1,900/='],
      ['Damon Cross','0711100030','53','Male','11:35','2025-10-05','Doctor Peter','Room 02','COMPLETED','Rs. 3,700/='],
      ['Elin Wood','0711100031','38','Female','13:10','2025-10-08','Doctor Peter','Room 04','PENDING','Rs. 2,200/='],
      ['Felix Rowe','0711100032','46','Male','14:50','2025-10-12','Doctor Peter','Room 05','COMPLETED','Rs. 3,000/='],
      ['Gina Park','0711100033','32','Female','10:05','2025-10-17','Doctor Peter','Room 01','COMPLETED','Rs. 2,100/='],
      ['Hugo Kim','0711100034','60','Male','15:25','2025-10-22','Doctor Peter','Room 03','COMPLETED','Rs. 4,800/='],
      ['Iris Flynn','0711100035','27','Female','09:15','2025-10-30','Doctor Peter','Room 02','CANCELLED','-'],
      ['Jack Day','0711100036','41','Male','08:50','2025-10-02','Doctor Alan','Room 01','COMPLETED','Rs. 3,200/='],
      ['Kell Green','0711100037','34','Female','10:20','2025-10-06','Doctor Alan','Room 03','PENDING','Rs. 2,400/='],
      ['Liam Grant','0711100038','50','Male','12:00','2025-10-09','Doctor Alan','Room 02','COMPLETED','Rs. 4,100/='],
      ['Mira Johns','0711100039','28','Female','13:45','2025-10-13','Doctor Alan','Room 04','COMPLETED','Rs. 1,800/='],
      ['Noel Fox','0711100040','59','Male','15:30','2025-10-18','Doctor Alan','Room 01','COMPLETED','Rs. 3,900/='],
      ['Opal Reed','0711100041','31','Female','09:05','2025-10-24','Doctor Alan','Room 03','PENDING','Rs. 1,650/='],
      ['Pierce Wells','0711100042','44','Male','16:20','2025-10-31','Doctor Alan','Room 02','COMPLETED','Rs. 2,900/='],
      ['Quinn Hale','0711100043','26','Male','09:10','2025-10-03','Doctor Joe','Room 05','COMPLETED','Rs. 1,700/='],
      ['Rosa Lane','0711100044','37','Female','11:25','2025-10-06','Doctor Joe','Room 02','COMPLETED','Rs. 2,900/='],
      ['Sean Park','0711100045','48','Male','13:00','2025-10-10','Doctor Joe','Room 04','PENDING','Rs. 3,200/='],
      ['Tia Bell','0711100046','33','Female','14:40','2025-10-14','Doctor Joe','Room 05','COMPLETED','Rs. 2,100/='],
      ['Usha Nair','0711100047','39','Female','09:35','2025-10-19','Doctor Joe','Room 02','COMPLETED','Rs. 3,500/='],
      ['Vik Roy','0711100048','52','Male','12:15','2025-10-23','Doctor Joe','Room 03','CANCELLED','-'],
      ['Willa Stone','0711100049','29','Female','15:50','2025-10-29','Doctor Joe','Room 01','COMPLETED','Rs. 1,950/='],
      ['Xavier Cole','0711100050','35','Male','08:35','2025-10-01','Doctor Nina','Room 04','COMPLETED','Rs. 2,250/='],
      ['Yara Moss','0711100051','28','Female','10:10','2025-10-04','Doctor Nina','Room 02','COMPLETED','Rs. 1,800/='],
      ['Zack Lane','0711100052','46','Male','11:55','2025-10-07','Doctor Nina','Room 01','PENDING','Rs. 3,400/='],
      ['Aimee Cross','0711100053','31','Female','13:30','2025-10-11','Doctor Nina','Room 04','COMPLETED','Rs. 2,100/='],
      ['Ben Lowe','0711100054','57','Male','15:05','2025-10-16','Doctor Nina','Room 03','COMPLETED','Rs. 4,600/='],
      ['Cara Neal','0711100055','24','Female','09:20','2025-10-22','Doctor Nina','Room 02','PENDING','Rs. 1,500/='],
      ['Dale Fox','0711100056','42','Male','16:40','2025-10-28','Doctor Nina','Room 05','COMPLETED','Rs. 2,800/='],
      ['Eden Park','0711100057','30','Female','09:05','2025-10-02','Doctor Greg','Room 01','COMPLETED','Rs. 1,900/='],
      ['Frank Yi','0711100058','49','Male','10:45','2025-10-05','Doctor Greg','Room 03','COMPLETED','Rs. 3,600/='],
      ['Gale Trent','0711100059','36','Female','12:30','2025-10-09','Doctor Greg','Room 02','PENDING','Rs. 2,200/='],
      ['Hank Moore','0711100060','54','Male','14:10','2025-10-12','Doctor Greg','Room 04','COMPLETED','Rs. 3,900/='],
      ['Ivy Lane','0711100061','27','Female','15:55','2025-10-18','Doctor Greg','Room 01','COMPLETED','Rs. 1,700/='],
      ['Jared Finn','0711100062','38','Male','09:30','2025-10-24','Doctor Greg','Room 03','CANCELLED','-'],
      ['Kylie Dean','0711100063','33','Female','16:05','2025-10-30','Doctor Greg','Room 02','COMPLETED','Rs. 2,350/='],
      ['Lana Price','0711100064','29','Female','08:50','2025-10-01','Doctor Jason','Room 05','COMPLETED','Rs. 2,000/='],
      ['Morris Kay','0711100065','44','Male','10:05','2025-10-06','Doctor Jason','Room 02','PENDING','Rs. 3,100/='],
      ['Nell Reid','0711100066','31','Female','11:40','2025-10-08','Doctor Jason','Room 04','COMPLETED','Rs. 2,500/='],
      ['Owen Dale','0711100067','50','Male','13:55','2025-10-13','Doctor Jason','Room 05','COMPLETED','Rs. 3,800/='],
      ['Pia Long','0711100068','26','Female','15:10','2025-10-17','Doctor Jason','Room 01','PENDING','Rs. 1,600/='],
      ['Quentin Fox','0711100069','39','Male','09:15','2025-10-21','Doctor Jason','Room 02','COMPLETED','Rs. 2,900/='],
      ['Rina Cole','0711100070','34','Female','16:30','2025-10-29','Doctor Jason','Room 04','COMPLETED','Rs. 1,850/='],
      ['Seth Young','0711100071','42','Male','09:20','2025-10-02','Doctor Mark','Room 03','COMPLETED','Rs. 3,000/='],
      ['Tara Gill','0711100072','30','Female','11:10','2025-10-05','Doctor Mark','Room 01','COMPLETED','Rs. 1,900/='],
      ['Umar Khan','0711100073','55','Male','12:45','2025-10-09','Doctor Mark','Room 02','PENDING','Rs. 4,200/='],
      ['Violet Ross','0711100074','28','Female','14:00','2025-10-12','Doctor Mark','Room 03','COMPLETED','Rs. 1,800/='],
      ['Wade Peck','0711100075','47','Male','15:35','2025-10-16','Doctor Mark','Room 04','COMPLETED','Rs. 3,500/='],
      ['Xanthe Bell','0711100076','25','Female','09:05','2025-10-23','Doctor Mark','Room 01','PENDING','Rs. 1,250/='],
      ['Yanni Cole','0711100077','36','Male','16:20','2025-10-30','Doctor Mark','Room 02','COMPLETED','Rs. 2,400/='],
      ['Zoe Reed','0711100078','31','Female','09:40','2025-10-03','Doctor Paulo','Room 05','COMPLETED','Rs. 2,100/='],
      ['Abe Stone','0711100079','58','Male','10:55','2025-10-06','Doctor Paulo','Room 02','COMPLETED','Rs. 4,000/='],
      ['Becky Lane','0711100080','27','Female','12:20','2025-10-11','Doctor Paulo','Room 03','PENDING','Rs. 1,700/='],
      ['Cal Ford','0711100081','43','Male','13:50','2025-10-15','Doctor Paulo','Room 04','COMPLETED','Rs. 3,200/='],
      ['Dina Park','0711100082','35','Female','15:10','2025-10-18','Doctor Paulo','Room 05','COMPLETED','Rs. 2,600/='],
      ['Ethan Moss','0711100083','49','Male','09:30','2025-10-24','Doctor Paulo','Room 02','PENDING','Rs. 4,400/='],
      ['Fiona Lake','0711100084','29','Female','16:00','2025-10-31','Doctor Paulo','Room 03','COMPLETED','Rs. 1,950/='],
      ['Gabe Long','0711100085','40','Male','08:35','2025-10-01','Doctor Grace','Room 01','COMPLETED','Rs. 3,300/='],
      ['Hana Reid','0711100086','32','Female','10:15','2025-10-04','Doctor Grace','Room 02','COMPLETED','Rs. 1,800/='],
      ['Ilan Park','0711100087','46','Male','11:50','2025-10-07','Doctor Grace','Room 03','PENDING','Rs. 3,200/='],
      ['Jill Moss','0711100088','28','Female','13:25','2025-10-13','Doctor Grace','Room 01','COMPLETED','Rs. 2,400/='],
      ['Kobe Dean','0711100089','59','Male','14:55','2025-10-17','Doctor Grace','Room 04','COMPLETED','Rs. 4,900/='],
      ['Lena Park','0711100090','26','Female','09:05','2025-10-22','Doctor Grace','Room 02','CANCELLED','-'],
      ['Milo Grant','0711100091','37','Male','15:35','2025-10-29','Doctor Grace','Room 03','COMPLETED','Rs. 2,700/='],
      ['Nora Hale','0711100092','33','Female','09:00','2025-10-02','Doctor Rita','Room 05','COMPLETED','Rs. 1,700/='],
      ['Omar Cole','0711100093','51','Male','10:35','2025-10-07','Doctor Rita','Room 02','COMPLETED','Rs. 3,900/='],
      ['Peta Ray','0711100094','29','Female','12:10','2025-10-10','Doctor Rita','Room 03','PENDING','Rs. 1,600/='],
      ['Quin Moss','0711100095','45','Male','13:40','2025-10-14','Doctor Rita','Room 05','COMPLETED','Rs. 3,200/='],
      ['Rhea Linn','0711100096','38','Female','15:05','2025-10-19','Doctor Rita','Room 01','COMPLETED','Rs. 2,500/='],
      ['Sami Dale','0711100097','60','Male','09:20','2025-10-25','Doctor Rita','Room 02','PENDING','Rs. 5,100/='],
      ['Tess King','0711100098','27','Female','16:20','2025-10-30','Doctor Rita','Room 03','CANCELLED','-'],
      ['Uma Bell','0711100099','30','Female','09:15','2025-10-01','Doctor Clara','Room 04','COMPLETED','Rs. 1,900/='],
      ['Vikram Shah','0711100100','47','Male','11:00','2025-10-05','Doctor Clara','Room 01','COMPLETED','Rs. 3,300/='],
      ['Winnie Park','0711100101','35','Female','12:35','2025-10-08','Doctor Clara','Room 02','PENDING','Rs. 2,100/='],
      ['Xander Neil','0711100102','42','Male','14:10','2025-10-12','Doctor Clara','Room 04','COMPLETED','Rs. 3,700/='],
      ['Yasmin Qureshi','0711100103','29','Female','15:55','2025-10-17','Doctor Clara','Room 03','COMPLETED','Rs. 2,200/='],
      ['Zane Hill','0711100104','55','Male','09:45','2025-10-23','Doctor Clara','Room 01','COMPLETED','Rs. 4,000/='],
      ['Asha Verma','0711100105','26','Female','16:45','2025-10-31','Doctor Clara','Room 02','PENDING','Rs. 1,600/='],
      ['Benji Cole','0711100106','38','Male','08:55','2025-10-02','Doctor Susan','Room 05','COMPLETED','Rs. 2,300/='],
      ['Cora Lane','0711100107','31','Female','10:20','2025-10-06','Doctor Susan','Room 02','COMPLETED','Rs. 1,800/='],
      ['Dale Roy','0711100108','49','Male','11:50','2025-10-09','Doctor Susan','Room 03','PENDING','Rs. 3,100/='],
      ['Eden Park','0711100109','27','Female','13:30','2025-10-15','Doctor Susan','Room 05','COMPLETED','Rs. 2,000/='],
      ['Fadi Noor','0711100110','56','Male','15:00','2025-10-18','Doctor Susan','Room 01','COMPLETED','Rs. 4,400/='],
      ['Gina Moss','0711100111','33','Female','09:40','2025-10-24','Doctor Susan','Room 02','PENDING','Rs. 1,700/='],
      ['Haleena Roy','0711100112','29','Female','16:05','2025-10-29','Doctor Susan','Room 03','COMPLETED','Rs. 2,500/='],
      ['Ishan Patel','0711100113','40','Male','09:30','2025-10-01','Doctor Maya','Room 04','COMPLETED','Rs. 2,600/='],
      ['Jade Kim','0711100114','25','Female','11:15','2025-10-04','Doctor Maya','Room 02','PENDING','Rs. 1,400/='],
      ['Kyle Young','0711100115','52','Male','12:50','2025-10-07','Doctor Maya','Room 01','COMPLETED','Rs. 3,500/='],
      ['Lina Park','0711100116','34','Female','14:30','2025-10-11','Doctor Maya','Room 03','COMPLETED','Rs. 2,000/='],
      ['Milo Trent','0711100117','29','Male','15:45','2025-10-16','Doctor Maya','Room 05','CANCELLED','-'],
      ['Nora Vale','0711100118','37','Female','09:10','2025-10-22','Doctor Maya','Room 02','COMPLETED','Rs. 2,150/='],
      ['Omar Reed','0711100119','45','Male','16:25','2025-10-30','Doctor Maya','Room 04','COMPLETED','Rs. 3,200/=']
    );

        const dateIdx = 5, docIdx = 6;
        const filtered = allRows.filter(r => doctors.includes(r[docIdx]) && withinRange(r[dateIdx], start, end));
  renderRows(filtered);
        renderedCount = filtered.length;

      } else if (type === 'lab') {
        allRows.push(
      ['Oliver Smith','Doctor Rob','Mr. Smith','Lab 01','CBC, Lipid Profile','2025-11-02','COMPLETED','Rs. 3,000/=','Rs. 200/=','Rs. 3,200/='],
      ['Emma Johnson','Doctor Lee','Mrs. Chamari','Lab 02','PCR, Antibody Test','2025-11-03','COMPLETED','Rs. 2,800/=','Rs. 150/=','Rs. 2,950/='],
      ['Noah Williams','Doctor Ben','Mr. Kevin','Lab 03','Liver Panel','2025-11-04','PENDING','Rs. 4,200/=','Rs. 250/=','Rs. 4,450/='],
      ['Ava Brown','Doctor Emily','Mrs. Spencer','Lab 01','Thyroid Profile','2025-11-05','COMPLETED','Rs. 3,100/=','Rs. 200/=','Rs. 3,300/='],
      ['Liam Jones','Doctor Michael','Mr. Peter','Lab 02','Urine Analysis','2025-11-06','COMPLETED','Rs. 2,500/=','Rs. 150/=','Rs. 2,650/='],
      ['Sophia Garcia','Doctor Linda','Mr. Kevin','Lab 03','Blood Sugar','2025-11-07','CANCELLED','-','-','-'],
      ['Mason Anderson','Doctor Anna','Mrs. Spencer','Lab 04','ECG','2025-11-08','COMPLETED','Rs. 4,500/=','Rs. 300/=','Rs. 4,800/='],
      ['Isabella Davis','Doctor Peter','Mr. Smith','Lab 01','Allergy Panel','2025-11-09','COMPLETED','Rs. 2,200/=','Rs. 100/=','Rs. 2,300/='],
      ['James Rodriguez','Doctor Alan','Mr. Kevin','Lab 02','Chest X-Ray','2025-11-10','PENDING','Rs. 3,300/=','Rs. 150/=','Rs. 3,450/='],
      ['Mia Martinez','Doctor Joe','Mrs. Spencer','Lab 03','Stool Analysis','2025-11-11','COMPLETED','Rs. 1,500/=','Rs. 80/=','Rs. 1,580/='],
      ['Benjamin Hernandez','Doctor Nina','Mr. Peter','Lab 04','Pregnancy Test','2025-11-12','COMPLETED','Rs. 900/=','Rs. 50/=','Rs. 950/='],
      ['Charlotte Lopez','Doctor Greg','Mrs. Spencer','Lab 01','Drug Screen','2025-11-13','PENDING','Rs. 1,100/=','Rs. 60/=','Rs. 1,160/='],
      ['Lucas Gonzalez','Doctor Jason','Mr. Smith','Lab 02','CT Scan','2025-11-14','COMPLETED','Rs. 12,000/=','Rs. 600/=','Rs. 12,600/='],
      ['Amelia Wilson','Doctor Mark','Mr. Kevin','Lab 03','MRI','2025-11-15','COMPLETED','Rs. 19,000/=','Rs. 1,000/=','Rs. 20,000/='],
      ['Logan Thomas','Doctor Paulo','Mrs. Spencer','Lab 04','HBA1C','2025-11-16','COMPLETED','Rs. 1,100/=','Rs. 60/=','Rs. 1,160/='],
      ['Evelyn Taylor','Doctor Grace','Mr. Smith','Lab 01','Full Metabolic Panel','2025-11-17','PENDING','Rs. 6,500/=','Rs. 300/=','Rs. 6,800/='],
      ['Owen Harris','Doctor Rita','Mr. Kevin','Lab 02','Blood Count','2025-11-18','COMPLETED','Rs. 3,000/=','Rs. 150/=','Rs. 3,150/='],
      ['Ella Sanchez','Doctor Clara','Mrs. Spencer','Lab 03','Kidney Panel','2025-11-19','COMPLETED','Rs. 5,400/=','Rs. 200/=','Rs. 5,600/='],
      ['Daniel Clark','Doctor Susan','Mr. Smith','Lab 04','Thyroid Test','2025-11-20','PENDING','Rs. 2,500/=','Rs. 100/=','Rs. 2,600/='],
      ['Scarlett Ramirez','Doctor Maya','Mr. Kevin','Lab 01','Ultrasound','2025-11-21','COMPLETED','Rs. 3,500/=','Rs. 200/=','Rs. 3,700/='],
      ['Michael Lewis','Doctor Rob','Mrs. Spencer','Lab 02','Lipid Profile','2025-11-22','COMPLETED','Rs. 4,200/=','Rs. 180/=','Rs. 4,380/='],
      ['Grace Robinson','Doctor Lee','Mr. Smith','Lab 03','X-Ray (Chest)','2025-11-23','PENDING','Rs. 2,000/=','Rs. 120/=','Rs. 2,120/='],
      ['Jacob Walker','Doctor Ben','Mr. Kevin','Lab 04','ECG','2025-11-24','COMPLETED','Rs. 6,300/=','Rs. 300/=','Rs. 6,600/='],
      ['Chloe Young','Doctor Emily','Mrs. Spencer','Lab 01','Rapid Antibodies','2025-11-25','COMPLETED','Rs. 1,200/=','Rs. 100/=','Rs. 1,300/='],
      ['Sebastian King','Doctor Michael','Mr. Peter','Lab 02','Hormone Panel','2025-11-26','CANCELLED','-','-','-'],
      ['Camila Hill','Doctor Linda','Mr. Kevin','Lab 03','Pregnancy Test','2025-11-27','COMPLETED','Rs. 800/=','Rs. 50/=','Rs. 850/='],
      ['Jack Wright','Doctor Anna','Mrs. Spencer','Lab 04','Full Blood Count','2025-11-28','PENDING','Rs. 3,500/=','Rs. 150/=','Rs. 3,650/='],
      ['Luna Scott','Doctor Peter','Mr. Smith','Lab 01','Viral Panel','2025-11-29','COMPLETED','Rs. 3,350/=','Rs. 150/=','Rs. 3,500/='],
      ['Aiden Green','Doctor Alan','Mrs. Spencer','Lab 02','Cardiac Enzymes','2025-11-30','COMPLETED','Rs. 4,600/=','Rs. 200/=','Rs. 4,800/='],
      ['Layla Adams','Doctor Joe','Mr. Kevin','Lab 03','MRI','2025-12-01','PENDING','Rs. 20,000/=','Rs. 1,000/=','Rs. 21,000/='],
      ['Ethan Baker','Doctor Nina','Mrs. Spencer','Lab 04','CT Scan','2025-12-02','COMPLETED','Rs. 12,600/=','Rs. 600/=','Rs. 13,200/='],
      ['Zoe Nelson','Doctor Greg','Mr. Smith','Lab 01','Allergy IgE','2025-12-03','COMPLETED','Rs. 2,400/=','Rs. 100/=','Rs. 2,500/='],
      ['Matthew Carter','Doctor Jason','Mr. Kevin','Lab 02','Ultrasound','2025-12-04','PENDING','Rs. 3,700/=','Rs. 200/=','Rs. 3,900/='],
      ['Nora Mitchell','Doctor Mark','Mrs. Spencer','Lab 03','Bone Density','2025-12-05','COMPLETED','Rs. 4,200/=','Rs. 200/=','Rs. 4,400/='],
      ['Samuel Roberts','Doctor Paulo','Mr. Smith','Lab 04','Drug Screen','2025-12-06','COMPLETED','Rs. 1,050/=','Rs. 50/=','Rs. 1,100/='],
      ['Aria Carter','Doctor Grace','Mr. Kevin','Lab 01','Rapid Test','2025-12-07','COMPLETED','Rs. 1,300/=','Rs. 100/=','Rs. 1,400/='],
      ['David Phillips','Doctor Rita','Mrs. Spencer','Lab 02','Cardiac Panel','2025-12-08','PENDING','Rs. 3,185/=','Rs. 200/=','Rs. 3,385/='],
      ['Madison Campbell','Doctor Clara','Mr. Smith','Lab 03','HBA1C','2025-12-09','COMPLETED','Rs. 1,160/=','Rs. 60/=','Rs. 1,220/='],
      ['Joseph Parker','Doctor Susan','Mr. Kevin','Lab 04','CT Scan','2025-12-10','COMPLETED','Rs. 7,800/=','Rs. 400/=','Rs. 8,200/='],
      ['Lily Evans','Doctor Maya','Mrs. Spencer','Lab 01','MRI Review','2025-12-11','COMPLETED','Rs. 2,520/=','Rs. 120/=','Rs. 2,640/='],
      ['Carter Edwards','Doctor Rob','Mr. Smith','Lab 02','Allergy Panel','2025-12-12','PENDING','Rs. 1,200/=','Rs. 60/=','Rs. 1,260/='],
      ['Hannah Collins','Doctor Lee','Mrs. Spencer','Lab 03','Blood Sugar','2025-12-13','COMPLETED','Rs. 950/=','Rs. 50/=','Rs. 1,000/='],
      ['Wyatt Stewart','Doctor Ben','Mr. Kevin','Lab 04','Liver Panel','2025-12-14','COMPLETED','Rs. 4,050/=','Rs. 250/=','Rs. 4,300/='],
      ['Penelope Sanchez','Doctor Emily','Mr. Smith','Lab 01','PCR','2025-12-15','CANCELLED','-','-','-'],
      ['Gabriel Morris','Doctor Michael','Mrs. Spencer','Lab 02','Full Blood Count','2025-12-16','COMPLETED','Rs. 3,650/=','Rs. 150/=','Rs. 3,800/='],
      ['Victoria Rogers','Doctor Linda','Mr. Kevin','Lab 03','Rapid Antibodies','2025-12-17','COMPLETED','Rs. 1,300/=','Rs. 100/=','Rs. 1,400/='],
      ['Isaac Reed','Doctor Anna','Mrs. Spencer','Lab 04','Ultrasound','2025-12-18','PENDING','Rs. 3,700/=','Rs. 200/=','Rs. 3,900/='],
      ['Ellie Cook','Doctor Peter','Mr. Smith','Lab 01','MRI','2025-12-19','COMPLETED','Rs. 20,000/=','Rs. 1,000/=','Rs. 21,000/='],
      ['Julian Morgan','Doctor Alan','Mrs. Spencer','Lab 02','CT Scan','2025-12-20','COMPLETED','Rs. 12,600/=','Rs. 600/=','Rs. 13,200/='],
      ['Violet Bell','Doctor Joe','Mr. Kevin','Lab 03','HBA1C','2026-01-10','COMPLETED','Rs. 1,160/=','Rs. 60/=','Rs. 1,220/='],
      ['Eleanor Price','Doctor Rob','Mr. Grant','Lab 02','Blood Culture','2025-11-05','COMPLETED','Rs. 2,800/=','Rs. 120/=','Rs. 2,920/='],
      ['Hector Monroe','Doctor Rob','Mrs. Diaz','Lab 01','Lipid Panel','2025-11-12','PENDING','Rs. 3,600/=','Rs. 180/=','Rs. 3,780/='],
      ['Ivy Norton','Doctor Rob','Mr. Bright','Lab 04','D-Dimer','2025-11-18','COMPLETED','Rs. 2,100/=','Rs. 80/=','Rs. 2,180/='],
      ['Jason Bell','Doctor Rob','Ms. Fenton','Lab 03','Thyroid Profile','2025-11-24','COMPLETED','Rs. 3,000/=','Rs. 150/=','Rs. 3,150/='],
      ['Kara Vaughn','Doctor Rob','Mr. Grant','Lab 02','CRP Test','2025-12-02','COMPLETED','Rs. 1,900/=','Rs. 70/=','Rs. 1,970/='],
      ['Leon Porter','Doctor Rob','Mrs. Diaz','Lab 05','HBA1C','2025-12-08','PENDING','Rs. 1,100/=','Rs. 60/=','Rs. 1,160/='],
      ['Maya Flynn','Doctor Rob','Mr. Bright','Lab 01','Allergy Panel','2025-12-15','COMPLETED','Rs. 2,500/=','Rs. 100/=','Rs. 2,600/='],
      ['Nolan Beck','Doctor Rob','Ms. Fenton','Lab 03','Kidney Panel','2025-12-22','COMPLETED','Rs. 5,200/=','Rs. 200/=','Rs. 5,400/='],
      ['Olive Harper','Doctor Rob','Mr. Grant','Lab 02','Rapid Antibodies','2026-01-06','COMPLETED','Rs. 1,300/=','Rs. 50/=','Rs. 1,350/='],
      ['Preston Hale','Doctor Rob','Mrs. Diaz','Lab 04','CT Contrast','2026-01-20','PENDING','Rs. 8,500/=','Rs. 400/=','Rs. 8,900/='],
      ['Quinn Mercer','Doctor Lee','Mr. Hale','Lab 01','PCR','2025-11-06','COMPLETED','Rs. 2,900/=','Rs. 200/=','Rs. 3,100/='],
      ['Renee Clark','Doctor Lee','Mrs. Ames','Lab 02','Ultrasound','2025-11-13','COMPLETED','Rs. 3,700/=','Rs. 150/=','Rs. 3,850/='],
      ['Simon Vale','Doctor Lee','Mr. Hale','Lab 03','Liver Function','2025-11-19','PENDING','Rs. 4,000/=','Rs. 200/=','Rs. 4,200/='],
      ['Tess Monroe','Doctor Lee','Mrs. Ames','Lab 04','Blood Sugar','2025-11-25','COMPLETED','Rs. 950/=','Rs. 40/=','Rs. 990/='],
      ['Umar Khan','Doctor Lee','Mr. Hale','Lab 05','Vitamin D','2025-12-03','COMPLETED','Rs. 3,100/=','Rs. 120/=','Rs. 3,220/='],
      ['Violet Marsh','Doctor Lee','Mrs. Ames','Lab 01','ESR','2025-12-10','COMPLETED','Rs. 1,600/=','Rs. 60/=','Rs. 1,660/='],
      ['Wade Cooper','Doctor Lee','Mr. Hale','Lab 02','Cardiac Enzymes','2025-12-18','PENDING','Rs. 4,600/=','Rs. 200/=','Rs. 4,800/='],
      ['Ximena Cruz','Doctor Lee','Mrs. Ames','Lab 03','HBA1C','2025-12-26','COMPLETED','Rs. 1,160/=','Rs. 60/=','Rs. 1,220/='],
      ['Yusuf Omar','Doctor Lee','Mr. Hale','Lab 04','Stool Analysis','2026-01-04','COMPLETED','Rs. 1,400/=','Rs. 80/=','Rs. 1,480/='],
      ['Zara Noble','Doctor Lee','Mrs. Ames','Lab 05','Pregnancy Test','2026-01-28','COMPLETED','Rs. 800/=','Rs. 50/=','Rs. 850/='],
      ['Alec Ford','Doctor Ben','Mr. Pike','Lab 01','Full Blood Count','2025-11-07','COMPLETED','Rs. 2,200/=','Rs. 100/=','Rs. 2,300/='],
      ['Bella Shaw','Doctor Ben','Mrs. Cole','Lab 02','Thyroid Panel','2025-11-14','COMPLETED','Rs. 3,100/=','Rs. 150/=','Rs. 3,250/='],
      ['Cody Reeves','Doctor Ben','Mr. Pike','Lab 03','Lipid Profile','2025-11-21','PENDING','Rs. 4,200/=','Rs. 180/=','Rs. 4,380/='],
      ['Daria Holt','Doctor Ben','Mrs. Cole','Lab 04','Blood Gas','2025-11-28','COMPLETED','Rs. 4,300/=','Rs. 200/=','Rs. 4,500/='],
      ['Ethan Moss','Doctor Ben','Mr. Pike','Lab 05','Drug Screen','2025-12-05','COMPLETED','Rs. 1,050/=','Rs. 50/=','Rs. 1,100/='],
      ['Freya Lane','Doctor Ben','Mrs. Cole','Lab 01','Hormone Panel','2025-12-12','COMPLETED','Rs. 5,700/=','Rs. 250/=','Rs. 5,950/='],
      ['Gabe Rowan','Doctor Ben','Mr. Pike','Lab 02','CT Scan','2025-12-19','PENDING','Rs. 12,000/=','Rs. 600/=','Rs. 12,600/='],
      ['Hana Brooks','Doctor Ben','Mrs. Cole','Lab 03','Allergy IgE','2026-01-02','COMPLETED','Rs. 2,300/=','Rs. 100/=','Rs. 2,400/='],
      ['Ian Porter','Doctor Ben','Mr. Pike','Lab 04','Kidney Panel','2026-01-15','COMPLETED','Rs. 5,400/=','Rs. 200/=','Rs. 5,600/='],
      ['Jill Carter','Doctor Ben','Mrs. Cole','Lab 05','Rapid Antibodies','2026-01-27','CANCELLED','-','-','-'],
      ['Aaron Wells','Doctor Rob','Mr. Kevin','Lab 01','CBC','2025-11-08','2025-11-10','COMPLETED','Rs. 1,900/=','Rs. 150/=','Rs. 2,050/='],
      ['Bethany Cole','Doctor Rob','Mrs. Spencer','Lab 02','Lipid Profile','2025-11-11','2025-11-12','COMPLETED','Rs. 2,600/=','Rs. 200/=','Rs. 2,800/='],
      ['Cameron Drew','Doctor Rob','Mr. Daniel','Lab 03','Thyroid Profile','2025-11-13','2025-11-15','PENDING','Rs. 3,100/=','Rs. 250/=','Rs. 3,350/='],
      ['Daphne Knox','Doctor Rob','Ms. Rose','Lab 01','FBC, ESR','2025-11-16','2025-11-17','COMPLETED','Rs. 2,300/=','Rs. 150/=','Rs. 2,450/='],
      ['Elliot Price','Doctor Rob','Mr. Fernando','Lab 04','Kidney Function Test','2025-11-18','2025-11-19','COMPLETED','Rs. 3,600/=','Rs. 200/=','Rs. 3,800/='],
      ['Faye Nolan','Doctor Rob','Mrs. Hill','Lab 03','NS1 Antigen','2025-11-21','2025-11-22','COMPLETED','Rs. 1,700/=','Rs. 100/=','Rs. 1,800/='],
      ['Gordon Blake','Doctor Rob','Ms. Pearl','Lab 01','CRP','2025-11-23','2025-11-24','COMPLETED','Rs. 1,500/=','Rs. 150/=','Rs. 1,650/='],
      ['Holly Vance','Doctor Rob','Mr. Simon','Lab 02','Glucose Tolerance Test','2025-12-01','2025-12-02','PENDING','Rs. 2,900/=','Rs. 200/=','Rs. 3,100/='],
      ['Isaac Ford','Doctor Rob','Mrs. Rose','Lab 03','Vitamin D Level','2025-12-05','2025-12-07','COMPLETED','Rs. 4,200/=','Rs. 300/=','Rs. 4,500/='],
      ['Jade Rivers','Doctor Rob','Mrs. Karla','Lab 04','Malaria Smear','2025-12-10','2025-12-11','COMPLETED','Rs. 1,400/=','Rs. 100/=','Rs. 1,500/='],
      ['Kurt Benson','Doctor Rob','Mr. Sergio','Lab 02','ECG','2025-12-20','2025-12-21','COMPLETED','Rs. 2,000/=','Rs. 150/=','Rs. 2,150/='],
      ['Lara Finch','Doctor Rob','Ms. Wendy','Lab 01','Hormone Panel','2026-01-07','2026-01-09','PENDING','Rs. 4,500/=','Rs. 300/=','Rs. 4,800/='],
      ['Mason Clark','Doctor Lee','Mr. Kevin','Lab 01','CBC','2025-11-06','2025-11-07','COMPLETED','Rs. 1,900/=','Rs. 120/=','Rs. 2,020/='],
      ['Nina Shaw','Doctor Lee','Mrs. Spencer','Lab 03','Liver Function Test','2025-11-09','2025-11-10','COMPLETED','Rs. 3,400/=','Rs. 200/=','Rs. 3,600/='],
      ['Omar Aziz','Doctor Lee','Mr. Calvin','Lab 04','Thyroid Profile','2025-11-12','2025-11-13','PENDING','Rs. 2,800/=','Rs. 150/=','Rs. 2,950/='],
      ['Paula Grant','Doctor Lee','Mr. Simon','Lab 01','ESR, CRP','2025-11-15','2025-11-16','COMPLETED','Rs. 2,300/=','Rs. 180/=','Rs. 2,480/='],
      ['Quincy Holt','Doctor Lee','Ms. Pearl','Lab 02','Kidney Function Test','2025-11-18','2025-11-19','COMPLETED','Rs. 3,700/=','Rs. 200/=','Rs. 3,900/='],
      ['Rita Nguyen','Doctor Lee','Mrs. Hill','Lab 03','Glucose Test','2025-11-22','2025-11-23','COMPLETED','Rs. 2,100/=','Rs. 150/=','Rs. 2,250/='],
      ['Sean Patel','Doctor Lee','Mr. Fernando','Lab 01','Rapid Antibodies','2025-12-03','2025-12-04','PENDING','Rs. 1,600/=','Rs. 100/=','Rs. 1,700/='],
      ['Tina Marsh','Doctor Lee','Ms. Rose','Lab 02','Vitamin B12 Test','2025-12-06','2025-12-08','COMPLETED','Rs. 3,200/=','Rs. 200/=','Rs. 3,400/='],
      ['Uriel Moss','Doctor Lee','Mr. Daniel','Lab 04','MRI Scan','2025-12-14','2025-12-15','COMPLETED','Rs. 9,000/=','Rs. 600/=','Rs. 9,600/='],
      ['Vera Lane','Doctor Lee','Mrs. Karla','Lab 03','CT Scan','2025-12-19','2025-12-20','PENDING','Rs. 7,000/=','Rs. 500/=','Rs. 7,500/='],
      ['Warren Cole','Doctor Lee','Mr. Sergio','Lab 01','Ultrasound','2026-01-09','2026-01-10','COMPLETED','Rs. 4,300/=','Rs. 250/=','Rs. 4,550/='],
      ['Xena Park','Doctor Lee','Mrs. Wendy','Lab 02','Lipid Profile','2026-01-15','2026-01-16','COMPLETED','Rs. 2,600/=','Rs. 150/=','Rs. 2,750/='],
      ['Yanni Cruz','Doctor Ben','Mr. Kevin','Lab 03','CBC, ESR','2025-11-07','2025-11-08','COMPLETED','Rs. 2,200/=','Rs. 150/=','Rs. 2,350/='],
      ['Zoe Park','Doctor Ben','Mrs. Spencer','Lab 01','Thyroid Panel','2025-11-10','2025-11-11','PENDING','Rs. 3,000/=','Rs. 200/=','Rs. 3,200/='],
      ['Aisha Khan','Doctor Ben','Mr. Daniel','Lab 02','Kidney Profile','2025-11-13','2025-11-14','COMPLETED','Rs. 3,500/=','Rs. 200/=','Rs. 3,700/='],
      ['Blake Jay','Doctor Ben','Ms. Rose','Lab 04','Liver Panel','2025-11-17','2025-11-18','COMPLETED','Rs. 4,200/=','Rs. 300/=','Rs. 4,500/='],
      ['Celia Owens','Doctor Ben','Mrs. Hill','Lab 01','Glucose Test','2025-11-20','2025-11-21','COMPLETED','Rs. 1,800/=','Rs. 100/=','Rs. 1,900/='],
      ['Drew Hill','Doctor Ben','Mr. Fernando','Lab 03','CRP','2025-11-23','2025-11-24','PENDING','Rs. 1,900/=','Rs. 150/=','Rs. 2,050/='],
      ['Emma Fox','Doctor Ben','Mrs. Karla','Lab 02','Vitamin D','2025-12-01','2025-12-02','COMPLETED','Rs. 3,600/=','Rs. 200/=','Rs. 3,800/='],
      ['Frank Dale','Doctor Ben','Mr. Sergio','Lab 01','Iron Studies','2025-12-05','2025-12-06','COMPLETED','Rs. 2,700/=','Rs. 150/=','Rs. 2,850/='],
      ['Gina Vale','Doctor Ben','Ms. Wendy','Lab 04','Malaria Test','2025-12-11','2025-12-12','COMPLETED','Rs. 1,500/=','Rs. 100/=','Rs. 1,600/='],
      ['Hank Rivers','Doctor Ben','Mr. Simon','Lab 02','CT Scan','2025-12-20','2025-12-22','PENDING','Rs. 7,500/=','Rs. 500/=','Rs. 8,000/='],
      ['Iris Cole','Doctor Ben','Mr. Peter','Lab 03','ECG','2026-01-10','2026-01-11','COMPLETED','Rs. 2,000/=','Rs. 150/=','Rs. 2,150/='],
      ['Jules Park','Doctor Ben','Mrs. Wendy','Lab 01','Lipid Profile','2026-01-18','2026-01-19','COMPLETED','Rs. 2,700/=','Rs. 150/=','Rs. 2,850/='],
      ['Alden Price','Doctor Emily','Mr. Kevin','Lab 01','CBC','2025-10-02','COMPLETED','Rs. 1,900/=','Rs. 150/=','Rs. 2,050/='],
      ['Bianca Shaw','Doctor Emily','Mrs. Spencer','Lab 02','Lipid Profile','2025-10-04','COMPLETED','Rs. 2,600/=','Rs. 200/=','Rs. 2,800/='],
      ['Calvin Reid','Doctor Emily','Mr. Smith','Lab 03','Thyroid Profile','2025-10-06','PENDING','Rs. 3,100/=','Rs. 250/=','Rs. 3,350/='],
      ['Della Hart','Doctor Emily','Ms. Pearl','Lab 01','Urine Analysis','2025-10-08','COMPLETED','Rs. 1,200/=','Rs. 80/=','Rs. 1,280/='],
      ['Evan Cole','Doctor Emily','Mr. Grant','Lab 04','PCR, Antibody Test','2025-10-12','COMPLETED','Rs. 2,800/=','Rs. 150/=','Rs. 2,950/='],
      ['Fiona Gale','Doctor Emily','Mrs. Hill','Lab 02','Rapid Antibodies','2025-10-20','COMPLETED','Rs. 1,200/=','Rs. 100/=','Rs. 1,300/='],
      ['Gavin Lowe','Doctor Emily','Mr. Daniel','Lab 03','Blood Sugar','2025-10-28','COMPLETED','Rs. 900/=','Rs. 50/=','Rs. 950/='],
      ['Holly Moss','Doctor Michael','Mr. Peter','Lab 02','Liver Panel','2025-10-01','COMPLETED','Rs. 4,200/=','Rs. 250/=','Rs. 4,450/='],
      ['Ian Webb','Doctor Michael','Mrs. Spencer','Lab 03','ECG (report)','2025-10-03','COMPLETED','Rs. 6,000/=','Rs. 300/=','Rs. 6,300/='],
      ['Jodie Park','Doctor Michael','Mr. Smith','Lab 01','MRI (referral)','2025-10-07','PENDING','Rs. 19,000/=','Rs. 1,000/=','Rs. 20,000/='],
      ['Kris Vance','Doctor Michael','Ms. Rose','Lab 04','Thyroid Test','2025-10-11','COMPLETED','Rs. 2,500/=','Rs. 100/=','Rs. 2,600/='],
      ['Lola Grant','Doctor Michael','Mr. Sergio','Lab 02','Full Metabolic Panel','2025-10-15','COMPLETED','Rs. 6,500/=','Rs. 300/=','Rs. 6,800/='],
      ['Miles Quinn','Doctor Michael','Mrs. Karla','Lab 03','CT Scan','2025-10-21','PENDING','Rs. 12,000/=','Rs. 600/=','Rs. 12,600/='],
      ['Nadia Reed','Doctor Michael','Mr. Peter','Lab 01','Kidney Panel','2025-10-29','COMPLETED','Rs. 5,200/=','Rs. 200/=','Rs. 5,400/='],
      ['Omar Shah','Doctor Linda','Mr. Kevin','Lab 01','Pregnancy Test','2025-10-02','COMPLETED','Rs. 800/=','Rs. 50/=','Rs. 850/='],
      ['Pia Long','Doctor Linda','Mrs. Spencer','Lab 02','Blood Count','2025-10-05','COMPLETED','Rs. 3,000/=','Rs. 150/=','Rs. 3,150/='],
      ['Quentin Ray','Doctor Linda','Mr. Smith','Lab 03','Vitamin D Level','2025-10-08','PENDING','Rs. 4,200/=','Rs. 300/=','Rs. 4,500/='],
      ['Rina Cole','Doctor Linda','Ms. Pearl','Lab 04','Allergy Panel','2025-10-13','COMPLETED','Rs. 2,500/=','Rs. 100/=','Rs. 2,600/='],
      ['Sean Holt','Doctor Linda','Mr. Grant','Lab 02','HBA1C','2025-10-17','COMPLETED','Rs. 1,100/=','Rs. 60/=','Rs. 1,160/='],
      ['Tara Bell','Doctor Linda','Mrs. Hill','Lab 03','Stool Analysis','2025-10-23','COMPLETED','Rs. 1,400/=','Rs. 80/=','Rs. 1,480/='],
      ['Umar Aziz','Doctor Linda','Mr. Daniel','Lab 01','Rapid Test','2025-10-30','CANCELLED','-','-','-'],
      ['Vera Stone','Doctor Anna','Mr. Kevin','Lab 02','CBC, Lipid Profile','2025-10-01','COMPLETED','Rs. 3,000/=','Rs. 200/=','Rs. 3,200/='],
      ['Will Damon','Doctor Anna','Mrs. Spencer','Lab 03','Ultrasound','2025-10-04','COMPLETED','Rs. 3,500/=','Rs. 200/=','Rs. 3,700/='],
      ['Xena Park','Doctor Anna','Mr. Smith','Lab 01','Chest X-Ray','2025-10-07','PENDING','Rs. 2,000/=','Rs. 120/=','Rs. 2,120/='],
      ['Yasir Khan','Doctor Anna','Ms. Pearl','Lab 04','ECG (report)','2025-10-12','COMPLETED','Rs. 6,300/=','Rs. 300/=','Rs. 6,600/='],
      ['Zoe Lane','Doctor Anna','Mr. Grant','Lab 02','Allergy IgE','2025-10-16','COMPLETED','Rs. 2,400/=','Rs. 100/=','Rs. 2,500/='],
      ['Abe Cole','Doctor Anna','Mrs. Hill','Lab 03','Drug Screen','2025-10-22','COMPLETED','Rs. 1,050/=','Rs. 50/=','Rs. 1,100/='],
      ['Bea Lunn','Doctor Anna','Mr. Daniel','Lab 01','CT Scan','2025-10-28','COMPLETED','Rs. 12,600/=','Rs. 600/=','Rs. 13,200/='],
      ['Cal Ford','Doctor Peter','Mr. Kevin','Lab 03','Thyroid Profile','2025-10-02','COMPLETED','Rs. 3,100/=','Rs. 150/=','Rs. 3,250/='],
      ['Dina Park','Doctor Peter','Mrs. Spencer','Lab 04','Pregnancy Test','2025-10-06','COMPLETED','Rs. 800/=','Rs. 50/=','Rs. 850/='],
      ['Ethan Moss','Doctor Peter','Mr. Smith','Lab 01','Cardiac Enzymes','2025-10-09','PENDING','Rs. 4,600/=','Rs. 200/=','Rs. 4,800/='],
      ['Fiona Lake','Doctor Peter','Ms. Pearl','Lab 02','Rapid Antibodies','2025-10-14','COMPLETED','Rs. 1,200/=','Rs. 100/=','Rs. 1,300/='],
      ['Gabe Rowan','Doctor Peter','Mr. Grant','Lab 03','CT Scan','2025-10-18','COMPLETED','Rs. 12,000/=','Rs. 600/=','Rs. 12,600/='],
      ['Hana Brooks','Doctor Peter','Mrs. Hill','Lab 04','Allergy Panel','2025-10-24','COMPLETED','Rs. 2,300/=','Rs. 100/=','Rs. 2,400/='],
      ['Iris Cole','Doctor Peter','Mr. Daniel','Lab 01','MRI','2025-10-30','COMPLETED','Rs. 20,000/=','Rs. 1,000/=','Rs. 21,000/='],
      ['Jill Carter','Doctor Alan','Mr. Kevin','Lab 02','Rapid Antibodies','2025-10-01','COMPLETED','Rs. 1,300/=','Rs. 100/=','Rs. 1,400/='],
      ['Kurt Benson','Doctor Alan','Mrs. Spencer','Lab 03','HBA1C','2025-10-05','COMPLETED','Rs. 1,160/=','Rs. 60/=','Rs. 1,220/='],
      ['Lana Price','Doctor Alan','Mr. Smith','Lab 04','Ultrasound','2025-10-08','PENDING','Rs. 3,700/=','Rs. 200/=','Rs. 3,900/='],
      ['Morris Kay','Doctor Alan','Ms. Pearl','Lab 01','Full Blood Count','2025-10-13','COMPLETED','Rs. 3,650/=','Rs. 150/=','Rs. 3,800/='],
      ['Nell Reid','Doctor Alan','Mr. Grant','Lab 02','Stool Analysis','2025-10-17','COMPLETED','Rs. 1,400/=','Rs. 80/=','Rs. 1,480/='],
      ['Owen Dale','Doctor Alan','Mrs. Hill','Lab 03','Drug Screen','2025-10-23','COMPLETED','Rs. 1,050/=','Rs. 50/=','Rs. 1,100/='],
      ['Pia Long','Doctor Alan','Mr. Daniel','Lab 04','MRI Review','2025-10-29','COMPLETED','Rs. 2,520/=','Rs. 120/=','Rs. 2,640/='],
      ['Quinn Hale','Doctor Joe','Mr. Kevin','Lab 01','Blood Sugar','2025-10-02','COMPLETED','Rs. 950/=','Rs. 50/=','Rs. 1,000/='],
      ['Rosa Lane','Doctor Joe','Mrs. Spencer','Lab 02','Bone Density','2025-10-06','COMPLETED','Rs. 4,000/=','Rs. 200/=','Rs. 4,200/='],
      ['Sean Park','Doctor Joe','Mr. Smith','Lab 03','ECG','2025-10-10','PENDING','Rs. 6,300/=','Rs. 300/=','Rs. 6,600/='],
      ['Tia Bell','Doctor Joe','Ms. Pearl','Lab 04','Viral Panel','2025-10-14','COMPLETED','Rs. 3,200/=','Rs. 150/=','Rs. 3,350/='],
      ['Usha Nair','Doctor Joe','Mr. Grant','Lab 01','Ultrasound','2025-10-19','COMPLETED','Rs. 3,500/=','Rs. 200/=','Rs. 3,700/='],
      ['Vik Roy','Doctor Joe','Mrs. Hill','Lab 02','PCR','2025-10-25','CANCELLED','-','-','-'],
      ['Willa Stone','Doctor Joe','Mr. Daniel','Lab 03','CT Scan','2025-10-30','COMPLETED','Rs. 12,600/=','Rs. 600/=','Rs. 13,200/='],
      ['Xavier Cole','Doctor Nina','Mr. Kevin','Lab 01','Allergy IgE','2025-10-01','COMPLETED','Rs. 2,400/=','Rs. 100/=','Rs. 2,500/='],
      ['Yara Moss','Doctor Nina','Mrs. Spencer','Lab 02','Pregnancy Test','2025-10-05','COMPLETED','Rs. 800/=','Rs. 50/=','Rs. 850/='],
      ['Zack Lane','Doctor Nina','Mr. Smith','Lab 03','Thyroid Panel','2025-10-09','PENDING','Rs. 3,000/=','Rs. 150/=','Rs. 3,150/='],
      ['Aimee Cross','Doctor Nina','Ms. Pearl','Lab 04','Lipid Profile','2025-10-13','COMPLETED','Rs. 4,200/=','Rs. 180/=','Rs. 4,380/='],
      ['Ben Lowe','Doctor Nina','Mr. Grant','Lab 01','Rapid Antibodies','2025-10-17','COMPLETED','Rs. 1,200/=','Rs. 100/=','Rs. 1,300/='],
      ['Cara Neal','Doctor Nina','Mrs. Hill','Lab 02','Kidney Panel','2025-10-22','COMPLETED','Rs. 5,400/=','Rs. 200/=','Rs. 5,600/='],
      ['Dale Fox','Doctor Nina','Mr. Daniel','Lab 03','ECG','2025-10-29','COMPLETED','Rs. 2,000/=','Rs. 150/=','Rs. 2,150/='],
      ['Eden Park','Doctor Greg','Mr. Kevin','Lab 04','PCR','2025-10-02','COMPLETED','Rs. 2,900/=','Rs. 200/=','Rs. 3,100/='],
      ['Frank Yi','Doctor Greg','Mrs. Spencer','Lab 01','Full Blood Count','2025-10-06','COMPLETED','Rs. 3,650/=','Rs. 150/=','Rs. 3,800/='],
      ['Gale Trent','Doctor Greg','Mr. Smith','Lab 02','Liver Panel','2025-10-09','PENDING','Rs. 4,800/=','Rs. 250/=','Rs. 5,050/='],
      ['Hank Moore','Doctor Greg','Ms. Pearl','Lab 03','CT Scan','2025-10-13','COMPLETED','Rs. 12,000/=','Rs. 600/=','Rs. 12,600/='],
      ['Ivy Lane','Doctor Greg','Mr. Grant','Lab 04','X-Ray (Chest)','2025-10-18','COMPLETED','Rs. 2,000/=','Rs. 120/=','Rs. 2,120/='],
      ['Jared Finn','Doctor Greg','Mrs. Hill','Lab 01','Drug Screen','2025-10-24','CANCELLED','-','-','-'],
      ['Kylie Dean','Doctor Greg','Mr. Daniel','Lab 02','Hormone Panel','2025-10-30','COMPLETED','Rs. 5,700/=','Rs. 250/=','Rs. 5,950/='],
      ['Lana Price','Doctor Jason','Mr. Kevin','Lab 03','Ultrasound','2025-10-01','COMPLETED','Rs. 3,700/=','Rs. 200/=','Rs. 3,900/='],
      ['Morris Kay','Doctor Jason','Mrs. Spencer','Lab 01','ECG','2025-10-04','PENDING','Rs. 6,300/=','Rs. 300/=','Rs. 6,600/='],
      ['Nell Reid','Doctor Jason','Mr. Smith','Lab 02','Allergy Panel','2025-10-08','COMPLETED','Rs. 2,300/=','Rs. 100/=','Rs. 2,400/='],
      ['Owen Dale','Doctor Jason','Ms. Pearl','Lab 03','MRI','2025-10-12','COMPLETED','Rs. 20,000/=','Rs. 1,000/=','Rs. 21,000/='],
      ['Pia Long','Doctor Jason','Mr. Grant','Lab 04','Thyroid Test','2025-10-16','COMPLETED','Rs. 2,500/=','Rs. 100/=','Rs. 2,600/='],
      ['Quentin Fox','Doctor Jason','Mrs. Hill','Lab 01','HBA1C','2025-10-22','PENDING','Rs. 1,160/=','Rs. 60/=','Rs. 1,220/='],
      ['Rina Cole','Doctor Jason','Mr. Daniel','Lab 02','CT Scan','2025-10-28','COMPLETED','Rs. 12,600/=','Rs. 600/=','Rs. 13,200/='],
      ['Seth Young','Doctor Mark','Mr. Kevin','Lab 01','CBC','2025-10-02','COMPLETED','Rs. 1,900/=','Rs. 120/=','Rs. 2,020/='],
      ['Tara Gill','Doctor Mark','Mrs. Spencer','Lab 02','Lipid Profile','2025-10-05','COMPLETED','Rs. 2,600/=','Rs. 200/=','Rs. 2,800/='],
      ['Umar Khan','Doctor Mark','Mr. Smith','Lab 03','ECG','2025-10-09','PENDING','Rs. 6,300/=','Rs. 300/=','Rs. 6,600/='],
      ['Violet Ross','Doctor Mark','Ms. Pearl','Lab 04','Bone Density','2025-10-13','COMPLETED','Rs. 4,000/=','Rs. 200/=','Rs. 4,200/='],
      ['Wade Peck','Doctor Mark','Mr. Grant','Lab 01','Ultrasound','2025-10-18','COMPLETED','Rs. 3,500/=','Rs. 200/=','Rs. 3,700/='],
      ['Xanthe Bell','Doctor Mark','Mrs. Hill','Lab 02','Full Metabolic Panel','2025-10-24','PENDING','Rs. 6,500/=','Rs. 300/=','Rs. 6,800/='],
      ['Yanni Cole','Doctor Mark','Mr. Daniel','Lab 03','Rapid Antibodies','2025-10-30','COMPLETED','Rs. 1,200/=','Rs. 100/=','Rs. 1,300/='],
      ['Zoe Reed','Doctor Paulo','Mr. Kevin','Lab 04','CT Scan','2025-10-03','COMPLETED','Rs. 12,600/=','Rs. 600/=','Rs. 13,200/='],
      ['Abe Stone','Doctor Paulo','Mrs. Spencer','Lab 01','Drug Screen','2025-10-06','COMPLETED','Rs. 1,050/=','Rs. 50/=','Rs. 1,100/='],
      ['Becky Lane','Doctor Paulo','Mr. Smith','Lab 02','Cardiac Enzymes','2025-10-11','PENDING','Rs. 4,600/=','Rs. 200/=','Rs. 4,800/='],
      ['Cal Ford','Doctor Paulo','Ms. Pearl','Lab 03','Liver Panel','2025-10-15','COMPLETED','Rs. 4,200/=','Rs. 300/=','Rs. 4,500/='],
      ['Dina Park','Doctor Paulo','Mr. Grant','Lab 04','Viral Panel','2025-10-19','COMPLETED','Rs. 3,200/=','Rs. 150/=','Rs. 3,350/='],
      ['Ethan Moss','Doctor Paulo','Mrs. Hill','Lab 01','HBA1C','2025-10-23','COMPLETED','Rs. 1,160/=','Rs. 60/=','Rs. 1,220/='],
      ['Fiona Lake','Doctor Paulo','Mr. Daniel','Lab 02','MRI Review','2025-10-30','COMPLETED','Rs. 2,520/=','Rs. 120/=','Rs. 2,640/='],
      ['Gabe Long','Doctor Grace','Mr. Kevin','Lab 03','Full Metabolic Panel','2025-10-01','COMPLETED','Rs. 6,500/=','Rs. 300/=','Rs. 6,800/='],
      ['Hana Reid','Doctor Grace','Mrs. Spencer','Lab 04','Rapid Antibodies','2025-10-05','COMPLETED','Rs. 1,200/=','Rs. 100/=','Rs. 1,300/='],
      ['Ilan Park','Doctor Grace','Mr. Smith','Lab 01','Ultrasound','2025-10-09','PENDING','Rs. 3,700/=','Rs. 200/=','Rs. 3,900/='],
      ['Jill Moss','Doctor Grace','Ms. Pearl','Lab 02','Cardiac Panel','2025-10-13','COMPLETED','Rs. 3,185/=','Rs. 200/=','Rs. 3,385/='],
      ['Kobe Dean','Doctor Grace','Mr. Grant','Lab 03','CT Scan','2025-10-17','COMPLETED','Rs. 12,000/=','Rs. 600/=','Rs. 12,600/='],
      ['Lena Park','Doctor Grace','Mrs. Hill','Lab 04','Blood Sugar','2025-10-24','COMPLETED','Rs. 950/=','Rs. 50/=','Rs. 1,000/='],
      ['Milo Grant','Doctor Grace','Mr. Daniel','Lab 02','MRI','2025-10-30','COMPLETED','Rs. 20,000/=','Rs. 1,000/=','Rs. 21,000/='],
      ['Nora Hale','Doctor Rita','Mr. Kevin','Lab 01','Thyroid Panel','2025-10-02','COMPLETED','Rs. 3,100/=','Rs. 150/=','Rs. 3,250/='],
      ['Omar Cole','Doctor Rita','Mrs. Spencer','Lab 02','Pregnancy Test','2025-10-06','COMPLETED','Rs. 800/=','Rs. 50/=','Rs. 850/='],
      ['Peta Ray','Doctor Rita','Mr. Smith','Lab 03','Lipid Profile','2025-10-10','PENDING','Rs. 4,200/=','Rs. 180/=','Rs. 4,380/='],
      ['Quin Moss','Doctor Rita','Ms. Pearl','Lab 04','Bone Density','2025-10-14','COMPLETED','Rs. 4,000/=','Rs. 200/=','Rs. 4,200/='],
      ['Rhea Linn','Doctor Rita','Mr. Grant','Lab 01','Drug Screen','2025-10-19','COMPLETED','Rs. 1,050/=','Rs. 50/=','Rs. 1,100/='],
      ['Sami Dale','Doctor Rita','Mrs. Hill','Lab 02','CT Scan','2025-10-25','PENDING','Rs. 12,000/=','Rs. 600/=','Rs. 12,600/='],
      ['Tess King','Doctor Rita','Mr. Daniel','Lab 03','Rapid Antibodies','2025-10-30','COMPLETED','Rs. 1,200/=','Rs. 100/=','Rs. 1,300/='],
      ['Uma Bell','Doctor Clara','Mr. Kevin','Lab 04','CBC','2025-10-01','COMPLETED','Rs. 1,900/=','Rs. 120/=','Rs. 2,020/='],
      ['Vikram Shah','Doctor Clara','Mrs. Spencer','Lab 01','ECG','2025-10-05','COMPLETED','Rs. 6,300/=','Rs. 300/=','Rs. 6,600/='],
      ['Winnie Park','Doctor Clara','Mr. Smith','Lab 02','Allergy Panel','2025-10-08','PENDING','Rs. 2,300/=','Rs. 100/=','Rs. 2,400/='],
      ['Xander Neil','Doctor Clara','Ms. Pearl','Lab 03','Ultrasound','2025-10-12','COMPLETED','Rs. 3,500/=','Rs. 200/=','Rs. 3,700/='],
      ['Yasmin Qureshi','Doctor Clara','Mr. Grant','Lab 04','Kidney Panel','2025-10-17','COMPLETED','Rs. 5,400/=','Rs. 200/=','Rs. 5,600/='],
      ['Zane Hill','Doctor Clara','Mrs. Hill','Lab 01','MRI','2025-10-23','COMPLETED','Rs. 20,000/=','Rs. 1,000/=','Rs. 21,000/='],
      ['Asha Verma','Doctor Clara','Mr. Daniel','Lab 02','HBA1C','2025-10-31','COMPLETED','Rs. 1,160/=','Rs. 60/=','Rs. 1,220/='],
      ['Benji Cole','Doctor Susan','Mr. Kevin','Lab 03','Rapid Antibodies','2025-10-02','COMPLETED','Rs. 1,300/=','Rs. 100/=','Rs. 1,400/='],
      ['Cora Lane','Doctor Susan','Mrs. Spencer','Lab 01','Thyroid Test','2025-10-06','COMPLETED','Rs. 2,500/=','Rs. 100/=','Rs. 2,600/='],
      ['Dale Roy','Doctor Susan','Mr. Smith','Lab 02','Liver Panel','2025-10-09','PENDING','Rs. 4,000/=','Rs. 200/=','Rs. 4,200/='],
      ['Eden Park','Doctor Susan','Ms. Pearl','Lab 03','Chest X-Ray','2025-10-15','COMPLETED','Rs. 2,000/=','Rs. 120/=','Rs. 2,120/='],
      ['Fadi Noor','Doctor Susan','Mr. Grant','Lab 04','Cardiac Panel','2025-10-18','COMPLETED','Rs. 3,185/=','Rs. 200/=','Rs. 3,385/='],
      ['Gina Moss','Doctor Susan','Mrs. Hill','Lab 01','ECG (report)','2025-10-24','PENDING','Rs. 6,000/=','Rs. 300/=','Rs. 6,300/='],
      ['Haleena Roy','Doctor Susan','Mr. Daniel','Lab 02','Ultrasound','2025-10-29','COMPLETED','Rs. 3,700/=','Rs. 200/=','Rs. 3,900/='],
      ['Ishan Patel','Doctor Maya','Mr. Kevin','Lab 03','Lipid Profile','2025-10-01','COMPLETED','Rs. 4,200/=','Rs. 180/=','Rs. 4,380/='],
      ['Jade Kim','Doctor Maya','Mrs. Spencer','Lab 01','Pregnancy Test','2025-10-04','COMPLETED','Rs. 800/=','Rs. 50/=','Rs. 850/='],
      ['Kyle Young','Doctor Maya','Mr. Smith','Lab 02','Rapid Antibodies','2025-10-08','PENDING','Rs. 1,200/=','Rs. 100/=','Rs. 1,300/='],
      ['Lina Park','Doctor Maya','Ms. Pearl','Lab 03','ECG','2025-10-12','COMPLETED','Rs. 6,300/=','Rs. 300/=','Rs. 6,600/='],
      ['Milo Trent','Doctor Maya','Mr. Grant','Lab 04','CT Scan','2025-10-18','COMPLETED','Rs. 12,600/=','Rs. 600/=','Rs. 13,200/='],
      ['Nora Vale','Doctor Maya','Mrs. Hill','Lab 01','Hormone Panel','2025-10-24','COMPLETED','Rs. 5,700/=','Rs. 250/=','Rs. 5,950/='],
      ['Omar Reed','Doctor Maya','Mr. Daniel','Lab 02','MRI Review','2025-10-30','COMPLETED','Rs. 2,520/=','Rs. 120/=','Rs. 2,640/=']
    );

        const dateIdx = 5, docIdx = 1;
        const filtered = allRows.filter(r => doctors.includes(r[docIdx]) && withinRange(r[dateIdx], start, end));
  renderRows(filtered);
        renderedCount = filtered.length;

      } else if (type === 'payments') {
        allRows.push(
      ['Doctor Rob','Cardiology','ECG Test','Oliver Smith','Rs. 6,500/=','30%','Rs. 1,950/=','Rs. 4,550/=','2025-11-02','PAID'],
      ['Doctor Lee','General','Consultation','Emma Johnson','Rs. 3,200/=','33%','Rs. 1,056/=','Rs. 2,144/=','2025-11-03','PENDING'],
      ['Doctor Ben','Pediatrics','Vaccination','Noah Williams','Rs. 2,000/=','40%','Rs. 800/=','Rs. 1,200/=','2025-11-04','PAID'],
      ['Doctor Emily','Neurology','Scan','Ava Brown','Rs. 23,000/=','35%','Rs. 8,050/=','Rs. 14,950/=','2025-11-05','PENDING'],
      ['Doctor Michael','Orthopedics','X-Ray','Liam Jones','Rs. 5,200/=','25%','Rs. 1,300/=','Rs. 3,900/=','2025-11-06','PAID'],
      ['Doctor Linda','General','Checkup','Sophia Garcia','Rs. 2,400/=','33%','Rs. 792/=','Rs. 1,608/=','2025-11-07','PENDING'],
      ['Doctor Anna','Imaging','MRI','Mason Anderson','Rs. 19,000/=','40%','Rs. 7,600/=','Rs. 11,400/=','2025-11-08','PAID'],
      ['Doctor Peter','General','Consultation','Isabella Davis','Rs. 2,700/=','30%','Rs. 810/=','Rs. 1,890/=','2025-11-09','PAID'],
      ['Doctor Alan','General','Follow-up','James Rodriguez','Rs. 3,500/=','33%','Rs. 1,155/=','Rs. 2,345/=','2025-11-10','PAID'],
      ['Doctor Joe','Cardiac','Cardiac Panel','Mia Martinez','Rs. 4,900/=','35%','Rs. 1,715/=','Rs. 3,185/=','2025-11-11','PENDING'],
      ['Doctor Nina','Gynae','Antenatal Visit','Benjamin Hernandez','Rs. 1,500/=','30%','Rs. 450/=','Rs. 1,050/=','2025-11-12','PAID'],
      ['Doctor Greg','Orthopedics','Fracture Review','Charlotte Lopez','Rs. 3,300/=','30%','Rs. 990/=','Rs. 2,310/=','2025-11-13','PENDING'],
      ['Doctor Jason','Cardiology','Angio Follow-up','Lucas Gonzalez','Rs. 5,000/=','30%','Rs. 1,500/=','Rs. 3,500/=','2025-11-14','PAID'],
      ['Doctor Mark','ENT','Ear Cleaning','Amelia Wilson','Rs. 1,200/=','30%','Rs. 360/=','Rs. 840/=','2025-11-15','PENDING'],
      ['Doctor Paulo','Imaging','Ultrasound','Logan Thomas','Rs. 3,800/=','35%','Rs. 1,330/=','Rs. 2,470/=','2025-11-16','PENDING'],
      ['Doctor Grace','General','Wellness','Evelyn Taylor','Rs. 6,200/=','35%','Rs. 2,170/=','Rs. 4,030/=','2025-11-17','PAID'],
      ['Doctor Rita','Endocrine','Hormone Consult','Owen Harris','Rs. 3,300/=','35%','Rs. 1,155/=','Rs. 2,145/=','2025-11-18','PAID'],
      ['Doctor Clara','General','Minor Procedure','Ella Sanchez','Rs. 0/=','0%','Rs. 0/=','Rs. 0/=','2025-11-19','CANCELLED'],
      ['Doctor Susan','Cardiology','ECG Test','Daniel Clark','Rs. 6,500/=','30%','Rs. 1,950/=','Rs. 4,550/=','2025-11-20','PAID'],
      ['Doctor Maya','Neurology','Scan','Scarlett Ramirez','Rs. 23,000/=','35%','Rs. 8,050/=','Rs. 14,950/=','2025-11-21','PAID'],
      ['Doctor Rob','General','Walk-in','Michael Lewis','Rs. 900/=','25%','Rs. 225/=','Rs. 675/=','2025-11-22','PENDING'],
      ['Doctor Lee','Gynae','Antenatal Visit','Grace Robinson','Rs. 1,500/=','30%','Rs. 450/=','Rs. 1,050/=','2025-11-23','PAID'],
      ['Doctor Ben','Cardiac','Cardiac Panel','Jacob Walker','Rs. 4,900/=','35%','Rs. 1,715/=','Rs. 3,185/=','2025-11-24','PENDING'],
      ['Doctor Emily','General','Consultation','Chloe Young','Rs. 2,700/=','30%','Rs. 810/=','Rs. 1,890/=','2025-11-25','PAID'],
      ['Doctor Michael','Orthopedics','X-Ray','Sebastian King','Rs. 5,200/=','25%','Rs. 1,300/=','Rs. 3,900/=','2025-11-26','PAID'],
      ['Doctor Linda','Imaging','MRI','Camila Hill','Rs. 19,000/=','40%','Rs. 7,600/=','Rs. 11,400/=','2025-11-27','PAID'],
      ['Doctor Anna','General','Follow-up','Jack Wright','Rs. 3,500/=','33%','Rs. 1,155/=','Rs. 2,345/=','2025-11-28','PENDING'],
      ['Doctor Peter','Cardiology','ECG Test','Luna Scott','Rs. 6,500/=','30%','Rs. 1,950/=','Rs. 4,550/=','2025-11-29','PAID'],
      ['Doctor Alan','General','Walk-in','Aiden Green','Rs. 900/=','25%','Rs. 225/=','Rs. 675/=','2025-11-30','PENDING'],
      ['Doctor Joe','ENT','Ear Cleaning','Layla Adams','Rs. 1,200/=','30%','Rs. 360/=','Rs. 840/=','2025-12-01','PAID'],
      ['Doctor Nina','General','Checkup','Ethan Baker','Rs. 2,400/=','33%','Rs. 792/=','Rs. 1,608/=','2025-12-02','PENDING'],
      ['Doctor Greg','Imaging','CT Scan','Zoe Nelson','Rs. 12,000/=','35%','Rs. 4,200/=','Rs. 7,800/=','2025-12-03','PAID'],
      ['Doctor Jason','Cardiac','Cardiac Panel','Matthew Carter','Rs. 4,900/=','35%','Rs. 1,715/=','Rs. 3,185/=','2025-12-04','PAID'],
      ['Doctor Mark','General','Consultation','Nora Mitchell','Rs. 2,700/=','30%','Rs. 810/=','Rs. 1,890/=','2025-12-05','PENDING'],
      ['Doctor Paulo','Orthopedics','Fracture Review','Samuel Roberts','Rs. 3,300/=','30%','Rs. 990/=','Rs. 2,310/=','2025-12-06','PAID'],
      ['Doctor Grace','Neurology','Scan','Aria Carter','Rs. 23,000/=','35%','Rs. 8,050/=','Rs. 14,950/=','2025-12-07','PAID'],
      ['Doctor Rita','General','Minor Procedure','David Phillips','Rs. 3,500/=','33%','Rs. 1,155/=','Rs. 2,345/=','2025-12-08','PENDING'],
      ['Doctor Clara','Gynae','Antenatal Visit','Madison Campbell','Rs. 1,500/=','30%','Rs. 450/=','Rs. 1,050/=','2025-12-09','PAID'],
      ['Doctor Susan','Orthopedics','X-Ray','Joseph Parker','Rs. 5,200/=','25%','Rs. 1,300/=','Rs. 3,900/=','2025-12-10','PAID'],
      ['Doctor Maya','General','Checkup','Lily Evans','Rs. 2,400/=','33%','Rs. 792/=','Rs. 1,608/=','2025-12-11','PENDING'],
      ['Doctor Rob','Cardiology','ECG Test','Carter Edwards','Rs. 6,500/=','30%','Rs. 1,950/=','Rs. 4,550/=','2025-12-12','PAID'],
      ['Doctor Lee','General','Consultation','Hannah Collins','Rs. 3,200/=','33%','Rs. 1,056/=','Rs. 2,144/=','2025-12-13','PENDING'],
      ['Doctor Ben','Pediatrics','Vaccination','Wyatt Stewart','Rs. 2,000/=','40%','Rs. 800/=','Rs. 1,200/=','2025-12-14','PAID'],
      ['Doctor Emily','Neurology','Scan','Penelope Sanchez','Rs. 23,000/=','35%','Rs. 8,050/=','Rs. 14,950/=','2025-12-15','PAID'],
      ['Doctor Michael','Orthopedics','X-Ray','Gabriel Morris','Rs. 5,200/=','25%','Rs. 1,300/=','Rs. 3,900/=','2025-12-16','PAID'],
      ['Doctor Linda','General','Checkup','Victoria Rogers','Rs. 2,400/=','33%','Rs. 792/=','Rs. 1,608/=','2025-12-17','PENDING'],
      ['Doctor Anna','Imaging','MRI','Isaac Reed','Rs. 19,000/=','40%','Rs. 7,600/=','Rs. 11,400/=','2025-12-18','PAID'],
      ['Doctor Peter','Cardiac','Cardiac Panel','Ellie Cook','Rs. 4,900/=','35%','Rs. 1,715/=','Rs. 3,185/=','2025-12-19','PAID'],
      ['Doctor Alan','General','Consultation','Julian Morgan','Rs. 2,700/=','30%','Rs. 810/=','Rs. 1,890/=','2025-12-20','PENDING'],
      ['Doctor Joe','Orthopedics','Fracture Review','Violet Bell','Rs. 3,300/=','30%','Rs. 990/=','Rs. 2,310/=','2026-01-10','PAID'],
      ['Doctor Rob','Cardiology','ECG Test','Aaron Price','Rs. 3,600/=','30%','Rs. 1,080/=','Rs. 2,520/=','2025-11-18','PAID'],
      ['Doctor Rob','General','Consultation','Bella Stone','Rs. 2,200/=','33%','Rs. 726/=','Rs. 1,474/=','2025-11-21','PENDING'],
      ['Doctor Rob','Orthopedics','Fracture Review','Caleb Turner','Rs. 4,100/=','30%','Rs. 1,230/=','Rs. 2,870/=','2025-12-02','PAID'],
      ['Doctor Rob','Imaging','MRI Review','Diana Moore','Rs. 6,500/=','40%','Rs. 2,600/=','Rs. 3,900/=','2025-12-07','PAID'],
      ['Doctor Rob','General','Follow-up','Ethan Ross','Rs. 1,200/=','33%','Rs. 396/=','Rs. 804/=','2025-12-14','PAID'],
      ['Doctor Rob','Lab Referral','Drug Screen','Fiona Lake','Rs. 1,700/=','30%','Rs. 510/=','Rs. 1,190/=','2025-12-20','PENDING'],
      ['Doctor Rob','Cardiology','Lipid Counselling','George Hill','Rs. 1,600/=','30%','Rs. 480/=','Rs. 1,120/=','2026-01-06','PAID'],
      ['Doctor Rob','General','Walk-in','Hannah Dale','Rs. 900/=','25%','Rs. 225/=','Rs. 675/=','2026-01-12','PAID'],
      ['Doctor Rob','Orthopedics','X-Ray','Ian Brooks','Rs. 2,900/=','30%','Rs. 870/=','Rs. 2,030/=','2026-01-18','PENDING'],
      ['Doctor Rob','Cardiology','Angio Follow-up','Jenna Miles','Rs. 5,000/=','30%','Rs. 1,500/=','Rs. 3,500/=','2026-01-25','PAID'],
      ['Doctor Lee','General','Consultation','Kara Flynn','Rs. 2,700/=','33%','Rs. 891/=','Rs. 1,809/=','2025-11-19','PAID'],
      ['Doctor Lee','Gynae','Antenatal Visit','Liam Barton','Rs. 1,500/=','30%','Rs. 450/=','Rs. 1,050/=','2025-11-25','PAID'],
      ['Doctor Lee','Cardiology','ECG','Maya Green','Rs. 2,200/=','30%','Rs. 660/=','Rs. 1,540/=','2025-12-01','PENDING'],
      ['Doctor Lee','Neurology','Scan','Noelle Price','Rs. 18,000/=','35%','Rs. 6,300/=','Rs. 11,700/=','2025-12-08','PAID'],
      ['Doctor Lee','ENT','Allergy Visit','Oliver Day','Rs. 2,900/=','30%','Rs. 870/=','Rs. 2,030/=','2025-12-15','PAID'],
      ['Doctor Lee','General','Follow-up','Pippa Stone','Rs. 3,200/=','33%','Rs. 1,056/=','Rs. 2,144/=','2025-12-22','PENDING'],
      ['Doctor Lee','Imaging','Ultrasound','Quentin Dale','Rs. 3,800/=','35%','Rs. 1,330/=','Rs. 2,470/=','2026-01-04','PAID'],
      ['Doctor Lee','Cardiology','Rapid Test','Rhea Cole','Rs. 2,100/=','33%','Rs. 693/=','Rs. 1,407/=','2026-01-11','PAID'],
      ['Doctor Lee','General','Checkup','Simon North','Rs. 900/=','25%','Rs. 225/=','Rs. 675/=','2026-01-20','PENDING'],
      ['Doctor Lee','Orthopedics','Fracture Review','Tara Beck','Rs. 3,300/=','30%','Rs. 990/=','Rs. 2,310/=','2026-01-29','PAID'],
      ['Doctor Ben','Pediatrics','Vaccination','Uma Ford','Rs. 1,800/=','40%','Rs. 720/=','Rs. 1,080/=','2025-11-20','PAID'],
      ['Doctor Ben','General','Consultation','Victor Lane','Rs. 2,500/=','35%','Rs. 875/=','Rs. 1,625/=','2025-11-27','PENDING'],
      ['Doctor Ben','Imaging','CT Scan','Wendy Cole','Rs. 12,000/=','35%','Rs. 4,200/=','Rs. 7,800/=','2025-12-03','PAID'],
      ['Doctor Ben','Cardiac','Cardiac Panel','Xavier Holt','Rs. 4,900/=','35%','Rs. 1,715/=','Rs. 3,185/=','2025-12-10','PAID'],
      ['Doctor Ben','General','Wellness','Yasmin Cross','Rs. 6,200/=','35%','Rs. 2,170/=','Rs. 4,030/=','2025-12-17','PAID'],
      ['Doctor Ben','Orthopedics','X-Ray','Zane Reed','Rs. 3,300/=','30%','Rs. 990/=','Rs. 2,310/=','2025-12-24','PENDING'],
      ['Doctor Ben','Lab Referral','Drug Screen','Abby Cole','Rs. 1,700/=','30%','Rs. 510/=','Rs. 1,190/=','2026-01-03','PAID'],
      ['Doctor Ben','Endocrine','Hormone Consult','Brett Moore','Rs. 3,300/=','35%','Rs. 1,155/=','Rs. 2,145/=','2026-01-10','PAID'],
      ['Doctor Ben','Imaging','MRI','Cara Blake','Rs. 19,000/=','40%','Rs. 7,600/=','Rs. 11,400/=','2026-01-17','PENDING'],
      ['Doctor Ben','General','Checkup','Drew Lane','Rs. 2,400/=','33%','Rs. 792/=','Rs. 1,608/=','2026-01-26','PAID'],
      ['Doctor Rob','Cardiology','Stress Test','Ethan Miller','Rs. 8,000/=','30%','Rs. 2,400/=','Rs. 5,600/=','2025-11-08','PAID'],
      ['Doctor Rob','Cardiology','ECG Test','Sophia Reed','Rs. 6,200/=','30%','Rs. 1,860/=','Rs. 4,340/=','2025-11-10','PENDING'],
      ['Doctor Rob','Cardiology','Consultation','Henry Adams','Rs. 3,500/=','30%','Rs. 1,050/=','Rs. 2,450/=','2025-11-12','PAID'],
      ['Doctor Rob','Cardiology','Echocardiogram','Mia Turner','Rs. 11,000/=','30%','Rs. 3,300/=','Rs. 7,700/=','2025-11-15','PAID'],
      ['Doctor Rob','Cardiology','Treadmill Test','Jack Morgan','Rs. 7,300/=','30%','Rs. 2,190/=','Rs. 5,110/=','2025-11-18','PENDING'],
      ['Doctor Rob','Cardiology','Heart Screening','Ella Brooks','Rs. 9,500/=','30%','Rs. 2,850/=','Rs. 6,650/=','2025-11-22','PAID'],
      ['Doctor Rob','Cardiology','Consultation','Oscar Lane','Rs. 3,800/=','30%','Rs. 1,140/=','Rs. 2,660/=','2025-12-02','PAID'],
      ['Doctor Rob','Cardiology','ECG Test','Grace Milton','Rs. 6,100/=','30%','Rs. 1,830/=','Rs. 4,270/=','2025-12-06','PENDING'],
      ['Doctor Rob','Cardiology','Echocardiogram','Aiden Wells','Rs. 10,500/=','30%','Rs. 3,150/=','Rs. 7,350/=','2025-12-12','PAID'],
      ['Doctor Rob','Cardiology','Stress Test','Chloe Watts','Rs. 8,400/=','30%','Rs. 2,520/=','Rs. 5,880/=','2025-12-20','PAID'],
      ['Doctor Rob','Cardiology','Consultation','Leo Carter','Rs. 3,700/=','30%','Rs. 1,110/=','Rs. 2,590/=','2026-01-10','PAID'],
      ['Doctor Rob','Cardiology','ECG Test','Ivy Collins','Rs. 6,300/=','30%','Rs. 1,890/=','Rs. 4,410/=','2026-01-18','PENDING'],
      ['Doctor Lee','General','Consultation','Samuel Price','Rs. 2,800/=','33%','Rs. 924/=','Rs. 1,876/=','2025-11-07','PAID'],
      ['Doctor Lee','General','Consultation','Hannah Gray','Rs. 3,000/=','33%','Rs. 990/=','Rs. 2,010/=','2025-11-09','PENDING'],
      ['Doctor Lee','General','Dressing','Ryan Blake','Rs. 1,900/=','33%','Rs. 627/=','Rs. 1,273/=','2025-11-12','PAID'],
      ['Doctor Lee','General','Injection','Lily Evans','Rs. 1,500/=','33%','Rs. 495/=','Rs. 1,005/=','2025-11-14','PAID'],
      ['Doctor Lee','General','Consultation','Connor Hayes','Rs. 3,400/=','33%','Rs. 1,122/=','Rs. 2,278/=','2025-11-17','PENDING'],
      ['Doctor Lee','General','Wound Cleaning','Ariana Knox','Rs. 1,700/=','33%','Rs. 561/=','Rs. 1,139/=','2025-11-21','PAID'],
      ['Doctor Lee','General','Consultation','Evan Cole','Rs. 2,900/=','33%','Rs. 957/=','Rs. 1,943/=','2025-12-01','PAID'],
      ['Doctor Lee','General','Consultation','Bella Ross','Rs. 3,600/=','33%','Rs. 1,188/=','Rs. 2,412/=','2025-12-04','PAID'],
      ['Doctor Lee','General','Injection','Owen Carter','Rs. 1,600/=','33%','Rs. 528/=','Rs. 1,072/=','2025-12-10','PENDING'],
      ['Doctor Lee','General','Dressing','Hazel King','Rs. 2,100/=','33%','Rs. 693/=','Rs. 1,407/=','2025-12-16','PAID'],
      ['Doctor Lee','General','Consultation','Cole Turner','Rs. 3,700/=','33%','Rs. 1,221/=','Rs. 2,479/=','2026-01-05','PAID'],
      ['Doctor Lee','General','Consultation','Ruby Wright','Rs. 2,600/=','33%','Rs. 858/=','Rs. 1,742/=','2026-01-14','PENDING'],
      ['Doctor Ben','Pediatrics','Checkup','Logan Smith','Rs. 2,200/=','40%','Rs. 880/=','Rs. 1,320/=','2025-11-06','PAID'],
      ['Doctor Ben','Pediatrics','Consultation','Chloe Adams','Rs. 2,400/=','40%','Rs. 960/=','Rs. 1,440/=','2025-11-09','PAID'],
      ['Doctor Ben','Pediatrics','Vaccination','Eli Foster','Rs. 2,100/=','40%','Rs. 840/=','Rs. 1,260/=','2025-11-11','PENDING'],
      ['Doctor Ben','Pediatrics','Consultation','Zara Green','Rs. 2,300/=','40%','Rs. 920/=','Rs. 1,380/=','2025-11-13','PAID'],
      ['Doctor Ben','Pediatrics','Nebulization','Miles Carter','Rs. 1,800/=','40%','Rs. 720/=','Rs. 1,080/=','2025-11-17','PAID'],
      ['Doctor Ben','Pediatrics','Checkup','Sienna Lake','Rs. 2,500/=','40%','Rs. 1,000/=','Rs. 1,500/=','2025-11-20','PENDING'],
      ['Doctor Ben','Pediatrics','Consultation','Wyatt Cruz','Rs. 2,300/=','40%','Rs. 920/=','Rs. 1,380/=','2025-12-03','PAID'],
      ['Doctor Ben','Pediatrics','Vaccination','Harper Kane','Rs. 2,200/=','40%','Rs. 880/=','Rs. 1,320/=','2025-12-05','PAID'],
      ['Doctor Ben','Pediatrics','Nebulization','Aria Moore','Rs. 1,900/=','40%','Rs. 760/=','Rs. 1,140/=','2025-12-12','PENDING'],
      ['Doctor Ben','Pediatrics','Consultation','Mason Lee','Rs. 2,600/=','40%','Rs. 1,040/=','Rs. 1,560/=','2025-12-18','PAID'],
      ['Doctor Ben','Pediatrics','Checkup','Luna Hill','Rs. 2,300/=','40%','Rs. 920/=','Rs. 1,380/=','2026-01-09','PAID'],
      ['Doctor Ben','Pediatrics','Vaccination','Caleb Ross','Rs. 2,000/=','40%','Rs. 800/=','Rs. 1,200/=','2026-01-18','PENDING'],
      ['Doctor Emily', 'Neurology', 'Scan', 'Ava Garcia', 'Rs. 11,450/=', '25%', 'Rs. 2,862/=', 'Rs. 8,588/=', '2025-10-27', 'PENDING'], 
      ['Doctor Emily', 'Neurology', 'Consultation', 'Mason Hernandez', 'Rs. 8,400/=', '33%', 'Rs. 2,772/=', 'Rs. 5,628/=', '2025-10-30', 'PAID'], 
      ['Doctor Emily', 'General', 'Consultation', 'Mia Thomas', 'Rs. 15,250/=', '35%', 'Rs. 5,337/=', 'Rs. 9,913/=', '2025-10-06', 'PAID'], 
      ['Doctor Emily', 'Imaging', 'MRI', 'Lucas Lee', 'Rs. 11,850/=', '33%', 'Rs. 3,910/=', 'Rs. 7,940/=', '2025-10-18', 'PAID'], 
      ['Doctor Emily', 'General', 'Follow-up', 'Evelyn Wright', 'Rs. 16,450/=', '40%', 'Rs. 6,580/=', 'Rs. 9,870/=', '2025-10-06', 'PAID'], 
      ['Doctor Emily', 'Neurology', 'Viral Consult', 'Daniel Nelson', 'Rs. 0/=', '0%', 'Rs. 0/=', 'Rs. 0/=', '2025-10-17', 'CANCELLED'], 
      ['Doctor Emily', 'General', 'Rapid Test', 'Grace Edwards', 'Rs. 11,350/=', '40%', 'Rs. 4,540/=', 'Rs. 6,810/=', '2025-10-17', 'PAID'], 
      ['Doctor Michael', 'Orthopedics', 'X-Ray', 'Sebastian Rogers', 'Rs. 6,050/=', '25%', 'Rs. 1,512/=', 'Rs. 4,538/=', '2025-10-07', 'PENDING'], 
      ['Doctor Michael', 'Orthopedics', 'Fracture Review', 'Luna Smith', 'Rs. 9,000/=', '25%', 'Rs. 2,250/=', 'Rs. 6,750/=', '2025-10-15', 'PAID'], 
      ['Doctor Michael', 'General', 'Consultation', 'Ethan Garcia', 'Rs. 13,850/=', '35%', 'Rs. 4,847/=', 'Rs. 9,003/=', '2025-10-01', 'PAID'], 
      ['Doctor Michael', 'Imaging', 'MRI', 'Nora Hernandez', 'Rs. 17,750/=', '30%', 'Rs. 5,325/=', 'Rs. 12,425/=', '2025-10-25', 'PAID'], 
      ['Doctor Michael', 'Orthopedics', 'Physio', 'David Thomas', 'Rs. 8,100/=', '25%', 'Rs. 2,025/=', 'Rs. 6,075/=', '2025-10-21', 'PAID'], 
      ['Doctor Michael', 'General', 'Checkup', 'Lily Lee', 'Rs. 18,200/=', '40%', 'Rs. 7,280/=', 'Rs. 10,920/=', '2025-10-06', 'PENDING'], 
      ['Doctor Michael', 'Imaging', 'CT Scan', 'Wyatt Wright', 'Rs. 6,750/=', '40%', 'Rs. 2,700/=', 'Rs. 4,050/=', '2025-10-20', 'PENDING'], 
      ['Doctor Linda', 'General', 'Checkup', 'Victoria Nelson', 'Rs. 21,900/=', '33%', 'Rs. 7,227/=', 'Rs. 14,673/=', '2025-10-26', 'PAID'], 
      ['Doctor Linda', 'Imaging', 'Ultrasound', 'Julian Edwards', 'Rs. 3,850/=', '35%', 'Rs. 1,347/=', 'Rs. 2,503/=', '2025-10-07', 'PENDING'], 
      ['Doctor Linda', 'Gynae', 'Antenatal Visit', 'Emma Rogers', 'Rs. 20,150/=', '40%', 'Rs. 8,060/=', 'Rs. 12,090/=', '2025-10-22', 'PAID'], 
      ['Doctor Linda', 'General', 'Consultation', 'Liam Smith', 'Rs. 0/=', '0%', 'Rs. 0/=', 'Rs. 0/=', '2025-10-17', 'CANCELLED'], 
      ['Doctor Linda', 'Imaging', 'MRI', 'Isabella Garcia', 'Rs. 4,100/=', '25%', 'Rs. 1,025/=', 'Rs. 3,075/=', '2025-10-06', 'PAID'], 
      ['Doctor Linda', 'General', 'Walk-in', 'Benjamin Hernandez', 'Rs. 0/=', '0%', 'Rs. 0/=', 'Rs. 0/=', '2025-10-05', 'CANCELLED'], 
      ['Doctor Linda', 'General', 'Follow-up', 'Amelia Thomas', 'Rs. 9,750/=', '40%', 'Rs. 3,900/=', 'Rs. 5,850/=', '2025-10-11', 'PAID'], 
      ['Doctor Anna', 'Imaging', 'MRI', 'Owen Lee', 'Rs. 9,050/=', '25%', 'Rs. 2,262/=', 'Rs. 6,788/=', '2025-10-02', 'PAID'], 
      ['Doctor Anna', 'Imaging', 'CT Scan', 'Scarlett Wright', 'Rs. 0/=', '0%', 'Rs. 0/=', 'Rs. 0/=', '2025-10-13', 'CANCELLED'], 
      ['Doctor Anna', 'General', 'Consultation', 'Jacob Nelson', 'Rs. 5,350/=', '25%', 'Rs. 1,337/=', 'Rs. 4,013/=', '2025-10-25', 'PENDING'], 
      ['Doctor Anna', 'General', 'Follow-up', 'Camila Edwards', 'Rs. 6,300/=', '40%', 'Rs. 2,520/=', 'Rs. 3,780/=', '2025-10-25', 'PAID'], 
      ['Doctor Anna', 'Cardiac', 'ECG', 'Aiden Rogers', 'Rs. 16,700/=', '25%', 'Rs. 4,175/=', 'Rs. 12,525/=', '2025-10-01', 'PAID'], 
      ['Doctor Anna', 'Imaging', 'Ultrasound', 'Zoe Smith', 'Rs. 9,100/=', '40%', 'Rs. 3,640/=', 'Rs. 5,460/=', '2025-10-31', 'PAID'], 
      ['Doctor Anna', 'General', 'Checkup', 'Samuel Garcia', 'Rs. 14,850/=', '30%', 'Rs. 4,455/=', 'Rs. 10,395/=', '2025-10-12', 'PENDING'], 
      ['Doctor Peter', 'General', 'Consultation', 'Madison Hernandez', 'Rs. 18,650/=', '25%', 'Rs. 4,662/=', 'Rs. 13,988/=', '2025-10-18', 'PAID'], 
      ['Doctor Peter', 'Cardiology', 'ECG Test', 'Carter Thomas', 'Rs. 0/=', '0%', 'Rs. 0/=', 'Rs. 0/=', '2025-10-29', 'CANCELLED'], 
      ['Doctor Peter', 'Cardiology', 'Cardiac Panel', 'Penelope Lee', 'Rs. 6,700/=', '30%', 'Rs. 2,010/=', 'Rs. 4,690/=', '2025-10-06', 'PAID'], 
      ['Doctor Peter', 'General', 'Follow-up', 'Isaac Wright', 'Rs. 4,600/=', '40%', 'Rs. 1,840/=', 'Rs. 2,760/=', '2025-10-03', 'PAID'], 
      ['Doctor Peter', 'Imaging', 'Ultrasound', 'Violet Nelson', 'Rs. 850/=', '30%', 'Rs. 255/=', 'Rs. 595/=', '2025-10-01', 'PENDING'], 
      ['Doctor Peter', 'ENT', 'Ear Cleaning', 'Noah Edwards', 'Rs. 5,500/=', '40%', 'Rs. 2,200/=', 'Rs. 3,300/=', '2025-10-30', 'PENDING'], 
      ['Doctor Peter', 'General', 'Walk-in', 'Sophia Rogers', 'Rs. 3,250/=', '33%', 'Rs. 1,072/=', 'Rs. 2,178/=', '2025-10-17', 'PENDING'], 
      ['Doctor Alan', 'General', 'Consultation', 'James Smith', 'Rs. 2,450/=', '35%', 'Rs. 857/=', 'Rs. 1,593/=', '2025-10-14', 'PAID'], 
      ['Doctor Alan', 'General', 'Walk-in', 'Charlotte Garcia', 'Rs. 5,500/=', '25%', 'Rs. 1,375/=', 'Rs. 4,125/=', '2025-10-12', 'PAID'], 
      ['Doctor Alan', 'Cardiology', 'ECG Test', 'Logan Hernandez', 'Rs. 10,900/=', '30%', 'Rs. 3,270/=', 'Rs. 7,630/=', '2025-10-06', 'PAID'], 
      ['Doctor Alan', 'General', 'Follow-up', 'Ella Thomas', 'Rs. 21,850/=', '40%', 'Rs. 8,740/=', 'Rs. 13,110/=', '2025-10-29', 'PAID'], 
      ['Doctor Alan', 'General', 'Checkup', 'Michael Lee', 'Rs. 11,350/=', '40%', 'Rs. 4,540/=', 'Rs. 6,810/=', '2025-10-23', 'PAID'], 
      ['Doctor Alan', 'Orthopedics', 'X-Ray', 'Chloe Wright', 'Rs. 3,850/=', '25%', 'Rs. 962/=', 'Rs. 2,888/=', '2025-10-21', 'PAID'], 
      ['Doctor Alan', 'General', 'Consultation', 'Jack Nelson', 'Rs. 5,750/=', '40%', 'Rs. 2,300/=', 'Rs. 3,450/=', '2025-10-19', 'PAID'], 
      ['Doctor Joe', 'Cardiac', 'Cardiac Panel', 'Layla Edwards', 'Rs. 4,250/=', '40%', 'Rs. 1,700/=', 'Rs. 2,550/=', '2025-10-29', 'PAID'], 
      ['Doctor Joe', 'Orthopedics', 'Fracture Review', 'Matthew Rogers', 'Rs. 15,300/=', '33%', 'Rs. 5,049/=', 'Rs. 10,251/=', '2025-10-05', 'PAID'], 
      ['Doctor Joe', 'ENT', 'Ear Cleaning', 'Aria Smith', 'Rs. 18,550/=', '25%', 'Rs. 4,637/=', 'Rs. 13,913/=', '2025-10-09', 'PENDING'], 
      ['Doctor Joe', 'General', 'Consultation', 'Joseph Garcia', 'Rs. 1,900/=', '33%', 'Rs. 627/=', 'Rs. 1,273/=', '2025-10-26', 'PAID'], 
      ['Doctor Joe', 'Imaging', 'CT Scan', 'Hannah Hernandez', 'Rs. 15,450/=', '25%', 'Rs. 3,862/=', 'Rs. 11,588/=', '2025-10-21', 'PENDING'], 
      ['Doctor Joe', 'General', 'Checkup', 'Gabriel Thomas', 'Rs. 4,750/=', '33%', 'Rs. 1,567/=', 'Rs. 3,183/=', '2025-10-29', 'PENDING'], 
      ['Doctor Joe', 'General', 'Follow-up', 'Ellie Lee', 'Rs. 1,700/=', '33%', 'Rs. 561/=', 'Rs. 1,139/=', '2025-10-24', 'PAID'], 
      ['Doctor Nina', 'Gynae', 'Antenatal Visit', 'Oliver Wright', 'Rs. 10,200/=', '35%', 'Rs. 3,570/=', 'Rs. 6,630/=', '2025-10-10', 'PAID'], 
      ['Doctor Nina', 'General', 'Checkup', 'Ava Nelson', 'Rs. 7,550/=', '33%', 'Rs. 2,491/=', 'Rs. 5,059/=', '2025-10-24', 'PAID'], 
      ['Doctor Nina', 'Imaging', 'Ultrasound', 'Mason Edwards', 'Rs. 2,050/=', '33%', 'Rs. 676/=', 'Rs. 1,374/=', '2025-10-15', 'PAID'], 
      ['Doctor Nina', 'General', 'Consultation', 'Mia Rogers', 'Rs. 9,600/=', '30%', 'Rs. 2,880/=', 'Rs. 6,720/=', '2025-10-30', 'PAID'], 
      ['Doctor Nina', 'Imaging', 'MRI', 'Lucas Smith', 'Rs. 16,800/=', '25%', 'Rs. 4,200/=', 'Rs. 12,600/=', '2025-10-01', 'PAID'], 
      ['Doctor Nina', 'General', 'Walk-in', 'Evelyn Garcia', 'Rs. 5,600/=', '35%', 'Rs. 1,960/=', 'Rs. 3,640/=', '2025-10-16', 'PAID'], 
      ['Doctor Nina', 'Gynae', 'Scan', 'Daniel Hernandez', 'Rs. 9,700/=', '30%', 'Rs. 2,910/=', 'Rs. 6,790/=', '2025-10-29', 'PAID'], 
      ['Doctor Greg', 'Orthopedics', 'Fracture Review', 'Grace Thomas', 'Rs. 8,850/=', '35%', 'Rs. 3,097/=', 'Rs. 5,753/=', '2025-10-03', 'PAID'], 
      ['Doctor Greg', 'Imaging', 'CT Scan', 'Sebastian Lee', 'Rs. 10,200/=', '25%', 'Rs. 2,550/=', 'Rs. 7,650/=', '2025-10-14', 'PAID'], 
      ['Doctor Greg', 'General', 'Consultation', 'Luna Wright', 'Rs. 2,850/=', '30%', 'Rs. 855/=', 'Rs. 1,995/=', '2025-10-27', 'PAID'], 
      ['Doctor Greg', 'Orthopedics', 'X-Ray', 'Ethan Nelson', 'Rs. 9,300/=', '35%', 'Rs. 3,255/=', 'Rs. 6,045/=', '2025-10-07', 'PAID'], 
      ['Doctor Greg', 'General', 'Checkup', 'Nora Edwards', 'Rs. 3,700/=', '40%', 'Rs. 1,480/=', 'Rs. 2,220/=', '2025-10-02', 'PENDING'], 
      ['Doctor Greg', 'Cardiology', 'ECG', 'David Rogers', 'Rs. 9,500/=', '35%', 'Rs. 3,325/=', 'Rs. 6,175/=', '2025-10-11', 'PENDING'], 
      ['Doctor Greg', 'General', 'Follow-up', 'Lily Smith', 'Rs. 6,950/=', '25%', 'Rs. 1,737/=', 'Rs. 5,213/=', '2025-10-16', 'PAID'], 
      ['Doctor Jason', 'Cardiology', 'Angio Follow-up', 'Wyatt Garcia', 'Rs. 6,050/=', '33%', 'Rs. 1,996/=', 'Rs. 4,054/=', '2025-10-19', 'PAID'], 
      ['Doctor Jason', 'Cardiology', 'ECG', 'Victoria Hernandez', 'Rs. 4,850/=', '33%', 'Rs. 1,600/=', 'Rs. 3,250/=', '2025-10-02', 'PENDING'], 
      ['Doctor Jason', 'Cardiac', 'Cardiac Panel', 'Julian Thomas', 'Rs. 3,100/=', '25%', 'Rs. 775/=', 'Rs. 2,325/=', '2025-10-17', 'PAID'], 
      ['Doctor Jason', 'General', 'Consultation', 'Emma Lee', 'Rs. 13,700/=', '35%', 'Rs. 4,795/=', 'Rs. 8,905/=', '2025-10-17', 'PAID'], 
      ['Doctor Jason', 'Imaging', 'CT Scan', 'Liam Wright', 'Rs. 14,100/=', '30%', 'Rs. 4,230/=', 'Rs. 9,870/=', '2025-10-19', 'PAID'], 
      ['Doctor Jason', 'General', 'Checkup', 'Isabella Nelson', 'Rs. 15,850/=', '30%', 'Rs. 4,755/=', 'Rs. 11,095/=', '2025-10-15', 'PAID'], 
      ['Doctor Jason', 'Cardiology', 'Lipid Counselling', 'Benjamin Edwards', 'Rs. 1,400/=', '33%', 'Rs. 462/=', 'Rs. 938/=', '2025-10-22', 'PAID'], 
      ['Doctor Mark', 'ENT', 'Ear Cleaning', 'Amelia Rogers', 'Rs. 10,700/=', '33%', 'Rs. 3,531/=', 'Rs. 7,169/=', '2025-10-22', 'PENDING'], 
      ['Doctor Mark', 'General', 'Consultation', 'Owen Smith', 'Rs. 17,600/=', '40%', 'Rs. 7,040/=', 'Rs. 10,560/=', '2025-10-01', 'PAID'], 
      ['Doctor Mark', 'General', 'Follow-up', 'Scarlett Garcia', 'Rs. 12,000/=', '25%', 'Rs. 3,000/=', 'Rs. 9,000/=', '2025-10-11', 'PAID'], 
      ['Doctor Mark', 'Orthopedics', 'X-Ray', 'Jacob Hernandez', 'Rs. 21,250/=', '33%', 'Rs. 7,012/=', 'Rs. 14,238/=', '2025-10-05', 'PAID'], 
      ['Doctor Mark', 'General', 'Walk-in', 'Camila Thomas', 'Rs. 16,700/=', '25%', 'Rs. 4,175/=', 'Rs. 12,525/=', '2025-10-19', 'PAID'], 
      ['Doctor Mark', 'General', 'Checkup', 'Aiden Lee', 'Rs. 3,800/=', '25%', 'Rs. 950/=', 'Rs. 2,850/=', '2025-10-20', 'PAID'], 
      ['Doctor Mark', 'Imaging', 'MRI', 'Zoe Wright', 'Rs. 2,100/=', '33%', 'Rs. 693/=', 'Rs. 1,407/=', '2025-10-27', 'PAID'], 
      ['Doctor Paulo', 'Imaging', 'Ultrasound', 'Samuel Nelson', 'Rs. 3,250/=', '35%', 'Rs. 1,137/=', 'Rs. 2,113/=', '2025-10-16', 'PAID'], 
      ['Doctor Paulo', 'Imaging', 'MRI', 'Madison Edwards', 'Rs. 11,600/=', '30%', 'Rs. 3,480/=', 'Rs. 8,120/=', '2025-10-29', 'PAID'], 
      ['Doctor Paulo', 'Orthopedics', 'Fracture Review', 'Carter Rogers', 'Rs. 19,850/=', '30%', 'Rs. 5,955/=', 'Rs. 13,895/=', '2025-10-13', 'PAID'], 
      ['Doctor Paulo', 'General', 'Consultation', 'Penelope Smith', 'Rs. 6,950/=', '35%', 'Rs. 2,432/=', 'Rs. 4,518/=', '2025-10-30', 'PAID'], 
      ['Doctor Paulo', 'Imaging', 'CT Scan', 'Isaac Garcia', 'Rs. 0/=', '0%', 'Rs. 0/=', 'Rs. 0/=', '2025-10-19', 'CANCELLED'], 
      ['Doctor Paulo', 'Cardiology', 'ECG', 'Violet Hernandez', 'Rs. 17,150/=', '30%', 'Rs. 5,145/=', 'Rs. 12,005/=', '2025-10-06', 'PENDING'], 
      ['Doctor Paulo', 'General', 'Checkup', 'Noah Thomas', 'Rs. 12,450/=', '25%', 'Rs. 3,112/=', 'Rs. 9,338/=', '2025-10-21', 'PAID'], 
      ['Doctor Grace', 'General', 'Wellness', 'Sophia Lee', 'Rs. 20,850/=', '25%', 'Rs. 5,212/=', 'Rs. 15,638/=', '2025-10-18', 'PENDING'], 
      ['Doctor Grace', 'Neurology', 'Scan', 'James Wright', 'Rs. 3,200/=', '33%', 'Rs. 1,056/=', 'Rs. 2,144/=', '2025-10-19', 'PAID'], 
      ['Doctor Grace', 'General', 'Consultation', 'Charlotte Nelson', 'Rs. 7,900/=', '30%', 'Rs. 2,370/=', 'Rs. 5,530/=', '2025-10-16', 'PAID'], 
      ['Doctor Grace', 'Cardiac', 'Cardiac Panel', 'Logan Edwards', 'Rs. 18,400/=', '35%', 'Rs. 6,440/=', 'Rs. 11,960/=', '2025-10-22', 'PAID'], 
      ['Doctor Grace', 'General', 'Follow-up', 'Ella Rogers', 'Rs. 7,150/=', '35%', 'Rs. 2,502/=', 'Rs. 4,648/=', '2025-10-28', 'PENDING'], 
      ['Doctor Grace', 'Imaging', 'Rapid Test', 'Michael Smith', 'Rs. 13,700/=', '25%', 'Rs. 3,425/=', 'Rs. 10,275/=', '2025-10-17', 'PAID'], 
      ['Doctor Grace', 'General', 'Checkup', 'Chloe Garcia', 'Rs. 14,600/=', '33%', 'Rs. 4,818/=', 'Rs. 9,782/=', '2025-10-08', 'PAID'], 
      ['Doctor Rita', 'Endocrine', 'Hormone Consult', 'Jack Hernandez', 'Rs. 18,300/=', '25%', 'Rs. 4,575/=', 'Rs. 13,725/=', '2025-10-14', 'PAID'], 
      ['Doctor Rita', 'General', 'Minor Procedure', 'Layla Thomas', 'Rs. 9,150/=', '30%', 'Rs. 2,745/=', 'Rs. 6,405/=', '2025-10-15', 'PAID'], 
      ['Doctor Rita', 'General', 'Consultation', 'Matthew Lee', 'Rs. 15,250/=', '25%', 'Rs. 3,812/=', 'Rs. 11,438/=', '2025-10-06', 'PAID'], 
      ['Doctor Rita', 'Cardiac', 'Cardiac Panel', 'Aria Wright', 'Rs. 16,550/=', '35%', 'Rs. 5,792/=', 'Rs. 10,758/=', '2025-10-09', 'PAID'], 
      ['Doctor Rita', 'General', 'Checkup', 'Joseph Nelson', 'Rs. 17,050/=', '30%', 'Rs. 5,115/=', 'Rs. 11,935/=', '2025-10-21', 'PAID'], 
      ['Doctor Rita', 'Imaging', 'CT Scan', 'Hannah Edwards', 'Rs. 19,500/=', '33%', 'Rs. 6,435/=', 'Rs. 13,065/=', '2025-10-01', 'PENDING'], 
      ['Doctor Rita', 'General', 'Follow-up', 'Gabriel Rogers', 'Rs. 13,050/=', '33%', 'Rs. 4,306/=', 'Rs. 8,744/=', '2025-10-23', 'PAID'], 
      ['Doctor Clara', 'Gynae', 'Antenatal Visit', 'Ellie Smith', 'Rs. 21,000/=', '33%', 'Rs. 6,930/=', 'Rs. 14,070/=', '2025-10-01', 'PENDING'], 
      ['Doctor Clara', 'General', 'Minor Procedure', 'Oliver Garcia', 'Rs. 10,150/=', '30%', 'Rs. 3,045/=', 'Rs. 7,105/=', '2025-10-30', 'PAID'], 
      ['Doctor Clara', 'General', 'Consultation', 'Ava Hernandez', 'Rs. 0/=', '0%', 'Rs. 0/=', 'Rs. 0/=', '2025-10-03', 'CANCELLED'], 
      ['Doctor Clara', 'Imaging', 'MRI', 'Mason Thomas', 'Rs. 6,000/=', '33%', 'Rs. 1,980/=', 'Rs. 4,020/=', '2025-10-30', 'PAID'], 
      ['Doctor Clara', 'General', 'Checkup', 'Mia Lee', 'Rs. 1,200/=', '30%', 'Rs. 360/=', 'Rs. 840/=', '2025-10-19', 'PAID'],
      ['Doctor Clara', 'General', 'Walk-in', 'Lucas Wright', 'Rs. 20,850/=', '30%', 'Rs. 6,255/=', 'Rs. 14,595/=', '2025-10-11', 'PAID'], 
      ['Doctor Clara', 'Imaging', 'Ultrasound', 'Evelyn Nelson', 'Rs. 22,200/=', '40%', 'Rs. 8,880/=', 'Rs. 13,320/=', '2025-10-20', 'PAID'], 
      ['Doctor Susan', 'Cardiology', 'ECG Test', 'Daniel Edwards', 'Rs. 8,100/=', '25%', 'Rs. 2,025/=', 'Rs. 6,075/=', '2025-10-07', 'PAID'], 
      ['Doctor Susan', 'Orthopedics', 'X-Ray', 'Grace Rogers', 'Rs. 18,250/=', '40%', 'Rs. 7,300/=', 'Rs. 10,950/=', '2025-10-13', 'PENDING'], 
      ['Doctor Susan', 'General', 'Consultation', 'Sebastian Smith', 'Rs. 17,150/=', '35%', 'Rs. 6,002/=', 'Rs. 11,148/=', '2025-10-19', 'PAID'], 
      ['Doctor Susan', 'Cardiac', 'Cardiac Panel', 'Luna Garcia', 'Rs. 7,950/=', '40%', 'Rs. 3,180/=', 'Rs. 4,770/=', '2025-10-10', 'PAID'], 
      ['Doctor Susan', 'General', 'Checkup', 'Ethan Hernandez', 'Rs. 17,650/=', '35%', 'Rs. 6,177/=', 'Rs. 11,473/=', '2025-10-28', 'PENDING'], 
      ['Doctor Susan', 'Imaging', 'CT Scan', 'Nora Thomas', 'Rs. 17,400/=', '30%', 'Rs. 5,220/=', 'Rs. 12,180/=', '2025-10-29', 'PAID'], 
      ['Doctor Susan', 'General', 'Follow-up', 'David Lee', 'Rs. 18,800/=', '25%', 'Rs. 4,700/=', 'Rs. 14,100/=', '2025-10-24', 'PENDING'], 
      ['Doctor Maya', 'Neurology', 'Scan', 'Lily Wright', 'Rs. 3,850/=', '33%', 'Rs. 1,270/=', 'Rs. 2,580/=', '2025-10-22', 'PAID'], 
      ['Doctor Maya', 'General', 'Checkup', 'Wyatt Nelson', 'Rs. 11,350/=', '35%', 'Rs. 3,972/=', 'Rs. 7,378/=', '2025-10-16', 'PAID'], 
      ['Doctor Maya', 'Imaging', 'MRI', 'Victoria Edwards', 'Rs. 10,750/=', '25%', 'Rs. 2,687/=', 'Rs. 8,063/=', '2025-10-24', 'PAID'], 
      ['Doctor Maya', 'General', 'Consultation', 'Julian Rogers', 'Rs. 16,650/=', '25%', 'Rs. 4,162/=', 'Rs. 12,488/=', '2025-10-25', 'PAID'], 
      ['Doctor Maya', 'Orthopedics', 'Fracture Review', 'Emma Smith', 'Rs. 16,800/=', '25%', 'Rs. 4,200/=', 'Rs. 12,600/=', '2025-10-12', 'PAID'], 
      ['Doctor Maya', 'General', 'Follow-up', 'Liam Garcia', 'Rs. 18,150/=', '33%', 'Rs. 5,989/=', 'Rs. 12,161/=', '2025-10-30', 'PAID'], 
      ['Doctor Maya', 'Imaging', 'Ultrasound', 'Isabella Hernandez', 'Rs. 4,900/=', '33%', 'Rs. 1,617/=', 'Rs. 3,283/=', '2025-10-11', 'PAID']
    );

        const dateIdx = 8, docIdx = 0;
        const filtered = allRows.filter(r => doctors.includes(r[docIdx]) && withinRange(r[dateIdx], start, end));
        renderRows(filtered);
        renderedCount = filtered.length;
      }

      // If no rows, show an empty-state row
      if (renderedCount === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = cols.length;
        td.style.textAlign = 'center';
        td.style.color = 'var(--muted)';
        td.style.padding = '18px 10px';
        td.textContent = 'No reports found';
        tr.appendChild(td);
        reportTbody.appendChild(tr);
      }

      function renderRows(rows){
        rows.forEach(r => {
          const tr = document.createElement('tr');
          r.forEach(html => {
            const td = document.createElement('td');
            td.innerHTML = html;
            tr.appendChild(td);
          });
          reportTbody.appendChild(tr);
        });
      }

      function withinRange(dateStr, startStr, endStr){
        // Expecting YYYY-MM-DD; inclusive bounds
        if (!dateStr || !startStr || !endStr) return false;
        return String(dateStr) >= String(startStr) && String(dateStr) <= String(endStr);
      }

      // meta info
      if (reportMeta){
        reportMeta.classList.remove('hidden');
        const doctorList = (doctors || []).join(', ');
        reportMeta.innerHTML = `<div>Report Type: <strong>${type.charAt(0).toUpperCase()+type.slice(1)}</strong></div>`;
      }

      // show actions and toggle download availability
      if (reportActions) reportActions.classList.remove('hidden');
      if (downloadReportBtn) {
        downloadReportBtn.disabled = renderedCount === 0;
        downloadReportBtn.title = renderedCount === 0 ? 'No data to download' : '';
        downloadReportBtn.setAttribute('aria-disabled', String(renderedCount === 0));
      }
      return renderedCount;
    }

    function validateReportFilters(){
      const type = getSelectedReportType();
      if (!type) return { ok:false, message:'Select a report type' };
      const doctorSelectEl = document.getElementById('reportDoctorSelect');
      const selectedDoctor = (doctorSelectEl && doctorSelectEl.value) ? doctorSelectEl.value : '';
      if (!selectedDoctor) return { ok:false, message:'Select a doctor' };
      const start = reportStartInput?.value;
      const end = reportEndInput?.value;
      if (!start || !end) return { ok:false, message:'Select start and end dates' };
      if (start > end) return { ok:false, message:'Start date cannot be after end date' };
      return { ok:true, type, doctors: [selectedDoctor], start, end };
    }

    generateReportBtn && generateReportBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const v = validateReportFilters();
      if (!v.ok){
        showToast(v.message, true);
        return;
      }
      const count = renderDemoReport(v.type, v.doctors, v.start, v.end) ?? 0;
      if (reportTableWrapper) reportTableWrapper.classList.remove('hidden');
      // showToast(`Report generated (${count} row${count===1?'':'s'})`);
      showToast(`Report generated successfully`);
    });

    // Changing report type hides existing table until regenerated
    reportTypeRadios.forEach(r => r.addEventListener('change', ()=> {
      if (reportTableWrapper) reportTableWrapper.classList.add('hidden');
      reportMeta && reportMeta.classList.add('hidden');
      reportActions && reportActions.classList.add('hidden');
    }));
    const reportDoctorSelectListener = document.getElementById('reportDoctorSelect');
    reportDoctorSelectListener && reportDoctorSelectListener.addEventListener('change', ()=> {
      if (reportTableWrapper) reportTableWrapper.classList.add('hidden');
      reportMeta && reportMeta.classList.add('hidden');
      reportActions && reportActions.classList.add('hidden');
    });
    reportStartInput && reportStartInput.addEventListener('change', ()=> { reportTableWrapper?.classList.add('hidden'); reportMeta && reportMeta.classList.add('hidden'); reportActions && reportActions.classList.add('hidden'); });
    reportEndInput && reportEndInput.addEventListener('change', ()=> { reportTableWrapper?.classList.add('hidden'); reportMeta && reportMeta.classList.add('hidden'); reportActions && reportActions.classList.add('hidden'); });

    // Download report as PDF
    downloadReportBtn && downloadReportBtn.addEventListener('click', (e) => {
      const hasJsPDF = !!(window.jspdf && window.jspdf.jsPDF);
      let hasAutoTable = false;
      try {
        if (hasJsPDF) {
          const { jsPDF } = window.jspdf;
          const testDoc = new jsPDF();
          hasAutoTable = typeof testDoc.autoTable === 'function' || (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API && typeof window.jspdf.jsPDF.API.autoTable === 'function');
        }
      } catch (_) { hasAutoTable = false; }
      if (!hasJsPDF || !hasAutoTable) {
        showToast('PDF libraries not loaded', true);
        return;
      }
  const { jsPDF } = window.jspdf;
  // Force landscape orientation explicitly ('l' is accepted across jsPDF versions)
  const doc = new jsPDF({ orientation: 'l', unit: 'pt', format: 'a4' });

      // Title
      const type = getSelectedReportType();
      const title = `Report - ${type ? type.charAt(0).toUpperCase()+type.slice(1) : ''}`;
      doc.setFontSize(14);
      doc.text(title, 40, 40);

      // Build table data from DOM
      const headers = Array.from(reportThead.querySelectorAll('th')).map(th => th.textContent.trim());
      const body = Array.from(reportTbody.querySelectorAll('tr')).map(tr =>
        Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim())
      );

      doc.autoTable({
        startY: 60,
        head: [headers],
        body,
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [11, 121, 208] },
        theme: 'striped'
      });

      if (e.shiftKey) {
        // Auto download if Shift is held
        doc.save('report.pdf');
        showToast('PDF downloaded');
      } else {
        // Open in a new tab by default; fallback to download if popup blocked
        const blob = doc.output('blob');
        const blobUrl = URL.createObjectURL(blob);
        const win = window.open(blobUrl, '_blank');
        if (!win || win.closed) {
          doc.save('report.pdf');
          showToast('Popup blocked. Downloaded instead.');
        } else {
          showToast('PDF opened in new tab. Use browser Save to download.');
        }
      }
    });

    // --- Billing Form ---
    // const billingForm = document.getElementById('billingForm');
    // billingForm && billingForm.addEventListener('submit', (e) => {
    //   e.preventDefault();
    //   const patientId = document.getElementById('billing-patient-id')?.value;
    //   if (!patientId) {
    //     showToast("Patient ID is required.", true);
    //     return;
    //   }
    //   showToast('Billing record submitted successfully.');
    //   billingForm.reset();
    // });

    // const researchForm = document.getElementById('researchForm');
    // researchForm && researchForm.addEventListener('submit', (e) => {
    //   e.preventDefault();
    //   const studyTitle = document.getElementById('study-title')?.value;
    //   if (!studyTitle) {
    //     showToast("Study Title is required.", true);
    //     return;
    //   }
    //   showToast('Research proposal submitted.');
    //   researchForm.reset();
    // });

    // const helpForm = document.getElementById('helpForm');
    // helpForm && helpForm.addEventListener('submit', (e) => {
    //   e.preventDefault();
    //   const name = document.getElementById('help-name')?.value;
    //   const email = document.getElementById('help-email')?.value;
    //   const message = document.getElementById('help-message')?.value;
    //   if (!name || !email || !message) {
    //     showToast("Please fill out all fields in the support form.", true);
    //     return;
    //   }
    //   showToast('Support request submitted successfully.');
    //   helpForm.reset();
    // });

    // note: profile menu removed (undoing last changes)
  }

  // ---------- storage ----------
  function loadAppointments() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { console.warn('load error', e); }
    return [];
  }

  async function loadFromJsonFile() {
    const res = await fetch('appointments.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('appointments.json not found');
    return res.json();
  }

  function saveAppointments() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appointments));
    } catch (e) { console.warn('save error', e); }
  }


  // --- helpers: doctor normalization and query parsing ---
  function normalizeDoctor(str){
    let s = String(str || '').toLowerCase();
    s = s.replace(/\./g, ' ');
    s = s.trim().replace(/^(dr\s*|doctor\s+)/i, '');
    return s.replace(/\s+/g, ' ').trim();
  }

  function parseDoctorQuery(q){
    // match "Dr Lee", "Dr. Lee", "Doctor Lee" -> capture trailing name only
    const m = String(q || '').trim().match(/^(dr\.?\s*|doctor\s+)(.+)$/i);
    if (!m) return '';
    return normalizeDoctor(m[2] || '');
  }

  // --- added: normalization helpers ---
  function normalizeGender(g){
    const v = String(g || '').trim().toLowerCase();
    if (v.startsWith('m')) return 'M';
    if (v.startsWith('f')) return 'F';
    return '';
  }

  function titleCase(s){
    return String(s || '')
      .trim()
      .split(/\s+/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }


  // ---------- rendering ----------
  function renderAppointmentsTable() {
    const rawQ = (searchInput.value || '').trim();
    const q = rawQ.toLowerCase();
    const doctorIntentName = parseDoctorQuery(q);
    const rows = appointments.filter(a => {
      if (!q) return true;
      if (doctorIntentName) {
        return normalizeDoctor(a.doctor).includes(doctorIntentName);
      }
      // Special gender query handling: when searching for "male/female" (or m/f),
      // also match records whose gender's first letter equals M or F.
      const isGenderM = q === 'male' || q === 'm';
      const isGenderF = q === 'female' || q === 'f';
      const genderFirst = ((a.gender || '').trim().charAt(0) || '').toLowerCase();
      const genderMatchSpecial = (isGenderM && genderFirst === 'm') || (isGenderF && genderFirst === 'f');
      
      // Full month name search support (e.g., "january", "july")
      // Map full month names to month numbers 1-12
      const monthMap = {
        january:1,february:2,march:3,april:4,may:5,june:6,
        july:7,august:8,september:9,october:10,november:11,december:12
      };
      const monthNumQuery = monthMap[q];
      if (monthNumQuery) {
        // apptDate stored as YYYY-MM-DD
        const m = parseInt(String(a.apptDate||'').split('-')[1]||'',10);
        if (m === monthNumQuery) return true;
      }

      const assistanceStr = Array.isArray(a.assistance) ? a.assistance.join(', ').toLowerCase() : String(a.assistance || '').toLowerCase();
      // build a searchable date/time string using the same formatting as display plus raw values for flexibility
      const dateTimeDisplay = formatDateTime(a.apptDate, a.apptTime).toLowerCase();
      const rawDate = (a.apptDate || '').toLowerCase();
      const rawTime = (a.apptTime || '').toLowerCase();
      const genericMatch = (
        (a.patientName && a.patientName.toLowerCase().includes(q)) ||
        (a.doctor && a.doctor.toLowerCase().includes(q)) ||
        (a.contactNumber && String(a.contactNumber).toLowerCase().includes(q)) ||
        (a.gender && String(a.gender).toLowerCase().includes(q)) ||
        (assistanceStr && assistanceStr.includes(q)) ||
        (dateTimeDisplay && dateTimeDisplay.includes(q)) ||
        (rawDate && rawDate.includes(q)) ||
        (rawTime && rawTime.includes(q))
      );
      return genericMatch || genderMatchSpecial;
    }).sort(compareBySort);
    const totalItems = rows.length;
    const totalPages = totalItems === 0 ? 1 : Math.ceil(totalItems / Math.max(1, pageSize));
    // clamp current page
    currentPage = Math.min(totalPages, Math.max(1, currentPage));
    const startIndex = totalItems === 0 ? 0 : (currentPage - 1) * pageSize;
    const endIndex = totalItems === 0 ? 0 : Math.min(startIndex + pageSize, totalItems);
    const pageRows = totalItems === 0 ? [] : rows.slice(startIndex, endIndex);

    // render table body
    tbody.innerHTML = '';
    if (pageRows.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="7" style="text-align:center;color:var(--muted);padding:28px 10px">No appointments found</td>`;
      tbody.appendChild(tr);
    } else {
      pageRows.forEach(a => {
      const tr = document.createElement('tr');

      const dateTime = formatDateTime(a.apptDate, a.apptTime);
      const assistanceDisplay = Array.isArray(a.assistance) ? a.assistance.join(', ') : (a.assistance || '');
      tr.innerHTML = `
        <td>${escapeHtml(a.patientName)}</td>
        <td>${escapeHtml(a.gender || '')}</td>
        <td>${escapeHtml(a.age || '')}</td>
        <td>${escapeHtml(dateTime)}</td>
        <td>${escapeHtml(a.doctor || '')}</td>
        <td>${escapeHtml(a.contactNumber || '')}</td>
        <td>${escapeHtml(assistanceDisplay)}</td>

        <td>
            <div class="row-actions">
                <button class="action-icon-btn notify-btn" data-ref="${a.ref}" voice.name="send reminder" title="Toggle Notification">
                    <svg fill="currentColor" viewBox="0 0 16 16"><path d="M8 16a2 2 0 0 0 2-2H6a2 2 0 0 0 2 2zM8 1.918l-.797.161A4.002 4.002 0 0 0 4 6c0 .628-.134 2.197-.459 3.742-.16.767-.376 1.566-.663 2.258h10.244c-.287-.692-.502-1.49-.663-2.258C12.134 8.197 12 6.628 12 6a4.002 4.002 0 0 0-3.203-3.92L8 1.917zM14.22 12c.223.447.481.801.78 1H1c.299-.199.557-.553.78-1C2.68 10.2 3 6.88 3 6c0-2.42 1.72-4.44 4.005-4.901a1 1 0 1 1 1.99 0A5.002 5.002 0 0 1 13 6c0 .88.32 4.2 1.22 6z"/></svg>
                </button>
                
                <button class="action-icon-btn" data-action="edit" data-ref="${a.ref}" voice.name="edit appointment" title="Edit Appointment">
                    <svg fill="currentColor" viewBox="0 0 16 16"><path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z"/></svg>
                </button>
                <button class="action-icon-btn" data-action="delete" data-ref="${a.ref}" voice.name="delete appointment" title="Delete Appointment">
                    <svg fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>
                </button>
            </div>
        </td>
      `;
      tbody.appendChild(tr);
      });
    }

    // <td style="text-align:center">   <button class="icon-btn notify-btn" data-ref="${a.ref}" voice.name="notify" title="Toggle notify">🔔</button></td>
    //     <td style="text-align:right">
    //       <div class="row-actions">
    //         <button class="btn" data-action="edit" voice.name="edit appointment" data-ref="${a.ref}">Edit</button>
    //         <button class="btn" data-action="delete" voice.name="delete appointment" data-ref="${a.ref}" style="border-color: #ffd6d6;">Delete</button>
    //       </div>
    //     </td>

    // attach action listeners
    tbody.querySelectorAll('button[data-action]').forEach(b => {
      b.addEventListener('click', (ev) => {
        const action = b.dataset.action;
        const ref = b.dataset.ref;
        if (action === 'edit') handleEdit(ref);
        if (action === 'delete') { lastDeleteButton = b; handleDelete(ref); }
      });
    });

    tbody.querySelectorAll('.notify-btn').forEach(nb => {
      const ref = nb.dataset.ref;
      if (ref && notifiedOnce.has(ref)) {
        nb.classList.add('active');
      }
      nb.addEventListener('click', () => {
        const ref = nb.dataset.ref;
        if (!ref) return;
        if (notifiedOnce.has(ref)) {
          showToast('Patient has been already notified');
          return;
        }
        notifiedOnce.add(ref);
        nb.classList.add('active');
        try { localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...notifiedOnce])); } catch(_) {}
        showToast('Patient has been notified');
      });
    });

    // update pagination labels and button states
    if (rangeLabelEl) {
      if (totalItems === 0) {
        rangeLabelEl.textContent = '0 of 0 items';
      } else {
        rangeLabelEl.textContent = `${startIndex + 1}–${endIndex} of ${totalItems} items`;
      }
    }
    if (pageLabelEl) {
      if (totalItems === 0) {
        pageLabelEl.textContent = '0 of 0';
      } else {
        pageLabelEl.textContent = `${currentPage} of ${totalPages}`;
      }
    }
    const atFirst = totalItems === 0 || currentPage <= 1;
    const atLast = totalItems === 0 || currentPage >= totalPages;
    if (firstPageBtn) firstPageBtn.disabled = atFirst;
    if (prevPageBtn) prevPageBtn.disabled = atFirst;
    if (nextPageBtn) nextPageBtn.disabled = atLast;
    if (lastPageBtn) lastPageBtn.disabled = atLast;

  }

  // Extended sort: support patientName, gender, age, apptDate (date+time), doctor, contactNumber, assistance.
  function compareBySort(a, b){
    const dir = (sortDir === 'desc') ? -1 : 1;
    const lower = v => String(v == null ? '' : v).trim().toLowerCase();

    switch (sortField) {
      case 'patientName':
        return lower(a.patientName).localeCompare(lower(b.patientName), undefined, {sensitivity:'base'}) * dir;
      case 'gender':
        return lower(a.gender).localeCompare(lower(b.gender), undefined, {sensitivity:'base'}) * dir;
      case 'age': {
        const ageA = parseInt(a.age || '0', 10) || 0;
        const ageB = parseInt(b.age || '0', 10) || 0;
        if (ageA === ageB) return lower(a.patientName).localeCompare(lower(b.patientName)) * dir;
        return (ageA < ageB ? -1 : 1) * dir;
      }
      case 'contactNumber':
        return lower(a.contactNumber).localeCompare(lower(b.contactNumber)) * dir;
      case 'doctor': {
        const d1 = normalizeDoctor(a.doctor);
        const d2 = normalizeDoctor(b.doctor);
        const cmp = d1.localeCompare(d2, undefined, {sensitivity:'base'});
        if (cmp !== 0) return cmp * dir;
        return lower(a.patientName).localeCompare(lower(b.patientName)) * dir;
      }
      case 'assistance': {
        const assistA = Array.isArray(a.assistance) ? a.assistance.join(',').toLowerCase() : '';
        const assistB = Array.isArray(b.assistance) ? b.assistance.join(',').toLowerCase() : '';
        return assistA.localeCompare(assistB) * dir;
      }
      case 'apptDate': {
        const key = x => (x.apptDate || '') + 'T' + (x.apptTime || '');
        const aKey = key(a);
        const bKey = key(b);
        if (aKey === bKey) return lower(a.patientName).localeCompare(lower(b.patientName)) * dir;
        return (aKey < bKey ? -1 : 1) * dir;
      }
      default: {
        const nameCmp = lower(a.patientName).localeCompare(lower(b.patientName), undefined, {sensitivity:'base'});
        if (nameCmp !== 0) return nameCmp * dir;
        return String(a.ref || '').localeCompare(String(b.ref || '')) * dir;
      }
    }
  }

  function updateSortUI(){
    document.querySelectorAll('.sort-btn').forEach(b => {
      const active = b.dataset.field === sortField && b.dataset.dir === sortDir;
      if (active) b.classList.add('active'); else b.classList.remove('active');
    });
  }




  // ---------- form flows ----------
  function openCreateForm() {
    editingRef = null;
    formTitle.textContent = 'Create Appointment';
    appointmentForm.reset();
    document.getElementById('editRef').value = '';
    submitFormBtn.textContent = 'Create Appointment';
    showFormView();
  }

  function showFormView() {
    listView.classList.add('hidden');
    formView.classList.remove('hidden');
    const header = document.querySelector('.appointments-header');
    if (header) header.classList.add('hidden');
    // ensure appointments tab remains active
    showTab('appointments');
    // scroll to form
    setTimeout(()=> formView.scrollIntoView({behavior:'smooth', block:'start'}), 100);
  }

  function showListView() {
    formView.classList.add('hidden');
    listView.classList.remove('hidden');
    const header = document.querySelector('.appointments-header');
    if (header) header.classList.remove('hidden');
    renderAppointmentsTable();
    // scroll to top of list
    setTimeout(()=> listView.scrollIntoView({behavior:'smooth', block:'start'}), 80);
  }

  function handleFormSubmit() {
    // gather form fields
    const patientName = document.getElementById('patientName').value.trim();
    const contactNumber = document.getElementById('contactNumber').value.trim();
    const apptDate = document.getElementById('apptDate').value;
    const apptTime = document.getElementById('apptTime').value;
    const doctor = document.getElementById('doctorSelect').value;
    const genderRaw = (appointmentForm.querySelector('input[name="gender"]:checked') || {}).value || '';
    const gender = normalizeGender(genderRaw);
    const notes = document.getElementById('notes').value.trim();
    const age = (document.getElementById('age').value || '').trim();

    const assists = Array.from(appointmentForm.querySelectorAll('input[name="assistances"]:checked')).map(i => i.value);

    // Basic validation
    if (!patientName) { showToast('Please enter patient name', true); return; }
    if (!apptDate) { showToast('Please select appointment date', true); return; }
    if (!apptTime) { showToast('Please select appointment time', true); return; }
    if (!doctor) { showToast('Please select a doctor', true); return; }

    if (editingRef) {
      // update existing
      const idx = appointments.findIndex(a => String(a.ref) === String(editingRef));
      if (idx > -1) {
        appointments[idx].patientName = patientName;
        appointments[idx].contactNumber = contactNumber;
        appointments[idx].apptDate = apptDate;
        appointments[idx].apptTime = apptTime;
        appointments[idx].doctor = titleCase(normalizeDoctor(doctor));
        appointments[idx].gender = gender;
         appointments[idx].age = age;
        appointments[idx].notes = notes;
        appointments[idx].assistance = assists;
  saveAppointments();
  //saveAppointmentsToJson();
        showToast('Appointment updated successfully');
      } else {
        showToast('Unable to find appointment to update', true);
      }
      editingRef = null;
    } else {
      // create new
  const newApp = makeAppointmentObject(patientName, contactNumber, apptDate, apptTime, doctor, gender, age, assists, notes);
      appointments.unshift(newApp); // add to top
  saveAppointments();
  //saveAppointmentsToJson();
      showToast('Appointment created successfully');
    }

    appointmentForm.reset();
    showListView();
  }

  function handleEdit(ref) {
    const app = appointments.find(a => String(a.ref) === String(ref));
    if (!app) { showToast('Appointment not found', true); return; }
    editingRef = ref;
    document.getElementById('editRef').value = ref;
    formTitle.textContent = 'Edit Appointment';
    document.getElementById('patientName').value = app.patientName || '';
    document.getElementById('contactNumber').value = app.contactNumber || '';
    document.getElementById('apptDate').value = app.apptDate || '';
    document.getElementById('apptTime').value = app.apptTime || '';
    // map stored plain doctor name back to select value (which includes prefix "Doctor")
    const storedDoctor = app.doctor || '';
    const selectValue = storedDoctor.toLowerCase().startsWith('doctor') ? storedDoctor : ('Doctor ' + storedDoctor);
    document.getElementById('doctorSelect').value = selectValue;
    document.getElementById('notes').value = app.notes || '';
    document.getElementById('age').value = app.age || '';

    // gender
  const genderValue = app.gender === 'F' ? 'Female' : 'Male';
  const genderInput = appointmentForm.querySelector(`input[name="gender"][value="${genderValue}"]`);
  if (genderInput) genderInput.checked = true;

    // assists
    appointmentForm.querySelectorAll('input[name="assistances"]').forEach(cb => {
      cb.checked = (app.assistance || []).includes(cb.value);
    });

    submitFormBtn.textContent = 'Update Appointment';
    showFormView();
  }

  function handleDelete(ref) {
    const app = appointments.find(a => String(a.ref) === String(ref));
    if (!app) { showToast('Appointment not found', true); return; }
    openDeleteModal(ref, app.patientName);
  }

  // ---------- helpers ----------
  function makeAppointmentObject(patientName, contactNumber, apptDate, apptTime, doctor, gender, age, assistances, notes) {
    return {
      ref: makeRef(),
      patientName,
      contactNumber,
      apptDate,
      apptTime,
      doctor: titleCase(normalizeDoctor(doctor)),
      gender: normalizeGender(gender),
      age: age || '',
      assistance: assistances || [],
      notes: notes || ''
    };
  }

  function makeRef(){
    return 'APT-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
  }

  function formatDateTime(d, t) {
    if (!d && !t) return '';
    const optsDate = { year: 'numeric', month: 'short', day: 'numeric' };
    let display = '';
    try {
      if (d) display = new Date(d).toLocaleDateString(undefined, optsDate);
    } catch(e){ display = d; }
    if (t) display += (display ? ' • ' : '') + t;
    return display;
  }

  function showToast(message, isError=false, duration=2800) {
    toastEl.textContent = message;
    // toastEl.style.background = isError ? 'var(--danger)' : '#111';
    toastEl.style.background = '#111';
    toastEl.classList.add('show');
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => {
      toastEl.classList.remove('show');
    }, duration);
  }

  // ---------- modal helpers ----------
  function openDeleteModal(ref, patientName){
    pendingDeleteRef = ref;
    // if (deleteModalMessage) deleteModalMessage.textContent = `${escapeHtml(ref)} for ${escapeHtml(patientName)}`;
    if (deleteModalMessage) deleteModalMessage.textContent = `${escapeHtml(patientName)}`;

    deleteModal.classList.remove('hidden');
    // focus first actionable button
    setTimeout(()=> confirmDeleteBtn.focus(), 50);
    // trap focus basic
    document.addEventListener('keydown', escListener);
  }

  function closeDeleteModal(){
    deleteModal.classList.add('hidden');
    pendingDeleteRef = null;
    document.removeEventListener('keydown', escListener);
    // restore focus to the delete button that opened the modal, if still in DOM
    if (lastDeleteButton && document.body.contains(lastDeleteButton)) {
      try { lastDeleteButton.focus(); } catch (e) {}
    }
  }

  function escListener(e){
    if (e.key === 'Escape') closeDeleteModal();
  }

  confirmDeleteBtn.addEventListener('click', () => {
    if (!pendingDeleteRef) return closeDeleteModal();
    appointments = appointments.filter(a => String(a.ref) !== String(pendingDeleteRef));
    saveAppointments();
    renderAppointmentsTable();
    showToast('Appointment deleted');
    closeDeleteModal();
  });

  cancelDeleteBtn.addEventListener('click', () => {
    closeDeleteModal();
    showToast('Deletion cancelled');
  });

  // close when clicking outside the dialog
  deleteModal.addEventListener('click', (e) => {
    if (e.target === deleteModal) closeDeleteModal();
  });

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, function(m) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];
    });
  }

});
