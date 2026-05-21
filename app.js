// Control de Gastos - Main Application

// Shared JSON-backed database. Cloudflare Pages serves /api/data from functions/api/data.js.
// localStorage is kept only as an offline/local fallback.
const DB = (() => {
    const API_URL = '/api/data';
    const LOCAL_STATE_KEY = 'controlGastosData';
    const COLLECTIONS = ['usuarios', 'aportes', 'gastos'];

    let state = loadLocalData();
    let remoteEnabled = false;
    let initialized = false;
    let pendingWrites = 0;
    let saveQueue = Promise.resolve();
    let warnedLocalMode = false;

    function safeParse(value, fallback) {
        try {
            return value ? JSON.parse(value) : fallback;
        } catch (error) {
            return fallback;
        }
    }

    function normalizeData(data = {}) {
        return {
            usuarios: Array.isArray(data.usuarios) ? data.usuarios : [],
            aportes: Array.isArray(data.aportes) ? data.aportes : [],
            gastos: Array.isArray(data.gastos) ? data.gastos : [],
            updatedAt: data.updatedAt || null
        };
    }

    function cloneItems(items) {
        return Array.isArray(items)
            ? items.map(item => item && typeof item === 'object' ? { ...item } : item)
            : [];
    }

    function loadLocalData() {
        const savedState = safeParse(localStorage.getItem(LOCAL_STATE_KEY), null);
        if (savedState) {
            return normalizeData(savedState);
        }

        return normalizeData({
            usuarios: safeParse(localStorage.getItem('usuarios'), []),
            aportes: safeParse(localStorage.getItem('aportes'), []),
            gastos: safeParse(localStorage.getItem('gastos'), [])
        });
    }

    function saveLocalData() {
        localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state));
        COLLECTIONS.forEach(collection => {
            localStorage.setItem(collection, JSON.stringify(state[collection]));
        });
        localStorage.setItem('dataInitialized', 'true');
    }

    function hasRecords(data) {
        return COLLECTIONS.some(collection => data[collection].length > 0);
    }

    function canUseRemote() {
        return window.location.protocol === 'http:' || window.location.protocol === 'https:';
    }

    async function requestRemote(method = 'GET', body = null) {
        const options = {
            method,
            headers: { 'Accept': 'application/json' },
            cache: 'no-store'
        };

        if (body) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(body);
        }

        const response = await fetch(API_URL, options);
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(payload.error || `API error ${response.status}`);
        }

        return normalizeData(payload);
    }

    function replaceState(nextState) {
        state = normalizeData(nextState);
        saveLocalData();
    }

    function renderAll() {
        if (typeof renderUsuarios === 'function') renderUsuarios();
        if (typeof populateUsuarioSelects === 'function') populateUsuarioSelects();
        if (typeof renderAporteHistory === 'function') renderAporteHistory();
        if (typeof renderGastoHistory === 'function') renderGastoHistory();
        if (typeof updateTotalEnCaja === 'function') updateTotalEnCaja();
    }

    function buildPatch(collection, previous, next, options = {}) {
        const previousList = Array.isArray(previous) ? previous : [];
        const nextList = Array.isArray(next) ? next : [];
        const previousById = new Map(previousList.filter(item => item && item.id).map(item => [item.id, item]));
        const nextById = new Map(nextList.filter(item => item && item.id).map(item => [item.id, item]));

        return {
            collection,
            clear: Boolean(options.clear),
            deletedIds: previousList
                .filter(item => item && item.id && !nextById.has(item.id))
                .map(item => item.id),
            upserted: nextList.filter(item => {
                if (!item || !item.id) return false;
                const previousItem = previousById.get(item.id);
                return !previousItem || JSON.stringify(previousItem) !== JSON.stringify(item);
            })
        };
    }

    function warnLocalMode() {
        if (warnedLocalMode) return;
        warnedLocalMode = true;

        if (typeof showToast === 'function') {
            showToast('Modo local: configure GASTOS_DB en Cloudflare para compartir datos', 'warning');
        }
    }

    function schedulePatch(collection, previous, next, options = {}) {
        if (!canUseRemote()) return;

        if (!remoteEnabled && initialized) {
            warnLocalMode();
            return;
        }

        if (!remoteEnabled) return;

        const patch = buildPatch(collection, previous, next, options);
        if (!patch.clear && patch.deletedIds.length === 0 && patch.upserted.length === 0) {
            return;
        }

        pendingWrites += 1;
        saveQueue = saveQueue
            .then(async () => {
                const remoteData = await requestRemote('PATCH', patch);
                remoteEnabled = true;
                replaceState(remoteData);
                renderAll();
            })
            .catch(error => {
                remoteEnabled = false;
                console.error('No se pudo sincronizar con Cloudflare:', error);
                warnLocalMode();
            })
            .finally(() => {
                pendingWrites -= 1;
            });
    }

    function setCollection(collection, next, options = {}) {
        const previous = cloneItems(state[collection]);
        const nextItems = cloneItems(next);
        state = {
            ...state,
            [collection]: nextItems,
            updatedAt: new Date().toISOString()
        };
        saveLocalData();
        schedulePatch(collection, previous, state[collection], options);
    }

    async function init() {
        state = loadLocalData();
        saveLocalData();

        if (!canUseRemote()) {
            initialized = true;
            return false;
        }

        try {
            const remoteData = await requestRemote('GET');
            remoteEnabled = true;

            if (hasRecords(remoteData) || !hasRecords(state)) {
                replaceState(remoteData);
            } else {
                const seededData = await requestRemote('PUT', state);
                replaceState(seededData);
            }

            initialized = true;
            return true;
        } catch (error) {
            remoteEnabled = false;
            initialized = true;
            console.warn('Usando datos locales porque la API compartida no esta disponible:', error);
            return false;
        }
    }

    async function refresh(options = {}) {
        if (!canUseRemote() || pendingWrites > 0) {
            return false;
        }

        try {
            const remoteData = await requestRemote('GET');
            remoteEnabled = true;
            replaceState(remoteData);
            if (options.render) renderAll();
            return true;
        } catch (error) {
            remoteEnabled = false;
            if (!options.silent) warnLocalMode();
            return false;
        }
    }

    return {
        init,
        refresh,
        isRemoteEnabled: () => remoteEnabled,
        getUsuarios: () => cloneItems(state.usuarios),
        setUsuarios: data => setCollection('usuarios', data),
        getAportes: () => cloneItems(state.aportes),
        setAportes: data => setCollection('aportes', data),
        clearAportes: () => setCollection('aportes', [], { clear: true }),
        getGastos: () => cloneItems(state.gastos),
        setGastos: data => setCollection('gastos', data),
        clearGastos: () => setCollection('gastos', [], { clear: true })
    };
})();

// Initialize sample data if empty
function initializeSampleData() {
    if (DB.getUsuarios().length === 0 && DB.getAportes().length === 0 && DB.getGastos().length === 0) {
        const hasData = localStorage.getItem('dataInitialized');
        if (!hasData) {
            localStorage.setItem('dataInitialized', 'true');
        }
    }
}

// Generate unique ID
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Toast notification system with animation
function showToast(message, type = 'success') {
    const toastContainer = document.getElementById('toast-container');
    const toastId = 'toast-' + Date.now();
    const icons = {
        'success': 'check-circle',
        'danger': 'exclamation-triangle',
        'warning': 'exclamation-circle',
        'info': 'info-circle'
    };
    const colors = {
        'success': 'var(--success)',
        'danger': 'var(--danger)',
        'warning': 'var(--warning)',
        'info': 'var(--info)'
    };
    
    const toastHTML = `
        <div id="${toastId}" class="toast align-items-center text-white border-0" role="alert" style="background: ${colors[type]}">
            <div class="d-flex">
                <div class="toast-body">
                    <i class="fas fa-${icons[type]} me-2"></i> ${message}
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
            </div>
        </div>
    `;
    
    toastContainer.insertAdjacentHTML('beforeend', toastHTML);
    const toastElement = document.getElementById(toastId);
    const toast = new bootstrap.Toast(toastElement, { delay: 3500 });
    toast.show();
    
    toastElement.addEventListener('hidden.bs.toast', () => {
        toastElement.remove();
    });
}

// Navigation with animation
document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', function(e) {
        e.preventDefault();
        
        // Add click animation
        this.style.transform = 'scale(0.95)';
        setTimeout(() => {
            this.style.transform = '';
        }, 150);
        
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        this.classList.add('active');
        
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        const target = this.id.replace('nav-', '') + '-section';
        const targetSection = document.getElementById(target);
        targetSection.classList.add('active');
        
        // Add floating animation to section
        targetSection.style.animation = 'none';
        setTimeout(() => {
            targetSection.style.animation = 'slideInUp 0.6s ease-out';
        }, 10);
    });
});

// Initialize default dates
document.addEventListener('DOMContentLoaded', async function() {
    const today = new Date();
    const formattedDate = today.toISOString().split('T')[0];
    const formattedMonth = today.toISOString().substring(0, 7);
    
    document.getElementById('fecha-gasto').value = formattedDate;
    document.getElementById('mes-total').value = formattedMonth;
    
    await DB.init();
    initializeSampleData();
    renderUsuarios();
    populateUsuarioSelects();
    renderAporteHistory();
    renderGastoHistory();
    updateTotalEnCaja();

    if (!DB.isRemoteEnabled() && window.location.protocol !== 'file:') {
        showToast('Modo local: configure GASTOS_DB en Cloudflare para compartir datos', 'warning');
    }

    setInterval(() => {
        if (DB.isRemoteEnabled()) {
            DB.refresh({ render: true, silent: true });
        }
    }, 30000);
});

// ============= USUARIOS SECTION =============

function renderUsuarios() {
    const usuarios = DB.getUsuarios();
    const tbody = document.querySelector('#usuarios-table tbody');
    
    if (usuarios.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center py-4"><i class="fas fa-users-slash fa-2x text-muted mb-2"></i><br>No hay usuarios registrados</td></tr>';
        return;
    }
    
    tbody.innerHTML = usuarios.map((usuario, index) => `
        <tr style="animation: slideInUp 0.3s ease-out ${index * 0.05}s both;">
            <td><span class="badge bg-primary bg-opacity-10 text-primary">#${usuario.id.substring(0, 8)}</span></td>
            <td><i class="fas fa-user me-2 text-primary"></i> ${usuario.nombre} ${usuario.primerApellido} ${usuario.segundoApellido || ''}</td>
            <td>
                <button class="btn btn-sm btn-primary me-2" onclick="editUsuario('${usuario.id}')" title="Editar">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-danger" onclick="deleteUsuario('${usuario.id}')" title="Eliminar">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

function openUsuarioModal(usuario = null) {
    const modal = document.getElementById('usuarioModal');
    const modalLabel = document.getElementById('usuarioModalLabel');
    const form = document.getElementById('usuario-form');
    
    form.reset();
    document.getElementById('usuario-id').value = '';
    
    if (usuario) {
        modalLabel.innerHTML = '<i class="fas fa-user-edit"></i> Editar Usuario';
        document.getElementById('usuario-id').value = usuario.id;
        document.getElementById('nombre').value = usuario.nombre;
        document.getElementById('primerApellido').value = usuario.primerApellido;
        document.getElementById('segundoApellido').value = usuario.segundoApellido || '';
    } else {
        modalLabel.innerHTML = '<i class="fas fa-user-plus"></i> Nuevo Usuario';
    }
    
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
}

document.getElementById('btn-add-usuario').addEventListener('click', () => openUsuarioModal());
document.getElementById('btn-refresh-usuarios').addEventListener('click', async function() {
    const refreshed = await DB.refresh({ render: true });
    renderUsuarios();
    showToast(refreshed ? 'Lista actualizada' : 'Mostrando datos locales', refreshed ? 'info' : 'warning');
});
document.getElementById('btn-save-usuario').addEventListener('click', saveUsuario);

function saveUsuario() {
    const id = document.getElementById('usuario-id').value;
    const nombre = document.getElementById('nombre').value.trim();
    const primerApellido = document.getElementById('primerApellido').value.trim();
    const segundoApellido = document.getElementById('segundoApellido').value.trim();
    
    if (!nombre || !primerApellido) {
        showToast('Por favor complete los campos obligatorios', 'warning');
        return;
    }
    
    const usuarios = DB.getUsuarios();
    const usuario = { id: id || generateId(), nombre, primerApellido, segundoApellido };
    
    if (id) {
        const index = usuarios.findIndex(u => u.id === id);
        usuarios[index] = usuario;
        showToast('Usuario actualizado correctamente', 'success');
    } else {
        usuarios.push(usuario);
        showToast('Usuario creado correctamente', 'success');
    }
    
    DB.setUsuarios(usuarios);
    bootstrap.Modal.getInstance(document.getElementById('usuarioModal')).hide();
    renderUsuarios();
    populateUsuarioSelects();
}

window.editUsuario = function(id) {
    const usuarios = DB.getUsuarios();
    const usuario = usuarios.find(u => u.id === id);
    openUsuarioModal(usuario);
};

window.deleteUsuario = function(id) {
    if (confirm('¿Está seguro de eliminar este usuario?')) {
        const usuarios = DB.getUsuarios().filter(u => u.id !== id);
        DB.setUsuarios(usuarios);
        renderUsuarios();
        populateUsuarioSelects();
        showToast('Usuario eliminado correctamente', 'success');
    }
};

// ============= USUARIO SELECT POPULATION =============

function populateUsuarioSelects() {
    const usuarios = DB.getUsuarios();
    const usuarioSelect = document.getElementById('usuario-select');
    const usuarioTotal = document.getElementById('usuario-total');
    
    usuarioSelect.innerHTML = usuarios.map(u => 
        `<option value="${u.id}">${u.nombre} ${u.primerApellido} ${u.segundoApellido || ''}</option>`
    ).join('');
    
    usuarioTotal.innerHTML = '<option value="">Todos los Usuarios</option>' + 
        usuarios.map(u => `<option value="${u.id}">${u.nombre} ${u.primerApellido} ${u.segundoApellido || ''}</option>`).join('');
}

// ============= APORTE SECTION =============

document.getElementById('aporte-form').addEventListener('submit', function(e) {
    e.preventDefault();
    
    const selectedOptions = Array.from(document.getElementById('usuario-select').selectedOptions);
    const monto = parseFloat(document.getElementById('monto-aporte').value);
    const metodoPago = document.getElementById('metodo-pago-aporte').value;
    
    if (selectedOptions.length === 0) {
        showToast('Seleccione al menos un usuario', 'warning');
        return;
    }
    
    if (!monto || monto <= 0) {
        showToast('Ingrese un monto válido', 'warning');
        return;
    }
    
    const aportes = DB.getAportes();
    selectedOptions.forEach(option => {
        aportes.push({
            id: generateId(),
            usuarioId: option.value,
            usuarioNombre: option.textContent,
            monto: monto,
            metodoPago: metodoPago,
            fecha: new Date().toISOString().split('T')[0]
        });
    });
    
    DB.setAportes(aportes);
    this.reset();
    showToast(`${selectedOptions.length} aporte(s) registrado(s) correctamente`, 'success');
    updateTotalEnCaja();
    renderAporteHistory();
});

// ============= GASTOS SECTION =============

document.getElementById('gastos-form').addEventListener('submit', function(e) {
    e.preventDefault();
    
    const fecha = document.getElementById('fecha-gasto').value;
    const razon = document.getElementById('razon-gasto').value.trim();
    const monto = parseFloat(document.getElementById('monto-gasto').value);
    const metodoPago = document.getElementById('metodo-pago-gasto').value;
    
    if (!razon || !monto || monto <= 0) {
        showToast('Complete todos los campos correctamente', 'warning');
        return;
    }
    
    const gastos = DB.getGastos();
    gastos.push({
        id: generateId(),
        fecha: fecha,
        razon: razon,
        monto: monto,
        metodoPago: metodoPago
    });
    
    DB.setGastos(gastos);
    this.reset();
    document.getElementById('fecha-gasto').value = new Date().toISOString().split('T')[0];
    renderGastoHistory();
    updateTotalEnCaja();
    showToast('Gasto registrado correctamente', 'success');
});

// ============= GASTOS HISTORY LIMPIEZA =============

// ============= TOTAL EN CAJA SECTION =============

function updateTotalEnCaja() {
    const usuarioId = document.getElementById('usuario-total').value;
    const mes = document.getElementById('mes-total').value;
    const desde = document.getElementById('fecha-desde').value;
    const hasta = document.getElementById('fecha-hasta').value;
    
    let aportes = DB.getAportes();
    let gastos = DB.getGastos();
    
    if (usuarioId) {
        aportes = aportes.filter(a => a.usuarioId === usuarioId);
    }
    
    if (mes) {
        aportes = aportes.filter(a => a.fecha.startsWith(mes));
        gastos = gastos.filter(g => g.fecha.startsWith(mes));
    }
    
    if (desde && hasta) {
        aportes = aportes.filter(a => a.fecha >= desde && a.fecha <= hasta);
        gastos = gastos.filter(g => g.fecha >= desde && g.fecha <= hasta);
    }
    
    const totalAportes = aportes.reduce((sum, a) => sum + a.monto, 0);
    const totalGastos = gastos.reduce((sum, g) => sum + g.monto, 0);
    const sobrante = totalAportes - totalGastos;
    
    const formatCurrency = (amount) => `₡ ${amount.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    const aportesEl = document.getElementById('total-aportes-valor');
    const gastosEl = document.getElementById('total-gastos-valor');
    const sobranteEl = document.getElementById('sobrante-valor');
    
    // Add counting animation
    animateValue(aportesEl, 0, totalAportes, 500);
    animateValue(gastosEl, 0, totalGastos, 500);
    animateValue(sobranteEl, 0, sobrante, 500);
}

// Animated counter function
function animateValue(element, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const value = progress * (end - start) + start;
        element.textContent = `₡ ${value.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

document.getElementById('usuario-total').addEventListener('change', updateTotalEnCaja);
document.getElementById('mes-total').addEventListener('change', updateTotalEnCaja);
document.getElementById('fecha-desde').addEventListener('change', updateTotalEnCaja);
document.getElementById('fecha-hasta').addEventListener('change', updateTotalEnCaja);

function exportGastosExcel(mes = null, rango = null) {
    let gastos = DB.getGastos();
    
    if (mes) {
        gastos = gastos.filter(g => g.fecha.startsWith(mes));
    } else if (rango) {
        gastos = gastos.filter(g => g.fecha >= rango.desde && g.fecha <= rango.hasta);
    }
    
    if (gastos.length === 0) {
        showToast('No hay gastos para exportar', 'warning');
        return;
    }
    
    const data = gastos.map(g => ({
        'Fecha': g.fecha,
        'Razón': g.razon,
        'Monto (₡)': g.monto
    }));
    
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Gastos');
    XLSX.writeFile(wb, `reporte-gastos-${mes || rango.desde + '-a-' + rango.hasta}.xlsx`);
    showToast('Reporte de gastos exportado', 'success');
}

document.getElementById('btn-reporte-contribuciones').addEventListener('click', function() {
    const usuarioId = document.getElementById('usuario-total').value;
    const mes = document.getElementById('mes-total').value;
    const desde = document.getElementById('fecha-desde').value;
    const hasta = document.getElementById('fecha-hasta').value;
    
    if (!mes && (!desde || !hasta)) {
        showToast('Seleccione un mes o un rango de fechas', 'warning');
        return;
    }
    
    currentExportFilters = { usuarioId, mes, desde, hasta, tipo: 'contribuciones' };
    showExportFormatModal();
});

document.getElementById('btn-reporte-gastos').addEventListener('click', function() {
    const usuarioId = document.getElementById('usuario-total').value;
    const mes = document.getElementById('mes-total').value;
    const desde = document.getElementById('fecha-desde').value;
    const hasta = document.getElementById('fecha-hasta').value;
    
    if (!mes && (!desde || !hasta)) {
        showToast('Seleccione un mes o un rango de fechas', 'warning');
        return;
    }
    
    currentExportFilters = { usuarioId, mes, desde, hasta, tipo: 'todos' };
    showExportFormatModal();
});

let currentExportFilters = null;

function showExportFormatModal() {
    const modal = new bootstrap.Modal(document.getElementById('exportFormatModal'));
    modal.show();
}

document.getElementById('btn-export-excel').addEventListener('click', function() {
    bootstrap.Modal.getInstance(document.getElementById('exportFormatModal')).hide();
    if (currentExportFilters) {
        exportReporteCompletoExcel(currentExportFilters, 'excel');
    }
});

document.getElementById('btn-export-pdf').addEventListener('click', function() {
    bootstrap.Modal.getInstance(document.getElementById('exportFormatModal')).hide();
    if (currentExportFilters) {
        exportReporteCompletoPDF(currentExportFilters);
    }
});

function exportReporteCompletoExcel(filters, format = 'excel') {
    let aportes = DB.getAportes();
    let gastos = DB.getGastos();
    const usuarios = DB.getUsuarios();
    
    // Apply filters
    if (filters.usuarioId) {
        aportes = aportes.filter(a => a.usuarioId === filters.usuarioId);
    }
    
    if (filters.mes) {
        aportes = aportes.filter(a => a.fecha.startsWith(filters.mes));
        gastos = gastos.filter(g => g.fecha.startsWith(filters.mes));
    }
    
    if (filters.desde && filters.hasta) {
        aportes = aportes.filter(a => a.fecha >= filters.desde && a.fecha <= filters.hasta);
        gastos = gastos.filter(g => g.fecha >= filters.desde && g.fecha <= filters.hasta);
    }
    
    const wb = XLSX.utils.book_new();
    
    // Header info for sheets
    const reportTitle = 'Reporte Control de Gastos';
    const filterInfo = [];
    if (filters.usuarioId) {
        const u = usuarios.find(u => u.id === filters.usuarioId);
        filterInfo.push(`Usuario: ${u ? u.nombre + ' ' + u.primerApellido : 'N/A'}`);
    } else {
        filterInfo.push('Usuario: Todos');
    }
    if (filters.mes) filterInfo.push(`Mes: ${filters.mes}`);
    if (filters.desde && filters.hasta) filterInfo.push(`Rango: ${filters.desde} a ${filters.hasta}`);
    
    // Contributions sheet
    const contribData = [['Reporte de Aportes'], [], filterInfo, [], ['Fecha', 'Usuario', 'Monto (₡)']];
    if (aportes.length > 0) {
        aportes.forEach(a => {
            contribData.push([a.fecha, a.usuarioNombre, a.monto]);
        });
        const totalAportes = aportes.reduce((sum, a) => sum + a.monto, 0);
        contribData.push([]);
        contribData.push(['TOTAL', '', totalAportes]);
    } else {
        contribData.push(['No hay aportes registrados']);
    }
    const wsContrib = XLSX.utils.aoa_to_sheet(contribData);
    XLSX.utils.book_append_sheet(wb, wsContrib, 'Aportes');
    
    // Expenses sheet
    const gastosData = [['Reporte de Gastos'], [], filterInfo, [], ['Fecha', 'Razón', 'Monto (₡)']];
    if (gastos.length > 0) {
        gastos.forEach(g => {
            gastosData.push([g.fecha, g.razon, g.monto]);
        });
        const totalGastos = gastos.reduce((sum, g) => sum + g.monto, 0);
        gastosData.push([]);
        gastosData.push(['TOTAL', '', totalGastos]);
    } else {
        gastosData.push(['No hay gastos registrados']);
    }
    const wsGastos = XLSX.utils.aoa_to_sheet(gastosData);
    XLSX.utils.book_append_sheet(wb, wsGastos, 'Gastos');
    
    // Users status sheet
    const usuariosQueAportaron = [...new Set(aportes.map(a => a.usuarioId))];
    const usuariosSinAportar = usuarios.filter(u => !usuariosQueAportaron.includes(u.id));
    const usuariosAportaron = usuarios.filter(u => usuariosQueAportaron.includes(u.id));
    
    const usuariosData = [
        ['Estado de Usuarios'], [], filterInfo, [],
        ['USUARIOS QUE APORTARON'], [],
        ['Nombre Completo']
    ];
    usuariosAportaron.forEach(u => {
        usuariosData.push([`${u.nombre} ${u.primerApellido} ${u.segundoApellido || ''}`]);
    });
    usuariosData.push([]);
    usuariosData.push([`Cantidad: ${usuariosAportaron.length}`]);
    usuariosData.push([]);
    usuariosData.push(['USUARIOS QUE NO APORTARON'], []);
    usuariosData.push(['Nombre Completo']);
    usuariosSinAportar.forEach(u => {
        usuariosData.push([`${u.nombre} ${u.primerApellido} ${u.segundoApellido || ''}`]);
    });
    usuariosData.push([]);
    usuariosData.push([`Cantidad: ${usuariosSinAportar.length}`]);
    
    const wsUsuarios = XLSX.utils.aoa_to_sheet(usuariosData);
    XLSX.utils.book_append_sheet(wb, wsUsuarios, 'Usuarios');
    
    // Summary sheet
    const totalAportes = aportes.reduce((sum, a) => sum + a.monto, 0);
    const totalGastos = gastos.reduce((sum, g) => sum + g.monto, 0);
    const sobrante = totalAportes - totalGastos;
    
    const summaryData = [
        ['Resumen Financiero'], [], filterInfo, [],
        ['Concepto', 'Monto (₡)'],
        ['Total Aportes', totalAportes],
        ['Total Gastos', totalGastos],
        ['Sobrante (₡)', sobrante]
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen');
    
    const fileName = filters.usuarioId 
        ? `reporte-${filters.tipo}-${new Date().toISOString().split('T')[0]}.xlsx` 
        : `reporte-completo-${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
    showToast('Reporte exportado a Excel', 'success');
}

function exportReporteCompletoPDF(filters) {
    let aportes = DB.getAportes();
    let gastos = DB.getGastos();
    const usuarios = DB.getUsuarios();
    
    // Apply filters
    if (filters.usuarioId) {
        aportes = aportes.filter(a => a.usuarioId === filters.usuarioId);
    }
    
    if (filters.mes) {
        aportes = aportes.filter(a => a.fecha.startsWith(filters.mes));
        gastos = gastos.filter(g => g.fecha.startsWith(filters.mes));
    }
    
    if (filters.desde && filters.hasta) {
        aportes = aportes.filter(a => a.fecha >= filters.desde && a.fecha <= filters.hasta);
        gastos = gastos.filter(g => g.fecha >= filters.desde && g.fecha <= filters.hasta);
    }
    
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    // Header
    doc.setFontSize(22);
    doc.setTextColor(37, 99, 235);
    doc.setFont('helvetica', 'bold');
    doc.text('REPORTE CONTROL DE GASTOS', 105, 20, { align: 'center' });
    
    // Date
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.setFont('helvetica', 'normal');
    const fechaReporte = new Date().toLocaleDateString('es-CR', { 
        day: '2-digit', 
        month: 'long', 
        year: 'numeric' 
    });
    doc.text(`Fecha: ${fechaReporte}`, 105, 28, { align: 'center' });
    
    // Filter info
    doc.setFontSize(9);
    doc.setTextColor(70, 85, 105);
    let filterText = [];
    if (filters.usuarioId) {
        const u = usuarios.find(u => u.id === filters.usuarioId);
        filterText.push(`Usuario: ${u ? u.nombre + ' ' + u.primerApellido : 'N/A'}`);
    } else {
        filterText.push('Usuario: Todos');
    }
    if (filters.mes) filterText.push(`Mes: ${filters.mes}`);
    if (filters.desde && filters.hasta) filterText.push(`Rango: ${filters.desde} a ${filters.hasta}`);
    doc.text(filterText.join('  |  '), 105, 35, { align: 'center' });
    
    let yPos = 45;
    
    // Aportes section
    doc.setFontSize(14);
    doc.setTextColor(5, 150, 105);
    doc.setFont('helvetica', 'bold');
    doc.text('REPORTE DE APORTES', 14, yPos);
    yPos += 8;
    
    // Table header for aportes
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.setFillColor(37, 99, 235);
    doc.rect(14, yPos, 182, 8, 'F');
    doc.text('Fecha', 16, yPos + 5.5);
    doc.text('Usuario', 60, yPos + 5.5);
    doc.text('Monto (₡)', 160, yPos + 5.5);
    yPos += 8;
    
    doc.setTextColor(0);
    doc.setFont('helvetica', 'normal');
    if (aportes.length > 0) {
        aportes.forEach((a, index) => {
            if (index % 2 === 0) {
                doc.setFillColor(248, 250, 252);
                doc.rect(14, yPos - 2, 182, 6, 'F');
            }
            doc.text(a.fecha, 16, yPos + 2);
            doc.text(a.usuarioNombre, 60, yPos + 2);
            doc.text(a.monto.toLocaleString('es-CR'), 160, yPos + 2);
            yPos += 6;
        });
        const totalAportes = aportes.reduce((sum, a) => sum + a.monto, 0);
        yPos += 4;
        doc.setFontSize(11);
        doc.setTextColor(5, 150, 105);
        doc.setFont('helvetica', 'bold');
        doc.text(`TOTAL APORTES: ₡${totalAportes.toLocaleString('es-CR')}`, 16, yPos);
    } else {
        doc.text('No hay aportes registrados', 16, yPos + 2);
    }
    yPos += 15;
    
    // Gastos section
    doc.setFontSize(14);
    doc.setTextColor(220, 38, 38);
    doc.setFont('helvetica', 'bold');
    doc.text('REPORTE DE GASTOS', 14, yPos);
    yPos += 8;
    
    // Table header for gastos
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.setFillColor(220, 38, 38);
    doc.rect(14, yPos, 182, 8, 'F');
    doc.text('Fecha', 16, yPos + 5.5);
    doc.text('Razón', 60, yPos + 5.5);
    doc.text('Monto (₡)', 160, yPos + 5.5);
    yPos += 8;
    
    doc.setTextColor(0);
    doc.setFont('helvetica', 'normal');
    if (gastos.length > 0) {
        gastos.forEach((g, index) => {
            if (index % 2 === 0) {
                doc.setFillColor(248, 250, 252);
                doc.rect(14, yPos - 2, 182, 6, 'F');
            }
            doc.text(g.fecha, 16, yPos + 2);
            doc.text(g.razon, 60, yPos + 2);
            doc.text(g.monto.toLocaleString('es-CR'), 160, yPos + 2);
            yPos += 6;
        });
        const totalGastos = gastos.reduce((sum, g) => sum + g.monto, 0);
        yPos += 4;
        doc.setFontSize(11);
        doc.setTextColor(220, 38, 38);
        doc.setFont('helvetica', 'bold');
        doc.text(`TOTAL GASTOS: ₡${totalGastos.toLocaleString('es-CR')}`, 16, yPos);
    } else {
        doc.text('No hay gastos registrados', 16, yPos + 2);
    }
    yPos += 15;
    
    // Users status
    const usuariosQueAportaron = [...new Set(aportes.map(a => a.usuarioId))];
    const usuariosSinAportar = usuarios.filter(u => !usuariosQueAportaron.includes(u.id));
    const usuariosAportaron = usuarios.filter(u => usuariosQueAportaron.includes(u.id));
    
    if (yPos > 250) {
        doc.addPage();
        yPos = 20;
    }
    
    doc.setFontSize(14);
    doc.setTextColor(37, 99, 235);
    doc.setFont('helvetica', 'bold');
    doc.text('ESTADO DE USUARIOS', 14, yPos);
    yPos += 10;
    
    doc.setFontSize(11);
    doc.setTextColor(5, 150, 105);
    doc.setFont('helvetica', 'bold');
    doc.text(`Usuarios que aportaron (${usuariosAportaron.length}):`, 14, yPos);
    yPos += 7;
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.setFont('helvetica', 'normal');
    usuariosAportaron.forEach(u => {
        doc.text(`• ${u.nombre} ${u.primerApellido} ${u.segundoApellido || ''}`, 18, yPos);
        yPos += 6;
    });
    yPos += 4;
    
    doc.setFontSize(11);
    doc.setTextColor(220, 38, 38);
    doc.setFont('helvetica', 'bold');
    doc.text(`Usuarios que NO aportaron (${usuariosSinAportar.length}):`, 14, yPos);
    yPos += 7;
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.setFont('helvetica', 'normal');
    usuariosSinAportar.forEach(u => {
        doc.text(`• ${u.nombre} ${u.primerApellido} ${u.segundoApellido || ''}`, 18, yPos);
        yPos += 6;
    });
    
    // Summary
    const totalAportesSum = aportes.reduce((sum, a) => sum + a.monto, 0);
    const totalGastosSum = gastos.reduce((sum, g) => sum + g.monto, 0);
    const sobrante = totalAportesSum - totalGastosSum;
    
    yPos += 10;
    doc.setFontSize(14);
    doc.setTextColor(37, 99, 235);
    doc.setFont('helvetica', 'bold');
    doc.text('RESUMEN FINANCIERO', 14, yPos);
    yPos += 10;
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.setFont('helvetica', 'normal');
    doc.text(`Total Aportes: ₡${totalAportesSum.toLocaleString('es-CR')}`, 14, yPos);
    yPos += 7;
    doc.text(`Total Gastos: ₡${totalGastosSum.toLocaleString('es-CR')}`, 14, yPos);
    yPos += 7;
    doc.setTextColor(sobrante >= 0 ? 5 : 220, sobrante >= 0 ? 150 : 38, sobrante >= 0 ? 105 : 38);
    doc.setFont('helvetica', 'bold');
    doc.text(`Sobrante: ₡${sobrante.toLocaleString('es-CR')}`, 14, yPos);
    
    // Footer
    const pageCount = doc.internal.getNumberOfPages();
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.text('Diseñado y programado por: ©Tec.Alberto Hidalgo', 105, 287, { align: 'center' });
    }
    
     const fileName = `reporte-completo-${new Date().toISOString().split('T')[0]}.pdf`;
     doc.save(fileName);
     showToast('Reporte exportado a PDF', 'success');
 }

// ============= APORTE HISTORY =============
function renderAporteHistory() {
    const aportes = DB.getAportes();
    const tbody = document.querySelector('#aporte-history-table tbody');
    
    if (aportes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4"><i class="fas fa-history fa-2x text-muted mb-2"></i><br>No hay aportes registrados</td></tr>';
        return;
    }
    
    tbody.innerHTML = aportes.map((aporte, index) => `
        <tr style="animation: slideInUp 0.3s ease-out ${index * 0.05}s both;">
            <td><span class="badge bg-primary bg-opacity-10 text-primary">#${aporte.id.substring(0, 8)}</span></td>
            <td><i class="fas fa-user me-2 text-primary"></i> ${aporte.usuarioNombre}</td>
            <td>₡ ${aporte.monto.toLocaleString('es-CR')}</td>
            <td>
                <span class="badge ${getMetodoPagoBadgeClass(aporte.metodoPago)}">
                    ${aporte.metodoPago}
                </span>
            </td>
            <td>${aporte.fecha}</td>
            <td>
                <button class="btn btn-sm btn-outline-primary me-1" onclick="editAporte('${aporte.id}')" title="Editar">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="deleteAporte('${aporte.id}')" title="Eliminar">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

// ============= GASTO HISTORY =============
function renderGastoHistory() {
    const gastos = DB.getGastos();
    const tbody = document.querySelector('#gasto-history-table tbody');
    
    if (gastos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4"><i class="fas fa-history fa-2x text-muted mb-2"></i><br>No hay gastos registrados</td></tr>';
        return;
    }
    
    tbody.innerHTML = gastos.map((gasto, index) => `
        <tr style="animation: slideInUp 0.3s ease-out ${index * 0.05}s both;">
            <td><span class="badge bg-primary bg-opacity-10 text-primary">#${gasto.id.substring(0, 8)}</span></td>
            <td>${gasto.fecha}</td>
            <td><i class="fas fa-tag me-2 text-primary"></i> ${gasto.razon}</td>
            <td>₡ ${gasto.monto.toLocaleString('es-CR')}</td>
            <td>
                <span class="badge ${getMetodoPagoBadgeClass(gasto.metodoPago)}">
                    ${gasto.metodoPago}
                </span>
            </td>
            <td>
                <button class="btn btn-sm btn-outline-primary me-1" onclick="editGasto('${gasto.id}')" title="Editar">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="deleteGasto('${gasto.id}')" title="Eliminar">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

// Helper function to get badge class for payment method
function getMetodoPagoBadgeClass(metodo) {
    switch (metodo) {
        case 'Efectivo': return 'bg-success';
        case 'Transferencia': return 'bg-info';
        case 'Sinpe Movil': return 'bg-warning';
        default: return 'bg-secondary';
    }
}

// ============= APORTE EDIT/DELETE FUNCTIONS =============
function openAporteModal(aporte = null) {
    const modal = document.getElementById('aporteModal');
    const modalLabel = document.getElementById('aporteModalLabel');
    const form = document.getElementById('aporte-edit-form');
    
    form.reset();
    document.getElementById('aporte-edit-id').value = '';
    
    if (aporte) {
        modalLabel.innerHTML = '<i class="fas fa-coins"></i> Editar Aporte';
        document.getElementById('aporte-edit-id').value = aporte.id;
        // Set usuario selection (this would need to be implemented based on your usuario selection logic)
        // For simplicity, we're just setting the basic fields
        document.getElementById('aporte-edit-monto').value = aporte.monto;
        document.getElementById('aporte-edit-metodo-pago').value = aporte.metodoPago;
    } else {
        modalLabel.innerHTML = '<i class="fas fa-coins"></i> Nuevo Aporte';
    }
    
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
}

function editAporte(id) {
    const aportes = DB.getAportes();
    const aporte = aportes.find(a => a.id === id);
    openAporteModal(aporte);
}

window.deleteAporte = function(id) {
    if (confirm('¿Está seguro de eliminar este aporte?')) {
        const aportes = DB.getAportes().filter(a => a.id !== id);
        DB.setAportes(aportes);
        renderAporteHistory();
        updateTotalEnCaja();
        showToast('Aporte eliminado correctamente', 'success');
    }
};

// ============= GASTO EDIT/DELETE FUNCTIONS =============
function openGastoModal(gasto = null) {
    const modal = document.getElementById('gastoModal');
    const modalLabel = document.getElementById('gastoModalLabel');
    const form = document.getElementById('gasto-edit-form');
    
    form.reset();
    document.getElementById('gasto-edit-id').value = '';
    
    if (gasto) {
        modalLabel.innerHTML = '<i class="fas fa-receipt"></i> Editar Gasto';
        document.getElementById('gasto-edit-id').value = gasto.id;
        document.getElementById('gasto-edit-fecha').value = gasto.fecha;
        document.getElementById('gasto-edit-razon').value = gasto.razon;
        document.getElementById('gasto-edit-monto').value = gasto.monto;
        document.getElementById('gasto-edit-metodo-pago').value = gasto.metodoPago;
    } else {
        modalLabel.innerHTML = '<i class="fas fa-receipt"></i> Nuevo Gasto';
    }
    
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
}

function editGasto(id) {
    const gastos = DB.getGastos();
    const gasto = gastos.find(g => g.id === id);
    openGastoModal(gasto);
}

window.deleteGasto = function(id) {
    if (confirm('¿Está seguro de eliminar este gasto?')) {
        const gastos = DB.getGastos().filter(g => g.id !== id);
        DB.setGastos(gastos);
        renderGastoHistory();
        updateTotalEnCaja();
        showToast('Gasto eliminado correctamente', 'success');
    }
};

// ============= MODAL SAVE HANDLERS =============
document.getElementById('btn-save-aporte-edit').addEventListener('click', function() {
    const id = document.getElementById('aporte-edit-id').value;
    const monto = parseFloat(document.getElementById('aporte-edit-monto').value);
    const metodoPago = document.getElementById('aporte-edit-metodo-pago').value;
    
    if (!monto || monto <= 0) {
        showToast('Ingrese un monto válido', 'warning');
        return;
    }
    
    const aportes = DB.getAportes();
    const aporteIndex = aportes.findIndex(a => a.id === id);
    
    if (aporteIndex !== -1) {
        // Update existing aporte
        aportes[aporteIndex] = {
            ...aportes[aporteIndex],
            monto: monto,
            metodoPago: metodoPago
        };
        showToast('Aporte actualizado correctamente', 'success');
    } else {
        // This shouldn't happen in edit mode, but just in case
        showToast('Error al actualizar el aporte', 'danger');
    }
    
    DB.setAportes(aportes);
    bootstrap.Modal.getInstance(document.getElementById('aporteModal')).hide();
    renderAporteHistory();
    updateTotalEnCaja();
});

document.getElementById('btn-save-gasto-edit').addEventListener('click', function() {
    const id = document.getElementById('gasto-edit-id').value;
    const fecha = document.getElementById('gasto-edit-fecha').value;
    const razon = document.getElementById('gasto-edit-razon').value.trim();
    const monto = parseFloat(document.getElementById('gasto-edit-monto').value);
    const metodoPago = document.getElementById('gasto-edit-metodo-pago').value;
    
    if (!razon || !monto || monto <= 0) {
        showToast('Complete todos los campos correctamente', 'warning');
        return;
    }
    
    const gastos = DB.getGastos();
    const gastoIndex = gastos.findIndex(g => g.id === id);
    
    if (gastoIndex !== -1) {
        // Update existing gasto
        gastos[gastoIndex] = {
            ...gastos[gastoIndex],
            fecha: fecha,
            razon: razon,
            monto: monto,
            metodoPago: metodoPago
        };
        showToast('Gasto actualizado correctamente', 'success');
    } else {
        // This shouldn't happen in edit mode, but just in case
        showToast('Error al actualizar el gasto', 'danger');
    }
    
    DB.setGastos(gastos);
    bootstrap.Modal.getInstance(document.getElementById('gastoModal')).hide();
    renderGastoHistory();
    updateTotalEnCaja();
});

// ============= REPORTES DE GASTOS =============
// Las funciones de reportes de gastos (mes y rango) están implementadas
// en las líneas siguientes con sus correspondientes modales en el HTML.

// ============= TOTAL EN CAJA SECTION =============
// ============= LIMPIEZA DE HISTORIALES =============
document.getElementById('clear-aporte-history').addEventListener('click', function() {
    if (confirm('¿Está seguro de limpiar todo el historial de aportes?')) {
        DB.clearAportes();
        renderAporteHistory();
        updateTotalEnCaja();
        showToast('Historial de aportes limpiado correctamente', 'success');
    }
});

document.getElementById('clear-gasto-history').addEventListener('click', function() {
    if (confirm('¿Está seguro de limpiar todo el historial de gastos?')) {
        DB.clearGastos();
        renderGastoHistory();
        updateTotalEnCaja();
        showToast('Historial de gastos limpiado correctamente', 'success');
    }
});
