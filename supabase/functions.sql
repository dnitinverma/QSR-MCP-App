-- QSR MCP server: read-only RPC functions. Run in the Supabase SQL editor; safe to re-run.
-- Does not alter any table, column, or view. Run migration_details.sql first (detail columns).
-- Depends on: menu_items view, restaurants, dishes, locations, categories, reviews and distance_km().

-- Return columns / args changed in this version, so drop earlier signatures first.
drop function if exists rpc_search_restaurants(text, text, numeric, numeric, int, int, int, boolean, text, int);
drop function if exists rpc_search_restaurants(text, text, numeric, numeric, int, int, int, boolean, text, int, int);
drop function if exists rpc_search_dishes(text, text, boolean, int, numeric, text, boolean, text, int);
drop function if exists rpc_search_dishes(text, text, boolean, int, numeric, text, boolean, text, int, int, text);
drop function if exists rpc_best_dishes_near(double precision, double precision, double precision, boolean, int, int);
drop function if exists rpc_best_dishes_near(double precision, double precision, double precision, boolean, int, int, int);
drop function if exists rpc_search_restaurants(text, text, numeric, numeric, int, int, int, boolean, text, int, int, boolean, boolean);
drop function if exists rpc_search_restaurants(text, text, numeric, numeric, int, int, int, boolean, text, int, int, boolean, boolean, text, int);
drop function if exists rpc_search_dishes(text, text, boolean, int, numeric, text, boolean, text, int, int, text, int, boolean, text);
drop function if exists rpc_restaurants_near(double precision, double precision, double precision, text, numeric, int, boolean, int);

create or replace function rpc_search_restaurants(
  p_location text default null,
  p_category text default null,
  p_min_rating numeric default null,
  p_max_rating numeric default null,
  p_min_reviews int default null,
  p_max_reviews int default null,
  p_max_price int default null,
  p_veg_only boolean default false,
  p_sort_by text default 'rating',
  p_limit int default 10,
  p_min_price int default null,
  p_has_offer boolean default false,
  p_free_delivery boolean default false,
  p_cuisine text default null,
  p_max_cost_for_two int default null,
  p_name text default null
)
returns table (
  restaurant_id int, name text, category text, cuisines text[], location text, city text, address text,
  rating numeric, review_count int, latest_review text,
  price_for_one int, cost_for_two int, delivery_time_min int, delivery_fee int, packaging_charge int,
  min_order_amount int, offer text, opens text, closes text, badges text[], service_modes text[],
  is_pure_veg boolean, is_open boolean
)
language sql stable security invoker as $$
  select r.id, r.name, c.name, r.cuisines, l.name, l.city, r.address,
         r.avg_rating, r.review_count,
         (select rv.rating || '/5 ' || coalesce(rv.comment, '') from reviews rv
           where rv.restaurant_id = r.id order by rv.created_at desc, rv.id desc limit 1),
         r.price_for_one, r.cost_for_two, r.delivery_time_min, r.delivery_fee, r.packaging_charge,
         r.min_order_amount, r.offer_text, to_char(r.opens_at, 'HH24:MI'), to_char(r.closes_at, 'HH24:MI'),
         r.badges, r.service_modes, r.is_pure_veg, r.is_open
  from restaurants r
  join categories c on c.id = r.category_id
  join locations l on l.id = r.location_id
  where (p_location is null or l.name ilike p_location)
    and (p_category is null or c.name ilike p_category)
    and (p_min_rating is null or r.avg_rating >= p_min_rating)
    and (p_max_rating is null or r.avg_rating <= p_max_rating)
    and (p_min_reviews is null or r.review_count >= p_min_reviews)
    and (p_max_reviews is null or r.review_count <= p_max_reviews)
    and (p_max_price is null or r.price_for_one <= p_max_price)
    and (p_min_price is null or r.price_for_one >= p_min_price)
    and (not coalesce(p_veg_only, false) or r.is_pure_veg)
    and (not coalesce(p_has_offer, false) or r.offer_text is not null)
    and (not coalesce(p_free_delivery, false) or r.delivery_fee = 0)
    and (p_cuisine is null or exists (select 1 from unnest(r.cuisines) cu where cu ilike p_cuisine))
    and (p_max_cost_for_two is null or r.cost_for_two <= p_max_cost_for_two)
    and (p_name is null or r.name ilike
         '%' || replace(replace(replace(p_name, '\', '\\'), '%', '\%'), '_', '\_') || '%')
  order by
    case when p_sort_by = 'rating'        then r.avg_rating end desc nulls last,
    case when p_sort_by = 'reviews'       then r.review_count end desc nulls last,
    case when p_sort_by = 'reviews_asc'   then r.review_count end asc nulls last,
    case when p_sort_by = 'price_asc'     then r.price_for_one end asc nulls last,
    case when p_sort_by = 'price_desc'    then r.price_for_one end desc nulls last,
    case when p_sort_by = 'delivery_time' then r.delivery_time_min end asc nulls last,
    r.avg_rating desc, r.review_count desc, r.id
  limit least(greatest(coalesce(p_limit, 10), 1), 25);
$$;

-- Also serves find_dish via p_query (partial, case-insensitive dish-name match).
create or replace function rpc_search_dishes(
  p_location text default null,
  p_category text default null,
  p_is_veg boolean default null,
  p_max_price int default null,
  p_min_rating numeric default null,
  p_spice_level text default null,
  p_bestseller_only boolean default false,
  p_sort_by text default 'rating',
  p_limit int default 10,
  p_min_price int default null,
  p_query text default null,
  p_max_calories int default null,
  p_on_discount boolean default false,
  p_avoid_allergens text[] default null
)
returns table (
  dish_id int, dish text, description text, menu_section text, restaurant_id int, restaurant text,
  category text, location text, price int, mrp int, discount_percent int,
  rating numeric, rating_count int, latest_review text,
  is_veg boolean, diet text, is_bestseller boolean, is_must_try boolean, spice_level text,
  calories int, serves int, portion text, prep_time_min int, allergens text[],
  restaurant_rating numeric, restaurant_review_count int, delivery_time_min int
)
language sql stable security invoker as $$
  select m.dish_id, m.dish_name, dd.description, dd.menu_section, m.restaurant_id, m.restaurant_name,
         m.category, m.location, m.dish_price, dd.mrp,
         case when dd.mrp > m.dish_price then round((dd.mrp - m.dish_price) * 100.0 / dd.mrp)::int end,
         m.dish_rating, m.dish_rating_count,
         (select rv.rating || '/5 ' || coalesce(rv.comment, '') from reviews rv
           where rv.dish_id = m.dish_id order by rv.created_at desc, rv.id desc limit 1),
         m.is_veg, case when m.is_veg then 'veg' when dd.is_egg then 'egg' else 'non-veg' end,
         m.is_bestseller, dd.is_must_try, m.spice_level,
         dd.calories, dd.serves, dd.portion, dd.prep_time_min, dd.allergens,
         m.restaurant_rating, m.restaurant_review_count, m.delivery_time_min
  from menu_items m
  join dishes dd on dd.id = m.dish_id
  where m.is_open and dd.is_available
    and (p_location is null or m.location ilike p_location)
    and (p_category is null or m.category ilike p_category)
    and (p_is_veg is null or m.is_veg = p_is_veg)
    and (p_max_price is null or m.dish_price <= p_max_price)
    and (p_min_price is null or m.dish_price >= p_min_price)
    and (p_min_rating is null or m.dish_rating >= p_min_rating)
    and (p_spice_level is null or m.spice_level = p_spice_level)
    and (not coalesce(p_bestseller_only, false) or m.is_bestseller)
    and (p_max_calories is null or dd.calories <= p_max_calories)
    and (not coalesce(p_on_discount, false) or dd.mrp > m.dish_price)
    and (p_avoid_allergens is null or not (coalesce(dd.allergens, '{}') && p_avoid_allergens))
    and (p_query is null or m.dish_name ilike
         '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%')
  order by
    case when p_sort_by = 'rating'     then m.dish_rating end desc nulls last,
    case when p_sort_by = 'price_asc'  then m.dish_price end asc nulls last,
    case when p_sort_by = 'price_desc' then m.dish_price end desc nulls last,
    case when p_sort_by = 'popularity' then m.dish_rating_count end desc nulls last,
    case when p_sort_by = 'calories_asc' then dd.calories end asc nulls last,
    case when p_sort_by = 'discount'     then (dd.mrp - m.dish_price) * 1.0 / dd.mrp end desc nulls last,
    m.dish_rating desc nulls last, m.dish_rating_count desc, m.dish_id
  limit least(greatest(coalesce(p_limit, 10), 1), 25);
$$;

create or replace function rpc_best_dishes_near(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision default 3,
  p_is_veg boolean default null,
  p_max_price int default null,
  p_limit int default 10,
  p_min_price int default null
)
returns table (
  dish_id int, dish text, description text, restaurant_id int, restaurant text, location text,
  price int, mrp int, discount_percent int, rating numeric, rating_count int, latest_review text,
  is_veg boolean, diet text, is_must_try boolean, calories int,
  restaurant_rating numeric, restaurant_review_count int, delivery_time_min int, distance_km double precision
)
language sql stable security invoker as $$
  select * from (
    select m.dish_id, m.dish_name, dd.description, m.restaurant_id, m.restaurant_name, m.location,
           m.dish_price, dd.mrp,
           case when dd.mrp > m.dish_price then round((dd.mrp - m.dish_price) * 100.0 / dd.mrp)::int end,
           m.dish_rating, m.dish_rating_count,
           (select rv.rating || '/5 ' || coalesce(rv.comment, '') from reviews rv
             where rv.dish_id = m.dish_id order by rv.created_at desc, rv.id desc limit 1) as latest_review,
           m.is_veg, case when m.is_veg then 'veg' when dd.is_egg then 'egg' else 'non-veg' end,
           dd.is_must_try, dd.calories,
           m.restaurant_rating, m.restaurant_review_count, m.delivery_time_min,
           round(distance_km(p_lat, p_lng, m.lat, m.lng)::numeric, 2)::double precision as dist
    from menu_items m
    join dishes dd on dd.id = m.dish_id
    where m.is_open and dd.is_available
      and (p_is_veg is null or m.is_veg = p_is_veg)
      and (p_max_price is null or m.dish_price <= p_max_price)
      and (p_min_price is null or m.dish_price >= p_min_price)
  ) t
  where t.dist <= coalesce(p_radius_km, 3)
  order by t.dish_rating desc nulls last, t.dish_rating_count desc, t.dist asc, t.dish_id
  limit least(greatest(coalesce(p_limit, 10), 1), 25);
$$;

create or replace function rpc_weak_restaurants(
  p_location text default null,
  p_max_rating numeric default null,
  p_max_reviews int default null,
  p_limit int default 10
)
returns table (
  restaurant_id int, name text, category text, location text,
  rating numeric, review_count int, price_for_one int, is_open boolean
)
language sql stable security invoker as $$
  select r.id, r.name, c.name, l.name, r.avg_rating, r.review_count, r.price_for_one, r.is_open
  from restaurants r
  join categories c on c.id = r.category_id
  join locations l on l.id = r.location_id
  where (p_location is null or l.name ilike p_location)
    and (p_max_rating is null or r.avg_rating <= p_max_rating)
    and (p_max_reviews is null or r.review_count <= p_max_reviews)
    and (p_max_rating is not null or p_max_reviews is not null)
  order by r.avg_rating asc, r.review_count asc, r.id
  limit least(greatest(coalesce(p_limit, 10), 1), 25);
$$;

create or replace function rpc_restaurants_near(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision default 3,
  p_category text default null,
  p_min_rating numeric default null,
  p_max_price int default null,
  p_veg_only boolean default false,
  p_limit int default 10
)
returns table (
  restaurant_id int, name text, category text, cuisines text[], location text, address text,
  rating numeric, review_count int, latest_review text,
  price_for_one int, cost_for_two int, delivery_time_min int, delivery_fee int, offer text,
  opens text, closes text, badges text[], is_pure_veg boolean, distance_km double precision
)
language sql stable security invoker as $$
  select * from (
    select r.id, r.name, c.name as category, r.cuisines, l.name as location, r.address,
           r.avg_rating, r.review_count,
           (select rv.rating || '/5 ' || coalesce(rv.comment, '') from reviews rv
             where rv.restaurant_id = r.id order by rv.created_at desc, rv.id desc limit 1) as latest_review,
           r.price_for_one, r.cost_for_two, r.delivery_time_min, r.delivery_fee, r.offer_text,
           to_char(r.opens_at, 'HH24:MI'), to_char(r.closes_at, 'HH24:MI'), r.badges, r.is_pure_veg,
           round(distance_km(p_lat, p_lng, r.lat, r.lng)::numeric, 2)::double precision as dist
    from restaurants r
    join categories c on c.id = r.category_id
    join locations l on l.id = r.location_id
    where r.is_open
      and (p_category is null or c.name ilike p_category)
      and (p_min_rating is null or r.avg_rating >= p_min_rating)
      and (p_max_price is null or r.price_for_one <= p_max_price)
      and (not coalesce(p_veg_only, false) or r.is_pure_veg)
  ) t
  where t.dist <= coalesce(p_radius_km, 3)
  order by t.dist asc, t.avg_rating desc, t.id
  limit least(greatest(coalesce(p_limit, 10), 1), 25);
$$;

create or replace function rpc_open_restaurants(
  p_location text default null,
  p_category text default null,
  p_at text default null,          -- 'HH:MM' (24h, India time); null = right now
  p_limit int default 10
)
returns table (
  restaurant_id int, name text, category text, cuisines text[], location text,
  rating numeric, review_count int, price_for_one int, delivery_time_min int,
  opens text, closes text, offer text, is_pure_veg boolean, checked_at text
)
language sql stable security invoker as $$
  with t as (select coalesce(p_at::time, (now() at time zone 'Asia/Kolkata')::time) as at)
  select r.id, r.name, c.name, r.cuisines, l.name, r.avg_rating, r.review_count, r.price_for_one,
         r.delivery_time_min, to_char(r.opens_at, 'HH24:MI'), to_char(r.closes_at, 'HH24:MI'), r.offer_text,
         r.is_pure_veg, to_char(t.at, 'HH24:MI')
  from restaurants r
  join categories c on c.id = r.category_id
  join locations l on l.id = r.location_id
  cross join t
  where r.is_open
    and (case when r.opens_at <= r.closes_at then t.at between r.opens_at and r.closes_at
              else t.at >= r.opens_at or t.at <= r.closes_at end)
    and (p_location is null or l.name ilike p_location)
    and (p_category is null or c.name ilike p_category)
  order by r.avg_rating desc, r.review_count desc, r.id
  limit least(greatest(coalesce(p_limit, 10), 1), 25);
$$;

grant execute on function
  rpc_search_restaurants(text, text, numeric, numeric, int, int, int, boolean, text, int, int, boolean, boolean, text, int, text),
  rpc_search_dishes(text, text, boolean, int, numeric, text, boolean, text, int, int, text, int, boolean, text[]),
  rpc_open_restaurants(text, text, text, int),
  rpc_best_dishes_near(double precision, double precision, double precision, boolean, int, int, int),
  rpc_weak_restaurants(text, numeric, int, int),
  rpc_restaurants_near(double precision, double precision, double precision, text, numeric, int, boolean, int)
to anon, authenticated, service_role;
