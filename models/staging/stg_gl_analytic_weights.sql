{{ config(materialized='view') }}

/*
    Cost-centre weights, derived from the analytic lines.

    Analytic amounts are POST-distribution. Multiplying them into the fact means
    the fact stops tying to the ledger the moment analytic and GL disagree by a
    rounding cent. So: take a RATIO from the analytic lines here, and apply it to
    the GL amount in int_gl_pl_postings. Weights sum to exactly 1 per GL line.

    `centre_code` is regex-parsed out of a display label ("[8051] Store UK").
    A rename in Odoo drops the bracketed code and the posting lands in
    UNALLOCATED with no error, so centre_code is tested for null wherever the
    analytic plan-3 field is set.
*/

with analytic as (

    select
        gl_line_id,
        analytic_plan_3_label,
        {{ mc_parse_centre_code('analytic_plan_3_label') }} as centre_code,
        analytic_amount
    from {{ source('odoo', 'analytic_lines_st') }}
    where gl_line_id is not null

),

line_totals as (

    select
        gl_line_id,
        sum(abs(analytic_amount)) as total_abs_analytic_amount
    from analytic
    group by gl_line_id

)

select
    a.gl_line_id,
    coalesce(a.centre_code, '{{ var("unallocated_code") }}') as centre_code,
    a.analytic_plan_3_label,
    a.analytic_amount,
    -- abs() so a line with offsetting analytic rows still produces sane weights
    -- rather than a divide-by-near-zero blow-up.
    abs(a.analytic_amount) / nullif(t.total_abs_analytic_amount, 0) as weight
from analytic a
join line_totals t using (gl_line_id)
where t.total_abs_analytic_amount > 0
