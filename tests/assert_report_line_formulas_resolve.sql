/*
    Two things the report spec has to satisfy, both of which produce a wrong
    number rather than an error if violated:

    1. Every row_order referenced by a subtotal_formula exists.
    2. A subtotal only references rows above it. That rule is what makes the
       recursive expansion terminate — a forward reference would either loop
       until the depth cap or resolve against a row that is itself unresolved.
*/

{{ config(severity='error') }}

with refs as (

    select
        l.row_order                                          as subtotal_row_order,
        abs(trim(f.value::varchar)::int)                     as referenced_row_order
    from {{ ref('seed_pl_report_lines') }} l,
         lateral flatten(input => split(l.subtotal_formula, ',')) f
    where l.row_type = 'subtotal'
      and nullif(trim(l.subtotal_formula), '') is not null
      and trim(f.value::varchar) <> ''

),

ratio_refs as (

    select row_order as subtotal_row_order, ratio_numerator_row as referenced_row_order
    from {{ ref('seed_pl_report_lines') }}
    where row_type = 'ratio' and ratio_numerator_row is not null

    union all

    select row_order, ratio_denominator_row
    from {{ ref('seed_pl_report_lines') }}
    where row_type = 'ratio' and ratio_denominator_row is not null

),

all_refs as (

    select *, true as must_reference_upwards from refs
    union all
    select *, false from ratio_refs

)

select
    r.subtotal_row_order,
    r.referenced_row_order,
    case
        when l.row_order is null then 'referenced row does not exist'
        else 'subtotal references a row below itself'
    end as failure_reason
from all_refs r
left join {{ ref('seed_pl_report_lines') }} l
    on r.referenced_row_order = l.row_order
where l.row_order is null
   or (r.must_reference_upwards and r.referenced_row_order >= r.subtotal_row_order)
