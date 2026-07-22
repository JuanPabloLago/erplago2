--
-- PostgreSQL database dump
--

\restrict WyboxvMO2d7iMn1u67YcsqWUEGkpQlMkoOrMegP9gBemCgAyLoMUc0USjjFdXch

-- Dumped from database version 17.10 (Debian 17.10-0+deb13u1)
-- Dumped by pg_dump version 17.10 (Debian 17.10-0+deb13u1)

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

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: dispositivos_autorizados; Type: TABLE; Schema: public; Owner: juanpablo
--

CREATE TABLE public.dispositivos_autorizados (
    id_dispositivo integer NOT NULL,
    id_empresa integer NOT NULL,
    id_usuario integer NOT NULL,
    fingerprint_hash character varying(64) NOT NULL,
    nombre_dispositivo character varying(100),
    navegador character varying(100),
    sistema_operativo character varying(100),
    ip_hash character varying(64),
    fecha_registro timestamp without time zone DEFAULT now(),
    ultimo_acceso timestamp without time zone DEFAULT now(),
    activo boolean DEFAULT true,
    autorizado_por integer,
    fecha_autorizacion timestamp without time zone,
    notas character varying(255)
);


ALTER TABLE public.dispositivos_autorizados OWNER TO juanpablo;

--
-- Name: dispositivos_autorizados_id_dispositivo_seq; Type: SEQUENCE; Schema: public; Owner: juanpablo
--

CREATE SEQUENCE public.dispositivos_autorizados_id_dispositivo_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.dispositivos_autorizados_id_dispositivo_seq OWNER TO juanpablo;

--
-- Name: dispositivos_autorizados_id_dispositivo_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: juanpablo
--

ALTER SEQUENCE public.dispositivos_autorizados_id_dispositivo_seq OWNED BY public.dispositivos_autorizados.id_dispositivo;


--
-- Name: dispositivos_autorizados id_dispositivo; Type: DEFAULT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.dispositivos_autorizados ALTER COLUMN id_dispositivo SET DEFAULT nextval('public.dispositivos_autorizados_id_dispositivo_seq'::regclass);


--
-- Data for Name: dispositivos_autorizados; Type: TABLE DATA; Schema: public; Owner: juanpablo
--

COPY public.dispositivos_autorizados (id_dispositivo, id_empresa, id_usuario, fingerprint_hash, nombre_dispositivo, navegador, sistema_operativo, ip_hash, fecha_registro, ultimo_acceso, activo, autorizado_por, fecha_autorizacion, notas) FROM stdin;
15	1	5	d0f68874d07a80e6581a0b6cc23fde39db7b78a3b19079add65a4672db60506d	mirta	Chrome	Windows	65552d9cdece19fe480693c73020ca095c1603bcf6482bcbfdf8935a7e2365a9	2026-04-16 08:54:03.678597	2026-05-09 08:42:35.546013	t	2	2026-04-16 08:54:03.678597	
13	1	6	5f4df5925fdd2d65b2de920277f6e8b6c971ace7708d0bb0d936a6c4bbb7c95c	david	Chrome	Windows	c9c21db0dc910a7c6c3779d5a0c347d9799dfe0d3541673b77c71f9e8f8e6969	2026-04-16 08:53:36.812903	2026-05-09 08:45:21.944517	t	2	2026-04-16 08:53:36.812903	
16	1	5	c5c6975e20a407b6e0e28d3a7fe074273a70e11d28d0aa0eae82d228aa829617	Mirt	Chrome	Windows	65552d9cdece19fe480693c73020ca095c1603bcf6482bcbfdf8935a7e2365a9	2026-05-11 08:02:41.061151	2026-06-01 08:32:35.612192	t	2	2026-05-11 08:02:41.061151	
17	1	6	88b08ac64aef66e8e4ccdfaf2c385f4c990435a1321bf0056396130ba73159c8	David	Chrome	Windows	c9c21db0dc910a7c6c3779d5a0c347d9799dfe0d3541673b77c71f9e8f8e6969	2026-05-11 08:15:25.124585	2026-06-01 08:32:54.030784	t	2	2026-05-11 08:15:25.124585	
\.


--
-- Name: dispositivos_autorizados_id_dispositivo_seq; Type: SEQUENCE SET; Schema: public; Owner: juanpablo
--

SELECT pg_catalog.setval('public.dispositivos_autorizados_id_dispositivo_seq', 17, true);


--
-- Name: dispositivos_autorizados dispositivos_autorizados_id_empresa_id_usuario_fingerprint__key; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.dispositivos_autorizados
    ADD CONSTRAINT dispositivos_autorizados_id_empresa_id_usuario_fingerprint__key UNIQUE (id_empresa, id_usuario, fingerprint_hash);


--
-- Name: dispositivos_autorizados dispositivos_autorizados_pkey; Type: CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.dispositivos_autorizados
    ADD CONSTRAINT dispositivos_autorizados_pkey PRIMARY KEY (id_dispositivo);


--
-- Name: idx_disp_empresa_usuario; Type: INDEX; Schema: public; Owner: juanpablo
--

CREATE INDEX idx_disp_empresa_usuario ON public.dispositivos_autorizados USING btree (id_empresa, id_usuario);


--
-- Name: idx_disp_fingerprint; Type: INDEX; Schema: public; Owner: juanpablo
--

CREATE INDEX idx_disp_fingerprint ON public.dispositivos_autorizados USING btree (fingerprint_hash);


--
-- Name: dispositivos_autorizados dispositivos_autorizados_autorizado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.dispositivos_autorizados
    ADD CONSTRAINT dispositivos_autorizados_autorizado_por_fkey FOREIGN KEY (autorizado_por) REFERENCES public.usuarios(id_usuario);


--
-- Name: dispositivos_autorizados dispositivos_autorizados_id_empresa_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.dispositivos_autorizados
    ADD CONSTRAINT dispositivos_autorizados_id_empresa_fkey FOREIGN KEY (id_empresa) REFERENCES public.empresas(id_empresa) ON DELETE CASCADE;


--
-- Name: dispositivos_autorizados dispositivos_autorizados_id_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: juanpablo
--

ALTER TABLE ONLY public.dispositivos_autorizados
    ADD CONSTRAINT dispositivos_autorizados_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuarios(id_usuario) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict WyboxvMO2d7iMn1u67YcsqWUEGkpQlMkoOrMegP9gBemCgAyLoMUc0USjjFdXch

