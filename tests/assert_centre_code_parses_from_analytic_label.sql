/*
    centre_code is regex-parsed out of an Odoo display label ("[8051] Store UK").
    Rename the analytic account in Odoo and the bracketed code goes with it —
    every posting on that centre silently lands in UNALLOCATED, with no error
    anywhere, until someone notices the report moved.

    So: wherever the plan-3 field is set, a code must come out of it.
*/

{{ config(severity='error') }}

select
    gl_line_id,
    analytic_plan_3_label
from {{ ref('stg_gl_analytic_weights') }}
where analytic_plan_3_label is not null
  and trim(analytic_plan_3_label) <> ''
  and centre_code = '{{ var("unallocated_code") }}'
