-- Stoph Shop — 05 OPTIONAL demo data. NOT for production.
-- All demo rows use the slug prefix "demo-". Remove them with the block at the bottom.
-- Demo products have no images: upload real ones from /admin.

insert into public.categories (slug, name_ar, name_fr, sort_order) values
  ('demo-accessories', 'إكسسوارات (تجريبي)', 'Accessoires (démo)', 1),
  ('demo-home', 'المنزل (تجريبي)', 'Maison (démo)', 2);

insert into public.products (category_id, slug, name_ar, name_fr, description_ar, description_fr, price, sale_price, is_published, is_featured)
select c.id, v.slug, v.name_ar, v.name_fr, 'منتج تجريبي', 'Produit de démonstration', v.price, v.sale, true, v.feat
from (values
  ('demo-accessories','demo-watch','ساعة تجريبية','Montre démo',299,249,true),
  ('demo-accessories','demo-wallet','محفظة تجريبية','Portefeuille démo',120,null,true),
  ('demo-home','demo-lamp','مصباح تجريبي','Lampe démo',180,null,false)
) as v(cat, slug, name_ar, name_fr, price, sale, feat)
join public.categories c on c.slug = v.cat;

insert into public.product_variants (product_id, label_ar, label_fr, color, is_available, sort_order)
select p.id, v.la, v.lf, v.color, v.av, v.so
from (values
  ('demo-watch','أسود','Noir','black',true,1),
  ('demo-watch','فضي','Argent','silver',false,2),
  ('demo-lamp','صغير','Petit',null,true,1),
  ('demo-lamp','كبير','Grand',null,true,2)
) as v(slug, la, lf, color, av, so)
join public.products p on p.slug = v.slug;

insert into public.shipping_rates (city, fee) values ('Casablanca', 25), ('Fès', 30);

-- ---- CLEANUP (run to remove demo data) ----
-- delete from public.products where slug like 'demo-%';
-- delete from public.categories where slug like 'demo-%';
-- delete from public.shipping_rates where city in ('Casablanca','Fès');
