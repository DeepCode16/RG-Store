insert into public.store_settings (id, name, tagline, phone_numbers, email, whatsapp, shipping_free)
values
  (1, 'RG Store', 'Quality Agricultural Hand Tools', array['7209979197', '9241823652'], 'gope7792@gmail.com', '917209979197', 2000)
on conflict (id) do update set
  name = excluded.name,
  tagline = excluded.tagline,
  phone_numbers = excluded.phone_numbers,
  email = excluded.email,
  whatsapp = excluded.whatsapp,
  shipping_free = excluded.shipping_free;

insert into public.categories (id, name, emoji, sort_order)
values
  ('hammer', 'Hammers', '🔨', 1),
  ('pickaxe', 'Pick Axe', '⛏️', 2),
  ('shovel', 'Shovels', '🪣', 3),
  ('crowbar', 'Crow Bar', '🪛', 4),
  ('powrah', 'Powrah/Hoe', '🌾', 5),
  ('blade', 'Blades', '🚜', 6)
on conflict (id) do update set
  name = excluded.name,
  emoji = excluded.emoji,
  sort_order = excluded.sort_order;

insert into public.products (id, name, category_id, emoji, image_url, price, mrp, brand, weight, material, size, tag, in_stock, description, specs, rating, reviews, is_active)
values
  (1, 'RG Hammer 2 LB with Handle', 'hammer', '🔨', '', 299, 450, 'RG', '2 LB', 'Carbon Steel', '2 LB', 'Best Seller', true, 'Heavy duty hammer with wooden handle.', '[["Weight","2 LB"],["Material","Carbon Steel"],["Handle","Fitted"],["Brand","RG"]]'::jsonb, 4.5, 128, true),
  (2, 'RG Hammer 5 LB with Handle', 'hammer', '🔨', '', 380, 550, 'RG', '5 LB', 'Carbon Steel', '5 LB', '', true, 'Heavy 5 LB hammer for tough jobs.', '[["Weight","5 LB"],["Brand","RG"]]'::jsonb, 4.2, 84, true),
  (3, 'RG Pick Axe 1.8 KG', 'pickaxe', '⛏️', '', 380, 550, 'RG', '1.8 KG', 'Alloy Steel', '1.8 KG', 'New', true, 'Pick axe for agriculture and demolition.', '[["Weight","1.8 KG"],["Colors","Black/Red/Blue"],["Brand","RG"]]'::jsonb, 4.6, 57, true),
  (4, 'RG Pick Axe 3.0 KG', 'pickaxe', '⛏️', '', 520, 750, 'RG', '3.0 KG', 'Alloy Steel', '3.0 KG', '', true, 'Heavy duty 3 KG pick axe.', '[["Weight","3.0 KG"],["Brand","RG"]]'::jsonb, 4.4, 43, true),
  (5, 'RG Shovel D-Handle 2.2 KG', 'shovel', '🪣', '', 650, 900, 'RG', '2.2 KG', 'Steel', 'Full Size', 'Best Seller', true, 'Premium RG shovel with D-handle.', '[["Weight","2.2 KG"],["Handle","D-Handle"],["Brand","RG"]]'::jsonb, 4.7, 201, true),
  (6, 'RG Crow Bar 25 MM', 'crowbar', '🪛', '', 280, 400, 'RG', '2.5 KG', 'Carbon Steel', '25 MM', '', true, 'Solid crow bar for prying and demolition.', '[["Size","25 MM"],["Brand","RG"]]'::jsonb, 4.3, 66, true),
  (7, 'RG Powrah 2.5 LB', 'powrah', '🌾', '', 180, 260, 'RG', '1.14 KG', 'Steel', '2.5 LB', '', true, 'Traditional Indian agricultural hoe.', '[["Weight","2.5 LB"],["Brand","RG"]]'::jsonb, 4.4, 95, true),
  (8, 'TEZ Rotavator Blade 57 MM', 'blade', '🚜', '', 890, 1200, 'TEZ', 'Per Set', 'High Carbon Steel', '57 MM', 'Wholesale', true, 'Rotavator blades for tractor tillage.', '[["Centre","57 MM"],["Hole","14.5 MM"],["Brand","TEZ"]]'::jsonb, 4.6, 110, true)
on conflict (id) do update set
  name = excluded.name,
  category_id = excluded.category_id,
  emoji = excluded.emoji,
  image_url = excluded.image_url,
  price = excluded.price,
  mrp = excluded.mrp,
  brand = excluded.brand,
  weight = excluded.weight,
  material = excluded.material,
  size = excluded.size,
  tag = excluded.tag,
  in_stock = excluded.in_stock,
  description = excluded.description,
  specs = excluded.specs,
  rating = excluded.rating,
  reviews = excluded.reviews,
  is_active = excluded.is_active;

insert into public.coupons (id, code, type, value, min_order, active, uses, description)
values
  ('c1', 'WELCOME10', 'percent', 10, 500, true, 12, '10% off for new customers'),
  ('c2', 'FLAT100', 'flat', 100, 1000, true, 5, 'Rs 100 flat off on orders above Rs 1000'),
  ('c3', 'SUMMER20', 'percent', 20, 800, false, 0, 'Summer sale - 20% off')
on conflict (id) do update set
  code = excluded.code,
  type = excluded.type,
  value = excluded.value,
  min_order = excluded.min_order,
  active = excluded.active,
  uses = excluded.uses,
  description = excluded.description;
