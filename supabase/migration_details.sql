-- Adds Swiggy/Zomato-style detail columns. Additive only; safe to re-run.
alter table restaurants
  add column if not exists cuisines text[],
  add column if not exists address text,
  add column if not exists cost_for_two int,
  add column if not exists delivery_fee int,
  add column if not exists packaging_charge int,
  add column if not exists min_order_amount int,
  add column if not exists offer_text text,
  add column if not exists opens_at time,
  add column if not exists closes_at time,
  add column if not exists fssai_license text,
  add column if not exists service_modes text[],
  add column if not exists badges text[];

alter table dishes
  add column if not exists description text,
  add column if not exists menu_section text,
  add column if not exists is_egg boolean not null default false,
  add column if not exists mrp int,
  add column if not exists serves int,
  add column if not exists portion text,
  add column if not exists calories int,
  add column if not exists allergens text[],
  add column if not exists prep_time_min int,
  add column if not exists is_available boolean not null default true,
  add column if not exists is_must_try boolean not null default false;
