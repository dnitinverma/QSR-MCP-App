"""Generate SQL that fills the detail columns added by migration_details.sql.

Usage: python3 gen_details.py OUT.sql
Dish facts are per dish name (same description everywhere); restaurant facts follow category and area.
Values are synthetic sample data, not real menus, prices or licence numbers.
"""
import sys

# name: (menu_section, description, calories, serves, portion, allergens, contains_egg_as_main)
D = {
    # Burgers
    "Aloo Tikki Burger": ("Burgers", "Crisp potato patty with onion, tomato and tangy mint mayo in a toasted bun.", 380, 1, "1 burger", ["gluten", "dairy"], 0),
    "Paneer Crunch Burger": ("Burgers", "Breaded paneer slab with lettuce and spicy sauce in a toasted bun.", 460, 1, "1 burger", ["gluten", "dairy"], 0),
    "Veggie Supreme Burger": ("Burgers", "Mixed vegetable patty with a cheese slice and garlic mayo.", 420, 1, "1 burger", ["gluten", "dairy", "soy"], 0),
    "Crispy Chicken Burger": ("Burgers", "Buttermilk-fried chicken fillet with lettuce and house sauce.", 520, 1, "1 burger", ["gluten", "egg", "dairy"], 0),
    "Double Smash Chicken Burger": ("Burgers", "Two smashed chicken patties with melted cheese, pickles and burger sauce.", 680, 1, "1 burger", ["gluten", "egg", "dairy"], 0),
    "Peri Peri Chicken Burger": ("Burgers", "Crispy chicken coated in peri peri sauce with crunchy slaw.", 540, 1, "1 burger", ["gluten", "egg"], 0),
    "Cheesy Fries": ("Sides", "Hot fries under a blanket of cheese sauce and oregano.", 360, 1, "150 g", ["dairy"], 0),
    "Chicken Nuggets (6 pc)": ("Sides", "Six golden crumb-coated chicken nuggets with a dip.", 290, 1, "6 pc", ["gluten", "egg"], 0),
    "Mushroom Swiss Burger": ("Burgers", "Sauteed mushrooms and melted cheese on a veg patty.", 440, 1, "1 burger", ["gluten", "dairy"], 0),
    "Fish Fillet Burger": ("Burgers", "Crumbed fish fillet with tartar sauce and lettuce.", 470, 1, "1 burger", ["gluten", "fish", "egg"], 0),
    "Onion Rings": ("Sides", "Batter-fried onion rings served with a tangy dip.", 280, 1, "8 pc", ["gluten"], 0),
    # Pizza
    "Margherita Pizza": ("Pizzas", "Classic tomato sauce and mozzarella on a hand-tossed base.", 720, 2, "8 inch", ["gluten", "dairy"], 0),
    "Farmhouse Pizza": ("Pizzas", "Capsicum, onion, mushroom and tomato with mozzarella.", 780, 2, "8 inch", ["gluten", "dairy"], 0),
    "Paneer Tikka Pizza": ("Pizzas", "Tandoori paneer, onion and capsicum with a mint drizzle.", 830, 2, "8 inch", ["gluten", "dairy"], 0),
    "Chicken Tikka Pizza": ("Pizzas", "Tandoori chicken tikka, onion and green chilli on mozzarella.", 860, 2, "8 inch", ["gluten", "dairy"], 0),
    "Pepperoni Pizza": ("Pizzas", "Spicy pepperoni slices over mozzarella and tomato sauce.", 900, 2, "8 inch", ["gluten", "dairy"], 0),
    "BBQ Chicken Pizza": ("Pizzas", "Smoky BBQ chicken, onion and mozzarella.", 870, 2, "8 inch", ["gluten", "dairy"], 0),
    "Garlic Bread": ("Sides", "Toasted baguette with garlic butter and herbs.", 290, 2, "4 pc", ["gluten", "dairy"], 0),
    "Stuffed Garlic Bread": ("Sides", "Garlic bread stuffed with cheese and sweet corn.", 380, 2, "4 pc", ["gluten", "dairy"], 0),
    "Mexican Green Wave Pizza": ("Pizzas", "Jalapeno, olives, capsicum and Mexican herbs on mozzarella.", 760, 2, "8 inch", ["gluten", "dairy"], 0),
    "Chicken Sausage Pizza": ("Pizzas", "Chicken sausage, onion and a generous layer of cheese.", 880, 2, "8 inch", ["gluten", "dairy"], 0),
    "Cheese Burst Margherita": ("Pizzas", "Margherita with a molten cheese-filled crust.", 950, 2, "8 inch", ["gluten", "dairy"], 0),
    "Choco Lava Cake": ("Desserts", "Warm chocolate cake with a molten centre.", 330, 1, "1 pc", ["gluten", "dairy", "egg"], 0),
    # Biryani
    "Veg Dum Biryani": ("Biryani", "Basmati layered with vegetables and whole spices, slow cooked on dum.", 520, 1, "450 g", ["dairy"], 0),
    "Paneer Biryani": ("Biryani", "Basmati with marinated paneer and saffron milk.", 580, 1, "450 g", ["dairy"], 0),
    "Chicken Dum Biryani": ("Biryani", "Bone-in chicken and basmati sealed and cooked on dum.", 650, 1, "450 g", ["dairy"], 0),
    "Mutton Biryani": ("Biryani", "Tender mutton with basmati, fried onion and mint.", 780, 1, "450 g", ["dairy"], 0),
    "Egg Biryani": ("Biryani", "Boiled eggs tossed in masala and layered with basmati.", 560, 1, "450 g", ["egg", "dairy"], 1),
    "Raita": ("Sides", "Whisked curd with cucumber and roasted cumin.", 90, 1, "200 g", ["dairy"], 0),
    "Chicken 65": ("Starters", "Spicy deep-fried chicken with curry leaves and green chilli.", 430, 2, "8 pc", ["egg", "gluten"], 0),
    "Gulab Jamun (2 pc)": ("Desserts", "Soft milk dumplings in cardamom sugar syrup.", 300, 1, "2 pc", ["dairy", "gluten"], 0),
    "Mirchi ka Salan": ("Sides", "Peanut and sesame gravy with green chillies.", 210, 2, "200 g", ["peanuts", "sesame"], 0),
    "Chicken Tikka Biryani": ("Biryani", "Smoky chicken tikka pieces layered in basmati.", 670, 1, "450 g", ["dairy"], 0),
    "Seekh Kebab (4 pc)": ("Starters", "Minced lamb kebabs grilled on skewers.", 380, 2, "4 pc", ["egg"], 0),
    "Phirni": ("Desserts", "Chilled ground-rice pudding with cardamom and pistachio.", 240, 1, "150 g", ["dairy", "nuts"], 0),
    # South Indian
    "Masala Dosa": ("Dosas", "Crisp rice crepe filled with spiced potato, served with sambar and chutney.", 380, 1, "1 dosa", [], 0),
    "Mysore Masala Dosa": ("Dosas", "Dosa spread with fiery red chutney and potato masala.", 410, 1, "1 dosa", [], 0),
    "Idli Sambar (3 pc)": ("Idli & Vada", "Steamed rice cakes with sambar and coconut chutney.", 250, 1, "3 pc", [], 0),
    "Medu Vada (2 pc)": ("Idli & Vada", "Crisp lentil doughnuts with sambar and chutney.", 300, 1, "2 pc", [], 0),
    "Rava Onion Dosa": ("Dosas", "Lacy semolina crepe with onion and green chilli.", 360, 1, "1 dosa", ["gluten"], 0),
    "Uttapam": ("Dosas", "Thick rice pancake topped with onion and tomato.", 340, 1, "1 pc", [], 0),
    "Filter Coffee": ("Beverages", "South Indian decoction coffee with frothed milk.", 110, 1, "150 ml", ["dairy"], 0),
    "Chicken Chettinad Meal": ("Meals", "Chettinad chicken curry with rice, rasam and papad.", 780, 1, "1 meal", [], 0),
    "Podi Idli": ("Idli & Vada", "Idli tossed in ghee and spicy gunpowder.", 320, 1, "4 pc", ["dairy", "sesame"], 0),
    "Ghee Roast Dosa": ("Dosas", "Ultra-crisp dosa roasted in ghee.", 420, 1, "1 dosa", ["dairy"], 0),
    "Pongal": ("Rice", "Rice and moong dal porridge with pepper and ghee.", 360, 1, "300 g", ["dairy", "nuts"], 0),
    "Lemon Rice": ("Rice", "Tangy rice tempered with peanuts and curry leaves.", 380, 1, "300 g", ["peanuts"], 0),
    # Chinese
    "Veg Hakka Noodles": ("Noodles & Rice", "Wok-tossed noodles with crunchy vegetables.", 450, 1, "350 g", ["gluten", "soy"], 0),
    "Veg Manchurian Gravy": ("Mains", "Vegetable dumplings in a soy-garlic gravy.", 380, 2, "300 g", ["gluten", "soy"], 0),
    "Paneer Chilli Dry": ("Starters", "Crisp paneer tossed with capsicum and soy chilli sauce.", 420, 2, "8 pc", ["dairy", "soy", "gluten"], 0),
    "Chicken Hakka Noodles": ("Noodles & Rice", "Wok-tossed noodles with shredded chicken and vegetables.", 520, 1, "350 g", ["gluten", "soy", "egg"], 0),
    "Chicken Manchurian": ("Mains", "Fried chicken balls in a soy-garlic gravy.", 440, 2, "300 g", ["gluten", "soy", "egg"], 0),
    "Schezwan Fried Rice (Chicken)": ("Noodles & Rice", "Fried rice with chicken in fiery schezwan sauce.", 600, 1, "350 g", ["soy", "egg"], 0),
    "Veg Spring Rolls": ("Starters", "Crisp rolls stuffed with cabbage, carrot and noodles.", 320, 2, "4 pc", ["gluten", "soy"], 0),
    "Hot & Sour Soup": ("Soups", "Peppery tangy soup with mushroom and vegetables.", 120, 1, "300 ml", ["soy"], 0),
    "Veg Fried Rice": ("Noodles & Rice", "Wok-fried rice with spring onion and vegetables.", 480, 1, "350 g", ["soy"], 0),
    "Chilli Chicken Dry": ("Starters", "Crisp chicken tossed with onion, capsicum and chilli sauce.", 460, 2, "8 pc", ["gluten", "soy", "egg"], 0),
    "Chicken Lollipop (6 pc)": ("Starters", "Fried chicken drumettes in a spicy red glaze.", 480, 2, "6 pc", ["gluten", "egg", "soy"], 0),
    "Honey Chilli Potato": ("Starters", "Crisp potato strips glazed in honey and chilli.", 400, 2, "200 g", ["soy", "sesame"], 0),
    # Rolls & wraps
    "Paneer Tikka Roll": ("Rolls", "Tandoori paneer, onion and mint chutney in a flaky paratha.", 420, 1, "1 roll", ["gluten", "dairy"], 0),
    "Veg Seekh Roll": ("Rolls", "Spiced vegetable seekh, onion and chutney in a paratha.", 400, 1, "1 roll", ["gluten"], 0),
    "Aloo Masala Frankie": ("Rolls", "Spiced potato filling with tangy sauce in a soft wrap.", 380, 1, "1 roll", ["gluten"], 0),
    "Chicken Tikka Roll": ("Rolls", "Chicken tikka, onion and mint chutney in a flaky paratha.", 450, 1, "1 roll", ["gluten"], 0),
    "Egg Chicken Kathi Roll": ("Rolls", "Egg-coated paratha filled with chicken and onion.", 520, 1, "1 roll", ["gluten", "egg"], 1),
    "Mutton Seekh Roll": ("Rolls", "Juicy mutton seekh with onion and chutney in a paratha.", 560, 1, "1 roll", ["gluten", "egg"], 0),
    "Peri Peri Fries": ("Sides", "Fries dusted with peri peri seasoning.", 330, 1, "150 g", [], 0),
    "Cold Coffee": ("Beverages", "Chilled blended coffee with milk and ice cream.", 220, 1, "300 ml", ["dairy"], 0),
    "Chicken Seekh Roll": ("Rolls", "Minced chicken seekh with onion and mint chutney.", 480, 1, "1 roll", ["gluten", "egg"], 0),
    "Schezwan Veg Roll": ("Rolls", "Veg filling tossed in schezwan sauce in a paratha.", 410, 1, "1 roll", ["gluten", "soy"], 0),
    "Double Egg Roll": ("Rolls", "Two-egg paratha roll with onion and green chilli.", 480, 1, "1 roll", ["gluten", "egg"], 1),
    # Desserts & beverages
    "Chocolate Brownie": ("Desserts", "Dense fudgy chocolate brownie.", 380, 1, "1 pc", ["gluten", "dairy", "egg", "nuts"], 0),
    "Belgian Waffle": ("Desserts", "Crisp waffle with chocolate sauce.", 420, 1, "1 waffle", ["gluten", "dairy", "egg"], 0),
    "Oreo Shake": ("Beverages", "Thick milkshake blended with Oreo cookies.", 480, 1, "350 ml", ["gluten", "dairy"], 0),
    "Mango Shake": ("Beverages", "Fresh mango blended with chilled milk.", 360, 1, "350 ml", ["dairy"], 0),
    "Masala Chai": ("Beverages", "Milk tea brewed with ginger and cardamom.", 90, 1, "150 ml", ["dairy"], 0),
    "Sizzling Brownie with Ice Cream": ("Desserts", "Hot brownie on a sizzler with vanilla ice cream and chocolate sauce.", 540, 1, "1 plate", ["gluten", "dairy", "egg", "nuts"], 0),
    "Egg Waffle": ("Desserts", "Egg-rich waffle with a light dusting of sugar.", 400, 1, "1 waffle", ["gluten", "egg", "dairy"], 1),
    "Kulfi Falooda": ("Desserts", "Pistachio kulfi with falooda, rose syrup and basil seeds.", 380, 1, "250 g", ["dairy", "nuts", "gluten"], 0),
    "Rabri Jalebi": ("Desserts", "Hot crisp jalebi served with chilled rabri.", 450, 1, "200 g", ["dairy", "gluten"], 0),
    "Thick Chocolate Shake": ("Beverages", "Rich chocolate shake topped with chocolate shavings.", 520, 1, "350 ml", ["dairy"], 0),
    "Nutella Waffle": ("Desserts", "Waffle loaded with hazelnut chocolate spread.", 520, 1, "1 waffle", ["gluten", "dairy", "egg", "nuts"], 0),
    "Sweet Lassi": ("Beverages", "Thick chilled curd drink sweetened with sugar.", 240, 1, "300 ml", ["dairy"], 0),
    "Fresh Lime Soda": ("Beverages", "Fresh lime with soda, sweet or salted.", 90, 1, "300 ml", [], 0),
    # Momos
    "Steamed Veg Momos (6 pc)": ("Steamed Momos", "Steamed dumplings with cabbage, carrot and spring onion.", 260, 1, "6 pc", ["gluten", "soy"], 0),
    "Steamed Chicken Momos (6 pc)": ("Steamed Momos", "Steamed dumplings filled with juicy minced chicken.", 300, 1, "6 pc", ["gluten", "soy"], 0),
    "Fried Paneer Momos (6 pc)": ("Fried Momos", "Crisp fried dumplings with a spiced paneer filling.", 380, 1, "6 pc", ["gluten", "dairy", "soy"], 0),
    "Fried Chicken Momos (6 pc)": ("Fried Momos", "Crisp fried dumplings with minced chicken.", 400, 1, "6 pc", ["gluten", "soy"], 0),
    "Tandoori Chicken Momos (6 pc)": ("Tandoori Momos", "Chicken momos marinated and grilled in a tandoor.", 380, 1, "6 pc", ["gluten", "dairy", "soy"], 0),
    "Kurkure Momos (6 pc)": ("Fried Momos", "Momos coated in a crunchy crumb shell.", 420, 1, "6 pc", ["gluten", "soy"], 0),
    "Schezwan Momos (6 pc)": ("Fried Momos", "Momos tossed in spicy schezwan sauce.", 360, 1, "6 pc", ["gluten", "soy"], 0),
    "Cheese Corn Momos (6 pc)": ("Steamed Momos", "Steamed dumplings with sweet corn and melted cheese.", 340, 1, "6 pc", ["gluten", "dairy", "soy"], 0),
    "Veg Thukpa": ("Soups", "Tibetan noodle soup with vegetables in a warm broth.", 280, 1, "400 ml", ["gluten", "soy"], 0),
    "Chicken Thukpa": ("Soups", "Tibetan noodle soup with chicken in a warm broth.", 330, 1, "400 ml", ["gluten", "soy"], 0),
    "Chilli Garlic Dip": ("Sides", "Fiery red chilli and garlic dip.", 40, 1, "50 g", ["soy"], 0),
    # Chaat & snacks
    "Aloo Tikki Chaat": ("Chaat", "Crisp potato tikki with curd, chutneys and sev.", 320, 1, "1 plate", ["dairy", "gluten"], 0),
    "Papdi Chaat": ("Chaat", "Crisp papdi with potato, curd, tamarind and mint chutney.", 300, 1, "1 plate", ["dairy", "gluten"], 0),
    "Dahi Bhalla": ("Chaat", "Soft lentil dumplings in chilled curd with chutneys.", 280, 1, "2 pc", ["dairy"], 0),
    "Pani Puri (6 pc)": ("Chaat", "Crisp puris filled with spiced water, potato and chickpeas.", 180, 1, "6 pc", ["gluten"], 0),
    "Raj Kachori": ("Chaat", "Large crisp shell filled with sprouts, curd and chutneys.", 400, 1, "1 pc", ["dairy", "gluten"], 0),
    "Samosa Chaat": ("Chaat", "Crushed samosa topped with chole, curd and chutneys.", 420, 1, "1 plate", ["dairy", "gluten"], 0),
    "Bhel Puri": ("Chaat", "Puffed rice tossed with onion, tomato and tangy chutneys.", 240, 1, "1 plate", ["peanuts", "gluten"], 0),
    "Chole Kulche": ("Snacks", "Spiced chickpeas with soft kulche and pickled onion.", 450, 1, "1 plate", ["gluten"], 0),
    "Moong Dal Chilla": ("Snacks", "Savoury lentil pancakes with mint chutney.", 260, 1, "2 pc", [], 0),
    "Kachori Sabzi": ("Snacks", "Crisp lentil kachori with spicy potato curry.", 480, 1, "2 pc", ["gluten"], 0),
    "Jalebi (100 g)": ("Sweets", "Hot crisp spirals soaked in saffron syrup.", 380, 1, "100 g", ["gluten", "dairy"], 0),
    # North Indian meals
    "Chole Bhature": ("Mains", "Spicy chickpea curry with two fluffy fried bhature.", 720, 1, "1 plate", ["gluten", "dairy"], 0),
    "Rajma Chawal": ("Mains", "Kidney bean curry served over steamed rice.", 560, 1, "1 plate", [], 0),
    "Dal Makhani with Naan": ("Mains", "Slow-cooked black lentils in butter and cream with naan.", 640, 1, "1 plate", ["dairy", "gluten"], 0),
    "Paneer Butter Masala": ("Mains", "Paneer in a creamy tomato and butter gravy.", 520, 2, "300 g", ["dairy", "nuts"], 0),
    "Butter Chicken with Naan": ("Mains", "Tandoori chicken in a buttery tomato gravy with naan.", 820, 1, "1 plate", ["dairy", "gluten", "nuts"], 0),
    "Chicken Curry Rice": ("Mains", "Home-style chicken curry with steamed rice.", 640, 1, "1 plate", [], 0),
    "Aloo Paratha (2 pc)": ("Parathas", "Wheat parathas stuffed with spiced potato, with curd and pickle.", 520, 1, "2 pc", ["gluten", "dairy"], 0),
    "Paneer Paratha (2 pc)": ("Parathas", "Wheat parathas stuffed with spiced paneer, with curd and pickle.", 580, 1, "2 pc", ["gluten", "dairy"], 0),
    "Kadhai Paneer": ("Mains", "Paneer with capsicum in a spicy kadhai masala.", 480, 2, "300 g", ["dairy"], 0),
    "Mutton Rogan Josh": ("Mains", "Kashmiri-style mutton curry in a rich red gravy.", 650, 2, "300 g", ["dairy"], 0),
    "Veg Thali": ("Meals", "Dal, two sabzis, rice, roti, raita and a sweet.", 780, 1, "1 thali", ["gluten", "dairy"], 0),
}

CUISINES = {
    "Burgers": ["Burgers", "Fast Food", "American"], "Pizza": ["Pizza", "Italian", "Fast Food"],
    "Biryani": ["Biryani", "Mughlai", "North Indian"], "South Indian": ["South Indian", "Dosa", "Breakfast"],
    "Chinese": ["Chinese", "Asian", "Fast Food"], "Rolls & Wraps": ["Rolls", "Street Food", "Kebabs"],
    "Desserts & Beverages": ["Desserts", "Beverages", "Ice Cream"], "Momos": ["Momos", "Tibetan", "Chinese"],
    "Chaat & Snacks": ["Chaat", "Street Food", "Snacks"], "North Indian Meals": ["North Indian", "Punjabi", "Thali"],
}
# category: (earliest open hour, latest open hour, close hour, prep minutes min, prep minutes max)
HOURS = {
    "Burgers": (10, 11, 23, 8, 15), "Pizza": (11, 12, 23, 15, 25), "Biryani": (11, 12, 23, 15, 25),
    "South Indian": (7, 8, 22, 8, 15), "Chinese": (11, 12, 23, 12, 20), "Rolls & Wraps": (11, 12, 23, 8, 15),
    "Desserts & Beverages": (11, 12, 23, 5, 12), "Momos": (11, 12, 22, 10, 15),
    "Chaat & Snacks": (11, 12, 22, 5, 10), "North Indian Meals": (10, 11, 23, 15, 25),
}
STREETS = {
    "Connaught Place": ["Block A, Connaught Place", "Block N, Connaught Place", "Janpath Road", "Barakhamba Road", "Inner Circle"],
    "Hauz Khas": ["Hauz Khas Village", "Aurobindo Marg", "Hauz Khas Main Market", "Deer Park Road"],
    "Saket": ["Saket District Centre", "Press Enclave Road", "Mehrauli-Badarpur Road", "Saket Main Market"],
    "Karol Bagh": ["Ajmal Khan Road", "Gaffar Market", "Pusa Road", "Bank Street"],
    "Lajpat Nagar": ["Central Market", "Defence Colony Road", "Amar Colony", "Ring Road"],
    "Dwarka": ["Sector 12 Market", "Sector 10 Main Road", "Dwarka Mor", "Sector 6 Market"],
    "Cyber Hub": ["DLF Cyber City", "Cyber Hub Plaza", "Building 9", "Phase 2 Main Road"],
    "Golf Course Road": ["DLF Phase 5", "Sector 54 Market", "Galleria Market", "Sector 42"],
    "Sector 62": ["Block A, Sector 62", "Block C, Sector 62", "Institutional Area, Sector 62", "Block F Market"],
    "Sector 18": ["Atta Market", "Sector 18 Main Road", "Great India Place Road", "Block B, Sector 18"],
    "Indirapuram": ["Shakti Khand", "Niti Khand", "Ahinsa Khand", "Gyan Khand Market"],
    "Gaur City": ["Gaur City 1", "Gaur City 2", "Gaur City Mall Road", "Gaur Chowk"],
    "Sector 15": ["Sector 15 Market", "Sector 16 Main Road", "NIT Market", "Mathura Road"],
}
OFFERS = ["Flat Rs 100 off above Rs 399", "20% off up to Rs 80", "Free delivery above Rs 249", "Rs 125 off above Rs 549",
          "30% off up to Rs 75", "Buy 1 Get 1 on selected items", "15% off on your first order", "Rs 50 off above Rs 299"]


def q(s):
    return "'" + str(s).replace("'", "''") + "'"


def arr(xs):
    return "array[" + ", ".join(q(x) for x in xs) + "]::text[]" if xs else "'{}'::text[]"


sql = ["begin;"]

# ---- dishes: per-name facts, then per-row variation
rows = ",\n  ".join(
    f"({q(n)}, {q(s)}, {q(d)}, {c}, {sv}, {q(p)}, {arr(a)}, {bool(e)})" for n, (s, d, c, sv, p, a, e) in D.items())
sql.append(f"""update dishes x set
  menu_section = v.section, description = v.descr,
  calories = round(v.cal * (0.92 + random() * 0.16) / 5) * 5,
  serves = v.serves, portion = v.portion, allergens = v.allergens, is_egg = v.egg and not x.is_veg
from (values
  {rows}
) as v(name, section, descr, cal, serves, portion, allergens, egg)
where x.name = v.name;""")
sql.append("""update dishes set
  mrp = case when random() < 0.35 then (ceil(price * (1.10 + random() * 0.20) / 5) * 5)::int end,
  is_available = random() >= 0.04,
  is_must_try = (rating >= 4.5 and rating_count >= 50 and random() < 0.5);""")
for cat, (_, _, _, lo, hi) in HOURS.items():
    sql.append(f"""update dishes d set prep_time_min = {lo} + floor(random() * {hi - lo + 1})::int
from restaurants r join categories c on c.id = r.category_id
where d.restaurant_id = r.id and c.name = {q(cat)};""")

# ---- restaurants
cu = ",\n  ".join(f"({q(k)}, {arr(v)})" for k, v in CUISINES.items())
st = ",\n  ".join(f"({q(k)}, {arr(v)})" for k, v in STREETS.items())
hrs = ",\n  ".join(f"({q(k)}, {a}, {b}, {c})" for k, (a, b, c, _, _) in HOURS.items())
offers = arr(OFFERS)
sql.append(f"""update restaurants r set
  cuisines = cu.cuisines,
  address = 'Shop ' || (1 + floor(random() * 120))::int || ', ' || (st.streets)[1 + floor(random() * cardinality(st.streets))::int] || ', ' || l.name || ', ' || l.city,
  cost_for_two = round(r.price_for_one * 1.9 / 10) * 10,
  delivery_fee = case when r.price_for_one >= 220 or random() < 0.3 then 0 else (array[20, 25, 30, 35, 40])[1 + floor(random() * 5)::int] end,
  packaging_charge = (array[0, 10, 15, 20, 25, 30])[1 + floor(random() * 6)::int],
  min_order_amount = (array[0, 99, 149, 199, 249])[1 + floor(random() * 5)::int],
  offer_text = case when random() < 0.55 then ({offers})[1 + floor(random() * {len(OFFERS)})::int] end,
  opens_at = make_time(h.o1 + floor(random() * (h.o2 - h.o1 + 1))::int, (array[0, 30])[1 + floor(random() * 2)::int], 0),
  closes_at = make_time(h.c % 24, (array[0, 30])[1 + floor(random() * 2)::int], 0),
  fssai_license = '1' || (array[0, 1, 2])[1 + floor(random() * 3)::int]::text || lpad(floor(random() * 1e12)::bigint::text, 12, '0'),
  service_modes = array_remove(array['delivery', case when random() < 0.9 then 'takeaway' end, case when random() < 0.45 then 'dine-in' end], null)
from categories c
join (values
  {cu}
) as cu(name, cuisines) on cu.name = c.name
join (values
  {hrs}
) as h(name, o1, o2, c) on h.name = c.name
join locations l on true
join (values
  {st}
) as st(name, streets) on st.name = l.name
where r.category_id = c.id and r.location_id = l.id;""")
sql.append("""update restaurants set badges = array_remove(array[
  case when avg_rating >= 4.5 and review_count >= 1000 then 'Top rated' end,
  case when delivery_time_min <= 25 then 'Quick delivery' end,
  case when review_count <= 25 then 'New' end,
  case when is_pure_veg then 'Pure veg' end,
  case when price_for_one <= 120 then 'Budget friendly' end
], null);""")
sql.append("commit;")
open(sys.argv[1], "w").write("\n".join(sql) + "\n")
print(f"dish names covered: {len(D)}")
