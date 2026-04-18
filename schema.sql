create extension if not exists pgcrypto;

create table if not exists public.store_settings (
  id integer primary key default 1 check (id = 1),
  name text not null,
  tagline text default '',
  phone_numbers text[] default '{}',
  email text default '',
  whatsapp text default '',
  shipping_free numeric(10,2) default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id text primary key,
  name text not null,
  emoji text default '📦',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id bigint primary key,
  name text not null,
  category_id text not null references public.categories(id) on delete restrict,
  emoji text default '📦',
  image_url text default '',
  price numeric(10,2) not null default 0,
  mrp numeric(10,2) not null default 0,
  brand text default '',
  weight text default '',
  material text default '',
  size text default '',
  tag text default '',
  in_stock boolean not null default true,
  description text default '',
  specs jsonb not null default '[]'::jsonb,
  rating numeric(3,1) not null default 0,
  reviews integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coupons (
  id text primary key,
  code text not null unique,
  type text not null check (type in ('percent', 'flat')),
  value numeric(10,2) not null default 0,
  min_order numeric(10,2) not null default 0,
  active boolean not null default true,
  uses integer not null default 0,
  description text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  phone text not null unique,
  email text default '',
  city text default '',
  state_text text default '',
  business_name text default '',
  gst_number text default '',
  wishlist jsonb not null default '[]'::jsonb,
  addresses jsonb not null default '[]'::jsonb,
  joined_at timestamptz not null default now(),
  orders_count integer not null default 0,
  total_spent numeric(10,2) not null default 0,
  last_order_at timestamptz
);

create table if not exists public.orders (
  id text primary key,
  auth_user_id uuid references auth.users(id) on delete set null,
  customer_name text not null,
  phone text default '',
  email text default '',
  address_text text default '',
  items jsonb not null default '[]'::jsonb,
  subtotal numeric(10,2) not null default 0,
  shipping numeric(10,2) not null default 0,
  discount numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  pay_method text default 'COD',
  pay_status text default 'pending',
  status text default 'pending',
  note text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.admin_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_profiles
    where id = auth.uid()
      and is_active = true
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

alter table public.store_settings enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.coupons enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.admin_profiles enable row level security;

drop policy if exists "public read store settings" on public.store_settings;
drop policy if exists "public read categories" on public.categories;
drop policy if exists "public read products" on public.products;
drop policy if exists "public read active coupons" on public.coupons;
drop policy if exists "public insert orders" on public.orders;
drop policy if exists "public insert customers" on public.customers;
drop policy if exists "public update customers" on public.customers;
drop policy if exists "admins manage store settings" on public.store_settings;
drop policy if exists "admins manage categories" on public.categories;
drop policy if exists "admins manage products" on public.products;
drop policy if exists "admins manage coupons" on public.coupons;
drop policy if exists "admins read customers" on public.customers;
drop policy if exists "admins manage orders" on public.orders;
drop policy if exists "admins read own profile" on public.admin_profiles;
drop policy if exists "customers read own profile" on public.customers;
drop policy if exists "customers insert own profile" on public.customers;
drop policy if exists "customers update own profile" on public.customers;
drop policy if exists "customers read own orders" on public.orders;
drop policy if exists "customers insert own orders" on public.orders;
drop policy if exists "customers update own orders" on public.orders;

create policy "public read store settings"
on public.store_settings for select
to anon, authenticated
using (true);

create policy "public read categories"
on public.categories for select
to anon, authenticated
using (true);

create policy "public read products"
on public.products for select
to anon, authenticated
using (is_active = true);

create policy "public read active coupons"
on public.coupons for select
to anon, authenticated
using (active = true);

create policy "public insert orders"
on public.orders for insert
to anon, authenticated
with check (true);

create policy "public insert customers"
on public.customers for insert
to anon, authenticated
with check (true);

create policy "public update customers"
on public.customers for update
to anon, authenticated
using (true)
with check (true);

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

create policy "admins manage store settings"
on public.store_settings for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "admins manage categories"
on public.categories for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "admins manage products"
on public.products for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "admins manage coupons"
on public.coupons for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "admins read customers"
on public.customers for select
to authenticated
using (public.is_admin());

create policy "admins manage orders"
on public.orders for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "admins read own profile"
on public.admin_profiles for select
to authenticated
using (id = auth.uid());
