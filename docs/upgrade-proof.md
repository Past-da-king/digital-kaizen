# Upgrade proof: a real v1.2.0 data store upgraded to v1.4.0

Run on 4 Nov 2026 with `scripts/upgrade.js`, `scripts/rollback.js` and the commands shown. The v1.2.0 data store was made by running the real v1.2.0 code (git commit bc79263, the shipped v1.2.0) on the simulated factory with 3 days of seeded history plus a live stop, so it holds sensor history, status events, a downtime event, alerts, paired sensors and heartbeats. Nothing here is mocked: the same database file goes through dry run, upgrade, v1.4.0 running on it, rollback, and the old v1.2.0 app running on the restored file.

```

kaizen.db
kaizen.db-shm
kaizen.db-wal
=== 1. the v1.2.0 data store before anything ===
  alerts                     2 rows
  device_assignments         2 rows
  downtime_events            1 rows
  heartbeat                  2 rows
  machine_events           885 rows
  micro_stops                0 rows
  production             13180 rows

=== 2. dry run on a copy (node scripts/upgrade.js --check) ===

  DRY RUN on a copy of <data folder>/kaizen.db
  database version: unversioned (v1.2.0 or older) -> 4   (app 1.4.0)
  migrations applied: 1, 2, 3, 4
  safety backup: (of the copy) <temp folder>/backups/2026-11-04-11-10-52-before-v1.4.0

  rows per table, before -> after
    alerts                        2 ->        2
    auth_attempts             (new) ->        0
    auth_log                  (new) ->        0
    defect_logs               (new) ->        0
    device_assignments            2 ->        2
    downtime_events               1 ->        1
    downtime_logs             (new) ->        0
    heartbeat                     2 ->        2
    invites                   (new) ->        0
    issues                    (new) ->        0
    machine_events              885 ->      885
    mail_queue                (new) ->        0
    micro_stops                   0 ->        0
    production                13180 ->    13180
    report_facts              (new) ->        0
    schema_migrations         (new) ->        4
    sessions                  (new) ->        0
    settings                  (new) ->        0
    users                     (new) ->        0

  OK: every existing row is still there. Nothing real was changed.

=== 3. the real upgrade ===

  Upgrade of <data folder>/kaizen.db
  database version: unversioned (v1.2.0 or older) -> 4   (app 1.4.0)
  migrations applied: 1, 2, 3, 4
  safety backup: <data folder>/backups/2026-11-04-11-10-53-before-v1.4.0

  rows per table, before -> after
    alerts                        2 ->        2
    auth_attempts             (new) ->        0
    auth_log                  (new) ->        0
    defect_logs               (new) ->        0
    device_assignments            2 ->        2
    downtime_events               1 ->        1
    downtime_logs             (new) ->        0
    heartbeat                     2 ->        2
    invites                   (new) ->        0
    issues                    (new) ->        0
    machine_events              885 ->      885
    mail_queue                (new) ->        0
    micro_stops                   0 ->        0
    production                13180 ->    13180
    report_facts              (new) ->        0
    schema_migrations         (new) ->        4
    sessions                  (new) ->        0
    settings                  (new) ->        0
    users                     (new) ->        0

  OK: every existing row is still there.

=== 4. every old record after the upgrade, compared with before (content fingerprints) ===
  alerts               rows       2 ->       2   content IDENTICAL
  device_assignments   rows       2 ->       2   content IDENTICAL
  downtime_events      rows       1 ->       1   content IDENTICAL   (+1 new column, empty)
  heartbeat            rows       2 ->       2   content IDENTICAL
  machine_events       rows     885 ->     885   content IDENTICAL
  micro_stops          rows       0 ->       0   content IDENTICAL
  production           rows   13180 ->   13180   content IDENTICAL

  ALL OLD RECORDS PRESENT AND IDENTICAL

=== 5. v1.4.0 running on top of the old data ===
summary shots per machine: MA1=7236, MA2=5687
downtime events visible on the dashboard API: 1
sensors still paired: aacf12000ma1->MA1, aacf12000ma2->MA2
machines: MA1,MA2 | data range: 13180 shots from 2026-11-01 13:03:19 to 2026-11-04 13:08:27
OEE trend from the old shot history: 10-29=null 10-30=null 10-31=null 11-01=37.6 11-02=64.7 11-03=56.6 11-04=69.9

=== 6. ROLLBACK, then the OLD v1.2.0 app on the restored data ===

  Restored <data folder>/backups/2026-11-04-11-10-53-before-v1.4.0
  (the database you had until now is kept in <data folder>/rolled-back/2026-11-04-11-10-55)
    alerts                 backup        2   restored        2
    device_assignments     backup        2   restored        2
    downtime_events        backup        1   restored        1
    heartbeat              backup        2   restored        2
    machine_events         backup      885   restored      885
    micro_stops            backup        0   restored        0
    production             backup    13180   restored    13180

  OK. Now start the previous version of the app.

  alerts               rows       2 ->       2   content IDENTICAL
  device_assignments   rows       2 ->       2   content IDENTICAL
  downtime_events      rows       1 ->       1   content IDENTICAL
  heartbeat            rows       2 ->       2   content IDENTICAL
  machine_events       rows     885 ->     885   content IDENTICAL
  micro_stops          rows       0 ->       0   content IDENTICAL
  production           rows   13180 ->   13180   content IDENTICAL

  ALL OLD RECORDS PRESENT AND IDENTICAL
v1.2.0 app on the restored data:  13180 shots, from 2026-11-01 13:03:19 to 2026-11-04 13:08:27
done
```
