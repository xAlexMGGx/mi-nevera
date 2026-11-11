-- Generado con npm run shelf-life:migration a partir de src/content/conservation/shelf-life.json.
-- No editar a mano. Reemplaza la guía entera.

delete from public.shelf_life_guide;

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'opened'::public.shelf_state, 3, 5, 'Fiambre loncheado, con el envase abierto', 'Lunch meat, opened package', 'fda-chart-2018' from public.catalog_items where slug = 'jamon-cocido';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'opened'::public.shelf_state, 3, 5, 'Fiambre loncheado, con el envase abierto', 'Lunch meat, opened package', 'fda-chart-2018' from public.catalog_items where slug = 'pavo-lonchas';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'opened'::public.shelf_state, 21, 21, 'Embutido curado, en el frigorífico', 'Hard or dry sausage, refrigerated', 'fsis-shelf-stable-2014' from public.catalog_items where slug = 'chorizo';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'opened'::public.shelf_state, 21, 21, 'Embutido curado, en el frigorífico', 'Hard or dry sausage, refrigerated', 'fsis-shelf-stable-2014' from public.catalog_items where slug = 'salchichon';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'opened'::public.shelf_state, 60, 60, 'Mayonesa comercial, en el frigorífico', 'Commercial mayonnaise, refrigerated', 'fsis-basics-2011' from public.catalog_items where slug = 'mayonesa';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'opened'::public.shelf_state, 5, 7, 'Conserva ácida (tomate), en el frigorífico', 'High-acid canned food (tomatoes), refrigerated', 'fsis-shelf-stable-2014' from public.catalog_items where slug = 'tomate-frito';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'opened'::public.shelf_state, 5, 7, 'Conserva ácida (tomate), en el frigorífico', 'High-acid canned food (tomatoes), refrigerated', 'fsis-shelf-stable-2014' from public.catalog_items where slug = 'tomate-triturado';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'opened'::public.shelf_state, 5, 7, 'Zumo ácido (naranja), en el frigorífico', 'High-acid juice (orange), refrigerated', 'fsis-shelf-stable-2014' from public.catalog_items where slug = 'zumo-naranja';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'opened'::public.shelf_state, 3, 4, 'Conserva poco ácida, en el frigorífico', 'Low-acid canned food, refrigerated', 'fsis-shelf-stable-2014' from public.catalog_items where slug = 'maiz-lata';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'opened'::public.shelf_state, 3, 4, 'Conserva poco ácida, en el frigorífico', 'Low-acid canned food, refrigerated', 'fsis-shelf-stable-2014' from public.catalog_items where slug = 'guisantes-bote';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'opened'::public.shelf_state, 3, 4, 'Conserva poco ácida (legumbres), en el frigorífico', 'Low-acid canned food (beans), refrigerated', 'fsis-shelf-stable-2014' from public.catalog_items where slug = 'garbanzos-cocidos';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'opened'::public.shelf_state, 3, 4, 'Conserva poco ácida (legumbres), en el frigorífico', 'Low-acid canned food (beans), refrigerated', 'fsis-shelf-stable-2014' from public.catalog_items where slug = 'lentejas-cocidas';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'opened'::public.shelf_state, 3, 4, 'Conserva poco ácida (legumbres), en el frigorífico', 'Low-acid canned food (beans), refrigerated', 'fsis-shelf-stable-2014' from public.catalog_items where slug = 'alubias-cocidas';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'opened'::public.shelf_state, 3, 4, 'Conserva poco ácida (verdura), en el frigorífico', 'Low-acid canned food (vegetables), refrigerated', 'fsis-shelf-stable-2014' from public.catalog_items where slug = 'esparragos';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'opened'::public.shelf_state, 3, 4, 'Conserva de pescado, fuera de la lata', 'Canned seafood, out of the can', 'fda-chart-2018' from public.catalog_items where slug = 'atun-lata';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'opened'::public.shelf_state, 3, 4, 'Conserva de pescado, fuera de la lata', 'Canned seafood, out of the can', 'fda-chart-2018' from public.catalog_items where slug = 'sardinas-lata';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'opened'::public.shelf_state, 3, 4, 'Conserva de pescado, fuera de la lata', 'Canned seafood, out of the can', 'fda-chart-2018' from public.catalog_items where slug = 'mejillones-lata';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, 90, 120, 'Carne picada', 'Ground meat', 'fda-chart-2018' from public.catalog_items where slug = 'carne-picada';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, 180, 360, 'Filetes', 'Steaks', 'fda-chart-2018' from public.catalog_items where slug = 'filetes-ternera';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, 120, 180, 'Chuletas', 'Chops', 'fda-chart-2018' from public.catalog_items where slug = 'chuletas-cerdo';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, 120, 360, 'Piezas para asar', 'Roasts', 'fda-chart-2018' from public.catalog_items where slug = 'lomo-cerdo';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, 360, 360, 'Pollo o pavo entero', 'Whole chicken or turkey', 'fda-chart-2018' from public.catalog_items where slug = 'pollo-entero';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, 270, 270, 'Piezas de pollo o pavo', 'Chicken or turkey parts', 'fda-chart-2018' from public.catalog_items where slug = 'pechuga-pollo';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, 270, 270, 'Piezas de pollo o pavo', 'Chicken or turkey parts', 'fda-chart-2018' from public.catalog_items where slug = 'muslos-pollo';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, 270, 270, 'Piezas de pollo o pavo', 'Chicken or turkey parts', 'fda-chart-2018' from public.catalog_items where slug = 'pavo';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, 30, 60, 'Salchichas', 'Sausages and hot dogs', 'fda-chart-2018' from public.catalog_items where slug = 'salchichas';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, 30, 30, 'Beicon', 'Bacon', 'fda-chart-2018' from public.catalog_items where slug = 'bacon';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, 30, 60, 'Fiambre loncheado', 'Lunch meat', 'fda-chart-2018' from public.catalog_items where slug = 'jamon-cocido';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, 30, 60, 'Fiambre loncheado', 'Lunch meat', 'fda-chart-2018' from public.catalog_items where slug = 'pavo-lonchas';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, 30, 60, 'Embutido curado', 'Hard sausage', 'fsis-basics-2011' from public.catalog_items where slug = 'chorizo';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, 30, 60, 'Embutido curado', 'Hard sausage', 'fsis-basics-2011' from public.catalog_items where slug = 'salchichon';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, 180, 240, 'Pescado blanco (magro)', 'Lean fish', 'fda-chart-2018' from public.catalog_items where slug = 'merluza';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, 180, 240, 'Pescado blanco (magro)', 'Lean fish', 'fda-chart-2018' from public.catalog_items where slug = 'bacalao';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, 180, 240, 'Pescado blanco (magro)', 'Lean fish', 'fda-chart-2018' from public.catalog_items where slug = 'lubina';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, 180, 240, 'Pescado blanco (magro)', 'Lean fish', 'fda-chart-2018' from public.catalog_items where slug = 'dorada';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, 60, 90, 'Pescado azul (graso)', 'Fatty fish', 'fda-chart-2018' from public.catalog_items where slug = 'salmon';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, 60, 90, 'Pescado azul (graso)', 'Fatty fish', 'fda-chart-2018' from public.catalog_items where slug = 'sardinas';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, 60, 90, 'Pescado azul (graso)', 'Fatty fish', 'fda-chart-2018' from public.catalog_items where slug = 'boquerones';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, 60, 90, 'Pescado azul (graso)', 'Fatty fish', 'fda-chart-2018' from public.catalog_items where slug = 'atun-fresco';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, 90, 180, 'Gambas, calamares y similares', 'Shrimp, squid and similar', 'fda-chart-2018' from public.catalog_items where slug = 'gambas';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, 90, 180, 'Gambas, calamares y similares', 'Shrimp, squid and similar', 'fda-chart-2018' from public.catalog_items where slug = 'calamares';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, 90, 180, 'Gambas, calamares y similares', 'Shrimp, squid and similar', 'fda-chart-2018' from public.catalog_items where slug = 'gambas-congeladas';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, null, null, 'Huevos con cáscara: no congelar', 'Eggs in shell: don''t freeze', 'fda-chart-2018' from public.catalog_items where slug = 'huevos';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, null, null, 'Mayonesa comercial: no congelar', 'Commercial mayonnaise: don''t freeze', 'fsis-basics-2011' from public.catalog_items where slug = 'mayonesa';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'frozen'::public.shelf_state, null, null, 'Ensaladas preparadas: no congelar', 'Prepared salads: don''t freeze', 'fda-chart-2018' from public.catalog_items where slug = 'ensaladilla';

insert into public.shelf_life_guide (category, state, min_days, max_days, note_es, note_en, source)
values ('cooked'::public.category, 'frozen'::public.shelf_state, 60, 90, 'Platos cocinados con carne, sopas y guisos', 'Cooked meat dishes, soups and stews', 'fda-chart-2018');

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'thawed'::public.shelf_state, 1, 2, 'Carne picada, descongelada en el frigorífico', 'Ground meat, thawed in the refrigerator', 'fsis-big-thaw' from public.catalog_items where slug = 'carne-picada';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'thawed'::public.shelf_state, 1, 2, 'Pollo y pavo, descongelados en el frigorífico', 'Poultry, thawed in the refrigerator', 'fsis-big-thaw' from public.catalog_items where slug = 'pechuga-pollo';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'thawed'::public.shelf_state, 1, 2, 'Pollo y pavo, descongelados en el frigorífico', 'Poultry, thawed in the refrigerator', 'fsis-big-thaw' from public.catalog_items where slug = 'muslos-pollo';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'thawed'::public.shelf_state, 1, 2, 'Pollo y pavo, descongelados en el frigorífico', 'Poultry, thawed in the refrigerator', 'fsis-big-thaw' from public.catalog_items where slug = 'pollo-entero';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'thawed'::public.shelf_state, 1, 2, 'Pollo y pavo, descongelados en el frigorífico', 'Poultry, thawed in the refrigerator', 'fsis-big-thaw' from public.catalog_items where slug = 'pavo';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'thawed'::public.shelf_state, 3, 5, 'Filetes, chuletas y asados, descongelados en el frigorífico', 'Steaks, chops and roasts, thawed in the refrigerator', 'fsis-big-thaw' from public.catalog_items where slug = 'filetes-ternera';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'thawed'::public.shelf_state, 3, 5, 'Filetes, chuletas y asados, descongelados en el frigorífico', 'Steaks, chops and roasts, thawed in the refrigerator', 'fsis-big-thaw' from public.catalog_items where slug = 'chuletas-cerdo';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'thawed'::public.shelf_state, 3, 5, 'Filetes, chuletas y asados, descongelados en el frigorífico', 'Steaks, chops and roasts, thawed in the refrigerator', 'fsis-big-thaw' from public.catalog_items where slug = 'lomo-cerdo';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'thawed'::public.shelf_state, 3, 5, 'Filetes, chuletas y asados, descongelados en el frigorífico', 'Steaks, chops and roasts, thawed in the refrigerator', 'fsis-big-thaw' from public.catalog_items where slug = 'cordero';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'thawed'::public.shelf_state, 1, 2, 'Pescado y marisco, descongelados en el frigorífico', 'Seafood, thawed in the refrigerator', 'fsis-big-thaw' from public.catalog_items where slug = 'salmon';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'thawed'::public.shelf_state, 1, 2, 'Pescado y marisco, descongelados en el frigorífico', 'Seafood, thawed in the refrigerator', 'fsis-big-thaw' from public.catalog_items where slug = 'merluza';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'thawed'::public.shelf_state, 1, 2, 'Pescado y marisco, descongelados en el frigorífico', 'Seafood, thawed in the refrigerator', 'fsis-big-thaw' from public.catalog_items where slug = 'bacalao';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'thawed'::public.shelf_state, 1, 2, 'Pescado y marisco, descongelados en el frigorífico', 'Seafood, thawed in the refrigerator', 'fsis-big-thaw' from public.catalog_items where slug = 'lubina';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'thawed'::public.shelf_state, 1, 2, 'Pescado y marisco, descongelados en el frigorífico', 'Seafood, thawed in the refrigerator', 'fsis-big-thaw' from public.catalog_items where slug = 'dorada';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'thawed'::public.shelf_state, 1, 2, 'Pescado y marisco, descongelados en el frigorífico', 'Seafood, thawed in the refrigerator', 'fsis-big-thaw' from public.catalog_items where slug = 'sardinas';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'thawed'::public.shelf_state, 1, 2, 'Pescado y marisco, descongelados en el frigorífico', 'Seafood, thawed in the refrigerator', 'fsis-big-thaw' from public.catalog_items where slug = 'boquerones';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'thawed'::public.shelf_state, 1, 2, 'Pescado y marisco, descongelados en el frigorífico', 'Seafood, thawed in the refrigerator', 'fsis-big-thaw' from public.catalog_items where slug = 'atun-fresco';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'thawed'::public.shelf_state, 1, 2, 'Pescado y marisco, descongelados en el frigorífico', 'Seafood, thawed in the refrigerator', 'fsis-big-thaw' from public.catalog_items where slug = 'gambas';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'thawed'::public.shelf_state, 1, 2, 'Pescado y marisco, descongelados en el frigorífico', 'Seafood, thawed in the refrigerator', 'fsis-big-thaw' from public.catalog_items where slug = 'mejillones';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'thawed'::public.shelf_state, 1, 2, 'Pescado y marisco, descongelados en el frigorífico', 'Seafood, thawed in the refrigerator', 'fsis-big-thaw' from public.catalog_items where slug = 'calamares';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'thawed'::public.shelf_state, 1, 2, 'Pescado y marisco, descongelados en el frigorífico', 'Seafood, thawed in the refrigerator', 'fsis-big-thaw' from public.catalog_items where slug = 'pulpo';

insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)
select id, 'thawed'::public.shelf_state, 1, 2, 'Pescado y marisco, descongelados en el frigorífico', 'Seafood, thawed in the refrigerator', 'fsis-big-thaw' from public.catalog_items where slug = 'gambas-congeladas';

insert into public.shelf_life_guide (category, state, min_days, max_days, note_es, note_en, source)
values ('fish'::public.category, 'thawed'::public.shelf_state, 1, 2, 'Pescado y marisco, descongelados en el frigorífico', 'Seafood, thawed in the refrigerator', 'fsis-big-thaw');

insert into public.shelf_life_guide (category, state, min_days, max_days, note_es, note_en, source)
values ('cooked'::public.category, 'cooked'::public.shelf_state, 3, 4, 'Sobras: platos cocinados, sopas y guisos, en el frigorífico', 'Leftovers: cooked dishes, soups and stews, refrigerated', 'fda-chart-2018');
