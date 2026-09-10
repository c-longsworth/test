{{ config(materialized='table') }}

/*
    Variable cost keys — the third mechanism, and the one that drives the CM I
    block of the report.

    Unlike the cost-centre passes, these attach to an ACCOUNT GROUP rather than a
    pool: EXP-Shipping, EXP-PaymentVar, EXP-ALLOC-2040, COGS-HandlingIC. Rates
    are hand-set per company and date range (62 rows in `config -> Variable cost
    keys`), which is why they are a seed and not derived.

    Same contra convention as pass 2, same reason.
*/

with postings as (

    select
        source_system,
        company_tla,
        period_month,
        account_group,
        cost_centre_code,
        sum(amount)::number(38, 4) as amount
    from {{ ref('int_gl_pl_postings') }}
    where allocation_route = 'variable_key'
    group by 1, 2, 3, 4, 5

),

keys as (

    select *
    from {{ ref('seed_variable_cost_keys') }}

),

allocated as (

    select
        p.source_system,
        p.company_tla,
        p.period_month,
        p.account_group,
        p.cost_centre_code,
        coalesce(k.profit_centre_code, '{{ var("unallocated_code") }}') as profit_centre_code,
        coalesce(k.share, 1)                                as share,
        (p.amount * coalesce(k.share, 1))::number(38, 4)    as amount,
        k.profit_centre_code is null                        as is_key_coverage_gap
    from postings p
    left join keys k
        on p.company_tla = k.company_tla
       and p.account_group = k.key_code
       and p.period_month >= k.valid_from
       and p.period_month < k.valid_to

),

contra as (

    select
        source_system,
        company_tla,
        period_month,
        account_group,
        cost_centre_code,
        '-'                         as profit_centre_code,
        -1                          as share,
        -sum(amount)::number(38, 4) as amount,
        false                       as is_key_coverage_gap
    from allocated
    group by 1, 2, 3, 4, 5

)

select * from allocated
union all
select * from contra
