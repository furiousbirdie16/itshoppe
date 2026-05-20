# Business Insights — Default Date to Today

## Summary
Change the default date-range preset on the **Business Insights** page from **30 days** to **today** so the report loads with today's data on first visit.

## Change Details
- **File:** `src/pages/BusinessInsightsPage.tsx`
- **Line 55:** Update `useState` initial value from `"30d"` to `"today"`.

## Technical Details
```
Old: const [preset, setPreset] = useState<RangePreset>("30d");
New: const [preset, setPreset] = useState<RangePreset>("today");
```

This is the only change needed. The existing `useMemo` logic (line 72-82) already handles the `"today"` preset correctly by setting `dateFrom` to `startOfDay(now)` and `dateTo` to `endOfDay(now)`.
