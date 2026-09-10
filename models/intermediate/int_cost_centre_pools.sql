{{ config(materialized='table') }}

/*
    The pool balance of every cost centre, before any allocation.

    Grain: source system x company x month x cost centre x originating account
    group. `source_system` is carried the whole way through both allocation
    passes so the management-adjustment overlay never dissolves into the GL —
    a reader of the mart can always strip it back out.
*/

select
    source_system,
    company_tla,
    period_month,
    cost_centre_code,
    account_group,
    cost_centre_allocates_onward,
    cost_centre_allocation_key,
    sum(amount)::number(38, 4) as pool_amount
from {{ ref('int_gl_pl_postings') }}
where allocation_route = 'cost_centre_pool'
group by 1, 2, 3, 4, 5, 6, 7
