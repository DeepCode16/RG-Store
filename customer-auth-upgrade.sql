alter table public.customers
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null,
  add column if not exists state_text text default '',
  add column if not exists business_name text default '',
  add column if not exists gst_number text default '',
  add column if not exists wishlist jsonb not null default '[]'::jsonb,
  add column if not exists addresses jsonb not null default '[]'::jsonb;

alter table public.orders
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

drop policy if exists "customers read own profile" on public.customers;
drop policy if exists "customers insert own profile" on public.customers;
drop policy if exists "customers update own profile" on public.customers;
drop policy if exists "customers read own orders" on public.orders;
drop policy if exists "customers insert own orders" on public.orders;
drop policy if exists "customers update own orders" on public.orders;

create policy "customers read own profile"
on public.customers for select
to authenticated
using (auth_user_id = auth.uid());

create policy "customers insert own profile"
on public.customers for insert
to authenticated
with check (auth_user_id = auth.uid());

create policy "customers update own profile"
on public.customers for update
to authenticated
using (auth_user_id = auth.uid())
with check (auth_user_id = auth.uid());

create policy "customers read own orders"
on public.orders for select
to authenticated
using (auth_user_id = auth.uid());

create policy "customers insert own orders"
on public.orders for insert
to authenticated
with check (auth_user_id = auth.uid());

create policy "customers update own orders"
on public.orders for update
to authenticated
using (auth_user_id = auth.uid())
with check (auth_user_id = auth.uid());
