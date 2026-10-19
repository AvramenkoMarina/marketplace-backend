# Restore drill

Дата прогону: **2026-10-19** (дамп `backups/marketplace-2026-10-19T145642Z.dump`, 14:56:42 UTC).

| | |
|---|---|
| База-джерело | `marketplace` через PgBouncer `127.0.0.1:6432`, `pool_mode = transaction` |
| Дамп | `pg_dump -Fc`, **4 378 832 байти** |
| Контроль | `count(orders)` \| `sum(total)` = `120000\|72599400.00` |
| Відновлення | порожній контейнер `postgres:16-alpine` і новий volume `marketplace_restore_drill`, `pg_restore --no-owner --no-privileges` |
| Час `pg_restore` | **3 секунди** |
| Повторний запуск | той самий дамп, **2 секунди**, знову `MATCH`; контейнер і volume скрипт прибирає сам |

Обидва запуски `scripts/restore-drill.sh` надрукували `MATCH` і завершились з кодом 0.

**RTO: 3 seconds.** Це виміряний час `pg_restore` цього дампа в порожній Postgres 16. Повторний прогін зайняв 2 seconds.

**RPO: 24 hours.** `backup.cron` запускає бекап щоночі о 03:00. Якщо база впаде за хвилину до наступного запуску, остання успішна копія — вчорашня о 03:00, тож можна втратити до 24 годин записів.
