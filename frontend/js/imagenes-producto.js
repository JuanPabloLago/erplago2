/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * imagenes-producto.js — Modal gestión imágenes múltiples por producto
 *
 * Entrada: window.ImagenesProductoModal.abrir(id_producto, nombre_producto)
 * Drag&drop nativo HTML5 para reordenar. Bootstrap 5 Modal sin jQuery.
 *
 * Delega 100% en window.API (config.js):
 *   - auth (CONFIG.TOKEN_KEY)
 *   - base URL (CONFIG.API_BASE_URL)
 *   - manejo de errores (excepción si !response.ok)
 *
 * Endpoints consumidos (mounted en /api/productos/):
 *   GET    /productos/:id/imagenes
 *   POST   /productos/:id/imagenes               { url, alt_text }
 *   POST   /productos/:id/imagenes/reordenar     { orden_ids }
 *   PUT    /productos/:id/imagenes/:id_img/principal
 *   DELETE /productos/:id/imagenes/:id_img
 * ═══════════════════════════════════════════════════════════════════════════════
 */
window.ImagenesProductoModal = (function() {
  let estado = { id_producto: null, nombre: '', items: [] };

  function _base() {
    return '/productos/' + estado.id_producto + '/imagenes';
  }

  async function abrir(id_producto, nombre_producto) {
    estado = { id_producto: id_producto, nombre: nombre_producto || '', items: [] };
    const titulo = document.getElementById('mip-titulo');
    if (titulo) titulo.textContent = 'Imagenes — ' + (nombre_producto || ('producto #' + id_producto));
    const inUrl = document.getElementById('mip-input-url');
    const inAlt = document.getElementById('mip-input-alt');
    if (inUrl) inUrl.value = '';
    if (inAlt) inAlt.value = '';
    _mostrarMsg('', '');
    await _recargar();
    const modalEl = document.getElementById('modalImagenesProducto');
    if (modalEl && window.bootstrap) {
      new bootstrap.Modal(modalEl).show();
    }
  }

  async function _recargar() {
    try {
      const data = await window.API.get(_base());
      estado.items = data.items || [];
      _render();
    } catch (err) {
      _mostrarMsg('Error al cargar: ' + err.message, 'danger');
    }
  }

  function _render() {
    const cont = document.getElementById('mip-lista');
    if (!cont) return;
    if (estado.items.length === 0) {
      cont.innerHTML = '<div class="text-muted text-center py-4">Sin imagenes. Pega una URL arriba para agregar la primera.</div>';
      return;
    }
    cont.innerHTML = estado.items.map(function(img) {
      return ''
        + '<div class="mip-item d-flex align-items-center gap-2 p-2 border rounded mb-2" draggable="true" data-id="' + img.id_imagen + '">'
        +   '<i class="bi bi-grip-vertical text-muted" style="cursor:grab"></i>'
        +   '<img src="' + img.url + '" alt="' + (img.alt_text || '') + '" style="width:60px;height:60px;object-fit:cover;border-radius:4px;background:#f8f9fa" onerror="this.style.opacity=0.3">'
        +   '<div class="flex-grow-1 small" style="min-width:0">'
        +     '<div class="text-truncate"><code>' + img.url + '</code></div>'
        +     (img.alt_text ? '<div class="text-muted">' + img.alt_text + '</div>' : '')
        +   '</div>'
        +   '<button class="btn btn-sm ' + (img.es_principal ? 'btn-success' : 'btn-outline-secondary') + '" onclick="ImagenesProductoModal.marcarPrincipal(' + img.id_imagen + ')" title="' + (img.es_principal ? 'Es principal' : 'Marcar principal') + '">'
        +     '<i class="bi bi-star' + (img.es_principal ? '-fill' : '') + '"></i>'
        +   '</button>'
        +   '<button class="btn btn-sm btn-outline-danger" onclick="ImagenesProductoModal.eliminar(' + img.id_imagen + ')" title="Eliminar">'
        +     '<i class="bi bi-trash"></i>'
        +   '</button>'
        + '</div>';
    }).join('');
    _attachDrag();
  }

  function _attachDrag() {
    const items = document.querySelectorAll('#mip-lista .mip-item');
    let src = null;
    items.forEach(function(item) {
      item.addEventListener('dragstart', function(e) {
        src = item; item.classList.add('opacity-50');
        e.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragend', function() { item.classList.remove('opacity-50'); });
      item.addEventListener('dragover', function(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
      item.addEventListener('drop', async function(e) {
        e.preventDefault();
        if (!src || src === item) return;
        const rect = item.getBoundingClientRect();
        const antes = (e.clientY - rect.top) < rect.height / 2;
        const cont = document.getElementById('mip-lista');
        cont.insertBefore(src, antes ? item : item.nextSibling);
        await _persistirOrden();
      });
    });
  }

  async function _persistirOrden() {
    const ids = Array.from(document.querySelectorAll('#mip-lista .mip-item'))
      .map(function(el) { return parseInt(el.dataset.id, 10); });
    try {
      await window.API.post(_base() + '/reordenar', { orden_ids: ids });
      await _recargar();
      _mostrarMsg('Orden guardado', 'success');
    } catch (err) {
      _mostrarMsg('Error al reordenar: ' + err.message, 'danger');
      await _recargar();
    }
  }

  async function agregar() {
    const inUrl = document.getElementById('mip-input-url');
    const inAlt = document.getElementById('mip-input-alt');
    const url = (inUrl && inUrl.value || '').trim();
    const alt_text = (inAlt && inAlt.value || '').trim() || null;
    if (!url) { _mostrarMsg('Pega una URL', 'warning'); return; }
    try {
      _mostrarMsg('Agregando...', 'info');
      await window.API.post(_base(), { url: url, alt_text: alt_text });
      if (inUrl) inUrl.value = '';
      if (inAlt) inAlt.value = '';
      await _recargar();
      _mostrarMsg('Imagen agregada', 'success');
    } catch (err) {
      _mostrarMsg('Error: ' + err.message, 'danger');
    }
  }

  async function marcarPrincipal(id_imagen) {
    try {
      await window.API.put(_base() + '/' + id_imagen + '/principal');
      await _recargar();
      _mostrarMsg('Imagen principal actualizada', 'success');
    } catch (err) {
      _mostrarMsg('Error: ' + err.message, 'danger');
    }
  }

  async function eliminar(id_imagen) {
    if (!confirm('¿Eliminar esta imagen del producto?')) return;
    try {
      await window.API.delete(_base() + '/' + id_imagen);
      await _recargar();
      _mostrarMsg('Imagen eliminada', 'success');
    } catch (err) {
      _mostrarMsg('Error: ' + err.message, 'danger');
    }
  }

  function _mostrarMsg(texto, tipo) {
    const el = document.getElementById('mip-mensaje');
    if (!el) return;
    if (!texto) { el.textContent = ''; el.className = ''; return; }
    el.className = 'alert alert-' + (tipo || 'info') + ' py-1 px-2 mb-2 small';
    el.textContent = texto;
    if (tipo === 'success' || tipo === 'info') {
      setTimeout(function() { if (el.textContent === texto) { el.textContent = ''; el.className = ''; } }, 2500);
    }
  }

  return { abrir: abrir, agregar: agregar, marcarPrincipal: marcarPrincipal, eliminar: eliminar };
})();
