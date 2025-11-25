document.addEventListener('DOMContentLoaded', async () => {
  // ---------- app state ----------
  const STORAGE_KEY = 'clinic_appointments_v1';
  let appointments = [];
  let editingRef = null;
  // pagination state
  const PAGE_SIZE_KEY = 'clinic_page_size';
  let currentPage = 1; // 1-based index
  let pageSize = parseInt(localStorage.getItem(PAGE_SIZE_KEY) || '25', 10);

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
        makeAppointmentObject('Alex', '0700000000', '2025-11-20', '09:00', 'Dr. Rob', 'Male', ['Wheelchair'], 'Demo record A'),
        makeAppointmentObject('Ben', '0771234567', '2025-11-21', '10:30', 'Dr. Lee', 'Male', [], 'Demo record B'),
        makeAppointmentObject('Clara', '0719992211', '2025-11-22', '14:00', 'Dr. Ben', 'Female', ['Allergy'], 'Demo record C')
      ];
      saveAppointments();
    }
  }
  renderAppointmentsTable();
  showTab('appointments');

  // Guard for VoiceKom initialization (if voicekom not loaded, don't crash)
  if (window.VoiceKom && typeof VoiceKom.init === 'function') {
    VoiceKom.init({
      wakeWords: [],
      sleepWords: [],
      containerId: 'speech-container',
      lang: 'en-US',

    // transcription: {
    //   provider: 'default',
    //   apiKey: '' 
    // },
    // recognition: {
    //   provider: 'default',
    //   apiKey: '' 
    // },
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
        'Status','Consultation Fee','Payment'
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
      // if (type === 'patients') {
      //   rows.push(
      //     ['Alex', '94767789188', '23', 'Male', '9:00am', '2025-11-06', 'Dr. Lee', 'Room 01', 'COMPLETED', 'Rs. 2,000/=', 'PAID'],
      //     ['Charles', '94789134261', '47', 'Male', '12:00pm', '2025-11-07', 'Dr. Rob', 'Room 03', 'COMPLETED', 'Rs. 2,300/=', 'PENDING'],
      //     ['Lucy', '9471568221', '5', 'Female', '3:00pm', '2025-11-07', 'Dr. Lee', 'Room 01', 'COMPLETED', 'Rs. 2,000/=', 'PENDING'],
      //     ['Amanda', '94715558769', '31', 'Female', '3:45pm', '2025-11-07', 'Dr. Ben', 'Room 03', 'CANCELLED', '-', '-']
      //   );

      // } else if (type === 'lab') {
      //   rows.push(
      //     ['Alex', 'Dr. Ben', 'Mr. Kevin', 'Lab 04', 'NS1 Antigen, Antibodies', '2025-11-06', '2025-11-10', 'COMPLETED', 'Rs. 7,000/=', 'Rs. 200/=', 'Rs. 7,200/='],
      //     ['Lucy', 'Dr. Ben', 'Mrs. Spencer', 'Lab 04', 'PCR, Rapid Antibodies', '2025-11-07', '2025-11-11', 'COMPLETED', 'Rs. 7,300/=', 'Rs. 200/=', 'Rs. 7,500/='],
      //     ['Steve', 'Dr. Rob', 'Mr. Peter', 'Lab 02', 'MRI', '2025-11-08', '2025-11-09', 'PENDING', 'Rs. 19,000/=', 'Rs. 1,000/=', 'Rs. 20,000/=']
      //   );

      // } else if (type === 'payments') {
      //   rows.push(
      //     ['Dr. Rob', 'General', '2025-11-06', 'General consultation', 'Alex', 'Rs. 9,200/=', '33%', 'Rs. 3,000/=', 'Rs. 6,000/=', '2025-11-11', 'PAID'],
      //     ['Dr. Lee', 'Neurology', '2025-11-08', 'Scan', 'Steve', 'Rs. 23,000/=', '35%', 'Rs. 8,100/=', 'Rs. 13,000/=', '2025-11-12', 'PENDING']
      //   );
        
      // }

  let renderedCount = 0;
  if (type === 'patients') {
        // allRows.push(
        //   ['Alex', '94767789188', '23', 'Male', '9:00am', '2025-11-06', 'Dr. Lee', 'Room 01', 'COMPLETED', 'Rs. 2,000/=', 'PAID'],
        //   ['Charles', '94789134261', '47', 'Male', '12:10pm', '2025-11-07', 'Dr. Rob', 'Room 03', 'COMPLETED', 'Rs. 2,300/=', 'PENDING'],
        //   ['Lucy', '9471568221', '5', 'Female', '3:00pm', '2025-11-07', 'Dr. Lee', 'Room 01', 'COMPLETED', 'Rs. 2,000/=', 'PENDING'],
        //   ['Amanda', '94715558769', '31', 'Female', '3:45pm', '2025-11-07', 'Dr. Ben', 'Room 03', 'CANCELLED', '-', '-'],
        //   ['Ben', '0771234567', '31', 'Male', '10:30am', '2025-11-08', 'Dr. Rob', 'Room 02', 'PENDING', 'Rs. 1,500/=', 'PENDING'],
        //   ['Clara', '0719992211', '28', 'Female', '2:00pm', '2025-11-08', 'Dr. Rob', 'Room 03', 'CANCELLED', '-', '-'],
        //   ['Diana', '94770011223', '39', 'Female', '11:15am', '2025-11-09', 'Dr. Lee', 'Room 02', 'COMPLETED', 'Rs. 3,500/=', 'PAID'],
        //   ['Ethan', '94770033445', '52', 'Male', '8:30am', '2025-11-09', 'Dr. Ben', 'Room 01', 'PENDING', 'Rs. 4,200/=', 'PENDING'],
        //   ['Fiona', '94770055667', '29', 'Female', '4:00pm', '2025-11-10', 'Dr. Lee', 'Room 04', 'COMPLETED', 'Rs. 1,800/=', 'PAID'],
        //   ['George', '94770077889', '45', 'Male', '9:45am', '2025-11-10', 'Dr. Rob', 'Room 02', 'COMPLETED', 'Rs. 2,700/=', 'PAID']
        // );

        allRows.push(
      ['Alex','94767789188','23','Male','9:00am','2025-11-06','Doctor Lee','COMPLETED','Rs. 2,000/=','PAID'],
      ['Charles','94789134261','47','Male','12:00pm','2025-11-07','Doctor Rob','COMPLETED','Rs. 2,300/=','PENDING'],
      ['Lucy','9471568221','5','Female','3:00pm','2025-11-07','Doctor Lee','COMPLETED','Rs. 2,000/=','PENDING'],
      ['Amanda','94715558769','31','Female','3:45pm','2025-11-07','Doctor Ben','CANCELLED','-','-'],
      ['Ben','0771234567','31','Male','10:30am','2025-11-08','Doctor Rob','PENDING','Rs. 1,500/=','PENDING'],
      ['Clara','0719992211','28','Female','14:00','2025-11-08','Doctor Rob','CANCELLED','Rs. 0/=','N/A'],
      ['Diana','94770011223','39','Female','11:15am','2025-11-09','Doctor Lee','COMPLETED','Rs. 3,500/=','PAID'],
      ['Ethan','94770033445','52','Male','08:30am','2025-11-09','Doctor Ben','PENDING','Rs. 4,200/=','PENDING'],
      ['Fiona','94770055667','29','Female','16:00','2025-11-10','Doctor Lee','COMPLETED','Rs. 1,800/=','PAID'],
      ['George','94770077889','45','Male','09:45am','2025-11-10','Doctor Rob','COMPLETED','Rs. 2,700/=','PAID'],
      ['Hannah','94770088990','34','Female','10:15am','2025-11-11','Doctor Ben','PENDING','Rs. 2,400/=','PENDING'],
      ['Ian','94770100112','60','Male','13:00pm','2025-11-11','Doctor Lee','COMPLETED','Rs. 5,000/=','PAID'],    
      ['Jade','94770122334','26','Female','14:30','2025-11-12','Doctor Rob','PENDING','Rs. 1,200/=','PENDING'],
      ['Kyle','94770144556','38','Male','15:00','2025-11-12','Doctor Ben','COMPLETED','Rs. 2,800/=','PAID'],
      ['Lina','94770166778','22','Female','09:00am','2025-11-13','Doctor Lee','COMPLETED','Rs. 1,500/=','PAID'],
      ['Mike','94770188990','50','Male','11:45am','2025-11-13','Doctor Rob','PENDING','Rs. 3,300/=','PENDING'],
      ['Nora','94770200123','42','Female','10:30am','2025-11-14','Doctor Lee','COMPLETED','Rs. 2,200/=','PAID'],
      ['Oscar','94770222345','29','Male','12:00pm','2025-11-14','Doctor Ben','PENDING','Rs. 3,800/=','PENDING'],
      ['Paula','94770244567','36','Female','13:30pm','2025-11-15','Doctor Rob','COMPLETED','Rs. 2,500/=','PAID'],
      ['Quinn','94770266789','18','Male','16:15','2025-11-15','Doctor Lee','PENDING','Rs. 900/=','PENDING'],
      ['Rita','94770288990','55','Female','08:45am','2025-11-16','Doctor Ben','COMPLETED','Rs. 6,200/=','PAID'],
      ['Sam','94770300112','33','Male','09:30am','2025-11-16','Doctor Rob','PENDING','Rs. 1,700/=','PENDING'],
      ['Tina','94770322334','27','Female','10:00am','2025-11-17','Doctor Lee','COMPLETED','Rs. 1,100/=','PAID'],
      ['Uma','94770344556','48','Female','11:00am','2025-11-17','Doctor Ben','COMPLETED','Rs. 4,900/=','PAID'],
      ['Victor','94770366778','61','Male','14:45','2025-11-18','Doctor Rob','PENDING','Rs. 3,600/=','PENDING'],
      ['Wendy','94770388990','30','Female','15:30','2025-11-18','Doctor Lee','COMPLETED','Rs. 2,100/=','PAID'],
      ['Xavier','94770400123','44','Male','09:15am','2025-11-19','Doctor Ben','PENDING','Rs. 5,000/=','PENDING'],
      ['Yara','94770422345','21','Female','10:45','2025-11-19','Doctor Rob','COMPLETED','Rs. 1,600/=','PAID'],
      ['Zack','94770444567','37','Male','12:30pm','2025-11-20','Doctor Lee','PENDING','Rs. 2,900/=','PENDING'],
      ['Aaron','94770466789','49','Male','13:30pm','2025-11-20','Doctor Ben','COMPLETED','Rs. 3,300/=','PAID'],
      ['Bella','94770488990','32','Female','16:00','2025-11-21','Doctor Rob','CANCELLED','-','-']
    );

        const dateIdx = 5, docIdx = 6;
        const filtered = allRows.filter(r => doctors.includes(r[docIdx]) && withinRange(r[dateIdx], start, end));
  renderRows(filtered);
        renderedCount = filtered.length;

      } else if (type === 'lab') {
        // allRows.push(
        //   ['Alex', 'Dr. Lee', 'Mr. Peter', 'Lab 04', 'NS1 Antigen, Antibodies', '2025-11-10', 'COMPLETED', 'Rs. 7,000/=', 'Rs. 200/=', 'Rs. 7,200/='],
        //   ['Lucy', 'Dr. Lee', 'Mrs. Spencer', 'Lab 04', 'PCR, Rapid Antibodies', '2025-11-11', 'COMPLETED', 'Rs. 7,300/=', 'Rs. 200/=', 'Rs. 7,500/='],
        //   ['Ethan', 'Dr. Ben', 'Mr. Peter', 'Lab 02', 'Liver Panel', '2025-11-09', 'PENDING', 'Rs. 4,800/=', 'Rs. 250/=', 'Rs. 5,050/='],
        //   ['Ben', 'Dr. Rob', 'Mrs. Spencer', 'Lab 02', 'Full Blood Count', '2025-11-09', 'PENDING', 'Rs. 3,500/=', 'Rs. 150/=', 'Rs. 3,650/='],
        //   ['Diana', 'Dr. Lee', 'Mr. Kevin', 'Lab 03', 'Thyroid Profile', '2025-11-10', 'COMPLETED', 'Rs. 2,900/=', 'Rs. 150/=', 'Rs. 3,050/='],
        //   ['Fiona', 'Dr. Lee', 'Mrs. Spencer', 'Lab 04', 'Rapid Antibodies', '2025-11-10', 'COMPLETED', 'Rs. 1,200/=', 'Rs. 100/=', 'Rs. 1,300/='],
        //   ['George', 'Dr. Rob', 'Mr. Peter', 'Lab 01', 'Lipid Profile', '2025-11-08', 'COMPLETED', 'Rs. 4,200/=', 'Rs. 180/=', 'Rs. 4,380/='],
        //   ['Clara', 'Dr. Rob', 'Mr. Peter', 'Lab 01', 'X-Ray (Chest)', '2025-11-08', 'COMPLETED', 'Rs. 2,000/=', 'Rs. 120/=', 'Rs. 2,120/='],
        //   ['Amanda', 'Dr. Ben', 'Mr. Kevin', 'Lab 04', 'Urine Analysis', '2025-11-07', 'CANCELLED', '-', '-', '-'],
        //   ['Charles', 'Dr. Rob', 'Mr. Kevin', 'Lab 03', 'ECG Report (Holter)', '2025-11-08', 'COMPLETED', 'Rs. 6,000/=', 'Rs. 300/=', 'Rs. 6,300/=']
        // );

        allRows.push(
      ['Alex','Doctor Lee','Mr. Smith','Lab 04','NS1 Antigen, Antibodies', '2025-11-10','COMPLETED','Rs. 7,000/=','Rs. 200/=','Rs. 7,200/='],
      ['Lucy','Doctor Lee','Mrs. Chamari','Lab 04','PCR, Rapid Antibodies', '2025-11-11','COMPLETED','Rs. 7,300/=','Rs. 200/=','Rs. 7,500/='],
      ['Ethan','Doctor Ben','Mr. Smith','Lab 02','Liver Panel','2025-11-09','PENDING','Rs. 4,800/=','Rs. 250/=','Rs. 5,050/='],
      ['Ben','Doctor Rob','Mr. Smith','Lab 02','Full Blood Count','2025-11-09','PENDING','Rs. 3,500/=','Rs. 150/=','Rs. 3,650/='],
      ['Diana','Doctor Lee','Mr. Kevin','Lab 03','Thyroid Profile','2025-11-10','COMPLETED','Rs. 2,900/=','Rs. 150/=','Rs. 3,050/='],
      ['Fiona','Doctor Lee','Mrs. Spencer','Lab 04','Rapid Antibodies','2025-11-10','COMPLETED','Rs. 1,200/=','Rs. 100/=','Rs. 1,300/='],
      ['George','Doctor Rob','Mr. Peter','Lab 01','Lipid Profile','2025-11-08','COMPLETED','Rs. 4,200/=','Rs. 180/=','Rs. 4,380/='],
      ['Clara','Doctor Rob','Mr. Peter','Lab 01','X-Ray (Chest)','2025-11-08','COMPLETED','Rs. 2,000/=','Rs. 120/=','Rs. 2,120/='],
      ['Amanda','Doctor Ben','Mr. Kevin','Lab 04','Urine Analysis','2025-11-07','CANCELLED','-','-','-'],
      ['Charles','Doctor Rob','Mr. Smith','Lab 03','ECG Report (Holter)','2025-11-08','COMPLETED','Rs. 6,000/=','Rs. 300/=','Rs. 6,300/='],
      ['Hannah','Doctor Ben','Mr. Kevin','Lab 02','Blood Sugar','2025-11-11','PENDING','Rs. 900/=','Rs. 50/=','Rs. 950/='],
      ['Ian','Doctor Lee','Mr. Kevin','Lab 03','Kidney Panel','2025-11-12','COMPLETED','Rs. 5,200/=','Rs. 200/=','Rs. 5,400/='],
      ['Jade','Doctor Rob','Mr. Smith','Lab 01','Allergy Panel','2025-11-13','PENDING','Rs. 2,600/=','Rs. 120/=','Rs. 2,720/='],
      ['Kyle','Doctor Ben','Mr. Smith','Lab 02','Stool Analysis','2025-11-12','COMPLETED','Rs. 1,400/=','Rs. 80/=','Rs. 1,480/='],
      ['Lina','Doctor Lee','Mrs. Spencer','Lab 04','Pregnancy Test','2025-11-13','COMPLETED','Rs. 800/=','Rs. 50/=','Rs. 850/='],
      ['Mike','Doctor Rob','Mr. Peter','Lab 01','Chest X-Ray','2025-11-13','PENDING','Rs. 2,100/=','Rs. 120/=','Rs. 2,220/='],
      ['Nora','Doctor Lee','Mr. Kevin','Lab 03','ECG','2025-11-14','COMPLETED','Rs. 1,900/=','Rs. 100/=','Rs. 2,000/='],
      ['Oscar','Doctor Ben','Mr. Smith','Lab 02','Ultrasound','2025-11-15','PENDING','Rs. 3,500/=','Rs. 200/=','Rs. 3,700/='],
      ['Paula','Doctor Rob','Mrs. Spencer','Lab 03','Bone Density','2025-11-16','COMPLETED','Rs. 4,000/=','Rs. 200/=','Rs. 4,200/='],
      ['Quinn','Doctor Lee','Mr. Smith','Lab 01','HBA1C','2025-11-15','PENDING','Rs. 1,100/=','Rs. 60/=','Rs. 1,160/='],
      ['Rita','Doctor Ben','Mr. Kevin','Lab 02','Full Metabolic Panel','2025-11-17','COMPLETED','Rs. 6,500/=','Rs. 300/=','Rs. 6,800/='],
      ['Sam','Doctor Rob','Mr. Smith','Lab 04','Drug Screen','2025-11-16','PENDING','Rs. 1,000/=','Rs. 50/=','Rs. 1,050/='],
      ['Tina','Doctor Lee','Mrs. Spencer','Lab 03','Viral Panel','2025-11-18','COMPLETED','Rs. 3,200/=','Rs. 150/=','Rs. 3,350/='],
      ['Uma','Doctor Ben','Mr. Kevin','Lab 02','Cardiac Enzymes','2025-11-18','COMPLETED','Rs. 4,400/=','Rs. 200/=','Rs. 4,600/='],
      ['Victor','Doctor Rob','Mr. Smith','Lab 01','MRI (referral)','2025-11-19','PENDING','Rs. 19,000/=','Rs. 1,000/=','Rs. 20,000/='],
      ['Wendy','Doctor Lee','Mrs. Spencer','Lab 04','Rapid Antibodies','2025-11-18','COMPLETED','Rs. 1,200/=','Rs. 100/=','Rs. 1,300/='],
      ['Xavier','Doctor Ben','Mr. Smith','Lab 02','CT Scan','2025-11-20','PENDING','Rs. 12,000/=','Rs. 600/=','Rs. 12,600/='],
      ['Yara','Doctor Rob','Mr. Peter','Lab 01','Lipid Profile','2025-11-19','COMPLETED','Rs. 4,200/=','Rs. 180/=','Rs. 4,380/='],
      ['Zack','Doctor Lee','Mr. Kevin','Lab 03','Allergy IgE','2025-11-21','PENDING','Rs. 2,300/=','Rs. 100/=','Rs. 2,400/='],
      ['Aaron','Doctor Ben','Mr. Smith','Lab 04','Hormone Panel','2025-11-22','COMPLETED','Rs. 5,700/=','Rs. 250/=','Rs. 5,950/='],
      ['Bella','Doctor Rob','Mrs. Spencer','Lab 02','Cancelled Sample','2025-11-21','CANCELLED','-','-','-']
    );

        // For lab, date column is Result Date at index 5, doctor column index 1
        const dateIdx = 5, docIdx = 1;
        const filtered = allRows.filter(r => doctors.includes(r[docIdx]) && withinRange(r[dateIdx], start, end));
  renderRows(filtered);
        renderedCount = filtered.length;

      } else if (type === 'payments') {
        // allRows.push(
        //   ['Dr. Lee', 'General', 'General consultation', 'Alex', 'Rs. 9,200/=', '33%', 'Rs. 3,036/=', 'Rs. 6,164/=', '2025-11-11', 'PAID'],
        //   ['Dr. Rob', 'Cardiology', 'ECG Test', 'Charles', 'Rs. 6,500/=', '30%', 'Rs. 1,950/=', 'Rs. 4,550/=', '2025-11-11', 'PENDING'],
        //   ['Dr. Lee', 'Pediatrics', 'Vaccination', 'Lucy', 'Rs. 2,000/=', '40%', 'Rs. 800/=', 'Rs. 1,200/=', '2025-11-12', 'PENDING'],
        //   ['Dr. Ben', 'General', 'Minor Procedure', 'Ethan', 'Rs. 4,200/=', '35%', 'Rs. 1,470/=', 'Rs. 2,730/=', '2025-11-12', 'PENDING'],
        //   ['Dr. Rob', 'Orthopedics', 'X-Ray', 'Clara', 'Rs. 5,200/=', '25%', 'Rs. 1,300/=', 'Rs. 3,900/=', '2025-11-11', 'PAID'],
        //   ['Dr. Lee', 'Neurology', 'Scan', 'Steve', 'Rs. 23,000/=', '35%', 'Rs. 8,050/=', 'Rs. 14,950/=', '2025-11-12', 'PENDING'],
        //   ['Dr. Ben', 'General', 'Consultation', 'Amanda', 'Rs. 0/=', '0%', 'Rs. 0/=', 'Rs. 0/=', '-', 'CANCELLED'],
        //   ['Dr. Lee', 'General', 'Follow-up', 'Diana', 'Rs. 3,500/=', '33%', 'Rs. 1,155/=', 'Rs. 2,345/=', '2025-11-11', 'PAID'],
        //   ['Dr. Ben', 'Imaging', 'MRI (referral)', 'Fiona', 'Rs. 19,000/=', '40%', 'Rs. 7,600/=', 'Rs. 11,400/=', '2025-11-13', 'PAID'],
        //   ['Dr. Rob', 'General', 'Consultation', 'George', 'Rs. 2,700/=', '30%', 'Rs. 810/=', 'Rs. 1,890/=', '2025-11-11', 'PAID']
        // );

        allRows.push(
      ['Doctor Lee','General', 'General consultation','Alex','Rs. 9,200/=','33%','Rs. 3,036/=','Rs. 6,164/=','2025-11-11','PAID'],    
      ['Doctor Rob','Cardiology','ECG Test','Charles','Rs. 6,500/=','30%','Rs. 1,950/=','Rs. 4,550/=','2025-11-11','PENDING'],
      ['Doctor Lee','Pediatrics','Vaccination','Lucy','Rs. 2,000/=','40%','Rs. 800/=','Rs. 1,200/=','2025-11-12','PENDING'],
      ['Doctor Ben','General','Minor Procedure','Ethan','Rs. 4,200/=','35%','Rs. 1,470/=','Rs. 2,730/=','2025-11-12','PENDING'],
      ['Doctor Rob','Orthopedics','X-Ray','Clara','Rs. 5,200/=','25%','Rs. 1,300/=','Rs. 3,900/=','2025-11-11','PAID'],
      ['Doctor Lee','Neurology','Scan','Steve','Rs. 23,000/=','35%','Rs. 8,050/=','Rs. 14,950/=','2025-11-12','PENDING'],
      ['Doctor Ben','General','Consultation','Amanda','Rs. 0/=','0%','Rs. 0/=','Rs. 0/=', '-','CANCELLED'],
      ['Doctor Lee','General','Follow-up','Diana','Rs. 3,500/=','33%','Rs. 1,155/=','Rs. 2,345/=','2025-11-11','PAID'],
      ['Doctor Ben','Imaging','MRI (referral)','Fiona','Rs. 19,000/=','40%','Rs. 7,600/=','Rs. 11,400/=','2025-11-13','PAID'],
      ['Doctor Rob','General','Consultation','George','Rs. 2,700/=','30%','Rs. 810/=','Rs. 1,890/=','2025-11-11','PAID'],
      ['Doctor Ben','General','Checkup','Hannah','Rs. 2,400/=','33%','Rs. 792/=','Rs. 1,608/=','2025-11-14','PENDING'],
      ['Doctor Lee','Cardiology','Angio Follow-up','Ian','Rs. 5,000/=','30%','Rs. 1,500/=','Rs. 3,500/=','2025-11-13','PAID'],
      ['Doctor Rob','ENT','Ear Cleaning','Jade','Rs. 1,200/=','30%','Rs. 360/=','Rs. 840/=','2025-11-14','PENDING'],
      ['Doctor Ben','General','Minor Procedure','Kyle','Rs. 2,800/=','35%','Rs. 980/=','Rs. 1,820/=','2025-11-14','PAID'],
      ['Doctor Lee','Gynae','Antenatal Visit','Lina','Rs. 1,500/=','30%','Rs. 450/=','Rs. 1,050/=','2025-11-15','PAID'],
      ['Doctor Rob','Orthopedics','Fracture Review','Mike','Rs. 3,300/=','30%','Rs. 990/=','Rs. 2,310/=','2025-11-15','PENDING'],
      ['Doctor Lee','Cardiology','ECG','Nora','Rs. 2,200/=','30%','Rs. 660/=','Rs. 1,540/=','2025-11-16','PAID'],
      ['Doctor Ben','Imaging','Ultrasound','Oscar','Rs. 3,800/=','35%','Rs. 1,330/=','Rs. 2,470/=','2025-11-16','PENDING'],
      ['Doctor Rob','General','Bone Density','Paula','Rs. 4,000/=','30%','Rs. 1,200/=','Rs. 2,800/=','2025-11-17','PAID'],
      ['Doctor Lee','General','Walk-in','Quinn','Rs. 900/=','25%','Rs. 225/=','Rs. 675/=','2025-11-17','PENDING'],
      ['Doctor Ben','General','Wellness','Rita','Rs. 6,200/=','35%','Rs. 2,170/=','Rs. 4,030/=','2025-11-18','PAID'],
      ['Doctor Rob','Lab Referral','Drug Screen','Sam','Rs. 1,700/=','30%','Rs. 510/=','Rs. 1,190/=','2025-11-18','PENDING'],
      ['Doctor Lee','Infectious','Viral Consult','Tina','Rs. 1,100/=','30%','Rs. 330/=','Rs. 770/=','2025-11-19','PAID'],
      ['Doctor Ben','Cardiac','Cardiac Panel','Uma','Rs. 4,900/=','35%','Rs. 1,715/=','Rs. 3,185/=','2025-11-19','PAID'],
      ['Doctor Rob','Imaging','MRI Review','Victor','Rs. 3,600/=','30%','Rs. 1,080/=','Rs. 2,520/=','2025-11-20','PENDING'],
      ['Doctor Lee','General','Rapid Test','Wendy','Rs. 2,100/=','33%','Rs. 693/=','Rs. 1,407/=','2025-11-19','PAID'],
      ['Doctor Ben','Imaging','CT Scan','Xavier','Rs. 12,000/=','35%','Rs. 4,200/=','Rs. 7,800/=','2025-11-21','PENDING'],
      ['Doctor Rob','Cardiology','Lipid Counselling','Yara','Rs. 1,600/=','30%','Rs. 480/=','Rs. 1,120/=','2025-11-20','PAID'],
      ['Doctor Lee','ENT','Allergy Visit','Zack','Rs. 2,900/=','30%','Rs. 870/=','Rs. 2,030/=','2025-11-21','PENDING'],
      ['Doctor Ben','Endocrine','Hormone Consult','Aaron','Rs. 3,300/=','35%','Rs. 1,155/=','Rs. 2,145/=','2025-11-22','PAID'],
      ['Doctor Rob','General','Cancelled Visit','Bella','Rs. 0/=','0%','Rs. 0/=','Rs. 0/=', '-','CANCELLED']
    );

        // For payments, payment date index 8, doctor index 0
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
      const doctors = Array.from(document.querySelectorAll('input[name="reportDoctor"]:checked')).map(d=>d.value);
      if (doctors.length === 0) return { ok:false, message:'Select at least one doctor' };
      const start = reportStartInput?.value;
      const end = reportEndInput?.value;
      if (!start || !end) return { ok:false, message:'Select start and end dates' };
      if (start > end) return { ok:false, message:'Start date cannot be after end date' };
      return { ok:true, type, doctors, start, end };
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
    document.querySelectorAll('input[name="reportDoctor"]').forEach(cb => cb.addEventListener('change', ()=> {
      if (reportTableWrapper) reportTableWrapper.classList.add('hidden');
      reportMeta && reportMeta.classList.add('hidden');
      reportActions && reportActions.classList.add('hidden');
    }));
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



  // ---------- rendering ----------
  function renderAppointmentsTable() {
    const q = (searchInput.value || '').trim().toLowerCase();
    const rows = appointments.filter(a => {
      if (!q) return true;
      const assistanceStr = Array.isArray(a.assistance) ? a.assistance.join(', ').toLowerCase() : String(a.assistance || '').toLowerCase();
      // build a searchable date/time string using the same formatting as display plus raw values for flexibility
      const dateTimeDisplay = formatDateTime(a.apptDate, a.apptTime).toLowerCase();
      const rawDate = (a.apptDate || '').toLowerCase();
      const rawTime = (a.apptTime || '').toLowerCase();
      return (
        (a.patientName && a.patientName.toLowerCase().includes(q)) ||
        (a.doctor && a.doctor.toLowerCase().includes(q)) ||
        (a.contactNumber && String(a.contactNumber).toLowerCase().includes(q)) ||
        (a.gender && String(a.gender).toLowerCase().includes(q)) ||
        (assistanceStr && assistanceStr.includes(q)) ||
        (dateTimeDisplay && dateTimeDisplay.includes(q)) ||
        (rawDate && rawDate.includes(q)) ||
        (rawTime && rawTime.includes(q))
      );
    }).sort(compareAppointments);
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
        <td>${escapeHtml(dateTime)}</td>
        <td>${escapeHtml(a.doctor || '')}</td>
        <td>${escapeHtml(a.contactNumber || '')}</td>
        <td>${escapeHtml(a.gender || '')}</td>
        <td>${escapeHtml(assistanceDisplay)}</td>

        <td>
            <div class="row-actions">
                <button class="action-icon-btn notify-btn" data-ref="${a.ref}" voice.name="remainder" title="Toggle Notification">
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
      nb.addEventListener('click', (ev) => {
        // simple UI toggle for bell state
        nb.classList.toggle('active');
        showToast('Notification toggled (UI only)');
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

  // Sort by patient name (A→Z, case-insensitive), then by appointment date (YYYY-MM-DD),
  // then by time to stabilize, then by ref as a final tiebreaker.
  function compareAppointments(a, b){
    const nameA = (a.patientName || '').trim().toLowerCase();
    const nameB = (b.patientName || '').trim().toLowerCase();
    const nameCmp = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    if (nameCmp !== 0) return nameCmp;
    const dA = (a.apptDate || '');
    const dB = (b.apptDate || '');
    if (dA < dB) return -1;
    if (dA > dB) return 1;
    const tA = (a.apptTime || '');
    const tB = (b.apptTime || '');
    if (tA < tB) return -1;
    if (tA > tB) return 1;
    return String(a.ref || '').localeCompare(String(b.ref || ''));
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
    const gender = (appointmentForm.querySelector('input[name="gender"]:checked') || {}).value || '';
    const notes = document.getElementById('notes').value.trim();

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
      const newApp = makeAppointmentObject(patientName, contactNumber, apptDate, apptTime, doctor, gender, assists, notes);
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
    document.getElementById('doctorSelect').value = app.doctor || '';
    document.getElementById('notes').value = app.notes || '';

    // gender
    const genderInput = appointmentForm.querySelector(`input[name="gender"][value="${app.gender || 'Male'}"]`);
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
  function makeAppointmentObject(patientName, contactNumber, apptDate, apptTime, doctor, gender, assistances, notes) {
    return {
      ref: makeRef(),
      patientName,
      contactNumber,
      apptDate,
      apptTime,
      doctor,
      gender,
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

  // Dummy function for the `onclick` attributes in the HTML.
    // The main logic is handled by `attachTabListeners`.

    // function openTab(tabId) {
    //     document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    //     document.querySelector(`.tab-btn[data-tab="${tabId}"]`).classList.add('active');
    //     document.querySelectorAll('.page > div, .page > form').forEach(page => page.classList.add('hidden'));
    //     document.getElementById(`${tabId}-page`).classList.remove('hidden');
    // }

});
