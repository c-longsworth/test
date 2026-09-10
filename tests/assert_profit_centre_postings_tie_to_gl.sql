/*
    THE test. fct_profit_centre_postings total = GL total, by company and month.

    Management adjustments are excluded on both sides: they are a reporting
    overlay, not ledger entries, and folding them in would make a green test
    mean nothing.

    If this fails, an allocation layer stopped netting to zero — usually a
    contra row that was filtered out, or shares that do not sum to 1.
*/

{{ config(severity='error') }}

with gl as (

    select
        company_tla,
        period_month,
        sum(amount) as gl_amount
    from {{ ref('int_gl_pl_postings') }}
    where source_system in ('odoo', 'import')
    group by 1, 2

),

fact as (

    select
        company_tla,
        period_month,
        sum(amount) as fact_amount
    from {{ ref('fct_profit_centre_postings') }}
    where source_system in ('odoo', 'import')
    group by 1, 2

)

select
    coalesce(gl.company_tla, fact.company_tla)   as company_tla,
    coalesce(gl.period_month, fact.period_month) as period_month,
    coalesce(gl.gl_amount, 0)                    as gl_amount,
    coalesce(fact.fact_amount, 0)                as fact_amount,
    coalesce(fact.fact_amount, 0) - coalesce(gl.gl_amount, 0) as difference
from gl
full outer join fact
    on gl.company_tla = fact.company_tla
   and gl.period_month = fact.period_month
where abs(coalesce(fact.fact_amount, 0) - coalesce(gl.gl_amount, 0)) > 0.01
