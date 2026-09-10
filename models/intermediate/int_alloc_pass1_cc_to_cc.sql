{{ config(materialized='table') }}

/*
    Pass 1 — cost centre to cost centre. This runs BEFORE anything reaches a
    profit centre.

    32 centres carry `Cost allocation to other cost centers = True`: facilities
    4101-4125, IT 4200 and 1500, and 8010 / 8011 (DACH / SCAND). What they push
    out lands on other cost centres, which then allocate onward — so this is a
    chain, not a single hop, and it is resolved recursively rather than with one
    join. Modelling the whole thing as a single cc -> pc join produces plausible
    numbers that do not tie back to the ledger.

    Cycle guard: recursion stops at var('cc_to_cc_max_depth'). A rule set that
    loops will hit the cap rather than run forever; the
    assert_cc_to_cc_allocation_fully_drains test is what catches the residue.

    Output is a signed movement layer: every allocation emits a positive row on
    the receiving centre and a negative row on the giving centre, so the whole
    model sums to zero by construction.
*/

with recursive rules as (

    select
        company_tla,
        source_cost_centre_code,
        target_cost_centre_code,
        share,
        valid_from,
        valid_to
    from {{ ref('seed_cc_to_cc_rules') }}

),

pools as (

    select
        source_system,
        company_tla,
        period_month,
        cost_centre_code,
        account_group,
        pool_amount
    from {{ ref('int_cost_centre_pools') }}
    where cost_centre_allocates_onward

),

recursive_allocation as (

    -- anchor: first hop out of each self-allocating centre
    select
        1                                        as depth,
        p.source_system,
        p.company_tla,
        p.period_month,
        p.account_group,
        p.cost_centre_code                       as source_cost_centre_code,
        r.target_cost_centre_code,
        (p.pool_amount * r.share)::number(38, 4) as amount
    from pools p
    join rules r
        on p.company_tla = r.company_tla
       and p.cost_centre_code = r.source_cost_centre_code
       and p.period_month >= r.valid_from
       and p.period_month < r.valid_to

    union all

    -- onward hops: whatever landed on a centre that itself allocates onward
    select
        a.depth + 1,
        a.source_system,
        a.company_tla,
        a.period_month,
        a.account_group,
        a.target_cost_centre_code                as source_cost_centre_code,
        r.target_cost_centre_code,
        (a.amount * r.share)::number(38, 4)      as amount
    from recursive_allocation a
    join rules r
        on a.company_tla = r.company_tla
       and a.target_cost_centre_code = r.source_cost_centre_code
       and a.period_month >= r.valid_from
       and a.period_month < r.valid_to
    where a.depth < {{ var('cc_to_cc_max_depth') }}

),

movements as (

    -- the receiving side
    select
        depth,
        source_system,
        company_tla,
        period_month,
        account_group,
        source_cost_centre_code,
        target_cost_centre_code as cost_centre_code,
        amount
    from recursive_allocation

    union all

    -- the contra side: the giving centre is relieved of exactly what it gave
    select
        depth,
        source_system,
        company_tla,
        period_month,
        account_group,
        source_cost_centre_code,
        source_cost_centre_code as cost_centre_code,
        -amount                 as amount
    from recursive_allocation

)

select
    source_system,
    company_tla,
    period_month,
    account_group,
    source_cost_centre_code,
    cost_centre_code,
    max(depth)                 as max_depth,
    sum(amount)::number(38, 4) as amount
from movements
group by 1, 2, 3, 4, 5, 6
