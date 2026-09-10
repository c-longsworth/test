{{ config(materialized='table') }}

/*
    The MC report: `MC_Profit_center.xlsx -> Profit center per Month`.

    Emitted LONG — one row per profit centre x month x report line, with the
    month value, YTD and rolling year alongside. The workbook puts months across
    columns; that is a presentation concern and Looker pivots it. Keeping the
    model long means adding a month is data, not a schema change.

    Row resolution follows seed_pl_report_lines.row_type:

      account_group  direct GL sum on the account group, taken from the 'gl'
                     layer plus the variable-key allocation layer (a posting is
                     in exactly one of those by construction, so no double count)
      cost_centre    this profit centre's allocated share of a cost-centre pool,
                     from the pass-2 layer
      subtotal       the signed sum of its leaf components, via
                     int_pl_report_line_expansion
      ratio          numerator row / denominator row, denominator being Revenue

    Sign convention: amounts stay in ledger signs (costs negative) all the way
    through. The workbook's presentation signs are applied in Looker, not here —
    flipping signs mid-pipeline is how a subtotal ends up not matching its parts.
*/

with report_lines as (

    select *
    from {{ ref('seed_pl_report_lines') }}

),

postings as (

    select *
    from {{ ref('fct_profit_centre_postings') }}
    -- '-' is the contra counterparty that makes each pool net to zero. It is
    -- part of the reconciliation, never part of the report.
    where profit_centre_code <> '-'

),

spine as (

    select distinct
        p.company_tla,
        p.profit_centre_code,
        p.period_month
    from postings p

),

grid as (

    select
        s.company_tla,
        s.profit_centre_code,
        s.period_month,
        l.row_order,
        l.label,
        l.indent_level,
        l.row_type,
        l.source_code,
        l.ratio_numerator_row,
        l.ratio_denominator_row
    from spine s
    cross join report_lines l

),

account_group_values as (

    select
        company_tla,
        profit_centre_code,
        period_month,
        account_group as source_code,
        sum(amount)   as value
    from postings
    where layer in ('gl', 'alloc_var_key')
    group by 1, 2, 3, 4

),

cost_centre_values as (

    select
        company_tla,
        profit_centre_code,
        period_month,
        cost_centre_code as source_code,
        sum(amount)      as value
    from postings
    where layer = 'alloc_cc_to_pc'
    group by 1, 2, 3, 4

),

leaf_values as (

    select
        g.company_tla,
        g.profit_centre_code,
        g.period_month,
        g.row_order,
        coalesce(
            case g.row_type
                when 'account_group' then agv.value
                when 'cost_centre'   then ccv.value
            end,
            0
        )::number(38, 4) as value
    from grid g
    left join account_group_values agv
        on g.row_type = 'account_group'
       and g.company_tla = agv.company_tla
       and g.profit_centre_code = agv.profit_centre_code
       and g.period_month = agv.period_month
       and g.source_code = agv.source_code
    left join cost_centre_values ccv
        on g.row_type = 'cost_centre'
       and g.company_tla = ccv.company_tla
       and g.profit_centre_code = ccv.profit_centre_code
       and g.period_month = ccv.period_month
       and g.source_code = ccv.source_code
    where g.row_type in ('account_group', 'cost_centre')

),

subtotal_values as (

    select
        lv.company_tla,
        lv.profit_centre_code,
        lv.period_month,
        e.subtotal_row_order            as row_order,
        sum(lv.value * e.sign)::number(38, 4) as value
    from {{ ref('int_pl_report_line_expansion') }} e
    join leaf_values lv
        on lv.row_order = e.component_row_order
    group by 1, 2, 3, 4

),

resolved as (

    select company_tla, profit_centre_code, period_month, row_order, value from leaf_values
    union all
    select company_tla, profit_centre_code, period_month, row_order, value from subtotal_values

),

ratio_values as (

    select
        g.company_tla,
        g.profit_centre_code,
        g.period_month,
        g.row_order,
        -- denominator is Revenue; a profit centre with no revenue in the month
        -- shows null rather than a divide-by-zero or a misleading 0%.
        (num.value / nullif(den.value, 0))::number(38, 6) as value
    from grid g
    left join resolved num
        on g.company_tla = num.company_tla
       and g.profit_centre_code = num.profit_centre_code
       and g.period_month = num.period_month
       and g.ratio_numerator_row = num.row_order
    left join resolved den
        on g.company_tla = den.company_tla
       and g.profit_centre_code = den.profit_centre_code
       and g.period_month = den.period_month
       and g.ratio_denominator_row = den.row_order
    where g.row_type = 'ratio'

),

all_values as (

    select company_tla, profit_centre_code, period_month, row_order, value from resolved
    union all
    select company_tla, profit_centre_code, period_month, row_order, value from ratio_values

),

with_windows as (

    select
        v.*,
        -- YTD: same calendar year, months up to and including this one.
        sum(case when v.value is not null then v.value end) over (
            partition by v.company_tla, v.profit_centre_code, v.row_order,
                         date_part('year', v.period_month)
            order by v.period_month
            rows between unbounded preceding and current row
        ) as ytd_value,
        -- Rolling year: this month plus the 11 before it.
        sum(case when v.value is not null then v.value end) over (
            partition by v.company_tla, v.profit_centre_code, v.row_order
            order by v.period_month
            rows between 11 preceding and current row
        ) as rolling_year_value,
        count(v.period_month) over (
            partition by v.company_tla, v.profit_centre_code, v.row_order
            order by v.period_month
            rows between 11 preceding and current row
        ) as rolling_year_month_count
    from all_values v

)

select
    w.company_tla,
    w.profit_centre_code,
    w.period_month,
    l.row_order,
    l.label,
    l.indent_level,
    l.row_type,
    l.source_code,
    w.value                          as month_value,
    -- Summing a ratio makes no sense; YTD and rolling ratios are recomputed
    -- from their own YTD / rolling components in Looker.
    case when l.row_type <> 'ratio' then w.ytd_value end          as ytd_value,
    case when l.row_type <> 'ratio' then w.rolling_year_value end as rolling_year_value,
    w.rolling_year_month_count < 12 as is_rolling_year_incomplete
from with_windows w
join {{ ref('seed_pl_report_lines') }} l
    on w.row_order = l.row_order
