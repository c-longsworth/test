{{ config(materialized='view') }}

/*
    Odoo GL, conformed to the shared posting schema.

    Phase 1 covers the 5 companies with Odoo staging. Everything else arrives
    through stg_gl_postings_import on the identical schema — downstream must not
    be able to tell which is which.
*/

select
    'odoo'                                       as source_system,
    gl.gl_line_id::varchar                       as gl_line_id,
    co.company_tla,
    gl.odoo_company_id,
    gl.posting_date::date                        as posting_date,
    {{ mc_month_start('gl.posting_date') }}      as period_month,
    trim(gl.account_code)                        as account_code,
    {{ mc_account_key('co.company_tla', 'gl.account_code') }} as account_key,
    upper(trim(gl.profit_centre_code))           as posted_profit_centre_code,
    gl.amount_signed::number(38, 4)              as amount,
    co.accounting_currency                       as currency,
    trim(gl.description)                         as description,
    null                                         as management_reporting_comment,
    false                                        as is_management_adjustment
from {{ source('odoo', 'gl_lines_st') }} gl
join {{ ref('stg_companies') }} co
    on gl.odoo_company_id = co.odoo_company_id
