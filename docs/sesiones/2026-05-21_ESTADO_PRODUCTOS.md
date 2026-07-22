# Módulo Estado Productos — 2026-05-21

## Qué hace
- Permite activar/desactivar productos individualmente con motivo opcional y trazabilidad.
- Filtro tri-estado en el listado: Todos (default) / Solo Activos / Solo Inactivos.
- Botón nuevo "Activar Todos" como espejo del "Desactivar Todos" existente.

## Permiso
- `editar_estado_productos` en `permisos_usuario` (default: admin + administrador).
- Configurable desde admin-usuarios.html (gestión por rol).

## Endpoints
- `PATCH /api/productos/:id/estado` body: `{ activo: bool, motivo: string }` → individual.
- `POST /api/productos/activar-masivo` body: `{ ids: [...] }` → masivo activar.
- (Ya existía) Desactivación masiva sin trazabilidad individual.

## Trazabilidad
- Tabla reutilizada: `usuarios_logs` (mismo patrón que togglePermiso).
- Acción: `CAMBIAR_ESTADO_PRODUCTO` (individual) y `ACTIVAR_PRODUCTOS_MASIVO`.

## Configuración
- `productos.estado.filtro_default = 'todos'`

## Pendiente (mejora futura)
- Migrar el "Desactivar Todos" actual al mismo flujo trazable.
- Crear middleware genérico verificarPermiso() para reusar en otros endpoints.
- Sort en backend por activo DESC para que inactivos aparezcan al final cuando estado=todos.
