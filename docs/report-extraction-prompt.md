# Prompt for the AI that reads a report

You are extracting production data from one factory report for an injection-moulding plant.
Only machines **MA1** and **MA2** matter; ignore every other machine.

Return ONLY a JSON array, no commentary. One object per machine per shift per day, exactly in this shape
(see `report-extraction.schema.json`):

```json
[{
  "machine": "MA1",
  "date": "2026-09-14",
  "shift": "A",
  "planned_minutes": 660,
  "downtime_minutes": 85,
  "downtime_by_reason": [{ "reason": "Mould change", "minutes": 45, "planned": true }, { "reason": "Material issue", "minutes": 40, "planned": false }],
  "shots": 1420,
  "output_units": 2840,
  "ideal_cycle_sec": 26,
  "avg_cycle_sec": 27.4,
  "defects": 31,
  "defects_by_type": [{ "type": "Short shot", "qty": 18 }, { "type": "Flash", "qty": 13 }],
  "mould": "Lid 2-cavity",
  "notes": "Hydraulic oil topped up at 14:00",
  "source_file": "Sept week 3.pdf",
  "source_page": 2
}]
```

Rules:
- Copy numbers exactly as printed. If a number is not on the report, use `null`. Never calculate, guess or round.
- `shift` is `A` (day) or `B` (night). If the report has no shifts, use `DAY`.
- `date` is the day the shift **started**.
- Mark a reason `planned: true` only if the report calls it scheduled or planned (mould change, scheduled maintenance, order complete).
- Times in minutes, cycle times in seconds. Convert hours to minutes only when the report gives hours.
- If a row is hard to read, still return it, put what you could read, and explain in `notes`.
- Every row must say which file and page it came from.
