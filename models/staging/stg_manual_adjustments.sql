{{ config(materialized='view') }}

/*
    `Financial_data.xlsx -> Finance data`, 116 rows.

    Management adjustments, not the GL. Kept as a distinct source_system all the
    way to the mart for two reasons: the `Additional management reporting`
    comment has to survive, and an adjustment that gets baked into a GL total is
    an adjustment nobody can find again.

    Consequence: the GL reconciliation test filters these out. The fact ties to
    the ledger on source_system in ('odoo', 'import') only, by construction.
*/

select
    'manual_adjustment'                           as source_system,
    'ADJ-' || f.adjustment_id::varchar            as gl_line_id,
    upper(trim(f.company_tla))                    as company_tla,
    co.odoo_company_id,
    {{ mc_month_start('f.period_month') }}        as posting_date,
    {{ mc_month_start('f.period_month') }}        as period_month,
    trim(f.account_code)                          as account_code,
    {{ mc_account_key('f.company_tla', 'f.account_code') }} as account_key,
    upper(trim(f.profit_centre_code))             as posted_profit_centre_code,
    coalesce(f.amount, f.amount_eur)::number(38, 4) as amount,
    coalesce(upper(trim(f.currency)), co.accounting_currency) as currency,
    trim(f.description)                           as description,
    trim(f.additional_management_reporting)       as management_reporting_comment,
    true                                          as is_management_adjustment,
    upper(trim(f.cost_centre_code))               as adjustment_cost_centre_code
from {{ source('finance_uploads', 'finance_data') }} f
left join {{ ref('stg_companies') }} co
    on upper(trim(f.company_tla)) = co.company_tla
