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
  const { name, description, elements, marginTop, marginBottom, marginLeft, marginRight, pageWidth, pageHeight } = req.body;
  const id = `design-${Date.now()}`;
  const newDesign = {
    id,
    name,
    description,
    elements: elements || [],
    active: false,
    pageWidth: pageWidth || 812,
    pageHeight: pageHeight || 406,
    marginTop: marginTop || 5,
    marginBottom: marginBottom || 5,
    marginLeft: marginLeft || 5,
    marginRight: marginRight || 5,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  designs.push(newDesign);
  saveDesigns();
  res.json(newDesign);
});

app.put('/api/designs/:id', (req, res) => {
  const { id } = req.params;
  const { name, description, elements, marginTop, marginBottom, marginLeft, marginRight, pageWidth, pageHeight } = req.body;
  const design = designs.find(d => d.id === id);
  if (!design) return res.status(404).json({ error: 'Diseño no encontrado' });

  if (name !== undefined) design.name = name;
  if (description !== undefined) design.description = description;
  if (elements !== undefined) design.elements = elements;
  if (marginTop !== undefined) design.marginTop = marginTop;
  if (marginBottom !== undefined) design.marginBottom = marginBottom;
  if (marginLeft !== undefined) design.marginLeft = marginLeft;
  if (marginRight !== undefined) design.marginRight = marginRight;
  if (pageWidth !== undefined) design.pageWidth = pageWidth;
  if (pageHeight !== undefined) design.pageHeight = pageHeight;

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

const DOTS_PER_MM = 8;
function mmToDots(mm) { return Math.round(mm * DOTS_PER_MM); }
function dotsToMm(dots) { return (dots / DOTS_PER_MM).toFixed(1); }

function generateZPLFromDesign(record, design) {
  const pageWidth = design.pageWidth || 812;
  const pageHeight = design.pageHeight || 406;

  let zpl = `^XA\n^CI28\n^PW${pageWidth}\n^LL${pageHeight}\n`;

  if (!design.elements || !design.elements.length) {
    zpl += `^FO30,30^A0N,28,28^FD${record.codigosenasa || 'N/A'}^FS\n`;
    zpl += `^PQ1\n^XZ`;
    return zpl;
  }

  design.elements.forEach(el => {
    if (el.type === 'text') {
      const value = String(record[el.field] || el.field || '');
      const [w, h] = (el.fontSize || '24,24').split(',');
      const x = el.x || 30;
      const y = el.y || 30;
      zpl += `^FO${x},${y}^A0N,${w},${h}^FD${value}^FS\n`;
    } else if (el.type === 'qr') {
      const value = String(record[el.field] || el.field || '');
      const x = el.x || 550;
      const y = el.y || 30;
      const size = el.size || '2,5';
      zpl += `^FO${x},${y}^BQN,${size}^FDMA,${value}^FS\n`;
    }
  });

  zpl += `^PQ1\n^XZ`;
  return zpl;
}

function generateZPL(record) {
  const fechaParts = record.fecha.split('-');
  const fechaFormatted = fechaParts.length === 3
    ? `${fechaParts[2]}/${fechaParts[1]}/${fechaParts[0]}`
    : record.fecha;

  const design = designs.find(d => d.active) || designs[0];
  if (design && design.elements) {
    return generateZPLFromDesign(record, design);
  }

  return `^XA
^CI28
^PW812
^LL406
^FO30,30^A0N,28,28^FD${record.codigosenasa}^FS
^FO30,65^A0N,24,24^FDTrab: ${record.codigotrabajador} - ${record.nombretrabajador}^FS
^FO30,95^A0N,24,24^FDAux: ${record.codigoauxiliar} - ${record.nombreauxiliar}^FS
^FO30,130^A0N,22,22^FDTurno: ${record.turno}  Lateral: ${record.lateral}  Lote: ${record.lote}^FS
^FO30,160^A0N,22,22^FDGrupo: ${record.grupoVariedad}^FS
^FO30,190^A0N,22,22^FDFecha: ${fechaFormatted}  Contador: ${record.contador}^FS
^FO550,30^BQN,2,5^FDMA,${record.qr}^FS
^FO30,230^GB750,0,2^FS
^FO30,245^A0N,20,20^FD${record.qr}^FS
^PQ1
^XZ
`;
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
  const { id, designId } = req.body;
  const record = currentData.find(r => r.id === id);
  if (!record) return res.status(404).json({ error: 'Registro no encontrado' });

  let zpl = generateZPL(record);
  if (designId) {
    const design = designs.find(d => d.id === designId);
    if (design) {
      zpl = generateZPLFromDesign(record, design);
    }
  }

  res.json({ zpl, record });
});

app.post('/api/calculate-margins', (req, res) => {
  const { marginTopMm, marginBottomMm, marginLeftMm, marginRightMm, pageWidthMm, pageHeightMm } = req.body;

  res.json({
    margins: {
      top: { mm: marginTopMm, dots: mmToDots(marginTopMm) },
      bottom: { mm: marginBottomMm, dots: mmToDots(marginBottomMm) },
      left: { mm: marginLeftMm, dots: mmToDots(marginLeftMm) },
      right: { mm: marginRightMm, dots: mmToDots(marginRightMm) }
    },
    page: {
      widthMm: pageWidthMm,
      widthDots: mmToDots(pageWidthMm),
      heightMm: pageHeightMm,
      heightDots: mmToDots(pageHeightMm)
    },
    workArea: {
      x: mmToDots(marginLeftMm),
      y: mmToDots(marginTopMm),
      widthDots: mmToDots(pageWidthMm - marginLeftMm - marginRightMm),
      heightDots: mmToDots(pageHeightMm - marginTopMm - marginBottomMm),
      widthMm: pageWidthMm - marginLeftMm - marginRightMm,
      heightMm: pageHeightMm - marginTopMm - marginBottomMm
    }
  });
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
