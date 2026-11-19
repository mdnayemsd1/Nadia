-- ============================================================================
-- OPTIONAL: SAMPLE demonstration content (is_sample = true).
-- The storefront labels these products "Sample". Delete them from
-- Admin Panel -> Products when you add your real inventory, or run:
--   delete from public.products where is_sample;
-- ============================================================================

insert into public.categories (name, name_bn, slug, description, sort_order) values
  ('Earbuds & Audio',   'ইয়ারবাড ও অডিও',      'earbuds-audio',  'Wireless earbuds and headphones', 1),
  ('Smartwatches',      'স্মার্টওয়াচ',          'smartwatches',   'Fitness and smart wearables',     2),
  ('Speakers',          'স্পিকার',               'speakers',       'Bluetooth and home speakers',     3),
  ('Kitchen Appliances','কিচেন অ্যাপ্লায়েন্স',   'kitchen',        'Blenders, kettles and more',      4),
  ('Power & Charging',  'পাওয়ার ও চার্জিং',     'power-charging', 'Power banks, chargers, cables',   5)
on conflict (slug) do nothing;

insert into public.products
  (name, name_bn, slug, short_description, short_description_bn, description, regular_price, discount_price,
   category_id, stock_quantity, is_featured, is_new_arrival, is_sample, specifications)
select v.name, v.name_bn, v.slug, v.sd, v.sd_bn, v.descr, v.price, v.disc,
       (select id from public.categories where slug = v.cat), v.stock, v.feat, v.isnew, true, v.specs::jsonb
from (values
  ('Sample: Pulse ANC Earbuds', 'স্যাম্পল: পালস ANC ইয়ারবাড', 'sample-pulse-anc-earbuds',
   'Active noise cancelling, 30h battery', 'অ্যাক্টিভ নয়েজ ক্যান্সেলিং, ৩০ ঘণ্টা ব্যাটারি',
   E'This is SAMPLE content.\n\n## Highlights\n- Active noise cancelling\n- 30 hours total playtime\n- Bluetooth 5.3\n\nReplace this with your real product description from the Admin Panel.',
   3200, 2490, 'earbuds-audio', 25, true, true,
   '[{"label":"Battery","label_bn":"ব্যাটারি","value":"30 hours"},{"label":"Bluetooth","label_bn":"ব্লুটুথ","value":"5.3"}]'),
  ('Sample: Nova Smartwatch', 'স্যাম্পল: নোভা স্মার্টওয়াচ', 'sample-nova-smartwatch',
   '1.8" AMOLED, heart-rate & SpO2', '১.৮" AMOLED, হার্ট-রেট ও SpO2',
   E'This is SAMPLE content.\n\n## Highlights\n- 1.8 inch AMOLED display\n- Heart-rate and SpO2 tracking\n- 7-day battery',
   5800, 4290, 'smartwatches', 12, true, false,
   '[{"label":"Display","label_bn":"ডিসপ্লে","value":"1.8\" AMOLED"},{"label":"Battery","label_bn":"ব্যাটারি","value":"7 days"}]'),
  ('Sample: Boom Mini Speaker', 'স্যাম্পল: বুম মিনি স্পিকার', 'sample-boom-mini-speaker',
   'Portable, waterproof, 12h playtime', 'পোর্টেবল, ওয়াটারপ্রুফ, ১২ ঘণ্টা প্লেটাইম',
   E'This is SAMPLE content.\n\nA compact waterproof Bluetooth speaker with deep bass.',
   2400, null, 'speakers', 40, false, true,
   '[{"label":"Playtime","label_bn":"প্লেটাইম","value":"12 hours"},{"label":"Water resistance","label_bn":"ওয়াটার রেজিস্ট্যান্স","value":"IPX7"}]'),
  ('Sample: Chef Blend 600W Blender', 'স্যাম্পল: শেফ ব্লেন্ড ৬০০W ব্লেন্ডার', 'sample-chef-blend-blender',
   '600W motor, 1.5L jar', '৬০০W মোটর, ১.৫ লিটার জার',
   E'This is SAMPLE content.\n\nA powerful kitchen blender for smoothies, sauces and more.',
   3900, 3190, 'kitchen', 8, true, false,
   '[{"label":"Power","label_bn":"পাওয়ার","value":"600W"},{"label":"Capacity","label_bn":"ধারণক্ষমতা","value":"1.5 L"}]'),
  ('Sample: Flow 20000mAh Power Bank', 'স্যাম্পল: ফ্লো ২০০০০mAh পাওয়ার ব্যাংক', 'sample-flow-power-bank',
   '22.5W fast charging, dual output', '২২.৫W ফাস্ট চার্জিং, ডুয়াল আউটপুট',
   E'This is SAMPLE content.\n\nHigh-capacity power bank with fast charging.',
   2800, 2250, 'power-charging', 30, false, true,
   '[{"label":"Capacity","label_bn":"ক্যাপাসিটি","value":"20000mAh"},{"label":"Output","label_bn":"আউটপুট","value":"22.5W"}]'),
  ('Sample: Zen Electric Kettle', 'স্যাম্পল: জেন ইলেকট্রিক কেটলি', 'sample-zen-electric-kettle',
   '1.8L stainless steel, auto shut-off', '১.৮ লিটার স্টেইনলেস স্টিল, অটো শাট-অফ',
   E'This is SAMPLE content.\n\nFast-boil stainless steel kettle with auto shut-off.',
   2200, 1790, 'kitchen', 0, false, false,
   '[{"label":"Capacity","label_bn":"ধারণক্ষমতা","value":"1.8 L"}]'),
  ('Sample: Wave Neckband Earphones', 'স্যাম্পল: ওয়েভ নেকব্যান্ড ইয়ারফোন', 'sample-wave-neckband',
   '24h playtime, magnetic buds', '২৪ ঘণ্টা প্লেটাইম, ম্যাগনেটিক বাড',
   E'This is SAMPLE content.\n\nLightweight neckband earphones for everyday use.',
   1500, 1190, 'earbuds-audio', 50, false, false,
   '[{"label":"Playtime","label_bn":"প্লেটাইম","value":"24 hours"}]'),
  ('Sample: Fit Band 8', 'স্যাম্পল: ফিট ব্যান্ড ৮', 'sample-fit-band-8',
   'Slim fitness band, 14-day battery', 'স্লিম ফিটনেস ব্যান্ড, ১৪ দিনের ব্যাটারি',
   E'This is SAMPLE content.\n\nSlim fitness tracker with sleep and step tracking.',
   2600, null, 'smartwatches', 18, false, true,
   '[{"label":"Battery","label_bn":"ব্যাটারি","value":"14 days"}]')
) as v(name, name_bn, slug, sd, sd_bn, descr, price, disc, cat, stock, feat, isnew, specs)
on conflict (slug) do nothing;
