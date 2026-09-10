/*
    Volume landing in UNALLOCATED on accounts flagged cost_centre_required.

    Warn, not error: unallocated postings are meant to stay visible rather than
    block the build, and a hard failure here just means someone drops the test.
    The number is the signal — it should trend to zero, and a jump means an
    analytic account was renamed or a new account was set up without a plan-3
    default.
*/

{{ config(severity='warn') }}

select
    company_tla,
    period_month,
    account_key,
    account_group,
    count(*)    as posting_count,
    sum(amount) as unallocated_amount
from {{ ref('int_gl_pl_postings') }}
where cost_centre_required
  and is_unallocated
group by 1, 2, 3, 4
having abs(sum(amount)) > 0.01
