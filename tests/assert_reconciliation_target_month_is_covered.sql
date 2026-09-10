/*
    Build order step 3: reconcile to a known historical month before anything
    reaches Looker. This test fails while the chosen target month produces no
    output at all, so "we have not reconciled yet" is a red test rather than an
    assumption.

    Set the target with vars recon_company_tla / recon_month. It needs to be a
    company + month with a signed-off MC output — see README "Open questions".
*/

{{ config(severity='warn') }}

select
    '{{ var("recon_company_tla") }}' as expected_company_tla,
    '{{ var("recon_month") }}'       as expected_month,
    count(*)                         as rows_found
from {{ ref('fct_mc_profit_centre') }}
where company_tla = '{{ var("recon_company_tla") }}'
  and period_month = '{{ var("recon_month") }}'::date
having count(*) = 0
