{{ config(materialized='view') }}

/*
    Non-Odoo GL: DATEV (PDE) plus the NO / US / CL / BR / PL feeds, and the
    AU/UK Odoo import sheets for any period not yet covered by Odoo staging.

    These arrive as a governed upload already conformed to the posting schema.
    They are monthly per import sheet, so posting_date is the month start —
    that is the real grain, not a lost detail.
*/

select
    'import'                                      as source_system,
    'IMP-' || i.import_row_id::varchar            as gl_line_id,
    upper(trim(i.company_tla))                    as company_tla,
    co.odoo_company_id,
    {{ mc_month_start('i.period_month') }}        as posting_date,
    {{ mc_month_start('i.period_month') }}        as period_month,
    trim(i.account_code)                          as account_code,
    {{ mc_account_key('i.company_tla', 'i.account_code') }} as account_key,
    upper(trim(i.profit_centre_code))             as posted_profit_centre_code,
    i.amount::number(38, 4)                       as amount,
    coalesce(upper(trim(i.currency)), co.accounting_currency) as currency,
    trim(i.description)                           as description,
    null                                          as management_reporting_comment,
    false                                         as is_management_adjustment,
    trim(i.source_sheet)                          as source_sheet,
    upper(trim(i.cost_centre_code))               as import_cost_centre_code
from {{ source('finance_uploads', 'gl_import') }} i
left join {{ ref('stg_companies') }} co
    on upper(trim(i.company_tla)) = co.company_tla
