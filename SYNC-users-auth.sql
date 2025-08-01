CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, full_address, latitude, longitude, status, email_verified)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'full_address', ''),
    COALESCE((NEW.raw_user_meta_data->>'latitude')::double precision, 0.0),
    COALESCE((NEW.raw_user_meta_data->>'longitude')::double precision, 0.0),
    'pending',
    NEW.email_confirmed_at IS NOT NULL
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();