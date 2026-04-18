create table public.renders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  prompt text not null,
  render_type text not null,
  accuracy int not null default 7,
  consistency int not null default 7,
  sketch_url text,
  reference_url text,
  result_url text,
  status text not null default 'pending',
  error text,
  created_at timestamptz not null default now()
);

alter table public.renders enable row level security;

create policy "Users can view own renders"
  on public.renders for select
  using (auth.uid() = user_id);

create policy "Users can insert own renders"
  on public.renders for insert
  with check (auth.uid() = user_id);

create policy "Users can update own renders"
  on public.renders for update
  using (auth.uid() = user_id);

create policy "Users can delete own renders"
  on public.renders for delete
  using (auth.uid() = user_id);

create index renders_user_created_idx on public.renders(user_id, created_at desc);

insert into storage.buckets (id, name, public) values ('renders', 'renders', true);

create policy "Public read renders bucket"
  on storage.objects for select
  using (bucket_id = 'renders');

create policy "Authenticated upload to renders"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'renders' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users delete own files in renders"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'renders' and (storage.foldername(name))[1] = auth.uid()::text);