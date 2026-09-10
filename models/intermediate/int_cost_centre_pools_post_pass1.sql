{{ config(materialized='table') }}

/*
    Cost-centre balances after pass 1. This is what pass 2 empties out to profit
    centres. Centres that allocate onward should net to ~0 here — if one does
    not, pass 1 did not drain it and the residue is about to be silently lost.
*/

with combined as (

    select
        source_system,
        company_tla,
        period_month,
        cost_centre_code,
        account_group,
        pool_amount as amount
    from {{ ref('int_cost_centre_pools') }}

    union all

    select
        source_system,
        company_tla,
        period_month,
        cost_centre_code,
        account_group,
        amount
    from {{ ref('int_alloc_pass1_cc_to_cc') }}

)

select
    c.source_system,
    c.company_tla,
    c.period_month,
    c.cost_centre_code,
    c.account_group,
    sum(c.amount)::number(38, 4) as pool_amount,
    cc.allocation_key,
    coalesce(cc.allocates_to_other_cost_centres, false) as allocates_to_other_cost_centres,
    cc.default_profit_centre
from combined c
left join {{ ref('stg_cost_centres') }} cc
    on c.cost_centre_code = cc.centre_code
   and c.company_tla = cc.company_tla
group by 1, 2, 3, 4, 5, cc.allocation_key, cc.allocates_to_other_cost_centres, cc.default_profit_centre
