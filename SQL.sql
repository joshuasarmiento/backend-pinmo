-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.admins (
  email text NOT NULL UNIQUE,
  full_name text NOT NULL,
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  is_master_admin boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  is_active boolean DEFAULT true,
  role text DEFAULT 'admin'::text,
  CONSTRAINT admins_pkey PRIMARY KEY (id)
);
CREATE TABLE public.comments (
  post_id integer NOT NULL,
  user_id uuid NOT NULL,
  parent_id uuid,
  content text NOT NULL,
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  depth integer NOT NULL DEFAULT 0 CHECK (depth >= 0 AND depth <= 3),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  is_deleted boolean DEFAULT false,
  CONSTRAINT comments_pkey PRIMARY KEY (id),
  CONSTRAINT comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.comments(id),
  CONSTRAINT comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id)
);
CREATE TABLE public.comments_backup (
  post_id integer NOT NULL,
  user_id uuid NOT NULL,
  content text NOT NULL,
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  is_deleted boolean DEFAULT false,
  CONSTRAINT comments_backup_pkey PRIMARY KEY (id),
  CONSTRAINT comments_backup_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id),
  CONSTRAINT comments_backup_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.notifications (
  user_id uuid NOT NULL,
  type text NOT NULL CHECK (type = ANY (ARRAY['like'::text, 'comment'::text, 'reply'::text])),
  source_id integer,
  source_new_id uuid,
  source_user_id uuid,
  message text NOT NULL,
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  is_read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_source_user_id_fkey FOREIGN KEY (source_user_id) REFERENCES auth.users(id),
  CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.post_likes (
  post_id integer NOT NULL,
  user_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  liked_at timestamp with time zone DEFAULT now(),
  CONSTRAINT post_likes_pkey PRIMARY KEY (id),
  CONSTRAINT post_likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id),
  CONSTRAINT post_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.post_views (
  post_id integer NOT NULL,
  user_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  viewed_at timestamp with time zone DEFAULT now(),
  CONSTRAINT post_views_pkey PRIMARY KEY (id),
  CONSTRAINT post_views_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id),
  CONSTRAINT post_views_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.posts (
  likes double precision DEFAULT '0'::double precision,
  views double precision DEFAULT '0'::double precision,
  type text NOT NULL,
  description text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  location text,
  id integer NOT NULL DEFAULT nextval('posts_id_seq'::regclass),
  timestamp timestamp with time zone DEFAULT now(),
  link text,
  emoji text,
  new_id uuid DEFAULT uuid_generate_v4(),
  resolution_status text DEFAULT 'active'::text,
  image_url jsonb,
  user_id uuid,
  updated_at timestamp with time zone,
  custom_pin text,
  CONSTRAINT posts_pkey PRIMARY KEY (id),
  CONSTRAINT posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.posts_feedback (
  post_id integer,
  action text NOT NULL CHECK (action = ANY (ARRAY['reportMistake'::text, 'verifyReport'::text])),
  description text NOT NULL,
  id integer NOT NULL DEFAULT nextval('posts_feedback_id_seq'::regclass),
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
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text,
  full_address text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  post_id integer,
  admin_id uuid,
  verification_token text,
  reset_password_token text,
  reset_password_expires timestamp with time zone,
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  email_verified boolean DEFAULT false,
  profile_picture text,
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id),
  CONSTRAINT users_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id)
);



#
CREATE POLICY "Allow public read for user profiles" ON users
FOR SELECT
USING (true);

CREATE POLICY "Allow public read for posts" ON posts
FOR SELECT
USING (true);