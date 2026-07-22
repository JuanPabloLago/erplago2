# Manual — Configuraciones del Catálogo Web

> **Última edición:** 2026-05-09
> **Aplica a:** lago.ar (tienda online)
> **Administración:** card "Catálogo Web — Visualización" en `configuraciones.html`

---

## ¿Qué controla esta sección?

La card **"Catálogo Web — Visualización"** del admin define cómo se ven los productos
en el catálogo público de lago.ar dentro de cada pestaña (Corralón, Ferretería, etc).

Toda la configuración vive en la tabla `configuraciones_empresa` y se aplica
automáticamente al **refrescar el sitio**. No hace falta reiniciar PM2 ni nginx.

---

## Modelo de datos (5 niveles)

```
Conjunto (= pestaña web, ej. Corralón)
  └── Categoría raíz (oculta visualmente)
       └── Subcategoría hoja (= UN CARD EN LA WEB, ej. CALES)
            └── Producto padre (= familia, ej. ARENA)
                 └── Producto (item individual con SKU y precio)
```

**Ejemplo concreto** en la pestaña Corralón:

- **Conjunto:** Corralón (slug `corralon`)
- **Categoría raíz:** Corralón Básico (no se muestra en el catálogo)
- **Subcategorías hoja:** ARENAS, CALES, CASCOTES, CEMENTOS, ABERTURAS… (cada una = un card)
  - Adentro de ARENAS: la familia ARENA con sus presentaciones (suelta, x medio, x bolsón…)
  - Adentro de CALES: 2 productos sueltos (Cal Cacique, Cal Milagro)

---

## Las 10 claves, una por una

### `web.catalogo.modo_agrupacion` — default `subcategoria`

Cómo agrupa el catálogo dentro de la pestaña.
- `subcategoria`: cards por subcategoría hoja (lo recomendado).
- `categoria_plana`: lista de productos uno abajo del otro, sin cards. Solo cuando hay menos de 10 productos en la pestaña.

### `web.catalogo.imagen_slot_px` — default `130`

Ancho del cuadrado de imagen en desktop (px). Subí a 160 si querés más visualidad; bajá a 100 si te importa más la densidad de texto.

### `web.catalogo.imagen_slot_px_mobile` — default `90`

Alto del banner de imagen en mobile (menos de 720px). En mobile la imagen va arriba del card como banner, no a la derecha.

### `web.catalogo.imagen_object_fit` — default `contain`

- `contain`: imagen entera, mantiene proporciones. Recomendado para corralón (caños, chapas, perfiles no se cortan).
- `cover`: llena el slot recortando bordes. Mejor para bolsas y cajas cuadradas.

### `web.catalogo.forzar_subcategoria_hoja` — default `true`

Si una categoría tiene hijas, prohíbe asignar productos a la raíz. Evita cards huérfanos en el catálogo.

### `web.catalogo.heuristica_padre_unico` — default `true`

Si una subcategoría contiene UN solo padre con hijos, el card se titula con el nombre del padre (ej. "ARENA" en lugar de "ARENAS"). Más natural.

### `web.catalogo.mostrar_disclaimer_login` — default `true`

Muestra un chip arriba del catálogo: "Iniciá sesión para ver tu precio mayorista" cuando no hay sesión activa. Aclara la diferencia con el precio público.

### `web.imagen.placeholder_modo` — default `iniciales`

Qué muestra el slot cuando el card no tiene imagen.
- `blanco`: slot vacío. No recomendado, parece bug.
- `iniciales`: caja gris con la primera letra del nombre. Recomendado.
- `icono`: el ícono Bootstrap configurado abajo, en gris.
- `url`: imagen genérica desde la URL configurada.

### `web.imagen.placeholder_icono` — default `box-seam`

Nombre del ícono Bootstrap Icons sin prefijo `bi-`. Ejemplos: `box-seam`, `tools`, `brick`, `cart`. Lista completa en https://icons.getbootstrap.com/.

### `web.imagen.herencia_familia` — default `bidireccional`

Cómo se completa la imagen entre productos de una familia.
- `bidireccional`: si el padre no tiene foto toma la del primer hijo; si un hijo no tiene toma la del padre. Cubre todos los casos.
- `padre_hereda_hijo`: solo el padre hereda de los hijos.
- `hijo_hereda_padre`: solo los hijos heredan del padre.
- `ninguno`: cada producto muestra solo su propia foto.

---

## Cómo entrar al admin

1. Andá a `https://lago.ar/configuraciones.html` (o desde el dashboard, botón Configuraciones).
2. Buscá la card verde **"Catálogo Web — Visualización"**. Está cerca del card de Lago.ar y antes de Gestión de Depósitos.
3. Tres tabs (acordeones):
   - **1. Cómo se agrupan los productos**
   - **2. Imágenes y tamaño del card**
   - **3. Cuando un grupo no tiene imagen**
4. Tocás los valores que querés cambiar, apretás **Guardar configuración**.
5. Refrescás `lago.ar/?conjunto=corralon` para ver el cambio.

---

## Casos de uso típicos

### Quiero imágenes más grandes

Tab 2 → subir `Tamaño slot — desktop` de 130 a 160. Guardar. Refrescar.

### Las imágenes se cortan en formas raras

Tab 2 → cambiar `Modo de ajuste` a `contain` (mantener proporciones).

### Cuadrado vacío feo cuando no hay foto

Tab 3 → cambiar `Modo placeholder` a `iniciales` (default). O a `icono` si querés un símbolo en vez de letra.

### Quiero ocultar el cartel de "logueate para ver precio"

Tab 1 → apagar el switch `Mostrar cartel "Iniciá sesión para ver tu precio"`.

---

## Troubleshooting

### "No veo los cambios aplicados"

- Refrescá la página de lago.ar con Ctrl+F5 (forzar recarga sin caché).
- Si no aparece nada, abrí DevTools (F12) → Network → reload → ver si hay errores 500 en `/api/web/conjuntos/tab/...`.

### "El admin no carga los valores existentes"

- Abrí DevTools → Console. Si ves error de auth (401), te volaron la sesión. Logueate de nuevo.
- Si carga pero los inputs quedan vacíos, refrescá. El auto-load corre en DOMContentLoaded.

### "Aparecen iniciales todas iguales"

La inicial se calcula del nombre del card (subcategoría o padre). Si dos cards tienen la misma primera letra, lógicamente comparten inicial. Cambiá a modo `icono` si te molesta.

---

## Cómo agregar configuraciones nuevas a esta card (para devs)

1. Decidí la clave bajo namespace existente (`web.catalogo.*` o `web.imagen.*`) o creá uno nuevo.
2. INSERT en `configuraciones_empresa` con valor default y descripción legible.
3. En `configuraciones.html`, dentro del card `id="cardCatalogoVisual"`, agregá el control HTML:
   - `<input class="..." data-config-key="namespace.tu_clave" data-config-type="bool|text|number">`
4. El JS de carga/guardado las detecta solas por `data-config-key`. No hay que tocar.
5. Documentá la clave nueva en este manual.

---

## Referencias

- Sesión de diseño: `docs/sesiones/2026-05-09_REDISENO_VISTA_CONJUNTO.md`
- Mockup: ver chat de la sesión.
- Helper backend: `src/utils/conjuntos-web.helper.js`.
- Frontend afectado: `/var/www/lago-app/css/vista-conjunto.css` y `/var/www/lago-app/js/vista-conjunto.js`.
