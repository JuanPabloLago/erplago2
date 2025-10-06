--
-- PostgreSQL database dump
--

\restrict BW01y6OppVYFkdgXUNYESHK0sf2UpI8ygGPt9kBYIn9ZBitAaYs6M8NChFUADEr

-- Dumped from database version 17.6 (Debian 17.6-0+deb13u1)
-- Dumped by pg_dump version 17.6 (Debian 17.6-0+deb13u1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: actualizar_fecha_modificacion(); Type: FUNCTION; Schema: public; Owner: juanpablo
--

CREATE FUNCTION public.actualizar_fecha_modificacion() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.fecha_modificacion = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.actualizar_fecha_modificacion() OWNER TO juanpablo;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: categorias; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.categorias (
    id_categoria integer NOT NULL,
    nombre character varying(100) NOT NULL,
    descripcion text
);


ALTER TABLE public.categorias OWNER TO juanpablo;

--
-- Name: categorias_id_categoria_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.categorias_id_categoria_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.categorias_id_categoria_seq OWNER TO juanpablo;

--
-- Name: categorias_id_categoria_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.categorias_id_categoria_seq OWNED BY public.categorias.id_categoria;


--
-- Name: clientes; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.clientes (
    id_cliente integer NOT NULL,
    id_empresa integer NOT NULL,
    cuit character varying(13),
    razon_social character varying(255) NOT NULL,
    domicilio character varying(255),
    id_condicion_iva integer NOT NULL,
    email character varying(100),
    telefono character varying(50),
    fecha_alta timestamp with time zone DEFAULT now(),
    fecha_modificacion timestamp with time zone DEFAULT now(),
    activo boolean DEFAULT true,
    id_lista_precio integer,
    nombre_fantasia character varying(100),
    tipo_persona character varying(10),
    localidad character varying(80),
    provincia character varying(80),
    codigo_postal character varying(10),
    limite_credito numeric(12,2) DEFAULT 0,
    saldo_actual numeric(12,2) DEFAULT 0,
    observaciones text
);


ALTER TABLE public.clientes OWNER TO juanpablo;

--
-- Name: clientes_id_cliente_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.clientes_id_cliente_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.clientes_id_cliente_seq OWNER TO juanpablo;

--
-- Name: clientes_id_cliente_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.clientes_id_cliente_seq OWNED BY public.clientes.id_cliente;


--
-- Name: condicionesiva; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.condicionesiva (
    id_condicion_iva integer NOT NULL,
    nombre character varying(100) NOT NULL
);


ALTER TABLE public.condicionesiva OWNER TO juanpablo;

--
-- Name: condicionesiva_id_condicion_iva_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.condicionesiva_id_condicion_iva_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.condicionesiva_id_condicion_iva_seq OWNER TO juanpablo;

--
-- Name: condicionesiva_id_condicion_iva_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.condicionesiva_id_condicion_iva_seq OWNED BY public.condicionesiva.id_condicion_iva;


--
-- Name: cuentacorrienteclientes; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.cuentacorrienteclientes (
    id_movimiento_cc_cliente integer NOT NULL,
    id_empresa integer NOT NULL,
    id_cliente integer NOT NULL,
    id_factura integer,
    id_pago integer,
    fecha timestamp with time zone DEFAULT now() NOT NULL,
    concepto character varying(255) NOT NULL,
    debe numeric(14,2) DEFAULT 0,
    haber numeric(14,2) DEFAULT 0,
    saldo numeric(14,2) NOT NULL
);


ALTER TABLE public.cuentacorrienteclientes OWNER TO juanpablo;

--
-- Name: cuentacorrienteclientes_id_movimiento_cc_cliente_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.cuentacorrienteclientes_id_movimiento_cc_cliente_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.cuentacorrienteclientes_id_movimiento_cc_cliente_seq OWNER TO juanpablo;

--
-- Name: cuentacorrienteclientes_id_movimiento_cc_cliente_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.cuentacorrienteclientes_id_movimiento_cc_cliente_seq OWNED BY public.cuentacorrienteclientes.id_movimiento_cc_cliente;


--
-- Name: cuentacorrienteproveedores; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.cuentacorrienteproveedores (
    id_movimiento_cc_proveedor integer NOT NULL,
    id_empresa integer NOT NULL,
    id_proveedor integer NOT NULL,
    id_orden_compra integer,
    fecha timestamp with time zone DEFAULT now() NOT NULL,
    concepto character varying(255) NOT NULL,
    debe numeric(14,2) DEFAULT 0,
    haber numeric(14,2) DEFAULT 0,
    saldo numeric(14,2) NOT NULL
);


ALTER TABLE public.cuentacorrienteproveedores OWNER TO juanpablo;

--
-- Name: cuentacorrienteproveedores_id_movimiento_cc_proveedor_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.cuentacorrienteproveedores_id_movimiento_cc_proveedor_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.cuentacorrienteproveedores_id_movimiento_cc_proveedor_seq OWNER TO juanpablo;

--
-- Name: cuentacorrienteproveedores_id_movimiento_cc_proveedor_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.cuentacorrienteproveedores_id_movimiento_cc_proveedor_seq OWNED BY public.cuentacorrienteproveedores.id_movimiento_cc_proveedor;


--
-- Name: descuentocategoria; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.descuentocategoria (
    id_descuento integer NOT NULL,
    id_categoria integer NOT NULL
);


ALTER TABLE public.descuentocategoria OWNER TO juanpablo;

--
-- Name: descuentocliente; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.descuentocliente (
    id_descuento integer NOT NULL,
    id_cliente integer NOT NULL
);


ALTER TABLE public.descuentocliente OWNER TO juanpablo;

--
-- Name: descuentoproducto; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.descuentoproducto (
    id_descuento integer NOT NULL,
    id_producto integer NOT NULL
);


ALTER TABLE public.descuentoproducto OWNER TO juanpablo;

--
-- Name: descuentos; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.descuentos (
    id_descuento integer NOT NULL,
    nombre character varying(150) NOT NULL,
    descripcion text,
    tipo_descuento character varying(20) NOT NULL,
    valor numeric(10,2) NOT NULL,
    fecha_desde date,
    fecha_hasta date,
    activo boolean DEFAULT true,
    CONSTRAINT descuentos_tipo_descuento_check CHECK (((tipo_descuento)::text = ANY ((ARRAY['porcentaje'::character varying, 'monto_fijo'::character varying])::text[])))
);


ALTER TABLE public.descuentos OWNER TO juanpablo;

--
-- Name: descuentos_id_descuento_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.descuentos_id_descuento_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.descuentos_id_descuento_seq OWNER TO juanpablo;

--
-- Name: descuentos_id_descuento_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.descuentos_id_descuento_seq OWNED BY public.descuentos.id_descuento;


--
-- Name: empresas; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.empresas (
    id_empresa integer NOT NULL,
    cuit character varying(13) NOT NULL,
    razon_social character varying(255) NOT NULL,
    nombre_fantasia character varying(255),
    domicilio_fiscal character varying(255) NOT NULL,
    id_condicion_iva integer NOT NULL,
    fecha_inicio_actividades date,
    telefono character varying(50),
    email character varying(100),
    fecha_creacion timestamp with time zone DEFAULT now(),
    fecha_modificacion timestamp with time zone DEFAULT now(),
    activa boolean DEFAULT true
);


ALTER TABLE public.empresas OWNER TO juanpablo;

--
-- Name: empresas_id_empresa_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.empresas_id_empresa_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.empresas_id_empresa_seq OWNER TO juanpablo;

--
-- Name: empresas_id_empresa_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.empresas_id_empresa_seq OWNED BY public.empresas.id_empresa;


--
-- Name: facturaestados; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.facturaestados (
    id_factura_estado integer NOT NULL,
    nombre character varying(50) NOT NULL
);


ALTER TABLE public.facturaestados OWNER TO juanpablo;

--
-- Name: facturaestados_id_factura_estado_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.facturaestados_id_factura_estado_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.facturaestados_id_factura_estado_seq OWNER TO juanpablo;

--
-- Name: facturaestados_id_factura_estado_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.facturaestados_id_factura_estado_seq OWNED BY public.facturaestados.id_factura_estado;


--
-- Name: facturaitems; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.facturaitems (
    id_factura_item integer NOT NULL,
    id_factura integer NOT NULL,
    id_producto integer NOT NULL,
    descripcion_producto character varying(255) NOT NULL,
    cantidad numeric(10,3) NOT NULL,
    precio_unitario_neto numeric(12,2) NOT NULL,
    porcentaje_iva numeric(5,2) NOT NULL,
    monto_iva_linea numeric(12,2) NOT NULL,
    total_linea numeric(12,2) NOT NULL
);


ALTER TABLE public.facturaitems OWNER TO juanpablo;

--
-- Name: facturaitems_id_factura_item_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.facturaitems_id_factura_item_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.facturaitems_id_factura_item_seq OWNER TO juanpablo;

--
-- Name: facturaitems_id_factura_item_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.facturaitems_id_factura_item_seq OWNED BY public.facturaitems.id_factura_item;


--
-- Name: facturas; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.facturas (
    id_factura integer NOT NULL,
    id_empresa integer NOT NULL,
    id_cliente integer NOT NULL,
    id_pedido integer,
    id_tipo_comprobante integer NOT NULL,
    id_factura_estado integer DEFAULT 1 NOT NULL,
    punto_venta integer NOT NULL,
    numero_comprobante integer NOT NULL,
    fecha_emision date NOT NULL,
    cae character varying(14),
    fecha_vencimiento_cae date,
    neto_gravado numeric(14,2) NOT NULL,
    monto_iva numeric(14,2) NOT NULL,
    monto_total numeric(14,2) NOT NULL
);


ALTER TABLE public.facturas OWNER TO juanpablo;

--
-- Name: facturas_id_factura_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.facturas_id_factura_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.facturas_id_factura_seq OWNER TO juanpablo;

--
-- Name: facturas_id_factura_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.facturas_id_factura_seq OWNED BY public.facturas.id_factura;


--
-- Name: inventario; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.inventario (
    id_empresa integer NOT NULL,
    id_producto integer NOT NULL,
    stock_real integer DEFAULT 0,
    stock_minimo integer DEFAULT 0,
    stock_maximo integer DEFAULT 0,
    publicado_web boolean DEFAULT false,
    fecha_creacion timestamp with time zone DEFAULT now(),
    fecha_modificacion timestamp with time zone DEFAULT now()
);


ALTER TABLE public.inventario OWNER TO juanpablo;

--
-- Name: listaprecioproductos; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.listaprecioproductos (
    id_lista_precio integer NOT NULL,
    id_producto integer NOT NULL,
    precio numeric(12,2) NOT NULL
);


ALTER TABLE public.listaprecioproductos OWNER TO juanpablo;

--
-- Name: listasdeprecios; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.listasdeprecios (
    id_lista_precio integer NOT NULL,
    nombre character varying(100) NOT NULL,
    descripcion text,
    activa boolean DEFAULT true
);


ALTER TABLE public.listasdeprecios OWNER TO juanpablo;

--
-- Name: listasdeprecios_id_lista_precio_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.listasdeprecios_id_lista_precio_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.listasdeprecios_id_lista_precio_seq OWNER TO juanpablo;

--
-- Name: listasdeprecios_id_lista_precio_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.listasdeprecios_id_lista_precio_seq OWNED BY public.listasdeprecios.id_lista_precio;


--
-- Name: metodosdepago; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.metodosdepago (
    id_metodo_pago integer NOT NULL,
    nombre character varying(100) NOT NULL
);


ALTER TABLE public.metodosdepago OWNER TO juanpablo;

--
-- Name: metodosdepago_id_metodo_pago_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.metodosdepago_id_metodo_pago_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.metodosdepago_id_metodo_pago_seq OWNER TO juanpablo;

--
-- Name: metodosdepago_id_metodo_pago_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.metodosdepago_id_metodo_pago_seq OWNED BY public.metodosdepago.id_metodo_pago;


--
-- Name: ordencompraestados; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.ordencompraestados (
    id_estado_oc integer NOT NULL,
    nombre character varying(50) NOT NULL
);


ALTER TABLE public.ordencompraestados OWNER TO juanpablo;

--
-- Name: ordencompraestados_id_estado_oc_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.ordencompraestados_id_estado_oc_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ordencompraestados_id_estado_oc_seq OWNER TO juanpablo;

--
-- Name: ordencompraestados_id_estado_oc_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.ordencompraestados_id_estado_oc_seq OWNED BY public.ordencompraestados.id_estado_oc;


--
-- Name: ordendecompraitems; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.ordendecompraitems (
    id_orden_compra integer NOT NULL,
    id_producto integer NOT NULL,
    cantidad_pedida numeric(10,3) NOT NULL,
    cantidad_recibida numeric(10,3) DEFAULT 0.000 NOT NULL,
    precio_costo_unitario numeric(12,2) NOT NULL,
    porcentaje_iva numeric(5,2) NOT NULL
);


ALTER TABLE public.ordendecompraitems OWNER TO juanpablo;

--
-- Name: ordenesdecompra; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.ordenesdecompra (
    id_orden_compra integer NOT NULL,
    id_empresa integer NOT NULL,
    id_proveedor integer NOT NULL,
    id_estado_oc integer DEFAULT 1 NOT NULL,
    fecha_emision timestamp with time zone DEFAULT now(),
    fecha_entrega_prevista date,
    monto_total numeric(14,2) DEFAULT 0.00,
    domicilio_entrega text,
    condiciones_pago text,
    observaciones text
);


ALTER TABLE public.ordenesdecompra OWNER TO juanpablo;

--
-- Name: ordenesdecompra_id_orden_compra_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.ordenesdecompra_id_orden_compra_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ordenesdecompra_id_orden_compra_seq OWNER TO juanpablo;

--
-- Name: ordenesdecompra_id_orden_compra_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.ordenesdecompra_id_orden_compra_seq OWNED BY public.ordenesdecompra.id_orden_compra;


--
-- Name: pagoestados; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.pagoestados (
    id_pago_estado integer NOT NULL,
    nombre character varying(50) NOT NULL
);


ALTER TABLE public.pagoestados OWNER TO juanpablo;

--
-- Name: pagoestados_id_pago_estado_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.pagoestados_id_pago_estado_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pagoestados_id_pago_estado_seq OWNER TO juanpablo;

--
-- Name: pagoestados_id_pago_estado_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.pagoestados_id_pago_estado_seq OWNED BY public.pagoestados.id_pago_estado;


--
-- Name: pagos; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.pagos (
    id_pago integer NOT NULL,
    id_pedido integer NOT NULL,
    id_metodo_pago integer NOT NULL,
    id_pago_estado integer DEFAULT 1 NOT NULL,
    fecha_pago timestamp with time zone NOT NULL,
    monto numeric(12,2) NOT NULL,
    id_transaccion_externa character varying(255),
    observaciones text,
    fecha_creacion timestamp with time zone DEFAULT now()
);


ALTER TABLE public.pagos OWNER TO juanpablo;

--
-- Name: pagos_id_pago_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.pagos_id_pago_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pagos_id_pago_seq OWNER TO juanpablo;

--
-- Name: pagos_id_pago_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.pagos_id_pago_seq OWNED BY public.pagos.id_pago;


--
-- Name: pagosaproveedores; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.pagosaproveedores (
    id_pago_proveedor integer NOT NULL,
    id_empresa integer NOT NULL,
    id_proveedor integer NOT NULL,
    id_orden_compra integer,
    id_metodo_pago integer NOT NULL,
    fecha_pago timestamp with time zone DEFAULT now(),
    monto numeric(14,2) NOT NULL,
    referencia_pago character varying(255),
    observaciones text
);


ALTER TABLE public.pagosaproveedores OWNER TO juanpablo;

--
-- Name: pagosaproveedores_id_pago_proveedor_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.pagosaproveedores_id_pago_proveedor_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pagosaproveedores_id_pago_proveedor_seq OWNER TO juanpablo;

--
-- Name: pagosaproveedores_id_pago_proveedor_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.pagosaproveedores_id_pago_proveedor_seq OWNED BY public.pagosaproveedores.id_pago_proveedor;


--
-- Name: pedidoestados; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.pedidoestados (
    id_estado integer NOT NULL,
    nombre character varying(50) NOT NULL
);


ALTER TABLE public.pedidoestados OWNER TO juanpablo;

--
-- Name: pedidoestados_id_estado_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.pedidoestados_id_estado_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pedidoestados_id_estado_seq OWNER TO juanpablo;

--
-- Name: pedidoestados_id_estado_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.pedidoestados_id_estado_seq OWNED BY public.pedidoestados.id_estado;


--
-- Name: pedidoitems; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.pedidoitems (
    id_pedido integer NOT NULL,
    id_producto integer NOT NULL,
    cantidad numeric(10,2) NOT NULL,
    descripcion_congelada character varying(255),
    precio_unitario_congelado numeric(12,2) NOT NULL,
    porcentaje_descuento numeric(5,2) DEFAULT 0,
    monto_iva numeric(12,2) NOT NULL,
    total_linea numeric(14,2) NOT NULL
);


ALTER TABLE public.pedidoitems OWNER TO juanpablo;

--
-- Name: pedidos; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.pedidos (
    id_pedido integer NOT NULL,
    id_empresa integer NOT NULL,
    id_cliente integer NOT NULL,
    id_estado integer NOT NULL,
    fecha_creacion timestamp with time zone DEFAULT now(),
    fecha_entrega_pactada date,
    total numeric(14,2) NOT NULL,
    valor_dolar_momento numeric(10,4),
    domicilio_entrega text,
    observaciones text
);


ALTER TABLE public.pedidos OWNER TO juanpablo;

--
-- Name: pedidos_id_pedido_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.pedidos_id_pedido_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pedidos_id_pedido_seq OWNER TO juanpablo;

--
-- Name: pedidos_id_pedido_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.pedidos_id_pedido_seq OWNED BY public.pedidos.id_pedido;


--
-- Name: precios; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.precios (
    id_producto integer NOT NULL,
    id_lista_precio integer NOT NULL,
    precio numeric(12,2) NOT NULL
);


ALTER TABLE public.precios OWNER TO juanpablo;

--
-- Name: productocodigosbarras; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.productocodigosbarras (
    codigo_barras character varying(100) NOT NULL,
    id_producto integer NOT NULL
);


ALTER TABLE public.productocodigosbarras OWNER TO juanpablo;

--
-- Name: productos; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.productos (
    id_producto integer NOT NULL,
    sku character varying(50) NOT NULL,
    nombre character varying(255) NOT NULL,
    descripcion text,
    id_categoria integer,
    unidad_medida character varying(20) DEFAULT 'unidades'::character varying,
    marca character varying(100),
    cod_proveedor character varying(50),
    fecha_creacion timestamp with time zone DEFAULT now(),
    fecha_modificacion timestamp with time zone DEFAULT now(),
    activo boolean DEFAULT true,
    url_imagen character varying(255)
);


ALTER TABLE public.productos OWNER TO juanpablo;

--
-- Name: productos_id_producto_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.productos_id_producto_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.productos_id_producto_seq OWNER TO juanpablo;

--
-- Name: productos_id_producto_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.productos_id_producto_seq OWNED BY public.productos.id_producto;


--
-- Name: proveedores; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.proveedores (
    id_proveedor integer NOT NULL,
    id_empresa integer NOT NULL,
    cuit character varying(13) NOT NULL,
    razon_social character varying(255) NOT NULL,
    nombre_fantasia character varying(255),
    rubro character varying(100),
    id_condicion_iva integer NOT NULL,
    email character varying(100),
    telefono character varying(50),
    domicilio character varying(255),
    contacto_nombre character varying(100),
    contacto_puesto character varying(100),
    fecha_creacion timestamp with time zone DEFAULT now(),
    fecha_modificacion timestamp with time zone DEFAULT now(),
    activo boolean DEFAULT true
);


ALTER TABLE public.proveedores OWNER TO juanpablo;

--
-- Name: proveedores_id_proveedor_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.proveedores_id_proveedor_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.proveedores_id_proveedor_seq OWNER TO juanpablo;

--
-- Name: proveedores_id_proveedor_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.proveedores_id_proveedor_seq OWNED BY public.proveedores.id_proveedor;


--
-- Name: recibopagos; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.recibopagos (
    id_recibo integer NOT NULL,
    id_pago integer NOT NULL
);


ALTER TABLE public.recibopagos OWNER TO juanpablo;

--
-- Name: recibos; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.recibos (
    id_recibo integer NOT NULL,
    id_empresa integer NOT NULL,
    id_cliente integer NOT NULL,
    numero_recibo character varying(50),
    fecha_emision timestamp with time zone DEFAULT now(),
    total numeric(14,2) NOT NULL,
    observaciones text
);


ALTER TABLE public.recibos OWNER TO juanpablo;

--
-- Name: recibos_id_recibo_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.recibos_id_recibo_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.recibos_id_recibo_seq OWNER TO juanpablo;

--
-- Name: recibos_id_recibo_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.recibos_id_recibo_seq OWNED BY public.recibos.id_recibo;


--
-- Name: remitoestados; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.remitoestados (
    id_remito_estado integer NOT NULL,
    nombre character varying(50) NOT NULL
);


ALTER TABLE public.remitoestados OWNER TO juanpablo;

--
-- Name: remitoestados_id_remito_estado_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.remitoestados_id_remito_estado_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.remitoestados_id_remito_estado_seq OWNER TO juanpablo;

--
-- Name: remitoestados_id_remito_estado_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.remitoestados_id_remito_estado_seq OWNED BY public.remitoestados.id_remito_estado;


--
-- Name: remitoitems; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.remitoitems (
    id_remito integer NOT NULL,
    id_producto integer NOT NULL,
    cantidad_entregada numeric(10,2) NOT NULL
);


ALTER TABLE public.remitoitems OWNER TO juanpablo;

--
-- Name: remitos; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.remitos (
    id_remito integer NOT NULL,
    id_pedido integer NOT NULL,
    id_remito_estado integer NOT NULL,
    numero_remito character varying(50),
    fecha_emision timestamp with time zone DEFAULT now(),
    fecha_envio timestamp with time zone,
    fecha_entrega_real timestamp with time zone,
    domicilio_entrega text,
    datos_transporte text,
    observaciones text
);


ALTER TABLE public.remitos OWNER TO juanpablo;

--
-- Name: remitos_id_remito_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.remitos_id_remito_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.remitos_id_remito_seq OWNER TO juanpablo;

--
-- Name: remitos_id_remito_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.remitos_id_remito_seq OWNED BY public.remitos.id_remito;


--
-- Name: tiposdecomprobante; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.tiposdecomprobante (
    id_tipo_comprobante integer NOT NULL,
    codigo_afip character varying(3),
    nombre character varying(50) NOT NULL
);


ALTER TABLE public.tiposdecomprobante OWNER TO juanpablo;

--
-- Name: tiposdecomprobante_id_tipo_comprobante_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.tiposdecomprobante_id_tipo_comprobante_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tiposdecomprobante_id_tipo_comprobante_seq OWNER TO juanpablo;

--
-- Name: tiposdecomprobante_id_tipo_comprobante_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.tiposdecomprobante_id_tipo_comprobante_seq OWNED BY public.tiposdecomprobante.id_tipo_comprobante;


--
-- Name: usuarios; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.usuarios (
    id_usuario integer NOT NULL,
    username character varying(50) NOT NULL,
    password_hash character varying(255) NOT NULL,
    email character varying(100) NOT NULL,
    nombre character varying(100),
    rol character varying(50) NOT NULL,
    estado character varying(15) DEFAULT 'activo'::character varying NOT NULL,
    ultimo_login timestamp with time zone,
    fecha_creacion timestamp with time zone DEFAULT now(),
    fecha_modificacion timestamp with time zone,
    id_empresa integer,
    CONSTRAINT usuarios_estado_check CHECK (((estado)::text = ANY ((ARRAY['activo'::character varying, 'inactivo'::character varying, 'suspendido'::character varying])::text[])))
);


ALTER TABLE public.usuarios OWNER TO juanpablo;

--
-- Name: usuarios_id_usuario_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.usuarios_id_usuario_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.usuarios_id_usuario_seq OWNER TO juanpablo;

--
-- Name: usuarios_id_usuario_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.usuarios_id_usuario_seq OWNED BY public.usuarios.id_usuario;


--
-- Name: usuarios_logs; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.usuarios_logs (
    id_log bigint NOT NULL,
    id_usuario integer,
    accion character varying(100) NOT NULL,
    detalle text,
    ip_origen character varying(45),
    dispositivo character varying(100),
    fecha_evento timestamp with time zone DEFAULT now()
);


ALTER TABLE public.usuarios_logs OWNER TO juanpablo;

--
-- Name: usuarios_logs_id_log_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.usuarios_logs_id_log_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.usuarios_logs_id_log_seq OWNER TO juanpablo;

--
-- Name: usuarios_logs_id_log_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.usuarios_logs_id_log_seq OWNED BY public.usuarios_logs.id_log;


--
-- Name: categorias id_categoria; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.categorias ALTER COLUMN id_categoria SET DEFAULT nextval('public.categorias_id_categoria_seq'::regclass);


--
-- Name: clientes id_cliente; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.clientes ALTER COLUMN id_cliente SET DEFAULT nextval('public.clientes_id_cliente_seq'::regclass);


--
-- Name: condicionesiva id_condicion_iva; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.condicionesiva ALTER COLUMN id_condicion_iva SET DEFAULT nextval('public.condicionesiva_id_condicion_iva_seq'::regclass);


--
-- Name: cuentacorrienteclientes id_movimiento_cc_cliente; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.cuentacorrienteclientes ALTER COLUMN id_movimiento_cc_cliente SET DEFAULT nextval('public.cuentacorrienteclientes_id_movimiento_cc_cliente_seq'::regclass);


--
-- Name: cuentacorrienteproveedores id_movimiento_cc_proveedor; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.cuentacorrienteproveedores ALTER COLUMN id_movimiento_cc_proveedor SET DEFAULT nextval('public.cuentacorrienteproveedores_id_movimiento_cc_proveedor_seq'::regclass);


--
-- Name: descuentos id_descuento; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.descuentos ALTER COLUMN id_descuento SET DEFAULT nextval('public.descuentos_id_descuento_seq'::regclass);


--
-- Name: empresas id_empresa; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.empresas ALTER COLUMN id_empresa SET DEFAULT nextval('public.empresas_id_empresa_seq'::regclass);


--
-- Name: facturaestados id_factura_estado; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.facturaestados ALTER COLUMN id_factura_estado SET DEFAULT nextval('public.facturaestados_id_factura_estado_seq'::regclass);


--
-- Name: facturaitems id_factura_item; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.facturaitems ALTER COLUMN id_factura_item SET DEFAULT nextval('public.facturaitems_id_factura_item_seq'::regclass);


--
-- Name: facturas id_factura; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.facturas ALTER COLUMN id_factura SET DEFAULT nextval('public.facturas_id_factura_seq'::regclass);


--
-- Name: listasdeprecios id_lista_precio; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.listasdeprecios ALTER COLUMN id_lista_precio SET DEFAULT nextval('public.listasdeprecios_id_lista_precio_seq'::regclass);


--
-- Name: metodosdepago id_metodo_pago; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.metodosdepago ALTER COLUMN id_metodo_pago SET DEFAULT nextval('public.metodosdepago_id_metodo_pago_seq'::regclass);


--
-- Name: ordencompraestados id_estado_oc; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.ordencompraestados ALTER COLUMN id_estado_oc SET DEFAULT nextval('public.ordencompraestados_id_estado_oc_seq'::regclass);


--
-- Name: ordenesdecompra id_orden_compra; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.ordenesdecompra ALTER COLUMN id_orden_compra SET DEFAULT nextval('public.ordenesdecompra_id_orden_compra_seq'::regclass);


--
-- Name: pagoestados id_pago_estado; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.pagoestados ALTER COLUMN id_pago_estado SET DEFAULT nextval('public.pagoestados_id_pago_estado_seq'::regclass);


--
-- Name: pagos id_pago; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.pagos ALTER COLUMN id_pago SET DEFAULT nextval('public.pagos_id_pago_seq'::regclass);


--
-- Name: pagosaproveedores id_pago_proveedor; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.pagosaproveedores ALTER COLUMN id_pago_proveedor SET DEFAULT nextval('public.pagosaproveedores_id_pago_proveedor_seq'::regclass);


--
-- Name: pedidoestados id_estado; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.pedidoestados ALTER COLUMN id_estado SET DEFAULT nextval('public.pedidoestados_id_estado_seq'::regclass);


--
-- Name: pedidos id_pedido; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.pedidos ALTER COLUMN id_pedido SET DEFAULT nextval('public.pedidos_id_pedido_seq'::regclass);


--
-- Name: productos id_producto; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.productos ALTER COLUMN id_producto SET DEFAULT nextval('public.productos_id_producto_seq'::regclass);


--
-- Name: proveedores id_proveedor; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.proveedores ALTER COLUMN id_proveedor SET DEFAULT nextval('public.proveedores_id_proveedor_seq'::regclass);


--
-- Name: recibos id_recibo; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.recibos ALTER COLUMN id_recibo SET DEFAULT nextval('public.recibos_id_recibo_seq'::regclass);


--
-- Name: remitoestados id_remito_estado; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.remitoestados ALTER COLUMN id_remito_estado SET DEFAULT nextval('public.remitoestados_id_remito_estado_seq'::regclass);


--
-- Name: remitos id_remito; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.remitos ALTER COLUMN id_remito SET DEFAULT nextval('public.remitos_id_remito_seq'::regclass);


--
-- Name: tiposdecomprobante id_tipo_comprobante; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.tiposdecomprobante ALTER COLUMN id_tipo_comprobante SET DEFAULT nextval('public.tiposdecomprobante_id_tipo_comprobante_seq'::regclass);


--
-- Name: usuarios id_usuario; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.usuarios ALTER COLUMN id_usuario SET DEFAULT nextval('public.usuarios_id_usuario_seq'::regclass);


--
-- Name: usuarios_logs id_log; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.usuarios_logs ALTER COLUMN id_log SET DEFAULT nextval('public.usuarios_logs_id_log_seq'::regclass);


--
-- Name: categorias categorias_nombre_key; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.categorias
    ADD CONSTRAINT categorias_nombre_key UNIQUE (nombre);


--
-- Name: categorias categorias_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.categorias
    ADD CONSTRAINT categorias_pkey PRIMARY KEY (id_categoria);


--
-- Name: clientes clientes_id_empresa_cuit_cuil_key; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_id_empresa_cuit_cuil_key UNIQUE (id_empresa, cuit);


--
-- Name: clientes clientes_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_pkey PRIMARY KEY (id_cliente);


--
-- Name: condicionesiva condicionesiva_nombre_key; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.condicionesiva
    ADD CONSTRAINT condicionesiva_nombre_key UNIQUE (nombre);


--
-- Name: condicionesiva condicionesiva_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.condicionesiva
    ADD CONSTRAINT condicionesiva_pkey PRIMARY KEY (id_condicion_iva);


--
-- Name: cuentacorrienteclientes cuentacorrienteclientes_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.cuentacorrienteclientes
    ADD CONSTRAINT cuentacorrienteclientes_pkey PRIMARY KEY (id_movimiento_cc_cliente);


--
-- Name: cuentacorrienteproveedores cuentacorrienteproveedores_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.cuentacorrienteproveedores
    ADD CONSTRAINT cuentacorrienteproveedores_pkey PRIMARY KEY (id_movimiento_cc_proveedor);


--
-- Name: descuentocategoria descuentocategoria_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.descuentocategoria
    ADD CONSTRAINT descuentocategoria_pkey PRIMARY KEY (id_descuento, id_categoria);


--
-- Name: descuentocliente descuentocliente_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.descuentocliente
    ADD CONSTRAINT descuentocliente_pkey PRIMARY KEY (id_descuento, id_cliente);


--
-- Name: descuentoproducto descuentoproducto_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.descuentoproducto
    ADD CONSTRAINT descuentoproducto_pkey PRIMARY KEY (id_descuento, id_producto);


--
-- Name: descuentos descuentos_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.descuentos
    ADD CONSTRAINT descuentos_pkey PRIMARY KEY (id_descuento);


--
-- Name: empresas empresas_cuit_key; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.empresas
    ADD CONSTRAINT empresas_cuit_key UNIQUE (cuit);


--
-- Name: empresas empresas_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.empresas
    ADD CONSTRAINT empresas_pkey PRIMARY KEY (id_empresa);


--
-- Name: facturaestados facturaestados_nombre_key; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.facturaestados
    ADD CONSTRAINT facturaestados_nombre_key UNIQUE (nombre);


--
-- Name: facturaestados facturaestados_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.facturaestados
    ADD CONSTRAINT facturaestados_pkey PRIMARY KEY (id_factura_estado);


--
-- Name: facturaitems facturaitems_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.facturaitems
    ADD CONSTRAINT facturaitems_pkey PRIMARY KEY (id_factura_item);


--
-- Name: facturas facturas_id_empresa_id_tipo_comprobante_punto_venta_numero__key; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.facturas
    ADD CONSTRAINT facturas_id_empresa_id_tipo_comprobante_punto_venta_numero__key UNIQUE (id_empresa, id_tipo_comprobante, punto_venta, numero_comprobante);


--
-- Name: facturas facturas_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.facturas
    ADD CONSTRAINT facturas_pkey PRIMARY KEY (id_factura);


--
-- Name: inventario inventario_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.inventario
    ADD CONSTRAINT inventario_pkey PRIMARY KEY (id_empresa, id_producto);


--
-- Name: listaprecioproductos listaprecioproductos_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.listaprecioproductos
    ADD CONSTRAINT listaprecioproductos_pkey PRIMARY KEY (id_lista_precio, id_producto);


--
-- Name: listasdeprecios listasdeprecios_nombre_key; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.listasdeprecios
    ADD CONSTRAINT listasdeprecios_nombre_key UNIQUE (nombre);


--
-- Name: listasdeprecios listasdeprecios_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.listasdeprecios
    ADD CONSTRAINT listasdeprecios_pkey PRIMARY KEY (id_lista_precio);


--
-- Name: metodosdepago metodosdepago_nombre_key; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.metodosdepago
    ADD CONSTRAINT metodosdepago_nombre_key UNIQUE (nombre);


--
-- Name: metodosdepago metodosdepago_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.metodosdepago
    ADD CONSTRAINT metodosdepago_pkey PRIMARY KEY (id_metodo_pago);


--
-- Name: ordencompraestados ordencompraestados_nombre_key; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.ordencompraestados
    ADD CONSTRAINT ordencompraestados_nombre_key UNIQUE (nombre);


--
-- Name: ordencompraestados ordencompraestados_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.ordencompraestados
    ADD CONSTRAINT ordencompraestados_pkey PRIMARY KEY (id_estado_oc);


--
-- Name: ordendecompraitems ordendecompraitems_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.ordendecompraitems
    ADD CONSTRAINT ordendecompraitems_pkey PRIMARY KEY (id_orden_compra, id_producto);


--
-- Name: ordenesdecompra ordenesdecompra_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.ordenesdecompra
    ADD CONSTRAINT ordenesdecompra_pkey PRIMARY KEY (id_orden_compra);


--
-- Name: pagoestados pagoestados_nombre_key; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.pagoestados
    ADD CONSTRAINT pagoestados_nombre_key UNIQUE (nombre);


--
-- Name: pagoestados pagoestados_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.pagoestados
    ADD CONSTRAINT pagoestados_pkey PRIMARY KEY (id_pago_estado);


--
-- Name: pagos pagos_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_pkey PRIMARY KEY (id_pago);


--
-- Name: pagosaproveedores pagosaproveedores_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.pagosaproveedores
    ADD CONSTRAINT pagosaproveedores_pkey PRIMARY KEY (id_pago_proveedor);


--
-- Name: pedidoestados pedidoestados_nombre_key; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.pedidoestados
    ADD CONSTRAINT pedidoestados_nombre_key UNIQUE (nombre);


--
-- Name: pedidoestados pedidoestados_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.pedidoestados
    ADD CONSTRAINT pedidoestados_pkey PRIMARY KEY (id_estado);


--
-- Name: pedidoitems pedidoitems_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.pedidoitems
    ADD CONSTRAINT pedidoitems_pkey PRIMARY KEY (id_pedido, id_producto);


--
-- Name: pedidos pedidos_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.pedidos
    ADD CONSTRAINT pedidos_pkey PRIMARY KEY (id_pedido);


--
-- Name: precios precios_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.precios
    ADD CONSTRAINT precios_pkey PRIMARY KEY (id_producto, id_lista_precio);


--
-- Name: productocodigosbarras productocodigosbarras_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.productocodigosbarras
    ADD CONSTRAINT productocodigosbarras_pkey PRIMARY KEY (codigo_barras);


--
-- Name: productos productos_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.productos
    ADD CONSTRAINT productos_pkey PRIMARY KEY (id_producto);


--
-- Name: productos productos_sku_key; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.productos
    ADD CONSTRAINT productos_sku_key UNIQUE (sku);


--
-- Name: proveedores proveedores_id_empresa_cuit_key; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.proveedores
    ADD CONSTRAINT proveedores_id_empresa_cuit_key UNIQUE (id_empresa, cuit);


--
-- Name: proveedores proveedores_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.proveedores
    ADD CONSTRAINT proveedores_pkey PRIMARY KEY (id_proveedor);


--
-- Name: recibopagos recibopagos_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.recibopagos
    ADD CONSTRAINT recibopagos_pkey PRIMARY KEY (id_recibo, id_pago);


--
-- Name: recibos recibos_numero_recibo_key; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.recibos
    ADD CONSTRAINT recibos_numero_recibo_key UNIQUE (numero_recibo);


--
-- Name: recibos recibos_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.recibos
    ADD CONSTRAINT recibos_pkey PRIMARY KEY (id_recibo);


--
-- Name: remitoestados remitoestados_nombre_key; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.remitoestados
    ADD CONSTRAINT remitoestados_nombre_key UNIQUE (nombre);


--
-- Name: remitoestados remitoestados_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.remitoestados
    ADD CONSTRAINT remitoestados_pkey PRIMARY KEY (id_remito_estado);


--
-- Name: remitoitems remitoitems_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.remitoitems
    ADD CONSTRAINT remitoitems_pkey PRIMARY KEY (id_remito, id_producto);


--
-- Name: remitos remitos_numero_remito_key; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.remitos
    ADD CONSTRAINT remitos_numero_remito_key UNIQUE (numero_remito);


--
-- Name: remitos remitos_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.remitos
    ADD CONSTRAINT remitos_pkey PRIMARY KEY (id_remito);


--
-- Name: tiposdecomprobante tiposdecomprobante_nombre_key; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.tiposdecomprobante
    ADD CONSTRAINT tiposdecomprobante_nombre_key UNIQUE (nombre);


--
-- Name: tiposdecomprobante tiposdecomprobante_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.tiposdecomprobante
    ADD CONSTRAINT tiposdecomprobante_pkey PRIMARY KEY (id_tipo_comprobante);


--
-- Name: usuarios usuarios_email_key; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_email_key UNIQUE (email);


--
-- Name: usuarios_logs usuarios_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.usuarios_logs
    ADD CONSTRAINT usuarios_logs_pkey PRIMARY KEY (id_log);


--
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id_usuario);


--
-- Name: usuarios usuarios_username_key; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_username_key UNIQUE (username);


--
-- Name: clientes trigger_clientes_modificacion; Type: TRIGGER; Schema: public; Owner: juanpablo
--

CREATE TRIGGER trigger_clientes_modificacion BEFORE UPDATE ON public.clientes FOR EACH ROW EXECUTE FUNCTION public.actualizar_fecha_modificacion();


--
-- Name: empresas trigger_empresas_modificacion; Type: TRIGGER; Schema: public; Owner: juanpablo
--

CREATE TRIGGER trigger_empresas_modificacion BEFORE UPDATE ON public.empresas FOR EACH ROW EXECUTE FUNCTION public.actualizar_fecha_modificacion();


--
-- Name: inventario trigger_inventario_modificacion; Type: TRIGGER; Schema: public; Owner: juanpablo
--

CREATE TRIGGER trigger_inventario_modificacion BEFORE UPDATE ON public.inventario FOR EACH ROW EXECUTE FUNCTION public.actualizar_fecha_modificacion();


--
-- Name: productos trigger_productos_modificacion; Type: TRIGGER; Schema: public; Owner: juanpablo
--

CREATE TRIGGER trigger_productos_modificacion BEFORE UPDATE ON public.productos FOR EACH ROW EXECUTE FUNCTION public.actualizar_fecha_modificacion();


--
-- Name: proveedores trigger_proveedores_modificacion; Type: TRIGGER; Schema: public; Owner: juanpablo
--

CREATE TRIGGER trigger_proveedores_modificacion BEFORE UPDATE ON public.proveedores FOR EACH ROW EXECUTE FUNCTION public.actualizar_fecha_modificacion();


--
-- Name: clientes clientes_id_condicion_iva_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_id_condicion_iva_fkey FOREIGN KEY (id_condicion_iva) REFERENCES public.condicionesiva(id_condicion_iva);


--
-- Name: clientes clientes_id_empresa_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_id_empresa_fkey FOREIGN KEY (id_empresa) REFERENCES public.empresas(id_empresa) ON DELETE CASCADE;


--
-- Name: clientes clientes_id_lista_precio_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_id_lista_precio_fkey FOREIGN KEY (id_lista_precio) REFERENCES public.listasdeprecios(id_lista_precio);


--
-- Name: cuentacorrienteclientes cuentacorrienteclientes_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.cuentacorrienteclientes
    ADD CONSTRAINT cuentacorrienteclientes_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.clientes(id_cliente) ON DELETE CASCADE;


--
-- Name: cuentacorrienteclientes cuentacorrienteclientes_id_empresa_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.cuentacorrienteclientes
    ADD CONSTRAINT cuentacorrienteclientes_id_empresa_fkey FOREIGN KEY (id_empresa) REFERENCES public.empresas(id_empresa);


--
-- Name: cuentacorrienteclientes cuentacorrienteclientes_id_factura_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.cuentacorrienteclientes
    ADD CONSTRAINT cuentacorrienteclientes_id_factura_fkey FOREIGN KEY (id_factura) REFERENCES public.facturas(id_factura);


--
-- Name: cuentacorrienteclientes cuentacorrienteclientes_id_pago_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.cuentacorrienteclientes
    ADD CONSTRAINT cuentacorrienteclientes_id_pago_fkey FOREIGN KEY (id_pago) REFERENCES public.pagos(id_pago);


--
-- Name: cuentacorrienteproveedores cuentacorrienteproveedores_id_empresa_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.cuentacorrienteproveedores
    ADD CONSTRAINT cuentacorrienteproveedores_id_empresa_fkey FOREIGN KEY (id_empresa) REFERENCES public.empresas(id_empresa);


--
-- Name: cuentacorrienteproveedores cuentacorrienteproveedores_id_orden_compra_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.cuentacorrienteproveedores
    ADD CONSTRAINT cuentacorrienteproveedores_id_orden_compra_fkey FOREIGN KEY (id_orden_compra) REFERENCES public.ordenesdecompra(id_orden_compra);


--
-- Name: cuentacorrienteproveedores cuentacorrienteproveedores_id_proveedor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.cuentacorrienteproveedores
    ADD CONSTRAINT cuentacorrienteproveedores_id_proveedor_fkey FOREIGN KEY (id_proveedor) REFERENCES public.proveedores(id_proveedor) ON DELETE CASCADE;


--
-- Name: descuentocategoria descuentocategoria_id_categoria_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.descuentocategoria
    ADD CONSTRAINT descuentocategoria_id_categoria_fkey FOREIGN KEY (id_categoria) REFERENCES public.categorias(id_categoria) ON DELETE CASCADE;


--
-- Name: descuentocategoria descuentocategoria_id_descuento_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.descuentocategoria
    ADD CONSTRAINT descuentocategoria_id_descuento_fkey FOREIGN KEY (id_descuento) REFERENCES public.descuentos(id_descuento) ON DELETE CASCADE;


--
-- Name: descuentocliente descuentocliente_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.descuentocliente
    ADD CONSTRAINT descuentocliente_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.clientes(id_cliente) ON DELETE CASCADE;


--
-- Name: descuentocliente descuentocliente_id_descuento_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.descuentocliente
    ADD CONSTRAINT descuentocliente_id_descuento_fkey FOREIGN KEY (id_descuento) REFERENCES public.descuentos(id_descuento) ON DELETE CASCADE;


--
-- Name: descuentoproducto descuentoproducto_id_descuento_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.descuentoproducto
    ADD CONSTRAINT descuentoproducto_id_descuento_fkey FOREIGN KEY (id_descuento) REFERENCES public.descuentos(id_descuento) ON DELETE CASCADE;


--
-- Name: descuentoproducto descuentoproducto_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.descuentoproducto
    ADD CONSTRAINT descuentoproducto_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.productos(id_producto) ON DELETE CASCADE;


--
-- Name: empresas empresas_id_condicion_iva_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.empresas
    ADD CONSTRAINT empresas_id_condicion_iva_fkey FOREIGN KEY (id_condicion_iva) REFERENCES public.condicionesiva(id_condicion_iva);


--
-- Name: facturaitems facturaitems_id_factura_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.facturaitems
    ADD CONSTRAINT facturaitems_id_factura_fkey FOREIGN KEY (id_factura) REFERENCES public.facturas(id_factura) ON DELETE CASCADE;


--
-- Name: facturaitems facturaitems_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.facturaitems
    ADD CONSTRAINT facturaitems_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.productos(id_producto);


--
-- Name: facturas facturas_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.facturas
    ADD CONSTRAINT facturas_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.clientes(id_cliente);


--
-- Name: facturas facturas_id_empresa_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.facturas
    ADD CONSTRAINT facturas_id_empresa_fkey FOREIGN KEY (id_empresa) REFERENCES public.empresas(id_empresa);


--
-- Name: facturas facturas_id_factura_estado_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.facturas
    ADD CONSTRAINT facturas_id_factura_estado_fkey FOREIGN KEY (id_factura_estado) REFERENCES public.facturaestados(id_factura_estado);


--
-- Name: facturas facturas_id_pedido_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.facturas
    ADD CONSTRAINT facturas_id_pedido_fkey FOREIGN KEY (id_pedido) REFERENCES public.pedidos(id_pedido);


--
-- Name: facturas facturas_id_tipo_comprobante_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.facturas
    ADD CONSTRAINT facturas_id_tipo_comprobante_fkey FOREIGN KEY (id_tipo_comprobante) REFERENCES public.tiposdecomprobante(id_tipo_comprobante);


--
-- Name: usuarios fk_empresa; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT fk_empresa FOREIGN KEY (id_empresa) REFERENCES public.empresas(id_empresa);


--
-- Name: inventario inventario_id_empresa_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.inventario
    ADD CONSTRAINT inventario_id_empresa_fkey FOREIGN KEY (id_empresa) REFERENCES public.empresas(id_empresa);


--
-- Name: inventario inventario_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.inventario
    ADD CONSTRAINT inventario_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.productos(id_producto);


--
-- Name: listaprecioproductos listaprecioproductos_id_lista_precio_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.listaprecioproductos
    ADD CONSTRAINT listaprecioproductos_id_lista_precio_fkey FOREIGN KEY (id_lista_precio) REFERENCES public.listasdeprecios(id_lista_precio);


--
-- Name: listaprecioproductos listaprecioproductos_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.listaprecioproductos
    ADD CONSTRAINT listaprecioproductos_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.productos(id_producto);


--
-- Name: ordendecompraitems ordendecompraitems_id_orden_compra_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.ordendecompraitems
    ADD CONSTRAINT ordendecompraitems_id_orden_compra_fkey FOREIGN KEY (id_orden_compra) REFERENCES public.ordenesdecompra(id_orden_compra) ON DELETE CASCADE;


--
-- Name: ordendecompraitems ordendecompraitems_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.ordendecompraitems
    ADD CONSTRAINT ordendecompraitems_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.productos(id_producto) ON DELETE RESTRICT;


--
-- Name: ordenesdecompra ordenesdecompra_id_empresa_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.ordenesdecompra
    ADD CONSTRAINT ordenesdecompra_id_empresa_fkey FOREIGN KEY (id_empresa) REFERENCES public.empresas(id_empresa);


--
-- Name: ordenesdecompra ordenesdecompra_id_estado_oc_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.ordenesdecompra
    ADD CONSTRAINT ordenesdecompra_id_estado_oc_fkey FOREIGN KEY (id_estado_oc) REFERENCES public.ordencompraestados(id_estado_oc);


--
-- Name: ordenesdecompra ordenesdecompra_id_proveedor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.ordenesdecompra
    ADD CONSTRAINT ordenesdecompra_id_proveedor_fkey FOREIGN KEY (id_proveedor) REFERENCES public.proveedores(id_proveedor) ON DELETE RESTRICT;


--
-- Name: pagos pagos_id_metodo_pago_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_id_metodo_pago_fkey FOREIGN KEY (id_metodo_pago) REFERENCES public.metodosdepago(id_metodo_pago);


--
-- Name: pagos pagos_id_pago_estado_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_id_pago_estado_fkey FOREIGN KEY (id_pago_estado) REFERENCES public.pagoestados(id_pago_estado);


--
-- Name: pagos pagos_id_pedido_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_id_pedido_fkey FOREIGN KEY (id_pedido) REFERENCES public.pedidos(id_pedido) ON DELETE CASCADE;


--
-- Name: pagosaproveedores pagosaproveedores_id_empresa_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.pagosaproveedores
    ADD CONSTRAINT pagosaproveedores_id_empresa_fkey FOREIGN KEY (id_empresa) REFERENCES public.empresas(id_empresa);


--
-- Name: pagosaproveedores pagosaproveedores_id_metodo_pago_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.pagosaproveedores
    ADD CONSTRAINT pagosaproveedores_id_metodo_pago_fkey FOREIGN KEY (id_metodo_pago) REFERENCES public.metodosdepago(id_metodo_pago);


--
-- Name: pagosaproveedores pagosaproveedores_id_orden_compra_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.pagosaproveedores
    ADD CONSTRAINT pagosaproveedores_id_orden_compra_fkey FOREIGN KEY (id_orden_compra) REFERENCES public.ordenesdecompra(id_orden_compra);


--
-- Name: pagosaproveedores pagosaproveedores_id_proveedor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.pagosaproveedores
    ADD CONSTRAINT pagosaproveedores_id_proveedor_fkey FOREIGN KEY (id_proveedor) REFERENCES public.proveedores(id_proveedor);


--
-- Name: pedidoitems pedidoitems_id_pedido_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.pedidoitems
    ADD CONSTRAINT pedidoitems_id_pedido_fkey FOREIGN KEY (id_pedido) REFERENCES public.pedidos(id_pedido) ON DELETE CASCADE;


--
-- Name: pedidoitems pedidoitems_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.pedidoitems
    ADD CONSTRAINT pedidoitems_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.productos(id_producto);


--
-- Name: pedidos pedidos_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.pedidos
    ADD CONSTRAINT pedidos_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.clientes(id_cliente);


--
-- Name: pedidos pedidos_id_empresa_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.pedidos
    ADD CONSTRAINT pedidos_id_empresa_fkey FOREIGN KEY (id_empresa) REFERENCES public.empresas(id_empresa);


--
-- Name: pedidos pedidos_id_estado_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.pedidos
    ADD CONSTRAINT pedidos_id_estado_fkey FOREIGN KEY (id_estado) REFERENCES public.pedidoestados(id_estado);


--
-- Name: precios precios_id_lista_precio_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.precios
    ADD CONSTRAINT precios_id_lista_precio_fkey FOREIGN KEY (id_lista_precio) REFERENCES public.listasdeprecios(id_lista_precio) ON DELETE CASCADE;


--
-- Name: precios precios_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.precios
    ADD CONSTRAINT precios_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.productos(id_producto) ON DELETE CASCADE;


--
-- Name: productocodigosbarras productocodigosbarras_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.productocodigosbarras
    ADD CONSTRAINT productocodigosbarras_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.productos(id_producto) ON DELETE CASCADE;


--
-- Name: productos productos_id_categoria_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.productos
    ADD CONSTRAINT productos_id_categoria_fkey FOREIGN KEY (id_categoria) REFERENCES public.categorias(id_categoria);


--
-- Name: proveedores proveedores_id_condicion_iva_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.proveedores
    ADD CONSTRAINT proveedores_id_condicion_iva_fkey FOREIGN KEY (id_condicion_iva) REFERENCES public.condicionesiva(id_condicion_iva);


--
-- Name: proveedores proveedores_id_empresa_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.proveedores
    ADD CONSTRAINT proveedores_id_empresa_fkey FOREIGN KEY (id_empresa) REFERENCES public.empresas(id_empresa) ON DELETE CASCADE;


--
-- Name: recibopagos recibopagos_id_pago_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.recibopagos
    ADD CONSTRAINT recibopagos_id_pago_fkey FOREIGN KEY (id_pago) REFERENCES public.pagos(id_pago) ON DELETE CASCADE;


--
-- Name: recibopagos recibopagos_id_recibo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.recibopagos
    ADD CONSTRAINT recibopagos_id_recibo_fkey FOREIGN KEY (id_recibo) REFERENCES public.recibos(id_recibo) ON DELETE CASCADE;


--
-- Name: recibos recibos_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.recibos
    ADD CONSTRAINT recibos_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.clientes(id_cliente);


--
-- Name: recibos recibos_id_empresa_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.recibos
    ADD CONSTRAINT recibos_id_empresa_fkey FOREIGN KEY (id_empresa) REFERENCES public.empresas(id_empresa);


--
-- Name: remitoitems remitoitems_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.remitoitems
    ADD CONSTRAINT remitoitems_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.productos(id_producto);


--
-- Name: remitoitems remitoitems_id_remito_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.remitoitems
    ADD CONSTRAINT remitoitems_id_remito_fkey FOREIGN KEY (id_remito) REFERENCES public.remitos(id_remito) ON DELETE CASCADE;


--
-- Name: remitos remitos_id_pedido_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.remitos
    ADD CONSTRAINT remitos_id_pedido_fkey FOREIGN KEY (id_pedido) REFERENCES public.pedidos(id_pedido);


--
-- Name: remitos remitos_id_remito_estado_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.remitos
    ADD CONSTRAINT remitos_id_remito_estado_fkey FOREIGN KEY (id_remito_estado) REFERENCES public.remitoestados(id_remito_estado);


--
-- Name: usuarios_logs usuarios_logs_id_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.usuarios_logs
    ADD CONSTRAINT usuarios_logs_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuarios(id_usuario) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict BW01y6OppVYFkdgXUNYESHK0sf2UpI8ygGPt9kBYIn9ZBitAaYs6M8NChFUADEr

