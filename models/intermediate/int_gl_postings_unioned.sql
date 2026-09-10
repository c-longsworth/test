{{ config(materialized='table') }}

/*
    Every posting, one schema, GL-line grain. No cost-centre fan-out yet — this
    model stays at exactly one row per source line so it can be summed against
    the ledger without thinking about weights.

    Three source systems, tagged and kept distinguishable:
      odoo              — the 5 companies on Odoo staging
      import            — DATEV (PDE) + NO / US / CL / BR / PL governed uploads
      manual_adjustment — Finance data management overlay, never part of the GL tie-out
*/

with odoo as (

    select
        source_system,
        gl_line_id,
        company_tla,
        odoo_company_id,
        posting_date,
        period_month,
        account_code,
        account_key,
        posted_profit_centre_code,
        cast(null as varchar) as declared_cost_centre_code,
        amount,
        currency,
        description,
        management_reporting_comment,
        is_management_adjustment,
        cast(null as varchar) as source_sheet
    from {{ ref('stg_gl_postings_odoo') }}

),

imports as (

    select
        source_system,
        gl_line_id,
        company_tla,
        odoo_company_id,
        posting_date,
        period_month,
        account_code,
        account_key,
        posted_profit_centre_code,
        import_cost_centre_code as declared_cost_centre_code,
        amount,
        currency,
        description,
        management_reporting_comment,
        is_management_adjustment,
        source_sheet
    from {{ ref('stg_gl_postings_import') }}

),

adjustments as (

    select
        source_system,
        gl_line_id,
        company_tla,
        odoo_company_id,
        posting_date,
        period_month,
        account_code,
        account_key,
        posted_profit_centre_code,
        adjustment_cost_centre_code as declared_cost_centre_code,
        amount,
        currency,
        description,
        management_reporting_comment,
        is_management_adjustment,
        'Finance data' as source_sheet
    from {{ ref('stg_manual_adjustments') }}

)

select * from odoo
union all
select * from imports
union all
select * from adjustments
