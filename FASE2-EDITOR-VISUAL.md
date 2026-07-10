# FASE 2: Editor Visual de Diseños de Etiqueta

**Estado:** En Desarrollo (rama `develop`)  
**Versión Funcional:** Está en rama `main` (sin cambios)

## 📋 Tareas Completadas

- ✅ Backend: Almacenamiento de diseños (`designs.json`)
- ✅ Endpoints CRUD para gestionar diseños
- ✅ Sistema de duplicación de diseños
- ✅ Cargar/guardar diseños persistentemente

## 🚀 Próximos Pasos (TODO)

### 1. Cargar Diseños en Frontend
En `public/index.html`, agregar después de `window.addEventListener('load', ...)`:

```javascript
// Cargar diseños al iniciar
async function loadDesigns() {
  try {
    const res = await fetch('/api/designs');
    const designList = await res.json();
    const select = document.getElementById('designSelect');
    select.innerHTML = '<option value="">-- Nuevo Diseño --</option>';
    designList.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = `${d.name}${d.active ? ' (Activo)' : ''}`;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error('Error cargando diseños:', err);
  }
}
```

### 2. Crear Modal Editor Visual

Agregar antes de `</body>` en `index.html`:

```html
<!-- Design Editor Modal -->
<div class="modal-overlay" id="designEditorModal">
  <div class="modal" style="max-width: 1200px; max-height: 90vh;">
    <h3>✏️ Editor de Diseño de Etiqueta</h3>
    
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 16px;">
      
      <!-- Panel Izquierdo: Elementos -->
      <div>
        <h4 style="margin-bottom: 12px;">Elementos de Diseño</h4>
        <div style="max-height: 500px; overflow-y: auto; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px;">
          <table style="width: 100%; font-size: 12px;">
            <thead>
              <tr style="background: #f3f4f6; position: sticky; top: 0;">
                <th style="padding: 8px; text-align: left; border-bottom: 2px solid #d1d5db;">Tipo</th>
                <th style="padding: 8px; text-align: left; border-bottom: 2px solid #d1d5db;">X</th>
                <th style="padding: 8px; text-align: left; border-bottom: 2px solid #d1d5db;">Y</th>
                <th style="padding: 8px; text-align: left; border-bottom: 2px solid #d1d5db;">Acciones</th>
              </tr>
            </thead>
            <tbody id="elementsTableBody">
              <!-- Generado dinámicamente -->
            </tbody>
          </table>
        </div>
        
        <button class="btn btn-success" style="margin-top: 12px; width: 100%;" onclick="addNewElement()">
          ➕ Agregar Elemento
        </button>
      </div>

      <!-- Panel Derecho: Preview -->
      <div>
        <h4 style="margin-bottom: 12px;">Vista Previa</h4>
        <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; min-height: 400px; font-family: monospace; font-size: 11px; white-space: pre-wrap; overflow-y: auto; max-height: 500px;" id="previewZPL">
          Selecciona un registro para ver vista previa...
        </div>
      </div>
    </div>

    <div style="margin-top: 16px; padding: 12px; background: #eff6ff; border-radius: 8px; font-size: 13px; border-left: 4px solid #1a56db;">
      💡 <strong>Modo Desarrollador:</strong> 
      <button class="btn btn-outline btn-sm" onclick="toggleDeveloperMode()" style="margin-left: 8px;">
        👨‍💻 Ver ZPL Raw
      </button>
    </div>

    <div class="modal-actions" style="margin-top: 16px;">
      <button class="btn btn-outline" onclick="closeDesignEditor()">Cerrar</button>
      <button class="btn btn-primary" onclick="saveDesignChanges()">💾 Guardar Diseño</button>
    </div>
  </div>
</div>
```

### 3. JavaScript para el Editor

Agregar al final del `<script>` en `index.html`:

```javascript
let currentDesign = null;

async function openDesignEditor() {
  const designId = document.getElementById('designSelect').value;
  
  if (!designId) {
    toast('Selecciona un diseño o crea uno nuevo', 'error');
    return;
  }

  try {
    const res = await fetch('/api/designs');
    const designs = await res.json();
    currentDesign = designs.find(d => d.id === designId);
    
    if (!currentDesign) {
      toast('Diseño no encontrado', 'error');
      return;
    }

    renderElementsTable();
    document.getElementById('designEditorModal').classList.add('active');
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

function closeDesignEditor() {
  document.getElementById('designEditorModal').classList.remove('active');
  currentDesign = null;
}

function renderElementsTable() {
  if (!currentDesign) return;

  const tbody = document.getElementById('elementsTableBody');
  tbody.innerHTML = currentDesign.elements.map(el => `
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 8px;">${el.type}</td>
      <td style="padding: 8px;"><input type="number" value="${el.x}" style="width: 50px; padding: 4px;" onchange="updateElement(${el.id}, 'x', this.value)"></td>
      <td style="padding: 8px;"><input type="number" value="${el.y}" style="width: 50px; padding: 4px;" onchange="updateElement(${el.id}, 'y', this.value)"></td>
      <td style="padding: 8px;">
        <button class="btn btn-sm btn-outline" onclick="editElement(${el.id})">✏️</button>
        <button class="btn btn-sm btn-danger" onclick="deleteElement(${el.id})">🗑️</button>
      </td>
    </tr>
  `).join('');
}

function addNewElement() {
  if (!currentDesign) return;
  
  const newElement = {
    id: Math.max(...currentDesign.elements.map(e => e.id), 0) + 1,
    type: 'text',
    label: 'Nuevo Elemento',
    field: 'custom_field',
    x: 30,
    y: 30 + (currentDesign.elements.length * 35),
    font: 'A0N',
    fontSize: '24,24',
    order: currentDesign.elements.length + 1
  };
  
  currentDesign.elements.push(newElement);
  renderElementsTable();
  toast('Elemento agregado', 'success');
}

function updateElement(id, prop, value) {
  if (!currentDesign) return;
  const el = currentDesign.elements.find(e => e.id === id);
  if (el) {
    el[prop] = isNaN(value) ? value : parseInt(value);
    updatePreview();
  }
}

function editElement(id) {
  if (!currentDesign) return;
  const el = currentDesign.elements.find(e => e.id === id);
  if (!el) return;

  const newLabel = prompt('Nombre del elemento:', el.label);
  if (newLabel) el.label = newLabel;

  const newField = prompt('Campo (codigosenasa, codigotrabajador, etc):', el.field);
  if (newField) el.field = newField;

  if (el.type === 'text') {
    const newSize = prompt('Tamaño fuente (ej: 24,24):', el.fontSize);
    if (newSize) el.fontSize = newSize;
  }

  renderElementsTable();
  updatePreview();
}

function deleteElement(id) {
  if (!currentDesign) return;
  if (confirm('¿Eliminar este elemento?')) {
    currentDesign.elements = currentDesign.elements.filter(e => e.id !== id);
    renderElementsTable();
    updatePreview();
    toast('Elemento eliminado', 'success');
  }
}

function updatePreview() {
  if (!currentDesign || !state.data.length) return;
  
  const record = state.data[0];
  generateZPLFromDesign(record, currentDesign).then(zpl => {
    document.getElementById('previewZPL').textContent = zpl;
  });
}

async function generateZPLFromDesign(record, design) {
  let zpl = `^XA\n^CI28\n^PW812\n^LL406\n`;

  design.elements.forEach(el => {
    if (el.type === 'text') {
      const value = record[el.field] || el.field;
      const [w, h] = el.fontSize.split(',');
      zpl += `^FO${el.x},${el.y}^A0N,${w},${h}^FD${value}^FS\n`;
    } else if (el.type === 'qr') {
      const value = record[el.field] || el.field;
      zpl += `^FO${el.x},${el.y}^BQN,2,5^FDMA,${value}^FS\n`;
    }
  });

  zpl += `^PQ1\n^XZ`;
  return zpl;
}

function toggleDeveloperMode() {
  const modal = prompt('Edita el ZPL (avanzado):\n\n' + document.getElementById('previewZPL').textContent);
  if (modal !== null) {
    document.getElementById('previewZPL').textContent = modal;
  }
}

async function saveDesignChanges() {
  if (!currentDesign) return;

  try {
    const res = await fetch(`/api/designs/${currentDesign.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: currentDesign.name,
        description: currentDesign.description,
        elements: currentDesign.elements
      })
    });

    if (res.ok) {
      toast('✅ Diseño guardado correctamente', 'success');
      closeDesignEditor();
      loadDesigns();
    }
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}
```

## ✅ Checklist de Implementación

- [ ] 1. Agregar función `loadDesigns()` al HTML
- [ ] 2. Agregar Modal del Editor
- [ ] 3. Agregar funciones JavaScript del editor
- [ ] 4. Probar seleccionar y editar diseño
- [ ] 5. Probar guardar cambios
- [ ] 6. Hacer commit a rama `develop`
- [ ] 7. Hacer PR a `main` para merge

## 🔄 Control de Versiones

```
main (versión estable - SIN cambios)
  └── develop (nueva Fase 2)
      └── [Cambios aquí]
```

Cuando esté todo listo y probado:
```
git checkout main
git merge develop
```

---

**Tiempo estimado:** 30-45 minutos para implementar todo
**Dificultad:** Media
**Dependencias:** Backend ya está listo ✅

¡Adelante! 🚀
