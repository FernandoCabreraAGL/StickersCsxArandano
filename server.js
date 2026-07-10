const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;
const PRINTER_IP = process.env.PRINTER_IP || '192.168.1.24';
const PRINTER_PORT = process.env.PRINTER_PORT || 9100;

let selectedPrinter = { ip: PRINTER_IP, port: PRINTER_PORT };

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: path.join(__dirname, 'uploads'),
  filename: (req, file, cb) => cb(null, 'current_' + Date.now() + '.xlsx')
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ext === '.xlsx' || ext === '.xls');
  }
});

let currentData = [];
let designs = [];

// Cargar diseños al iniciar
function loadDesigns() {
  try {
    const data = fs.readFileSync(path.join(__dirname, 'designs.json'), 'utf8');
    designs = JSON.parse(data).designs || [];
  } catch (err) {
    designs = [];
  }
}

function saveDesigns() {
  fs.writeFileSync(path.join(__dirname, 'designs.json'), JSON.stringify({ designs }, null, 2));
}

loadDesigns();

app.get('/api/designs', (req, res) => {
  res.json(designs);
});

app.post('/api/designs', (req, res) => {
  const { name, description, elements } = req.body;
  const id = `design-${Date.now()}`;
  const newDesign = {
    id,
    name,
    description,
    elements,
    active: false,
    pageWidth: 812,
    pageHeight: 406,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  designs.push(newDesign);
  saveDesigns();
  res.json(newDesign);
});

app.put('/api/designs/:id', (req, res) => {
  const { id } = req.params;
  const { name, description, elements } = req.body;
  const design = designs.find(d => d.id === id);
  if (!design) return res.status(404).json({ error: 'Diseño no encontrado' });

  design.name = name;
  design.description = description;
  design.elements = elements;
  design.updatedAt = new Date().toISOString();
  saveDesigns();
  res.json(design);
});

app.delete('/api/designs/:id', (req, res) => {
  const { id } = req.params;
  designs = designs.filter(d => d.id !== id);
  saveDesigns();
  res.json({ success: true });
});

app.post('/api/designs/:id/duplicate', (req, res) => {
  const { id } = req.params;
  const design = designs.find(d => d.id === id);
  if (!design) return res.status(404).json({ error: 'Diseño no encontrado' });

  const newId = `design-${Date.now()}`;
  const newDesign = {
    ...JSON.parse(JSON.stringify(design)),
    id: newId,
    name: `${design.name} (Copia)`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  designs.push(newDesign);
  saveDesigns();
  res.json(newDesign);
});

app.post('/api/upload', upload.single('excel'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });

  try {
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    currentData = data.map((row, i) => {
      const fecha = row.fecha;
      let fechaStr = '';
      if (fecha instanceof Date) {
        fechaStr = fecha.toISOString().split('T')[0];
      } else if (typeof fecha === 'number') {
        const d = XLSX.SSF.parse_date_code(fecha);
        fechaStr = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
      } else {
        fechaStr = String(fecha || '');
      }

      return {
        id: i + 1,
        codigosenasa: String(row.codigosenasa || ''),
        codigotrabajador: String(row.codigotrabajador || ''),
        nombretrabajador: String(row.nombretrabajador || ''),
        turno: String(row.turno || ''),
        lateral: String(row.lateral || ''),
        lote: String(row.lote || ''),
        grupoVariedad: String(row['grupo variedad'] || ''),
        fecha: fechaStr,
        codigoauxiliar: String(row.codigoauxiliar || ''),
        nombreauxiliar: String(row.nombreauxiliar || ''),
        contador: String(row.contador || ''),
        qr: String(row.qr || '')
      };
    });

    fs.unlink(req.file.path, () => {});

    res.json({
      total: currentData.length,
      sheetName,
      columns: Object.keys(currentData[0] || {}).filter(k => k !== 'id'),
      preview: currentData.slice(0, 50)
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al procesar el archivo: ' + err.message });
  }
});

function scanNetwork(baseIp, port = 9100, timeout = 500) {
  return new Promise((resolve) => {
    const printers = [];
    const lastOctet = baseIp.split('.').slice(0, 3).join('.');
    const promises = [];

    for (let i = 1; i <= 254; i++) {
      const ip = `${lastOctet}.${i}`;
      const promise = new Promise((resolve) => {
        const client = new net.Socket();
        client.setTimeout(timeout);
        client.connect(port, ip, () => {
          printers.push({ ip, port, status: 'online' });
          client.destroy();
          resolve();
        });
        client.on('error', () => resolve());
        client.on('timeout', () => {
          client.destroy();
          resolve();
        });
      });
      promises.push(promise);
    }

    Promise.all(promises).then(() => resolve(printers));
  });
}

function getNetworkBaseIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const addrs = interfaces[name];
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return '192.168.1.1';
}

app.get('/api/detect-printers', async (req, res) => {
  try {
    const baseIp = getNetworkBaseIp();
    const printers = await scanNetwork(baseIp, 9100, 300);
    res.json({ printers, currentIp: baseIp });
  } catch (err) {
    res.status(500).json({ error: 'Error detectando impresoras: ' + err.message });
  }
});

app.post('/api/select-printer', (req, res) => {
  const { ip, port } = req.body;
  if (!ip) return res.status(400).json({ error: 'IP requerida' });
  selectedPrinter = { ip, port: port || 9100 };
  res.json({ success: true, printer: selectedPrinter });
});

app.get('/api/selected-printer', (req, res) => {
  res.json(selectedPrinter);
});

app.get('/api/data', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const search = (req.query.search || '').toLowerCase();

  let filtered = currentData;
  if (search) {
    filtered = currentData.filter(row =>
      Object.values(row).some(v => String(v).toLowerCase().includes(search))
    );
  }

  const start = (page - 1) * limit;
  const pageData = filtered.slice(start, start + limit);

  res.json({
    total: filtered.length,
    page,
    totalPages: Math.ceil(filtered.length / limit),
    data: pageData
  });
});

function generateZPL(record) {
  const fechaParts = record.fecha.split('-');
  const fechaFormatted = fechaParts.length === 3
    ? `${fechaParts[2]}/${fechaParts[1]}/${fechaParts[0]}`
    : record.fecha;

  const stickersPerRow = 4;
  const stickerWidth = 200;
  const stickerHeight = 200;
  const paddingX = 2;
  const paddingY = 5;

  let zpl = `^XA
^CI28
^PW812
^LL406
`;

  for (let i = 0; i < stickersPerRow; i++) {
    const baseX = i * stickerWidth;

    zpl += `^FO${baseX + paddingX},${paddingY}^A0N,16,16^FD${record.codigosenasa}^FS
^FO${baseX + paddingX},${25 + paddingY}^A0N,12,12^FD${record.codigotrabajador}^FS
^FO${baseX + paddingX},${45 + paddingY}^A0N,11,11^FD${record.nombretrabajador.substring(0, 15)}^FS
^FO${baseX + paddingX},${60 + paddingY}^A0N,10,10^FDAux: ${record.codigoauxiliar}^FS
^FO${baseX + paddingX},${75 + paddingY}^A0N,10,10^FDTurno: ${record.turno}^FS
^FO${baseX + paddingX},${90 + paddingY}^A0N,10,10^FDLateral: ${record.lateral}^FS
^FO${baseX + paddingX},${105 + paddingY}^A0N,10,10^FDLote: ${record.lote}^FS
^FO${baseX + paddingX},${120 + paddingY}^A0N,10,10^FDGrupo: ${record.grupoVariedad}^FS
^FO${baseX + paddingX},${135 + paddingY}^A0N,10,10^FD${fechaFormatted}^FS
^FO${baseX + paddingX},${150 + paddingY}^A0N,12,12^FDCont: ${record.contador}^FS
^FO${baseX + 60},${165 + paddingY}^BQN,2,3^FDMA,${record.qr}^FS
`;
  }

  zpl += `^PQ1
^XZ
`;

  return zpl;
}

app.post('/api/print', async (req, res) => {
  const { ids, copies } = req.body;
  const ip = selectedPrinter.ip;
  const port = selectedPrinter.port;
  const numCopies = copies || 1;

  if (!ids || !ids.length) {
    return res.status(400).json({ error: 'No se seleccionaron registros' });
  }

  const records = currentData.filter(r => ids.includes(r.id));
  if (!records.length) {
    return res.status(404).json({ error: 'No se encontraron registros' });
  }

  let zplAll = '';
  for (const record of records) {
    let zpl = generateZPL(record);
    zpl = zpl.replace(/\^PQ1/, `^PQ${numCopies}`);
    zplAll += zpl;
  }

  try {
    await sendToPrinter(ip, port, zplAll);
    res.json({ success: true, printed: records.length, copies: numCopies });
  } catch (err) {
    res.status(500).json({ error: `Error de conexión con impresora (${ip}:${port}): ${err.message}` });
  }
});

app.post('/api/preview-zpl', (req, res) => {
  const { id } = req.body;
  const record = currentData.find(r => r.id === id);
  if (!record) return res.status(404).json({ error: 'Registro no encontrado' });
  res.json({ zpl: generateZPL(record), record });
});

app.post('/api/print-all', async (req, res) => {
  const { copies } = req.body;
  const ip = selectedPrinter.ip;
  const port = selectedPrinter.port;
  const numCopies = copies || 1;

  if (!currentData.length) {
    return res.status(400).json({ error: 'No hay datos cargados' });
  }

  let zplAll = '';
  for (const record of currentData) {
    let zpl = generateZPL(record);
    zpl = zpl.replace(/\^PQ1/, `^PQ${numCopies}`);
    zplAll += zpl;
  }

  try {
    await sendToPrinter(ip, port, zplAll);
    res.json({ success: true, printed: currentData.length, copies: numCopies });
  } catch (err) {
    res.status(500).json({ error: `Error de conexión con impresora (${ip}:${port}): ${err.message}` });
  }
});

function sendToPrinter(ip, port, zpl) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    client.setTimeout(10000);

    client.connect(port, ip, () => {
      client.write(zpl, 'utf-8', () => {
        client.end();
      });
    });

    client.on('close', () => resolve());
    client.on('error', (err) => reject(err));
    client.on('timeout', () => {
      client.destroy();
      reject(new Error('Timeout de conexión'));
    });
  });
}

app.listen(PORT, () => {
  console.log(`Portal Zebra corriendo en http://localhost:${PORT}`);
  console.log(`Impresora configurada: ${PRINTER_IP}:${PRINTER_PORT}`);
});
