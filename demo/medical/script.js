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
      ['Yvonne Clark','0772000123','31','Female','08:30','2026-01-29','Doctor Ben','Room 02','CANCELLED','-']
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
      ['Jill Carter','Doctor Ben','Mrs. Cole','Lab 05','Rapid Antibodies','2026-01-27','CANCELLED','-','-','-']
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
      ['Doctor Ben','General','Checkup','Drew Lane','Rs. 2,400/=','33%','Rs. 792/=','Rs. 1,608/=','2026-01-26','PAID']
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
        appointments[idx].doctor = doctor;
        appointments[idx].gender = gender;
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
