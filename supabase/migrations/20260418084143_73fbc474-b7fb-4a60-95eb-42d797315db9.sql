drop policy "Public read renders bucket" on storage.objects;

update storage.buckets set public = false where id = 'renders';

create policy "Users read own files in renders"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'renders' and (storage.foldername(name))[1] = auth.uid()::text);