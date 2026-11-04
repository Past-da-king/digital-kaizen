# Extracting the factory's reports (MA1 and MA2)

Goal: turn two months of the factory's own reports into rows the dashboard can use for MA1 and MA2,
so the trends, OEE and quality pages are not empty before the sensors have history.

## What the dashboard needs, per machine, per shift (or per day if the report has no shifts)

| Field | Meaning | Used for |
|---|---|---|
| `machine` | `MA1` or `MA2` | everything |
| `date` | `YYYY-MM-DD` (the day the shift started) | trends |
| `shift` | `A`, `B`, or `DAY` when the report has no shifts | per-shift OEE |
| `planned_minutes` | scheduled production time | Availability |
| `downtime_minutes` | total stops | Availability |
| `downtime_by_reason` | list of `{reason, minutes, planned}` | downtime-by-reason chart |
| `shots` | number of cycles/shots | Performance |
| `output_units` | parts produced (shots x cavities) | Quality, output |
| `ideal_cycle_sec` | ideal/standard cycle time | Performance |
| `avg_cycle_sec` | actual average cycle time | Performance |
| `defects` | total rejected parts | Quality |
| `defects_by_type` | list of `{type, qty}` | defects-by-type chart |
| `mould` | mould or product name, if given | ideal cycle per mould |
| `notes` | anything the report says about the shift | context |
| `source_file`, `source_page` | where the numbers came from | audit |

Leave a field `null` when the report does not say. **Never estimate.** The importer refuses rows whose
numbers contradict each other (for example downtime above planned time) and lists them for a person to check.

## How to run it

1. Put the report files in one folder (PDF, Excel, scans, photos all work for an AI reader).
2. For each file, give the AI the prompt in `docs/report-extraction-prompt.md` and the file. It returns one JSON array
   that matches `docs/report-extraction.schema.json`.
3. Save each answer as `<report name>.json` in a folder, then on the factory PC (or here):

   `node scripts/import-reports.js path/to/folder`          checks every file and prints problems, writes nothing
   `node scripts/import-reports.js path/to/folder --write`  stores the good rows

Rows go to the `report_facts` table (one row per machine, day and shift, safe to re-run: the same row is replaced,
never doubled). Sensor data and operator logs are never changed by an import.

## Where it shows up

Once the files are in, the OEE trend, downtime-by-reason and defects-by-type charts can read the days the sensors
and QR logs do not cover. (Wiring the charts to read `report_facts` is the one step that waits for real files,
so the field list above can be corrected against what the reports actually contain first.)
