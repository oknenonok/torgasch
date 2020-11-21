--
-- PostgreSQL database dump
--

-- Dumped from database version 10.16 (Ubuntu 10.16-0ubuntu0.18.04.1)
-- Dumped by pg_dump version 10.16 (Ubuntu 10.16-0ubuntu0.18.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: plpgsql; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS plpgsql WITH SCHEMA pg_catalog;


--
-- Name: EXTENSION plpgsql; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION plpgsql IS 'PL/pgSQL procedural language';


--
-- Name: deal_id; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.deal_id
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


SET default_with_oids = false;

--
-- Name: deals_real; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deals_real (
    id integer DEFAULT nextval('public.deal_id'::regclass) NOT NULL,
    ticker character varying(16),
    figi character varying(32),
    active boolean DEFAULT false NOT NULL,
    level smallint DEFAULT 0 NOT NULL,
    date_start timestamp without time zone,
    date_finish timestamp without time zone,
    date_task timestamp without time zone,
    init_price numeric(20,7),
    next_buy_price numeric(20,7),
    stop_loss_price numeric(20,7),
    take_profit_price numeric(20,7),
    average_price numeric(20,7),
    commission_price numeric(20,7),
    result_price numeric(20,7),
    quantity integer,
    rules json,
    currency character(3),
    state character varying(16),
    operations json[]
);

--
-- Name: deals_real deals_real_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals_real
    ADD CONSTRAINT deals_real_pkey PRIMARY KEY (id);


--
-- PostgreSQL database dump complete
--


