-- Tabla para comprobantes con manejo de contingencia
CREATE TABLE IF NOT EXISTS comprobantes_afip (
    id_comprobante SERIAL PRIMARY KEY,
    tipo_comprobante INTEGER NOT NULL,
    punto_venta INTEGER NOT NULL,
    numero BIGINT NOT NULL,
    fecha INTEGER NOT NULL,
    cliente_cuit BIGINT,
    total DECIMAL(15,2) NOT NULL,
    neto DECIMAL(15,2) NOT NULL,
    iva DECIMAL(15,2) NOT NULL,
    estado VARCHAR(50) DEFAULT 'pendiente_cae',
    cae VARCHAR(20),
    cae_vencimiento VARCHAR(8),
    error_afip TEXT,
    reintentos INTEGER DEFAULT 0,
    json_datos JSONB NOT NULL,
    respuesta_afip JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Índices para optimizar consultas
CREATE INDEX IF NOT EXISTS idx_comprobantes_estado 
ON comprobantes_afip(estado, created_at);

CREATE INDEX IF NOT EXISTS idx_comprobantes_pendientes 
ON comprobantes_afip(estado, reintentos) 
WHERE estado = 'pendiente_cae';

CREATE INDEX IF NOT EXISTS idx_comprobantes_pv_numero
ON comprobantes_afip(punto_venta, numero);

COMMENT ON TABLE comprobantes_afip IS 'Comprobantes electrónicos con manejo de contingencia AFIP';
COMMENT ON COLUMN comprobantes_afip.estado IS 'Estados: borrador, pendiente_cae, autorizado, error_afip, rechazado';
