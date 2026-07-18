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

app.get('/api/printer-debug', (req, res) => {
  res.json({
    selected: selectedPrinter,
    default: { ip: PRINTER_IP, port: PRINTER_PORT },
    message: `Intentará conectar a: ${selectedPrinter.ip}:${selectedPrinter.port}`
  });
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

function generateZPLFromDesign(record, design) {
  if (!design || !design.elements) {
    return generateZPL(record);
  }

  const DOTS_PER_MM = 8;
  let zpl = `^XA
^CI28
^PW${design.pageWidth}
^LL${design.pageHeight}
`;

  design.elements.forEach(el => {
    if (el.type === 'text') {
      let value = '';

      // Manejo especial para campo combinado codigoauxiliar_contador
      if (el.field === 'codigoauxiliar_contador') {
        const codigoAux = (record.codigoauxiliar || '').substring(0, 5);
        const contador = (record.contador || '').substring(0, 3);
        value = `${codigoAux}/${contador}`;
      } else {
        // Convertir fecha a formato DD/MM/YYYY si es necesario
        if (el.field === 'fecha' && record.fecha) {
          const fechaParts = record.fecha.split('-');
          if (fechaParts.length === 3) {
            value = `${fechaParts[2]}/${fechaParts[1]}/${fechaParts[0]}`;
          } else {
            value = record.fecha;
          }
        } else {
          value = record[el.field] || '';
        }
      }

      // Convertir rotación a formato ZPL estándar
      let zplRotation = 'A0N';
      if (el.rotation === 'A90N' || el.rotation === 'A0R') {
        zplRotation = 'A0R'; // 90° a la derecha
      } else if (el.rotation === 'A270N' || el.rotation === 'A0B') {
        zplRotation = 'A0B'; // 270° (90° a la izquierda)
      }

      const [fw, fh] = el.fontSize.split(',');
      zpl += `^FO${el.x},${el.y}^${zplRotation},${fw},${fh}^FD${value}^FS\n`;
    } else if (el.type === 'qr') {
      const value = record[el.field] || '';
      const [size1, size2] = el.size.split(',');
      zpl += `^FO${el.x},${el.y}^BQN,${size1},${size2}^FDMA,${value}^FS\n`;
    }
  });

  zpl += `^PQ1
^XZ
`;

  return zpl;
}

// Generar 1 página con hasta 4 registros diferentes
function generateZPLPage(recordsArray, design) {
  const stickerWidth = 200;
  const spacing = 10;

  let zpl = `^XA\n^CI28\n^PW840\n^LL406\n`;

  // Completar array con nulls si tiene menos de 4 registros
  while (recordsArray.length < 4) {
    recordsArray.push(null);
  }

  for (let i = 0; i < 4; i++) {
    const record = recordsArray[i];
    const baseX = i * (stickerWidth + spacing);

    if (!record) continue; // Saltar si no hay registro

    // Si hay un diseño custom, usar generateZPLFromDesign adaptado para la posición
    if (design && design.elements) {
      // Generar ZPL para este registro con posicionamiento relativo
      design.elements.forEach(el => {
        if (el.type === 'text') {
          let value = '';

          // Manejo especial para campo combinado codigoauxiliar_contador
          if (el.field === 'codigoauxiliar_contador') {
            const codigoAux = (record.codigoauxiliar || '').substring(0, 5);
            const contador = (record.contador || '').substring(0, 3);
            value = `${codigoAux}/${contador}`;
          } else {
            // Convertir fecha a formato DD/MM/YYYY si es necesario
            if (el.field === 'fecha' && record.fecha) {
              const fechaParts = record.fecha.split('-');
              if (fechaParts.length === 3) {
                value = `${fechaParts[2]}/${fechaParts[1]}/${fechaParts[0]}`;
              } else {
                value = record.fecha;
              }
            } else {
              value = record[el.field] || '';
            }
          }

          // Convertir rotación a formato ZPL estándar
          let zplRotation = 'A0N';
          if (el.rotation === 'A90N' || el.rotation === 'A0R') {
            zplRotation = 'A0R';
          } else if (el.rotation === 'A270N' || el.rotation === 'A0B') {
            zplRotation = 'A0B';
          }

          const [fw, fh] = el.fontSize.split(',');
          zpl += `^FO${baseX + el.x},${el.y}^${zplRotation},${fw},${fh}^FD${value}^FS\n`;
        } else if (el.type === 'qr') {
          const value = record[el.field] || '';
          const [size1, size2] = el.size.split(',');
          zpl += `^FO${baseX + el.x},${el.y}^BQN,${size1},${size2}^FDMA,${value}^FS\n`;
        }
      });
    } else {
      // Layout por defecto v1.3.0
      const fechaParts = record.fecha.split('-');
      const fechaFormatted = fechaParts.length === 3
        ? `${fechaParts[2]}/${fechaParts[1]}/${fechaParts[0]}`
        : record.fecha;

      const nombre = (record.nombretrabajador || '').substring(0, 22) || 'N/A';
      const auxiliar = (record.nombreauxiliar || '').substring(0, 22) || 'N/A';
      const codigoAux = (record.codigoauxiliar || '').substring(0, 5);
      const contador = (record.contador || '').substring(0, 3);

      // ARRIBA: Nombre del Trabajador (Y=28)
      zpl += `^FO${baseX + 5},${28}^A0N,10,10^FD${nombre}^FS\n`;

      // IZQUIERDA: Fecha (Y=105, rotación 270°)
      zpl += `^FO${baseX + 8},${105}^A0B,9,9^FD${fechaFormatted}^FS\n`;

      // CENTRO: QR Code (4x4)
      zpl += `^FO${baseX + 85},${85}^BQN,4,4^FDMA,${record.qr}^FS\n`;

      // DERECHA: Código/Contador (Y=105, rotación 90°)
      zpl += `^FO${baseX + 192},${105}^A0R,9,9^FD${codigoAux}/${contador}^FS\n`;

      // ABAJO: Nombre del Auxiliar (Y=180)
      zpl += `^FO${baseX + 5},${180}^A0N,10,10^FD${auxiliar}^FS\n`;
    }
  }

  zpl += `^PQ1\n^XZ\n`;
  return zpl;
}

// Generar ZPL agrupado por nombreauxiliar
function generateZPLGroupedByAuxiliar(records, design) {
  // Agrupar por nombreauxiliar
  const groups = {};
  for (const record of records) {
    const key = record.nombreauxiliar || 'SIN_AUXILIAR';
    if (!groups[key]) groups[key] = [];
    groups[key].push(record);
  }

  let zplAll = '';

  // Procesar cada grupo
  for (const auxiliar in groups) {
    const groupRecords = groups[auxiliar];

    // Dividir en chunks de 4
    for (let i = 0; i < groupRecords.length; i += 4) {
      const chunk = groupRecords.slice(i, i + 4);
      const pageZpl = generateZPLPage(chunk, design);
      zplAll += pageZpl;
    }
  }

  return zplAll;
}

// Mantener la función antigua para compatibilidad (genera 4 stickers del mismo registro)
function generateZPL(record) {
  return generateZPLPage([record, record, record, record], null);
}

app.post('/api/print', async (req, res) => {
  const { ids, designId } = req.body;
  const ip = selectedPrinter.ip;
  const port = selectedPrinter.port;

  if (!ids || !ids.length) {
    return res.status(400).json({ error: 'No se seleccionaron registros' });
  }

  const records = currentData.filter(r => ids.includes(r.id));
  if (!records.length) {
    return res.status(404).json({ error: 'No se encontraron registros' });
  }

  const design = designId ? designs.find(d => d.id === designId) : null;

  // Generar ZPL agrupado por nombreauxiliar
  let zplAll = generateZPLGroupedByAuxiliar(records, design);

  try {
    await sendToPrinter(ip, port, zplAll);
    res.json({ success: true, printed: records.length });
  } catch (err) {
    res.status(500).json({ error: `Error de conexión con impresora (${ip}:${port}): ${err.message}` });
  }
});

app.post('/api/preview-zpl', (req, res) => {
  const { id, designId } = req.body;
  const record = currentData.find(r => r.id === id);
  if (!record) return res.status(404).json({ error: 'Registro no encontrado' });

  const design = designId ? designs.find(d => d.id === designId) : null;
  // Para preview, mostrar 1 página con el registro 4 veces (para compatibilidad)
  const zpl = design ? generateZPLFromDesign(record, design) : generateZPLPage([record, record, record, record], design);

  res.json({ zpl, record });
});

app.post('/api/print-all', async (req, res) => {
  const ip = selectedPrinter.ip;
  const port = selectedPrinter.port;

  if (!currentData.length) {
    return res.status(400).json({ error: 'No hay datos cargados' });
  }

  // Generar ZPL agrupado por nombreauxiliar
  let zplAll = generateZPLGroupedByAuxiliar(currentData, null);

  try {
    await sendToPrinter(ip, port, zplAll);
    res.json({ success: true, printed: currentData.length });
  } catch (err) {
    res.status(500).json({ error: `Error de conexión con impresora (${ip}:${port}): ${err.message}` });
  }
});

function sendToPrinter(ip, port, zpl) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    client.setTimeout(30000); // Aumentar a 30 segundos

    console.log(`[PRINT] Conectando a ${ip}:${port}`);
    console.log(`[PRINT] Enviando ${zpl.length} bytes de ZPL`);

    client.connect(port, ip, () => {
      console.log(`[PRINT] Conectado a ${ip}:${port}`);
      client.write(zpl, 'utf-8', () => {
        console.log(`[PRINT] ZPL enviado, cerrando conexión`);
        client.end();
      });
    });

    client.on('close', () => {
      console.log(`[PRINT] Conexión cerrada`);
      resolve();
    });

    client.on('error', (err) => {
      console.error(`[PRINT] Error: ${err.message}`);
      reject(err);
    });

    client.on('timeout', () => {
      console.error(`[PRINT] Timeout después de 30 segundos`);
      client.destroy();
      reject(new Error('Timeout de conexión (30s)'));
    });
  });
}

app.listen(PORT, () => {
  console.log(`Portal Zebra corriendo en http://localhost:${PORT}`);
  console.log(`Impresora configurada: ${PRINTER_IP}:${PRINTER_PORT}`);
});
