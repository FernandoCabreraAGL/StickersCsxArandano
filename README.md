# Portal de Impresión Zebra ZT231

Portal web + Agente Local para cargar archivos Excel e imprimir etiquetas en impresoras Zebra ZT231.

**Arquitectura:** Render.com (Portal Web) + Agente Local .exe (PC #2)

## Características

- ✅ Carga de archivos Excel (.xlsx, .xls)
- ✅ Vista previa de datos en tiempo real
- ✅ Selección individual o masiva de registros
- ✅ Detección automática de impresoras ZEBRA en la red local
- ✅ Generación de códigos QR automáticos
- ✅ Impresión en Zebra ZT231 vía ZPL
- ✅ Funciona aunque PC #1 esté apagada

## Setup Rápido

### PC #1: Desplegar Portal en Render.com

1. **Preparar GitHub** - Tu código ya está en: https://github.com/FernandoCabreraAGL/StickersCsxArandano
2. **Ir a** https://render.com y conectar el repositorio
3. **Crear Web Service** con:
   - Name: `zebra-label-portal`
   - Environment: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
4. **Obtener URL** → Algo como `https://zebra-label-portal.onrender.com`

### PC #2: Instalar Agente Local

1. **Descargar** `zebra-agent.exe` desde: https://github.com/FernandoCabreraAGL/StickersCsxArandano/releases
2. **Ejecutar** - Doble clic en `zebra-agent.exe`
3. **Esperar** - Debería decir:
   ```
   🖨️ Agente ejecutándose en http://127.0.0.1:3001
   📋 Scan completado: X impresora(s) encontrada(s)
   ✅ Impresora por defecto seleccionada: 192.168.1.24
   ```
4. **Abrir Portal** en navegador: `https://zebra-label-portal.onrender.com`

## Cómo Funciona

```
PC #2 (Bloqueada, sin instalar)
├── Navegador Web
│   └── Portal Render (https://zebra-label-portal.onrender.com)
│       ├── Carga Excel
│       ├── Selecciona registros
│       └── Envía orden de impresión
│           ↓
├── Agente Local (.exe)
│   ├── Detecta impresoras ZEBRA en red local
│   ├── Recibe órdenes HTTP
│   └── Envía ZPL a impresoras por TCP/IP 9100
│       ↓
└── Impresoras ZEBRA ZT231
    └── Imprimen etiquetas
```

## Compilar Agente (Opcional)

Si necesitas recompilar `zebra-agent.exe` después de cambios:

```bash
npm install
npm run build-agent
```

Genera: `zebra-agent.exe`

## Troubleshooting

### "Agente local no disponible"
- ¿Está ejecutando `zebra-agent.exe` en PC #2?
- ¿Puerto 3001 no está bloqueado?
- Revisa consola del agente para errores

### "No se encontraron impresoras"
- Verifica que impresoras ZEBRA estén en puerto 9100
- Prueba manualmente: `ping 192.168.1.24`
- Reinicia el agente (Ctrl+C y ejecuta de nuevo)

### Portal no carga desde Render
- Espera 30 seg en primera carga (servidor free)
- Verifica conexión a internet en PC #2
- Recarga página (Ctrl+F5)

## Endpoints API

**Portal (Render):**
- `POST /api/upload` - Subir Excel
- `GET /api/data` - Obtener registros
- `POST /api/preview-zpl` - Ver ZPL

**Agente Local (Puerto 3001):**
- `GET /api/status` - Estado del agente
- `GET /api/detect` - Detectar impresoras
- `POST /api/select` - Seleccionar impresora
- `POST /api/print` - Enviar ZPL a impresora

## Licencia

MIT
