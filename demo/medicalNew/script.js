document.addEventListener('DOMContentLoaded', async () => {
  // ---------- app state ----------
  const STORAGE_KEY = 'clinic_appointments_v1';
  let appointments = [];
  let editingRef = null;

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
  if (!Array.isArray(appointments) || appointments.length === 0) {
    try {
      const json = await loadFromJsonFile();
      if (Array.isArray(json) && json.length) {
        appointments = json;
        saveAppointments();
      }
    } catch (e) {
      console.warn('Failed to load appointments.json, using minimal seed', e);
      appointments = [
        makeAppointmentObject('Sample Patient', '0700000000', '2025-11-20', '09:00', 'Dr. Rob', 'Male', [], 'Demo record')
      ];
      saveAppointments();
    }
  }
  renderAppointmentsTable();
  showTab('appointments');

  // Guard for VoiceKom initialization (if voicekom not loaded, don't crash)
  if (window.VoiceKom && typeof VoiceKom.init === 'function') {
    VoiceKom.init({
      wakeWords: ['Hello', 'Hi', 'start'],
      sleepWords: ['Stop listening', 'stop'],
      containerId: 'speech-container',
      lang: 'en-US',
    transcription: {
      provider: 'default',
      apiKey: '' 
    },
    recognition: {
      provider: 'default',
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
      renderAppointmentsTable();
    });

    // pagination UI (non-functional placeholders)
    document.getElementById('itemsPerPage').addEventListener('change', () => {
      // UI currently non-functional; could persist choice
      showToast('Items per page changed (UI only)');
    });

    document.getElementById('prevPage').addEventListener('click', () => {
      showToast('Previous page (not implemented)');
    });

    document.getElementById('nextPage').addEventListener('click', () => {
      showToast('Next page (not implemented)');
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

    const REPORT_COLUMNS = {
      patients: [
        'Patient Name','Patient Contact','Age','Gender',
        'Appointment Time','Appointment Date','Doctor name',
        'Room Number','Status','Consultation Fee','Payment'
      ],
      lab: [
        'Patient Name','Doctor (referred to lab)','Lab Operator','Lab Number',
        'Tests','Sampled Date','Result Date','Status',
        'Test Cost','Lab maintenance cost','Total cost'
      ],
      payments: [
        'Doctor Name','Specialization','Service Date','Service Name',
        'Patient Name','Amount charged (patient)','Doctor commission',
        'Doctor payout','Hospital payout','Payment date','Status'
      ]
    };

    function getSelectedReportType(){
      const r = document.querySelector('input[name="reportType"]:checked');
      let v = (r && r.value) ? String(r.value).trim().toLowerCase() : '';
      return REPORT_COLUMNS[v] ? v : '';
    }

    function renderDemoReport(type){
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

      // one demo row depending on type
      reportTbody.innerHTML = '';
      let cells = [];
      if (type === 'patients') {
        cells = [
          'Alex','94767789188','23','Male','09:00','2025-11-06','Dr. David','Room 01',
          '<span class="pill status-completed">COMPLETED</span>',
          'Rs. 2,000/=','<span class="pill pay-paid">PAID</span>'
        ];

      } else if (type === 'lab') {
        cells = [
          'Alex','Dr. David','Dr. Kevin','Lab 04','NS1 Antigen, Antibodies','2025-11-06','2025-11-10',
          '<span class="pill status-completed">COMPLETED</span>','Rs. 7,000/=','Rs. 200/=','Rs. 7,200/='
        ];

      } else if (type === 'payments') {
        cells = [
          'Dr. David','General','2025-11-06','General consultation','Alex','Rs. 9,200/=',
          '33%','Rs. 3,000/=','Rs. 6,000/=','2025-11-11','<span class="pill pay-paid">PAID</span>'
        ];
      }

      const tr = document.createElement('tr');
      cells.forEach(html => {
        const td = document.createElement('td');
        td.innerHTML = html;
        tr.appendChild(td);
      });
      reportTbody.appendChild(tr);

      // meta info
      if (reportMeta){
        reportMeta.classList.remove('hidden');
        reportMeta.innerHTML = `<div>Report Type: <strong>${type.charAt(0).toUpperCase()+type.slice(1)}</strong></div>`;
        // reportMeta.innerHTML = `<div>Report Type: <strong>${type.charAt(0).toUpperCase()+type.slice(1)}</strong></div><div class="badges"><span class="pill">1 DEMO ROW</span></div>`;
      }
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
      renderDemoReport(v.type);
      if (reportTableWrapper) reportTableWrapper.classList.remove('hidden');
      showToast('Report generated (0 rows)');
    });

    // Changing report type hides existing table until regenerated
    reportTypeRadios.forEach(r => r.addEventListener('change', ()=> {
      if (reportTableWrapper) reportTableWrapper.classList.add('hidden');
      reportMeta && reportMeta.classList.add('hidden');
    }));
    document.querySelectorAll('input[name="reportDoctor"]').forEach(cb => cb.addEventListener('change', ()=> {
      if (reportTableWrapper) reportTableWrapper.classList.add('hidden');
      reportMeta && reportMeta.classList.add('hidden');
    }));
    reportStartInput && reportStartInput.addEventListener('change', ()=> { reportTableWrapper?.classList.add('hidden'); reportMeta && reportMeta.classList.add('hidden'); });
    reportEndInput && reportEndInput.addEventListener('change', ()=> { reportTableWrapper?.classList.add('hidden'); reportMeta && reportMeta.classList.add('hidden'); });

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
    });

    tbody.innerHTML = '';
    if (rows.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="7" style="text-align:center;color:var(--muted);padding:28px 10px">No appointments found</td>`;
      tbody.appendChild(tr);
      return;
    }

    rows.forEach(a => {
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
        <td style="text-align:center"><button class="icon-btn notify-btn" data-ref="${a.ref}" title="Toggle notify">🔔</button></td>
        <td style="text-align:right">
          <div class="row-actions">
            <button class="btn" data-action="edit" data-ref="${a.ref}">Edit</button>
            <button class="btn" data-action="delete" data-ref="${a.ref}" style="border-color: #ffd6d6;">Delete</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

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
    toastEl.style.background = isError ? 'var(--danger)' : '#111';
    toastEl.classList.add('show');
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => {
      toastEl.classList.remove('show');
    }, duration);
  }

  // ---------- modal helpers ----------
  function openDeleteModal(ref, patientName){
    pendingDeleteRef = ref;
    if (deleteModalMessage) deleteModalMessage.textContent = `${escapeHtml(ref)} for ${escapeHtml(patientName)}`;
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
