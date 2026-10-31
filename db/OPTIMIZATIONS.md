# Оптимізації

Головна таблиця: `orders` (120000 рядків). Таблиця пошуку: `products` (120000 рядків).

Цикл: чистий volume → `db/schema.sql` → `db/seed.sql` → EXPLAIN до → `db/indexes.sql` → `ANALYZE` → EXPLAIN після. Для q4 взято третій прогін (прогрітий GIN).

## q1 — замовлення власника за період

### До

```
 Limit  (cost=3109.06..3109.07 rows=5 width=35) (actual time=22.814..22.815 rows=5 loops=1)
   Buffers: shared hit=1015
   ->  Sort  (cost=3109.06..3109.07 rows=5 width=35) (actual time=22.812..22.812 rows=5 loops=1)
         Sort Key: created_at DESC, id DESC
         Sort Method: quicksort  Memory: 25kB
         Buffers: shared hit=1015
         ->  Seq Scan on orders  (cost=0.00..3109.00 rows=5 width=35) (actual time=4.053..22.096 rows=5 loops=1)
               Filter: ((created_at >= '2024-03-01 00:00:00+00'::timestamp with time zone) AND (created_at < '2024-06-01 00:00:00+00'::timestamp with time zone) AND (user_id = 42))
               Rows Removed by Filter: 119995
               Buffers: shared hit=1009
 Planning Time: 4.396 ms
 Execution Time: 23.763 ms
```

### Після

```
 Limit  (cost=23.57..23.58 rows=5 width=35) (actual time=0.124..0.125 rows=5 loops=1)
   Buffers: shared hit=14 read=3
   ->  Sort  (cost=23.57..23.58 rows=5 width=35) (actual time=0.123..0.123 rows=5 loops=1)
         Sort Key: created_at DESC, id DESC
         Sort Method: quicksort  Memory: 25kB
         Buffers: shared hit=14 read=3
         ->  Bitmap Heap Scan on orders  (cost=4.48..23.51 rows=5 width=35) (actual time=0.070..0.092 rows=5 loops=1)
               Recheck Cond: ((user_id = 42) AND (created_at >= '2024-03-01 00:00:00+00'::timestamp with time zone) AND (created_at < '2024-06-01 00:00:00+00'::timestamp with time zone))
               Heap Blocks: exact=5
               Buffers: shared hit=8 read=3
               ->  Bitmap Index Scan on idx_orders_user_created_at  (cost=0.00..4.48 rows=5 width=0) (actual time=0.055..0.055 rows=5 loops=1)
                     Index Cond: ((user_id = 42) AND (created_at >= '2024-03-01 00:00:00+00'::timestamp with time zone) AND (created_at < '2024-06-01 00:00:00+00'::timestamp with time zone))
                     Buffers: shared hit=3 read=3
 Planning Time: 0.846 ms
 Execution Time: 0.219 ms
```

Індекс `idx_orders_user_created_at` став у вузол Bitmap Index Scan on idx_orders_user_created_at. Seq Scan по всіх 120000 рядках зник: умова `user_id` + діапазон `created_at` читається з btree, heap чіпає 5 сторінок замість 1009, час виконання падає з 23.763 ms до 0.219 ms.

## q2 — фільтр скасованих замовлень

### До

```
 Limit  (cost=2576.06..2576.11 rows=20 width=30) (actual time=6.033..6.037 rows=20 loops=1)
   Buffers: shared hit=1015
   ->  Sort  (cost=2576.06..2582.36 rows=2520 width=30) (actual time=6.032..6.033 rows=20 loops=1)
         Sort Key: created_at DESC, id DESC
         Sort Method: top-N heapsort  Memory: 27kB
         Buffers: shared hit=1015
         ->  Seq Scan on orders  (cost=0.00..2509.00 rows=2520 width=30) (actual time=0.008..5.554 rows=2400 loops=1)
               Filter: (status = 'cancelled'::text)
               Rows Removed by Filter: 117600
               Buffers: shared hit=1009
 Planning Time: 0.317 ms
 Execution Time: 6.078 ms
```

### Після

```
 Limit  (cost=0.28..16.75 rows=20 width=30) (actual time=0.031..0.044 rows=20 loops=1)
   Buffers: shared hit=9 read=2
   ->  Index Scan using idx_orders_cancelled_created_at on orders  (cost=0.28..1860.87 rows=2260 width=30) (actual time=0.030..0.041 rows=20 loops=1)
         Buffers: shared hit=9 read=2
 Planning Time: 0.459 ms
 Execution Time: 0.074 ms
```

Індекс `idx_orders_cancelled_created_at` став у вузол Index Scan using idx_orders_cancelled_created_at. Це partial-індекс лише для `status = 'cancelled'` (близько 2% рядків), уже відсортований за `created_at DESC, id DESC`, тож Seq Scan і Sort зникли: замість 1009 сторінок таблиці план читає 11 сторінок і зупиняється на LIMIT 20, час з 6.078 ms до 0.074 ms.

## q3 — пошук товару без урахування регістру

### До

```
 Seq Scan on products  (cost=0.00..7960.00 rows=600 width=47) (actual time=0.028..119.154 rows=1 loops=1)
   Filter: (lower(name) = 'туристичний пальник 2'::text)
   Rows Removed by Filter: 119999
   Buffers: shared hit=6160
 Planning Time: 0.328 ms
 Execution Time: 119.197 ms
```

### Після

```
 Index Scan using idx_products_lower_name on products  (cost=0.42..8.44 rows=1 width=47) (actual time=0.044..0.044 rows=1 loops=1)
   Index Cond: (lower(name) = 'туристичний пальник 2'::text)
   Buffers: shared hit=1 read=3
 Planning Time: 1.375 ms
 Execution Time: 0.071 ms
```

Індекс `idx_products_lower_name` став у вузол Index Scan using idx_products_lower_name. Це expression-індекс по `lower(name)`: без нього функція на колонці не дає btree по `name`, і план читає всі 6160 сторінок каталогу. Після індексу лишається точкове читання (4 сторінки), час з 119.197 ms до 0.071 ms.

## q4 — пошук по каталогу

### До

```
 Limit  (cost=7661.43..7661.48 rows=20 width=45) (actual time=16.491..16.494 rows=20 loops=1)
   Buffers: shared hit=6166
   ->  Sort  (cost=7661.43..7661.55 rows=49 width=45) (actual time=16.489..16.491 rows=20 loops=1)
         Sort Key: (ts_rank(search_vector, '''туристичні'' & ''намети'''::tsquery)) DESC, id
         Sort Method: top-N heapsort  Memory: 27kB
         Buffers: shared hit=6166
         ->  Seq Scan on products  (cost=0.00..7660.12 rows=49 width=45) (actual time=0.027..16.146 rows=2400 loops=1)
               Filter: (search_vector @@ '''туристичні'' & ''намети'''::tsquery)
               Rows Removed by Filter: 117600
               Buffers: shared hit=6160
 Planning Time: 0.614 ms
 Execution Time: 16.542 ms
```

### Після

```
 Limit  (cost=222.52..222.57 rows=20 width=45) (actual time=4.298..4.301 rows=20 loops=1)
   Buffers: shared hit=2346
   ->  Sort  (cost=222.52..222.65 rows=51 width=45) (actual time=4.297..4.298 rows=20 loops=1)
         Sort Key: (ts_rank(search_vector, '''туристичні'' & ''намети'''::tsquery)) DESC, id
         Sort Method: top-N heapsort  Memory: 27kB
         Buffers: shared hit=2346
         ->  Bitmap Heap Scan on products  (cost=30.32..221.16 rows=51 width=45) (actual time=0.662..3.903 rows=2400 loops=1)
               Recheck Cond: (search_vector @@ '''туристичні'' & ''намети'''::tsquery)
               Heap Blocks: exact=2331
               Buffers: shared hit=2340
               ->  Bitmap Index Scan on idx_products_search_vector  (cost=0.00..30.30 rows=51 width=0) (actual time=0.445..0.445 rows=2400 loops=1)
                     Index Cond: (search_vector @@ '''туристичні'' & ''намети'''::tsquery)
                     Buffers: shared hit=9
 Planning Time: 0.496 ms
 Execution Time: 4.361 ms
```

Індекс `idx_products_search_vector` став у вузол Bitmap Index Scan on idx_products_search_vector. Seq Scan по 6160 сторінках зник: GIN відбирає 2400 збігів (2% каталогу) за 9 сторінок індексу. Heap лишається, бо `ts_rank` рахується по кожному збігу перед LIMIT, тому час падає з 16.542 ms до 4.361 ms, а не на порядки, як у точкових q1–q3.

## Морфологія

`намети`: 2400 збігів. `наметів`: 960 збігів.

Конфігурація `simple` лише ріже текст на токени й зводить їх до нижнього регістру, без стемінгу, тому різні відмінки лишаються різними лексемами. У `pg_ts_config` української конфігурації немає, а підміна на `russian` стемінгує іншу мову і не є виправленням.
