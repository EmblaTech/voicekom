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
        allRows.push(
          ['Alex', '94767789188', '23', 'Male', '9:00am', '2025-11-06', 'Dr. Lee', 'Room 01', 'COMPLETED', 'Rs. 2,000/=', 'PAID'],
          ['Charles', '94789134261', '47', 'Male', '12:10pm', '2025-11-07', 'Dr. Rob', 'Room 03', 'COMPLETED', 'Rs. 2,300/=', 'PENDING'],
          ['Lucy', '9471568221', '5', 'Female', '3:00pm', '2025-11-07', 'Dr. Lee', 'Room 01', 'COMPLETED', 'Rs. 2,000/=', 'PENDING'],
          ['Amanda', '94715558769', '31', 'Female', '3:45pm', '2025-11-07', 'Dr. Ben', 'Room 03', 'CANCELLED', '-', '-'],
          ['Ben', '0771234567', '31', 'Male', '10:30am', '2025-11-08', 'Dr. Rob', 'Room 02', 'PENDING', 'Rs. 1,500/=', 'PENDING'],
          ['Clara', '0719992211', '28', 'Female', '2:00pm', '2025-11-08', 'Dr. Rob', 'Room 03', 'CANCELLED', '-', '-'],
          ['Diana', '94770011223', '39', 'Female', '11:15am', '2025-11-09', 'Dr. Lee', 'Room 02', 'COMPLETED', 'Rs. 3,500/=', 'PAID'],
          ['Ethan', '94770033445', '52', 'Male', '8:30am', '2025-11-09', 'Dr. Ben', 'Room 01', 'PENDING', 'Rs. 4,200/=', 'PENDING'],
          ['Fiona', '94770055667', '29', 'Female', '4:00pm', '2025-11-10', 'Dr. Lee', 'Room 04', 'COMPLETED', 'Rs. 1,800/=', 'PAID'],
          ['George', '94770077889', '45', 'Male', '9:45am', '2025-11-10', 'Dr. Rob', 'Room 02', 'COMPLETED', 'Rs. 2,700/=', 'PAID']
        );
        const dateIdx = 5, docIdx = 6;
        const filtered = allRows.filter(r => doctors.includes(r[docIdx]) && withinRange(r[dateIdx], start, end));
  renderRows(filtered);
        renderedCount = filtered.length;

      } else if (type === 'lab') {
        allRows.push(
          ['Alex', 'Dr. Lee', 'Mr. Peter', 'Lab 04', 'NS1 Antigen, Antibodies', '2025-11-10', 'COMPLETED', 'Rs. 7,000/=', 'Rs. 200/=', 'Rs. 7,200/='],
          ['Lucy', 'Dr. Lee', 'Mrs. Spencer', 'Lab 04', 'PCR, Rapid Antibodies', '2025-11-11', 'COMPLETED', 'Rs. 7,300/=', 'Rs. 200/=', 'Rs. 7,500/='],
          ['Ethan', 'Dr. Ben', 'Mr. Peter', 'Lab 02', 'Liver Panel', '2025-11-09', 'PENDING', 'Rs. 4,800/=', 'Rs. 250/=', 'Rs. 5,050/='],
          ['Ben', 'Dr. Rob', 'Mrs. Spencer', 'Lab 02', 'Full Blood Count', '2025-11-09', 'PENDING', 'Rs. 3,500/=', 'Rs. 150/=', 'Rs. 3,650/='],
          ['Diana', 'Dr. Lee', 'Mr. Kevin', 'Lab 03', 'Thyroid Profile', '2025-11-10', 'COMPLETED', 'Rs. 2,900/=', 'Rs. 150/=', 'Rs. 3,050/='],
          ['Fiona', 'Dr. Lee', 'Mrs. Spencer', 'Lab 04', 'Rapid Antibodies', '2025-11-10', 'COMPLETED', 'Rs. 1,200/=', 'Rs. 100/=', 'Rs. 1,300/='],
          ['George', 'Dr. Rob', 'Mr. Peter', 'Lab 01', 'Lipid Profile', '2025-11-08', 'COMPLETED', 'Rs. 4,200/=', 'Rs. 180/=', 'Rs. 4,380/='],
          ['Clara', 'Dr. Rob', 'Mr. Peter', 'Lab 01', 'X-Ray (Chest)', '2025-11-08', 'COMPLETED', 'Rs. 2,000/=', 'Rs. 120/=', 'Rs. 2,120/='],
          ['Amanda', 'Dr. Ben', 'Mr. Kevin', 'Lab 04', 'Urine Analysis', '2025-11-07', 'CANCELLED', '-', '-', '-'],
          ['Charles', 'Dr. Rob', 'Mr. Kevin', 'Lab 03', 'ECG Report (Holter)', '2025-11-08', 'COMPLETED', 'Rs. 6,000/=', 'Rs. 300/=', 'Rs. 6,300/=']
        );
        // For lab, date column is Result Date at index 5, doctor column index 1
        const dateIdx = 5, docIdx = 1;
        const filtered = allRows.filter(r => doctors.includes(r[docIdx]) && withinRange(r[dateIdx], start, end));
  renderRows(filtered);
        renderedCount = filtered.length;

      } else if (type === 'payments') {
        allRows.push(
          ['Dr. Lee', 'General', 'General consultation', 'Alex', 'Rs. 9,200/=', '33%', 'Rs. 3,036/=', 'Rs. 6,164/=', '2025-11-11', 'PAID'],
          ['Dr. Rob', 'Cardiology', 'ECG Test', 'Charles', 'Rs. 6,500/=', '30%', 'Rs. 1,950/=', 'Rs. 4,550/=', '2025-11-11', 'PENDING'],
          ['Dr. Lee', 'Pediatrics', 'Vaccination', 'Lucy', 'Rs. 2,000/=', '40%', 'Rs. 800/=', 'Rs. 1,200/=', '2025-11-12', 'PENDING'],
          ['Dr. Ben', 'General', 'Minor Procedure', 'Ethan', 'Rs. 4,200/=', '35%', 'Rs. 1,470/=', 'Rs. 2,730/=', '2025-11-12', 'PENDING'],
          ['Dr. Rob', 'Orthopedics', 'X-Ray', 'Clara', 'Rs. 5,200/=', '25%', 'Rs. 1,300/=', 'Rs. 3,900/=', '2025-11-11', 'PAID'],
          ['Dr. Lee', 'Neurology', 'Scan', 'Steve', 'Rs. 23,000/=', '35%', 'Rs. 8,050/=', 'Rs. 14,950/=', '2025-11-12', 'PENDING'],
          ['Dr. Ben', 'General', 'Consultation', 'Amanda', 'Rs. 0/=', '0%', 'Rs. 0/=', 'Rs. 0/=', '-', 'CANCELLED'],
          ['Dr. Lee', 'General', 'Follow-up', 'Diana', 'Rs. 3,500/=', '33%', 'Rs. 1,155/=', 'Rs. 2,345/=', '2025-11-11', 'PAID'],
          ['Dr. Ben', 'Imaging', 'MRI (referral)', 'Fiona', 'Rs. 19,000/=', '40%', 'Rs. 7,600/=', 'Rs. 11,400/=', '2025-11-13', 'PAID'],
          ['Dr. Rob', 'General', 'Consultation', 'George', 'Rs. 2,700/=', '30%', 'Rs. 810/=', 'Rs. 1,890/=', '2025-11-11', 'PAID']
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
