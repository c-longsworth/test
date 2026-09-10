{{ config(materialized='table') }}

/*
    Pass 2 — cost centre to profit centre. Runs on post-pass-1 balances, never
    on the raw pools.

    Each pool is emptied out through the allocation key configured on its cost
    centre (REV, OI, OI-p.a., OI-DACH, OI-SCAN, All, plus country codes), which
    resolves to profit-centre shares for a company and date range.

    Contra-row convention, kept from `Allocation trans.`: alongside the positive
    share rows, one row at profit centre '-' with the full pool negated. Every
    pool therefore nets to zero, which is the free reconciliation test — see
    tests/assert_cost_centre_pools_net_to_zero.sql.

    A pool whose key has no matching share rows is NOT dropped. It lands whole on
    the centre's default profit centre if one is configured, else on
    UNALLOCATED, so missing key coverage shows up as a visible number instead of
    a silent shortfall. This matters right now: the live `Allocation keys` sheet
    exports as #VALUE! and the seed is the stale Jan-2025 backup, so coverage
    gaps are expected rather than hypothetical.
*/

with pools as (

    select *
    from {{ ref('int_cost_centre_pools_post_pass1') }}
    where abs(pool_amount) > 0.005
      -- centres that allocate onward were drained in pass 1; anything left is
      -- rounding residue, and the drain test is what surfaces a real remainder.
      and not allocates_to_other_cost_centres

),

keys as (

    select
        company_tla,
        key_code,
        profit_centre_code,
        share,
        valid_from,
        valid_to
    from {{ ref('seed_allocation_keys') }}

),

matched as (

    select
        p.source_system,
        p.company_tla,
        p.period_month,
        p.cost_centre_code,
        p.account_group,
        p.allocation_key,
        p.pool_amount,
        p.default_profit_centre,
        k.profit_centre_code,
        k.share
    from pools p
    left join keys k
        on p.company_tla = k.company_tla
       and p.allocation_key = k.key_code
       and p.period_month >= k.valid_from
       and p.period_month < k.valid_to

),

allocated as (

    select
        source_system,
        company_tla,
        period_month,
        cost_centre_code,
        account_group,
        allocation_key,
        coalesce(
            profit_centre_code,
            default_profit_centre,
            '{{ var("unallocated_code") }}'
        )                                                as profit_centre_code,
        coalesce(share, 1)                               as share,
        (pool_amount * coalesce(share, 1))::number(38, 4) as amount,
        profit_centre_code is null                       as is_key_coverage_gap
    from matched

),

contra as (

    -- one contra row per (pool, key), share -1, profit centre '-'
    select
        source_system,
        company_tla,
        period_month,
        cost_centre_code,
        account_group,
        allocation_key,
        '-'                            as profit_centre_code,
        -1                             as share,
        -sum(amount)::number(38, 4)    as amount,
        false                          as is_key_coverage_gap
    from allocated
    group by 1, 2, 3, 4, 5, 6

)

select * from allocated
union all
select * from contra
