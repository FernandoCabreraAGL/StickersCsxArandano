const express = require('express');
const net = require('net');
const os = require('os');
const http = require('http');

const app = express();
const PORT = 3001;

app.use(express.json());

// CORS headers para permitir conexiones desde navegador
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

let detectedPrinters = [];
let selectedPrinter = null;

// Detect local printers on network
function scanNetwork(baseIp, port = 9100, timeout = 300) {
  return new Promise((resolve) => {
    const printers = [];
    const lastOctet = baseIp.split('.').slice(0, 3).join('.');
    const promises = [];

    console.log(`🔍 Escaneando red ${lastOctet}.0/24 en puerto ${port}...`);

    for (let i = 1; i <= 254; i++) {
      const ip = `${lastOctet}.${i}`;
      const promise = new Promise((resolve) => {
        const client = new net.Socket();
        client.setTimeout(timeout);
        client.connect(port, ip, () => {
          printers.push({ ip, port, status: 'online' });
          console.log(`✅ Impresora encontrada: ${ip}:${port}`);
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

    Promise.all(promises).then(() => {
      console.log(`\n📋 Scan completado: ${printers.length} impresora(s) encontrada(s)\n`);
      resolve(printers);
    });
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

// API endpoints
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    printers: detectedPrinters,
    selectedPrinter
  });
});

app.get('/api/detect', async (req, res) => {
  try {
    const baseIp = getNetworkBaseIp();
    detectedPrinters = await scanNetwork(baseIp, 9100, 300);
    res.json({ printers: detectedPrinters, baseIp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/select', (req, res) => {
  const { ip, port } = req.body;
  if (!ip) return res.status(400).json({ error: 'IP requerida' });
  selectedPrinter = { ip, port: port || 9100 };
  console.log(`📌 Impresora seleccionada: ${selectedPrinter.ip}:${selectedPrinter.port}`);
  res.json({ success: true, printer: selectedPrinter });
});

app.post('/api/print', async (req, res) => {
  const { zpl } = req.body;
  if (!zpl) return res.status(400).json({ error: 'ZPL requerido' });
  if (!selectedPrinter) return res.status(400).json({ error: 'No hay impresora seleccionada' });

  try {
    console.log(`🖨️  Enviando etiqueta a ${selectedPrinter.ip}:${selectedPrinter.port}...`);
    await sendToPrinter(selectedPrinter.ip, selectedPrinter.port, zpl);
    console.log('✅ Etiqueta enviada correctamente');
    res.json({ success: true, message: 'Etiqueta enviada a impresora' });
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║      AGENTE ZEBRA - Portal de Impresión Local         ║
╠════════════════════════════════════════════════════════╣
║  🚀 Agente ejecutándose en http://127.0.0.1:${PORT}      ║
║  ⚠️  Este agente se comunica con el portal en Render  ║
║  🖨️  Esperando órdenes de impresión...                 ║
╚════════════════════════════════════════════════════════╝
  `);

  // Auto-detect printers on startup
  const baseIp = getNetworkBaseIp();
  console.log(`🏠 IP local detectada: ${baseIp}\n`);
  scanNetwork(baseIp, 9100, 300).then(printers => {
    detectedPrinters = printers;
    if (printers.length > 0) {
      selectedPrinter = printers[0];
      console.log(`✅ Impresora por defecto seleccionada: ${selectedPrinter.ip}\n`);
    }
  });
});

process.on('SIGINT', () => {
  console.log('\n\n👋 Agente detenido.');
  process.exit(0);
});
