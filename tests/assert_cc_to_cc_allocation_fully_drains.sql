/*
    Pass 1 must empty every self-allocating cost centre.

    A centre that still holds a balance after pass 1 is excluded from pass 2
    (pass 2 skips centres flagged as allocating onward), so its residue never
    reaches a profit centre at all. That shows up as a report that is short by
    an amount nobody can find.

    Most likely cause: a chain deeper than var('cc_to_cc_max_depth'), or a cycle
    in seed_cc_to_cc_rules that hit the depth cap.
*/

{{ config(severity='error') }}

select
    company_tla,
    period_month,
    cost_centre_code,
    sum(pool_amount) as residual
from {{ ref('int_cost_centre_pools_post_pass1') }}
where allocates_to_other_cost_centres
group by 1, 2, 3
having abs(sum(pool_amount)) > 0.01
