let invoices = [];

function getNextInvoiceNumber() {
  if (!invoices || invoices.length === 0) {
    return 'INV-1001'; // Starting point if no invoices exist
  }

  // Extract numeric parts and find max
  const maxId = Math.max(...invoices.map(inv => {
    const match = inv.id.match(/\d+$/);
    return match ? parseInt(match[0]) : 0;
  }));

  const nextNumber = maxId + 1;
  return `INV-${nextNumber}`;
}

function setPaymentMode(paymentMode) {
  const radio = document.querySelector(`input[name="payment-mode"][id="${paymentMode}"]`);
  if (radio) {
    radio.checked = true;
  }
}

function showForm(index = null) {
  // --- 1. Common setup for both modes ---
  document.getElementById('invoice-form-section').style.display = 'block';
  document.getElementById('invoice-list-container').style.display = 'none';
  document.getElementById('invoice-form').reset();
  renderCustomerOptions(); // Populate the customer dropdown once for both modes

  if (index !== null) {
      // --- 2. EDIT MODE ---
      document.getElementById('invoice-form-section').querySelector('.card-header h4').textContent = "Edit Invoice";
      
      // <<< THE CRITICAL FIX IS HERE >>>
      // We must set the hidden index so the form knows which invoice to update upon submission.
      document.getElementById('invoice-index').value = index; 

      const invoice = invoices[index];
      document.getElementById('invoice-no').value = invoice.id;

      let selectedCustomer = customers.find(c => c.name === invoice.customer);
      if (selectedCustomer) {
          document.getElementById('customer-select').value = selectedCustomer.id;
          handleCustomerChange({ target: document.getElementById('customer-select') }); // Populate related fields
      }
      document.getElementById('date').value = invoice.date ? invoice.date : '';
      setPaymentMode(invoice.paymentMode || 'cash');

      const deliveryModes = invoice.deliveryModes || [];
      document.querySelectorAll('input[type="checkbox"].invoice-delivery').forEach(cb => {
          cb.checked = deliveryModes.includes(cb.value);
      });
      document.getElementById('due-date').value = invoice.dueDate ? invoice.dueDate : '';
      document.getElementById('due-time').value = invoice.dueTime ? invoice.dueTime : '';

      populateItemRows(invoice.items);
      document.getElementById('discount').value = invoice.discount || 0;
      calculateTotals();

  } else {
      // --- 3. ADD NEW MODE ---
      document.getElementById('invoice-form-section').querySelector('.card-header h4').textContent = "New Invoice";
      
      // <<< GOOD PRACTICE: Explicitly clear the index >>>
      document.getElementById('invoice-index').value = ''; 

      document.getElementById('invoice-no').value = getNextInvoiceNumber();
      renderItemRow(5);
      calculateTotals();
  }

  // --- 4. Common event binding for both modes ---
  bindEvents();
}


function populateItemRows(invoiceItems = []) {
  const tbody = document.getElementById('invoice-item-body');
  tbody.innerHTML = ''; // Clear existing rows

  if (invoiceItems.length === 0) {
      // If an old invoice has no items, render a few empty rows
      renderItemRow(5);
      return;
  }

  invoiceItems.forEach(item => {
      const tr = document.createElement('tr');
      // Create the row HTML with options
      tr.innerHTML = `
    <td>
      <select class="form-select item-select">
        <option value="">-- Select Item --</option>
        ${items.map(i => `<option value="${i.id}" data-price="${i.unitPrice}">${i.name}</option>`).join('')}
      </select>
    </td>
    <td><input type="number" class="form-control qty" min="1"></td>
    <td><input type="number" class="form-control price" readonly></td>
    <td><input type="number" class="form-control amount" readonly></td>
  `;
      tbody.appendChild(tr);

      // --- Set the saved values for the row ---
      tr.querySelector('.item-select').value = item.itemId;
      tr.querySelector('.qty').value = item.quantity;
      tr.querySelector('.price').value = item.unitPrice.toFixed(2);
      tr.querySelector('.amount').value = item.amount.toFixed(2);


      // --- Re-attach event listeners for this dynamic row ---
      const select = tr.querySelector('.item-select');
      const qtyInput = tr.querySelector('.qty');
      const priceInput = tr.querySelector('.price');
      const amountInput = tr.querySelector('.amount');

      function updateAmount() {
          const price = parseFloat(priceInput.value) || 0;
          const qty = parseInt(qtyInput.value) || 0;
          amountInput.value = (price * qty).toFixed(2);
          calculateTotals(); // Recalculate totals whenever a row changes
      }

      select.addEventListener('change', () => {
          const selectedOption = select.options[select.selectedIndex];
          const unitPrice = selectedOption.dataset.price;
          priceInput.value = unitPrice ? parseFloat(unitPrice).toFixed(2) : '';
          updateAmount();
      });

      qtyInput.addEventListener('input', updateAmount);
  });
}

function hideForm() {
  document.getElementById('invoice-list-container').style.display = 'block';
  document.getElementById('invoice-form-section').style.display = 'none';
}

function bindEvents() {
  document.getElementById('customer-select').addEventListener('change', handleCustomerChange);
  document.getElementById('discount').addEventListener('input', calculateTotals);
}

function renderCustomerOptions() {
  const select = document.getElementById('customer-select');

  customers.forEach(customer => {
    const opt = document.createElement('option');
    opt.value = customer.id;
    opt.textContent = `${customer.name}`;
    opt.dataset.email = customer.email;
    opt.setAttribute('voice.name', customer.name);
    select.appendChild(opt);
  });
}

function renderItemRow(rows = 1) {
  const tbody = document.getElementById('invoice-item-body');
  for (let i = 0; i < rows; i++) {
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td>
        <select class="form-select item-select" voice.name="invoice item ${i+1}">
          <option value="">-- Select Item --</option>
          ${items.map(item => `<option voice.name="${item.name}" value="${item.id}" data-price="${item.unitPrice}">${item.name}</option>`).join('')}
        </select>
      </td>
      <td><input type="number" class="form-control qty" value="1" min="1"></td>
      <td><input type="number" class="form-control price" readonly></td>
      <td><input type="number" class="form-control amount" readonly></td>
    `;

    tbody.appendChild(tr);

    // Attach event listeners
    const select = tr.querySelector('.item-select');
    const qtyInput = tr.querySelector('.qty');
    const priceInput = tr.querySelector('.price');
    const amountInput = tr.querySelector('.amount');

    function updateAmount() {
      const price = parseFloat(priceInput.value) || 0;
      const qty = parseInt(qtyInput.value) || 0;
      amountInput.value = (price * qty).toFixed(2);
    }

    select.addEventListener('change', () => {
      const selectedOption = select.options[select.selectedIndex];
      const unitPrice = selectedOption.dataset.price;
      priceInput.value = unitPrice || '';
      updateAmount();
      calculateTotals();
    });

    qtyInput.addEventListener('input', updateAmount);    
  }
}

function handleCustomerChange(event) {
  const selected = customers.find(c => c.id == event.target.value);
  if (selected) {
    document.getElementById('email').value = selected.email;
    document.getElementById('phone').value = selected.phone;
    document.getElementById('address').value = selected.address;
  } else {
    document.getElementById('email').value = '';
    document.getElementById('phone').value = '';
    document.getElementById('address').value = '';
  }
}

function getRandomStatus() {
  const statuses = ['Pending', 'Paid', 'Overdue'];
  const randomIndex = Math.floor(Math.random() * statuses.length);
  return statuses[randomIndex];
}

function calculateTotals() {
  const amountInputs = document.querySelectorAll('.amount');
  let gross = 0;

  amountInputs.forEach(input => {
    const val = parseFloat(input.value);
    if (!isNaN(val)) gross += val;
  });

  document.getElementById('gross-total').value = gross.toFixed(2);

  const discountPercent = parseFloat(document.getElementById('discount').value) || 0;
  const discountAmount = gross * (discountPercent / 100);
  const net = gross - discountAmount;
  document.getElementById('net-total').value = (net >= 0 ? net : 0).toFixed(2);
}

function renderInvoices() {
  const tbody = document.getElementById('invoice-list');
  tbody.innerHTML = '';

  invoices.forEach((invoice, index) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${invoice.id}</td>
      <td>${invoice.customer}</td>
      <td>${invoice.date}</td>      
      <td><span class="badge bg-${invoice.status === 'Paid' ? 'success' : invoice.status === 'Pending' ? 'warning text-dark' : 'danger'}">${invoice.status}</span></td>
      <td>Rs. ${invoice.total}</td>
      <td>
        <button voice.name = "edit" class="btn btn-sm" onclick="showForm(${index})"><i class="bi bi-pencil-square text-primary" title="Edit"></i></button>
        <button voice.name = "delete" class="btn btn-sm" onclick="deleteInvoice(${index})"><i class="bi bi-trash text-danger" title="Delete"></i></button>
        <button voice.name = "send email" class="btn btn-sm" onclick="sendEmail('${invoice.customer}')"><i class="bi bi-envelope-fill text-success" title="Email"></i></button>
        <button voice.name = "download" class="btn btn-sm" onclick="downloadPDF('${invoice.id}')"><i class="bi bi-download text-warning" title="Download"></i></button>
      </td> 
    `;
    tbody.appendChild(row);
  });
}

function deleteInvoice(index) {
  if (confirm('Are you sure to delete this invoice?')) {
    invoices.splice(index, 1);
    renderInvoices();
  }
}

function sendEmail(customer) {
    setTimeout(() => {
        alert(`Email sent to ${customer}`);
    }, 2000);
}
  
async function downloadPDF(invoiceId) {
    const row = [...document.querySelectorAll('#invoice-list tr')].find(
      tr => tr.querySelector('td:nth-child(2)').textContent === invoiceId
    );
    if (!row) return;
  
    const id = row.children[1].textContent;
    const customer = row.children[2].textContent;
    const date = row.children[3].textContent;
    const total = row.children[4].textContent;
    const status = row.children[5].textContent;
  
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
  
    doc.setFontSize(16);
    doc.text('Invoice Summary', 20, 20);
  
    doc.setFontSize(12);
    doc.text(`Invoice ID: ${id}`, 20, 40);
    doc.text(`Customer: ${customer}`, 20, 50);
    doc.text(`Date: ${date}`, 20, 60);
    doc.text(`Total: ${total}`, 20, 70);
    doc.text(`Status: ${status}`, 20, 80);
  
    doc.save(`Invoice-${id}.pdf`);
  }

  function getInvoiceDeliveryMethods() {
    const checkboxes = document.querySelectorAll('.invoice-delivery');
    const selected = [];
  
    checkboxes.forEach(cb => {
      if (cb.checked) {
        selected.push(cb.value);
      }
    });  
    return selected;
  }

  function getInvoiceItems() {
    const rows = document.querySelectorAll('#invoice-item-body tr');
    const items = [];
  
    rows.forEach(row => {
      const itemSelect = row.querySelector('.item-select');
      const qtyInput = row.querySelector('.qty');
      const priceInput = row.querySelector('.price');
      const amountInput = row.querySelector('.amount');
  
      items.push({
        itemId: itemSelect.value,
        itemName: itemSelect.options[itemSelect.selectedIndex]?.text || '',
        quantity: parseFloat(qtyInput.value) || 0,
        unitPrice: parseFloat(priceInput.value) || 0,
        amount: parseFloat(amountInput.value) || 0
      });
    });
  
    return items;
  }

  function getPaymentMode() {
    const selected = document.querySelector('input[name="payment-mode"]:checked');
    return selected ? selected.id : null;
  }

document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('invoice-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const index = document.getElementById('invoice-index').value;
    const selectedCustomerId = document.getElementById('customer-select').value;
    const invoice = {
      id: document.getElementById('invoice-no').value,
      customer: customers.find(c => c.id == selectedCustomerId).name,
      date: document.getElementById('date').value,
      total: document.getElementById('net-total').value,
      status: getRandomStatus(),
      paymentMode: getPaymentMode(),
      deliveryModes: getInvoiceDeliveryMethods(),
      dueDate: document.getElementById('due-date').value,
      dueTime: document.getElementById('due-time').value,
      discount: parseFloat(document.getElementById('discount').value) || 0,
      items: getInvoiceItems(),
    };

    if (index !== '') {
      // If index is NOT an empty string, it's an update.
      invoices[parseInt(index)] = invoice;
  } else {
      // If index IS an empty string, it's a new invoice.
      invoices.push(invoice);
  }

    hideForm();
    renderInvoices();
  });

  customers = [
    { id: 1, name: "John Doe", email: "john@example.com", phone: "0771234567", address: "123 Main Street, Colombo 03" },
    { id: 2, name: "Ayesha Silva", email: "ayesha@example.com", phone: "0719876543", address: "45 Lake Road, Kandy" },
    { id: 3, name: "Kumaran Siva", email: "kumar@example.com", phone: "0751122334",  address: "88 Temple Lane, Jaffna" },
    { id: 4, name: "Nimal Fernando", email: "nimal@example.com", phone: "0762233445", address: "12 Beach Road, Negombo" }
  ];

  // Sample initial data
  invoices = [
    { id: 'INV-3056', customer: 'John Traders', date: '2025-07-29', total: '79500', status: 'Paid',discount: 10,
      items: [{
          itemId: 1,
          itemName: "Basmati Rice 5kg",
          quantity: 50,
          unitPrice: 1750,
          amount: 87500
      }] },
    { id: 'INV-3057', customer: 'Galaxy Pvt Ltd', date: '2025-07-30', total: '22000', status: 'Pending',discount: 0,
      items: [{
          itemId: 2,
          itemName: "Eggs - 10 Pack",
          quantity: 44,
          unitPrice: 500,
          amount: 22000
      }] },
    { id: 'INV-3058', customer: 'Oceanic Co.', date: '2025-07-28', total: '150000', status: 'Overdue' },
    { id: 'INV-3059', customer: 'Silverleaf Supplies', date: '2025-07-26', total: '64800', status: 'Paid' },
    { id: 'INV-3060', customer: 'NovaTech', date: '2025-07-25', total: '98300', status: 'Pending' }
  ];

  items = [
    { id: 1, name: "Basmati Rice 5kg", unitPrice: 1750 },
    { id: 2, name: "Eggs - 10 Pack", unitPrice: 500 },
    { id: 3, name: "Toothpaste 100g", unitPrice: 140 },
    { id: 4, name: "Shampoo 180ml", unitPrice: 320 },
    { id: 5, name: "Hand Sanitizer 200ml", unitPrice: 275 },
    { id: 6, name: "Tissue Box - 200 Sheets", unitPrice: 180 },
    { id: 7, name: "Notebook A5 - 100 Pages", unitPrice: 120 },
    { id: 8, name: "Ballpoint Pen (Blue)", unitPrice: 30 },
];

  renderInvoices();
});
