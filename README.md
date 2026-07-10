# Portal de Impresión Zebra ZT231

Portal web para cargar archivos Excel e imprimir etiquetas en impresoras Zebra ZT231.

## Características

- ✅ Carga de archivos Excel (.xlsx, .xls)
- ✅ Vista previa de datos en tiempo real
- ✅ Selección individual o masiva de registros
- ✅ Generación de códigos QR automáticos
- ✅ Impresión en Zebra ZT231 vía ZPL
- ✅ Configuración flexible de impresora

## Despliegue en Render.com (Recomendado)

### Paso 1: Preparar GitHub
1. Sube este proyecto a un repositorio en GitHub
2. Asegúrate de tener `.gitignore` configurado (ya está)

### Paso 2: Crear cuenta en Render.com
1. Ve a https://render.com
2. Crea una cuenta (gratuita)
3. Conecta tu repositorio de GitHub

### Paso 3: Desplegar
1. En Render.com, haz clic en "New" → "Web Service"
2. Selecciona tu repositorio
3. Configura:
   - **Name**: `zebra-label-portal`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. En "Environment Variables", agrega:
   - `PRINTER_IP`: `192.168.1.24` (o tu IP de impresora)
   - `PRINTER_PORT`: `9100`
5. Haz clic en "Create Web Service"

### Paso 4: Acceder
Una vez desplegado, obtendrás una URL como:
```
https://zebra-label-portal.onrender.com
```

Ambas PCs pueden acceder usando esta URL desde cualquier navegador.

## Uso Local (Desarrollo)

```bash
npm install
npm start
```

Abre `http://localhost:3000` en tu navegador.

## API Endpoints

- `POST /api/upload` - Subir archivo Excel
- `GET /api/data` - Obtener datos paginados
- `POST /api/print` - Imprimir registros seleccionados
- `POST /api/print-all` - Imprimir todos los registros
- `POST /api/preview-zpl` - Previsualizar ZPL de un registro

## Estructura de Excel Requerida

El archivo Excel debe contener las siguientes columnas:

| Columna | Descripción |
|---------|-------------|
| codigosenasa | Código SENASA |
| codigotrabajador | Código del trabajador |
| nombretrabajador | Nombre del trabajador |
| turno | Turno de trabajo |
| lateral | Lateral/Sección |
| lote | Número de lote |
| grupo variedad | Grupo y variedad de producto |
| fecha | Fecha (formato YYYY-MM-DD) |
| codigoauxiliar | Código del auxiliar |
| nombreauxiliar | Nombre del auxiliar |
| contador | Número secuencial |
| qr | Código QR único |

## Notas de Impresión

- La impresora debe estar en la red y accesible en `192.168.1.24:9100`
- Si despliegas en Render, la impresora debe ser accesible desde internet o usar una VPN
- Para desarrollo local sin impresora física, ignora los errores de conexión

## Solución de Problemas

### Error "Unexpected token '<'"
- Significa que el servidor no está corriendo
- Verifica que `npm start` se ejecutó correctamente
- En Render, revisa los logs en el dashboard

### Error "Failed to parse URL"
- Asegúrate de estar accediendo por la URL correcta (no como archivo local)
- Verifica que el servidor está respondiendo

### Error de conexión con impresora
- Verifica que la IP y puerto son correctos
- Prueba la conectividad: `ping 192.168.1.24`
- Revisa que la impresora esté encendida y en la red

## Licencia

MIT
