import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onChildAdded, get, child, update, remove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// 1. Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyA8IO9dpmxc1sBv5eANKQSjnPDW_KSASBM",
  authDomain: "rfid-absensi-5de41.firebaseapp.com",
  databaseURL: "https://rfid-absensi-5de41-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "rfid-absensi-5de41",
  storageBucket: "rfid-absensi-5de41.firebasestorage.app",
  messagingSenderId: "10356419141",
  appId: "1:10356419141:web:6cee7c70a80a0ddc9b912c"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// State Counters & Cache Data Mahasiswa
let countHadir = 0;
let countTerlambat = 0;
let countUnknown = 0;
let totalLogs = 0;
let mahasiswaCache = {};

// DOM Elements Reference
const tabLive = document.getElementById('tab-live');
const tabMaster = document.getElementById('tab-master');
const viewLive = document.getElementById('view-live');
const viewMaster = document.getElementById('view-master');

const tableLogBody = document.getElementById('table-log-body');
const tableMhsBody = document.getElementById('table-mhs-body');
const emptyRow = document.getElementById('empty-row');
const inputJamMasuk = document.getElementById('input-jam-masuk');

const regUid = document.getElementById('reg-uid');
const formRegistrasi = document.getElementById('form-registrasi');
const btnExportCsv = document.getElementById('btn-export-csv');
const btnClearLogs = document.getElementById('btn-clear-logs');

// --- 2. NAVIGATION TAB SWITCHING ---
tabLive.addEventListener('click', () => {
  tabLive.classList.add('active');
  tabMaster.classList.remove('active');
  viewLive.classList.remove('hidden');
  viewMaster.classList.add('hidden');
});

tabMaster.addEventListener('click', () => {
  tabMaster.classList.add('active');
  tabLive.classList.remove('active');
  viewMaster.classList.remove('hidden');
  viewLive.classList.add('hidden');
});

// --- 3. FETCH & RENDER DATA MAHASISWA ---
async function loadMahasiswa() {
  try {
    const dbRef = ref(db);
    const snapshot = await get(child(dbRef, 'mahasiswa'));

    tableMhsBody.innerHTML = '';
    mahasiswaCache = {}; // Reset cache

    if (snapshot.exists()) {
      const data = snapshot.val();
      for (const [uid, mhs] of Object.entries(data)) {
        mahasiswaCache[uid] = mhs;

        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-800/50 transition';
        tr.innerHTML = `
          <td class="px-6 py-3 font-mono text-indigo-400 font-bold">${uid}</td>
          <td class="px-6 py-3 font-mono">${mhs.npm || '-'}</td>
          <td class="px-6 py-3 font-semibold text-slate-100">${mhs.nama || '-'}</td>
          <td class="px-6 py-3">${mhs.kelas || '-'}</td>
          <td class="px-6 py-3 text-center">
            <button class="btn-delete-mhs px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition text-[11px] font-semibold flex items-center gap-1 mx-auto" data-uid="${uid}">
              <i class="fa-solid fa-trash-can"></i> Hapus
            </button>
          </td>
        `;
        tableMhsBody.appendChild(tr);
      }
    } else {
      tableMhsBody.innerHTML = '<tr><td colspan="5" class="px-6 py-6 text-center text-slate-500">Belum ada data mahasiswa terdaftar.</td></tr>';
    }
  } catch (err) {
    console.error("Gagal load data mahasiswa:", err);
  }
}

// --- 4. DELEGASI EVENT HAPUS MAHASISWA ---
tableMhsBody.addEventListener('click', async (e) => {
  const btnDelete = e.target.closest('.btn-delete-mhs');
  if (btnDelete) {
    const uid = btnDelete.dataset.uid;
    const confirmDelete = confirm(`Hapus data mahasiswa dengan UID [${uid}]?\nKartu ini akan kembali berstatus UNREGISTERED saat di-tap.`);
    
    if (confirmDelete) {
      try {
        await remove(ref(db, `mahasiswa/${uid}`));
        delete mahasiswaCache[uid];
        alert(`Berhasil menghapus UID [${uid}]!`);
        await loadMahasiswa();
      } catch (err) {
        console.error("Gagal menghapus data:", err);
        alert("Gagal menghapus data dari Firebase.");
      }
    }
  }
});

// --- 5. HAPUS SEMUA LOG ABSENSI (RESET MONITOR) ---
btnClearLogs.addEventListener('click', async () => {
  if (confirm("Apakah lu yakin mau mengosongkan seluruh riwayat log absensi?")) {
    try {
      await remove(ref(db, 'absensi_logs'));
      
      tableLogBody.innerHTML = '<tr id="empty-row"><td colspan="6" class="px-6 py-8 text-center text-slate-500">Menunggu tap kartu dari ESP32...</td></tr>';
      
      countHadir = 0; 
      countTerlambat = 0; 
      countUnknown = 0; 
      totalLogs = 0;
      
      document.getElementById('stat-hadir').innerText = '0';
      document.getElementById('stat-terlambat').innerText = '0';
      document.getElementById('stat-unknown').innerText = '0';
      document.getElementById('log-count').innerText = '0 Log Tercatat';
      
      alert("Seluruh log absensi berhasil dibersihkan!");
    } catch (err) {
      console.error("Gagal reset log:", err);
      alert("Gagal menghapus log dari Firebase.");
    }
  }
});

// --- 6. REAL-TIME LOG LISTENER DARI ESP32 ---
const absensiLogsRef = ref(db, 'absensi_logs');

onChildAdded(absensiLogsRef, (snapshot) => {
  const log = snapshot.val();
  if (!log || !log.card_uid) return;

  const currentEmpty = document.getElementById('empty-row');
  if (currentEmpty && currentEmpty.parentNode) {
    currentEmpty.remove();
  }

  // Auto-Catch UID ke Form Registrasi
  regUid.value = log.card_uid;

  const mhs = mahasiswaCache[log.card_uid];
  
  // SANITISASI TIMESTAMP: Konversi aman ke String apapun tipe data aslinya di Firebase
  let timestampStr = '';
  if (typeof log.timestamp === 'number') {
    timestampStr = new Date(log.timestamp).toLocaleTimeString('id-ID');
  } else if (log.timestamp) {
    timestampStr = String(log.timestamp);
  } else {
    timestampStr = new Date().toLocaleTimeString('id-ID');
  }

  // Ambil Jam dan Menit secara presisi
  let jamTapStr = timestampStr;
  if (timestampStr.includes(' ')) {
    const parts = timestampStr.split(' ');
    jamTapStr = parts[1] || parts[0];
  } else if (timestampStr.includes('T')) {
    jamTapStr = timestampStr.split('T')[1].split('.')[0];
  }
  
  const [jamTap, menitTap] = jamTapStr.split(':').map(Number);
  const [jamMasuk, menitMasuk] = inputJamMasuk.value.split(':').map(Number);
  
  const menitTapTotal = (isNaN(jamTap) ? 0 : jamTap) * 60 + (isNaN(menitTap) ? 0 : menitTap);
  const menitMasukTotal = (isNaN(jamMasuk) ? 8 : jamMasuk) * 60 + (isNaN(menitMasuk) ? 0 : menitMasuk);
  const toleransi = 15;

  let statusBadge = '';
  if (!mhs) {
    statusBadge = `<span class="px-2.5 py-1 rounded-md bg-rose-500/10 text-rose-400 font-bold text-[10px] border border-rose-500/20">UNREGISTERED</span>`;
    countUnknown++;
    document.getElementById('stat-unknown').innerText = countUnknown;
  } else if (menitTapTotal <= (menitMasukTotal + toleransi)) {
    statusBadge = `<span class="px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-400 font-bold text-[10px] border border-emerald-500/20">HADIR</span>`;
    countHadir++;
    document.getElementById('stat-hadir').innerText = countHadir;
  } else {
    statusBadge = `<span class="px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-400 font-bold text-[10px] border border-amber-500/20">TERLAMBAT</span>`;
    countTerlambat++;
    document.getElementById('stat-terlambat').innerText = countTerlambat;
  }

  totalLogs++;
  document.getElementById('log-count').innerText = `${totalLogs} Log Tercatat`;

  const tr = document.createElement('tr');
  tr.className = 'new-log-anim hover:bg-slate-800/50 transition';
  tr.innerHTML = `
    <td class="px-6 py-3.5 font-mono text-slate-400">${timestampStr}</td>
    <td class="px-6 py-3.5 font-mono text-indigo-300 font-bold">${log.card_uid}</td>
    <td class="px-6 py-3.5 font-mono">${mhs ? (mhs.npm || '-') : '-'}</td>
    <td class="px-6 py-3.5 font-semibold text-slate-100">${mhs ? (mhs.nama || 'Kartu Belum Dikenal') : 'Kartu Belum Dikenal'}</td>
    <td class="px-6 py-3.5">${mhs ? (mhs.kelas || '-') : '-'}</td>
    <td class="px-6 py-3.5">${statusBadge}</td>
  `;

  tableLogBody.insertBefore(tr, tableLogBody.firstChild);
});

// --- 7. SUBMIT FORM REGISTRASI MAHASISWA BARU ---
formRegistrasi.addEventListener('submit', async (e) => {
  e.preventDefault();
  const uid = regUid.value.trim();
  const npm = document.getElementById('reg-npm').value.trim();
  const nama = document.getElementById('reg-nama').value.trim();
  const kelas = document.getElementById('reg-kelas').value.trim();

  if (!uid) {
    alert("Tap kartu di ESP32 terlebih dahulu!");
    return;
  }

  try {
    await update(ref(db, `mahasiswa/${uid}`), { npm, nama, kelas });
    alert(`Sukses mendaftarkan ${nama} (${npm})!`);
    
    formRegistrasi.reset();
    await loadMahasiswa();
  } catch (err) {
    console.error("Gagal simpan data:", err);
    alert("Gagal menyimpan data ke Firebase.");
  }
});

// --- 8. EXPORT REKAP KE CSV ---
btnExportCsv.addEventListener('click', () => {
  const rows = document.querySelectorAll('#table-log-body tr');
  if (rows.length === 0 || document.getElementById('empty-row')) {
    alert("Belum ada data absensi buat di-export!");
    return;
  }

  let csvContent = "data:text/csv;charset=utf-8,Waktu Tap,UID Kartu,NPM,Nama,Kelas,Status\n";
  rows.forEach(row => {
    const cols = row.querySelectorAll('td');
    if (cols.length >= 6) {
      const rowData = Array.from(cols).map(c => `"${c.innerText.trim()}"`).join(',');
      csvContent += rowData + "\n";
    }
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `Rekap_Absensi_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

// Load Data Awal saat Halaman Dibuka
loadMahasiswa();