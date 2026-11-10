"""Generate the Delhi NCR data expansion as one SQL transaction.

Usage: python3 gen_ncr_seed.py OUT.sql NEXT_RESTAURANT_ID NEXT_DISH_ID
Removes Bengaluru and Mumbai, adds NCR areas and 3 categories, adds restaurants and dishes,
then generates reviews inside Postgres for every dish and every restaurant.
Existing Delhi NCR rows are kept.
"""
import random
import sys

random.seed(2026)
out_path, rest_id, dish_id = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])

REMOVE = ["Indiranagar", "Bandra West"]
EXISTING_LOCS = ["Connaught Place", "Cyber Hub", "Sector 62"]
NEW_LOCS = [
    ("Hauz Khas", "Delhi", 28.5494, 77.2001),
    ("Saket", "Delhi", 28.5245, 77.2066),
    ("Karol Bagh", "Delhi", 28.6519, 77.1909),
    ("Lajpat Nagar", "Delhi", 28.5677, 77.2433),
    ("Dwarka", "Delhi", 28.5921, 77.0460),
    ("Golf Course Road", "Gurugram", 28.4421, 77.1010),
    ("Sector 18", "Noida", 28.5708, 77.3260),
    ("Indirapuram", "Ghaziabad", 28.6420, 77.3690),
    ("Gaur City", "Greater Noida West", 28.6088, 77.4262),
    ("Sector 15", "Faridabad", 28.4089, 77.3178),
]
LOCS = EXISTING_LOCS + [l[0] for l in NEW_LOCS]
COORDS = {"Connaught Place": (28.6315, 77.2167), "Cyber Hub": (28.4950, 77.0890), "Sector 62": (28.6270, 77.3650)}
COORDS.update({n: (la, lo) for n, _, la, lo in NEW_LOCS})

NEW_CATS = [("Momos", "Asian"), ("Chaat & Snacks", "Street Food"), ("North Indian Meals", "North Indian")]
OLD_CATS = ["Burgers", "Pizza", "Biryani", "South Indian", "Chinese", "Rolls & Wraps", "Desserts & Beverages"]
ALL_CATS = OLD_CATS + [c[0] for c in NEW_CATS]

# category -> (restaurant name pool, dishes (name, veg, base price, spice))
CAT = {
    "Burgers": (["Burger Barn", "Patty Pad", "Bun Theory", "Grill & Stack", "The Burger Lab", "Smash House", "Stack Shack", "Bite Club", "Juicy Lucy Co", "Flame & Bun"], [
        ("Aloo Tikki Burger", 1, 99, "mild"), ("Paneer Crunch Burger", 1, 149, "medium"), ("Veggie Supreme Burger", 1, 139, "mild"),
        ("Crispy Chicken Burger", 0, 169, "medium"), ("Double Smash Chicken Burger", 0, 229, "medium"), ("Peri Peri Chicken Burger", 0, 189, "hot"),
        ("Cheesy Fries", 1, 109, "mild"), ("Chicken Nuggets (6 pc)", 0, 129, "mild"), ("Mushroom Swiss Burger", 1, 159, "mild"),
        ("Fish Fillet Burger", 0, 179, "mild"), ("Onion Rings", 1, 99, "mild")]),
    "Pizza": (["Slice Society", "Crust Culture", "Oven Story", "Pizza Pronto", "Cheese Crown", "Dough & Co", "Slice Haven", "Wood Fire Works", "Napoli Nest", "Crust & Cheese"], [
        ("Margherita Pizza", 1, 179, "mild"), ("Farmhouse Pizza", 1, 279, "mild"), ("Paneer Tikka Pizza", 1, 299, "medium"),
        ("Chicken Tikka Pizza", 0, 329, "medium"), ("Pepperoni Pizza", 0, 349, "mild"), ("BBQ Chicken Pizza", 0, 339, "medium"),
        ("Garlic Bread", 1, 119, "mild"), ("Stuffed Garlic Bread", 1, 159, "mild"), ("Mexican Green Wave Pizza", 1, 299, "medium"),
        ("Chicken Sausage Pizza", 0, 319, "mild"), ("Cheese Burst Margherita", 1, 239, "mild"), ("Choco Lava Cake", 1, 109, "mild")]),
    "Biryani": (["Biryani Bazaar", "Dum Darbar", "Handi House", "Nawabi Kitchen", "Biryani By Kilo Co", "Royal Dum", "Zaika Dum", "Mughal Handi", "Kebab & Dum", "Awadhi Dum"], [
        ("Veg Dum Biryani", 1, 189, "medium"), ("Paneer Biryani", 1, 229, "medium"), ("Chicken Dum Biryani", 0, 249, "medium"),
        ("Mutton Biryani", 0, 349, "hot"), ("Egg Biryani", 0, 199, "medium"), ("Raita", 1, 49, "mild"), ("Chicken 65", 0, 219, "hot"),
        ("Gulab Jamun (2 pc)", 1, 79, "mild"), ("Mirchi ka Salan", 1, 89, "hot"), ("Chicken Tikka Biryani", 0, 269, "medium"),
        ("Seekh Kebab (4 pc)", 0, 229, "hot"), ("Phirni", 1, 89, "mild")]),
    "South Indian": (["Dosa Dhaba", "Idli Express", "Madras Cafe Co", "Udupi Bites", "Filter Kaapi Corner", "Sambar Station", "Annas Kitchen", "Tiffin Room", "Coastal Dosa", "Kaveri Meals"], [
        ("Masala Dosa", 1, 119, "medium"), ("Mysore Masala Dosa", 1, 139, "hot"), ("Idli Sambar (3 pc)", 1, 89, "mild"),
        ("Medu Vada (2 pc)", 1, 79, "mild"), ("Rava Onion Dosa", 1, 129, "mild"), ("Uttapam", 1, 119, "mild"), ("Filter Coffee", 1, 49, "mild"),
        ("Chicken Chettinad Meal", 0, 259, "hot"), ("Podi Idli", 1, 109, "medium"), ("Ghee Roast Dosa", 1, 149, "mild"),
        ("Pongal", 1, 99, "mild"), ("Lemon Rice", 1, 99, "mild")]),
    "Chinese": (["Wok Wala", "Noodle Nation", "Dragon Bowl", "Hakka Hub", "Chopstick Chef", "Schezwan Street", "Lucky Wok", "Red Lantern Express", "Chowmein Corner", "Hunan Street"], [
        ("Veg Hakka Noodles", 1, 149, "medium"), ("Veg Manchurian Gravy", 1, 169, "medium"), ("Paneer Chilli Dry", 1, 219, "hot"),
        ("Chicken Hakka Noodles", 0, 189, "medium"), ("Chicken Manchurian", 0, 209, "medium"), ("Schezwan Fried Rice (Chicken)", 0, 199, "hot"),
        ("Veg Spring Rolls", 1, 129, "mild"), ("Hot & Sour Soup", 1, 109, "hot"), ("Veg Fried Rice", 1, 159, "mild"),
        ("Chilli Chicken Dry", 0, 229, "hot"), ("Chicken Lollipop (6 pc)", 0, 239, "medium"), ("Honey Chilli Potato", 1, 179, "medium")]),
    "Rolls & Wraps": (["Roll Mantra", "Wrap Wizard", "Kathi Kingdom", "Frankie Factory", "Roll Express", "Tikka Roll Co", "Roll Junction", "Kathi Station", "Wrap Republic", "Frankie Hub"], [
        ("Paneer Tikka Roll", 1, 129, "medium"), ("Veg Seekh Roll", 1, 119, "medium"), ("Aloo Masala Frankie", 1, 99, "mild"),
        ("Chicken Tikka Roll", 0, 159, "medium"), ("Egg Chicken Kathi Roll", 0, 149, "medium"), ("Mutton Seekh Roll", 0, 199, "hot"),
        ("Peri Peri Fries", 1, 99, "medium"), ("Cold Coffee", 1, 89, "mild"), ("Chicken Seekh Roll", 0, 169, "medium"),
        ("Schezwan Veg Roll", 1, 129, "hot"), ("Double Egg Roll", 0, 139, "mild")]),
    "Desserts & Beverages": (["Sweet Tooth Lab", "Shake Shack Desi", "Waffle Works", "Brownie Point", "Ice & Spice", "Chai Chaska", "Sugar Rush", "Mithai & Shake", "Kulfi Corner", "Waffle House Desi"], [
        ("Chocolate Brownie", 1, 109, "mild"), ("Belgian Waffle", 1, 149, "mild"), ("Oreo Shake", 1, 139, "mild"), ("Mango Shake", 1, 129, "mild"),
        ("Masala Chai", 1, 39, "mild"), ("Sizzling Brownie with Ice Cream", 1, 189, "mild"), ("Cold Coffee", 1, 99, "mild"), ("Egg Waffle", 0, 129, "mild"),
        ("Kulfi Falooda", 1, 129, "mild"), ("Rabri Jalebi", 1, 119, "mild"), ("Thick Chocolate Shake", 1, 149, "mild"),
        ("Nutella Waffle", 1, 169, "mild"), ("Sweet Lassi", 1, 89, "mild"), ("Fresh Lime Soda", 1, 69, "mild")]),
    "Momos": (["Momo Mia", "Dumpling Den", "Steam Street", "Tibet Corner", "Momo Junction", "The Momo Co", "Himalayan Bites", "Thukpa & Co"], [
        ("Steamed Veg Momos (6 pc)", 1, 99, "mild"), ("Steamed Chicken Momos (6 pc)", 0, 119, "mild"), ("Fried Paneer Momos (6 pc)", 1, 129, "medium"),
        ("Fried Chicken Momos (6 pc)", 0, 139, "medium"), ("Tandoori Chicken Momos (6 pc)", 0, 159, "medium"), ("Kurkure Momos (6 pc)", 1, 149, "medium"),
        ("Schezwan Momos (6 pc)", 1, 129, "hot"), ("Cheese Corn Momos (6 pc)", 1, 139, "mild"), ("Veg Thukpa", 1, 149, "medium"),
        ("Chicken Thukpa", 0, 169, "medium"), ("Chilli Garlic Dip", 1, 29, "hot")]),
    "Chaat & Snacks": (["Chaat Gali", "Bikaner Chaat House", "Dilli Chaat Corner", "Chandni Chaat", "Pani Puri Point", "Nukkad Snacks", "Sharma Ji Chaat", "Kachori Wala"], [
        ("Aloo Tikki Chaat", 1, 89, "medium"), ("Papdi Chaat", 1, 99, "medium"), ("Dahi Bhalla", 1, 99, "mild"), ("Pani Puri (6 pc)", 1, 59, "medium"),
        ("Raj Kachori", 1, 119, "medium"), ("Samosa Chaat", 1, 89, "medium"), ("Bhel Puri", 1, 79, "mild"), ("Chole Kulche", 1, 119, "medium"),
        ("Moong Dal Chilla", 1, 89, "mild"), ("Kachori Sabzi", 1, 99, "medium"), ("Jalebi (100 g)", 1, 79, "mild")]),
    "North Indian Meals": (["Dhaba Express", "Punjabi Rasoi", "Ghar Ka Khana", "Tadka Table", "Amritsari Kitchen", "Delhi Darbar", "Lajawab Rasoi", "Maa Ki Rasoi"], [
        ("Chole Bhature", 1, 149, "medium"), ("Rajma Chawal", 1, 139, "mild"), ("Dal Makhani with Naan", 1, 189, "mild"), ("Paneer Butter Masala", 1, 229, "mild"),
        ("Butter Chicken with Naan", 0, 289, "medium"), ("Chicken Curry Rice", 0, 219, "medium"), ("Aloo Paratha (2 pc)", 1, 109, "mild"),
        ("Paneer Paratha (2 pc)", 1, 129, "mild"), ("Kadhai Paneer", 1, 239, "medium"), ("Mutton Rogan Josh", 0, 349, "hot"),
        ("Veg Thali", 1, 199, "mild"), ("Sweet Lassi", 1, 79, "mild")]),
}
PURE_VEG_CATS = {"South Indian": 0.5, "Desserts & Beverages": 0.5, "Chaat & Snacks": 0.7}
CUISINE = {c[0]: c[1] for c in NEW_CATS}


def q(s):
    return "'" + str(s).replace("'", "''") + "'"


def b(v):
    return "true" if v else "false"


sql = ["begin;"]
# 1. remove Bengaluru and Mumbai (dishes and reviews cascade from restaurants)
names = ", ".join(q(n) for n in REMOVE)
sql.append(f"delete from restaurants where location_id in (select id from locations where name in ({names}));")
sql.append(f"delete from locations where name in ({names});")
# 2. new locations and categories
sql.append("insert into locations (name, city, lat, lng) values\n  " + ",\n  ".join(
    f"({q(n)}, {q(c)}, {la}, {lo})" for n, c, la, lo in NEW_LOCS) + ";")
sql.append("insert into categories (name, cuisine_group) values\n  " + ",\n  ".join(
    f"({q(n)}, {q(g)})" for n, g in NEW_CATS) + ";")

# 3. restaurants and dishes
rest_rows, dish_rows = [], []
for loc in LOCS:
    lat, lng = COORDS[loc]
    cats = ALL_CATS if loc not in EXISTING_LOCS else [c[0] for c in NEW_CATS]
    for cname in cats:
        pool, dishes = CAT[cname]
        for ridx, rname in enumerate(random.sample(pool, 3)):
            rid = rest_id; rest_id += 1
            profile = random.choices([0, 1, 2], weights=[4, 4, 3])[0]
            if ridx == 2 and random.random() < 0.6:
                profile = 2
            if profile == 0:
                rating = round(random.uniform(4.2, 4.8), 1); count = random.randint(900, 5200)
            elif profile == 1:
                rating = round(random.uniform(3.6, 4.2), 1); count = random.randint(150, 900)
            elif random.random() < 0.5:
                rating = round(random.uniform(2.1, 3.3), 1); count = random.randint(40, 400)
            else:
                rating = round(random.uniform(3.8, 4.6), 1); count = random.randint(3, 25)
            tier = random.choice([0.9, 1.0, 1.1, 1.25])
            pure_veg = random.random() < PURE_VEG_CATS.get(cname, 0)
            pool_d = [d for d in dishes if d[1] == 1] if pure_veg else dishes
            menu = random.sample(pool_d, k=min(len(pool_d), random.randint(6, 9)))
            avg_price = int(sum(d[2] for d in menu) / len(menu) * tier)
            rest_rows.append(
                f"({rid}, {q(rname)}, (select id from locations where name = {q(loc)}), (select id from categories where name = {q(cname)}), "
                f"{b(pure_veg)}, {rating}, {count}, {avg_price}, {random.randint(18, 50)}, "
                f"{round(lat + random.uniform(-0.012, 0.012), 5)}, {round(lng + random.uniform(-0.012, 0.012), 5)}, {b(random.random() >= 0.08)})")
            for dname, veg, base, spice in menu:
                did = dish_id; dish_id += 1
                price = int(round(base * tier / 5.0) * 5)
                d_rating = round(min(5.0, max(1.5, rating + random.uniform(-0.5, 0.5))), 1)
                d_count = max(1, int(count * random.uniform(0.05, 0.35)))
                dish_rows.append(f"({did}, {rid}, {q(dname)}, {b(veg)}, {price}, {d_rating}, {d_count}, {b(random.random() < 0.2)}, {q(spice)})")


def chunks(rows, n=150):
    for i in range(0, len(rows), n):
        yield rows[i:i + n]


for ch in chunks(rest_rows):
    sql.append("insert into restaurants (id, name, location_id, category_id, is_pure_veg, avg_rating, review_count, price_for_one, delivery_time_min, lat, lng, is_open) values\n  " + ",\n  ".join(ch) + ";")
for ch in chunks(dish_rows):
    sql.append("insert into dishes (id, restaurant_id, name, is_veg, price, rating, rating_count, is_bestseller, spice_level) values\n  " + ",\n  ".join(ch) + ";")
sql.append(f"select setval('restaurants_id_seq', (select max(id) from restaurants));")
sql.append(f"select setval('dishes_id_seq', (select max(id) from dishes));")

# 4. reviews, generated in Postgres. Ratings follow each dish / restaurant rating.
NAMES = ["Aarav", "Priya", "Rohan", "Sneha", "Karan", "Ananya", "Vikram", "Meera", "Arjun", "Isha", "Rahul", "Neha", "Siddharth", "Pooja",
         "Aditya", "Divya", "Ritu", "Manish", "Kavya", "Deepak", "Simran", "Gaurav", "Tanvi", "Harsh", "Nikita", "Yash", "Shreya", "Varun", "Aman", "Jyoti"]
DISH_POS = ["The %s was fresh and full of flavour", "Loved the %s, will order again", "%s arrived well packed and fresh", "Best %s I have had in this area",
            "Generous portion of %s for the price", "The %s tasted exactly like it should", "Great %s, arrived quickly", "%s was perfectly cooked",
            "Really good %s, worth every rupee", "Tasty %s and the packaging was neat"]
DISH_MID = ["The %s was okay, nothing special", "%s was decent for the price", "Average %s, could use more seasoning", "%s was fine but a bit small",
            "Okay %s, would try something else next time"]
DISH_NEG = ["The %s was cold when it arrived", "%s was too oily and bland", "Not happy with the %s, quality has dropped", "%s was overpriced for the portion",
            "The %s did not match the menu description"]
REST_POS = ["Quick delivery and hot food", "Consistent taste every time", "Great value for money", "Packaging was neat and spill free",
            "Staff were polite and the order was right", "Best in the area for the price", "Fresh ingredients and quick service", "Reliable, I order here every week"]
REST_MID = ["Decent but nothing special", "Okay for a quick bite", "Average taste, fair price", "Delivery was a little slow but food was fine"]
REST_NEG = ["Delivery took very long", "Food arrived cold", "Packaging was messy", "Order was missing an item", "Would not order again", "Quality has dropped lately"]


def arr(xs):
    return "array[" + ", ".join(q(x) for x in xs) + "]"


def comment_expr(rating_col, pos, mid, neg, fmt):
    def pick(xs):
        e = f"({arr(xs)})[1 + floor(random() * {len(xs)})::int]"
        return f"format({e}, d.name)" if fmt else e
    return f"case when {rating_col} >= 4 then {pick(pos)} when {rating_col} = 3 then {pick(mid)} else {pick(neg)} end"


names_arr = f"({arr(NAMES)})[1 + floor(random() * {len(NAMES)})::int]"
sql.append(f"""-- dish reviews: 1 to 3 per dish
insert into reviews (restaurant_id, dish_id, reviewer, rating, comment, created_at)
select d.restaurant_id, d.id, {names_arr}, x.r,
       {comment_expr('x.r', DISH_POS, DISH_MID, DISH_NEG, True)},
       now() - random() * interval '240 days'
from dishes d
cross join lateral generate_series(1, 1 + floor(random() * 3)::int) g
cross join lateral (select greatest(1, least(5, round(d.rating + random() * 2.2 - 1.2)::int)) as r) x;""")
sql.append(f"""-- restaurant reviews (no dish): 3 to 6 per restaurant
insert into reviews (restaurant_id, dish_id, reviewer, rating, comment, created_at)
select r.id, null, {names_arr}, x.r,
       {comment_expr('x.r', REST_POS, REST_MID, REST_NEG, False).replace('d.name', 'r.name')},
       now() - random() * interval '240 days'
from restaurants r
cross join lateral generate_series(1, 3 + floor(random() * 4)::int) g
cross join lateral (select greatest(1, least(5, round(r.avg_rating + random() * 2.2 - 1.2)::int)) as r) x;""")
sql.append("commit;")

open(out_path, "w").write("\n".join(sql) + "\n")
print(f"new restaurants: {len(rest_rows)}, new dishes: {len(dish_rows)}, next ids: {rest_id}/{dish_id}")
