const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const net = require('net');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const PRINTER_IP = process.env.PRINTER_IP || '192.168.1.24';
const PRINTER_PORT = process.env.PRINTER_PORT || 9100;

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
  const { ids, printerIp, printerPort, copies } = req.body;
  const ip = printerIp || PRINTER_IP;
  const port = printerPort || PRINTER_PORT;
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
  const { printerIp, printerPort, copies } = req.body;
  const ip = printerIp || PRINTER_IP;
  const port = printerPort || PRINTER_PORT;
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
