{{ config(materialized='view') }}

/*
    companies_l — the missing bridge.

    GL lines carry `odoo_company_id` and the Odoo display name; ledger_accounts_l
    keys on the company TLA. That translation only existed in profit_centre_l,
    which is at profit-centre grain, so joining through it fanned every posting.
    This model is one row per company and nothing else.
*/

with config_companies as (

    select
        upper(trim(company_tla))        as company_tla,
        trim(company_name)              as company_name,
        upper(trim(accounting_currency)) as accounting_currency,
        coalesce(carries_mc_data, false) as carries_mc_data
    from {{ source('finance_uploads', 'config_companies') }}
    where company_tla is not null

),

odoo_company_map as (

    -- profit_centre_l is at profit-centre grain; collapse it to company grain
    -- before it is allowed anywhere near a posting.
    select distinct
        upper(trim(company_tla)) as company_tla,
        odoo_company_id,
        trim(odoo_company_name)  as odoo_company_name
    from {{ source('odoo', 'profit_centre_l') }}
    where odoo_company_id is not null
      and company_tla is not null

)

select
    c.company_tla,
    c.company_name,
    c.accounting_currency,
    c.carries_mc_data,
    m.odoo_company_id,
    m.odoo_company_name,
    m.odoo_company_id is not null as is_odoo_company
from config_companies c
left join odoo_company_map m
    on c.company_tla = m.company_tla
