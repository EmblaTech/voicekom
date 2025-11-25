document.addEventListener('DOMContentLoaded', () => {  
    VoiceKom.init({   
    wakeWords: ['Hello','Hi','start'],
    sleepWords: ['Stop listening', 'stop'],
    containerId: 'speech-container',
    lang: 'en-US', // Set the language

    // transcription: {
    //   provider: 'default',
    //   apiKey: '' 
    // },

    // recognition: {
    //   provider: 'default',
    //   apiKey: '' 
    // },
    speakingThreshold: 0.2, 
    
    // debug: true
  }).then(() => {
    console.log('VoiceKom has been initialized successfully');
  });

  const contactForm = document.querySelector('.appointment-form');

      // Add an event listener to the form for the 'submit' event
      contactForm.addEventListener('submit', (event) => {
        // Prevent the form's default submission action, which reloads the page
        event.preventDefault();
        alert('Appointment created successfully.');
        //contactForm.reset();
      });

});



function rangesOverlap(aStartStr, aEndStr, bStartStr, bEndStr) {
  return !(aEndStr < bStartStr || aStartStr > bEndStr);
}

async function loadData(doctors, startDate, endDate, chosenReportType) {
  const resp = await fetch('./data.json');
  const all = await resp.json();

  const doctorFilterActive = Array.isArray(doctors) && doctors.length > 0;

  const filtered = all.filter(row => {
    if (doctorFilterActive && !doctors.includes(row.doctor)) return false;
    if (!rangesOverlap(row.startDate, row.endDate, startDate, endDate)) return false;
    if (chosenReportType && chosenReportType !== 'All' && row.reportType !== chosenReportType) return false;
    return true;
  });

  renderTable(filtered, startDate, endDate, chosenReportType);
}

function ensureFilteredReportsContainer() {
  let container = document.getElementById('filteredReports');
  if (!container) {
    const reportsNode = document.getElementById('reports');
    if (reportsNode) {
      container = document.createElement('div');
      container.id = 'filteredReports';
      reportsNode.parentNode.insertBefore(container, reportsNode);
      container.appendChild(reportsNode);
    } else {
      container = document.createElement('div');
      container.id = 'filteredReports';
      document.body.insertBefore(container, document.body.firstChild);
    }
  }
  return container;
}

function ensureTableStructure() {
  const container = ensureFilteredReportsContainer();

  let table = container.querySelector('table');
  if (!table) {
    table = document.createElement('table');
    table.setAttribute('border', '1');
    table.style.width = '100%';
    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th>ID</th>
        <th>Doctor Name</th>
        <th>Report Type</th>
        <th>Period</th>
        <th id="dynamicHeader">Metric</th>
      </tr>
    `;
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    tbody.id = 'reportTableBody';
    table.appendChild(tbody);
    container.appendChild(table);
  } else {
    let tbody = table.querySelector('tbody');
    if (!tbody) {
      tbody = document.createElement('tbody');
      tbody.id = 'reportTableBody';
      table.appendChild(tbody);
    } else if (!tbody.id) {
      tbody.id = 'reportTableBody';
    }
    let dyn = table.querySelector('#dynamicHeader');
    if (!dyn) {
      const th = document.createElement('th');
      th.id = 'dynamicHeader';
      th.textContent = 'Metric';
      const headerRow = table.querySelector('thead tr');
      if (headerRow) headerRow.appendChild(th);
    }
  }

  return {
    container,
    table,
    tbody: table.querySelector('#reportTableBody'),
    dynamicHeaderEl: table.querySelector('#dynamicHeader')
  };
}

function aggregateByDoctor(rows, chosenReportType) {
  const map = new Map();

  rows.forEach(r => {
    const d = r.doctor || 'Unknown';
    if (!map.has(d)) {
      map.set(d, {
        doctor: d,
        visits: 0,
        uniquePatients: new Set(),
        totalRevenue: 0,
        testsSet: new Set()
      });
    }
    const agg = map.get(d);

    if (r.reportType === 'Patients') {
      agg.visits += 1;
      if (r.patientName) agg.uniquePatients.add(r.patientName);
    }

    if (r.reportType === 'Revenue') {
      const num = Number(r.amount) || 0;
      agg.totalRevenue += num;
      if (r.patientName) agg.uniquePatients.add(r.patientName);
    }

    if (r.reportType === 'Tests') {
      if (r.testName) agg.testsSet.add(r.testName);
      if (r.patientName) agg.uniquePatients.add(r.patientName);
    }
  });

  const result = Array.from(map.values()).map(item => ({
    doctor: item.doctor,
    visits: item.visits,
    uniquePatientsCount: item.uniquePatients.size,
    totalRevenue: item.totalRevenue,
    tests: Array.from(item.testsSet)
  }));

  return result;
}

function renderTable(rows, selStart, selEnd, chosenReportType) {
  console.log('[report] grouped renderTable called, rows length =', rows ? rows.length : 0);

  const refs = ensureTableStructure();
  const tbody = refs.tbody;
  const container = refs.container;
  const dynamicHeaderEl = refs.dynamicHeaderEl;

  container.style.display = 'block';

  let dynamicHeaderText;
  if (chosenReportType === 'Revenue') dynamicHeaderText = 'Revenue Generated';
  else if (chosenReportType === 'Patients') dynamicHeaderText = 'Patients Visited';
  else if (chosenReportType === 'Tests') dynamicHeaderText = 'Tests Done';
  else dynamicHeaderText = 'Metric';

  if (dynamicHeaderEl) dynamicHeaderEl.textContent = dynamicHeaderText;

  const grouped = aggregateByDoctor(rows, chosenReportType);
  tbody.innerHTML = '';

  if (!grouped || grouped.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="5">No matching records found for selected doctors and period (${selStart} → ${selEnd}).</td>`;
    tbody.appendChild(tr);
    renderSummary(rows || [], chosenReportType);
    console.log('[report] rendered grouped empty row');
    return;
  }

  grouped.forEach((g, idx) => {
    let metricText = '';
    if (chosenReportType === 'Revenue') {
      metricText = g.totalRevenue ? Number(g.totalRevenue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';
      metricText = `LKR ${metricText}`;
    } else if (chosenReportType === 'Patients') {
      metricText = `${g.visits}`;
      if (g.uniquePatientsCount && g.uniquePatientsCount !== g.visits) {
        metricText += ` (unique: ${g.uniquePatientsCount})`;
      }
    } else if (chosenReportType === 'Tests') {
      metricText = g.tests.length ? g.tests.join(', ') : '—';
    } else {
      const parts = [];
      if (g.visits) parts.push(`Visits:${g.visits}`);
      if (g.tests && g.tests.length) parts.push(`Tests:${g.tests.length}`);
      if (g.totalRevenue) parts.push(`Rev:LKR ${g.totalRevenue.toFixed(2)}`);
      metricText = parts.join(' • ') || '—';
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${g.doctor}</td>
      <td>${chosenReportType}</td>
      <td>${selStart} to ${selEnd}</td>
      <td>${metricText}</td>
    `;
    tbody.appendChild(tr);
  });

  renderSummary(rows, chosenReportType);
  console.log('[report] grouped table populated with', tbody.children.length, 'rows');
}

function renderSummary(rows, chosenReportType) {
  const summaryId = 'reportSummary';
  const refs = ensureTableStructure();
  const container = refs.container;

  let summaryEl = document.getElementById(summaryId);
  if (!summaryEl) {
    summaryEl = document.createElement('div');
    summaryEl.id = summaryId;
    const tableEl = container.querySelector('table');
    if (tableEl && tableEl.parentNode === container) container.insertBefore(summaryEl, tableEl);
    else container.prepend(summaryEl);
  }
}

function generateReports() {
  const checked = document.querySelectorAll('#reports input[name="doctor"]:checked');
  const doctors = Array.from(checked).map(c => c.value).filter(Boolean);

  const startInput = document.getElementById('reportStartDate');
  const endInput = document.getElementById('reportEndDate');
  const startDate = startInput ? startInput.value : '';
  const endDate = endInput ? endInput.value : '';

  const r = document.querySelector('input[name="report type"]:checked');
  const chosenReportType = r ? r.value : 'All';

  if (!startDate || !endDate) { alert('Select start and end dates'); return; }
  if (startDate > endDate) { alert('Start date cannot be after end date'); return; }
  if (doctors.length === 0) { alert('Select at least one doctor'); return; }

  loadData(doctors, startDate, endDate, chosenReportType);
}

// ====== PDF DOWNLOAD ======
// function downloadReportPDF() {
//   const table = document.querySelector('#filteredReports table');
//   if (!table) {
//     alert('No report data to export.');
//     return;
//   }

//   // Use jsPDF (you must include this library via CDN in your HTML)
//   const { jsPDF } = window.jspdf;
//   const doc = new jsPDF();

//   doc.setFontSize(14);
//   doc.text('Filtered Reports', 14, 15);

//   // Extract table content
//   const rows = [];
//   const headers = [];
//   table.querySelectorAll('thead th').forEach(th => headers.push(th.innerText.trim()));

//   table.querySelectorAll('tbody tr').forEach(tr => {
//     const rowData = [];
//     tr.querySelectorAll('td').forEach(td => rowData.push(td.innerText.trim()));
//     rows.push(rowData);
//   });

//   // Use autoTable plugin (add this script in HTML too)
//   if (doc.autoTable) {
//     doc.autoTable({
//       head: [headers],
//       body: rows,
//       startY: 25,
//       theme: 'grid'
//     });
//   } else {
//     doc.text('autoTable plugin not found. Please add jsPDF autotable script.', 14, 25);
//   }

//   doc.save('report.pdf');
// }

function downloadReportPDF() {
  const table = document.querySelector('#filteredReports table');
  if (!table) {
    alert('No report data to export.');
    return;
  }

  const reportType = document.querySelector('input[name="reportType"]:checked')?.value || 'report';

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(14);
  doc.text(`Filtered ${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Report`, 14, 15);

  const headers = [];
  const rows = [];

  table.querySelectorAll('thead th').forEach(th => headers.push(th.innerText.trim()));
  table.querySelectorAll('tbody tr').forEach(tr => {
    const rowData = [];
    tr.querySelectorAll('td').forEach(td => rowData.push(td.innerText.trim()));
    rows.push(rowData);
  });

  if (doc.autoTable) {
    doc.autoTable({
      head: [headers],
      body: rows,
      startY: 25,
      theme: 'grid'
    });
  }

  const pdfBlob = doc.output('blob');
  const pdfUrl = URL.createObjectURL(pdfBlob);

  // Open in new tab
  window.open(pdfUrl, '_blank');

  // Auto download after short delay
  setTimeout(() => {
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = `${reportType}_report.pdf`;
    a.click();
  }, 800);
}

// expose for debugging if needed
// window.loadData = loadData;
// window.generateReports = generateReports;
