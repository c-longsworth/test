# finance_review — MC Profit Centre

dbt (Snowflake) replacement for the hand-built `MC_Profit_center.xlsx`
contribution statement, surfaced in Looker.

```
odoo_*_st ─┐
           ├─→ int_gl_postings_unioned ──→ int_gl_pl_postings
non-odoo ──┘        (+ manual adjustments, source-tagged)
                              │
        ┌─────────────────────┼──────────────────────┐
        ↓                     ↓                      ↓
seed_variable_cost_keys  seed_allocation_keys   seed_cc_to_cc_rules
        │                     │                      │
        └─────→ int_alloc_pass1_cc_to_cc ────────────┘
                              ↓
                  int_alloc_pass2_cc_to_pc
                              ↓
                    fct_profit_centre_postings   ← SSOT, ties to GL
                              ↓
       seed_pl_report_lines → fct_mc_profit_centre   ← Looker reads this
```

Two models sit in the DAG that the sketch above does not name, both deliberate:

- **`int_cost_centre_pools` / `int_cost_centre_pools_post_pass1`** — pass 1 and
  pass 2 have to operate on pool balances, and pass 2 has to see post-pass-1
  balances specifically. Making that an explicit model is what stops pass 2 from
  quietly reading the pre-allocation pool.
- **`int_alloc_variable_cost_keys`** — the variable cost keys are the *third*
  mechanism and attach to an account group, not to a cost-centre pool. They do
  not belong inside either pass.

## What is real and what is placeholder

Everything under `models/` is written against the shapes described in the
brief. The project **parses clean** (`dbt parse`, dbt 1.12 — Jinja, refs, DAG,
and all 91 tests resolve) but has **never been run against Snowflake**, because
there was no warehouse to run it against. Treat the SQL as a reviewed first
draft, not as tested code.

Two things need doing before a first `dbt build`:

1. **Source columns.** `models/staging/_sources.yml` declares the columns each
   model reads. Where a real column name differs, fix it there and in the one
   staging model that reads it — nothing downstream references a source
   directly.
2. **Seed data.** Every row in `seeds/*.csv` is illustrative placeholder data
   shaped like the real thing. `seed_pl_report_lines` is an abbreviated 37-row
   version of the 202-row spec, covering the full structure. Replace all four
   before any output is shown to anyone.

The Odoo staging models (`odoo_*_st`) are declared as **sources** here rather
than `ref()`d, so this project builds standalone. When it merges into the
project that owns them, swap `source('odoo', ...)` for the matching `ref()` and
delete that source block. The column lists in `_sources.yml` are the contract
that swap has to satisfy.

## The decisions this scaffold makes

Where the brief left a choice open, the code takes one and says so. Each of
these is cheap to change and worth checking before building on it.

**One allocation mechanism per posting.** `int_gl_pl_postings.allocation_route`
routes each posting to exactly one of `direct` / `variable_key` /
`cost_centre_pool`. A posting that went through two would be double-counted at
profit-centre level while still tying to the GL in total — a wrong number with a
green reconciliation test, which is the worst failure mode available here.

**Pooled postings sit at profit centre `'-'` in the GL layer.** They reach a
profit centre through their allocation layer instead. That keeps them in the GL
tie-out without landing them on a profit centre twice.

**Pass 1 is recursive, not a single hop.** `1500 → 4200` where 4200 itself
allocates onward is a real pattern in the config, so the chain is resolved with
a recursive CTE capped at `var('cc_to_cc_max_depth')` (default 5). A cycle hits
the cap and leaves a residue, which
`assert_cc_to_cc_allocation_fully_drains` reports rather than swallows.

**Coverage gaps land somewhere visible.** A pool whose key has no matching share
rows is not dropped: it goes whole to the cost centre's default profit centre,
else `UNALLOCATED`, flagged `is_key_coverage_gap`. With the allocation keys
currently being the stale Jan-2025 backup, gaps are expected — they need to be a
number on a dashboard, not a silent shortfall.

**Ledger signs throughout.** Costs stay negative all the way to
`fct_mc_profit_centre`. Presentation signs are Looker's job; flipping them
mid-pipeline is how a subtotal stops matching its parts.

**The report is long, not wide.** One row per profit centre × month × report
line, with `month_value`, `ytd_value`, `rolling_year_value`. Looker pivots
months across columns. Adding a month is then data, not a schema change.

**Ratios are not summed.** `ytd_value` and `rolling_year_value` are null on
ratio rows — a YTD margin is computed from YTD components, not by adding twelve
percentages. Compute it in Looker from the two component rows.

**`seed_pl_report_lines` gained two columns** beyond the six in the brief:
`ratio_numerator_row` and `ratio_denominator_row`. Encoding a ratio inside
`subtotal_formula` would have put two grammars in one field.

## Tests

The reconciliation tests are the point of the build; the schema tests are
hygiene.

| Test | What it protects |
|---|---|
| `assert_profit_centre_postings_tie_to_gl` | The whole thing. Fact total = GL total, by company and month. |
| `assert_cost_centre_pools_net_to_zero` | Every pool nets to zero after allocation — free, via the contra-row convention. |
| `assert_variable_cost_keys_net_to_zero` | Same, for the variable-key layer. |
| `assert_cc_to_cc_allocation_fully_drains` | Pass 1 emptied every self-allocating centre. Residue never reaches a profit centre. |
| `assert_centre_code_parses_from_analytic_label` | An Odoo rename dropping the `[8051]` prefix and silently dumping postings into `UNALLOCATED`. |
| `assert_no_unallocated_where_cost_centre_required` | Volume in `UNALLOCATED` on accounts that require a cost centre. Warn — the number is the signal. |
| `assert_report_line_formulas_resolve` | Subtotals reference rows that exist, and only rows above themselves. |
| `shares_sum_to_one` (all three key seeds) | A key summing to 0.98 loses 2% of a pool and fails nothing else. |
| `no_overlapping_date_ranges` / `no_date_range_gaps` | Double-allocated or uncovered months. |

`assert_reconciliation_target_month_is_covered` fails while the chosen
reconciliation month produces no output, so "we have not reconciled yet" stays
visible as a red test. Set the target with `vars: recon_company_tla` /
`recon_month`.

## Running it

```bash
cp profiles.yml.example ~/.dbt/profiles.yml   # then fill in credentials
dbt deps
dbt seed
dbt build --select +fct_profit_centre_postings   # stop here until it reconciles
dbt build                                        # then the report
```

Build order from the brief, and it matters:

1. `int_gl_postings_unioned` and `int_gl_pl_postings`
2. Both allocation passes, against the **backup** keys
3. Reconcile to a known historical month **before anything reaches Looker**
4. `seed_pl_report_lines` and `fct_mc_profit_centre` last

## Still blocked

**The allocation keys.** The live `Allocation keys` sheet is a `QUERY` over four
`IMPORTRANGE`s and exports as `#VALUE!`. `seed_allocation_keys` is built to be
loaded from `Allocation keys (backup-20250101)` — 430 rows, 411 PDE, stale since
Jan 2025. `Allocation trans.` also references `FM4105` and `FM4106`, which appear
in neither sheet. The four source spreadsheet IDs are in the formula in that
sheet.

Needed: the underlying data, plus a decision on seed vs. governed input table.
The scaffold assumes **seed** for now, which is the right call only if the keys
change a few times a year and a PR is an acceptable edit path. If finance edits
them monthly, make it a governed upload table on the `finance_uploads` schema
alongside the import sheets — that is a one-model change
(`seed_allocation_keys` → a `stg_allocation_keys` reading the source), and the
tests move with it.

**Reporting currency** is unresolved and the code currently sidesteps it:
`stg_manual_adjustments` takes `coalesce(amount, amount_eur)` and every model
carries a `currency` column, but nothing converts. The MC report header says
"Values in accounting currency" while `Finance data` carries `Amount €`. Until
that is settled — per-company local or group EUR, and if EUR, close rate or
period average — `fct_mc_profit_centre` sums across currencies, which is wrong
for any company not on EUR. Single-company reporting is safe; group totals are
not. Resolving it means a rates seed and a conversion in
`int_gl_postings_unioned`.

**The reconciliation target.** `recon_company_tla` / `recon_month` default to
PDE / 2024-12, which is a guess. It needs to be a company + month with a
signed-off MC output. PDE is the awkward choice — it is the DATEV company, so
picking it validates the allocation logic against the import path rather than
the Odoo path. An Odoo company with a signed-off month would test more of the
pipeline.

## Known limitation

Management-adjustment comments (`Additional management reporting`) survive to
the mart only on postings that route `direct`. An adjustment routed through a
cost-centre pool is aggregated with everything else in that pool and its comment
is lost. If adjustments do go through pools in practice, the fix is to carry
adjustment rows past the pools unaggregated rather than to widen the pool grain.
