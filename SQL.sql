-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.
CREATE TABLE public.admins (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  email text NOT NULL UNIQUE,
  full_name text NOT NULL,
  is_master_admin boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  is_active boolean DEFAULT true,
  role text DEFAULT 'admin'::text,
  CONSTRAINT admins_pkey PRIMARY KEY (id)
);
CREATE TABLE public.post_likes (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  post_id integer NOT NULL,
  user_id uuid NOT NULL,
  liked_at timestamp with time zone DEFAULT now(),
  CONSTRAINT post_likes_pkey PRIMARY KEY (id),
  CONSTRAINT post_likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id),
  CONSTRAINT post_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.post_views (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  post_id integer NOT NULL,
  user_id uuid NOT NULL,
  viewed_at timestamp with time zone DEFAULT now(),
  CONSTRAINT post_views_pkey PRIMARY KEY (id),
  CONSTRAINT post_views_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id),
  CONSTRAINT post_views_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.posts (
  id integer NOT NULL DEFAULT nextval('posts_id_seq'::regclass),
  type text NOT NULL,
  description text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  location text,
  timestamp timestamp with time zone DEFAULT now(),
  image_url jsonb,
  link text,
  new_id uuid DEFAULT uuid_generate_v4(),
  resolution_status text DEFAULT 'active'::text,
  likes double precision DEFAULT '0'::double precision,
  views double precision DEFAULT '0'::double precision,
  emoji text,
  user_id uuid,
  updated_at timestamp with time zone,
  custom_pin text,
  CONSTRAINT posts_pkey PRIMARY KEY (id),
  CONSTRAINT posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.posts_feedback (
  id integer NOT NULL DEFAULT nextval('posts_feedback_id_seq'::regclass),
  post_id integer,
  action text NOT NULL CHECK (action = ANY (ARRAY['reportMistake'::text, 'verifyReport'::text])),
  description text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT posts_feedback_pkey PRIMARY KEY (id),
  CONSTRAINT fk_post_id FOREIGN KEY (post_id) REFERENCES public.posts(id)
);
CREATE TABLE public.spatial_ref_sys (
  srid integer NOT NULL CHECK (srid > 0 AND srid <= 998999),
  auth_name character varying,
  auth_srid integer,
  srtext character varying,
  proj4text character varying,
  CONSTRAINT spatial_ref_sys_pkey PRIMARY KEY (srid)
);
CREATE TABLE public.users (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text,
  full_address text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  post_id integer,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  status text NOT NULL DEFAULT 'pending'::text,
  admin_id uuid,
  email_verified boolean DEFAULT false,
  verification_token text,
  reset_password_token text,
  reset_password_expires timestamp with time zone,
  profile_picture text,
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id),
  CONSTRAINT users_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id)
);