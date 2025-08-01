-- Enable RLS on comments table
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

-- Policy for viewing comments (anyone can read non-deleted comments)
CREATE POLICY "Anyone can view non-deleted comments" ON public.comments
FOR SELECT USING (is_deleted = false);

-- Policy for creating comments (authenticated users only)
CREATE POLICY "Authenticated users can create comments" ON public.comments
FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND auth.uid() = user_id);

-- Policy for updating comments (users can update their own comments)
CREATE POLICY "Users can update their own comments" ON public.comments
FOR UPDATE USING (auth.uid() = user_id);

-- Policy for deleting comments (users can delete their own comments, admins can delete any)
CREATE POLICY "Users can delete their own comments or admins can delete any" ON public.comments
FOR UPDATE USING (
  auth.uid() = user_id 
  OR 
  EXISTS (
    SELECT 1 FROM public.admins 
    WHERE email = auth.jwt() ->> 'email' 
    AND is_active = true
  )
);