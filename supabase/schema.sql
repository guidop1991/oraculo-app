-- Oráculo · esquema inicial para Supabase (pegalo completo en SQL Editor y ejecutalo una vez).
-- Guarda SOLO lo que la persona acepta compartir. Sin cuenta de administrador dentro de la app:
-- vos ves los datos desde el panel de Supabase (Table Editor), que usa tu login de Supabase.

-- 1) Perfiles (nombre y fecha de nacimiento; país y ciudad quedan listos para más adelante)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  birth date not null check (birth >= date '1900-01-01' and birth <= current_date),
  country text check (char_length(country) <= 60),
  city text check (char_length(city) <= 80),
  consent_at timestamptz not null default now(),
  consent_version text not null default 'v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) Sugerencias y mensajes
create table public.feedback (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  kind text not null default 'sugerencia' check (kind in ('sugerencia', 'mensaje', 'error')),
  message text not null check (char_length(message) between 3 and 1000),
  contact text check (char_length(contact) <= 120),
  app_version text check (char_length(app_version) <= 20)
);

-- 3) Seguridad: cada persona solo ve y toca lo suyo. Nadie lee las sugerencias desde la app.
alter table public.profiles enable row level security;
alter table public.feedback enable row level security;

create policy "perfil: ver el propio" on public.profiles for select to authenticated using (id = auth.uid());
create policy "perfil: crear el propio" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "perfil: editar el propio" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "perfil: borrar el propio" on public.profiles for delete to authenticated using (id = auth.uid());

create policy "sugerencias: enviar" on public.feedback for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

-- 4) updated_at automático
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- 5) "Borrar mi cuenta": la persona elimina todos sus datos desde la app
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
