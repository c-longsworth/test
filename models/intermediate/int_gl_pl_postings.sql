{{ config(materialized='table') }}

/*
    P&L postings, attributed to a cost centre.

    Grain: one row per (gl_line_id, cost_centre_code). A GL line split across
    three cost centres becomes three rows whose amounts sum back to the line.

    Attribution, in order:
      1. Odoo lines      — the analytic weight ratio, applied to the GL amount.
      2. Import / adjust — the cost centre declared on the upload row.
      3. Neither         — the cost centre's default, else UNALLOCATED.

    The join to weights is a LEFT join on purpose. Postings with no analytic line
    must stay visible in an UNALLOCATED bucket; dropping them is how a fact quietly
    stops tying to the ledger.
*/

with postings as (

    select *
    from {{ ref('int_gl_postings_unioned') }}

),

accounts as (

    select *
    from {{ ref('stg_ledger_accounts') }}

),

weights as (

    select *
    from {{ ref('stg_gl_analytic_weights') }}

),

variable_key_codes as (

    select distinct key_code
    from {{ ref('seed_variable_cost_keys') }}

),

pl_postings as (

    select
        p.*,
        a.account_group,
        a.account_group_prefix,
        a.cost_centre_required,
        a.account_name
    from postings p
    join accounts a
        on p.account_key = a.account_key
    where a.is_pl_account

),

attributed as (

    select
        p.source_system,
        p.gl_line_id,
        p.company_tla,
        p.period_month,
        p.posting_date,
        p.account_key,
        p.account_code,
        p.account_group,
        p.account_group_prefix,
        p.cost_centre_required,
        p.posted_profit_centre_code,
        p.currency,
        p.description,
        p.management_reporting_comment,
        p.is_management_adjustment,
        p.source_sheet,

        coalesce(w.centre_code, p.declared_cost_centre_code, '{{ var("unallocated_code") }}')
            as cost_centre_code,

        -- Weight, not analytic amount. 1 when there is no analytic split.
        coalesce(w.weight, 1)                     as attribution_weight,
        (p.amount * coalesce(w.weight, 1))::number(38, 4) as amount,
        p.amount                                  as gl_line_amount,
        w.gl_line_id is not null                  as is_analytically_attributed

    from pl_postings p
    left join weights w
        on p.source_system = 'odoo'
       and p.gl_line_id = w.gl_line_id

)

routed as (

    select
        a.*,
        cc.centre_name              as cost_centre_name,
        cc.allocation_key           as cost_centre_allocation_key,
        coalesce(cc.allocates_to_other_cost_centres, false) as cost_centre_allocates_onward,
        cc.default_profit_centre,
        a.cost_centre_code = '{{ var("unallocated_code") }}' as is_unallocated,

        /*
            Exactly one allocation mechanism per posting. A posting that went
            through two of them would be counted twice at profit-centre level
            while still tying to the GL in total — the worst kind of wrong,
            because the reconciliation test would stay green.

            variable_key      -> allocated on a hand-set rate by account group
            cost_centre_pool  -> pooled on its cost centre, then passes 1 and 2
            direct            -> already carries its profit centre
        */
        case
            when vk.key_code is not null then 'variable_key'
            when cc.centre_code is not null then 'cost_centre_pool'
            else 'direct'
        end as allocation_route

    from attributed a
    left join {{ ref('stg_cost_centres') }} cc
        on a.cost_centre_code = cc.centre_code
       and a.company_tla = cc.company_tla
    left join variable_key_codes vk
        on a.account_group = vk.key_code

)

select
    r.*,
    case
        when r.allocation_route = 'direct'
            then coalesce(
                nullif(r.posted_profit_centre_code, ''),
                r.default_profit_centre,
                '{{ var("unallocated_code") }}'
            )
        -- pooled and variable-key postings reach a profit centre through their
        -- allocation layer, not here; '-' keeps them in the GL tie-out without
        -- landing on a profit centre twice.
        else '-'
    end as resolved_profit_centre_code
from routed r
