{{ config(materialized='table') }}

/*
    Flattens every subtotal row in seed_pl_report_lines into the signed set of
    leaf rows it is made of.

    Why bother: subtotals reference other subtotals (CM II is CM I minus the
    fulfilment / sales / customer-service block), so evaluating them in order
    would mean a sequential walk over a profit-centre x month grid. Recursing
    over the 202-row SEED instead is cheap — it happens once, produces a small
    bridge, and the mart becomes a plain join and sum.

    `subtotal_formula` is a comma-separated list of signed row_order references,
    e.g. "10,-20". A subtotal may only reference rows above it (lower
    row_order); that rule is what guarantees termination, and
    assert_report_line_formulas_resolve enforces it.
*/

with recursive lines as (

    select
        row_order,
        row_type,
        subtotal_formula
    from {{ ref('seed_pl_report_lines') }}

),

direct_refs as (

    select
        l.row_order                                         as subtotal_row_order,
        abs(trim(f.value::varchar)::int)                    as component_row_order,
        case when trim(f.value::varchar) like '-%' then -1 else 1 end as sign
    from lines l,
         lateral flatten(input => split(l.subtotal_formula, ',')) f
    where l.row_type = 'subtotal'
      and nullif(trim(l.subtotal_formula), '') is not null
      and trim(f.value::varchar) <> ''

),

expansion as (

    select
        subtotal_row_order,
        component_row_order,
        sign,
        1 as depth
    from direct_refs

    union all

    select
        e.subtotal_row_order,
        d.component_row_order,
        e.sign * d.sign,
        e.depth + 1
    from expansion e
    join direct_refs d
        on d.subtotal_row_order = e.component_row_order
    where e.depth < 20

),

leaves_only as (

    select
        e.subtotal_row_order,
        e.component_row_order,
        e.sign
    from expansion e
    join lines l
        on l.row_order = e.component_row_order
    where l.row_type <> 'subtotal'

)

select
    subtotal_row_order,
    component_row_order,
    sum(sign) as sign
from leaves_only
group by 1, 2
having sum(sign) <> 0
